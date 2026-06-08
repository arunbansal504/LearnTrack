/* ================================================================
   cloud-repo.js — Data mapper between local IndexedDB record shapes
   and the normalized Supabase schema.

   All functions here are PURE (no network calls, no async). The sync
   engine calls these to translate before upserting / after fetching.

   Local → Cloud: entryToCloudRow, entryResourcesToCloud,
                  goalToCloudRow, goalMilestonesToCloud,
                  achievementToCloudRow
   Cloud → Local: cloudToEntry, cloudToGoal, cloudToAchievement

   LocalStorage helpers: cloud profile UUID per (localProfileId, accountId)
                         + per-profile sync watermark (ISO timestamp).
   ================================================================ */

/* ==== Entry mappers ============================================= */

// Produce the row that goes into the `entries` Supabase table.
export function entryToCloudRow(entry, profileId, accountId) {
  return {
    id:               entry.id,
    profile_id:       profileId,
    account_id:       accountId,
    date:             entry.date,
    topic:            entry.topic           || '',
    category:         entry.category        || '',
    duration_minutes: Number(entry.durationMinutes) || 0,
    difficulty:       entry.difficulty      || 'medium',
    mood_score:       entry.moodScore != null ? Number(entry.moodScore) : null,
    notes:            entry.notes           || '',
    tags:             Array.isArray(entry.tags) ? entry.tags : [],
    created_at_ms:    entry.createdAt       || null,
    updated_at:       entry.updatedAt
                        ? new Date(entry.updatedAt).toISOString()
                        : new Date().toISOString(),
    deleted_at:       null,
  };
}

// Produce the rows that go into the `entry_resources` table for one entry.
export function entryResourcesToCloud(entry, accountId) {
  return (entry.resources || []).map((r, i) => ({
    entry_id:   entry.id,
    account_id: accountId,
    type:       'link',
    title:      r.label || '',
    url:        r.url   || '',
    sort_order: i,
  }));
}

// Convert a Supabase `entries` row (with optional nested `entry_resources`) back to local shape.
export function cloudToEntry(row) {
  return {
    id:              row.id,
    date:            row.date,
    topic:           row.topic            || '',
    category:        row.category         || '',
    durationMinutes: row.duration_minutes || 0,
    difficulty:      row.difficulty       || 'medium',
    moodScore:       row.mood_score       ?? null,
    notes:           row.notes            || '',
    tags:            Array.isArray(row.tags) ? row.tags : [],
    resources:       (row.entry_resources || [])
                       .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                       .map(r => ({ label: r.title || '', url: r.url || '' })),
    createdAt:       row.created_at_ms    || null,
    updatedAt:       row.updated_at ? new Date(row.updated_at).getTime() : null,
    goalIds:         [],   // computed locally by migrateGoalLinks; not stored in cloud
  };
}

/* ==== Goal mappers ============================================== */

// Produce the row that goes into the `goals` Supabase table.
export function goalToCloudRow(goal, profileId, accountId) {
  return {
    id:                goal.id,
    profile_id:        profileId,
    account_id:        accountId,
    title:             goal.title       || '',
    type:              goal.type        || 'time',
    category:          goal.category    || '',
    priority:          goal.priority    || 'medium',
    start_date:        goal.startDate   || null,
    target_date:       goal.targetDate  || null,
    description:       goal.description || '',
    status:            goal.status      || 'active',
    target_minutes:    goal.targetMinutes  != null ? Number(goal.targetMinutes)  : null,
    target_count:      goal.targetCount    != null ? Number(goal.targetCount)    : null,
    current_count:     goal.currentCount   != null ? Number(goal.currentCount)   : 0,
    unit:              goal.unit           || null,
    progress_snapshot: goal.progressSnapshot || null,
    created_at_ms:     goal.createdAt       || null,
    completed_at:      goal.completedAt
                         ? new Date(goal.completedAt).toISOString()
                         : null,
    updated_at:        goal.updatedAt
                         ? new Date(goal.updatedAt).toISOString()
                         : new Date().toISOString(),
    deleted_at:        null,
  };
}

