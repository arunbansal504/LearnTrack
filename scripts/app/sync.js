/* ================================================================
   sync.js — Cloud backup / restore + cross-device sync (Supabase).

   Local-first: IndexedDB stays the source of truth. This module
   pushes/pulls a WHOLE-PROFILE SNAPSHOT (the same blob produced by
   Storage.exportAll / consumed by Storage.importAll) to a per-account
   row in Supabase, reusing the existing newest-wins merge.

   Design notes:
   • The Supabase client is loaded LAZILY (dynamic import from CDN) only
     when actually needed, so the app still boots with no network and
     signed-out users never pay a network/JS cost.
   • All sync metadata (device id, last-synced rev, account binding) is
     kept in localStorage keyed by the active PROFILE — never in prefs —
     so it stays device-local and never pollutes the synced snapshot.
   • "One account = one profile": every push/pull is gated on the active
     profile being bound to the currently signed-in account, so switching
     to an unbound profile behaves as signed-out and cannot leak data.

   Ambient globals (Storage) are read inside functions only, per the
   project's module rules.
   ================================================================ */

import { state, CLOUD_PUSH_DEBOUNCE, DEFAULT_PREFS } from './state.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './sync-config.js';
import { UserManager } from './users.js';
import { checkAchievements } from './achievements.js';
import { renderPage, updateSidebarUser } from './nav.js';
import { applyAccent, applyCompact, applyTheme } from './widgets.js';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const SB_AUTH_STORAGE_KEY = 'lt_sb_auth';      // where supabase-js persists the session
const SNAPSHOT_TABLE = 'learntrack_snapshots';
const APP_VERSION = '1.0';

let _supabase = null;
let _clientPromise = null;

/* ---- Lazy Supabase client -------------------------------------- */

async function getClient() {
  if (_supabase) return _supabase;
  if (!_clientPromise) {
    _clientPromise = (async () => {
      const mod = await import(/* @vite-ignore */ SUPABASE_ESM);
      _supabase = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession:   true,
          autoRefreshToken: true,
          storageKey:       SB_AUTH_STORAGE_KEY,
        },
      });
      return _supabase;
    })().catch(err => { _clientPromise = null; throw err; });
  }
  return _clientPromise;
}

/* ---- Device-local, per-profile metadata ------------------------ */

function profileId() {
  return UserManager.getActiveId() || 'default';
}
function pkey(suffix) {
  return `lt_${suffix}_${profileId()}`;
}

function getDeviceId() {
  let id = localStorage.getItem('lt_device_id');
  if (!id) {
    id = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem('lt_device_id', id);
  }
  return id;
}

function getBoundAccount() { return localStorage.getItem(pkey('sync_account')); }
function setBoundAccount(uid) {
  if (uid) localStorage.setItem(pkey('sync_account'), uid);
  else     localStorage.removeItem(pkey('sync_account'));
}

function getLastSyncedRev() { return parseInt(localStorage.getItem(pkey('sync_rev')) || '0', 10); }
function setLastSynced(rev) {
  localStorage.setItem(pkey('sync_rev'), String(rev));
  state.lastCloudSync = Date.now();
  localStorage.setItem(pkey('sync_at'), String(state.lastCloudSync));
}

/* ---- Status + change notification ------------------------------ */

function setStatus(status) {
  state.syncStatus = status;
  emitChange();
}
function emitChange() {
  document.dispatchEvent(new CustomEvent('lt-sync-changed'));
}

export function getStatus()       { return state.syncStatus; }
export function getAccountEmail() { return state.syncSession?.user?.email || null; }
export function getLastCloudSync() {
  return state.lastCloudSync || parseInt(localStorage.getItem(pkey('sync_at')) || '0', 10);
}
export function isSignedIn() { return !!state.syncSession; }

// The active profile is bound to the currently signed-in account.
function isBound() {
  return !!state.syncSession && getBoundAccount() === state.syncSession.user.id;
}
// Safe to push/pull right now?
function canSync() {
  return isConfigured() && navigator.onLine && isBound();
}
export { canSync, isBound, isConfigured };

/* ---- Snapshot push / pull -------------------------------------- */

