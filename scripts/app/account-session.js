/* ================================================================
   account-session.js — Login / logout lifecycle orchestration.

   Owns the cross-cutting flows that span profiles + cloud + local
   storage, so core.js / sync.js / settings.js stay lean:

   • hydrateAllProfilesFromCloud — on sign-in, pull EVERY profile's
     full dataset into IndexedDB and pick the cloud default profile.
   • clearLocalAccountData       — on sign-out, wipe this account's
     profiles + metadata (local backup folder is preserved).
   • collectUnsyncedChanges      — scan each profile's outbox for
     local edits that never reached the cloud.
   • syncAllProfilesToCloud      — drain every profile's outbox.
   • handleSignOut               — the full sign-out flow, including
     the "you have unsynced changes" warning (always, regardless of
     the Auto Cloud Backup toggle).

   Isolation: `lt_account_owner` records which Supabase account the
   local profile set belongs to. Combined with the always-clear
   logout, a different user can never see a previous user's data.

   Ambient global `Storage` (classic IIFE) is read inside functions
   only, per the project's module rules. sync.js / sync-engine.js /
   auth.js are imported dynamically to avoid evaluation-time cycles.
   ================================================================ */

import { state, DEFAULT_PREFS } from './state.js';
import { UserManager, createCloudProfileRow } from './users.js';
import { showToast, _openModal, _closeModal, escapeHtml } from './utils.js';
import * as Repo from './cloud-repo.js';
import { isTestSession, endTestSession } from './test-accounts.js';

const JUST_LOGGED_IN_KEY = 'lt_just_logged_in';
const ACCOUNT_OWNER_KEY  = 'lt_account_owner';

/* ---- Account-owner marker -------------------------------------- */

export function getAccountOwner() {
  return localStorage.getItem(ACCOUNT_OWNER_KEY) || null;
}
export function setAccountOwner(accountId) {
  if (accountId) localStorage.setItem(ACCOUNT_OWNER_KEY, accountId);
  else           localStorage.removeItem(ACCOUNT_OWNER_KEY);
}

function findLocalIdForCloud(cloudProfileId, accountId) {
  for (const u of UserManager.getUsers()) {
    if (Repo.getCloudProfileId(u.id, accountId) === cloudProfileId) return u.id;
  }
  return null;
}

/* ================================================================
   LOGIN — load all profiles + their data from the cloud (req 1 & 2)
   ================================================================ */

