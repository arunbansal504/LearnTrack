/* ===== main.js — application entry point (ES module) ===== */
import { init } from './app/core.js';
import { navigateTo } from './app/nav.js';
import { showToast } from './app/utils.js';

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
import './app/users.js';
import './app/utils.js';
import './app/widgets.js';

// Exposed for any inline handlers and for console use.
window.App = { init, navigateTo, showToast };

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => console.error('[App] Fatal error:', err));
});