// Produce the rows that go into `goal_milestones` for one goal.
export function goalMilestonesToCloud(goal, accountId) {
  return (goal.milestones || []).map((ms, i) => ({
    id:         ms.id,
    goal_id:    goal.id,
    account_id: accountId,
    label:      ms.label  || '',
    done:       !!ms.done,
    sort_order: i,
  }));
}

// Convert a Supabase `goals` row (with optional nested `goal_milestones`) back to local shape.
export function cloudToGoal(row) {
  return {
    id:               row.id,
    title:            row.title       || '',
    type:             row.type        || 'time',
    category:         row.category    || '',
    priority:         row.priority    || 'medium',
    startDate:        row.start_date  || null,
    targetDate:       row.target_date || null,
    description:      row.description || '',
    status:           row.status      || 'active',
    targetMinutes:    row.target_minutes  ?? null,
    targetCount:      row.target_count    ?? null,
    currentCount:     row.current_count   ?? 0,
    unit:             row.unit            || null,
    progressSnapshot: row.progress_snapshot || null,
    createdAt:        row.created_at_ms   || null,
    completedAt:      row.completed_at ? new Date(row.completed_at).getTime() : null,
    updatedAt:        row.updated_at ? new Date(row.updated_at).getTime() : null,
    milestones:       (row.goal_milestones || [])
                        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                        .map(ms => ({ id: ms.id, label: ms.label || '', done: !!ms.done })),
  };
}

/* ==== Achievement mappers ======================================= */

// Produce the row that goes into the `achievements` Supabase table.
export function achievementToCloudRow(ach, profileId, accountId) {
  return {
    profile_id:     profileId,
    account_id:     accountId,
    achievement_id: ach.id,
    earned_at:      ach.earnedAt
                      ? new Date(ach.earnedAt).toISOString()
                      : new Date().toISOString(),
  };
}

// Convert a Supabase `achievements` row back to local shape.
export function cloudToAchievement(row) {
  return {
    id:       row.achievement_id,
    earnedAt: row.earned_at ? new Date(row.earned_at).getTime() : Date.now(),
  };
}

/* ==== Pref mappers ============================================== */

// Produce the row that goes into the `profile_prefs` Supabase table.
export function prefToCloudRow(pref, profileId, accountId) {
  return {
    profile_id: profileId,
    account_id: accountId,
    key:        pref.key,
    value:      pref.value,
    updated_at: pref.updatedAt
                  ? new Date(pref.updatedAt).toISOString()
                  : new Date().toISOString(),
  };
}

// Convert a `profile_prefs` row back to a local { key, value } pair.
export function cloudToPref(row) {
  return { key: row.key, value: row.value };
}

/* ==== LocalStorage helpers ====================================== */

// Cloud profile UUID (from the `profiles` table) mapped to a local profile ID + account.
// Written by the migration utility (Phase 5) when it creates/finds the cloud profile row.
export function getCloudProfileId(localProfileId, accountId) {
  if (!localProfileId || !accountId) return null;
  return localStorage.getItem(`lt_cloud_pid_${localProfileId}_${accountId}`) || null;
}

export function setCloudProfileId(localProfileId, accountId, cloudProfileId) {
  if (!localProfileId || !accountId) return;
  localStorage.setItem(`lt_cloud_pid_${localProfileId}_${accountId}`, cloudProfileId);
}

// Per-profile sync watermark: the ISO timestamp of our last successful pull.
// We query Supabase for records with updated_at > watermark on every pull.
export function getSyncWatermark(localProfileId, accountId) {
  if (!localProfileId || !accountId) return null;
  return localStorage.getItem(`lt_sync_wm_${localProfileId}_${accountId}`) || null;
}

export function setSyncWatermark(localProfileId, accountId, isoTimestamp) {
  if (!localProfileId || !accountId) return;
  localStorage.setItem(`lt_sync_wm_${localProfileId}_${accountId}`, isoTimestamp);
}