// Returns the local id of the cloud-default profile (or null). The caller
// (core.init) sets it active and renders once. Owns the lt_just_logged_in
// flag lifecycle: clears it only on a successful (or empty-cloud) hydrate,
// leaving it set when offline / unreachable so the next online boot retries.
export async function hydrateAllProfilesFromCloud(session, onProgress) {
  const accountId = session?.user?.id;
  if (!accountId) return UserManager.getActiveId();
  state.syncSession = session;

  // Offline: keep whatever is local, retry on the next online boot.
  if (!navigator.onLine) {
    showToast("You're offline — your cloud data will load when you reconnect.", 'info');
    return UserManager.getActiveId();
  }

  // Fetch the account's cloud profiles. On any failure keep local data,
  // leave the flag set, and let the user continue (possibly offline).
  let cloudProfiles;
  try {
    const { getClient } = await import('./sync.js');
    const sb = await getClient();
    const { data, error } = await sb
      .from('profiles')
      .select('id, name, color, sort_order, is_default, theme, accent, custom_accent_hex')
      .eq('account_id', accountId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    cloudProfiles = data || [];

    // Belt-and-suspenders: ensure this account has a row in public.accounts and
    // public.subscriptions. The DB trigger handle_new_user() normally does this
    // on auth.users INSERT, but has been observed to misfire silently. The INSERT
    // policy on accounts now allows authenticated users to insert their own row,
    // so this upsert self-heals any missed trigger without touching existing rows.
    sb.from('accounts')
      .upsert({ id: accountId, email: session.user.email }, { onConflict: 'id', ignoreDuplicates: true })
      .then(() =>
        sb.from('subscriptions')
          .upsert(
            { account_id: accountId, tier: 'free', status: 'trialing', profile_limit: 1,
              trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() },
            { onConflict: 'account_id', ignoreDuplicates: true }
          )
      )
      .catch(() => { /* non-fatal; trigger covers the normal path */ });

    // Reactivation: a successful sign-in cancels any pending account deletion.
    // Fire-and-forget so it never blocks or fails the hydrate; the RPC no-ops
    // (returns false) when nothing was pending.
    sb.rpc('cancel_account_deletion')
      .then(({ data: wasPending, error: cancelErr }) => {
        if (!cancelErr && wasPending === true) {
          showToast('Welcome back! Your scheduled account deletion has been cancelled.', 'success');
        }
      })
      .catch(() => { /* non-fatal */ });
  } catch (err) {
    console.warn('[AccountSession] hydrate fetch failed:', err?.message || err);
    showToast('Could not reach the cloud — working with local data for now.', 'warning');
    return UserManager.getActiveId();
  }

  // Isolation: leftover profiles from a different account → wipe before restore.
  // (Logout normally already cleared; this is defensive.) Only safe to wipe now
  // that the cloud fetch has succeeded.
  const owner = getAccountOwner();
  if (owner && owner !== accountId) {
    await clearLocalAccountData(owner);
    state.syncSession = session; // clearLocalAccountData nulls it — restore for the pulls below
  }

  // Stash orphan local profiles (no cloud mapping for this account) so they
  // don't appear in the profile page while logged in. Their data is preserved;
  // clearLocalAccountData restores them when the user signs out.
  // This runs BEFORE the empty-cloud check so that even a brand-new account
  // doesn't accidentally inherit locally-created profiles.
  let stashedOrphans = false;
  {
    const allLocalUsers = UserManager.getUsers();
    const orphanUsers   = allLocalUsers.filter(u => !Repo.getCloudProfileId(u.id, accountId));
    if (orphanUsers.length) {
      stashedOrphans = true;
      localStorage.setItem('lt_offline_profiles', JSON.stringify(orphanUsers));
      UserManager.saveUsers(allLocalUsers.filter(u => Repo.getCloudProfileId(u.id, accountId)));
      // If the active profile was just stashed, clear the pointer so core.init
      // picks the right profile from the cloud list (or creates a fresh one).
      const activeId = UserManager.getActiveId();
      if (orphanUsers.some(u => u.id === activeId)) localStorage.removeItem('lt_active_user');
    } else {
      localStorage.removeItem('lt_offline_profiles');
    }
  }

  // Empty cloud → brand-new account with no data yet. Orphans were stashed
  // above so the app starts fresh. Return null so core.init creates a new profile.
  if (!cloudProfiles.length) {
    setAccountOwner(accountId);
    localStorage.removeItem(JUST_LOGGED_IN_KEY);
    return null;
  }

  const total = cloudProfiles.length;
  let   done  = 0;
  let   defaultLocalId = null;

  for (const cp of cloudProfiles) {
    if (onProgress) onProgress(done, total);

    // Reuse an already-mapped local profile, else create one.
    let localId = findLocalIdForCloud(cp.id, accountId);
    if (!localId) {
      // Mirror core.init: when offline/guest profiles were stashed above, 'default'
      // (→ LearnTrackDB) is still owned by a stashed profile's data. Force a fresh
      // timestamp id so this cloud profile opens an empty LearnTrackDB_u<ts> instead
      // of inheriting the stashed orphan's database.
      const u = UserManager.createUser(cp.name, { noDefault: stashedOrphans });
      if (cp.color) {
        const users = UserManager.getUsers();
        const idx   = users.findIndex(x => x.id === u.id);
        if (idx >= 0) { users[idx].color = cp.color; UserManager.saveUsers(users); }
      }
      localId = u.id;
      Repo.setCloudProfileId(localId, accountId, cp.id);
    }
    localStorage.setItem(`lt_sync_account_${localId}`, accountId);

    // Forced full pull into this profile's DB. `silent` skips the per-pull
    // state refresh/render — core.init loads the default profile and renders once.
    UserManager.setActiveId(localId);
    await Storage.init(localId);
    try {
      const Engine = await import('./sync-engine.js');
      await Engine.pullDeltas({ manual: true, force: true, silent: true });
      // Remove stale outbox ops (cloud wrote a newer version, or pref cloud-wins).
      await pruneStaleOutboxAfterPull();
      // Push remaining genuine local-wins only when the user has Auto Cloud Backup
      // enabled. With backup OFF the outbox represents intentionally-local data;
      // draining it here would push entries to the cloud against the user's preference.
      // (The engine's own queueDrain / ticker will pick them up if backup is later enabled.)
      let _backupOn = false;
      try { _backupOn = await Storage.getPref('cloudAutoBackup'); } catch { /* ignore */ }
      if (_backupOn === true) {
        await Engine.drainOutbox({ manual: true });
      }
    } catch (err) {
      console.warn('[AccountSession] pull failed for profile', cp.name, err?.message || err);
    }

    // Seed username from the cloud profile name when profile_prefs has no
    // username entry (profile prefs were never synced to cloud). Uses low-level
    // put so no outbox op is created for this fallback write.
    try {
      const uname = await Storage.getPref('username');
      if (!uname) {
        await Storage.put(Storage.STORES.preferences, { key: 'username', value: cp.name });
      }
    } catch { /* non-fatal */ }

    // Apply a rename that was saved offline (cloud update failed, then sign-out
    // wiped lt_users before connectivity returned). The key survives clearLocalAccountData
    // because it is keyed by cloud UUID, not local profile id.
    const pendingRename = localStorage.getItem(`lt_pending_rename_${cp.id}`);
    if (pendingRename && pendingRename !== cp.name) {
      const _users = UserManager.getUsers();
      const _idx   = _users.findIndex(u => u.id === localId);
      if (_idx >= 0) { _users[_idx].name = pendingRename; UserManager.saveUsers(_users); }
      try {
        const { getClient: _gc } = await import('./sync.js');
        const _sb = await _gc();
        await _sb.from('profiles').update({ name: pendingRename }).eq('id', cp.id);
        localStorage.removeItem(`lt_pending_rename_${cp.id}`);
      } catch { /* leave key; will retry on next hydration */ }
    }

    if (cp.is_default) {
      defaultLocalId = localId;
      localStorage.setItem(`lt_default_profile_${accountId}`, cp.id);
    }

    done++;
    if (onProgress) onProgress(done, total);
  }

  // No explicit default → use the first profile.
  if (!defaultLocalId) {
    const first = UserManager.getUsers()[0];
    if (first) {
      defaultLocalId = first.id;
      const cid = Repo.getCloudProfileId(first.id, accountId);
      if (cid) localStorage.setItem(`lt_default_profile_${accountId}`, cid);
    }
  }

  setAccountOwner(accountId);
  localStorage.removeItem(JUST_LOGGED_IN_KEY);
  return defaultLocalId;
}

/* ================================================================
   LOGOUT — clear this account's data, keep local backup (req 3)
   ================================================================ */

// Wipes the IndexedDB + per-profile metadata for ONLY the profiles linked to
// `accountId` (or the recorded account owner when called with a null id, e.g.
// an expired-session sign-out). Orphan profiles and profiles belonging to any
// other account are left completely untouched — this is highly critical to
// avoid data loss. Preserves the local backup folder handle (LearnTrackHandles
// DB), `lt_backupFolderName`, `lt_backup_skipped`, `lt_device_id`,
// `lt_landing_theme` so the user's local JSON backups stay intact and usable.
// `keepData: true` preserves every linked profile's IndexedDB and cloud bindings
// (no deletion loop) while still restoring stashed orphans, resetting in-memory
// state, and ending the session-owner marker. Used by the offline / failed-push
// sign-out paths so unsynced data survives and re-syncs on the next sign-in.
export async function clearLocalAccountData(accountId, { keepData = false } = {}) {
  // Resolve the account being torn down. Falling back to the recorded owner
  // keeps the null-id sign-out path (session expired) scoped instead of wiping
  // everything in lt_users.
  const owner = accountId || getAccountOwner();

  // Test accounts: never delete browser data. Their profiles stay in lt_users
  // so hydrateAllProfilesFromCloud's orphan-stash logic can hide them while a
  // real account is active and restore them on real-account sign-out. Only
  // reset in-memory state and the session ownership marker.
  if (owner && owner.startsWith('test:')) {
    localStorage.removeItem(ACCOUNT_OWNER_KEY);
    state.entries   = [];
    state.goals     = [];
    state.earnedAch = [];
    state.prefs     = { ...DEFAULT_PREFS };
    state.syncSession = null;
    state.badgeQueue.length = 0;
    state.badgeShowing      = false;
    clearTimeout(state.autoBackupTimer);
    clearTimeout(state.cloudPushTimer);
    try { Storage.close(); } catch { /* ignore */ }
    return;
  }

  // A profile is linked to `owner` if it has a cloud mapping for that account,
  // or it was bound to that account (lt_sync_account_<id>). Either signal alone
  // is sufficient — both are written for every account-owned profile.
  const isLinked = (u) => !!owner && (
    !!Repo.getCloudProfileId(u.id, owner) ||
    localStorage.getItem(`lt_sync_account_${u.id}`) === owner
  );

  const users  = UserManager.getUsers();
  const mine   = users.filter(isLinked);    // owned by this account
  const others = users.filter(u => !isLinked(u)); // orphans / other accounts

  if (!keepData) {
    for (const u of mine) {
      const dbName = u.id === 'default' ? 'LearnTrackDB' : `LearnTrackDB_${u.id}`;
      try { indexedDB.deleteDatabase(dbName); } catch { /* ignore */ }

      // Exact per-profile keys (every key carries the id suffix, so the lt_
      // prefix used by the default profile never collides with device globals).
      ['sync_account', 'sync_rev', 'sync_at', 'last_auto_backup', 'ustats', 'goal_link_migrated']
        .forEach(s => localStorage.removeItem(`lt_${s}_${u.id}`));

      // Pref snapshots used by the sign-out dirty check — clear on sign-out so
      // the next session starts fresh and stale values don't affect comparisons.
      localStorage.removeItem(`lt_boot_pref_snap_${u.id}`);

      if (owner) {
        const cloudPid = Repo.getCloudProfileId(u.id, owner);
        if (cloudPid) localStorage.removeItem(`lt_cloud_pref_snap_${cloudPid}`);
        localStorage.removeItem(`lt_cloud_pid_${u.id}_${owner}`);
        localStorage.removeItem(`lt_sync_wm_${u.id}_${owner}`);
        localStorage.removeItem(`lt_migrated_${u.id}_${owner}`);
      }
    }
  }

  // Rebuild lt_users from the preserved profiles merged with any stash from
  // login (orphans hidden while signed in). Merge (dedupe by id) covers both
  // the happy path (orphans stashed, absent from lt_users) and the failed-stash
  // paths (orphans never stashed, already present in `others`).
  // When keepData is true, `mine` profiles are retained on-device so they must
  // appear in lt_users too — the same account will re-link them on next sign-in.
  const byId = keepData
    ? new Map([...mine, ...others].map(u => [u.id, u]))
    : new Map(others.map(u => [u.id, u]));
  const stashedJson = localStorage.getItem('lt_offline_profiles');
  if (stashedJson) {
    try {
      const stashed = JSON.parse(stashedJson);
      if (Array.isArray(stashed)) {
        for (const u of stashed) { if (u && u.id && !byId.has(u.id)) byId.set(u.id, u); }
      }
    } catch { /* ignore */ }
    localStorage.removeItem('lt_offline_profiles');
  }
  UserManager.saveUsers([...byId.values()]);

  // Only drop the active pointer if it referenced a profile we just deleted
  // (keepData = retained on device, so the pointer stays valid in that case).
  const activeId = UserManager.getActiveId();
  if (!keepData && activeId && mine.some(u => u.id === activeId)) {
    localStorage.removeItem('lt_active_user');
  }

  localStorage.removeItem(ACCOUNT_OWNER_KEY);
  if (owner) localStorage.removeItem(`lt_default_profile_${owner}`);

  // Reset in-memory state so nothing leaks into the next session.
  state.entries   = [];
  state.goals     = [];
  state.earnedAch = [];
  state.prefs     = { ...DEFAULT_PREFS };
  state.syncSession = null;
  state.badgeQueue.length = 0;
  state.badgeShowing      = false;
  clearTimeout(state.autoBackupTimer);
  clearTimeout(state.cloudPushTimer);
  try { Storage.close(); } catch { /* ignore */ }
}

// `keepLocalData: true` ends the auth session but PRESERVES this account's local
// IndexedDB + cloud bindings — used when we couldn't confirm a cloud push (offline,
// or a push that failed). The data syncs on the next sign-in instead of being lost.
async function finalizeSignOut(accountId, { keepLocalData = false } = {}) {
  // Clear the Supabase session key from localStorage immediately. This is
  // offline-safe (no network required) and is the single flag landing.html
  // checks to decide whether to show "Dashboard". Doing this first means the
  // session is gone even if the module imports below fail offline.
  try { localStorage.removeItem('lt_sb_auth'); } catch { /* ignore */ }

  // Best-effort: invalidate the server-side session token and reset in-memory
  // state. Both may fail silently when offline; the local key above already
  // guards the auth gate.
  try { const Auth = await import('./auth.js'); await Auth.signOut(); } catch { /* ignore */ }
  try { const Sync = await import('./sync.js'); Sync.signOut(); }      catch { /* ignore */ }
  try { await clearLocalAccountData(accountId, { keepData: keepLocalData }); }
  catch (err) { console.warn('[AccountSession] clear on sign-out failed:', err?.message || err); }

  if (navigator.onLine) {
    window.location.replace('landing.html');
  } else {
    // Offline: navigation would fail ("page cannot be displayed"). Show an
    // in-page confirmation and redirect automatically when connectivity returns.
    _showSignedOutOfflineScreen();
  }
}

// Covers the viewport with a "signed out" acknowledgement while the user is
// offline. Redirects to landing.html the moment connectivity is restored.
function _showSignedOutOfflineScreen() {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:10000',
    'display:flex', 'align-items:center', 'justify-content:center',
    'flex-direction:column', 'gap:1.25rem', 'padding:2rem',
    'text-align:center', 'background:var(--bg,#fff)',
  ].join(';');
  overlay.innerHTML = `
    <p style="font-size:2.5rem;margin:0" aria-hidden="true">✅</p>
    <h2 style="margin:0;color:var(--text,#111)">You've been signed out</h2>
    <p style="margin:0;color:var(--text-muted,#555);max-width:380px">
      Your data is safe on this device and will sync automatically when you sign back in online.
    </p>
    <p id="_so-waiting" style="margin:0;font-size:.875rem;color:var(--text-muted,#888)">
      Waiting for internet connection…
    </p>
  `;
  document.body.appendChild(overlay);
  window.addEventListener('online', () => {
    const el = document.getElementById('_so-waiting');
    if (el) el.textContent = 'Connection restored — redirecting…';
    setTimeout(() => window.location.replace('landing.html'), 800);
  }, { once: true });
}

