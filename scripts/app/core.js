/* ===== core.js — extracted from app.js ===== */
import { state, BACKUP_FAILURE_LIMIT, DELETED_RETENTION_DAYS, DEFAULT_PREFS } from './state.js';
import { setupDeletedLogsPage, setupTopicsModal } from './deleted-logs.js';
import { _setupLogPromptModal, setupGoalModal, setupLinkGoalModal } from './goals.js';
import { setupEntryModal, setupFilterPanel } from './log.js';
import { navigateTo, setupMobileNav, setupNavigation, setupSidebar, updateSidebarUser } from './nav.js';
import { backupCurrentProfile, configureBackupFolder, ensureCategoryColors, setupBackup, setupSettings } from './settings.js';
import { UserManager, setupUserPicker } from './users.js';
import { _closeModal, _openModal, setupModalScrollTrap, showToast } from './utils.js';
import { applyAccent, applyCompact, applyTheme, setupClock, setupPomodoro, setupReminder, setupThemeToggle } from './widgets.js';
import { initSync, queueCloudPush } from './sync.js';
import { getClient } from './sync.js';
import { loadEntitlements } from './entitlements.js';

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

    // Auth gate: signed-out users go to the landing page.
    // Check cheaply via localStorage before loading the Supabase client.
    // Bypass if: auth callback in URL (OTP / OAuth redirect), or running on localhost (dev).
    const hasStoredSession = !!localStorage.getItem('lt_sb_auth');
    const hasAuthCallback  = /[?#](access_token|code|error)=/.test(window.location.search + window.location.hash);
    const skipAuth         = !!localStorage.getItem('lt_skip_auth'); // TEMP: bypass login
    if (!hasStoredSession && !hasAuthCallback && !skipAuth) {
      window.location.replace('landing.html');
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
      } catch (err) {
          // On error (network/other) treat as unauthenticated for security.
          window.location.replace('landing.html');
          return;
      }
    }

    // Set tier early so every page render sees the correct entitlements from the start
    await loadEntitlements();

    // Ensure at least one user profile exists (auto-create on first launch)
    let users = UserManager.getUsers();
    if (users.length === 0) {
      const first = UserManager.createUser('Me');
      UserManager.setActiveId(first.id);
      users = [first];
    }

    let activeId = UserManager.getActiveId();
    if (!users.find(u => u.id === activeId)) {
      activeId = users[0].id;
      UserManager.setActiveId(activeId);
    }

    await loadAndShowApp(activeId);
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
        await Storage.setPref('categoryColors', state.prefs.categoryColors);
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

    applyTheme(state.prefs.theme);
    applyAccent(state.prefs.accent);
    applyCompact(state.prefs.compact);

    // Enforce a data-safety choice on first launch: a local backup folder OR cloud sync.
    // (Cloud sync is the path for non-Chromium browsers, where showDirectoryPicker is absent.)
    const existingHandle = await Storage.getDirectoryHandle();
    const backupSkipped  = localStorage.getItem('lt_backup_skipped') === 'true';
    const cloudOptIn     = localStorage.getItem('lt_cloud_optin') === 'true';
    if (!existingHandle && !backupSkipped && !cloudOptIn) {
      const modal = document.getElementById('backup-required-modal');
      if (modal) { modal.style.display = 'flex'; _openModal(modal); }
      await waitForBackupFolderSetup();
      if (modal) { _closeModal(modal, true); modal.style.display = 'none'; }
    }

    updateSidebarUser();
    navigateTo('dashboard');

    // Restore any cloud session and converge data in the background — never block boot,
    // and never throw (offline / signed-out are normal states).
    initSync().catch(err => console.warn('[App] cloud sync init failed:', err));

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
        try { await Storage.saveEntry(e); } catch (err) { console.error('[App] goal-link migration save failed:', err); }
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
    const warnEl     = document.getElementById('sidebar-backup-warning');
    const el         = document.getElementById('sidebar-backup-status');
    const time       = document.getElementById('sidebar-backup-time');

    const setWarn = (label, sub, title) => {
      if (!warnEl) return;
      warnEl.style.display = 'flex';
      const labelEl = warnEl.querySelector('.sbs-label');
      const subEl   = warnEl.querySelector('.sbs-warn-text');
      if (labelEl) labelEl.textContent = label;
      if (subEl)   subEl.textContent   = sub;
      warnEl.setAttribute('title', title);
      warnEl.setAttribute('aria-label', title);
    };

    if (!folderName) {
      // No folder configured — always show warning, never show auto-backup status
      setWarn('Local Backup off', 'Set up folder', 'Local backup not configured — click to set up');
      if (el) el.style.display = 'none';
      return;
    }

    // Folder configured but auto-backup keeps failing — keep a sticky warning so the
    // user doesn't assume their data is safe when it isn't.
    if (state.backupFailing) {
      setWarn('Backup failing', 'Check folder', 'Auto-backup is failing repeatedly — click to reconnect your backup folder');
      if (el) el.style.display = 'none';
      return;
    }

    // Folder configured — warning never shows, status shows if a backup has run
    if (warnEl) warnEl.style.display = 'none';
    if (!el || !state.lastAutoBackup) return;

    const diffMin = Math.floor((Date.now() - state.lastAutoBackup) / 60000);
    const diffHr  = Math.floor(diffMin / 60);
    if (time) time.textContent = diffMin < 1  ? 'Just now'
                               : diffMin < 60 ? `${diffMin}m ago`
                               : diffHr < 24  ? `${diffHr}h ago`
                               : 'Over a day ago';

    el.style.display = 'flex';

    if (fresh) {
      el.classList.remove('sbs-pop');
      void el.offsetWidth;
      el.classList.add('sbs-pop');
    }
  }
