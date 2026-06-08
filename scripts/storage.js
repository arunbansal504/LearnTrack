/* ===================================================
   LEARNTRACK — STORAGE ENGINE
   IndexedDB (primary) with localStorage fallback.
   Exposes a unified async API used by all modules.
   =================================================== */

'use strict';

const Storage = (() => {

  let _dbName      = 'LearnTrackDB';
  const DB_VERSION = 5;
  let _lsPrefix    = 'lt_';
  const STORES = {
    entries:        'entries',
    achievements:   'achievements',
    preferences:    'preferences',
    notes:          'notes',
    backupLog:      'backupLog',
    deletedEntries: 'deletedEntries',
    goals:          'goals',
    deletedGoals:   'deletedGoals',
    outbox:         'outbox',   // pending cloud sync mutations
  };

  let _db = null;
  let _useLocalStorage = false;
  let _mutationHook = null; // set by sync-engine so it can react to local writes

  // Prefs that are purely device-local and must never be pushed to the cloud.
  // categoryColors is synced via the `categories` table (color column), not profile_prefs.
  const PREF_NO_SYNC = new Set(['lastBackupDate', 'categoryColors']);

  /* ---- Outbox: enqueue a pending cloud-sync op ------ */
  // Each op: { op, kind, recordId, payload, queuedAt }
  // id is auto-assigned by IndexedDB (autoIncrement). Fire-and-forget; failures are non-fatal.
  function enqueueOutboxOp(op) {
    if (_useLocalStorage || !_db) return;
    idbPut(STORES.outbox, { op: op.op, kind: op.kind, recordId: op.recordId, payload: op.payload || null, queuedAt: Date.now() }).catch(() => {});
    if (_mutationHook) try { _mutationHook(); } catch { /* ignore */ }
  }

  /* ---- IndexedDB Init -------------------------------- */

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(_dbName, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains(STORES.entries)) {
          const store = db.createObjectStore(STORES.entries, { keyPath: 'id' });
          store.createIndex('date',     'date',     { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('topic',    'topic',    { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.achievements)) {
          db.createObjectStore(STORES.achievements, { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains(STORES.preferences)) {
          db.createObjectStore(STORES.preferences, { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains(STORES.notes)) {
          db.createObjectStore(STORES.notes, { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains(STORES.backupLog)) {
          db.createObjectStore(STORES.backupLog, { keyPath: 'id', autoIncrement: true });
        }

        if (!db.objectStoreNames.contains(STORES.deletedEntries)) {
          const ds = db.createObjectStore(STORES.deletedEntries, { keyPath: 'id' });
          ds.createIndex('deletedAt', 'deletedAt');
        }

        if (!db.objectStoreNames.contains(STORES.goals)) {
          const gs = db.createObjectStore(STORES.goals, { keyPath: 'id' });
          gs.createIndex('targetDate', 'targetDate', { unique: false });
          gs.createIndex('status',     'status',     { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.deletedGoals)) {
          const dgs = db.createObjectStore(STORES.deletedGoals, { keyPath: 'id' });
          dgs.createIndex('deletedAt', 'deletedAt');
        }

        if (!db.objectStoreNames.contains(STORES.outbox)) {
          // autoIncrement: engine reads all + deletes by auto-assigned integer id
          db.createObjectStore(STORES.outbox, { keyPath: 'id', autoIncrement: true });
        }
      };

      req.onsuccess  = (e) => resolve(e.target.result);
      req.onerror    = (e) => reject(e.target.error);
      req.onblocked  = ()  => reject(new Error('IndexedDB blocked'));
    });
  }

  async function init(userId = null) {
    const uid = userId || 'default';
    // 'default' maps to the original DB for backwards compatibility
    _dbName   = uid === 'default' ? 'LearnTrackDB' : `LearnTrackDB_${uid}`;
    _lsPrefix = uid === 'default' ? 'lt_' : `lt_${uid}_`;
    if (_db) { _db.close(); _db = null; }
    try {
      _db = await openDB();
      _useLocalStorage = false;
    } catch (err) {
      console.warn('[Storage] IndexedDB unavailable, falling back to localStorage', err);
      _useLocalStorage = true;
    }
  }

  /* ---- Generic IDB helpers --------------------------- */

  function tx(storeName, mode = 'readonly') {
    return _db.transaction(storeName, mode).objectStore(storeName);
  }

  function idbGet(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = tx(storeName).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => reject(req.error);
    });
  }

  function idbGetAll(storeName) {
    return new Promise((resolve, reject) => {
      const req = tx(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  function idbPut(storeName, value) {
    return new Promise((resolve, reject) => {
      const req = tx(storeName, 'readwrite').put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  function idbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = tx(storeName, 'readwrite').delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  function idbClear(storeName) {
    return new Promise((resolve, reject) => {
      const req = tx(storeName, 'readwrite').clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  /* ---- localStorage fallback helpers ----------------- */

  function lsKey(store, key) {
    return `${_lsPrefix}${store}_${key}`;
  }

  function lsGetAll(storeName) {
    const prefix = `${_lsPrefix}${storeName}_`;
    const result = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        try { result.push(JSON.parse(localStorage.getItem(k))); } catch {}
      }
    }
    return result;
  }

  function lsPut(storeName, value) {
    const key = value.key ?? value.id;
    localStorage.setItem(lsKey(storeName, key), JSON.stringify(value));
    return key;
  }

  function lsGet(storeName, key) {
    const item = localStorage.getItem(lsKey(storeName, key));
    return item ? JSON.parse(item) : null;
  }

  function lsDelete(storeName, key) {
    localStorage.removeItem(lsKey(storeName, key));
  }

  function lsClear(storeName) {
    const prefix = `${_lsPrefix}${storeName}_`;
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  }

  /* ---- Unified async API ----------------------------- */

  async function getAll(storeName) {
    if (_useLocalStorage) return lsGetAll(storeName);
    return idbGetAll(storeName);
  }

  async function get(storeName, key) {
    if (_useLocalStorage) return lsGet(storeName, key);
    return idbGet(storeName, key);
  }

  async function put(storeName, value) {
    if (_useLocalStorage) return lsPut(storeName, value);
    return idbPut(storeName, value);
  }

  async function remove(storeName, key) {
    if (_useLocalStorage) { lsDelete(storeName, key); return; }
    return idbDelete(storeName, key);
  }

  async function clearStore(storeName) {
    if (_useLocalStorage) { lsClear(storeName); return; }
    return idbClear(storeName);
  }

  /* ---- Preference helpers ---------------------------- */

  async function getPref(key, defaultValue = null) {
    const record = await get(STORES.preferences, key);
    return record ? record.value : defaultValue;
  }

  async function setPref(key, value) {
    await put(STORES.preferences, { key, value });
    if (key === 'categories') {
      enqueueOutboxOp({ op: 'replace-all', kind: 'categories', recordId: 'categories', payload: value });
    } else if (!PREF_NO_SYNC.has(key)) {
      enqueueOutboxOp({ op: 'upsert', kind: 'pref', recordId: key, payload: { key, value, updatedAt: Date.now() } });
    }
  }

  // Saves category names + color map together, syncing both to the `categories`
  // cloud table in one op (avoids two separate outbox entries racing each other).
  async function saveCategories(names, colors) {
    await put(STORES.preferences, { key: 'categories', value: names });
    await put(STORES.preferences, { key: 'categoryColors', value: colors || {} });
    enqueueOutboxOp({ op: 'replace-all', kind: 'categories', recordId: 'categories', payload: { names, colors: colors || {} } });
  }

  async function getAllPrefs() {
    const records = await getAll(STORES.preferences);
    const obj = Object.create(null);
    records.forEach(r => { obj[r.key] = r.value; });
    return obj;
  }

  /* ---- Entry CRUD ------------------------------------ */

  function generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  async function saveEntry(entry) {
    if (!entry.id) {
      entry.id = generateId();
      entry.createdAt = Date.now();
    }
    entry.updatedAt = Date.now();
    await put(STORES.entries, entry);
    enqueueOutboxOp({ op: 'upsert', kind: 'entry', recordId: entry.id, payload: { ...entry } });
    return entry;
  }

  async function getAllEntries() {
    const entries = await getAll(STORES.entries);
    return entries.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  async function getEntry(id) {
    return get(STORES.entries, id);
  }

  async function deleteEntry(id) {
    return remove(STORES.entries, id);
  }

  async function softDeleteEntry(id) {
    const entry = await get(STORES.entries, id);
    if (!entry) return;
    await put(STORES.deletedEntries, { ...entry, deletedAt: Date.now() });
    await remove(STORES.entries, id);
    enqueueOutboxOp({ op: 'soft-delete', kind: 'entry', recordId: id, payload: null });
  }

  async function getDeletedEntries() {
    const entries = await getAll(STORES.deletedEntries);
    return entries.sort((a, b) => b.deletedAt - a.deletedAt);
  }

  async function restoreEntry(id) {
    const entry = await get(STORES.deletedEntries, id);
    if (!entry) return;
    const { deletedAt: _dropped, ...restored } = entry;
    restored.updatedAt = Date.now();
    await put(STORES.entries, restored);
    await remove(STORES.deletedEntries, id);
    enqueueOutboxOp({ op: 'restore', kind: 'entry', recordId: id, payload: { ...restored } });
  }

  async function permanentlyDeleteEntry(id) {
    await remove(STORES.deletedEntries, id);
    enqueueOutboxOp({ op: 'perm-delete', kind: 'entry', recordId: id, payload: null });
  }

  // Soft-deleted entries otherwise live in the recycle bin forever and slowly
  // consume the IndexedDB quota. Permanently drop anything deleted more than
  // maxAgeDays ago. Returns the number of entries purged.
  async function purgeOldDeletedEntries(maxAgeDays = 90) {
    const cutoff  = Date.now() - maxAgeDays * 86400000;
    const entries = await getAll(STORES.deletedEntries);
    const aged    = entries.filter(e => typeof e.deletedAt === 'number' && e.deletedAt < cutoff);
    await Promise.all(aged.map(e => remove(STORES.deletedEntries, e.id)));
    return aged.length;
  }

  /* ---- Achievement CRUD ------------------------------ */

  async function getAchievement(id) {
    return get(STORES.achievements, id);
  }

  async function getAllAchievements() {
    return getAll(STORES.achievements);
  }

  async function saveAchievement(ach) {
    if (!ach.earnedAt) ach.earnedAt = Date.now();
    await put(STORES.achievements, ach);
    enqueueOutboxOp({ op: 'upsert', kind: 'achievement', recordId: ach.id, payload: { ...ach } });
    return ach;
  }

  /* ---- Goal CRUD ------------------------------------- */

  async function saveGoal(goal) {
    if (!goal.id) {
      goal.id = generateId();
      goal.createdAt = Date.now();
    }
    goal.updatedAt = Date.now();
    await put(STORES.goals, goal);
    enqueueOutboxOp({ op: 'upsert', kind: 'goal', recordId: goal.id, payload: { ...goal } });
    return goal;
  }

  async function getAllGoals() {
    const goals = await getAll(STORES.goals);
    return goals.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function getGoal(id) {
    return get(STORES.goals, id);
  }

  async function deleteGoal(id) {
    return remove(STORES.goals, id);
  }

  async function softDeleteGoal(id) {
    const goal = await getGoal(id);
    if (!goal) return;
    // Replace any existing deleted goal with the same title+category
    const titleLower = (goal.title || '').toLowerCase().trim();
    const allDeleted = await getAll(STORES.deletedGoals);
    const duplicate  = allDeleted.find(g =>
      (g.title || '').toLowerCase().trim() === titleLower &&
      (g.category || '') === (goal.category || '')
    );
    if (duplicate) await remove(STORES.deletedGoals, duplicate.id);
    await put(STORES.deletedGoals, { ...goal, deletedAt: Date.now() });
    await remove(STORES.goals, id);
    enqueueOutboxOp({ op: 'soft-delete', kind: 'goal', recordId: id, payload: null });
  }

  async function getDeletedGoals() {
    const goals = await getAll(STORES.deletedGoals);
    return goals.sort((a, b) => b.deletedAt - a.deletedAt);
  }

  async function restoreGoal(id) {
    const goal = await get(STORES.deletedGoals, id);
    if (!goal) return;
    const { deletedAt: _dropped, ...restored } = goal;
    restored.updatedAt = Date.now();
    await put(STORES.goals, restored);
    await remove(STORES.deletedGoals, id);
    enqueueOutboxOp({ op: 'restore', kind: 'goal', recordId: id, payload: { ...restored } });
  }

  async function permanentlyDeleteGoal(id) {
    await remove(STORES.deletedGoals, id);
    enqueueOutboxOp({ op: 'perm-delete', kind: 'goal', recordId: id, payload: null });
  }

  // Mirror purgeOldDeletedEntries for the goals recycle bin: permanently drop
  // any soft-deleted goal deleted more than maxAgeDays ago. Returns the count.
  async function purgeOldDeletedGoals(maxAgeDays = 90) {
    const cutoff = Date.now() - maxAgeDays * 86400000;
    const goals  = await getAll(STORES.deletedGoals);
    const aged   = goals.filter(g => typeof g.deletedAt === 'number' && g.deletedAt < cutoff);
    await Promise.all(aged.map(g => remove(STORES.deletedGoals, g.id)));
    return aged.length;
  }

  /* ---- Backup Log ------------------------------------ */

  async function addBackupLog(entry) {
    const record = { ...entry, id: Date.now() };
    await put(STORES.backupLog, record);
    const all  = await getAll(STORES.backupLog);
    const aged = all.sort((a, b) => b.id - a.id).slice(5);
    await Promise.all(aged.map(old => remove(STORES.backupLog, old.id)));
  }

  async function getBackupLog() {
    const logs = await getAll(STORES.backupLog);
    return logs.sort((a, b) => b.id - a.id).slice(0, 5);
  }

  async function clearBackupLog() {
    return clearStore(STORES.backupLog);
  }

  /* ---- Full Export ----------------------------------- */

  async function exportAll() {
    const [entries, deletedEntries, achievements, prefs, goals, deletedGoals] = await Promise.all([
      getAllEntries(),
      getDeletedEntries(),
      getAllAchievements(),
      getAllPrefs(),
      getAllGoals(),
      getDeletedGoals(),
    ]);

    return {
      version:    '2.0',
      exportedAt: Date.now(),
      appName:    'LearnTrack',
      data: {
        entries,
        deletedEntries,
        achievements,
        preferences: prefs,
        goals,
        deletedGoals,
      },
    };
  }

  /* ---- Full Import (merge) --------------------------- */

  // Imported JSON is untrusted — a hand-edited or corrupt file can carry entries with a
  // missing id, a malformed date, or a non-numeric duration. Returning a normalized entry
  // (or null to drop it) keeps bad data out of the in-memory array, where it would otherwise
  // break analytics (e.g. string concatenation in duration sums).
  const _VALID_DIFFICULTY = new Set(['easy', 'medium', 'hard']);
  function _sanitizeEntry(e) {
    if (!e || typeof e !== 'object') return null;
    if (typeof e.id !== 'string' || !e.id) return null;
    if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;

    const duration = Number(e.durationMinutes);
    const mood     = Number(e.moodScore);
    return {
      ...e,
      durationMinutes: Number.isFinite(duration) && duration >= 0 ? duration : 0,
      moodScore:       Number.isFinite(mood) ? Math.min(5, Math.max(1, Math.round(mood))) : 3,
      difficulty:      _VALID_DIFFICULTY.has(e.difficulty) ? e.difficulty : 'medium',
    };
  }

  // Cross-device deletion reconcile (pure, unit-tested):
  // After a snapshot merge, a record that was soft-deleted on another device arrives in the
  // deletedEntries/deletedGoals list, but importAll only ever ADDS/UPDATES — it never removes
  // from the live store, so the live copy would linger as a ghost. Return the ids that should
  // be removed from the live store: those present in both, where the deletion is at least as
  // recent as the live record's last edit (so a record that was RESTORED/edited more recently
  // than it was deleted is left intact — newest action wins).
  function reconcileDeletedIds(liveRecords, deletedRecords) {
    const liveById = new Map((liveRecords || []).map(r => [r.id, r]));
    const toRemove = [];
    for (const d of (deletedRecords || [])) {
      const live = liveById.get(d.id);
      if (!live) continue;
      const delTs  = Number(d.deletedAt) || 0;
      const liveTs = Number(live.updatedAt) || Number(live.createdAt) || 0;
      if (delTs >= liveTs) toRemove.push(d.id);
    }
    return toRemove;
  }

  async function importAll(backup) {
    if (!backup || backup.appName !== 'LearnTrack' || !backup.data) {
      throw new Error('Invalid backup file format');
    }

    const { entries = [], deletedEntries = [], achievements = [], preferences = {}, goals = [], deletedGoals: importedDeletedGoals = [] } = backup.data;
    if (!Array.isArray(entries) || !Array.isArray(deletedEntries) || !Array.isArray(achievements) || !Array.isArray(goals)) {
      throw new Error('Invalid backup file format');
    }
    let imported = 0, skipped = 0, updated = 0;

    // Merge entries: keep newest updatedAt. Records that win the merge are
    // enqueued to the outbox so a local restore propagates to the cloud
    // (last-write-wins is safe — on sign-in the cloud was pulled before this
    // import, so a winning record is by definition newer than the cloud row).
    for (const raw of entries) {
      const incoming = _sanitizeEntry(raw);
      if (!incoming) { skipped++; continue; }
      const existing = await getEntry(incoming.id);
      if (!existing) {
        await put(STORES.entries, incoming);
        enqueueOutboxOp({ op: 'upsert', kind: 'entry', recordId: incoming.id, payload: { ...incoming } });
        imported++;
      } else {
        const incomingTs = incoming.updatedAt || incoming.createdAt || 0;
        const existingTs = existing.updatedAt  || existing.createdAt  || 0;
        if (incomingTs > existingTs) {
          await put(STORES.entries, incoming);
          enqueueOutboxOp({ op: 'upsert', kind: 'entry', recordId: incoming.id, payload: { ...incoming } });
          updated++;
        } else {
          skipped++;
        }
      }
    }

    // Merge deleted entries
    for (const raw of deletedEntries) {
      const incoming = _sanitizeEntry(raw);
      if (!incoming) continue;
      const existing = await get(STORES.deletedEntries, incoming.id);
      if (!existing) await put(STORES.deletedEntries, incoming);
    }

    // Merge achievements
    for (const ach of achievements) {
      if (!ach.id) continue;
      const existing = await getAchievement(ach.id);
      if (!existing) {
        await put(STORES.achievements, ach);
        enqueueOutboxOp({ op: 'upsert', kind: 'achievement', recordId: ach.id, payload: { ...ach } });
      }
    }

    // Merge preferences: username and goal histories always restore from backup;
    // all other prefs only fill in if not already set.
    const ALWAYS_RESTORE = new Set(['username', 'goalHistory', 'monthlyGoalHistory']);
    const BLOCKED_PREF_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    let prefsRestored = 0;
    for (const [key, value] of Object.entries(preferences)) {
      if (BLOCKED_PREF_KEYS.has(key)) continue;
      const existing = await getPref(key);
      if (ALWAYS_RESTORE.has(key)) {
        await setPref(key, value);
        prefsRestored++;
      } else if (existing === null) {
        await setPref(key, value);
      }
    }

    // Merge goals: keep newest updatedAt (winners enqueued for cloud propagation)
    for (const incoming of goals) {
      if (!incoming.id) continue;
      const existing = await getGoal(incoming.id);
      if (!existing) {
        await put(STORES.goals, incoming);
        enqueueOutboxOp({ op: 'upsert', kind: 'goal', recordId: incoming.id, payload: { ...incoming } });
      } else {
        const incomingTs = incoming.updatedAt || incoming.createdAt || 0;
        const existingTs = existing.updatedAt  || existing.createdAt  || 0;
        if (incomingTs > existingTs) {
          await put(STORES.goals, incoming);
          enqueueOutboxOp({ op: 'upsert', kind: 'goal', recordId: incoming.id, payload: { ...incoming } });
        }
      }
    }

    // Merge deleted goals
    for (const incoming of importedDeletedGoals) {
      if (!incoming.id) continue;
      const existing = await get(STORES.deletedGoals, incoming.id);
      if (!existing) await put(STORES.deletedGoals, incoming);
    }

    // Propagate cross-device deletions: drop live records that another device soft-deleted.
    const [liveEntries, allDeletedEntries] = await Promise.all([getAll(STORES.entries), getAll(STORES.deletedEntries)]);
    for (const id of reconcileDeletedIds(liveEntries, allDeletedEntries)) await remove(STORES.entries, id);
    const [liveGoals, allDeletedGoals] = await Promise.all([getAll(STORES.goals), getAll(STORES.deletedGoals)]);
    for (const id of reconcileDeletedIds(liveGoals, allDeletedGoals)) await remove(STORES.goals, id);

    return { imported, skipped, updated, prefsRestored };
  }

  /* ---- Directory Handle Storage (global, not per-user) -- */
  // Stored in a separate DB so the handle survives profile switching.

  const HANDLES_DB_NAME = 'LearnTrackHandles';
  let _handlesDb = null;

  function openHandlesDB() {
    if (_handlesDb) return Promise.resolve(_handlesDb);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(HANDLES_DB_NAME, 1);
      req.onupgradeneeded = (e) => { e.target.result.createObjectStore('handles'); };
      req.onsuccess  = (e) => { _handlesDb = e.target.result; resolve(_handlesDb); };
      req.onerror    = (e) => reject(e.target.error);
    });
  }

  async function saveDirectoryHandle(handle) {
    const db = await openHandlesDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction('handles', 'readwrite').objectStore('handles').put(handle, 'backupFolder');
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  async function getDirectoryHandle() {
    try {
      const db = await openHandlesDB();
      return new Promise((resolve, reject) => {
        const req = db.transaction('handles').objectStore('handles').get('backupFolder');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror   = () => reject(req.error);
      });
    } catch { return null; }
  }

  /* ---- Outbox public API ----------------------------- */

  async function getAllOutboxOps() {
    if (_useLocalStorage || !_db) return [];
    return idbGetAll(STORES.outbox);
  }

  async function removeOutboxOp(id) {
    if (_useLocalStorage || !_db) return;
    return idbDelete(STORES.outbox, id);
  }

  async function clearOutbox() {
    if (_useLocalStorage || !_db) return;
    return idbClear(STORES.outbox);
  }

  function setMutationHook(fn) {
    _mutationHook = fn;
  }

  /* ---- Reset all data -------------------------------- */

  async function resetAll() {
    await Promise.all([
      clearStore(STORES.entries),
      clearStore(STORES.achievements),
      clearStore(STORES.preferences),
      clearStore(STORES.notes),
      clearStore(STORES.backupLog),
      clearStore(STORES.deletedEntries),
      clearStore(STORES.goals),
      clearStore(STORES.deletedGoals),
    ]);
  }

  /* ---- Public API ------------------------------------ */
  return {
    init,
    close: () => { if (_db) { _db.close(); _db = null; } },
    STORES,
    generateId,
    // Entries
    saveEntry,
    getAllEntries,
    getEntry,
    deleteEntry,
    softDeleteEntry,
    getDeletedEntries,
    restoreEntry,
    permanentlyDeleteEntry,
    purgeOldDeletedEntries,
    // Achievements
    getAchievement,
    getAllAchievements,
    saveAchievement,
    // Goals
    saveGoal,
    getAllGoals,
    getGoal,
    deleteGoal,
    softDeleteGoal,
    getDeletedGoals,
    restoreGoal,
    permanentlyDeleteGoal,
    purgeOldDeletedGoals,
    // Preferences
    getPref,
    setPref,
    saveCategories,
    getAllPrefs,
    // Backup log
    addBackupLog,
    getBackupLog,
    clearBackupLog,
    // Import / Export
    exportAll,
    importAll,
    resetAll,
    // Directory handle persistence
    saveDirectoryHandle,
    getDirectoryHandle,
    // Outbox (cloud sync mutation queue)
    getAllOutboxOps,
    removeOutboxOp,
    clearOutbox,
    setMutationHook,
    // Low-level (for edge cases)
    get,
    put,
    getAll,
    remove,
  };

})();