/* ================================================================
   ACCOUNT DELETION — soft delete now, server purges after 60 days
   ================================================================ */

// Flags the cloud account for deletion (server sets a 60-day purge date),
// then tears down the local session exactly like sign-out. Signing back in
// within the window auto-cancels the deletion (see hydrateAllProfilesFromCloud).
// Returns true on success. Callers handle their own confirmation UI.
export async function handleAccountDeletion() {
  const accountId = state.syncSession?.user?.id || null;
  if (!accountId) {
    showToast('You need to be signed in to delete your account.', 'warning');
    return false;
  }
  if (!navigator.onLine) {
    showToast('You need an internet connection to delete your account.', 'warning');
    return false;
  }

  try {
    const { getClient } = await import('./sync.js');
    const sb = await getClient();
    const { error } = await sb.rpc('request_account_deletion');
    if (error) throw error;
  } catch (err) {
    console.warn('[AccountSession] account deletion failed:', err?.message || err);
    showToast('Could not delete your account — please try again.', 'error');
    return false;
  }

  showToast('Account scheduled for deletion. Sign back in within 60 days to cancel.', 'warning');
  await finalizeSignOut(accountId);   // sign out + wipe local data + redirect to landing
  return true;
}

/* ================================================================
   PROFILE-STRUCTURE RECONCILE (req 1 — full reconcile on backup)
   ================================================================ */

