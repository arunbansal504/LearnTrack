/**
 * Sync content-signature — Test Suite
 *
 * Covers the net-change detection that drives the sign-out "back up unsynced
 * changes?" prompt. The signature is a map { recordKey -> contentHash } built
 * from the same *ToCloudRow mappers used to sync; comparing the current map to a
 * reference (last-synced / session-start) one yields the real net changes.
 *
 * NOTE: like tests/academic-goals.test.js, this replicates the pure logic from
 * scripts/app/cloud-repo.js (the project's `jest` script has no ESM transform, so
 * the ES module can't be imported directly). Keep these mirrors in sync with the
 * source if the mappers or signature logic change.
 */

// --- Mirror of the relevant mappers from cloud-repo.js ----------------------
function entryToCloudRow(entry, profileId, accountId) {
  return {
    id: entry.id, profile_id: profileId, account_id: accountId,
    date: entry.date, topic: entry.topic || '', category: entry.category || '',
    duration_minutes: Number(entry.durationMinutes) || 0,
    difficulty: entry.difficulty || 'medium',
    mood_score: entry.moodScore != null ? Number(entry.moodScore) : null,
    notes: entry.notes || '', tags: Array.isArray(entry.tags) ? entry.tags : [],
    created_at_ms: entry.createdAt || null,
    updated_at: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : new Date().toISOString(),
    deleted_at: null,
  };
}
function entryResourcesToCloud(entry, accountId) {
  return (entry.resources || []).map((r, i) => ({
    entry_id: entry.id, account_id: accountId, type: 'link',
    title: r.label || '', url: r.url || '', sort_order: i,
  }));
}
function achievementToCloudRow(ach, profileId, accountId) {
  return {
    profile_id: profileId, account_id: accountId, achievement_id: ach.id,
    earned_at: ach.earnedAt ? new Date(ach.earnedAt).toISOString() : new Date().toISOString(),
  };
}
function categoriesToCloudRows(names, colors, profileId, accountId) {
  return (names || []).map((name, i) => ({
    profile_id: profileId, account_id: accountId, name,
    color: (colors && colors[name]) || null, sort_order: i,
  }));
}
function prefToCloudRow(pref, profileId, accountId) {
  return {
    profile_id: profileId, account_id: accountId, key: pref.key, value: pref.value,
    updated_at: pref.updatedAt ? new Date(pref.updatedAt).toISOString() : new Date().toISOString(),
  };
}

// --- Mirror of the signature logic from cloud-repo.js -----------------------
const SIG_SKIP_PREFS = new Set(['lastBackupDate', 'categoryColors', 'categories']);
const SIG_VOLATILE   = new Set(['updated_at', 'profile_id', 'account_id']);

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj) ?? 'null';
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).filter(k => !SIG_VOLATILE.has(k)).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function hashRow(row) { return hashString(stableStringify(row)); }

function computeSyncSignature(data = {}) {
  const map = {};
  (data.entries || []).forEach(e =>
    map['entry:' + e.id] = hashRow({ row: entryToCloudRow(e, '', ''), res: entryResourcesToCloud(e, '') }));
  (data.deletedEntries || []).forEach(e =>
    map['delEntry:' + e.id] = hashRow({ row: entryToCloudRow(e, '', ''), res: entryResourcesToCloud(e, '') }));
  (data.achievements || []).forEach(a =>
    map['ach:' + a.id] = hashRow(achievementToCloudRow(a, '', '')));
  const prefs = data.preferences || {};
  map['cat:all'] = hashRow(categoriesToCloudRows(prefs.categories || [], prefs.categoryColors || {}, '', ''));
  Object.keys(prefs).forEach(k => {
    if (SIG_SKIP_PREFS.has(k)) return;
    map['pref:' + k] = hashRow(prefToCloudRow({ key: k, value: prefs[k] }, '', ''));
  });
  return map;
}
function diffSignatures(refMap = {}, curMap = {}) {
  const changed = [];
  for (const k of new Set([...Object.keys(refMap), ...Object.keys(curMap)])) {
    if (refMap[k] !== curMap[k]) changed.push(k);
  }
  return changed;
}

