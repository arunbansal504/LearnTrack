/* ===================================================
   LEARNTRACK — STORAGE ENGINE
   IndexedDB (primary) with localStorage fallback.
   Exposes a unified async API used by all modules.
   =================================================== */

'use strict';

const Storage = (() => {

  let _dbName      = 'LearnTrackDB';
  const DB_VERSION = 4;
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
  };

  let _db = null;
  let _useLocalStorage = false;

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
  }

  async function getAllPrefs() {
    const records = await getAll(STORES.preferences);
    const obj = {};
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
    return remove(STORES.entries, id);
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
    return remove(STORES.deletedEntries, id);
  }

  async function permanentlyDeleteEntry(id) {
    return remove(STORES.deletedEntries, id);
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
    await put(STORES.deletedGoals, { ...goal, deletedAt: Date.now() });
    return remove(STORES.goals, id);
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
    return remove(STORES.deletedGoals, id);
  }

  async function permanentlyDeleteGoal(id) {
    return remove(STORES.deletedGoals, id);
  }

  /* ---- Backup Log ------------------------------------ */

  async function addBackupLog(entry) {
    const record = { ...entry, id: Date.now() };
    await put(STORES.backupLog, record);
    const all  = await getAll(STORES.backupLog);
    const aged = all.sort((a, b) => b.id - a.id).slice(5);
    for (const old of aged) await remove(STORES.backupLog, old.id);
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

  async function importAll(backup) {
    if (!backup || backup.appName !== 'LearnTrack' || !backup.data) {
      throw new Error('Invalid backup file format');
    }

    const { entries = [], deletedEntries = [], achievements = [], preferences = {}, goals = [], deletedGoals: importedDeletedGoals = [] } = backup.data;
    let imported = 0, skipped = 0, updated = 0;

    // Merge entries: keep newest updatedAt
    for (const incoming of entries) {
      if (!incoming.id) { skipped++; continue; }
      const existing = await getEntry(incoming.id);
      if (!existing) {
        await put(STORES.entries, incoming);
        imported++;
      } else {
        const incomingTs = incoming.updatedAt || incoming.createdAt || 0;
        const existingTs = existing.updatedAt  || existing.createdAt  || 0;
        if (incomingTs > existingTs) {
          await put(STORES.entries, incoming);
          updated++;
        } else {
          skipped++;
        }
      }
    }

    // Merge deleted entries
    for (const incoming of deletedEntries) {
      if (!incoming.id) continue;
      const existing = await get(STORES.deletedEntries, incoming.id);
      if (!existing) await put(STORES.deletedEntries, incoming);
    }

    // Merge achievements
    for (const ach of achievements) {
      if (!ach.id) continue;
      const existing = await getAchievement(ach.id);
      if (!existing) await put(STORES.achievements, ach);
    }

    // Merge preferences: username and goal histories always restore from backup;
    // all other prefs only fill in if not already set.
    const ALWAYS_RESTORE = new Set(['username', 'goalHistory', 'monthlyGoalHistory']);
    let prefsRestored = 0;
    for (const [key, value] of Object.entries(preferences)) {
      const existing = await getPref(key);
      if (ALWAYS_RESTORE.has(key)) {
        await setPref(key, value);
        prefsRestored++;
      } else if (existing === null) {
        await setPref(key, value);
      }
    }

    // Merge goals: keep newest updatedAt
    for (const incoming of goals) {
      if (!incoming.id) continue;
      const existing = await getGoal(incoming.id);
      if (!existing) {
        await put(STORES.goals, incoming);
      } else {
        const incomingTs = incoming.updatedAt || incoming.createdAt || 0;
        const existingTs = existing.updatedAt  || existing.createdAt  || 0;
        if (incomingTs > existingTs) await put(STORES.goals, incoming);
      }
    }

    // Merge deleted goals
    for (const incoming of importedDeletedGoals) {
      if (!incoming.id) continue;
      const existing = await get(STORES.deletedGoals, incoming.id);
      if (!existing) await put(STORES.deletedGoals, incoming);
    }

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
    // Preferences
    getPref,
    setPref,
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
    // Low-level (for edge cases)
    get,
    put,
    getAll,
    remove,
  };

})();