// Push one local profile's structure (name / color / sort_order / appearance /
// is_default) to the cloud `profiles` row, creating the row first if it doesn't
// exist. The caller must have initialised Storage to this profile (so the
// appearance prefs read here belong to it). Failures are logged, not thrown —
// the surrounding drain decides overall success.
export async function reconcileProfileStructure(localId, accountId) {
  if (!accountId) return;
  const user = UserManager.getUsers().find(u => u.id === localId);
  if (!user) return;

  // Ensure a cloud row exists (backfill bypasses the plan-limit trigger).
  let cloudPid = Repo.getCloudProfileId(localId, accountId);
  if (!cloudPid) {
    try { await createCloudProfileRow(user, { backfill: true }); }
    catch (err) { console.warn('[AccountSession] reconcile create failed:', err?.message || err); }
    cloudPid = Repo.getCloudProfileId(localId, accountId);
  }
  if (!cloudPid) return;

  const { getClient } = await import('./sync.js');
  const sb = await getClient();

  // Read this profile's appearance straight from its prefs store.
  let theme = 'dark', accent = 'purple', customAccentHex = null;
  try {
    theme           = (await Storage.getPref('theme'))           || 'dark';
    accent          = (await Storage.getPref('accent'))          || 'purple';
    customAccentHex = (await Storage.getPref('customAccentHex')) || null;
  } catch { /* defaults */ }
  const sortOrder = UserManager.getUsers().findIndex(u => u.id === localId);

  try {
    await sb.from('profiles').update({
      name: user.name, color: user.color, sort_order: sortOrder,
      theme, accent, custom_accent_hex: customAccentHex,
    }).eq('id', cloudPid).eq('account_id', accountId);
  } catch (err) { console.warn('[AccountSession] reconcile update failed:', err?.message || err); }

  // The current name has now been pushed — clear any pending rename marker.
  localStorage.removeItem(`lt_pending_rename_${cloudPid}`);

  // Resolve a pending default recorded by local id (profile had no cloud row yet).
  if (localStorage.getItem(`lt_pending_default_${accountId}`) === localId) {
    localStorage.setItem(`lt_default_profile_${accountId}`, cloudPid);
    localStorage.removeItem(`lt_pending_default_${accountId}`);
  }
  // Apply is_default if this profile is the cached default.
  if (localStorage.getItem(`lt_default_profile_${accountId}`) === cloudPid) {
    try {
      await sb.from('profiles').update({ is_default: false }).eq('account_id', accountId);
      await sb.from('profiles').update({ is_default: true }).eq('id', cloudPid);
    } catch (err) { console.warn('[AccountSession] reconcile default failed:', err?.message || err); }
  }
}

