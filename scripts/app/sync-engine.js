/* ================================================================
   sync-engine.js — Per-record offline-first sync engine.

   Works alongside the existing whole-snapshot sync in sync.js.
   This engine activates ONLY when:
     1. state.prefs.cloudAutoBackup === true  (user opted in)
     2. A valid Supabase session exists        (state.syncSession)
     3. A cloud profile UUID is known          (set by migration in Phase 5)
     4. The browser is online

   While any condition is false the engine is fully inert — nothing
   is sent to Supabase.

   Write path:  storage.js enqueues ops into the `outbox` IndexedDB
                store after every mutation. This module drains that
                queue via debounced upserts/deletes per record.

   Pull path:   On startEngine + on reconnect + every TICK_INTERVAL,
                we query `entries` and `goals` for rows with
                updated_at > watermark and merge into IndexedDB using
                last-write-wins (by updated_at).

   Conflict resolution: last-write-wins by updated_at timestamp.
   ================================================================ */

import { state, CLOUD_PUSH_DEBOUNCE, DEFAULT_PREFS } from './state.js';
import { getClient }   from './sync.js';
import { UserManager } from './users.js';
import * as Repo       from './cloud-repo.js';
import { checkAchievements } from './achievements.js';
import { renderPage, updateSidebarUser } from './nav.js';
import { applyAccent, applyCompact, applyTheme } from './widgets.js';

const TICK_INTERVAL = 30_000; // 30 s — periodic pull while online

let _drainTimer    = null;
let _tickerHandle  = null;

/* ---- Guard helpers -------------------------------------------- */

function localProfileId() { return UserManager.getActiveId() || 'default'; }
function accountId()      { return state.syncSession?.user?.id || null; }
function cloudProfileId() { return Repo.getCloudProfileId(localProfileId(), accountId()); }

function canRun({ manual = false } = {}) {
  return (
    (manual || state.prefs?.cloudAutoBackup === true) &&
    !!state.syncSession          &&
    !!cloudProfileId()           &&
    navigator.onLine
  );
}

/* ---- In-memory state refresh after a pull --------------------- */

async function refreshState() {
  state.entries   = await Storage.getAllEntries();
  state.earnedAch = await Storage.getAllAchievements();
  state.goals     = await Storage.getAllGoals();
  state.prefs     = { ...DEFAULT_PREFS, ...(await Storage.getAllPrefs()) };
  await checkAchievements();
  applyTheme(state.prefs.theme);
  applyAccent(state.prefs.accent);
  applyCompact(state.prefs.compact);
  renderPage(state.currentPage);
  updateSidebarUser();
}

/* ---- Outbox drain --------------------------------------------- */
// Reads all pending ops and flushes them to the normalized Supabase tables.
// Ops that succeed are removed from the outbox; failures are left in place
// and retried on the next drain (outbox is durable across page reloads).

