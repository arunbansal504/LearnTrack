/* ================================================================
   migration.js — One-time migration of local IndexedDB data into
   the normalized Supabase schema.

   Called ONLY when the user explicitly enables cloud backup
   (toggle ON + confirms "Yes" in the confirmation modal). It must
   NEVER run on login, profile switch, or without explicit user
   consent. The sync-engine canRun() guard stays inert until this
   migration writes the cloud profile UUID via setCloudProfileId().

   Design:
   • A localStorage flag `lt_migrated_<profileId>_<accountId>`
     gates re-entry so the migration is fully idempotent.
   • Entries and goals are upserted by their text id (existing PK).
   • entry_resources are delete-then-inserted (no local UUID exists
     to conflict on — the PK is a server-generated UUID).
   • goal_milestones are upserted by their text id ('ms-…').
   • achievements are upserted by the composite PK (profile_id, achievement_id).
   • The sync watermark is stamped to "now" at the end so the
     subsequent pull skips everything we just pushed.

   Ambient global: Storage (loaded as a classic script before main.js).
   ================================================================ */

import { state } from './state.js';
import { UserManager, createCloudProfileRow } from './users.js';
import { getClient } from './sync.js';
import {
  getCloudProfileId,
  setSyncWatermark,
  entryToCloudRow,
  entryResourcesToCloud,
  goalToCloudRow,
  goalMilestonesToCloud,
  achievementToCloudRow,
} from './cloud-repo.js';

const CHUNK_SIZE = 100;

function migrationKey(localProfileId, accountId) {
  return `lt_migrated_${localProfileId}_${accountId}`;
}

export async function migrate() {
  const session = state.syncSession;
  if (!session) throw new Error('Not signed in. Sign in before enabling cloud backup.');

  const accountId      = session.user.id;
  const localUser      = UserManager.getActive();
  const localProfileId = localUser?.id || 'default';

  // Idempotent guard — already fully migrated
  if (localStorage.getItem(migrationKey(localProfileId, accountId))) return;

  // 1. Ensure a cloud profiles row exists (writes UUID via setCloudProfileId)
  if (!getCloudProfileId(localProfileId, accountId)) {
    await createCloudProfileRow(
      localUser || { id: localProfileId, name: 'Learner', color: '#6c63ff' }
    );
  }

  const cloudProfileId = getCloudProfileId(localProfileId, accountId);
  if (!cloudProfileId) {
    throw new Error('Could not create cloud profile. Check your connection and try again.');
  }

  // 2. Read all local data (Storage is an ambient IIFE global)
  const backup       = await Storage.exportAll();
  const entries      = backup?.data?.entries      || [];
  const goals        = backup?.data?.goals        || [];
  const achievements = backup?.data?.achievements || [];

  const sb = await getClient();

  // 3. Entries — upsert by text id
  await _upsertChunked(sb, 'entries',
    entries.map(e => entryToCloudRow(e, cloudProfileId, accountId)), 'id');

  // 4. Entry resources — delete-then-insert (no local UUID to conflict on)
  const resources = entries.flatMap(e => entryResourcesToCloud(e, accountId));
  if (resources.length) {
    const entryIds = [...new Set(resources.map(r => r.entry_id))];
    await _deleteChunked(sb, 'entry_resources', 'entry_id', entryIds);
    await _insertChunked(sb, 'entry_resources', resources);
  }

  // 5. Goals — upsert by text id
  await _upsertChunked(sb, 'goals',
    goals.map(g => goalToCloudRow(g, cloudProfileId, accountId)), 'id');

  // 6. Goal milestones — upsert by text id ('ms-…' PK)
  const milestones = goals.flatMap(g => goalMilestonesToCloud(g, accountId));
  await _upsertChunked(sb, 'goal_milestones', milestones, 'id');

  // 7. Achievements — upsert by composite PK
  await _upsertChunked(sb, 'achievements',
    achievements.map(a => achievementToCloudRow(a, cloudProfileId, accountId)),
    'profile_id,achievement_id');

  // 8. Stamp sync watermark so the first pull skips what we just pushed
  setSyncWatermark(localProfileId, accountId, new Date().toISOString());

  // 9. Mark fully migrated
  localStorage.setItem(migrationKey(localProfileId, accountId), '1');
}

async function _upsertChunked(sb, table, rows, onConflict) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + CHUNK_SIZE), { onConflict });
    if (error) throw new Error(`[Migration] ${table} upsert: ${error.message}`);
  }
}

async function _insertChunked(sb, table, rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const { error } = await sb.from(table).insert(rows.slice(i, i + CHUNK_SIZE));
    if (error) throw new Error(`[Migration] ${table} insert: ${error.message}`);
  }
}

async function _deleteChunked(sb, table, column, ids) {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const { error } = await sb.from(table).delete().in(column, ids.slice(i, i + CHUNK_SIZE));
    if (error) throw new Error(`[Migration] ${table} delete: ${error.message}`);
  }
}