// Delete cloud profile rows the user removed locally while Auto Cloud Backup was
// OFF (queued in lt_pending_profile_deletes_<accountId>). Clears the queue on
// success; leaves it for the next retry on failure.
export async function flushPendingProfileDeletes(accountId) {
  if (!accountId) return;
  const ids = Repo.getPendingProfileDeletes(accountId);
  if (!ids.length) return;
  try {
    const { getClient } = await import('./sync.js');
    const sb = await getClient();
    const { error } = await sb.from('profiles').delete().in('id', ids).eq('account_id', accountId);
    if (error) throw error;
    Repo.clearPendingProfileDeletes(accountId);
  } catch (err) {
    console.warn('[AccountSession] flushPendingProfileDeletes failed:', err?.message || err);
  }
}

/* ================================================================
   UNSYNCED-CHANGES detection + push (req 1 — sign-out backup)
   ================================================================ */

// Scan every profile for changes that haven't reached the cloud. A profile is
// "dirty" if it has ANY outbox ops (entries/goals/achievements AND prefs, so
// theme/accent/goal edits count), OR it has no cloud row yet (created locally),
// OR a pending rename / default marker is set for it.
export async function collectUnsyncedChanges() {
  const activeId  = UserManager.getActiveId();
  const accountId = state.syncSession?.user?.id || null;
  const dirty = [];
  for (const u of UserManager.getUsers()) {
    try {
      await Storage.init(u.id);
      const ops      = await Storage.getAllOutboxOps();
      const cloudPid = accountId ? Repo.getCloudProfileId(u.id, accountId) : null;
      const noCloudRow     = !cloudPid;
      const pendingRename  = cloudPid  && !!localStorage.getItem(`lt_pending_rename_${cloudPid}`);
      const pendingDefault = accountId && localStorage.getItem(`lt_pending_default_${accountId}`) === u.id;
      // Exclude auto-generated housekeeping ops (categories replace-all from
      // ensureCategoryColors on every boot — not a real user change).
      const userOps    = ops.filter(o => !(o.kind === 'categories' && o.op === 'replace-all'));
      const nonPrefOps = userOps.filter(o => o.kind !== 'pref');
      const prefOps    = userOps.filter(o => o.kind === 'pref');

      // Net-change detection for prefs: compare each op's current value against a
      // known-good snapshot. Prefer the cloud snapshot (saved after each successful
      // drain/pull); fall back to the boot snapshot (saved at session start from IDB)
      // which works even when cloudAutoBackup has never been ON.
      let hasPrefChange = false;
      if (prefOps.length) {
        const cloudSnap = cloudPid
          ? JSON.parse(localStorage.getItem(`lt_cloud_pref_snap_${cloudPid}`) || '{}')
          : {};
        const bootSnap = JSON.parse(localStorage.getItem(`lt_boot_pref_snap_${u.id}`) || '{}');
        // Boot snap covers all keys; cloud snap overrides with last-synced values.
        // Merging means a key absent from cloud (e.g. customAccentHex never synced)
        // still has a reference value from session start.
        const snap = { ...bootSnap, ...cloudSnap };
        console.log('[SignOut] pref snap check', {
          cloudPid,
          cloudSnapKeys: Object.keys(cloudSnap),
          bootSnapKeys:  Object.keys(bootSnap),
          prefOps: prefOps.map(o => ({
            key: o.recordId,
            opVal:   o.payload?.value,
            snapVal: snap[o.recordId],
            match:   JSON.stringify(snap[o.recordId]) === JSON.stringify(o.payload?.value),
          })),
        });
        hasPrefChange = prefOps.some(op =>
          !(op.recordId in snap) ||
          JSON.stringify(snap[op.recordId]) !== JSON.stringify(op.payload?.value)
        );
      }

      const logicalCount = nonPrefOps.length + (hasPrefChange ? 1 : 0);
      const isDirty = logicalCount || noCloudRow || pendingRename || pendingDefault;
      console.log('[SignOut] profile:', u.name, u.id, {
        outboxOps:      ops.map(o => ({ kind: o.kind, op: o.op, recordId: o.recordId })),
        noCloudRow,
        pendingRename:  pendingRename  ? localStorage.getItem(`lt_pending_rename_${cloudPid}`) : false,
        pendingDefault: pendingDefault ? localStorage.getItem(`lt_pending_default_${accountId}`) : false,
        isDirty,
      });
      if (isDirty) {
        dirty.push({ id: u.id, name: u.name, count: logicalCount || 1 });
      }
    } catch { /* skip an unreadable profile */ }
  }
  if (activeId) { try { await Storage.init(activeId); } catch { /* ignore */ } }
  return dirty;
}

