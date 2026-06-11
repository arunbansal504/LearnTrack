/* ===== core.js — extracted from app.js ===== */
import { state, BACKUP_FAILURE_LIMIT, DELETED_RETENTION_DAYS, DEFAULT_PREFS } from './state.js';
import { setupDeletedLogsPage, setupTopicsModal } from './deleted-logs.js';
import { _setupLogPromptModal, setupGoalModal, setupLinkGoalModal } from './goals.js';
import { setupEntryModal, setupFilterPanel } from './log.js';
import { navigateTo, setupMobileNav, setupNavigation, setupSidebar, updateSidebarUser } from './nav.js';
import { backupCurrentProfile, configureBackupFolder, ensureCategoryColors, setupBackup, setupSettings } from './settings.js';
import { UserManager, setupUserPicker, createCloudProfileRow } from './users.js';
import { _closeModal, _openModal, setupModalScrollTrap, showToast } from './utils.js';
import { applyAccent, applyCompact, applyTheme, setupClock, setupPomodoro, setupReminder, setupThemeToggle } from './widgets.js';
import { initSync, queueCloudPush, getLastCloudSync } from './sync.js';
import { getClient } from './sync.js';
import { loadEntitlements, canUse } from './entitlements.js';
import { getTestSession, testAccountId } from './test-accounts.js';
import { computeSyncSignature, setBootSignature, getBootSignature } from './cloud-repo.js';

  /* ---- Banned-user guard --------------------------------- */

  function isUserBanned(user) {
    const b = user?.banned_until;
    if (!b) return false;
    if (b === 'infinity') return true;
    return new Date(b) > new Date();
  }

  async function rejectBannedUser(sb) {
    sessionStorage.setItem('lt_ban_notice', '1');
    try { localStorage.removeItem('lt_sb_auth'); } catch { /* ignore */ }
    try { await sb.auth.signOut(); } catch { /* ignore */ }
    window.location.replace('landing.html');
  }

  /* ---- Loading-overlay progress (sign-in hydrate) -- */

  function updateLoadingProgress(done, total) {
    const el = document.querySelector('#loading-overlay .loading-text');
    if (el) el.textContent = total
      ? `Loading your profiles from cloud… (${done}/${total})`
      : 'Loading your profiles from cloud…';
  }
  function resetLoadingProgress() {
    const el = document.querySelector('#loading-overlay .loading-text');
    if (el) el.textContent = 'Loading your learning journey...';
  }

  /* ---- Initialization ------------------------------ */

  export async function init() {
    document.getElementById('loading-overlay').style.display = 'flex';

    // One-time event-handler setup
    setupNavigation();
    setupSidebar();
    setupMobileNav();
    setupEntryModal();
    setupGoalModal();
    setupLinkGoalModal();
    setupTopicsModal();
    setupModalScrollTrap();
    _setupLogPromptModal();
    setupFilterPanel();
    setupDeletedLogsPage();
    setupSettings();
    setupBackup();
    setupThemeToggle();
    setupUserPicker();
    setupReminder();
    setupPomodoro();
    setupClock();
    const _backupTsKey   = `lt_last_auto_backup_${UserManager.getActive()?.id || 'default'}`;
    const storedBackupTs = parseInt(localStorage.getItem(_backupTsKey) || '0', 10);
    if (storedBackupTs) state.lastAutoBackup = storedBackupTs;
    updateSidebarBackupStatus(false);
    setInterval(updateSidebarBackupStatus, 60000);
    document.addEventListener('lt-sync-changed', () => updateSidebarBackupStatus(false));

    // Auth gate: signed-out users go to the landing page.
    // Check cheaply via localStorage before loading the Supabase client.
    // Allow through for: a stored Supabase session, an auth callback in the URL
    // (OTP / OAuth redirect), or an active no-cloud test session (test-accounts.js).
    const hasStoredSession = !!localStorage.getItem('lt_sb_auth');
    const hasAuthCallback  = /[?#](access_token|code|error)=/.test(window.location.search + window.location.hash);
    // A real Supabase session (or auth callback) always wins over a stale test
    // marker, so clear it to keep cloud UI/entitlements consistent.
    if ((hasStoredSession || hasAuthCallback) && getTestSession()) {
      try { localStorage.removeItem('lt_test_account'); } catch { /* ignore */ }
    }
    const testEmail = getTestSession(); // no-cloud test account: app layer only
    if (!hasStoredSession && !hasAuthCallback && !testEmail) {
      window.location.replace('landing.html');
      return;
    }

    // No-cloud test session: never load the Supabase client, never hydrate from
    // or write to the cloud. Scope/link the local data to the test account and
    // isolate it from any other (real or test) account previously used here.
    if (testEmail && !hasStoredSession && !hasAuthCallback) {
      const tid = testAccountId(testEmail);
      let stashedForeign = false;
      try {
        const { getAccountOwner, setAccountOwner, clearLocalAccountData } = await import('./account-session.js');
        const owner = getAccountOwner();
        if (owner && owner !== tid) {
          await clearLocalAccountData(owner);
        }
        setAccountOwner(tid);
        // Symmetric isolation: hide any profile owned by a DIFFERENT account (a real
        // cloud account or another test account) so the test session shows only its
        // own. Data is preserved on-device and restored on sign-out by
        // clearLocalAccountData. Mirrors hydrateAllProfilesFromCloud's orphan stash.
        stashedForeign = stashForeignTestProfiles(tid);
      } catch (err) {
        console.warn('[App] test-session setup failed:', err);
      }
      await loadEntitlements();              // grants Family via the test branch
      // noDefault: a stashed profile may still hold the 'default' IndexedDB slot, so
      // force a fresh DB id for a newly-created test profile to avoid inheriting it.
      await ensureTestProfile(tid, { noDefault: stashedForeign }); // create + bind a profile if none
      const activeId = UserManager.getActiveId() || UserManager.getUsers()[0]?.id;
      if (activeId) UserManager.setActiveId(activeId);
      await loadAndShowApp(activeId);
      // Reflect the test session in the cloud-sync card + sidebar (sign-out button,
      // disabled cloud controls). initSync — which normally emits this — is skipped.
      document.dispatchEvent(new CustomEvent('lt-sync-changed'));
      return;
    }

    // If there is a stored session, confirm it's still valid before continuing.
    // This blocks startup briefly but prevents bypassing the auth gate by
    // typing `app.html` directly when the session is invalid.
    if (hasStoredSession && !hasAuthCallback) {
      try {
        const sb = await getClient();
          const { data: { session } } = await sb.auth.getSession();
          if (!session) {
            window.location.replace('landing.html');
            return;
          }
          // getUser() hits the server — banned_until is never in the JWT cache
          const { data: { user: liveUser }, error: userErr } = await sb.auth.getUser();
          if (userErr || !liveUser || isUserBanned(liveUser)) {
            await rejectBannedUser(sb);
            return;
          }
      } catch (err) {
          // Offline with a stored session: let the user keep working offline
          // (the persisted token is read locally). Only treat an error as
          // unauthenticated — and redirect — when we're actually online.
          if (navigator.onLine) {
            window.location.replace('landing.html');
            return;
          }
      }
    }

    // Set tier early so every page render sees the correct entitlements from the start
    await loadEntitlements();

    // Fresh sign-in (landing → app, or OAuth return): eagerly pull every cloud
    // profile's full data into IndexedDB and open the default profile, before
    // the app shell renders. hydrate owns the lt_just_logged_in flag lifecycle.
    // Session present but no account owner = incomplete offline sign-out; re-hydrate.
    const sessionExistsButOwnerCleared = hasStoredSession && !localStorage.getItem('lt_account_owner');
    const justLoggedIn = localStorage.getItem('lt_just_logged_in') === '1'
      || hasAuthCallback
      || sessionExistsButOwnerCleared;
    if (justLoggedIn) {
      try {
        const sb = await getClient();
        const { data: { session } } = await sb.auth.getSession(); // also completes OAuth code exchange
        if (session) {
          // getUser() hits the server — banned_until is never in the JWT cache
          const { data: { user: liveUser }, error: userErr } = await sb.auth.getUser();
          if (userErr || !liveUser || isUserBanned(liveUser)) {
            await rejectBannedUser(sb);
            return;
          }
          state.syncSession = session;
          const { hydrateAllProfilesFromCloud } = await import('./account-session.js');
          const defaultId = await hydrateAllProfilesFromCloud(session, updateLoadingProgress);
          if (defaultId) UserManager.setActiveId(defaultId);
        } else {
          localStorage.removeItem('lt_just_logged_in');
          // OAuth callback with no session while online = code exchange failed
          // (ban, revoked token, etc.) — send back to landing, never enter the app.
          if (navigator.onLine && hasAuthCallback) {
            window.location.replace('landing.html');
            return;
          }
        }
      } catch (err) {
        console.warn('[App] sign-in hydrate failed:', err);
      } finally {
        resetLoadingProgress();
      }
    }

    // Ensure at least one user profile exists (auto-create on first launch)
    let users = UserManager.getUsers();
    if (users.length === 0) {
      // If offline profiles were stashed during sign-in hydration, 'default' is already
      // claimed by the stashed profile's database. Force a timestamp ID so this new
      // cloud profile opens a fresh LearnTrackDB_u<ts> instead of inheriting old data.
      const hasStashedOrphans = !!localStorage.getItem('lt_offline_profiles');
      const first = UserManager.createUser('Me', { noDefault: hasStashedOrphans });
      UserManager.setActiveId(first.id);
      users = [first];
      // Push to cloud immediately if the user is already signed in.
      if (state.syncSession) createCloudProfileRow(first, { backfill: true }).catch(() => {});
    }

    let activeId = UserManager.getActiveId();
    if (!users.find(u => u.id === activeId)) {
      activeId = users[0].id;
      UserManager.setActiveId(activeId);
    }

    // Eagerly prime account-session.js + auth.js into the module registry so
    // the sign-out button works offline. For fresh-login paths account-session.js
    // is already imported (line 141); for persistent-session loads this is the
    // only time these modules get pre-loaded. auth.js is needed inside
    // finalizeSignOut to do the server-side token invalidation.
    if (hasStoredSession || state.syncSession) {
      import('./account-session.js').catch(() => {});
      import('./auth.js').catch(() => {});
    }

    await loadAndShowApp(activeId);
  }

  // No-cloud test session: make sure at least one profile exists and every local
  // profile is bound to the synthetic test account id (so the data is linked to
  // the test email and never treated as an orphan).
  // Hide profiles owned by another account (lt_sync_account ≠ this test id) while a
  // test session is active. Stashed into lt_offline_profiles (merged, never
  // clobbered) and restored on sign-out by clearLocalAccountData. Profiles with NO
  // owner are left for the test account to adopt. Returns true if anything was
  // stashed (the caller then forces a fresh DB id so a stashed 'default' slot isn't
  // inherited).
  function stashForeignTestProfiles(tid) {
    const all     = UserManager.getUsers();
    const foreign = all.filter(u => {
      const acc = localStorage.getItem(`lt_sync_account_${u.id}`);
      if (acc) return acc !== tid;   // bound to an account → foreign unless it's this test id
      // No sync_account binding: still foreign if it carries a cloud-profile mapping
      // to ANY real account (defensive — a real profile should always have both).
      return Object.keys(localStorage).some(k => k.startsWith(`lt_cloud_pid_${u.id}_`));
    });
    if (!foreign.length) return false;

    let existing = [];
    try { existing = JSON.parse(localStorage.getItem('lt_offline_profiles') || '[]'); } catch { /* ignore */ }
    const byId = new Map(existing.map(u => [u.id, u]));
    for (const u of foreign) byId.set(u.id, u);
    localStorage.setItem('lt_offline_profiles', JSON.stringify([...byId.values()]));

    const foreignIds = new Set(foreign.map(u => u.id));
    UserManager.saveUsers(all.filter(u => !foreignIds.has(u.id)));
    if (foreignIds.has(UserManager.getActiveId())) localStorage.removeItem('lt_active_user');
    return true;
  }

  async function ensureTestProfile(testAccId, { noDefault = false } = {}) {
    let users = UserManager.getUsers();
    if (users.length === 0) {
      const first = UserManager.createUser('Me', { noDefault });
      UserManager.setActiveId(first.id);
      users = [first];
    }
    for (const u of users) {
      const key = `lt_sync_account_${u.id}`;
      if (localStorage.getItem(key) !== testAccId) localStorage.setItem(key, testAccId);
    }
  }

  function _syncSidebarAccentSwatches() {
    const accent = state.prefs.accent || 'purple';
    const isHex  = accent.startsWith('#');
    document.querySelectorAll('.sidebar-accent-row .accent-swatch[data-accent]').forEach(btn => {
      const a = btn.dataset.accent;
      btn.classList.toggle('active', !isHex && a === accent);
      const locked = !canUse('accent', a);
      btn.dataset.locked = locked ? 'true' : 'false';
    });
  }

  export async function loadAndShowApp(userId) {
    try {
      await Storage.init(userId);
      // Auto-purge recycle-bin entries older than the retention window so the
      // deleted-entries store can't grow without bound. Failures here are
      // non-fatal — never block startup on housekeeping.
      Storage.purgeOldDeletedEntries(DELETED_RETENTION_DAYS).catch(() => {});
      Storage.purgeOldDeletedGoals(DELETED_RETENTION_DAYS).catch(() => {});
      state.entries   = await Storage.getAllEntries();
      state.prefs     = { ...DEFAULT_PREFS, ...(await Storage.getAllPrefs()) };
      state.earnedAch = await Storage.getAllAchievements();
      state.goals     = await Storage.getAllGoals();
      // Migration: if goal history exists but has no epoch anchor, past dates fall back
      // to the current (new) goal instead of the original — add a sentinel using the default.
      if (state.prefs.goalHistory?.length && !state.prefs.goalHistory.some(g => g.from === '0000-01-01')) {
        state.prefs.goalHistory = [{ from: '0000-01-01', goalMin: DEFAULT_PREFS.dailyGoalMin }, ...state.prefs.goalHistory];
        await Storage.setPref('goalHistory', state.prefs.goalHistory);
      }
      if (state.prefs.monthlyGoalHistory?.length && !state.prefs.monthlyGoalHistory.some(g => g.from === '0000-01')) {
        state.prefs.monthlyGoalHistory = [{ from: '0000-01', goalHr: DEFAULT_PREFS.monthlyGoalHr }, ...state.prefs.monthlyGoalHistory];
        await Storage.setPref('monthlyGoalHistory', state.prefs.monthlyGoalHistory);
      }
      // Backfill a stable, unique color for every existing category (Report screen).
      if (ensureCategoryColors(state.prefs.categories || [])) {
        await Storage.saveCategories(state.prefs.categories || [], state.prefs.categoryColors);
      }
      // Migration: time-goal progress moved from name+category matching to explicit
      // entry↔goal links. Auto-link the entries that previously matched so existing
      // progress is preserved. Runs once per profile.
      await migrateGoalLinks(userId);
    } catch (err) {
      console.error('[App] Load error:', err);
      showFatalLoadError(err);
      return;
    }

    // One-time startup check: if reminder was saved as enabled but permission is gone, reset silently
    if (state.prefs.reminder && (!('Notification' in window) || Notification.permission !== 'granted')) {
      state.prefs.reminder = false;
      Storage.setPref('reminder', false);
    }

    // Boot signature: capture a content signature of the whole syncable dataset
    // *after* all boot-time housekeeping (category backfill, goal-link migration,
    // reminder reset) so the sign-out dirty check can detect net-no-change (e.g.
    // create-then-delete, edit-then-revert, accent changed then reverted). This is
    // the reference for profiles that have never synced; cloud-synced profiles use
    // the cloud signature instead (refreshed by the sync engine).
    try {
      // Only write the boot sig if one does not already exist for this user.
      // The ?signout=1 redirect re-runs loadAndShowApp() in the same session;
      // overwriting would set bootSig = curSig and make the dirty check empty.
      const existing = getBootSignature(userId);
      if (!existing || Object.keys(existing).length === 0) {
        const bootSig = computeSyncSignature((await Storage.exportAll()).data);
        setBootSignature(userId, bootSig);
        console.log('[SignIn] boot signature captured', { userId, recordCount: Object.keys(bootSig).length, keys: Object.keys(bootSig) });
      } else {
        console.log('[SignIn] boot signature preserved (already set this session)', { userId, recordCount: Object.keys(existing).length });
      }
    } catch { /* non-fatal */ }

    applyTheme(state.prefs.theme);
    applyAccent(state.prefs.accent);
    applyCompact(state.prefs.compact);
    _syncSidebarAccentSwatches();

    showBackupNudge();

    updateSidebarUser();
    navigateTo('dashboard');

    // initSync() is intentionally NOT called here so main.js can control whether
    // it is awaited (needed for the ?signout=1 landing-page redirect path) or
    // fire-and-forget (normal boot). main.js always calls it after init() resolves.

    setTimeout(() => {
      document.getElementById('loading-overlay').style.opacity = '0';
      document.getElementById('loading-overlay').style.transition = 'opacity 0.4s';
      setTimeout(() => {
        document.getElementById('loading-overlay').style.display = 'none';
        document.getElementById('app').style.display = 'block';
      }, 400);
    }, 600);
  }

  // One-time backfill: link existing entries to time goals using the legacy
  // name+category matching rule, so progress carries over to the link-based model.
  export async function migrateGoalLinks(userId) {
    const flagKey = `lt_goal_link_migrated_${userId || 'default'}`;
    if (localStorage.getItem(flagKey) === 'true') return;

    const timeGoals = state.goals.filter(g => g.type === 'time');
    if (timeGoals.length) {
      const changed = new Set();
      timeGoals.forEach(goal => {
        const start      = goal.startDate || '0000-01-01';
        const titleLower = (goal.title || '').toLowerCase().trim();
        // Completed/archived goals previously capped their counted entries at the closure date.
        let dateTo = null;
        if (goal.status === 'completed' || goal.status === 'archived') {
          const closureTs = goal.completedAt || goal.updatedAt;
          if (closureTs) {
            const d = new Date(closureTs);
            dateTo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          }
        }
        state.entries.forEach(e => {
          const matches =
            e.date >= start &&
            (!dateTo || e.date <= dateTo) &&
            (!goal.category || goal.category === '' || e.category === goal.category) &&
            (!titleLower || (e.topic || '').toLowerCase().trim() === titleLower);
          if (!matches) return;
          if (!Array.isArray(e.goalIds)) e.goalIds = [];
          if (!e.goalIds.includes(goal.id)) { e.goalIds.push(goal.id); changed.add(e); }
        });
      });
      for (const e of changed) {
        // Use low-level put (not saveEntry) so goalId backlinks don't create
        // outbox ops. goalIds are a local join computed from name+category
        // matching and are not stored in the cloud — no point syncing them.
        try { await Storage.put(Storage.STORES.entries, e); } catch (err) { console.error('[App] goal-link migration save failed:', err); }
      }
    }

    localStorage.setItem(flagKey, 'true');
  }

  // Storage.init rejects when IndexedDB is unavailable (private-mode, blocked by another
  // tab mid-upgrade, or quota issues). Rather than leave the user staring at the spinner
  // forever, replace the loading overlay with a readable, actionable message.
  export function showFatalLoadError(err) {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
    const detail = (err && err.message) ? String(err.message) : 'Unknown error';
    overlay.replaceChildren();
    const box = document.createElement('div');
    box.className = 'fatal-load-error';
    box.setAttribute('role', 'alert');

    const h = document.createElement('h2');
    h.textContent = 'Couldn’t open your data';
    const p = document.createElement('p');
    p.textContent = 'Learn Tracker stores everything in your browser. It couldn’t access local storage, '
      + 'so the app can’t start. This usually happens in private/incognito windows, when another tab '
      + 'is open mid-update, or when browser storage is blocked.';
    const tips = document.createElement('p');
    tips.textContent = 'Try closing other Learn Tracker tabs and reloading, or open this page in a normal '
      + '(non-private) browser window.';
    const small = document.createElement('p');
    small.className = 'fatal-load-error-detail';
    small.textContent = 'Details: ' + detail;
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Reload';
    btn.addEventListener('click', () => location.reload());

    box.append(h, p, tips, small, btn);
    overlay.appendChild(box);
  }

  /* ---- Backup folder gate -------------------------- */

  export function waitForBackupFolderSetup() {
    return new Promise(resolve => {
      const btn      = document.getElementById('backup-required-btn');
      const skipBtn  = document.getElementById('backup-skip-btn');
      const cloudBtn = document.getElementById('backup-cloud-btn');
      if (!btn) { resolve(); return; }

      function cleanup() {
        btn.removeEventListener('click', handler);
        skipBtn?.removeEventListener('click', skipHandler);
        cloudBtn?.removeEventListener('click', cloudHandler);
      }

      async function handler() {
        btn.disabled = true;
        btn.textContent = 'Choosing…';
        const ok = await configureBackupFolder();
        if (ok) {
          cleanup();
          resolve();
        } else {
          btn.disabled = false;
          btn.textContent = 'Choose Backup Folder';
        }
      }

      function skipHandler() {
        localStorage.setItem('lt_backup_skipped', 'true');
        cleanup();
        resolve();
      }

      // Cloud sync as the alternative to a local folder — the only data-safety option
      // available on Firefox/Safari/iOS. Dismiss the gate and send the user to the
      // Backup page where the Cloud Sync card lets them sign in.
      function cloudHandler() {
        localStorage.setItem('lt_cloud_optin', 'true');
        cleanup();
        resolve();
        navigateTo('backup');
      }

      btn.addEventListener('click', handler);
      skipBtn?.addEventListener('click', skipHandler);
      cloudBtn?.addEventListener('click', cloudHandler);
    });
  }

  /* ---- Auto Backup --------------------------------- */

  export async function triggerAutoBackup() {
    // Cloud sync runs independently of the local backup folder — queue it first so
    // cloud-only users (no folder configured) are still covered. Only queue a
    // cloud push if the user has enabled Auto Cloud Backup in preferences.
    // queueCloudPush() no-ops unless signed in, bound, and online.
    if (state.prefs.cloudAutoBackup) queueCloudPush();

    // Permission must be checked/requested during the user gesture (now), not inside
    // the timer — mobile Chrome rejects requestPermission outside a user activation.
    try {
      const handle = await Storage.getDirectoryHandle();
      if (!handle) return;
      let perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'prompt') perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return;
    } catch {
      return;
    }
    clearTimeout(state.autoBackupTimer);
    state.autoBackupTimer = setTimeout(async () => {
      // If a backup is already running, mark that another is needed and bail out.
      // The running backup's finally block will re-trigger.
      if (state.backupInProgress) {
        state.backupPendingRetry = true;
        return;
      }
      state.backupInProgress   = true;
      state.backupPendingRetry = false;
      try {
        await backupCurrentProfile(true);
        // success path resets the failure counter (see backupCurrentProfile)
      } catch (err) {
        state.backupFailures++;
        if (localStorage.getItem('lt_backup_skipped') !== 'true') {
          showToast('Auto-backup failed — check your backup folder.', 'warning');
        }
        if (state.backupFailures >= BACKUP_FAILURE_LIMIT) {
          state.backupFailing = true;
          updateSidebarBackupStatus();
        }
      } finally {
        state.backupInProgress = false;
        if (state.backupPendingRetry) triggerAutoBackup();
      }
    }, 2000);
  }

  export function updateSidebarBackupStatus(fresh = false) {
    const folderName = localStorage.getItem('lt_backupFolderName');
    const hasCloud   = !!state.prefs.cloudAutoBackup;
    const warnEl     = document.getElementById('sidebar-backup-warning');
    const el         = document.getElementById('sidebar-backup-status');
    const labelEl    = el?.querySelector('.sbs-label');
    const time       = document.getElementById('sidebar-backup-time');

    const setWarn = (label, sub, title) => {
      if (!warnEl) return;
      warnEl.style.display = 'flex';
      const wLabelEl = warnEl.querySelector('.sbs-label');
      const subEl    = warnEl.querySelector('.sbs-warn-text');
      if (wLabelEl) wLabelEl.textContent = label;
      if (subEl)    subEl.textContent    = sub;
      warnEl.setAttribute('title', title);
      warnEl.setAttribute('aria-label', title);
    };

    const localFailing = state.backupFailing;
    const cloudFailing = hasCloud && state.syncStatus === 'error';

    // Nothing configured at all
    if (!folderName && !hasCloud) {
      setWarn('Local & Cloud Backup off', 'Set up backup', 'No backup configured — click to set up');
      if (el) el.style.display = 'none';
      showBackupNudge();
      return;
    }

    // Both failing (regardless of configuration)
    if (localFailing && cloudFailing) {
      setWarn('Local & Cloud Backup failing', 'Check both', 'Both backup methods are failing — click to investigate');
      if (el) el.style.display = 'none';
      showBackupNudge();
      return;
    }

    // Local failing (even if cloud is on and healthy — still warn)
    if (localFailing) {
      setWarn('Local Backup failing', 'Check folder', 'Auto-backup is failing repeatedly — click to reconnect your backup folder');
      if (el) el.style.display = 'none';
      showBackupNudge();
      return;
    }

    // Cloud failing (even if local is on and healthy — still warn)
    if (cloudFailing) {
      setWarn('Cloud Backup failing', 'Check sync', 'Cloud sync is failing — click to go to Backup settings');
      if (el) el.style.display = 'none';
      showBackupNudge();
      return;
    }

    // All configured methods are healthy — hide warning
    if (warnEl) warnEl.style.display = 'none';

    const lastLocal = state.lastAutoBackup;
    const lastCloud = getLastCloudSync();
    const hasLocalBacked = !!folderName && lastLocal > 0;
    const hasCloudBacked = hasCloud && lastCloud > 0;

    if (!hasLocalBacked && !hasCloudBacked) {
      if (el) el.style.display = 'none';
      showBackupNudge();
      return;
    }

    let chipLabel = 'Auto-backed up';
    let timestamp = 0;
    if (hasLocalBacked && hasCloudBacked) {
      chipLabel = 'Backed up locally & cloud';
      timestamp = Math.max(lastLocal, lastCloud);
    } else if (hasLocalBacked) {
      chipLabel = 'Backed up locally';
      timestamp = lastLocal;
    } else {
      chipLabel = 'Backed up to cloud';
      timestamp = lastCloud;
    }

    if (labelEl) labelEl.textContent = chipLabel;

    const diffMin = Math.floor((Date.now() - timestamp) / 60000);
    const diffHr  = Math.floor(diffMin / 60);
    if (time) time.textContent = diffMin < 1  ? 'Just now'
                               : diffMin < 60 ? `${diffMin}m ago`
                               : diffHr < 24  ? `${diffHr}h ago`
                               : 'Over a day ago';

    if (!el) { showBackupNudge(); return; }
    el.style.display = 'flex';

    if (fresh) {
      el.classList.remove('sbs-pop');
      void el.offsetWidth;
      el.classList.add('sbs-pop');
    }

    showBackupNudge();
  }

  export function showBackupNudge() {
    const nudge = document.getElementById('backup-nudge');
    if (!nudge) return;
    const hasFolder = !!localStorage.getItem('lt_backupFolderName');
    const hasCloud  = !!state.prefs.cloudAutoBackup;
    const dismissed = localStorage.getItem('lt_backup_nudge_dismissed') === 'true';
    if (hasFolder || hasCloud || dismissed) { nudge.style.display = 'none'; return; }
    nudge.style.display = 'flex';
    const setupBtn   = document.getElementById('backup-nudge-setup');
    const dismissBtn = document.getElementById('backup-nudge-dismiss');
    if (setupBtn && !setupBtn.dataset.wired) {
      setupBtn.dataset.wired = '1';
      setupBtn.addEventListener('click', () => navigateTo('backup'));
    }
    if (dismissBtn && !dismissBtn.dataset.wired) {
      dismissBtn.dataset.wired = '1';
      dismissBtn.addEventListener('click', () => {
        localStorage.setItem('lt_backup_nudge_dismissed', 'true');
        nudge.style.display = 'none';
      });
    }
  }