export async function drainOutbox({ manual = false } = {}) {
  if (!canRun({ manual })) return;
  const ops = await Storage.getAllOutboxOps();
  if (!ops.length) return;

  const sb  = await getClient();
  const pid = cloudProfileId();
  const aid = accountId();

  for (const op of ops) {
    try {
      if (op.kind === 'entry') {
        if (op.op === 'upsert') {
          const row       = Repo.entryToCloudRow(op.payload, pid, aid);
          const resources = Repo.entryResourcesToCloud(op.payload, aid);
          const { error } = await sb.from('entries').upsert(row, { onConflict: 'id' });
          if (error) throw error;
          // Sync resources: delete stale ones, insert fresh set
          if (op.payload.resources?.length) {
            await sb.from('entry_resources').delete().eq('entry_id', op.recordId);
            const { error: rErr } = await sb.from('entry_resources').insert(resources);
            if (rErr) throw rErr;
          }
        } else if (op.op === 'soft-delete') {
          await sb.from('entries')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', op.recordId);
        } else if (op.op === 'restore') {
          const row       = Repo.entryToCloudRow(op.payload, pid, aid);
          const resources = Repo.entryResourcesToCloud(op.payload, aid);
          const { error } = await sb.from('entries').upsert({ ...row, deleted_at: null }, { onConflict: 'id' });
          if (error) throw error;
          if (resources.length) {
            await sb.from('entry_resources').delete().eq('entry_id', op.recordId);
            await sb.from('entry_resources').insert(resources);
          }
        } else if (op.op === 'perm-delete') {
          await sb.from('entry_resources').delete().eq('entry_id', op.recordId);
          await sb.from('entries').delete().eq('id', op.recordId);
        }

      } else if (op.kind === 'goal') {
        if (op.op === 'upsert') {
          const row        = Repo.goalToCloudRow(op.payload, pid, aid);
          const milestones = Repo.goalMilestonesToCloud(op.payload, aid);
          const { error } = await sb.from('goals').upsert(row, { onConflict: 'id' });
          if (error) throw error;
          for (const ms of milestones) {
            if (!ms.id) continue;
            const { error: msErr } = await sb
              .from('goal_milestones')
              .upsert(ms, { onConflict: 'id' });
            if (msErr) throw msErr;
          }
        } else if (op.op === 'soft-delete') {
          await sb.from('goals')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', op.recordId);
        } else if (op.op === 'restore') {
          const row = Repo.goalToCloudRow(op.payload, pid, aid);
          const { error } = await sb.from('goals').upsert({ ...row, deleted_at: null }, { onConflict: 'id' });
          if (error) throw error;
        } else if (op.op === 'perm-delete') {
          await sb.from('goal_milestones').delete().eq('goal_id', op.recordId);
          await sb.from('goals').delete().eq('id', op.recordId);
        }

      } else if (op.kind === 'achievement') {
        if (op.op === 'upsert') {
          const row = Repo.achievementToCloudRow(op.payload, pid, aid);
          const { error } = await sb.from('achievements')
            .upsert(row, { onConflict: 'profile_id,achievement_id' });
          if (error) throw error;
        }

      } else if (op.kind === 'pref') {
        if (op.op === 'upsert') {
          const row = Repo.prefToCloudRow(op.payload, pid, aid);
          const { error } = await sb.from('profile_prefs').upsert(row, { onConflict: 'profile_id,key' });
          if (error) throw error;
        }

      } else if (op.kind === 'categories') {
        if (op.op === 'replace-all') {
          // payload is either { names, colors } (new) or string[] (legacy outbox op)
          const names  = Array.isArray(op.payload) ? op.payload : (op.payload.names  || []);
          const colors = Array.isArray(op.payload) ? {}         : (op.payload.colors || {});
          const { error: delErr } = await sb.from('categories').delete().eq('profile_id', pid);
          if (delErr) throw delErr;
          const rows = Repo.categoriesToCloudRows(names, colors, pid, aid);
          if (rows.length) {
            const { error: insErr } = await sb.from('categories').insert(rows);
            if (insErr) throw insErr;
          }
        }
      }

      // Success — remove from outbox
      await Storage.removeOutboxOp(op.id);
    } catch (err) {
      // Leave in outbox; the next drain (online event or ticker) will retry.
      console.warn('[SyncEngine] drain op failed, will retry:', op.kind, op.op, err?.message || err);
    }
  }
}

/* ---- Pull deltas ---------------------------------------------- */
// Fetch records written by other devices since the last successful pull
// and merge them into the local IndexedDB using last-write-wins.