// Drain + reconcile each selected profile to the cloud. drainOutbox keys off the
// ACTIVE profile id + the Storage singleton, so we set both together, then
// restore the original active profile in `finally`.
export async function syncAllProfilesToCloud(accountId, dirty, onProgress) {
  if (!accountId) throw new Error('Not signed in.');
  const Engine = await import('./sync-engine.js');
  const Sync   = await import('./sync.js');
  const originalActiveId = UserManager.getActiveId();

  try {
    let done = 0;
    for (const p of dirty) {
      UserManager.setActiveId(p.id);
      await Storage.init(p.id);

      // Full reconcile: ensure the cloud row + push name/color/appearance/default.
      await reconcileProfileStructure(p.id, accountId);

      await Engine.drainOutbox({ manual: true });
      const remaining = await Storage.getAllOutboxOps();
      if (remaining.length) throw new Error('Some changes did not upload.');

      done++;
      if (onProgress) onProgress(done, dirty.length);
    }
    // Remove cloud rows for profiles deleted locally while backup was off.
    await flushPendingProfileDeletes(accountId);
    try { await Sync.pushSnapshot({ manual: true }); } catch { /* metadata only */ }
  } finally {
    if (originalActiveId) {
      UserManager.setActiveId(originalActiveId);
      try { await Storage.init(originalActiveId); } catch { /* ignore */ }
    }
  }
}

/* ================================================================
   POST-PULL OUTBOX PRUNING
   ================================================================ */

