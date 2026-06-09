/* ================================================================
   sync.js — Cloud backup / restore + cross-device sync (Supabase).

   Local-first: IndexedDB stays the source of truth. This module
   manages auth, device metadata, and push/pull coordination. All
   actual data transfer goes through the normalized tables via
   sync-engine.js (entries, goals, achievements, profile_prefs).

   Design notes:
   • The Supabase client is loaded LAZILY (dynamic import from CDN) only
     when actually needed, so the app still boots with no network and
     signed-out users never pay a network/JS cost.
   • All sync metadata (device id, last-synced rev, account binding) is
     kept in localStorage keyed by the active PROFILE — never in prefs —
     so it stays device-local and never pollutes synced data.
   • "One account = one profile": every push/pull is gated on the active
     profile being bound to the currently signed-in account, so switching
     to an unbound profile behaves as signed-out and cannot leak data.
   • pullSnapshot delegates to sync-engine.pullDeltas; pushSnapshot writes
     only metadata (rev, device_id, profile_username) to learntrack_snapshots.

   Ambient globals (Storage) are read inside functions only, per the
   project's module rules.
   ================================================================ */

import { state, CLOUD_PUSH_DEBOUNCE } from './state.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './sync-config.js';
import { UserManager, loadCloudProfiles } from './users.js';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const SB_AUTH_STORAGE_KEY = 'lt_sb_auth';      // where supabase-js persists the session
const SNAPSHOT_TABLE = 'learntrack_snapshots';
const APP_VERSION = '1.0';

let _supabase = null;
let _clientPromise = null;

// Lazy reference to the per-record sync engine — loaded on demand so
// sync-engine.js can import getClient from this file without creating
// a circular-dependency problem at module evaluation time.
let _engine = null;
function getEngine() {
  if (_engine) return Promise.resolve(_engine);
  return import('./sync-engine.js').then(mod => { _engine = mod; return mod; }).catch(() => null);
}

/* ---- Lazy Supabase client -------------------------------------- */

