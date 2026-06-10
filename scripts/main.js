/* ===== main.js — application entry point (ES module) ===== */
import { init } from './app/core.js';
import { navigateTo } from './app/nav.js';
import { showToast } from './app/utils.js';
import { initSync } from './app/sync.js';
import { getTestSession } from './app/test-accounts.js';

// Ensure every module is loaded (functions are wired when init() runs).
import './app/achievements.js';
import './app/core.js';
import './app/dashboard.js';
import './app/deleted-logs.js';
import './app/goals.js';
import './app/log.js';
import './app/nav.js';
import './app/reports.js';
import './app/settings.js';
import './app/auth.js';
import './app/sync.js';
import './app/sync-engine.js';
import './app/cloud-repo.js';
import './app/users.js';
import './app/utils.js';
import './app/widgets.js';
import './app/entitlements.js';

// Exposed for any inline handlers and for console use.
window.App = { init, navigateTo, showToast };

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await init();
  } catch (err) {
    console.error('[App] Fatal error:', err);
    return;
  }

  const isSignOutRedirect = new URLSearchParams(window.location.search).get('signout') === '1';

  if (isSignOutRedirect) {
    history.replaceState(null, '', window.location.pathname);
    // Show the app shell and hide the loading overlay NOW so the sign-out modal
    // is visible. The modal lives inside #app (display:none by default) and the
    // loading overlay has z-index 10000 vs the modal's 1000 — both would hide it.
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
    const appEl = document.getElementById('app');
    if (appEl) appEl.style.display = 'block';
    // AWAIT initSync() so state.syncSession is set before the dirty-change check
    // runs (initSync was previously fire-and-forget inside init(), which left a
    // race window where handleSignOut saw a null session and skipped the modal).
    if (!getTestSession()) {
      await initSync().catch(err => console.warn('[App] cloud sync init failed (signout path):', err));
    }
    const { handleSignOut } = await import('./app/account-session.js');
    await handleSignOut();
  } else {
    // Normal boot: fire initSync in the background — never block the UI.
    if (!getTestSession()) {
      initSync().catch(err => console.warn('[App] cloud sync init failed:', err));
    }
  }
});