// After a forced pull (hydrate), strip outbox ops that are now stale so the
// drain that follows only pushes genuine local-wins:
//
//   • pref ops    — always removed: cloud prefs just won the pull.
//   • entry/goal  — removed if the pull overwrote the local record with a
//                   strictly newer cloud version (currentTs > opTs).
//                   Kept if local tied or won (currentTs ≤ opTs).
//   • delete/restore/perm-delete — always kept (not LWW-comparable by timestamp).
async function pruneStaleOutboxAfterPull() {
  let ops;
  try { ops = await Storage.getAllOutboxOps(); } catch { return; }
  for (const op of ops) {
    if (op.kind === 'pref') {
      // Cloud prefs were just pulled — any local pref op is superseded.
      try { await Storage.removeOutboxOp(op.id); } catch { /* ignore */ }
      continue;
    }
    if (op.op !== 'upsert') continue;
    const opTs = op.payload?.updatedAt || 0;
    if (!opTs) continue;
    let current = null;
    try {
      if      (op.kind === 'entry') current = await Storage.getEntry(op.recordId);
      else if (op.kind === 'goal')  current = await Storage.getGoal(op.recordId);
      else continue;
    } catch { continue; }
    if (!current || (current.updatedAt || 0) > opTs) {
      try { await Storage.removeOutboxOp(op.id); } catch { /* ignore */ }
    }
  }
}

/* ================================================================
   SIGN-OUT orchestration
   ================================================================ */

export async function handleSignOut() {
  // No-cloud test account: just end the local session and return to the landing
  // page. Keep all browser data (IndexedDB, lt_users, account owner + per-profile
  // bindings) so re-login with the same test email resumes exactly where they
  // left off. No cloud modal — nothing was ever pushed to the cloud.
  if (isTestSession()) {
    endTestSession();
    window.location.replace('landing.html');
    return;
  }

  const accountId = state.syncSession?.user?.id || null;

  // Detect unsynced changes ALWAYS — collectUnsyncedChanges only reads the
  // local outbox and needs no network. The navigator.onLine gate was only
  // needed for the subsequent push, not for detection itself.
  let dirty = [];
  if (accountId) {
    try { dirty = await collectUnsyncedChanges(); } catch { dirty = []; }
  }

  // Nothing pending → cloud already has everything; safe to wipe locally.
  if (!dirty.length) { await finalizeSignOut(accountId); return; }

  // Offline with pending changes → we cannot push right now. Sign out but
  // KEEP the local data on-device so it syncs automatically on next sign-in.
  if (!navigator.onLine) {
    let proceed = true; // safe default if the modal can't be shown
    try {
      proceed = await showOfflineSignOutModal(dirty);
    } catch (err) {
      console.warn('[AccountSession] offline modal error:', err?.message || err);
    }
    if (!proceed) return;                               // stay signed in
    await finalizeSignOut(accountId, { keepLocalData: true });
    return;
  }

  // Online with pending changes → offer the user the backup modal.
  const { choice, selectedIds } = await showUnsyncedModal(dirty);
  if (choice === 'cancel') return;                  // stay signed in (Cancel/Esc)
  if (choice === 'no')     { await finalizeSignOut(accountId); return; } // explicit informed discard
  // 'yes' — back up only the profiles the user ticked.
  const selected = dirty.filter(d => selectedIds.includes(d.id));
  if (!selected.length) { await finalizeSignOut(accountId); return; }
  await runSyncThenSignOut(accountId, selected);
}

async function runSyncThenSignOut(accountId, selected) {
  showProgressModal();
  try {
    await syncAllProfilesToCloud(accountId, selected, (done, total) =>
      setProgressText(`Backing up your changes to cloud… (${done}/${total})`));
    hideProgressModal();
    await finalizeSignOut(accountId);
  } catch (err) {
    hideProgressModal();
    console.warn('[AccountSession] sign-out sync failed:', err?.message || err);
    const choice = await showRetryModal();
    if (choice === 'again') {
      // Retry only the profiles the user originally chose that are still dirty.
      const selectedIds = selected.map(p => p.id);
      let stillDirty = [];
      try { stillDirty = (await collectUnsyncedChanges()).filter(d => selectedIds.includes(d.id)); }
      catch { stillDirty = selected; }
      if (!stillDirty.length) { await finalizeSignOut(accountId); return; }
      await runSyncThenSignOut(accountId, stillDirty);
    } else if (choice === 'skip') {
      // Push failed — keep local data so the user doesn't lose anything.
      // The outbox will drain automatically on the next sign-in.
      await finalizeSignOut(accountId, { keepLocalData: true });
    }
    // 'abort' (Esc) → stay signed in, data intact
  }
}

/* ---- Modals (markup in app.html) ------------------------------- */