// --- Fixtures ---------------------------------------------------------------
const baseEntry = () => ({
  id: 'e1', date: '2026-06-01', topic: 'Algebra', category: 'Math',
  durationMinutes: 30, difficulty: 'medium', moodScore: 4, notes: 'ok',
  resources: [], tags: [], createdAt: 1000, updatedAt: 2000,
});
const basePrefs = () => ({ accent: 'purple', theme: 'dark', categories: ['Math'], categoryColors: { Math: '#fff' } });
const dataset = (over = {}) => ({
  entries: [], deletedEntries: [], achievements: [], goals: [], deletedGoals: [],
  preferences: basePrefs(), ...over,
});

// ---------------------------------------------------------------------------

describe('hashString', () => {
  test('is deterministic and order-independent on objects', () => {
    expect(hashString(stableStringify({ a: 1, b: 2 }))).toBe(hashString(stableStringify({ b: 2, a: 1 })));
  });
});

describe('diffSignatures', () => {
  test('identical datasets produce no changes', () => {
    expect(diffSignatures(computeSyncSignature(dataset()), computeSyncSignature(dataset()))).toEqual([]);
  });

  test('create-then-permanently-delete is net zero (the reported bug)', () => {
    const ref = computeSyncSignature(dataset());                       // before: no entry
    const mid = computeSyncSignature(dataset({ entries: [baseEntry()] })); // after create
    const cur = computeSyncSignature(dataset());                       // after perm-delete: back to none
    expect(diffSignatures(ref, mid).length).toBe(1);  // transient state WAS a change
    expect(diffSignatures(ref, cur)).toEqual([]);     // net effect is zero -> no prompt
  });

  test('edit-then-revert (content same, updatedAt bumped) is net zero', () => {
    const ref = computeSyncSignature(dataset({ entries: [baseEntry()] }));
    const reverted = { ...baseEntry(), updatedAt: 9999 }; // only the volatile timestamp differs
    const cur = computeSyncSignature(dataset({ entries: [reverted] }));
    expect(diffSignatures(ref, cur)).toEqual([]);
  });

  test('a kept content change counts exactly once', () => {
    const ref = computeSyncSignature(dataset({ entries: [baseEntry()] }));
    const edited = { ...baseEntry(), topic: 'Geometry', updatedAt: 9999 };
    const cur = computeSyncSignature(dataset({ entries: [edited] }));
    expect(diffSignatures(ref, cur)).toEqual(['entry:e1']);
  });

  test('soft-delete (entry -> recycle bin) registers as a change', () => {
    const ref = computeSyncSignature(dataset({ entries: [baseEntry()] }));
    const cur = computeSyncSignature(dataset({ deletedEntries: [{ ...baseEntry(), deletedAt: 5000 }] }));
    expect(diffSignatures(ref, cur).sort()).toEqual(['delEntry:e1', 'entry:e1']);
  });

  test('accent changed-then-reverted is net zero; kept change counts', () => {
    const ref = computeSyncSignature(dataset());
    const reverted = computeSyncSignature(dataset({ preferences: { ...basePrefs(), accent: 'purple' } }));
    const kept     = computeSyncSignature(dataset({ preferences: { ...basePrefs(), accent: 'blue' } }));
    expect(diffSignatures(ref, reverted)).toEqual([]);
    expect(diffSignatures(ref, kept)).toEqual(['pref:accent']);
  });

  test('truly device-local pref (lastBackupDate) never counts', () => {
    const ref = computeSyncSignature(dataset());
    const cur = computeSyncSignature(dataset({ preferences: { ...basePrefs(), lastBackupDate: '2026-06-09' } }));
    expect(diffSignatures(ref, cur)).toEqual([]);
  });

  test('category colour change counts via the categories table (cat:all)', () => {
    const ref = computeSyncSignature(dataset());
    const cur = computeSyncSignature(dataset({ preferences: { ...basePrefs(), categoryColors: { Math: '#000' } } }));
    expect(diffSignatures(ref, cur)).toEqual(['cat:all']);
  });
});