// Build the snapshot blob, embedding live in-memory prefs so defaults that were
// never explicitly persisted are still captured (mirrors backupCurrentProfile).
async function buildSnapshot() {
  const backup = await Storage.exportAll();
  const { lastBackupDate: _drop, compact: _compact, ...exportedPrefs } = backup.data.preferences;
  backup.data.preferences = {
    ...exportedPrefs,
    username:           state.prefs.username,
    dailyGoalMin:       state.prefs.dailyGoalMin,
    monthlyGoalHr:      state.prefs.monthlyGoalHr,
    goalHistory:        state.prefs.goalHistory || [],
    monthlyGoalHistory: state.prefs.monthlyGoalHistory || [],
  };
  return backup;
}

export async function pushSnapshot() {
  if (!canSync()) return { pushed: false };
  const sb   = await getClient();
  const blob = await buildSnapshot();
  const rev  = Date.now();
  const { error } = await sb.from(SNAPSHOT_TABLE).upsert({
    user_id:     state.syncSession.user.id,
    data:        blob,
    rev,
    device_id:   getDeviceId(),
    app_version: APP_VERSION,
    updated_at:  new Date().toISOString(),
  });
  if (error) throw error;
  setLastSynced(rev);
  return { pushed: true };
}

// Pull the cloud snapshot and merge it locally if it is newer than what we last
// synced and was written by a different device. `force` ignores those checks
// (used for sign-in convergence and the manual "Restore from cloud" action).
export async function pullSnapshot({ force = false } = {}) {
  if (!canSync()) return { applied: false };
  const sb = await getClient();
  const { data, error } = await sb
    .from(SNAPSHOT_TABLE)
    .select('data, rev, device_id')
    .eq('user_id', state.syncSession.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { applied: false };           // nothing in the cloud yet

  const isNewer = (data.rev || 0) > getLastSyncedRev();
  const isOwn   = data.device_id === getDeviceId();
  if (!force && (!isNewer || isOwn)) {
    if (isNewer) setLastSynced(data.rev);          // own write — just advance the marker
    return { applied: false };
  }

  await Storage.importAll(data.data);
  await refreshAfterPull();
  setLastSynced(data.rev || Date.now());
  return { applied: true };
}

// Re-load in-memory state from IndexedDB and re-render after a merge
// (mirrors the refresh block used by settings.js importFile).
async function refreshAfterPull() {
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

/* ---- Debounced auto-push (called from triggerAutoBackup) -------- */

export function queueCloudPush() {
  if (!canSync()) return;
  clearTimeout(state.cloudPushTimer);
  state.cloudPushTimer = setTimeout(() => {
    setStatus('syncing');
    pushSnapshot()
      .then(() => setStatus('synced'))
      .catch(err => { console.warn('[Sync] auto-push failed:', err); setStatus('error'); });
  }, CLOUD_PUSH_DEBOUNCE);
}

/* ---- Auth ------------------------------------------------------- */

export async function signUp(email, password) {
  const sb = await getClient();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  // With email confirmation on there is no session yet — caller shows a "check your email" message.
  // With confirmation off a session arrives immediately; bind the account but do NOT pull — the
  // caller is a brand-new account so there is no cloud data to pull, and the settings.js flow
  // will push after this returns.
  if (data.session) {
    state.syncSession = data.session;
    setBoundAccount(data.session.user.id);
  }
  emitChange();
  return data;
}

// Authenticate only — does NOT pull from cloud. Call peekCloudSnapshot() then
// syncAfterSignIn() / pushOnlyAfterSignIn() after showing the user a confirmation.
export async function signIn(email, password) {
  const sb = await getClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  state.syncSession = data.session;
  setBoundAccount(data.session.user.id);
  emitChange();
  return data;
}

export async function signOut() {
  try { const sb = await getClient(); await sb.auth.signOut(); } catch { /* ignore */ }
  state.syncSession = null;
  setStatus(isConfigured() ? 'signed-out' : 'disabled');
}

// Fetch cloud snapshot metadata without importing it.
// Returns { updatedAt, rev } if a snapshot exists, null otherwise.
export async function peekCloudSnapshot() {
  if (!canSync()) return null;
  try {
    const sb = await getClient();
    const { data, error } = await sb
      .from(SNAPSHOT_TABLE)
      .select('rev, updated_at')
      .eq('user_id', state.syncSession.user.id)
      .maybeSingle();
    if (error || !data) return null;
    return { updatedAt: data.updated_at, rev: data.rev };
  } catch { return null; }
}

// Pull cloud → local, then push local → cloud. Call after the user confirms the sync dialog.
export async function syncAfterSignIn() {
  setStatus('syncing');
  try {
    await pullSnapshot({ force: true });
    await pushSnapshot();
    setStatus('synced');
  } catch (err) {
    console.warn('[Sync] sign-in sync failed:', err);
    setStatus('error');
  }
  emitChange();
}

// Push local → cloud only (user declined the pull on sign-in).
export async function pushOnlyAfterSignIn() {
  if (!canSync()) { setStatus(isConfigured() ? 'signed-out' : 'disabled'); emitChange(); return; }
  setStatus('syncing');
  try {
    await pushSnapshot();
    setStatus('synced');
  } catch (err) {
    console.warn('[Sync] push-only failed:', err);
    setStatus('error');
  }
  emitChange();
}

/* ---- Boot ------------------------------------------------------- */

// Cheap check for a persisted session WITHOUT loading supabase-js, so signed-out
// (and offline) users never trigger the dynamic import on boot.
function hasStoredSession() {
  try { return !!localStorage.getItem(SB_AUTH_STORAGE_KEY); } catch { return false; }
}

// Detect Supabase auth tokens arriving in the URL after an email confirmation or
// magic-link click. Implicit flow puts them in the hash; PKCE puts a code in query params.
function hasAuthParamsInUrl() {
  try {
    const hash   = window.location.hash;
    const search = window.location.search;
    return (
      hash.includes('access_token=') ||
      hash.includes('error=') ||
      new URLSearchParams(search).has('code') ||
      new URLSearchParams(search).has('error')
    );
  } catch { return false; }
}

// After handling an auth callback, remove the tokens from the URL so they
// aren't re-processed on refresh or shared accidentally.
function cleanCallbackUrl() {
  try {
    const clean = window.location.pathname.replace(/\/auth\/callback\/?$/, '') || '/';
    history.replaceState(null, '', clean || '/');
  } catch { /* non-fatal */ }
}

let _connectivityWired = false;
function wireConnectivity() {
  if (_connectivityWired) return;
  _connectivityWired = true;
  // Flush a push when we come back online; reflect offline state in the UI.
  window.addEventListener('online',  () => { if (isBound()) queueCloudPush(); });
  window.addEventListener('offline', () => { if (isConfigured()) setStatus('offline'); });
}

export async function initSync() {
  wireConnectivity();
  if (!isConfigured()) { setStatus('disabled'); return; }

  const isCallback = hasAuthParamsInUrl();

  // Skip loading the Supabase client entirely for users who are neither signed in
  // nor arriving from an email confirmation link — the common cold-start case.
  if (!hasStoredSession() && !isCallback) { setStatus('signed-out'); return; }
  if (!navigator.onLine && !isCallback)   { setStatus('offline');    return; }

  try {
    const sb = await getClient();

    // getSession() handles both implicit-flow (hash tokens) and PKCE (code exchange)
    // automatically when detectSessionInUrl is true (the default).
    const { data: { session } } = await sb.auth.getSession();
    state.syncSession = session || null;

    if (isCallback) {
      cleanCallbackUrl();
      // Navigate to the dashboard regardless of whether sign-in succeeded, so the
      // user lands in the app rather than staring at a blank /auth/callback URL.
      // Import is lazy to avoid a circular dep at module parse time.
      import('./nav.js').then(({ navigateTo }) => navigateTo('dashboard')).catch(() => {});
    }

    sb.auth.onAuthStateChange((_event, s) => {
      state.syncSession = s || null;
      if (!s) setStatus(isConfigured() ? 'signed-out' : 'disabled');
      emitChange();
    });

    if (canSync()) {
      setStatus('syncing');
      await pullSnapshot({ force: true });
      await pushSnapshot();
      setStatus('synced');
    } else {
      setStatus('signed-out');
    }
  } catch (err) {
    console.warn('[Sync] init failed:', err);
    setStatus('error');
  }
  emitChange();
}