// Shown when the user clicks Sign Out while offline with pending changes.
// Resolves true → proceed with keepLocalData sign-out; false → stay signed in.
function showOfflineSignOutModal(dirty) {
  return new Promise(resolve => {
    const modal   = document.getElementById('signout-offline-modal');
    const msgEl   = document.getElementById('signout-offline-msg');
    const signOut = document.getElementById('signout-offline-proceed');
    const stay    = document.getElementById('signout-offline-cancel');
    if (!modal || !signOut || !stay) { resolve(true); return; }  // fallback: allow sign-out

    const totalCount    = dirty.reduce((s, p) => s + p.count, 0);
    const profileCount  = dirty.length;
    if (msgEl) {
      msgEl.textContent =
        `${totalCount} unsynced change${totalCount === 1 ? '' : 's'} across ` +
        `${profileCount} profile${profileCount === 1 ? '' : 's'} can't be backed up right now. ` +
        `Your data is safe on this device and will sync automatically next time you sign in while online.`;
    }

    modal.style.display = 'flex';
    _openModal(modal);
    signOut.focus();

    function cleanup(result) {
      _closeModal(modal, true);
      modal.style.display = 'none';
      signOut.removeEventListener('click', onSignOut);
      stay.removeEventListener('click', onStay);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onSignOut() { cleanup(true);  }
    function onStay()    { cleanup(false); }
    function onKey(e) {
      if (e.key === 'Enter')  { e.preventDefault(); cleanup(true);  }
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
    }
    signOut.addEventListener('click', onSignOut);
    stay.addEventListener('click', onStay);
    document.addEventListener('keydown', onKey);
  });
}

function showUnsyncedModal(dirty) {
  return new Promise(resolve => {
    const modal  = document.getElementById('signout-unsynced-modal');
    const intro  = document.getElementById('signout-unsynced-intro');
    const list   = document.getElementById('signout-unsynced-list');
    const yesBtn = document.getElementById('signout-unsynced-yes');
    const noBtn  = document.getElementById('signout-unsynced-no');
    const cancel = document.getElementById('signout-unsynced-cancel');
    if (!modal || !list || !yesBtn || !noBtn || !cancel) { resolve({ choice: 'no', selectedIds: [] }); return; }

    const totalCount = dirty.reduce((s, p) => s + p.count, 0);
    if (intro) {
      intro.textContent =
        `You have ${totalCount} unsynced change${totalCount === 1 ? '' : 's'} that ` +
        `haven't been backed up to the cloud. Choose which profiles to back up ` +
        `before signing out — unticked profiles will sign out without backing up.`;
    }

    // Build a checked checkbox row per dirty profile.
    list.innerHTML = dirty.map(p => `
      <label class="signout-profile-row">
        <input type="checkbox" class="signout-profile-cb" value="${escapeHtml(p.id)}" checked>
        <span class="signout-profile-name">${escapeHtml(p.name)}</span>
        <span class="signout-profile-count">${p.count} change${p.count === 1 ? '' : 's'}</span>
      </label>
    `).join('');

    const selectedIds = () =>
      Array.from(list.querySelectorAll('.signout-profile-cb:checked')).map(cb => cb.value);

    modal.style.display = 'flex';
    _openModal(modal);
    yesBtn.focus();

    function cleanup(result) {
      _closeModal(modal, true);
      modal.style.display = 'none';
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
      cancel.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onYes()    { cleanup({ choice: 'yes', selectedIds: selectedIds() }); }
    function onNo()     { cleanup({ choice: 'no',  selectedIds: [] }); }
    function onCancel() { cleanup({ choice: 'cancel', selectedIds: [] }); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); cleanup({ choice: 'cancel', selectedIds: [] }); }
      if (e.key === 'Enter')  { e.preventDefault(); cleanup({ choice: 'yes', selectedIds: selectedIds() }); }
    }
    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
    cancel.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}

function showProgressModal() {
  const modal = document.getElementById('signout-progress-modal');
  if (!modal) return;
  setProgressText('Backing up your changes to cloud…');
  modal.style.display = 'flex';
  _openModal(modal);
}
function setProgressText(text) {
  const el = document.getElementById('signout-progress-text');
  if (el) el.textContent = text;
}
function hideProgressModal() {
  const modal = document.getElementById('signout-progress-modal');
  if (!modal) return;
  _closeModal(modal, true);
  modal.style.display = 'none';
}

function showRetryModal() {
  return new Promise(resolve => {
    const modal = document.getElementById('signout-retry-modal');
    const again = document.getElementById('signout-retry-again');
    const skip  = document.getElementById('signout-retry-skip');
    if (!modal || !again || !skip) { resolve('skip'); return; }

    modal.style.display = 'flex';
    _openModal(modal);
    again.focus();

    function cleanup(result) {
      _closeModal(modal, true);
      modal.style.display = 'none';
      again.removeEventListener('click', onAgain);
      skip.removeEventListener('click', onSkip);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onAgain() { cleanup('again'); }
    function onSkip()  { cleanup('skip'); }
    function onKey(e) {
      if (e.key === 'Enter')  { e.preventDefault(); cleanup('again'); }
      if (e.key === 'Escape') { e.preventDefault(); cleanup('abort'); } // stay signed in
    }
    again.addEventListener('click', onAgain);
    skip.addEventListener('click', onSkip);
    document.addEventListener('keydown', onKey);
  });
}