export async function getClient() {
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
export function setSyncStatus(status) { setStatus(status); }
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

export async function ensureManualSyncReady() {
  if (!isConfigured() || !navigator.onLine) return false;
  if (!state.syncSession) {
    const sb = await getClient();
    const { data: { session } } = await sb.auth.getSession();
    state.syncSession = session || null;
  }
  if (!state.syncSession) return false;
  setBoundAccount(state.syncSession.user.id);
  return true;
}

/* ---- Snapshot push / pull -------------------------------------- */


export async function pushSnapshot({ manual = false } = {}) {
  if (manual) {
    if (!await ensureManualSyncReady()) return { pushed: false, reason: 'not-ready' };
  } else if (!canSync() || !state.prefs.cloudAutoBackup) {
    // Local-first: automatic snapshot writes only happen when Auto Cloud Backup
    // is ON. Manual pushes (sign-out backup, "Sync now") still go through above.
    return { pushed: false };
  }
  const sb  = await getClient();
  const rev = Date.now();
  const { error } = await sb.from(SNAPSHOT_TABLE).upsert({
    user_id:          state.syncSession.user.id,
    rev,
    device_id:        getDeviceId(),
    app_version:      APP_VERSION,
    updated_at:       new Date().toISOString(),
    profile_username: state.prefs.username || '',
  });
  if (error) throw error;
  setLastSynced(rev);
  return { pushed: true };
}

// Pull the cloud snapshot and merge it locally if it is newer than what we last
// synced and was written by a different device. `force` ignores those checks
// (used for sign-in convergence and the manual "Restore from cloud" action).
export async function pullSnapshot({ force = false, manual = false } = {}) {
  if (manual) {
    if (!await ensureManualSyncReady()) return { applied: false, reason: 'not-ready' };
  } else if (!canSync()) {
    return { applied: false };
  }
  const engine = await getEngine();
  if (!engine) return { applied: false };
  await engine.pullDeltas({ manual: true, force });
  return { applied: true };
}

/* ---- Debounced auto-push (called from triggerAutoBackup) -------- */

export function queueCloudPush() {
  if (!state.prefs.cloudAutoBackup) return; // local-first: no auto push when OFF
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
// Password auth (signUp / signIn) removed — replaced by OTP + Google OAuth in auth.js.

export async function signOut() {
  try { const sb = await getClient(); await sb.auth.signOut(); } catch { /* ignore */ }
  state.syncSession = null;
  setStatus(isConfigured() ? 'signed-out' : 'disabled');
  getEngine().then(e => e?.stopEngine()).catch(() => {});
}

// Fetch cloud snapshot metadata without importing it.
// Returns { updatedAt, rev, username } if a snapshot exists, null otherwise.
export async function peekCloudSnapshot() {
  if (!await ensureManualSyncReady()) return null;
  try {
    const sb = await getClient();
    const { data, error } = await sb
      .from(SNAPSHOT_TABLE)
      .select('rev, updated_at, profile_username')
      .eq('user_id', state.syncSession.user.id)
      .maybeSingle();
    if (error || !data) return null;
    return { updatedAt: data.updated_at, rev: data.rev, username: data.profile_username || null };
  } catch { return null; }
}

// Pull cloud → local, then push local → cloud. Call after the user confirms the sync dialog.
export async function syncAfterSignIn() {
  setStatus('syncing');
  try {
    const pulled = await pullSnapshot();
    if (pulled.reason !== 'profile-mismatch') await pushSnapshot();
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
    // If a session exists but this profile hasn't been bound to an account yet,
    // auto-bind it so redirects from the landing page produce an expected
    // signed-in state in the Settings → Backup & Restore card.
    try {
      if (state.syncSession && !getBoundAccount()) {
        setBoundAccount(state.syncSession.user.id);
        emitChange();
      }
    } catch (e) { /* non-fatal */ }

    // Load entitlements on boot if signed in so UI reflects the correct tier.
    if (state.syncSession) {
      import('./entitlements.js')
        .then(mod => mod.loadEntitlements())
        .then(() => emitChange())
        .catch(() => {});
    }

    if (isCallback) {
      cleanCallbackUrl();
      // Navigate to the dashboard regardless of whether sign-in succeeded, so the
      // user lands in the app rather than staring at a blank /auth/callback URL.
      // Import is lazy to avoid a circular dep at module parse time.
      import('./nav.js').then(({ navigateTo }) => navigateTo('dashboard')).catch(() => {});
    }

    // On first login to a new device, fetch all cloud profiles and create them locally
    // before the sync engine starts, so data is pulled for the correct profile.
    if (state.syncSession) {
      await loadCloudProfiles(state.syncSession).catch(e =>
        console.warn('[Sync] loadCloudProfiles failed:', e)
      );
    }

    sb.auth.onAuthStateChange(async (_event, s) => {
      state.syncSession = s || null;
      if (s) {
        // Restore cloud profiles on a new device before starting the sync engine.
        await loadCloudProfiles(s).catch(e => console.warn('[Sync] loadCloudProfiles failed:', e));
        try { if (!getBoundAccount()) setBoundAccount(s.user.id); } catch (e) { /* ignore */ }
        getEngine().then(e => e?.startEngine()).catch(() => {});
        // Load entitlements (appearance_options + subscription tier) so
        // UI gating (themes/accents) updates immediately after sign-in.
        import('./entitlements.js')
          .then(mod => mod.loadEntitlements())
          .then(() => emitChange())
          .catch(() => {});
        if (canSync()) {
          setStatus('syncing');
          pullSnapshot()
            .then(result => {
              if (result.reason === 'profile-mismatch') return result;
              return pushSnapshot();
            })
            .then(() => setStatus('synced'))
            .catch(err => {
              console.warn('[Sync] auth state sync failed:', err);
              setStatus('error');
            });
        } else if (!navigator.onLine) {
          setStatus('offline');
        } else {
          setStatus('signed-out');
        }
      } else {
        setStatus(isConfigured() ? 'signed-out' : 'disabled');
        getEngine().then(e => e?.stopEngine()).catch(() => {});
      }
      emitChange();
    });

    if (canSync()) {
      setStatus('syncing');
      const pulled = await pullSnapshot();
      if (pulled.reason !== 'profile-mismatch') await pushSnapshot();
      setStatus('synced');
    } else {
      setStatus('signed-out');
    }

    // Start the per-record sync engine. It's a no-op until Phase 5 migration
    // writes the cloud profile UUID (getCloudProfileId returns null before then).
    getEngine().then(e => e?.startEngine()).catch(() => {});
  } catch (err) {
    console.warn('[Sync] init failed:', err);
    setStatus('error');
  }
  emitChange();
}