// `silent` skips the post-pull state refresh + re-render — used by the login
// hydrate, which pulls every profile in turn before the app is shown and lets
// core.init load+render the default profile once at the end.
export async function pullDeltas({ manual = false, force = false, silent = false } = {}) {
  if (!canRun({ manual })) return;
  const sb  = await getClient();
  const pid = cloudProfileId();
  const aid = accountId();
  const wm  = (!force && Repo.getSyncWatermark(localProfileId(), aid)) || '1970-01-01T00:00:00.000Z';

  // Snapshot the pull time BEFORE the query so concurrent writes aren't lost.
  const pullTime = new Date().toISOString();
  let changed = false;

  // --- Entries -------------------------------------------------
  const { data: entryRows, error: eErr } = await sb
    .from('entries')
    .select('*, entry_resources(*)')
    .eq('profile_id', pid)
    .gt('updated_at', wm);

  if (eErr) { console.warn('[SyncEngine] pullDeltas entries error:', eErr.message); }
  else if (entryRows?.length) {
    for (const row of entryRows) {
      if (row.deleted_at) {
        await Storage.put(Storage.STORES.deletedEntries, {
          ...Repo.cloudToEntry(row),
          deletedAt: new Date(row.deleted_at).getTime(),
        });
        await Storage.remove(Storage.STORES.entries, row.id);
        changed = true;
        continue;
      }
      const local = Repo.cloudToEntry(row);
      const existing = await Storage.getEntry(local.id);
      const existingTs = existing?.updatedAt || 0;
      const remoteTs   = row.updated_at ? new Date(row.updated_at).getTime() : 0;
      if (remoteTs > existingTs) {
        await Storage.put(Storage.STORES.entries, local);
        changed = true;
      }
    }
  }

  // --- Goals ---------------------------------------------------
  const { data: goalRows, error: gErr } = await sb
    .from('goals')
    .select('*, goal_milestones(*)')
    .eq('profile_id', pid)
    .gt('updated_at', wm);

  if (gErr) { console.warn('[SyncEngine] pullDeltas goals error:', gErr.message); }
  else if (goalRows?.length) {
    for (const row of goalRows) {
      if (row.deleted_at) {
        await Storage.put(Storage.STORES.deletedGoals, {
          ...Repo.cloudToGoal(row),
          deletedAt: new Date(row.deleted_at).getTime(),
        });
        await Storage.remove(Storage.STORES.goals, row.id);
        changed = true;
        continue;
      }
      const local = Repo.cloudToGoal(row);
      const existing = await Storage.getGoal(local.id);
      const existingTs = existing?.updatedAt || 0;
      const remoteTs   = row.updated_at ? new Date(row.updated_at).getTime() : 0;
      if (remoteTs > existingTs) {
        await Storage.put(Storage.STORES.goals, local);
        changed = true;
      }
    }
  }

  // --- Prefs ---------------------------------------------------
  const { data: prefRows, error: pErr } = await sb
    .from('profile_prefs')
    .select('key, value')
    .eq('profile_id', pid)
    .gt('updated_at', wm);

  if (pErr) { console.warn('[SyncEngine] pullDeltas prefs error:', pErr.message); }
  else if (prefRows?.length) {
    for (const row of prefRows) {
      // Use low-level put to avoid re-enqueuing an outbox op for each pulled pref.
      await Storage.put(Storage.STORES.preferences, { key: row.key, value: row.value });
      changed = true;
    }
  }

  // --- Categories (no updated_at column — always fetch all for profile) -----
  const { data: catRows, error: catErr } = await sb
    .from('categories')
    .select('name, sort_order')
    .eq('profile_id', pid)
    .order('sort_order');

  if (catErr) { console.warn('[SyncEngine] pullDeltas categories error:', catErr.message); }
  else if (catRows?.length) {
    const { names, colors } = Repo.cloudToCategories(catRows);
    await Storage.put(Storage.STORES.preferences, { key: 'categories',     value: names  });
    await Storage.put(Storage.STORES.preferences, { key: 'categoryColors', value: colors });
    changed = true;
  }

  // --- Achievements --------------------------------------------
  // The achievements table has no updated_at, so a watermark delta can't apply.
  // Only fetch them on a forced/manual pull (full restore on sign-in / "Restore
  // from cloud") to avoid a full-table read on every 30s tick. Upserts are
  // idempotent (keyPath 'id'), so re-pulling is harmless.
  if (force || manual) {
    const { data: achRows, error: aErr } = await sb
      .from('achievements')
      .select('achievement_id, earned_at')
      .eq('profile_id', pid);

    if (aErr) { console.warn('[SyncEngine] pullDeltas achievements error:', aErr.message); }
    else if (achRows?.length) {
      for (const row of achRows) {
        const local    = Repo.cloudToAchievement(row);
        const existing  = await Storage.getAchievement(local.id);
        if (!existing) {
          // Low-level put avoids re-enqueuing an outbox op for each pulled badge.
          await Storage.put(Storage.STORES.achievements, local);
          changed = true;
        }
      }
    }
  }

  // Advance watermark after a successful (even partial) pull
  Repo.setSyncWatermark(localProfileId(), aid, pullTime);

  if (changed && !silent) await refreshState();
}

/* ---- Scheduled drain (debounced) ------------------------------ */
// Called by the mutation hook in storage.js so every local write
// triggers an outbox flush shortly after.

export function queueDrain() {
  if (!canRun()) return;
  clearTimeout(_drainTimer);
  _drainTimer = setTimeout(() => {
    drainOutbox().catch(err => console.warn('[SyncEngine] drain error:', err?.message || err));
  }, CLOUD_PUSH_DEBOUNCE);
}

/* ---- Periodic ticker ------------------------------------------ */

function startTicker() {
  if (_tickerHandle) return;
  _tickerHandle = setInterval(async () => {
    if (!navigator.onLine || !canRun()) return;
    try {
      await drainOutbox();
      await pullDeltas();
    } catch (err) {
      console.warn('[SyncEngine] tick error:', err?.message || err);
    }
  }, TICK_INTERVAL);
}

function stopTicker() {
  clearInterval(_tickerHandle);
  _tickerHandle = null;
}

/* ---- Public API ----------------------------------------------- */

export async function startEngine() {
  // Wire the mutation hook so every Storage write queues a drain.
  Storage.setMutationHook(queueDrain);

  // Wire the online event so drains resume after connectivity is restored.
  window.addEventListener('online', () => {
    if (canRun()) {
      drainOutbox().catch(() => {});
      pullDeltas().catch(() => {});
    }
  });

  startTicker();

  if (!canRun()) return; // no cloud profile UUID yet (pre-migration) — engine is primed but idle
  try {
    await drainOutbox();
    await pullDeltas();
  } catch (err) {
    console.warn('[SyncEngine] startEngine initial sync error:', err?.message || err);
  }
}

export function stopEngine() {
  Storage.setMutationHook(null);
  stopTicker();
  clearTimeout(_drainTimer);
}
