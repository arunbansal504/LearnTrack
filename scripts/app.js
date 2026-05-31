/* ===================================================
   LEARNTRACK — MAIN APP CONTROLLER
   Routing · Dashboard · Log · Settings · Backup
   =================================================== */

'use strict';

/* ================================================================
   USER MANAGER  —  Multi-profile support
   User list and active-user ID stored in plain localStorage so
   they are accessible before any IndexedDB connection is opened.
   ================================================================ */
const UserManager = (() => {
  const USERS_KEY  = 'lt_users';
  const ACTIVE_KEY = 'lt_active_user';
  const COLORS = ['#6c63ff','#3b82f6','#10b981','#f59e0b','#ec4899','#ef4444'];

  function getUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch { return []; }
  }
  function saveUsers(users) { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }
  function getActiveId()    { return localStorage.getItem(ACTIVE_KEY); }
  function setActiveId(id)  { localStorage.setItem(ACTIVE_KEY, id); }
  function getActive() {
    const id = getActiveId();
    return id ? (getUsers().find(u => u.id === id) || null) : null;
  }
  function createUser(name) {
    const users = getUsers();
    // First user ever gets id 'default' → maps to the original LearnTrackDB (backwards compat)
    const id    = users.length === 0 ? 'default' : `u${Date.now()}`;
    const color = COLORS[users.length % COLORS.length];
    const user  = { id, name: name.trim() || 'Learner', color, createdAt: Date.now() };
    users.push(user);
    saveUsers(users);
    return user;
  }
  function updateUser(id, name) {
    const users = getUsers().map(u => u.id === id ? { ...u, name: name.trim() || u.name } : u);
    saveUsers(users);
  }
  function deleteUser(id) {
    saveUsers(getUsers().filter(u => u.id !== id));
    // Delete IndexedDB for this user
    const dbName = id === 'default' ? 'LearnTrackDB' : `LearnTrackDB_${id}`;
    try { indexedDB.deleteDatabase(dbName); } catch {}
    // Clean up localStorage fallback keys
    const prefix = id === 'default' ? 'lt_' : `lt_${id}_`;
    // Only remove user-specific keys, not the global lt_users / lt_active_user
    Object.keys(localStorage)
      .filter(k => k.startsWith(prefix) && k !== USERS_KEY && k !== ACTIVE_KEY)
      .forEach(k => localStorage.removeItem(k));
  }
  return { getUsers, saveUsers, getActiveId, setActiveId, getActive, createUser, updateUser, deleteUser };
})();

const App = (() => {

  /* ---- State --------------------------------------- */
  let _entries      = [];
  let _prefs        = {};
  let _earnedAch    = [];
  let _autoSaveTimer   = null;
  let _autoBackupTimer = null;
  let _lastAutoBackup  = 0;
  let _currentPage  = 'dashboard';
  let _deletedPage  = 1;
  let _deletedSelection = new Set();
  let _dailyRange    = 7;
  let _monthlyRange  = 3;
  let _categoryRange = 30;
  let _logPage      = 1;
  const LOG_PAGE_SIZE = 20;
  let _monthCollapsedState = {}; // key "YYYY-MM" -> true (collapsed) / false (expanded)
  let _achievementFilterMode = 'all';

  // Pending badge queue
  const _badgeQueue = [];
  let _badgeShowing = false;

  /* ---- Default Preferences ------------------------- */
  const DEFAULT_PREFS = {
    username:      'Learner',
    theme:         'dark',
    accent:        'green',
    compact:       true,
    dailyGoalMin:  60,
    monthlyGoalHr: 20,
    reminder:      false,
    reminderTime:  '20:00',
    categories:    ['Programming','Mathematics','Languages','Science','Design','Business','Other'],
    goalHistory:   [],
  };

  /* ---- Initialization ------------------------------ */

  async function init() {
    document.getElementById('loading-overlay').style.display = 'flex';

    // One-time event-handler setup
    setupNavigation();
    setupSidebar();
    setupMobileNav();
    setupEntryModal();
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
    if (storedBackupTs) { _lastAutoBackup = storedBackupTs; updateSidebarBackupStatus(false); }
    setInterval(updateSidebarBackupStatus, 60000);

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

  async function loadAndShowApp(userId) {
    try {
      await Storage.init(userId);
      _entries   = await Storage.getAllEntries();
      _prefs     = { ...DEFAULT_PREFS, ...(await Storage.getAllPrefs()) };
      _earnedAch = await Storage.getAllAchievements();
    } catch (err) {
      console.error('[App] Load error:', err);
    }

    // One-time startup check: if reminder was saved as enabled but permission is gone, reset silently
    if (_prefs.reminder && (!('Notification' in window) || Notification.permission !== 'granted')) {
      _prefs.reminder = false;
      Storage.setPref('reminder', false);
    }

    applyTheme(_prefs.theme);
    applyAccent(_prefs.accent);
    applyCompact(_prefs.compact);

    // Enforce backup folder setup before the user can interact with the app
    const existingHandle = await Storage.getDirectoryHandle();
    if (!existingHandle) {
      const modal = document.getElementById('backup-required-modal');
      if (modal) modal.style.display = 'flex';
      await waitForBackupFolderSetup();
      if (modal) modal.style.display = 'none';
    }

    updateSidebarUser();
    navigateTo('dashboard');

    setTimeout(() => {
      document.getElementById('loading-overlay').style.opacity = '0';
      document.getElementById('loading-overlay').style.transition = 'opacity 0.4s';
      setTimeout(() => {
        document.getElementById('loading-overlay').style.display = 'none';
        document.getElementById('app').style.display = 'block';
      }, 400);
    }, 600);
  }

  /* ---- Backup folder gate -------------------------- */

  function waitForBackupFolderSetup() {
    return new Promise(resolve => {
      const btn = document.getElementById('backup-required-btn');
      if (!btn) { resolve(); return; }

      async function handler() {
        btn.disabled = true;
        btn.textContent = 'Choosing…';
        const ok = await configureBackupFolder();
        if (ok) {
          btn.removeEventListener('click', handler);
          resolve();
        } else {
          btn.disabled = false;
          btn.textContent = 'Choose Backup Folder';
        }
      }
      btn.addEventListener('click', handler);
    });
  }

  /* ---- Auto Backup --------------------------------- */

  function triggerAutoBackup() {
    clearTimeout(_autoBackupTimer);
    _autoBackupTimer = setTimeout(async () => {
      try {
        await backupCurrentProfile(true);
      } catch (err) {
        showToast('Auto-backup failed — check your backup folder.', 'warning');
      }
    }, 1500);
  }

  function updateSidebarBackupStatus(fresh = false) {
    const el   = document.getElementById('sidebar-backup-status');
    const time = document.getElementById('sidebar-backup-time');
    if (!el || !_lastAutoBackup) return;

    const diffMin = Math.floor((Date.now() - _lastAutoBackup) / 60000);
    const diffHr  = Math.floor(diffMin / 60);
    time.textContent = diffMin < 1  ? 'Just now'
                     : diffMin < 60 ? `${diffMin}m ago`
                     : diffHr < 24  ? `${diffHr}h ago`
                     : 'Over a day ago';

    el.style.display = 'flex';

    if (fresh) {
      el.classList.remove('sbs-pop');
      void el.offsetWidth; // force reflow to restart animation
      el.classList.add('sbs-pop');
    }
  }

  /* ---- Navigation ---------------------------------- */

  function clearLogFilters() {
    ['log-search','filter-date-from','filter-date-to','filter-category','filter-difficulty'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const sort = document.getElementById('filter-sort');
    if (sort) sort.value = 'newest';
    _logPage = 1;
  }

  function setupNavigation() {
    document.querySelectorAll('[data-page]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const page = link.dataset.page;
        if (page === 'log') clearLogFilters();
        if (page) navigateTo(page);
      });
    });

    document.getElementById('daily-quote-chip')?.addEventListener('click', () => {
      setEl('daily-quote-text', Insights.getRandomQuote());
    });
  }

  function navigateTo(page) {
    _currentPage = page;

    // Close mobile sidebar drawer on navigation
    if (window.innerWidth <= 768) closeMobileSidebar();

    // Update sidebar active state
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
      el.setAttribute('aria-current', el.dataset.page === page ? 'page' : 'false');
    });

    // Update mobile nav active state
    document.querySelectorAll('.mobile-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    // Show correct page
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');

    // Reset deleted logs state when navigating away
    if (page !== 'deleted-logs') {
      _deletedPage = 1;
      _deletedSelection.clear();
    }

    renderPage(page);

    // Scroll to top
    window.scrollTo(0, 0);
  }

  /* ---- Sidebar ------------------------------------- */

  function openMobileSidebar() {
    document.getElementById('sidebar')?.classList.add('mobile-open');
    document.getElementById('mobile-sidebar-overlay')?.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeMobileSidebar() {
    document.getElementById('sidebar')?.classList.remove('mobile-open');
    document.getElementById('mobile-sidebar-overlay')?.classList.remove('active');
    document.body.style.overflow = '';
  }

  function setupSidebar() {
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        closeMobileSidebar();
      } else {
        document.getElementById('app').classList.toggle('sidebar-collapsed');
      }
    });
    document.getElementById('user-switch-btn')?.addEventListener('click', () => openUserPicker(true));
    document.getElementById('mobile-sidebar-overlay')?.addEventListener('click', closeMobileSidebar);
  }

  function updateSidebarUser() {
    const streak  = Analytics.calculateStreaks(_entries);
    const stats   = Analytics.calculateTotalStats(_entries);
    const totalXP = Rewards.calculateTotalXP(_entries, streak, _prefs.dailyGoalMin, _prefs.goalHistory);
    const lvInfo  = Rewards.getLevelInfo(totalXP);
    const name    = _prefs.username || 'Learner';

    setEl('sidebar-username', name);
    setEl('sidebar-level', lvInfo.level);
    setEl('sidebar-streak-count', streak.current);
    setEl('user-initials', name.charAt(0).toUpperCase());

    const xpBar = document.getElementById('sidebar-xp-bar');
    if (xpBar) xpBar.style.width = `${lvInfo.progressPct}%`;
    setEl('sidebar-xp-text', `${lvInfo.xpIntoLevel} / ${lvInfo.xpNeededForNext || '∞'} XP`);

    // Tint avatar with user's color
    const activeUser = UserManager.getActive();
    const avatar = document.getElementById('user-avatar');
    if (avatar && activeUser?.color) avatar.style.background = activeUser.color;

    // Show/hide switch button — only meaningful when there are multiple profiles
    const switchBtn = document.getElementById('user-switch-btn');
    if (switchBtn) switchBtn.style.display = UserManager.getUsers().length > 1 ? 'inline-flex' : 'none';
  }

  /* ---- Mobile Nav ---------------------------------- */

  function setupMobileNav() {
    document.getElementById('mobile-more-btn')?.addEventListener('click', e => {
      e.preventDefault();
      openMobileSidebar();
    });

    document.querySelectorAll('.mobile-nav-item[data-action]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        const action = el.dataset.action;
        if (action === 'add-entry') openEntryModal();
      });
    });
  }

  /* ---- Page Rendering ------------------------------ */

  function renderPage(page) {
    switch (page) {
      case 'dashboard':    renderDashboard();    break;
      case 'log':          renderLog();          break;
      case 'deleted-logs': renderDeletedLogs();  break;
      case 'reports':      renderReports();      break;
      case 'calendar':     renderCalendar();     break;
      case 'achievements': renderAchievements(); break;
      case 'profiles':     renderProfiles();     break;
      case 'settings':     renderSettings();     break;
      case 'backup':       renderBackup();       break;
    }
  }

  /* ---- DASHBOARD ----------------------------------- */

  async function renderDashboard() {
    const streak      = Analytics.calculateStreaks(_entries);
    const stats       = Analytics.calculateTotalStats(_entries);
    const consistency = Analytics.calculateConsistency(_entries);
    const weekly      = Analytics.calculateWeeklySummary(_entries);
    const monthly     = Analytics.calculateMonthlySummary(_entries);
    const totalXP     = Rewards.calculateTotalXP(_entries, streak, _prefs.dailyGoalMin, _prefs.goalHistory);
    const lvInfo      = Rewards.getLevelInfo(totalXP);
    const curve       = Analytics.calculateLearningCurve(_entries);

    // Greeting & quote
    const username = _prefs.username || 'Learner';
    const greetingEl = document.getElementById('dashboard-greeting');
    if (greetingEl) {
      const greetingText = Insights.getGreeting(username);
      const splitIdx = greetingText.indexOf('! ');
      if (splitIdx !== -1) {
        greetingEl.innerHTML = `${greetingText.slice(0, splitIdx + 1)}<br>${greetingText.slice(splitIdx + 2)}`;
      } else {
        greetingEl.textContent = greetingText;
      }
    }
    setEl('daily-quote-text', Insights.getDailyQuote());

    // Stat cards (animated counters)
    setEl('stat-total-hours', Analytics.formatDuration(stats.totalMinutes));
    animateCounter('stat-streak', streak.current);
    setEl('stat-longest-streak', `Longest: ${streak.longest} days`);
    animateCounter('stat-entries', stats.totalEntries);
    setEl('stat-avg-hours', Analytics.formatDuration(stats.avgMinutesPerDay));
    animateCounter('stat-consistency', consistency, 0, '%');
    animateCounter('stat-level', lvInfo.level);

    const xpBar = document.getElementById('stat-xp-bar');
    if (xpBar) xpBar.style.width = `${lvInfo.progressPct}%`;
    setEl('stat-xp-text', `${lvInfo.xpIntoLevel} / ${lvInfo.xpNeededForNext || '∞'} XP`);

    // Weekly summary
    setEl('week-period', formatDateRange(weekly.from, weekly.to));
    setEl('week-hours', Analytics.formatHours(weekly.totalMinutes));
    setEl('week-entries', `${weekly.entries} ${weekly.entries === 1 ? 'entry' : 'entries'}`);
    renderWeekBars(weekly.days);

    // Monthly summary
    const monthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    setEl('month-period', monthName);
    setEl('month-hours', Analytics.formatHours(monthly.totalMinutes));
    setEl('month-entries', `${monthly.entries} ${monthly.entries === 1 ? 'entry' : 'entries'}`);
    const monthGoalMin = (_prefs.monthlyGoalHr || 20) * 60;
    const monthPct     = Math.min(100, Math.round((monthly.totalMinutes / monthGoalMin) * 100));
    const monthBar     = document.getElementById('month-progress-bar');
    if (monthBar) monthBar.style.width = `${monthPct}%`;
    setEl('month-goal-text', `${monthPct}% of monthly goal`);

    // Next milestone
    const milestone = Insights.getNextMilestone(_entries, streak, stats);
    setEl('milestone-icon', milestone.icon);
    setEl('milestone-name', milestone.name);
    const milPct = Math.round((milestone.current / milestone.max) * 100);
    const milBar = document.getElementById('milestone-bar');
    if (milBar) milBar.style.width = `${milPct}%`;
    setEl('milestone-meta', `${milestone.current} / ${milestone.max} (${milPct}%)`);

    // Daily goal progress + today summary
    renderGoalProgress();
    renderTodaySummary();

    // Activity feed
    renderActivityFeed();


    // Badges mini grid + medals
    renderBadgesMini();
    renderMedals();

    // Full analytics section
    renderDashboardAnalytics();
  }

  function renderWeekBars(days) {
    const container = document.getElementById('week-bars');
    if (!container) return;

    const maxMin = Math.max(1, ...days.map(d => d.minutes));
    container.innerHTML = days.map(d => {
      const pct = Math.round((d.minutes / maxMin) * 100);
      const cls = d.isToday ? 'today' : d.minutes === 0 ? 'empty' : '';
      return `
        <div class="week-bar-item">
          <div class="week-bar-fill ${cls}" style="height:${Math.max(3, pct * 0.28)}px" title="${d.date}: ${Analytics.formatDuration(d.minutes)}"></div>
          <div class="week-bar-label">${d.label}</div>
        </div>
      `;
    }).join('');
  }

  function renderGoalProgress() {
    const goalMin  = _prefs.dailyGoalMin || 60;
    const todayStr = Analytics.today();
    const todayMin = _entries
      .filter(e => e.date === todayStr)
      .reduce((s, e) => s + (e.durationMinutes || 0), 0);

    const pct    = Math.min(100, Math.round((todayMin / goalMin) * 100));
    const CIRCUM = 2 * Math.PI * 34; // r=34 → ≈213.6

    const ring = document.getElementById('goal-ring-fill');
    if (ring) {
      ring.style.strokeDashoffset = (CIRCUM * (1 - Math.min(1, todayMin / goalMin))).toFixed(2);
      ring.style.stroke = todayMin >= goalMin ? '#10b981'
        : todayMin >= goalMin * 0.5  ? '#f59e0b'
        : 'var(--accent)';
    }

    setEl('goal-today-pct',      `${pct}%`);
    setEl('goal-today-progress', `${Analytics.formatDuration(todayMin)} / ${Analytics.formatDuration(goalMin)}`);

    const status = todayMin === 0            ? 'Start learning today!'
      : todayMin >= goalMin                  ? '🎉 Goal achieved!'
      : todayMin >= Math.round(goalMin * 0.75) ? 'Almost there!'
      : todayMin >= Math.round(goalMin * 0.5)  ? 'Halfway there'
      : 'Keep going!';
    setEl('goal-today-status', status);

    // Weekly goal bars
    const container = document.getElementById('goal-week-days');
    if (!container) return;
    const weekly = Analytics.calculateWeeklySummary(_entries);
    const CHECK_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    container.innerHTML = weekly.days.map(d => {
      const dayPct     = Math.min(100, Math.round((d.minutes / goalMin) * 100));
      const met        = d.minutes >= goalMin;
      const hasData    = d.minutes > 0;
      const stateClass = met ? 'met' : hasData ? 'partial' : 'empty';
      const inner = met
        ? CHECK_SVG
        : hasData ? `<span class="goal-circle-pct">${dayPct}%</span>` : '';
      return `
        <div class="goal-day-item ${stateClass}${d.isToday ? ' is-today' : ''}"
             title="${d.label}: ${Analytics.formatDuration(d.minutes)} / ${Analytics.formatDuration(goalMin)} (${dayPct}%)">
          <div class="goal-day-label">${d.label}</div>
          <div class="goal-day-circle">${inner}</div>
        </div>`;
    }).join('');
  }

  function renderTodaySummary() {
    const todayStr     = Analytics.today();
    const todayEntries = _entries.filter(e => e.date === todayStr);
    const todayMin     = todayEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
    const count        = todayEntries.length;

    setEl('today-time', Analytics.formatDuration(todayMin) || '0m');
    setEl('today-meta', count === 0 ? 'No entries yet' : `${count} ${count === 1 ? 'entry' : 'entries'} logged`);

    // Top topic by time today
    const topicMap = {};
    todayEntries.forEach(e => {
      if (e.topic) topicMap[e.topic] = (topicMap[e.topic] || 0) + (e.durationMinutes || 0);
    });
    const topTopic = Object.entries(topicMap).sort((a, b) => b[1] - a[1])[0];
    setEl('today-topic', topTopic ? `📌 ${topTopic[0]}` : '');

    // Wire log button once
    const btn = document.getElementById('today-log-btn');
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => openEntryModal(null));
    }
  }

  function renderActivityFeed() {
    const container = document.getElementById('activity-list');
    if (!container) return;

    const recent = _entries.slice(0, 8);

    if (recent.length === 0) {
      container.innerHTML = `
        <div class="empty-state-small">
          <span>📭</span>
          <p>No learning entries yet. Start your journey!</p>
        </div>`;
      return;
    }

    container.innerHTML = recent.map(e => `
      <div class="activity-item" data-id="${e.id}" data-difficulty="${e.difficulty || 'easy'}" role="button" tabindex="0">
        <div class="activity-info">
          <span class="activity-topic">${escapeHtml(e.topic)}</span>
          ${e.category ? `<span class="activity-category-pill">${escapeHtml(e.category)}</span>` : ''}
        </div>
        <span class="activity-date">${formatRelativeDate(e.date)}</span>
        <div class="activity-duration">${Analytics.formatDuration(e.durationMinutes || 0)}</div>
      </div>
    `).join('');

    container.querySelectorAll('.activity-item').forEach(el => {
      el.addEventListener('click', () => openEntryModal(el.dataset.id));
    });
  }

  async function renderBadgesMini() {
    const container = document.getElementById('badges-grid-mini');
    if (!container) return;

    const earnedMap = new Map(_earnedAch.map(a => [a.id, a.earnedAt || 0]));
    const allAch    = Rewards.ACHIEVEMENTS;

    // Earned first (most recently earned), then unearned in definition order
    const earned   = allAch.filter(a =>  earnedMap.has(a.id))
                           .sort((a, b) => (earnedMap.get(b.id) || 0) - (earnedMap.get(a.id) || 0));
    const unearned = allAch.filter(a => !earnedMap.has(a.id));
    const display  = [...earned, ...unearned].slice(0, 15);

    container.innerHTML = display.map(ach => `
      <div class="badge-mini ${earnedMap.has(ach.id) ? 'earned' : 'locked'}" title="${ach.name}">
        ${ach.icon}
        <span class="badge-mini-tooltip">${ach.name}</span>
      </div>
    `).join('');

    const summaryEl = document.getElementById('badges-mini-summary');
    if (summaryEl) summaryEl.textContent = `${earned.length} of ${allAch.length} earned`;
  }

  function renderMedals() {
    const medals = Rewards.calculateMedals(_entries, _prefs.dailyGoalMin, _prefs.goalHistory);
    ['gold', 'silver', 'bronze'].forEach(tier => {
      document.querySelectorAll(`.medal-count-${tier}`).forEach(el => {
        el.textContent = medals[tier];
      });
    });
  }

  /* ---- LOG PAGE ------------------------------------ */

  function renderLog() {
    populateCategorySelects();
    renderEntryList();
  }

  function renderEntryList(filter = {}) {
    const container   = document.getElementById('entries-container');
    const emptyState  = document.getElementById('log-empty-state');
    const loadMoreCon = document.getElementById('load-more-container');
    if (!container) return;

    let filtered = applyFilters(_entries, filter);

    if (filtered.length === 0) {
      container.innerHTML = '';
      container.appendChild(emptyState || createEmptyState());
      emptyState && (emptyState.style.display = 'flex');
      if (loadMoreCon) loadMoreCon.style.display = 'none';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    const paginated    = filtered.slice(0, _logPage * LOG_PAGE_SIZE);
    const currentMonth = Analytics.today().slice(0, 7);

    // Group by month
    const groups = {};
    paginated.forEach(e => {
      const key = e.date.slice(0, 7);
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });
    const sortedKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    const groupsHtml = sortedKeys.map(key => {
      const entries  = groups[key];
      const totalMin = entries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
      const count    = entries.length;
      const label    = new Date(key + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      const isCollapsed = key in _monthCollapsedState
        ? _monthCollapsedState[key]
        : key !== currentMonth;

      return `
        <div class="month-group${isCollapsed ? ' collapsed' : ''}" data-month="${key}">
          <div class="month-group-header">
            <div class="month-group-title-row">
              <span class="month-group-title">${label}</span>
              <span class="month-group-count">${count} ${count === 1 ? 'entry' : 'entries'}</span>
            </div>
            <div class="month-group-header-right">
              <span class="month-group-time">${Analytics.formatDuration(totalMin)}</span>
              <svg class="month-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
          <div class="month-group-body">
            ${entries.map(e => createEntryCard(e)).join('')}
          </div>
        </div>`;
    }).join('');

    container.innerHTML = groupsHtml;
    if (emptyState) container.appendChild(emptyState);

    // Toggle collapse
    container.querySelectorAll('.month-group-header').forEach(header => {
      header.addEventListener('click', () => {
        const group       = header.closest('.month-group');
        const key         = group.dataset.month;
        const wasCollapsed = group.classList.contains('collapsed');
        group.classList.toggle('collapsed');
        _monthCollapsedState[key] = !wasCollapsed;
      });
    });

    // Bind card actions
    container.querySelectorAll('.entry-card [data-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        handleEntryAction(btn.dataset.action, btn.closest('.entry-card').dataset.id);
      });
    });

    // Notes link → open floating notes panel with full content from _entries
    container.querySelectorAll('.entry-notes-link').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id    = btn.closest('.entry-card').dataset.id;
        const entry = _entries.find(en => en.id === id);
        if (entry) openNotesPanel(entry.topic, entry.notes || '');
      });
    });

    // Resource links — stop propagation so they don't open the edit modal
    container.querySelectorAll('.entry-resource-link').forEach(a => {
      a.addEventListener('click', e => e.stopPropagation());
    });

    container.querySelectorAll('.entry-card').forEach(card => {
      card.addEventListener('click', e => {
        if (!e.target.closest('[data-action]')) {
          openEntryModal(card.dataset.id);
        }
      });
    });

    // Load more
    if (loadMoreCon) {
      loadMoreCon.style.display = filtered.length > paginated.length ? 'flex' : 'none';
    }
  }

  function createEntryCard(entry) {
    const mood = ['','😞','😐','🙂','😊','🚀'][entry.moodScore || 3];
    const diffColors = { easy:'success', medium:'warning', hard:'danger' };
    const dc = diffColors[entry.difficulty] || 'text-2';
    const d  = new Date(entry.date + 'T12:00:00');

    // Fall back to timestamp encoded in id (format: "<ms>-<random>") if createdAt was lost on edit
    const createdTs = entry.createdAt || (entry.id ? parseInt(entry.id, 10) || 0 : 0);
    const loggedTime = createdTs
      ? new Date(createdTs).toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true,
        })
      : '';

    const resIcons = { link:'🔗', youtube:'▶️', course:'🎓', blog:'📰', github:'🐙', doc:'📄', pdf:'📋' };
    const resourceLinksHtml = (entry.resources || []).filter(r => r.url).map(r => {
      const icon  = resIcons[r.type] || '🔗';
      let   label = r.title || '';
      if (!label) {
        try { label = new URL(r.url).hostname.replace(/^www\./, ''); } catch { label = r.url; }
      }
      return `<a href="${escapeHtml(safeHref(r.url))}" target="_blank" rel="noopener noreferrer" class="entry-resource-link" title="${escapeHtml(r.url)}">${icon} ${escapeHtml(label)}</a>`;
    }).join('');

    const notesText = (entry.notes || '').trim();
    const notesHtml = notesText
      ? `<div class="entry-notes-preview entry-notes-link">${escapeHtml(notesText.length > 90 ? notesText.slice(0, 90) + '…' : notesText)}</div>`
      : '';

    return `
      <div class="entry-card" data-id="${entry.id}" data-difficulty="${entry.difficulty || 'easy'}" tabindex="0" role="article">
        <div class="entry-date-col">
          <div class="entry-date-day">${d.getDate()}</div>
          <div class="entry-date-mon">${d.toLocaleDateString('en-US',{month:'short'})}</div>
        </div>
        <div class="entry-content-col">
          <div class="entry-header">
            <div class="entry-topic">${escapeHtml(entry.topic)}</div>
            ${entry.category ? `<span class="entry-category">${escapeHtml(entry.category)}</span>` : ''}
          </div>
          <div class="entry-meta">
            <span class="entry-meta-item">
              <span class="difficulty-dot ${entry.difficulty}"></span>
              ${capitalise(entry.difficulty || 'easy')}
            </span>
            ${loggedTime ? `<span class="entry-meta-item"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="opacity:0.6"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${loggedTime}</span>` : ''}
          </div>
          ${notesHtml}
          ${resourceLinksHtml ? `<div class="entry-resource-links">${resourceLinksHtml}</div>` : ''}
          ${entry.tags && entry.tags.length ? `
            <div class="entry-tags">
              ${entry.tags.map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}
            </div>` : ''}
        </div>
        <div class="entry-actions-col">
          <span class="entry-duration-badge">${Analytics.formatDuration(entry.durationMinutes || 0)}</span>
          <span class="entry-mood-display">${mood}</span>
          <div class="entry-dropdown">
            <button class="entry-menu-btn" data-action="menu" aria-label="Entry options">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
              </svg>
            </button>
            <div class="dropdown-menu" id="menu-${entry.id}">
              <div class="dropdown-item" data-action="edit">✏️ Edit</div>
              <div class="dropdown-item" data-action="duplicate">📋 Duplicate</div>
              <div class="dropdown-item danger" data-action="delete">🗑️ Delete</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function applyFilters(entries, filter = {}) {
    let list = [...entries];

    const search   = (document.getElementById('log-search')?.value || '').toLowerCase().trim();
    const dateFrom = document.getElementById('filter-date-from')?.value;
    const dateTo   = document.getElementById('filter-date-to')?.value;
    const category = document.getElementById('filter-category')?.value;
    const diff     = document.getElementById('filter-difficulty')?.value;
    const sort     = document.getElementById('filter-sort')?.value || 'newest';

    if (search) {
      list = list.filter(e =>
        e.topic?.toLowerCase().includes(search) ||
        e.notes?.toLowerCase().includes(search) ||
        e.category?.toLowerCase().includes(search) ||
        e.tags?.some(t => t.toLowerCase().includes(search))
      );
    }
    if (dateFrom) list = list.filter(e => e.date >= dateFrom);
    if (dateTo)   list = list.filter(e => e.date <= dateTo);
    if (category) list = list.filter(e => e.category === category);
    if (diff)     list = list.filter(e => e.difficulty === diff);

    const ts = e => e.createdAt || parseInt(e.id, 10) || 0;
    switch (sort) {
      case 'newest':
        list.sort((a, b) => b.date.localeCompare(a.date) || ts(b) - ts(a)); break;
      case 'oldest':
        list.sort((a, b) => a.date.localeCompare(b.date) || ts(a) - ts(b)); break;
      case 'duration-desc': list.sort((a, b) => (b.durationMinutes||0) - (a.durationMinutes||0)); break;
      case 'duration-asc':  list.sort((a, b) => (a.durationMinutes||0) - (b.durationMinutes||0)); break;
    }

    return list;
  }

  function setupFilterPanel() {
    document.getElementById('filter-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('filter-panel');
      if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('filter-clear')?.addEventListener('click', () => {
      ['filter-date-from','filter-date-to','filter-category','filter-difficulty'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const sort = document.getElementById('filter-sort');
      if (sort) sort.value = 'newest';
      renderEntryList();
    });

    ['log-search','filter-date-from','filter-date-to','filter-category','filter-difficulty','filter-sort'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => { _logPage = 1; renderEntryList(); });
      document.getElementById(id)?.addEventListener('input',  () => { _logPage = 1; renderEntryList(); });
    });

    document.getElementById('load-more-btn')?.addEventListener('click', () => {
      _logPage++;
      renderEntryList();
    });

    document.getElementById('add-entry-btn')?.addEventListener('click', () => openEntryModal());
    document.getElementById('quick-add-btn')?.addEventListener('click', () => openEntryModal());
  }

  function handleEntryAction(action, id) {
    // Close all open dropdowns
    document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));

    if (action === 'menu') {
      const menu = document.getElementById(`menu-${id}`);
      if (menu) {
        menu.classList.toggle('open');
        // Close when clicking outside
        setTimeout(() => {
          const handler = (e) => {
            if (!menu.contains(e.target)) {
              menu.classList.remove('open');
              document.removeEventListener('click', handler);
            }
          };
          document.addEventListener('click', handler);
        }, 0);
      }
      return;
    }

    if (action === 'edit')      openEntryModal(id);
    if (action === 'duplicate') duplicateEntry(id);
    if (action === 'delete')    confirmDeleteEntry(id);
  }

  /* ---- Entry Modal --------------------------------- */

  function setupEntryModal() {
    document.getElementById('modal-close')?.addEventListener('click', closeEntryModal);
    document.getElementById('modal-cancel')?.addEventListener('click', closeEntryModal);

    // Entry modal only closes via X or Cancel — not by clicking the backdrop

    document.getElementById('entry-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      await saveEntryFromForm();
    });

    // Mood selector
    document.querySelectorAll('.mood-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const moodInput = document.getElementById('entry-mood');
        if (moodInput) moodInput.value = btn.dataset.mood;
      });
    });

    // Auto-save notes
    document.getElementById('entry-notes')?.addEventListener('input', (e) => {
      updateCharCount(e.target.value.length);
      triggerAutoSave();
    });

    // Add resource
    document.getElementById('add-resource-btn')?.addEventListener('click', addResourceRow);

    // Duplicate button
    document.getElementById('duplicate-entry-btn')?.addEventListener('click', () => {
      const id = document.getElementById('entry-id').value;
      if (id) duplicateEntry(id);
    });

    // Keyboard: Escape to close
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (_notesOverlay && _notesOverlay.classList.contains('visible')) {
          closeNotesPanel();
          return;
        }
        const modal = document.getElementById('entry-modal');
        if (modal && modal.style.display !== 'none') closeEntryModal();
        const badge = document.getElementById('badge-modal');
        if (badge && badge.style.display !== 'none') closeBadgeModal();
        const confirm = document.getElementById('confirm-modal');
        if (confirm && confirm.style.display !== 'none') closeConfirmModal();
      }
    });
  }

  function openEntryModal(id = null, prefillDate = null) {
    const modal   = document.getElementById('entry-modal');
    const form    = document.getElementById('entry-form');
    const title   = document.getElementById('modal-title');
    const dupBtn  = document.getElementById('duplicate-entry-btn');
    if (!modal || !form) return;

    form.reset();
    clearResourceRows();

    const todayStr  = Analytics.today();
    const dateField = document.getElementById('entry-date');

    // New entry defaults: editable within the past year; if a specific date was
    // passed (e.g. from the calendar) lock it to that date instead.
    if (prefillDate) {
      dateField.value    = prefillDate;
      dateField.readOnly = true;
      dateField.removeAttribute('min');
      dateField.removeAttribute('max');
    } else {
      dateField.value    = todayStr;
      dateField.readOnly = false;
      dateField.min      = Analytics.daysAgo(365);
      dateField.max      = todayStr;
    }
    document.getElementById('entry-id').value = '';

    // Reset mood to 4
    document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.mood-btn[data-mood="4"]')?.classList.add('active');
    document.getElementById('entry-mood').value = '4';

    setEl('notes-char-count', '0 characters');
    setEl('notes-last-saved', '');
    clearAutoSaveIndicator();

    populateCategorySelects();

    if (id) {
      const entry = _entries.find(e => e.id === id);
      if (!entry) return;

      title.textContent  = 'Edit Entry';
      // Keep original date when editing — locked so the date can't be changed
      dateField.value    = entry.date;
      dateField.readOnly = true;
      if (dupBtn) dupBtn.style.display = 'inline-flex';
      document.getElementById('entry-id').value          = entry.id;
      document.getElementById('entry-topic').value       = entry.topic || '';
      document.getElementById('entry-category').value    = entry.category || '';
      const durationEl = document.getElementById('entry-duration');
      durationEl.value    = entry.durationMinutes || '';
      durationEl.disabled = false;
      document.getElementById('entry-difficulty').value  = entry.difficulty || 'medium';
      document.getElementById('entry-notes').value       = entry.notes || '';
      document.getElementById('entry-tags').value        = (entry.tags || []).join(', ');

      updateCharCount((entry.notes || '').length);

      // Mood
      document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
      const moodBtn = document.querySelector(`.mood-btn[data-mood="${entry.moodScore || 4}"]`);
      if (moodBtn) moodBtn.classList.add('active');
      document.getElementById('entry-mood').value = entry.moodScore || 4;

      // Resources
      (entry.resources || []).forEach(r => addResourceRow(null, r));

    } else {
      title.textContent = 'New Learning Entry';
      if (dupBtn) dupBtn.style.display = 'none';
      document.getElementById('entry-duration').disabled = false;

      // Restore an in-progress draft (written by triggerAutoSave) if it exists
      // and is less than 1 hour old. Drafts are profile-scoped so switching
      // profiles never shows stale data.
      try {
        const draftKey = `lt_draft_${UserManager.getActiveId() || 'default'}`;
        const raw = localStorage.getItem(draftKey);
        if (raw) {
          const draft = JSON.parse(raw);
          if (draft.savedAt && Date.now() - draft.savedAt < 3_600_000) {
            if (draft.topic) document.getElementById('entry-topic').value = draft.topic;
            if (draft.notes) {
              document.getElementById('entry-notes').value = draft.notes;
              updateCharCount(draft.notes.length);
            }
            setEl('notes-last-saved', `Draft restored (${new Date(draft.savedAt).toLocaleTimeString()})`);
          }
        }
      } catch {}
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('entry-topic')?.focus(), 100);
  }

  function closeEntryModal() {
    document.getElementById('entry-modal').style.display = 'none';
    document.body.style.overflow = '';
    clearAutoSaveTimer();
  }

  /* ---- Floating Notes Panel ------------------------ */

  let _notesOverlay = null;

  function openNotesPanel(topic, notes) {
    if (!_notesOverlay) {
      _notesOverlay = document.createElement('div');
      _notesOverlay.id = 'notes-float-overlay';
      _notesOverlay.innerHTML = `
        <div id="notes-float-panel" role="dialog" aria-modal="true" aria-labelledby="notes-panel-title">
          <div class="notes-panel-header">
            <div class="notes-panel-title-row">
              <span class="notes-panel-icon">📝</span>
              <span class="notes-panel-title" id="notes-panel-title"></span>
            </div>
            <button class="notes-panel-close" id="notes-panel-close" aria-label="Close notes">✕</button>
          </div>
          <div class="notes-panel-body" id="notes-panel-body"></div>
        </div>
      `;
      document.body.appendChild(_notesOverlay);

      document.getElementById('notes-panel-close').addEventListener('click', closeNotesPanel);
      // Close on backdrop click (clicking overlay but not the panel itself)
      _notesOverlay.addEventListener('click', e => {
        if (e.target === _notesOverlay) closeNotesPanel();
      });
    }

    document.getElementById('notes-panel-title').textContent = topic;

    // Build body content — preserve all line breaks without any HTML encoding
    const bodyEl = document.getElementById('notes-panel-body');
    bodyEl.textContent = '';
    const lines = notes.split('\n');
    lines.forEach((line, i) => {
      bodyEl.appendChild(document.createTextNode(line));
      if (i < lines.length - 1) bodyEl.appendChild(document.createElement('br'));
    });

    _notesOverlay.classList.add('visible');
  }

  function closeNotesPanel() {
    if (_notesOverlay) _notesOverlay.classList.remove('visible');
  }

  async function saveEntryFromForm() {
    const id   = document.getElementById('entry-id').value;
    // For edits keep the original stored date (readonly field can be cleared by
    // some browsers' date picker). For new entries read what the user chose.
    const date = id
      ? (_entries.find(e => e.id === id)?.date || Analytics.today())
      : (document.getElementById('entry-date').value || Analytics.today());

    if (!id && date > Analytics.today()) {
      showToast('Cannot log entries for future dates.', 'warning');
      return;
    }
    const topic    = document.getElementById('entry-topic').value.trim();
    const category = document.getElementById('entry-category').value;
    const duration = parseInt(document.getElementById('entry-duration').value, 10);
    const diff     = document.getElementById('entry-difficulty').value;
    const notes    = document.getElementById('entry-notes').value.trim();
    const tags     = document.getElementById('entry-tags').value
                       .split(',').map(t => t.trim()).filter(Boolean);
    const mood     = parseInt(document.getElementById('entry-mood').value, 10) || 4;

    if (!topic) {
      showToast('Please enter a topic.', 'warning');
      return;
    }
    if (!duration || duration < 1) {
      showToast('Please enter a valid duration.', 'warning');
      return;
    }

    // Enforce 24-hour daily cap (1440 min), excluding the entry being edited
    const alreadyLoggedMin = _entries
      .filter(e => e.date === date && e.id !== id)
      .reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
    if (alreadyLoggedMin + duration > 1440) {
      const remaining = 1440 - alreadyLoggedMin;
      showToast(
        remaining > 0
          ? `Daily limit reached. Only ${Analytics.formatDuration(remaining)} remaining for this date.`
          : `You've already logged 24 hours on ${date}. No more entries allowed for this day.`,
        'warning'
      );
      return;
    }

    // Collect resources
    const resources = [];
    document.querySelectorAll('.resource-row').forEach(row => {
      const type  = row.querySelector('.res-type')?.value;
      const title = row.querySelector('.res-title')?.value.trim();
      const url   = row.querySelector('.res-url')?.value.trim();
      if (url) resources.push({ type: type || 'link', title: title || url, url });
    });

    const isNew = !id;
    const existing = id ? _entries.find(e => e.id === id) : null;
    const entry = {
      id:              id || undefined,
      date,
      topic,
      category,
      durationMinutes: duration,
      difficulty:      diff,
      notes,
      resources,
      tags,
      moodScore:       mood,
      ...(existing?.createdAt ? { createdAt: existing.createdAt } : {}),
    };

    const saved = await Storage.saveEntry(entry);

    // Update in-memory
    if (isNew) {
      _entries.unshift(saved);
    } else {
      const idx = _entries.findIndex(e => e.id === saved.id);
      if (idx >= 0) _entries[idx] = saved;
    }

    closeEntryModal();
    // Draft served its purpose — clear it so it doesn't restore on the next new entry
    try {
      localStorage.removeItem(`lt_draft_${UserManager.getActiveId() || 'default'}`);
    } catch {}
    showToast(isNew ? 'Entry saved!' : 'Entry updated!', 'success');

    // Show XP float
    const xp = Rewards.calculateEntryXP(saved);
    Rewards.showXPFloat(xp, document.getElementById('quick-add-btn'));

    // Check achievements
    await checkAchievements();

    // Refresh current page
    renderPage(_currentPage);
    updateSidebarUser();
    triggerAutoBackup();
  }

  /* ---- Resource Rows ------------------------------- */

  function addResourceRow(e, prefill = null) {
    if (e) e.preventDefault();
    const list = document.getElementById('resources-list');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'resource-row';
    row.innerHTML = `
      <select class="res-type">
        <option value="link">🔗 Link</option>
        <option value="youtube">▶️ YouTube</option>
        <option value="course">🎓 Course</option>
        <option value="blog">📰 Blog</option>
        <option value="github">🐙 GitHub</option>
        <option value="doc">📄 Docs</option>
        <option value="pdf">📋 PDF</option>
      </select>
      <input type="text" class="res-title" placeholder="Title (optional)" />
      <input type="url" class="res-url" placeholder="https://..." />
      <button type="button" class="resource-remove" aria-label="Remove resource">✕</button>
    `;

    if (prefill) {
      row.querySelector('.res-type').value  = prefill.type  || 'link';
      row.querySelector('.res-title').value = prefill.title || '';
      row.querySelector('.res-url').value   = prefill.url   || '';
    }

    row.querySelector('.resource-remove')?.addEventListener('click', () => row.remove());
    list.appendChild(row);
  }

  function clearResourceRows() {
    const list = document.getElementById('resources-list');
    if (list) list.innerHTML = '';
  }

  /* ---- Auto-Save ----------------------------------- */

  function triggerAutoSave() {
    clearAutoSaveTimer();
    setAutoSaveState('saving');

    _autoSaveTimer = setTimeout(() => {
      const draft = {
        topic:   document.getElementById('entry-topic')?.value,
        notes:   document.getElementById('entry-notes')?.value,
        savedAt: Date.now(),
      };
      try {
        const draftKey = `lt_draft_${UserManager.getActiveId() || 'default'}`;
        localStorage.setItem(draftKey, JSON.stringify(draft));
        setAutoSaveState('saved');
        setEl('notes-last-saved', `Saved ${new Date().toLocaleTimeString()}`);
      } catch {
        setAutoSaveState('error');
      }
    }, 800);
  }

  function clearAutoSaveTimer() {
    if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
  }

  function setAutoSaveState(state) {
    const ind = document.getElementById('autosave-indicator');
    const txt = document.getElementById('autosave-text');
    if (!ind) return;
    ind.className = `autosave-indicator ${state}`;
    if (txt) {
      txt.textContent = state === 'saving' ? 'Saving...' : state === 'saved' ? 'Saved' : 'Save failed';
    }
  }

  function clearAutoSaveIndicator() {
    const ind = document.getElementById('autosave-indicator');
    if (ind) ind.className = 'autosave-indicator';
    const txt = document.getElementById('autosave-text');
    if (txt) txt.textContent = '';
  }

  function updateCharCount(n) {
    setEl('notes-char-count', `${n} character${n !== 1 ? 's' : ''}`);
  }

  /* ---- Delete / Duplicate -------------------------- */

  function confirmDeleteEntry(id) {
    showConfirm('Delete this entry?', 'It will move to Deleted Logs where you can restore it.', async () => {
      await Storage.softDeleteEntry(id);
      _entries = _entries.filter(e => e.id !== id);
      await checkAchievements();
      showToast('Entry moved to Deleted Logs', 'info');
      renderPage(_currentPage);
      updateSidebarUser();
      triggerAutoBackup();
    });
  }

  async function duplicateEntry(id) {
    const entry = _entries.find(e => e.id === id);
    if (!entry) return;
    openEntryModal(null);
    setTimeout(() => {
      document.getElementById('entry-topic').value      = `${entry.topic} (copy)`;
      document.getElementById('entry-category').value   = entry.category || '';
      document.getElementById('entry-duration').value   = entry.durationMinutes || '';
      document.getElementById('entry-difficulty').value = entry.difficulty || 'medium';
      document.getElementById('entry-notes').value      = entry.notes || '';
      document.getElementById('entry-tags').value       = (entry.tags || []).join(', ');
      document.querySelector(`.mood-btn[data-mood="${entry.moodScore || 4}"]`)?.click();
      (entry.resources || []).forEach(r => addResourceRow(null, r));
    }, 50);
  }

  /* ---- DELETED LOGS PAGE --------------------------- */

  function setupDeletedLogsPage() {
    document.getElementById('dl-filter-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('dl-filter-panel');
      if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('dl-filter-clear')?.addEventListener('click', () => {
      ['dl-filter-date-from','dl-filter-date-to','dl-filter-category','dl-filter-difficulty'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const sort = document.getElementById('dl-filter-sort');
      if (sort) sort.value = 'deleted-newest';
      _deletedPage = 1;
      renderDeletedLogs();
    });

    ['dl-search','dl-filter-date-from','dl-filter-date-to','dl-filter-category','dl-filter-difficulty','dl-filter-sort'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => { _deletedPage = 1; renderDeletedLogs(); });
      document.getElementById(id)?.addEventListener('input',  () => { _deletedPage = 1; renderDeletedLogs(); });
    });

    document.getElementById('dl-load-more-btn')?.addEventListener('click', () => {
      _deletedPage++;
      renderDeletedLogs();
    });

    document.getElementById('dl-select-all')?.addEventListener('change', e => {
      const checked = e.target.checked;
      document.querySelectorAll('.dl-checkbox').forEach(cb => {
        cb.checked = checked;
        checked ? _deletedSelection.add(cb.dataset.id) : _deletedSelection.delete(cb.dataset.id);
      });
      updateDlBulkBar();
    });

    document.getElementById('dl-clear-selection-btn')?.addEventListener('click', () => {
      _deletedSelection.clear();
      document.querySelectorAll('.dl-checkbox').forEach(cb => { cb.checked = false; });
      const all = document.getElementById('dl-select-all');
      if (all) all.checked = false;
      updateDlBulkBar();
    });

    document.getElementById('dl-bulk-delete-btn')?.addEventListener('click', () => {
      if (!_deletedSelection.size) return;
      const n = _deletedSelection.size;
      showConfirm(
        `Permanently delete ${n} ${n === 1 ? 'entry' : 'entries'}?`,
        'This cannot be undone.',
        async () => {
          await Promise.all([..._deletedSelection].map(id => Storage.permanentlyDeleteEntry(id)));
          _deletedSelection.clear();
          showToast(`${n} ${n === 1 ? 'entry' : 'entries'} permanently deleted`, 'info');
          _deletedPage = 1;
          await renderDeletedLogs();
          triggerAutoBackup();
        }
      );
    });

    document.getElementById('dl-bulk-restore-btn')?.addEventListener('click', async () => {
      if (!_deletedSelection.size) return;
      const ids = [..._deletedSelection];
      await Promise.all(ids.map(id => Storage.restoreEntry(id)));
      for (const id of ids) {
        const restored = await Storage.getEntry(id);
        if (restored) _entries.push(restored);
      }
      _entries.sort((a, b) => new Date(b.date) - new Date(a.date));
      _deletedSelection.clear();
      await checkAchievements();
      showToast(`${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} restored to Daily Log`, 'success');
      _deletedPage = 1;
      await renderDeletedLogs();
      updateSidebarUser();
      triggerAutoBackup();
    });
  }

  function updateDlBulkBar() {
    const selBar   = document.getElementById('dl-selection-bar');
    const bulkActs = document.getElementById('dl-bulk-actions');
    const label    = document.getElementById('dl-selection-label');
    const allCheck = document.getElementById('dl-select-all');
    const allCbs   = document.querySelectorAll('.dl-checkbox');
    const total    = allCbs.length;
    const n        = _deletedSelection.size;

    // Show selection bar only when entries are rendered
    if (selBar) selBar.style.display = total > 0 ? 'flex' : 'none';

    // Top-level select-all state
    if (allCheck) {
      allCheck.indeterminate = n > 0 && n < total;
      allCheck.checked = total > 0 && n === total;
    }

    // Label: "Select all (N)" when nothing selected, "N of M selected" otherwise
    if (label) label.textContent = n === 0 ? `Select all (${total})` : `${n} of ${total} selected`;

    // Bulk action buttons: only when something is selected
    if (bulkActs) bulkActs.style.display = n > 0 ? 'flex' : 'none';

    // Sync selected visual state on cards
    document.querySelectorAll('.dl-entry-card').forEach(card => {
      card.classList.toggle('dl-selected', _deletedSelection.has(card.dataset.id));
    });

    // Month-level checkbox states
    document.querySelectorAll('.dl-month-checkbox').forEach(mcb => {
      const monthCbs  = document.querySelectorAll(`.dl-checkbox[data-month-key="${mcb.dataset.month}"]`);
      const selCount  = [...monthCbs].filter(cb => _deletedSelection.has(cb.dataset.id)).length;
      mcb.indeterminate = selCount > 0 && selCount < monthCbs.length;
      mcb.checked = monthCbs.length > 0 && selCount === monthCbs.length;
    });
  }

  function applyDeletedFilters(entries) {
    let list = [...entries];

    const search   = (document.getElementById('dl-search')?.value || '').toLowerCase().trim();
    const dateFrom = document.getElementById('dl-filter-date-from')?.value;
    const dateTo   = document.getElementById('dl-filter-date-to')?.value;
    const category = document.getElementById('dl-filter-category')?.value;
    const diff     = document.getElementById('dl-filter-difficulty')?.value;
    const sort     = document.getElementById('dl-filter-sort')?.value || 'deleted-newest';

    if (search)   list = list.filter(e =>
      e.topic?.toLowerCase().includes(search) ||
      e.notes?.toLowerCase().includes(search) ||
      e.category?.toLowerCase().includes(search) ||
      e.tags?.some(t => t.toLowerCase().includes(search))
    );
    if (dateFrom) list = list.filter(e => e.date >= dateFrom);
    if (dateTo)   list = list.filter(e => e.date <= dateTo);
    if (category) list = list.filter(e => e.category === category);
    if (diff)     list = list.filter(e => e.difficulty === diff);

    switch (sort) {
      case 'deleted-newest':  list.sort((a, b) => b.deletedAt - a.deletedAt); break;
      case 'deleted-oldest':  list.sort((a, b) => a.deletedAt - b.deletedAt); break;
      case 'newest':          list.sort((a, b) => b.date.localeCompare(a.date)); break;
      case 'oldest':          list.sort((a, b) => a.date.localeCompare(b.date)); break;
      case 'duration-desc':   list.sort((a, b) => (b.durationMinutes||0) - (a.durationMinutes||0)); break;
      case 'duration-asc':    list.sort((a, b) => (a.durationMinutes||0) - (b.durationMinutes||0)); break;
    }
    return list;
  }

  function createDeletedEntryCard(entry) {
    const mood  = ['','😞','😐','🙂','😊','🚀'][entry.moodScore || 3];
    const d     = new Date(entry.date + 'T12:00:00');
    const diffMin = Math.floor((Date.now() - entry.deletedAt) / 60000);
    const diffHr  = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    const deletedAgo = diffDay > 0  ? `${diffDay}d ago`
                     : diffHr  > 0  ? `${diffHr}h ago`
                     : diffMin > 0  ? `${diffMin}m ago`
                     : 'just now';
    const deletedFull = new Date(entry.deletedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      + ' · ' + new Date(entry.deletedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    const checked  = _deletedSelection.has(entry.id) ? 'checked' : '';
    const selClass = _deletedSelection.has(entry.id) ? ' dl-selected' : '';
    const notesText = (entry.notes || '').trim();

    return `
      <div class="dl-entry-card${selClass}" data-id="${entry.id}" tabindex="0" role="article">
        <div class="dl-card-checkbox">
          <label style="display:flex;align-items:center;cursor:pointer" onclick="event.stopPropagation()">
            <input type="checkbox" class="dl-checkbox" data-id="${entry.id}" data-month-key="${entry.date.slice(0,7)}" ${checked}
              style="width:15px;height:15px;cursor:pointer;accent-color:var(--accent)" />
          </label>
        </div>
        <div class="dl-card-date">
          <div class="dl-card-date-day">${d.getDate()}</div>
          <div class="dl-card-date-mon">${d.toLocaleDateString('en-US',{month:'short'})}</div>
        </div>
        <div class="dl-card-body">
          <div class="dl-card-header">
            <span class="dl-card-topic">${escapeHtml(entry.topic)}</span>
            ${entry.category ? `<span class="entry-category">${escapeHtml(entry.category)}</span>` : ''}
          </div>
          <div class="dl-card-meta">
            <span class="entry-meta-item"><span class="difficulty-dot ${entry.difficulty}"></span>${capitalise(entry.difficulty || 'easy')}</span>
            <span>${mood}</span>
            <span class="entry-duration-badge">${Analytics.formatDuration(entry.durationMinutes || 0)}</span>
          </div>
          ${notesText ? `<div class="entry-notes-preview">${escapeHtml(notesText.length > 90 ? notesText.slice(0,90) + '…' : notesText)}</div>` : ''}
          ${entry.tags && entry.tags.length ? `<div class="entry-tags">${entry.tags.map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="dl-card-actions">
          <div class="dl-deleted-badge" title="${deletedFull}">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            ${deletedAgo}
          </div>
          <div class="dl-action-row">
            <button class="dl-restore-btn" data-restore="${entry.id}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              Restore
            </button>
            <button class="dl-delete-icon-btn" data-perm-delete="${entry.id}" title="Delete permanently">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </button>
          </div>
        </div>
      </div>`;
  }

  async function renderDeletedLogs() {
    const container    = document.getElementById('dl-entries-container');
    const loadMoreCon  = document.getElementById('dl-load-more-container');
    if (!container) return;

    populateCategorySelects();

    const allDeleted = await Storage.getDeletedEntries();
    const filtered   = applyDeletedFilters(allDeleted);
    const paginated  = filtered.slice(0, _deletedPage * LOG_PAGE_SIZE);

    if (filtered.length === 0) {
      const isEmpty = allDeleted.length === 0;
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${isEmpty ? '🗑️' : '🔍'}</div>
          <h3>${isEmpty ? 'Recycle bin is empty' : 'No matching entries'}</h3>
          <p>${isEmpty ? 'Deleted entries will appear here.' : 'Try adjusting your search or filters.'}</p>
        </div>`;
      if (loadMoreCon) loadMoreCon.style.display = 'none';
      updateDlBulkBar();
      return;
    }

    // Group by month
    const groups = {};
    paginated.forEach(e => {
      const key = e.date.slice(0, 7);
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });
    const sortedKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    container.innerHTML = sortedKeys.map(key => {
      const entries  = groups[key];
      const totalMin = entries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
      const count    = entries.length;
      const label    = new Date(key + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      return `
        <div class="month-group" data-month="${key}">
          <div class="month-group-header">
            <label style="display:flex;align-items:center;margin-right:6px;cursor:pointer" onclick="event.stopPropagation()">
              <input type="checkbox" class="dl-month-checkbox" data-month="${key}" style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer" />
            </label>
            <div class="month-group-title-row">
              <span class="month-group-title">${label}</span>
              <span class="month-group-meta">${count} ${count === 1 ? 'entry' : 'entries'} &middot; ${Analytics.formatDuration(totalMin)}</span>
            </div>
            <svg class="month-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
          <div class="month-group-body">
            ${entries.map(e => createDeletedEntryCard(e)).join('')}
          </div>
        </div>`;
    }).join('');

    // Collapse toggle
    container.querySelectorAll('.month-group-header').forEach(header => {
      header.addEventListener('click', () => header.closest('.month-group').classList.toggle('collapsed'));
    });

    // Month-level select all
    container.querySelectorAll('.dl-month-checkbox').forEach(mcb => {
      mcb.addEventListener('change', e => {
        e.stopPropagation();
        const monthCbs = container.querySelectorAll(`.dl-checkbox[data-month-key="${mcb.dataset.month}"]`);
        monthCbs.forEach(cb => {
          cb.checked = mcb.checked;
          mcb.checked ? _deletedSelection.add(cb.dataset.id) : _deletedSelection.delete(cb.dataset.id);
        });
        updateDlBulkBar();
      });
    });

    // Checkbox change
    container.querySelectorAll('.dl-checkbox').forEach(cb => {
      cb.addEventListener('change', e => {
        e.stopPropagation();
        cb.checked ? _deletedSelection.add(cb.dataset.id) : _deletedSelection.delete(cb.dataset.id);
        updateDlBulkBar();
      });
    });

    // Restore / permanent delete buttons
    container.querySelectorAll('[data-restore]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); restoreDeletedEntry(btn.dataset.restore); });
    });
    container.querySelectorAll('[data-perm-delete]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); permanentDeleteEntry(btn.dataset.permDelete); });
    });

    if (loadMoreCon) loadMoreCon.style.display = filtered.length > paginated.length ? 'flex' : 'none';
    updateDlBulkBar();
  }

  async function restoreDeletedEntry(id) {
    await Storage.restoreEntry(id);
    const restored = await Storage.getEntry(id);
    if (restored) _entries.push(restored);
    _entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    _deletedSelection.delete(id);
    await checkAchievements();
    showToast('Entry restored to Daily Log', 'success');
    await renderDeletedLogs();
    updateSidebarUser();
    triggerAutoBackup();
  }

  function permanentDeleteEntry(id) {
    showConfirm('Delete permanently?', 'This cannot be undone — the entry will be gone forever.', async () => {
      await Storage.permanentlyDeleteEntry(id);
      _deletedSelection.delete(id);
      showToast('Entry permanently deleted', 'info');
      await renderDeletedLogs();
      triggerAutoBackup();
    });
  }

  /* ---- ANALYTICS (embedded in dashboard) ----------- */

  function _scopedEntries(rangeVal) {
    if (rangeVal === 'all') return _entries;
    const days = parseInt(rangeVal, 10);
    return _entries.filter(e => e.date >= Analytics.daysAgo(days));
  }

  function _wireChartTabs(containerId, getVal, setVal, onRefresh) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!container._wired) {
      container._wired = true;
      container.addEventListener('click', e => {
        const btn = e.target.closest('.chart-range-tab');
        if (!btn) return;
        setVal(btn.dataset.val);
        container.querySelectorAll('.chart-range-tab').forEach(b =>
          b.classList.toggle('active', b === btn)
        );
        onRefresh();
      });
    }
    container.querySelectorAll('.chart-range-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === String(getVal()));
    });
  }

  function renderDashboardDailyChart() {
    const days = _dailyRange === 'all' ? 3650 : parseInt(_dailyRange, 10);
    Charts.renderDailyTimeChart('daily-time-chart',
      Analytics.calculateDailyTimeSeries(_scopedEntries(_dailyRange), Math.min(days, 90)));
  }

  function renderDashboardMonthlyChart() {
    Charts.renderMonthlyChart('monthly-progress-chart',
      Analytics.calculateMonthlyTotals(_entries, parseInt(_monthlyRange, 10)));
  }

  function renderDashboardCategoryChart() {
    Charts.renderTopicChart('topic-distribution-chart',
      Analytics.calculateTopicDistribution(_scopedEntries(_categoryRange), _prefs.categories || DEFAULT_PREFS.categories));
  }

  function renderDashboardAnalytics() {
    const streak      = Analytics.calculateStreaks(_entries);
    const stats       = Analytics.calculateTotalStats(_entries);
    const consistency = Analytics.calculateConsistency(_entries);
    const curve       = Analytics.calculateLearningCurve(_entries);
    const insights    = Insights.generateInsights(_entries, streak, stats, consistency, curve);
    Insights.renderInsightsRow('insights-row', insights);

    setTimeout(() => {
      renderDashboardDailyChart();
      renderDashboardMonthlyChart();
      renderDashboardCategoryChart();
      Charts.renderHeatmap('heatmap-container', Analytics.calculateHeatmapData(_entries));
    }, 50);

    _wireChartTabs('daily-range-tabs',
      () => _dailyRange,    v => { _dailyRange    = v; }, renderDashboardDailyChart);
    _wireChartTabs('monthly-range-tabs',
      () => _monthlyRange,  v => { _monthlyRange  = v; }, renderDashboardMonthlyChart);
    _wireChartTabs('category-range-tabs',
      () => _categoryRange, v => { _categoryRange = v; }, renderDashboardCategoryChart);
  }

  /* ---- REPORTS PAGE -------------------------------- */

  function renderReports() {
    populateReportMonthSelect();
    const preview = document.getElementById('report-preview');
    if (preview) { preview.classList.add('hidden'); preview.innerHTML = ''; }
    const dlBtn = document.getElementById('download-report-btn');
    if (dlBtn && !dlBtn._bound) {
      dlBtn._bound = true;
      dlBtn.addEventListener('click', generateMonthlyReport);
    }
    const pvBtn = document.getElementById('preview-report-btn');
    if (pvBtn && !pvBtn._bound) {
      pvBtn._bound = true;
      pvBtn.addEventListener('click', renderReportPreview);
    }
  }

  /* ---- CALENDAR PAGE ------------------------------- */

  function renderCalendar() {
    Calendar.init(_entries, {
      onDateSelect: (ds, entries, entry) => {
        if (entry) openEntryModal(entry.id);
      },
      onAddEntry: (ds) => {
        openEntryModal(null, ds);
      },
      onViewEntries: (ds) => {
        const fromEl = document.getElementById('filter-date-from');
        const toEl   = document.getElementById('filter-date-to');
        if (fromEl) fromEl.value = ds;
        if (toEl)   toEl.value   = ds;
        _logPage = 1;
        navigateTo('log');
      },
    });
  }

  /* ---- ACHIEVEMENTS PAGE --------------------------- */

  async function renderAchievements() {
    const streak      = Analytics.calculateStreaks(_entries);
    const stats       = Analytics.calculateTotalStats(_entries);
    const consistency = Analytics.calculateConsistency(_entries);
    const totalXP     = Rewards.calculateTotalXP(_entries, streak, _prefs.dailyGoalMin, _prefs.goalHistory);
    const lvInfo      = Rewards.getLevelInfo(totalXP);

    // Medals
    renderMedals();

    // Level hero
    animateCounter('achievement-level', lvInfo.level);
    setEl('level-title', lvInfo.title);
    setEl('level-xp', `${lvInfo.xpIntoLevel} / ${lvInfo.xpNeededForNext || '∞'} XP`);
    const lvXpBar = document.getElementById('level-xp-bar');
    if (lvXpBar) lvXpBar.style.width = `${lvInfo.progressPct}%`;

    animateCounter('total-xp', totalXP);

    // Level ring SVG
    const ringFill = document.getElementById('level-ring-fill');
    if (ringFill) {
      const circumference = 276.5;
      const offset = circumference - (lvInfo.progressPct / 100) * circumference;
      ringFill.style.strokeDashoffset = offset;
    }

    // Achievements grid
    const allAch = await Rewards.buildAchievementList(_entries, streak, stats, consistency, _prefs.dailyGoalMin, _prefs.goalHistory);
    const earnedCount = allAch.filter(a => a.earned).length;
    animateCounter('badges-earned-count', earnedCount);

    const filtered = allAch.filter(a => {
      if (_achievementFilterMode === 'earned') return a.earned;
      if (_achievementFilterMode === 'locked') return !a.earned;
      return true;
    });

    renderAchievementsGrid(filtered);

    // Filter pills
    document.querySelectorAll('.filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _achievementFilterMode = btn.dataset.filter;
        renderAchievements();
      });
    });
  }

  function renderAchievementsGrid(achievements) {
    const grid = document.getElementById('achievements-grid');
    if (!grid) return;

    if (achievements.length === 0) {
      grid.innerHTML = '<div class="empty-state-small"><span>🏆</span><p>No achievements in this category</p></div>';
      return;
    }

    grid.innerHTML = achievements.map(ach => `
      <div class="achievement-card ${ach.earned ? 'earned' : 'locked'}" title="${ach.name}">
        <span class="achievement-xp-badge">+${ach.xp} XP</span>
        ${ach.earned ? '<span class="achievement-earned-badge">✅</span>' : ''}
        <div class="achievement-icon">${ach.icon}</div>
        <div class="achievement-name">${ach.name}</div>
        <div class="achievement-desc">${ach.desc}</div>
        <div class="achievement-progress-bar-wrap">
          <div class="achievement-progress-bar" style="width:${ach.progressPct}%"></div>
        </div>
        <div class="achievement-progress-text">${ach.progressCurrent} / ${ach.progressMax}</div>
        ${ach.earnedAt ? `<div class="achievement-progress-text" style="margin-top:4px;color:var(--success)">Earned ${new Date(ach.earnedAt).toLocaleDateString()}</div>` : ''}
      </div>
    `).join('');
  }

  /* ---- PROFILES PAGE ------------------------------- */

  function renderProfiles() {
    renderUsersManagement();
  }

  /* ---- SETTINGS PAGE ------------------------------- */

  function renderSettings() {
    setInputVal('setting-username',      _prefs.username || '');
    setInputVal('setting-daily-goal',    _prefs.dailyGoalMin || 60);
    setInputVal('setting-monthly-goal',  _prefs.monthlyGoalHr || 20);
    setInputVal('setting-reminder-time', _prefs.reminderTime || '20:00');
    setCheckbox('setting-compact',    _prefs.compact || false);
    setCheckbox('setting-reminder',   _prefs.reminder || false);

    // Theme options highlight
    document.querySelectorAll('.theme-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === (_prefs.theme || 'dark'));
    });

    // Accent options
    document.querySelectorAll('.accent-swatch').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.accent === (_prefs.accent || 'purple'));
    });

    // Reminder time row
    const rtRow = document.getElementById('reminder-time-row');
    if (rtRow) rtRow.style.display = _prefs.reminder ? 'flex' : 'none';

    renderCategories();
    renderUsersManagement();
  }

  function setupSettings() {
    document.getElementById('save-profile-btn')?.addEventListener('click', saveProfile);

    ['setting-username', 'setting-daily-goal', 'setting-monthly-goal'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const btn = document.getElementById('save-profile-btn');
          if (btn) {
            btn.classList.add('btn-press');
            setTimeout(() => btn.classList.remove('btn-press'), 300);
          }
          saveProfile();
        }
      });
    });

    document.querySelectorAll('.theme-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        const theme = btn.dataset.theme;
        _prefs.theme = theme;
        await Storage.setPref('theme', theme);
        applyTheme(theme);
        document.querySelectorAll('.theme-option').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
      });
    });

    document.querySelectorAll('.accent-swatch').forEach(btn => {
      btn.addEventListener('click', async () => {
        const accent = btn.dataset.accent;
        _prefs.accent = accent;
        await Storage.setPref('accent', accent);
        applyAccent(accent);
        document.querySelectorAll('.accent-swatch').forEach(b => b.classList.toggle('active', b.dataset.accent === accent));
        Charts.refreshAllCharts();
      });
    });

    document.getElementById('setting-compact')?.addEventListener('change', async e => {
      _prefs.compact = e.target.checked;
      await Storage.setPref('compact', e.target.checked);
      applyCompact(e.target.checked);
    });

    document.getElementById('setting-reminder')?.addEventListener('change', async e => {
      const enabled = e.target.checked;
      const rtRow   = document.getElementById('reminder-time-row');

      if (enabled) {
        if (!('Notification' in window)) {
          showToast('Your browser does not support notifications.', 'error');
          e.target.checked = false;
          return;
        }
        let perm = Notification.permission;
        if (perm === 'default') perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          showToast(
            perm === 'denied'
              ? 'Notifications are blocked. Enable them in your browser settings, then try again.'
              : 'Notification permission is required for reminders.',
            'warning'
          );
          e.target.checked = false;
          return;
        }
        showToast(`Reminder set for ${_prefs.reminderTime || '20:00'} daily.`, 'success');
      }

      _prefs.reminder = enabled;
      await Storage.setPref('reminder', enabled);
      if (rtRow) rtRow.style.display = enabled ? 'flex' : 'none';
    });

    document.getElementById('setting-reminder-time')?.addEventListener('change', async e => {
      _prefs.reminderTime = e.target.value;
      await Storage.setPref('reminderTime', e.target.value);
    });

    document.getElementById('add-category-btn')?.addEventListener('click', addCategory);
    document.getElementById('new-category-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addCategory(); }
    });
    document.getElementById('add-profile-btn')?.addEventListener('click', () => openUserPicker(true));

    document.getElementById('reset-data-btn')?.addEventListener('click', () => {
      showConfirm('Reset all data?', 'This will permanently delete ALL your entries, achievements, and settings. This cannot be undone!', async () => {
        await Storage.resetAll();
        _entries   = [];
        _prefs     = { ...DEFAULT_PREFS };
        _earnedAch = [];
        // Preserve the profile name from UserManager — it lives outside IndexedDB
        const activeUser = UserManager.getActive();
        if (activeUser) {
          _prefs.username = activeUser.name;
          await Storage.setPref('username', activeUser.name);
        }
        applyTheme(_prefs.theme);
        applyAccent(_prefs.accent);
        applyCompact(_prefs.compact);
        renderPage(_currentPage);
        updateSidebarUser();
        showToast('All data has been reset.', 'warning');
      });
    });
  }

  async function saveProfile() {
    const name  = document.getElementById('setting-username')?.value.trim() || 'Learner';
    const daily = parseInt(document.getElementById('setting-daily-goal')?.value, 10) || 60;
    const monthly = parseInt(document.getElementById('setting-monthly-goal')?.value, 10) || 20;
    const reminderTime = document.getElementById('setting-reminder-time')?.value || '20:00';

    // Track goal history so past medals/badges use the goal that was active then
    if (daily !== _prefs.dailyGoalMin) {
      const today = Analytics.today();
      const history = [...(_prefs.goalHistory || [])];
      const idx = history.findIndex(g => g.from === today);
      if (idx >= 0) history[idx].goalMin = daily; else history.push({ from: today, goalMin: daily });
      _prefs.goalHistory = history;
      await Storage.setPref('goalHistory', history);
    }

    _prefs.username      = name;
    _prefs.dailyGoalMin  = daily;
    _prefs.monthlyGoalHr = monthly;
    _prefs.reminderTime  = reminderTime;

    await Storage.setPref('username', name);
    await Storage.setPref('dailyGoalMin', daily);
    await Storage.setPref('monthlyGoalHr', monthly);
    await Storage.setPref('reminderTime', reminderTime);

    updateSidebarUser();
    showToast('Profile saved!', 'success');
  }

  function renderCategories() {
    const list = document.getElementById('categories-list');
    if (!list) return;
    const cats = _prefs.categories || DEFAULT_PREFS.categories;
    list.innerHTML = cats.map(c => `
      <div class="category-item">
        <span>${escapeHtml(c)}</span>
        <button class="category-delete" data-cat="${escapeHtml(c)}" aria-label="Delete ${c}">✕</button>
      </div>
    `).join('');
    list.querySelectorAll('.category-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteCategory(btn.dataset.cat));
    });
  }

  async function addCategory() {
    const input = document.getElementById('new-category-input');
    const val   = input?.value.trim();
    if (!val) return;
    const cats = _prefs.categories || [];
    if (cats.includes(val)) { showToast('Category already exists', 'warning'); return; }
    cats.push(val);
    _prefs.categories = cats;
    await Storage.setPref('categories', cats);
    if (input) input.value = '';
    renderCategories();
    populateCategorySelects();
  }

  async function deleteCategory(cat) {
    const cats = (_prefs.categories || []).filter(c => c !== cat);
    _prefs.categories = cats;
    await Storage.setPref('categories', cats);
    renderCategories();
    populateCategorySelects();
  }

  function populateCategorySelects() {
    const cats = _prefs.categories || DEFAULT_PREFS.categories;
    ['entry-category', 'filter-category', 'dl-filter-category'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const current = sel.value;
      const defaultOpt = id === 'entry-category' ? '<option value="">Select category</option>' : '<option value="">All categories</option>';
      sel.innerHTML = defaultOpt + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      sel.value = current;
    });
  }

  /* ---- BACKUP PAGE --------------------------------- */

  function renderBackup() {
    const activeUser = UserManager.getActive();
    const filename   = getBackupFilename(activeUser);
    const folderName = localStorage.getItem('lt_backupFolderName');

    setEl('backup-entries-count',  _entries.length);
    setEl('backup-profile-name',   activeUser?.name || '—');
    setEl('backup-filename',       filename);
    setEl('restore-profile-name',  activeUser?.name || '—');
    setEl('restore-filename',      filename);

    // Show/hide folder configured vs. unconfigured sections
    const configured = !!folderName;
    document.getElementById('backup-folder-configured')?.classList.toggle('hidden', !configured);
    document.getElementById('backup-folder-unconfigured')?.classList.toggle('hidden', configured);
    document.getElementById('restore-folder-info')?.classList.toggle('hidden', !configured);
    document.getElementById('restore-folder-unconfigured')?.classList.toggle('hidden', configured);

    if (configured) {
      setEl('backup-folder-name',  folderName);
      setEl('restore-folder-name', folderName);
    }

    Storage.getPref('lastBackupDate').then(d => {
      setEl('last-backup-date', d ? new Date(d).toLocaleDateString() : 'Never');
    });

    renderBackupLog();
  }

  async function renderBackupLog() {
    const container = document.getElementById('backup-history-list');
    if (!container) return;

    const logs = await Storage.getBackupLog();
    if (logs.length === 0) {
      container.innerHTML = '<div class="empty-state-small"><span>📭</span><p>No backups recorded yet.</p></div>';
      return;
    }

    container.innerHTML = logs.map(log => `
      <div class="backup-history-item">
        <span>${log.type === 'export' ? '💾' : '📂'} ${escapeHtml(log.label || 'Backup')}</span>
        <span class="backup-history-meta">${new Date(log.id).toLocaleString()}</span>
      </div>
    `).join('');
  }

  function getBackupFilename(user) {
    const safeName = (user?.name || 'profile').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    return `learntrack-backup-${safeName}.json`;
  }

  // Retrieve stored handle and ensure permission is granted.
  // Must be called inside a user-gesture handler so requestPermission() can show UI.
  async function getOrRequestFolderHandle(mode = 'readwrite') {
    if (!window.showDirectoryPicker) return null;
    try {
      const handle = await Storage.getDirectoryHandle();
      if (!handle) return null;
      let perm = await handle.queryPermission({ mode });
      if (perm !== 'granted') perm = await handle.requestPermission({ mode });
      return perm === 'granted' ? handle : null;
    } catch { return null; }
  }

  async function configureBackupFolder() {
    if (!window.showDirectoryPicker) {
      showToast('Folder selection requires Chrome or Edge browser.', 'warning');
      return false;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await Storage.saveDirectoryHandle(handle);
      localStorage.setItem('lt_backupFolderName', handle.name);
      renderBackup();
      showToast(`Backup folder set to "${handle.name}"`, 'success');
      return true;
    } catch (err) {
      if (err.name !== 'AbortError') showToast('Could not set folder: ' + err.message, 'error');
      return false;
    }
  }

  function setupBackup() {
    document.getElementById('backup-btn')?.addEventListener('click', backupCurrentProfile);
    document.getElementById('load-backup-btn')?.addEventListener('click', loadBackupForProfile);
    document.getElementById('configure-folder-btn')?.addEventListener('click', configureBackupFolder);
    document.getElementById('change-folder-btn')?.addEventListener('click', configureBackupFolder);

    const browseInput = document.getElementById('browse-backup-input');
    document.getElementById('browse-backup-btn')?.addEventListener('click', () => browseInput?.click());
    browseInput?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) browseImportFile(file);
      browseInput.value = ''; // reset so same file can be picked again
    });
  }

  /* ---- Monthly In-Page Report Preview -------------- */

  function renderReportPreview() {
    const sel = document.getElementById('report-month');
    if (!sel) return;
    const [year, month0] = sel.value.split('-').map(Number);
    const month = month0 - 1;

    const MONTHS    = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
    const monthStr  = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthEntries = _entries
      .filter(e => e.date.startsWith(monthStr))
      .sort((a, b) => a.date.localeCompare(b.date));

    const incNotes     = document.getElementById('report-inc-notes')?.checked ?? true;
    const incResources = document.getElementById('report-inc-resources')?.checked ?? true;

    const fmt = m => Analytics.formatDuration(m);
    const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const CAT_PALETTE = {
      'Programming': { bg:'#DBEAFE', color:'#1E40AF', bar:'#3B82F6' },
      'Mathematics': { bg:'#EDE9FE', color:'#5B21B6', bar:'#8B5CF6' },
      'Languages':   { bg:'#D1FAE5', color:'#065F46', bar:'#10B981' },
      'Science':     { bg:'#CFFAFE', color:'#155E75', bar:'#06B6D4' },
      'Design':      { bg:'#FCE7F3', color:'#9D174D', bar:'#EC4899' },
      'Business':    { bg:'#FEF3C7', color:'#92400E', bar:'#F59E0B' },
      'Other':       { bg:'#F3F4F6', color:'#374151', bar:'#9CA3AF' },
    };
    // Extended pool for auto-assigned custom categories — hashed by name so colour is always consistent
    const CAT_COLOR_POOL = [
      { bg:'#FFF7ED', color:'#9A3412', bar:'#EA580C' },
      { bg:'#ECFDF5', color:'#065F46', bar:'#059669' },
      { bg:'#FDF4FF', color:'#7E22CE', bar:'#A21CAF' },
      { bg:'#FFF1F2', color:'#9F1239', bar:'#F43F5E' },
      { bg:'#F0FDF4', color:'#14532D', bar:'#16A34A' },
      { bg:'#EFF6FF', color:'#1D4ED8', bar:'#2563EB' },
      { bg:'#FFFBEB', color:'#92400E', bar:'#D97706' },
      { bg:'#F0F9FF', color:'#075985', bar:'#0284C7' },
      { bg:'#FDF2F8', color:'#9D174D', bar:'#DB2777' },
      { bg:'#F7FEE7', color:'#3F6212', bar:'#65A30D' },
      { bg:'#FEFCE8', color:'#854D0E', bar:'#CA8A04' },
      { bg:'#F5F3FF', color:'#4C1D95', bar:'#7C3AED' },
    ];
    const _catHash = s => Math.abs([...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0));
    const getCat = cat => CAT_PALETTE[cat] || CAT_COLOR_POOL[_catHash(cat) % CAT_COLOR_POOL.length];

    // ── Stats ──
    const totalMin      = monthEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
    const totalSessions = monthEntries.length;
    const activeDaySet  = new Set(monthEntries.map(e => e.date));
    const activeDays    = activeDaySet.size;
    const dailyGoalMin  = _prefs.dailyGoalMin || 60;
    const monthlyGoalHr = _prefs.monthlyGoalHr || 20;
    const monthlyGoalMin = monthlyGoalHr * 60;
    const monthlyGoalPct = Math.min(100, Math.round((totalMin / monthlyGoalMin) * 100));
    const daysWithGoal  = monthEntries.reduce((acc, e) => {
      acc.set(e.date, (acc.get(e.date) || 0) + (e.durationMinutes || 0));
      return acc;
    }, new Map());
    let goalDaysMet = 0;
    daysWithGoal.forEach(m => { if (m >= dailyGoalMin) goalDaysMet++; });
    const dailyGoalPct  = activeDays > 0 ? Math.round((goalDaysMet / activeDays) * 100) : 0;
    const remainingMin  = monthlyGoalMin - totalMin;

    // ── Categories ──
    const catMap = {};
    monthEntries.forEach(e => {
      const c = e.category || 'Uncategorized';
      catMap[c] = (catMap[c] || 0) + (e.durationMinutes || 0);
    });
    const catSorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    const maxCatMin = catSorted[0]?.[1] || 1;

    // ── Top Topics ──
    const topicMap      = {};
    const topicSessions = {};
    const topicCat      = {};
    monthEntries.forEach(e => {
      if (!e.topic) return;
      topicMap[e.topic]      = (topicMap[e.topic] || 0) + (e.durationMinutes || 0);
      topicSessions[e.topic] = (topicSessions[e.topic] || 0) + 1;
      if (e.category && !topicCat[e.topic]) topicCat[e.topic] = e.category;
    });
    const topTopics   = Object.entries(topicMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const maxTopicMin = topTopics[0]?.[1] || 1;

    // ── Difficulty ──
    const DIFF_CONFIG = [
      { key: 'easy',   label: 'Easy',   bg: '#DCFCE7', color: '#166534', border: '#86EFAC' },
      { key: 'medium', label: 'Medium', bg: '#FEF9C3', color: '#854D0E', border: '#FDE047' },
      { key: 'hard',   label: 'Hard',   bg: '#FFE4E6', color: '#9F1239', border: '#FDA4AF' },
    ];
    const diffMap = { easy: 0, medium: 0, hard: 0 };
    monthEntries.forEach(e => { if (e.difficulty && diffMap[e.difficulty] !== undefined) diffMap[e.difficulty]++; });
    const diffTotal = DIFF_CONFIG.reduce((s, d) => s + diffMap[d.key], 0);

    // ── Mood ──
    const moodEntries = monthEntries.filter(e => e.moodScore);
    const avgMood = moodEntries.length > 0
      ? (moodEntries.reduce((s, e) => s + e.moodScore, 0) / moodEntries.length).toFixed(1) : null;

    const reportTitle = `${MONTHS[month]} ${year} — Learning Report`;
    const generatedOn = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const username    = _prefs.username || 'Learner';

    // ── HTML builders ──
    const statsHtml = [
      { label: 'Total Time',     value: fmt(totalMin),         sub: `${activeDays} active day${activeDays !== 1 ? 's' : ''}` },
      { label: 'Sessions',       value: String(totalSessions), sub: `${fmt(Math.round(totalMin / Math.max(totalSessions, 1)))} avg` },
      { label: 'Daily Goal Hit', value: `${dailyGoalPct}%`,    sub: `${goalDaysMet} of ${activeDays} days` },
      { label: 'Avg Mood',       value: avgMood ?? '—',        sub: avgMood ? (avgMood >= 4 ? 'Excellent' : avgMood >= 3 ? 'Good' : 'Fair') : 'No data' },
    ].map(c => `<div class="rp-stat-card">
      <div class="rp-stat-label">${c.label}</div>
      <div class="rp-stat-value">${c.value}</div>
      <div class="rp-stat-sub">${c.sub}</div>
    </div>`).join('');

    const goalsHtml = [
      { title: `Daily Goal · ${dailyGoalMin} min/day`,    pct: dailyGoalPct,   detail: `${goalDaysMet} days met target out of ${activeDays} active days` },
      { title: `Monthly Goal · ${monthlyGoalHr}h target`, pct: monthlyGoalPct, detail: `${fmt(totalMin)} of ${monthlyGoalHr}h · ${remainingMin > 0 ? fmt(remainingMin) + ' remaining' : 'Goal completed!'}` },
    ].map(g => `<div class="rp-goal-item">
      <div class="rp-goal-hd"><span class="rp-goal-title">${esc(g.title)}</span><span class="rp-goal-pct">${g.pct}%</span></div>
      <div class="rp-progress-track"><div class="rp-progress-fill" style="width:${g.pct}%;background:var(--accent)"></div></div>
      <div class="rp-goal-detail">${esc(g.detail)}</div>
    </div>`).join('');

    const catHtml = catSorted.map(([cat, mins], i) => {
      const pal    = getCat(cat);
      const pct    = totalMin > 0 ? Math.round((mins / totalMin) * 100) : 0;
      const barPct = Math.round((mins / maxCatMin) * 100);
      return `<div class="rp-cat-row">
        <div class="rp-cat-name">
          <span class="rp-cat-badge" style="background:${pal.bg};color:${pal.color}">${esc(cat)}</span>
        </div>
        <div class="rp-cat-time">${fmt(mins)}</div>
        <div class="rp-cat-pct">${pct}%</div>
        <div class="rp-bar-wrap"><div class="rp-bar-fill" style="width:${barPct}%;background:${pal.bar}"></div></div>
      </div>`;
    }).join('');

    const TOPIC_MEDALS      = ['🥇', '🥈', '🥉'];
    const TOPIC_CARD_BORDER = ['#F59E0B', '#94A3B8', '#F97316'];
    const topicsHtml = topTopics.map(([topic, mins], i) => {
      const barPct   = Math.round((mins / maxTopicMin) * 100);
      const pct      = totalMin > 0 ? Math.round((mins / totalMin) * 100) : 0;
      const sessions = topicSessions[topic] || 1;
      const cat      = topicCat[topic];
      const pal      = cat ? getCat(cat) : null;
      const leftBorder = i < 3 ? `border-left:3px solid ${TOPIC_CARD_BORDER[i]}` : '';
      const rankHtml   = i < 3
        ? `<div class="rp-rank rp-rank-medal">${TOPIC_MEDALS[i]}</div>`
        : `<div class="rp-rank" style="background:var(--surface-2);color:var(--text-3);border:1px solid var(--border)">${i + 1}</div>`;
      return `<div class="rp-topic-row" style="${leftBorder}">
        ${rankHtml}
        <div class="rp-topic-name">${esc(topic)}</div>
        <div class="rp-bar-wrap rp-topic-bar"><div class="rp-bar-fill" style="width:${barPct}%;background:var(--accent)"></div></div>
        <div class="rp-topic-time">${fmt(mins)}</div>
      </div>`;
    }).join('');

    const diffHtml = `<div class="rp-diff-grid">
      ${DIFF_CONFIG.map(({ key, label, bg, color, border }) => `<div class="rp-diff-item" style="background:${bg};border-color:${border}">
        <div class="rp-diff-count" style="color:${color}">${diffMap[key]}</div>
        <div class="rp-diff-label" style="color:${color}">${label}</div>
        ${diffTotal > 0 ? `<div class="rp-diff-pct" style="color:${color};opacity:.6">${Math.round(diffMap[key] / diffTotal * 100)}%</div>` : ''}
      </div>`).join('')}
    </div>`;

    const notesHdr = incNotes     ? '<th>Notes</th>'     : '';
    const resHdr   = incResources ? '<th>Resources</th>' : '';
    const entryRowsHtml = monthEntries.map(e => {
      const dateStr  = new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric' });
      const DIFF_BADGE = { easy:{bg:'#DCFCE7',color:'#166534'}, medium:{bg:'#FEF9C3',color:'#854D0E'}, hard:{bg:'#FFE4E6',color:'#9F1239'} };
      const diffBadge = DIFF_BADGE[e.difficulty] || { bg:'#F3F4F6', color:'#6B7280' };
      const notesRaw = (e.notes || '').trim();
      const notesCell = incNotes ? (() => {
        if (!notesRaw) return `<td class="rp-tc-notes"><span class="rp-muted">—</span></td>`;
        if (notesRaw.length <= 150) return `<td class="rp-tc-notes">${esc(notesRaw)}</td>`;
        const nid = `rn-${e.id}`;
        return `<td class="rp-tc-notes"><span id="${nid}-s">${esc(notesRaw.slice(0, 150))}…</span><span id="${nid}-f" style="display:none">${esc(notesRaw)}</span> <a href="#" id="${nid}-more" class="rp-notes-more" onclick="event.preventDefault();document.getElementById('${nid}-s').style.display='none';document.getElementById('${nid}-f').style.display='inline';document.getElementById('${nid}-more').style.display='none';document.getElementById('${nid}-less').style.display='inline'">more</a><a href="#" id="${nid}-less" class="rp-notes-more" style="display:none" onclick="event.preventDefault();document.getElementById('${nid}-s').style.display='inline';document.getElementById('${nid}-f').style.display='none';document.getElementById('${nid}-more').style.display='inline';document.getElementById('${nid}-less').style.display='none'">less</a></td>`;
      })() : '';
      const resLinks  = (e.resources || []).filter(r => r.url).map(r => {
        const label = esc(r.title && r.title !== r.url ? r.title : r.url);
        return `<a href="${esc(safeHref(r.url))}" target="_blank" rel="noopener" class="rp-res-link">${label}</a>`;
      }).join('');
      const resCell   = incResources
        ? `<td class="rp-tc-res">${resLinks || '<span class="rp-muted">—</span>'}</td>` : '';
      return `<tr>
        <td class="rp-tc-date">${dateStr}</td>
        <td class="rp-tc-topic">${esc(e.topic || '—')}</td>
        <td>${e.category ? (({ bg, color }) => `<span class="rp-badge" style="background:${bg};color:${color}">${esc(e.category)}</span>`)(getCat(e.category)) : '<span class="rp-muted">—</span>'}</td>
        <td class="rp-tc-dur">${fmt(e.durationMinutes || 0)}</td>
        <td>${e.difficulty ? `<span class="rp-badge" style="background:${diffBadge.bg};color:${diffBadge.color};border:1px solid ${diffBadge.color}30">${capitalise(e.difficulty)}</span>` : '<span class="rp-muted">—</span>'}</td>
        ${notesCell}${resCell}
      </tr>`;
    }).join('');

    const container = document.getElementById('report-preview');
    if (!container) return;

    container.innerHTML = `
      <div class="rp-header">
        <div>
          <div class="rp-title">${esc(reportTitle)}</div>
          <div class="rp-meta">Generated ${generatedOn} · ${esc(username)}</div>
        </div>
        <button class="rp-close" onclick="document.getElementById('report-preview').classList.add('hidden')" title="Close">✕</button>
      </div>

      <div class="rp-stats-grid">${statsHtml}</div>

      <div class="rp-two-col">
        <div class="rp-section">
          <div class="rp-section-title">Goal Progress</div>
          <div class="rp-goals">${goalsHtml}</div>
        </div>
        <div class="rp-section">
          <div class="rp-section-title">Difficulty Split</div>
          ${diffHtml}
        </div>
      </div>

      ${(catSorted.length > 0 || topTopics.length > 0) ? `<div class="rp-two-col">
        ${catSorted.length > 0 ? `<div class="rp-section">
          <div class="rp-section-title">Category Breakdown</div>
          <div class="rp-cat-list">${catHtml}</div>
        </div>` : ''}
        ${topTopics.length > 0 ? `<div class="rp-section">
          <div class="rp-section-title">Top Topics</div>
          <div class="rp-topics-list">${topicsHtml}</div>
        </div>` : ''}
      </div>` : ''}

      ${monthEntries.length > 0 ? `<div class="rp-section">
        <div class="rp-section-title">Session Log</div>
        <div class="rp-table-wrap">
          <table class="rp-table">
            <thead><tr><th>Date</th><th>Topic</th><th>Category</th><th>Duration</th><th>Difficulty</th>${notesHdr}${resHdr}</tr></thead>
            <tbody>${entryRowsHtml}</tbody>
          </table>
        </div>
      </div>` : '<div class="rp-empty">No entries for this month.</div>'}
    `;

    container.classList.remove('hidden');
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---- Monthly PDF Report -------------------------- */

  function populateReportMonthSelect() {
    const sel = document.getElementById('report-month');
    if (!sel) return;
    const MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const now   = new Date();
    const opts  = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const val = `${y}-${String(m + 1).padStart(2, '0')}`;
      opts.push(`<option value="${val}">${MONTHS[m]} ${y}</option>`);
    }
    sel.innerHTML = opts.join('');
  }

  async function generateMonthlyReport() {
    const sel = document.getElementById('report-month');
    if (!sel) return;
    const [year, month0] = sel.value.split('-').map(Number);
    const month = month0 - 1;

    const MONTHS   = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
    const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    const monthStr     = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthEntries = _entries.filter(e => e.date.startsWith(monthStr))
                                 .sort((a, b) => a.date.localeCompare(b.date));
    const daysInMonth  = new Date(year, month + 1, 0).getDate();

    // Stats
    const totalMin      = monthEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
    const totalSessions = monthEntries.length;
    const activeDaySet  = new Set(monthEntries.map(e => e.date));
    const activeDays    = activeDaySet.size;
    const avgMin        = activeDays > 0 ? Math.round(totalMin / activeDays) : 0;
    const dailyGoalMin  = _prefs.dailyGoalMin || 60;
    const monthlyGoalHr = _prefs.monthlyGoalHr || 20;
    const monthlyGoalMin = monthlyGoalHr * 60;
    const monthlyGoalPct = Math.min(100, Math.round((totalMin / monthlyGoalMin) * 100));
    const daysWithGoal  = monthEntries.reduce((acc, e) => {
      acc.set(e.date, (acc.get(e.date) || 0) + (e.durationMinutes || 0));
      return acc;
    }, new Map());
    let goalDaysMet = 0;
    daysWithGoal.forEach(m => { if (m >= dailyGoalMin) goalDaysMet++; });
    const dailyGoalPct = activeDays > 0 ? Math.round((goalDaysMet / activeDays) * 100) : 0;

    // Category breakdown
    const catMap = {};
    monthEntries.forEach(e => {
      const c = e.category || 'Uncategorized';
      catMap[c] = (catMap[c] || 0) + (e.durationMinutes || 0);
    });
    const catSorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    const maxCatMin = catSorted[0]?.[1] || 1;

    // Difficulty
    const diffMap = { Easy: 0, Medium: 0, Hard: 0 };
    monthEntries.forEach(e => { if (e.difficulty && diffMap[e.difficulty] !== undefined) diffMap[e.difficulty]++; });

    // Top topics
    const topicMap = {};
    monthEntries.forEach(e => { if (e.topic) topicMap[e.topic] = (topicMap[e.topic] || 0) + (e.durationMinutes || 0); });
    const topTopics    = Object.entries(topicMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const maxTopicMin  = topTopics[0]?.[1] || 1;

    // Mood
    const moodEntries = monthEntries.filter(e => e.moodScore);
    const avgMood = moodEntries.length > 0
      ? (moodEntries.reduce((s, e) => s + e.moodScore, 0) / moodEntries.length).toFixed(1) : null;

    // Options
    const incNotes     = document.getElementById('report-inc-notes')?.checked ?? true;
    const incResources = document.getElementById('report-inc-resources')?.checked ?? true;

    // Helpers
    const fmt = m => Analytics.formatDuration(m);
    const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const COLORS = ['#4F46E5','#10B981','#F59E0B','#EF4444','#3B82F6','#EC4899','#8B5CF6','#06B6D4'];

    // Calendar HTML — compact, no dots, fixed-height cells
    const firstDay = new Date(year, month, 1).getDay();
    let calHtml = DAY_NAMES.map(d => `<div class="cal-head">${d}</div>`).join('');
    for (let i = 0; i < firstDay; i++) calHtml += '<div class="cal-cell empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const ds  = `${monthStr}-${String(d).padStart(2,'0')}`;
      const has = activeDaySet.has(ds);
      const met = (daysWithGoal.get(ds) || 0) >= dailyGoalMin;
      const cls = has ? (met ? ' met' : ' active') : '';
      calHtml += `<div class="cal-cell${cls}"><span class="cal-num">${d}</span></div>`;
    }

    // Daily bar chart data
    const dailyBars = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const ds   = `${monthStr}-${String(d).padStart(2, '0')}`;
      const mins = daysWithGoal.get(ds) || 0;
      dailyBars.push({ d, mins, has: activeDaySet.has(ds), met: mins >= dailyGoalMin });
    }
    const maxDayMin = Math.max(...dailyBars.map(b => b.mins), 1);

    // Weekly chart data
    const weeklyData = [];
    for (let start = 1, wk = 1; start <= daysInMonth; start += 7, wk++) {
      const end = Math.min(start + 6, daysInMonth);
      let wMins = 0, wActive = 0;
      for (let d = start; d <= end; d++) {
        const ds = `${monthStr}-${String(d).padStart(2, '0')}`;
        wMins   += daysWithGoal.get(ds) || 0;
        if (activeDaySet.has(ds)) wActive++;
      }
      weeklyData.push({ wk, start, end, wMins, wActive });
    }
    const maxWeekMin = Math.max(...weeklyData.map(w => w.wMins), 1);

    // Category rows
    const catRows = catSorted.map(([cat, mins], i) => {
      const color  = COLORS[i % COLORS.length];
      const pct    = totalMin > 0 ? Math.round((mins / totalMin) * 100) : 0;
      const barPct = Math.round((mins / maxCatMin) * 100);
      return `<tr>
        <td><span class="cat-dot" style="background:${color}"></span><span class="cat-name">${esc(cat)}</span></td>
        <td class="cat-time">${fmt(mins)}</td>
        <td class="cat-share">${pct}%</td>
        <td class="cat-bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${barPct}%;background:${color}"></div></div></td>
      </tr>`;
    }).join('');

    // Topic rows
    const topicRows = topTopics.map(([topic, mins], i) => {
      const rankCls = i === 0 ? ' gold' : i === 1 ? ' silver' : i === 2 ? ' bronze' : '';
      const barPct  = Math.round((mins / maxTopicMin) * 100);
      return `<div class="topic-row">
        <div class="rank${rankCls}">${i + 1}</div>
        <div class="topic-name">${esc(topic)}</div>
        <div class="topic-bar-wrap"><div class="topic-bar" style="width:${barPct}%"></div></div>
        <div class="topic-time">${fmt(mins)}</div>
      </div>`;
    }).join('');

    // Entry rows
    const entryRows = monthEntries.map(e => {
      const ts      = e.createdAt || parseInt(e.id, 10) || 0;
      const timeStr = ts ? new Date(ts).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true }) : '';
      const dateStr = new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric' });
      const diffCls = e.difficulty === 'Easy' ? 'badge-easy' : e.difficulty === 'Medium' ? 'badge-med' : e.difficulty === 'Hard' ? 'badge-hard' : '';
      const resHtml = (e.resources || []).filter(r => r.url).map(r => {
        const label = esc(r.title && r.title !== r.url ? r.title : r.url);
        const url   = esc(r.url);
        return `<div class="res-item"><a href="${url}" class="res-link">${label}</a><div class="res-url">${url}</div></div>`;
      }).join('');
      return `<tr>
        <td><div class="entry-date">${dateStr}</div>${timeStr ? `<div class="entry-time">${timeStr}</div>` : ''}</td>
        <td class="entry-topic">${esc(e.topic)}</td>
        <td>${e.category ? `<span class="badge badge-cat">${esc(e.category)}</span>` : '<span class="muted">—</span>'}</td>
        <td class="entry-dur">${fmt(e.durationMinutes || 0)}</td>
        <td>${e.difficulty ? `<span class="badge ${diffCls}">${esc(e.difficulty)}</span>` : '<span class="muted">—</span>'}</td>
        ${incNotes     ? `<td class="entry-notes">${esc(e.notes || '')}</td>` : ''}
        ${incResources ? `<td class="entry-res">${resHtml || '<span class="muted">—</span>'}</td>` : ''}
      </tr>`;
    }).join('');

    const generatedOn  = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const username     = _prefs.username || 'Learner';
    const reportTitle  = `${MONTHS[month]} ${year} — Learning Report`;
    const remainingMin = monthlyGoalMin - totalMin;

    // ── Direct jsPDF generation (vector text — no canvas) ──
    if (typeof window.jspdf === 'undefined') {
      showToast('PDF library not loaded yet. Please wait and try again.', 'warning');
      return;
    }

    const btn = document.getElementById('download-report-btn');
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span style="opacity:.6">Generating…</span>';

    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

      const PW = pdf.internal.pageSize.getWidth();
      const PH = pdf.internal.pageSize.getHeight();
      const ML = 40, MR = 40, MB = 50;
      const CW = PW - ML - MR;
      let y = 56; // start below header band

      // Color palette [r, g, b]
      const CI  = [79, 70, 229];    // indigo
      const CIL = [238, 242, 255];  // indigo light
      const CIM = [199, 210, 254];  // indigo mid
      const CBK = [17, 24, 39];     // near-black
      const CGR = [107, 114, 128];  // gray
      const CLG = [156, 163, 175];  // light gray
      const CBG = [249, 250, 251];  // bg
      const CBD = [229, 231, 235];  // border
      const CWH = [255, 255, 255];  // white

      const clrF = c => pdf.setFillColor(c[0], c[1], c[2]);
      const clrD = c => pdf.setDrawColor(c[0], c[1], c[2]);
      const clrT = c => pdf.setTextColor(c[0], c[1], c[2]);

      function needsPage(h) {
        if (y + h > PH - MB) { pdf.addPage(); y = 40; }
      }

      function tx(text, x, ty, size, clr, opts = {}) {
        pdf.setFontSize(size);
        pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal');
        clrT(clr);
        const o = {};
        if (opts.align) o.align    = opts.align;
        if (opts.maxW)  o.maxWidth = opts.maxW;
        pdf.text(String(text ?? '—'), x, ty, o);
      }

      function fillR(x, ry, w, h, c) { clrF(c); pdf.rect(x, ry, w, h, 'F'); }
      function strokeR(x, ry, w, h, c, lw = 0.4) {
        pdf.setLineWidth(lw); clrD(c); pdf.rect(x, ry, w, h, 'S');
      }
      function hline(x1, x2, ry, c = CBD, lw = 0.4) {
        pdf.setLineWidth(lw); clrD(c); pdf.line(x1, ry, x2, ry);
      }
      function hexRGB(h) {
        h = h.replace('#', '');
        return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
      }
      function sectionLabel(label) {
        needsPage(22);
        tx(label.toUpperCase(), ML, y + 9, 8, CLG, { bold: true });
        const lw2 = pdf.getTextWidth(label.toUpperCase());
        hline(ML + lw2 + 8, ML + CW, y + 5, CBD, 0.4);
        y += 18;
      }

      // ─── HEADER BAND ───
      fillR(0, 0, PW, 48, CI);
      tx('LearnTrack', ML, 20, 17, CWH, { bold: true });
      tx('Monthly Learning Report', ML, 36, 10, [200, 195, 255]);
      tx(reportTitle, PW - MR, 22, 11, CWH, { align: 'right' });
      tx(`Generated ${generatedOn}  ·  ${username}`, PW - MR, 38, 8, [180, 175, 240], { align: 'right' });

      // ─── SUMMARY CARDS ───
      needsPage(72);
      const cardW4 = (CW - 9) / 4;
      const cardH  = 62;
      [
        { label: 'Total Time',     value: fmt(totalMin),         sub: `${activeDays} active days` },
        { label: 'Sessions',       value: String(totalSessions), sub: `${fmt(Math.round(totalMin / Math.max(totalSessions, 1)))} avg` },
        { label: 'Daily Goal Hit', value: `${dailyGoalPct}%`,    sub: `${goalDaysMet} of ${activeDays} days` },
        { label: 'Avg Mood',       value: avgMood ?? '—',        sub: avgMood ? (avgMood >= 4 ? 'Excellent' : avgMood >= 3 ? 'Good' : 'Fair') : 'No data' },
      ].forEach(({ label, value, sub }, i) => {
        const cx = ML + i * (cardW4 + 3);
        fillR(cx, y, cardW4, cardH, CBG);
        strokeR(cx, y, cardW4, cardH, CBD);
        tx(label, cx + 8, y + 14, 8, CGR);
        tx(String(value), cx + 8, y + 38, 20, CI, { bold: true });
        tx(sub, cx + 8, y + 54, 7.5, CLG);
      });
      y += cardH + 16;

      // ─── GOAL PROGRESS ───
      needsPage(76);
      sectionLabel('Goal Progress');
      const gW = (CW - 8) / 2;
      const gH = 54;
      [
        { title: `Daily Goal · ${dailyGoalMin} min/day`,    pct: dailyGoalPct,   detail: `${goalDaysMet} days met target out of ${activeDays} active days` },
        { title: `Monthly Goal · ${monthlyGoalHr}h target`, pct: monthlyGoalPct, detail: `${fmt(totalMin)} of ${monthlyGoalHr}h · ${remainingMin > 0 ? fmt(remainingMin) + ' remaining' : 'Completed!'}` },
      ].forEach(({ title, pct, detail }, i) => {
        const gx = ML + i * (gW + 8);
        fillR(gx, y, gW, gH, CBG);
        strokeR(gx, y, gW, gH, CBD);
        tx(title, gx + 10, y + 16, 9, CBK, { bold: true });
        tx(`${pct}%`, gx + gW - 10, y + 16, 9, CI, { bold: true, align: 'right' });
        const bx = gx + 10, by = y + 26, bw = gW - 20, bh = 7;
        fillR(bx, by, bw, bh, CIM);
        fillR(bx, by, Math.max(2, bw * Math.min(pct, 100) / 100), bh, CI);
        tx(detail, gx + 10, y + 46, 8, CGR, { maxW: gW - 20 });
      });
      y += gH + 16;

      // ─── DAILY BAR CHART ───
      const daysWithEntries = dailyBars.filter(b => b.has);
      if (daysWithEntries.length > 0) {
        needsPage(110);
        sectionLabel('Daily Learning Time');
        const chartH  = 80;
        const barMaxH = 54;
        const nBars   = daysWithEntries.length;
        const spacing = Math.min(30, CW / nBars);
        const barW2   = Math.max(4, spacing - 4);
        const chartX  = ML + (CW - nBars * spacing) / 2;
        daysWithEntries.forEach(({ d, mins, met }, i) => {
          const bx = chartX + i * spacing;
          const bh = Math.max(4, Math.round((mins / maxDayMin) * barMaxH));
          const by = y + chartH - bh - 14;
          fillR(bx, by, barW2, bh, met ? CI : CIM);
          tx(fmt(mins), bx + barW2 / 2, by - 3, 6, CGR, { align: 'center' });
          tx(`${MONTHS[month].slice(0, 3)} ${d}`, bx + barW2 / 2, y + chartH - 2, 5.5, CLG, { align: 'center' });
        });
        y += chartH + 10;
      }

      // ─── WEEKLY CHART ───
      needsPage(70);
      sectionLabel('Weekly Progress');
      weeklyData.forEach(({ wk, start, end, wMins }) => {
        needsPage(18);
        const pct = Math.round((wMins / maxWeekMin) * 100);
        tx(`Wk ${wk}`, ML, y + 11, 8.5, CBK, { bold: true });
        tx(`${start}–${end}`, ML + 28, y + 11, 7.5, CLG);
        const bx = ML + 68, bw = CW - 108, bh = 8, by = y + 4;
        fillR(bx, by, bw, bh, CIL);
        fillR(bx, by, Math.max(2, bw * pct / 100), bh, CI);
        tx(wMins > 0 ? fmt(wMins) : '—', ML + CW, y + 11, 8, CGR, { align: 'right' });
        y += 18;
      });
      y += 6;

      // ─── CALENDAR ───
      const calRowCount = Math.ceil((firstDay + daysInMonth) / 7);
      needsPage(calRowCount * 22 + 50);
      sectionLabel('Daily Activity');
      const cellW = CW / 7;
      const cellH = 22;
      DAY_NAMES.forEach((dn, i) => {
        tx(dn, ML + i * cellW + cellW / 2, y + 13, 8, CGR, { bold: true, align: 'center' });
      });
      y += cellH;
      const dateMinMap = {};
      monthEntries.forEach(e => {
        dateMinMap[e.date] = (dateMinMap[e.date] || 0) + (e.durationMinutes || 0);
      });
      for (let d = 1, ci = firstDay; d <= daysInMonth; d++, ci++) {
        const col = ci % 7;
        const row = Math.floor(ci / 7);
        const cx  = ML + col * cellW;
        const cy  = y + row * cellH;
        const ds  = `${monthStr}-${String(d).padStart(2, '0')}`;
        const m2  = dateMinMap[ds] || 0;
        const has = m2 > 0;
        const met = m2 >= dailyGoalMin;
        if (has) {
          fillR(cx + 1, cy + 1, cellW - 2, cellH - 2, met ? CI : CIL);
          strokeR(cx + 1, cy + 1, cellW - 2, cellH - 2, met ? CI : CIM, 0.3);
        } else {
          strokeR(cx + 1, cy + 1, cellW - 2, cellH - 2, CBD, 0.3);
        }
        tx(String(d), cx + cellW / 2, cy + cellH - 7, 9, has ? (met ? CWH : CI) : CLG, { align: 'center', bold: met });
      }
      y += calRowCount * cellH + 8;
      fillR(ML, y, 10, 10, CIL); strokeR(ML, y, 10, 10, CIM, 0.4);
      tx('Active', ML + 14, y + 9, 8, CGR);
      fillR(ML + 60, y, 10, 10, CI);
      tx('Goal met', ML + 74, y + 9, 8, CGR);
      y += 20;

      // ─── CATEGORY BREAKDOWN ───
      if (catSorted.length > 0) {
        needsPage(44);
        y += 6;
        sectionLabel('Category Breakdown');
        const colXs = [ML + 6, ML + 200, ML + 262, ML + 316];
        const colWs = [194, 62, 54, CW - 282];
        const rH = 20;
        fillR(ML, y, CW, rH, CBG); strokeR(ML, y, CW, rH, CBD, 0.4);
        ['Category','Time','Share','Distribution'].forEach((h, i) =>
          tx(h, colXs[i], y + 14, 8, CGR, { bold: true })
        );
        y += rH;
        catSorted.forEach(([cat, mins], idx) => {
          needsPage(rH);
          if (idx % 2 === 1) fillR(ML, y, CW, rH, [248, 249, 252]);
          hline(ML, ML + CW, y, CBD, 0.3);
          const pct2   = totalMin > 0 ? Math.round((mins / totalMin) * 100) : 0;
          const dotRGB = hexRGB(COLORS[idx % COLORS.length]);
          fillR(ML + 6, y + 7, 7, 7, dotRGB);
          const catTrunc = pdf.splitTextToSize(cat, 174)[0] || cat;
          tx(catTrunc, ML + 16, y + 14, 8.5, CBK);
          tx(fmt(mins), colXs[1], y + 14, 8.5, CGR);
          tx(`${pct2}%`, colXs[2], y + 14, 8.5, CGR);
          const bxC = colXs[3], bwC = colWs[3] - 6, byC = y + 7, bhC = 6;
          fillR(bxC, byC, bwC, bhC, CIL);
          fillR(bxC, byC, Math.max(2, bwC * pct2 / 100), bhC, dotRGB);
          y += rH;
        });
        hline(ML, ML + CW, y, CBD, 0.5);
        y += 10;
      }

      // ─── TOP TOPICS ───
      if (topTopics.length > 0) {
        needsPage(44);
        y += 6;
        sectionLabel('Top Topics by Time');
        topTopics.forEach(([topic, mins], i) => {
          needsPage(20);
          const pct3 = Math.round((mins / maxTopicMin) * 100);
          tx(`${i + 1}.`, ML, y + 11, 8.5, i < 3 ? CI : CLG, { bold: i < 3 });
          const topicTrunc = pdf.splitTextToSize(topic, CW - 100)[0] || topic;
          tx(topicTrunc, ML + 18, y + 11, 8.5, CBK);
          tx(fmt(mins), ML + CW, y + 11, 8.5, CGR, { align: 'right' });
          const bx2 = ML + 18, bw2 = CW - 100, by2 = y + 14, bh2 = 3;
          fillR(bx2, by2, bw2, bh2, CIL);
          fillR(bx2, by2, Math.max(2, bw2 * pct3 / 100), bh2, i < 3 ? CI : CIM);
          y += 20;
        });
        y += 4;
      }

      // ─── ALL ENTRIES TABLE ───
      if (monthEntries.length > 0) {
        needsPage(50);
        y += 6;
        sectionLabel(`All Entries (${monthEntries.length})`);

        // Measure each column's actual content width, then size accordingly
        pdf.setFontSize(8);
        function colFit(vals, hdr, minW, maxW) {
          pdf.setFont('helvetica', 'bold');
          const hw = pdf.getTextWidth(hdr);
          pdf.setFont('helvetica', 'normal');
          const vm = vals.length
            ? Math.max(...vals.filter(Boolean).map(v => pdf.getTextWidth(String(v))))
            : 0;
          return Math.min(maxW, Math.max(minW, Math.max(hw, vm) + 12));
        }

        const dateLbls = monthEntries.map(e =>
          new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        );
        const wDate  = colFit(dateLbls,                                          'Date',       40,  52);
        const wCat   = colFit(monthEntries.map(e => e.category || ''),           'Category',   46, 110);
        const wDur   = colFit(monthEntries.map(e => fmt(e.durationMinutes || 0)),'Duration',   38,  58);
        const wDiff  = colFit(monthEntries.map(e => e.difficulty ? e.difficulty.charAt(0).toUpperCase() + e.difficulty.slice(1) : ''), 'Difficulty', 38, 78);

        // Topic: content-measured, capped wider when notes/resources share the row
        const wTopicMax = (incNotes || incResources) ? 160 : CW - wDate - wCat - wDur - wDiff;
        const wTopic = colFit(monthEntries.map(e => e.topic || ''), 'Topic', 70, wTopicMax);

        // Notes + Resources split remaining space 70 / 30
        const fixedBase = wDate + wCat + wDur + wDiff + wTopic;
        let wNotes = 0, wRes = 0;
        const tblW = CW;
        {
          const remaining = CW - fixedBase;
          const wtNotes = incNotes     ? 70 : 0;
          const wtRes   = incResources ? 30 : 0;
          const wtTotal = wtNotes + wtRes;
          if (wtTotal > 0) {
            wNotes = incNotes     ? Math.round((wtNotes / wtTotal) * remaining) : 0;
            wRes   = incResources ? remaining - wNotes                          : 0;
          }
        }

        const tCols = [
          { label: 'Date',       w: wDate  },
          { label: 'Topic',      w: wTopic },
          { label: 'Category',   w: wCat   },
          { label: 'Duration',   w: wDur   },
          { label: 'Difficulty', w: wDiff  },
          ...(incNotes     ? [{ label: 'Notes',    w: wNotes }] : []),
          ...(incResources ? [{ label: 'Resources', w: wRes   }] : []),
        ];

        const colX = [];
        let xAcc = ML;
        tCols.forEach(c => { colX.push(xAcc); xAcc += c.w; });

        const notesColIdx = tCols.findIndex(c => c.label === 'Notes');
        const resColIdx   = tCols.findIndex(c => c.label === 'Resources');
        const resMaxW     = resColIdx >= 0 ? tCols[resColIdx].w - 10 : 80;
        const lineH = 11, pad = 5, vpad = 4;
        const tRowH = 18;

        // Header (width = tblW, not full CW)
        fillR(ML, y, tblW, tRowH, CI);
        tCols.forEach((c, i) => tx(c.label, colX[i] + pad, y + 13, 8, CWH, { bold: true }));
        y += tRowH;

        monthEntries.forEach((entry, idx) => {
          const dateLabel = new Date(entry.date + 'T12:00:00')
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          const notesLines = (incNotes && notesColIdx >= 0)
            ? pdf.splitTextToSize(entry.notes || '', tCols[notesColIdx].w - pad * 2)
            : [];

          const resources = (incResources && resColIdx >= 0)
            ? (entry.resources || []).filter(r => r.url)
            : [];
          // Pre-split resource labels so we can count total lines for row-height
          const resLabelLines = resources.map(res => {
            const label = (res.title && res.title !== res.url) ? res.title : res.url;
            return pdf.splitTextToSize(label, resMaxW);
          });
          const resSlots = resLabelLines.reduce((sum, lines) => sum + lines.length, 0);

          // Standard column line counts (all columns, no truncation)
          const stdTexts = [
            dateLabel,
            entry.topic || '',
            entry.category || '—',
            fmt(entry.durationMinutes || 0),
            entry.difficulty ? entry.difficulty.charAt(0).toUpperCase() + entry.difficulty.slice(1) : '—',
          ];
          const maxStdLines = Math.max(...stdTexts.map((t, ci) =>
            pdf.splitTextToSize(String(t), tCols[ci].w - pad * 2).length
          ));

          const maxLines = Math.max(
            1,
            maxStdLines,
            notesLines.length,
            resources.length > 0 ? resSlots : (incResources ? 1 : 0)
          );
          const rowH = Math.max(tRowH, maxLines * lineH + vpad * 2);

          needsPage(rowH);
          if (idx % 2 === 0) fillR(ML, y, tblW, rowH, CBG);
          hline(ML, ML + tblW, y, CBD, 0.3);

          // Standard columns — vertically centered, full wrapping
          [
            { ci: 0, text: dateLabel,                       rc: CGR },
            { ci: 1, text: entry.topic || '',               rc: CBK },
            { ci: 2, text: entry.category || '—',           rc: CGR },
            { ci: 3, text: fmt(entry.durationMinutes || 0), rc: CGR },
            { ci: 4, text: entry.difficulty ? entry.difficulty.charAt(0).toUpperCase() + entry.difficulty.slice(1) : '—', rc: CGR },
          ].forEach(({ ci, text, rc }) => {
            const lines = pdf.splitTextToSize(String(text), tCols[ci].w - pad * 2);
            const startY = y + (rowH - lines.length * lineH) / 2 + lineH;
            lines.forEach((line, li) =>
              tx(line, colX[ci] + pad, startY + li * lineH, 8, rc)
            );
          });

          // Notes — all wrapped lines, vertically centered
          if (incNotes && notesColIdx >= 0) {
            const nLines = Math.max(1, notesLines.length);
            const nStartY = y + (rowH - nLines * lineH) / 2 + lineH;
            if (notesLines.length === 0) {
              tx('—', colX[notesColIdx] + pad, nStartY, 8, CGR);
            } else {
              notesLines.forEach((line, li) =>
                tx(line, colX[notesColIdx] + pad, nStartY + li * lineH, 8, CGR)
              );
            }
          }

          // Resources — clickable title + full URL as plain text below, vertically centered
          if (incResources && resColIdx >= 0) {
            const rCenterBaseline = y + (rowH - lineH) / 2 + lineH;
            if (resources.length === 0) {
              tx('—', colX[resColIdx] + pad, rCenterBaseline, 8, CGR);
            } else {
              let rsy = y + (rowH - resSlots * lineH) / 2;
              resources.forEach((res, ri) => {
                const lines = resLabelLines[ri];
                lines.forEach((line) => {
                  rsy += lineH;
                  tx(line, colX[resColIdx] + pad, rsy, 8, CI);
                  const lw = Math.min(pdf.getTextWidth(line), resMaxW);
                  hline(colX[resColIdx] + pad, colX[resColIdx] + pad + lw, rsy + 1, CI, 0.3);
                  pdf.link(colX[resColIdx] + pad, rsy - 9, lw, lineH, { url: res.url });
                });
              });
            }
          }

          y += rowH;
        });
        hline(ML, ML + tblW, y, CBD, 0.5);
        y += 8;
      }

      // ─── FOOTER ───
      const footY = PH - 22;
      hline(ML, PW - MR, footY - 10, CBD, 0.5);
      tx('LearnTrack', ML, footY, 8, CI, { bold: true });
      tx('· Personal Learning Analytics', ML + 60, footY, 8, CLG);
      tx(reportTitle, PW - MR, footY, 8, CLG, { align: 'right' });

      const blob    = pdf.output('blob');
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);

    } catch (err) {
      console.error('PDF generation failed:', err);
      showToast('PDF generation failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }


  async function backupCurrentProfile(silent = false) {
    if (!silent && _entries.length === 0) {
      showToast('No data to save. Add some learning entries first.', 'warning');
      return;
    }

    // Use the stored folder handle; if missing, ask the user to configure one first (manual only)
    let dirHandle = await getOrRequestFolderHandle('readwrite');
    if (!dirHandle) {
      if (silent) throw new Error('No backup folder configured');
      showToast('Please configure a backup folder first.', 'warning');
      const ok = await configureBackupFolder();
      if (!ok) return;
      dirHandle = await getOrRequestFolderHandle('readwrite');
      if (!dirHandle) { showToast('Could not access backup folder.', 'error'); return; }
    }

    const activeUser = UserManager.getActive();
    const filename   = getBackupFilename(activeUser);

    try {
      const backup = await Storage.exportAll();
      // Always embed current in-memory profile data so defaults are captured even if never explicitly saved
      const { lastBackupDate: _dropped, ...exportedPrefs } = backup.data.preferences;
      backup.data.preferences = {
        ...exportedPrefs,
        username:      _prefs.username,
        dailyGoalMin:  _prefs.dailyGoalMin,
        monthlyGoalHr: _prefs.monthlyGoalHr,
        goalHistory:   _prefs.goalHistory || [],
      };
      const json     = JSON.stringify(backup, null, 2);
      const fh       = await dirHandle.getFileHandle(filename, { create: true }); // overwrites if exists
      const writable = await fh.createWritable();
      await writable.write(json);
      await writable.close();

      await Storage.setPref('lastBackupDate', Date.now());
      await Storage.addBackupLog({ type: 'export', label: `Backed up → ${dirHandle.name}/${filename}` });
      _lastAutoBackup = Date.now();
      localStorage.setItem(`lt_last_auto_backup_${UserManager.getActive()?.id || 'default'}`, _lastAutoBackup);
      updateSidebarBackupStatus(true);
      if (!silent) {
        showToast(`✅ Backed up to "${dirHandle.name}"!`, 'success');
        renderBackup();
      }
    } catch (err) {
      if (!silent && err.name !== 'AbortError') showToast('Backup failed: ' + err.message, 'error');
      if (silent) throw err;
    }
  }

  async function loadBackupForProfile() {
    const activeUser = UserManager.getActive();
    const filename   = getBackupFilename(activeUser);

    // Load automatically from the stored folder — no picker shown
    const dirHandle = await getOrRequestFolderHandle('read');
    if (!dirHandle) {
      showImportStatus('No backup folder configured. Use "Configure Folder" to set one.', 'error');
      return;
    }

    try {
      let fileHandle;
      try {
        fileHandle = await dirHandle.getFileHandle(filename);
      } catch {
        showImportStatus(
          `No backup found for profile "${activeUser?.name || 'this profile'}". Expected file: ${filename}`,
          'error'
        );
        return;
      }
      const file = await fileHandle.getFile();
      importFile(file);
    } catch (err) {
      if (err.name !== 'AbortError') showToast('Could not read from folder: ' + err.message, 'error');
    }
  }

  async function browseImportFile(file) {
    if (!file.name.endsWith('.json')) {
      showImportStatus('Only JSON backup files are supported.', 'error');
      return;
    }

    let backup;
    try {
      const text = await file.text();
      backup = JSON.parse(text);
    } catch {
      showImportStatus('Corrupted backup file (invalid JSON).', 'error');
      return;
    }

    if (!backup.version || !backup.appName || !backup.data) {
      showImportStatus('Invalid backup file format.', 'error');
      return;
    }
    if (backup.appName !== 'LearnTrack') {
      showImportStatus('Unsupported backup file (different app).', 'error');
      return;
    }

    const existingEntries = await Storage.getAllEntries();
    const users = UserManager.getUsers();
    const isFirstTime = existingEntries.length === 0
      && users.length <= 1
      && (users[0]?.name || '').toLowerCase() === 'me';

    if (isFirstTime) {
      // First launch — replace the default profile with what's in the file
      const result = await Storage.importAll(backup);
      _entries   = await Storage.getAllEntries();
      _earnedAch = await Storage.getAllAchievements();
      _prefs     = { ...DEFAULT_PREFS, ...(await Storage.getAllPrefs()) };

      // Sync UserManager name with imported username
      const importedName = _prefs.username;
      if (importedName) {
        const activeUser = UserManager.getActive();
        if (activeUser) UserManager.updateUser(activeUser.id, importedName);
      }

      applyTheme(_prefs.theme);
      applyAccent(_prefs.accent);
      applyCompact(_prefs.compact);
      showImportStatus(`✅ Imported ${result.imported} entries into your profile.`, 'success');
      await Storage.addBackupLog({ type: 'import', label: `Browsed & imported: ${file.name}` });
    } else {
      // Existing data — create a new profile for the imported data and switch to it
      const importedName = backup.data.preferences?.username || file.name.replace(/\.json$/i, '');
      const duplicate = UserManager.getUsers().find(u => u.name.toLowerCase() === importedName.toLowerCase());
      if (duplicate) {
        showImportStatus(`A profile named "${duplicate.name}" already exists. Rename or delete it first.`, 'error');
        return;
      }
      const newUser = UserManager.createUser(importedName);
      await switchUser(newUser.id, importedName);

      // Now import into this fresh profile
      const result = await Storage.importAll(backup);
      _entries   = await Storage.getAllEntries();
      _earnedAch = await Storage.getAllAchievements();
      _prefs     = { ...DEFAULT_PREFS, ...(await Storage.getAllPrefs()) };

      applyTheme(_prefs.theme);
      applyAccent(_prefs.accent);
      applyCompact(_prefs.compact);
      showImportStatus(`✅ Created profile "${importedName}" with ${result.imported} imported entries.`, 'success');
      await Storage.addBackupLog({ type: 'import', label: `Browsed & imported as new profile: ${file.name}` });
    }

    renderPage(_currentPage);
    updateSidebarUser();
    renderBackup();
  }

  function importFile(file) {
    if (!file.name.endsWith('.json')) {
      showImportStatus('Invalid backup file format. Only JSON files are supported.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const raw    = e.target.result;
        if (!raw || raw.trim() === '') { showImportStatus('Empty backup file.', 'error'); return; }

        const backup = JSON.parse(raw);

        // Validate structure
        if (!backup.version || !backup.appName || !backup.data) {
          showImportStatus('Invalid backup file format.', 'error');
          return;
        }
        if (backup.appName !== 'LearnTrack') {
          showImportStatus('Unsupported backup file (different app).', 'error');
          return;
        }

        const result = await Storage.importAll(backup);

        // Refresh in-memory state including profile prefs
        _entries   = await Storage.getAllEntries();
        _earnedAch = await Storage.getAllAchievements();
        _prefs     = { ...DEFAULT_PREFS, ...(await Storage.getAllPrefs()) };
        applyTheme(_prefs.theme);
        applyAccent(_prefs.accent);
        applyCompact(_prefs.compact);

        showImportStatus(
          `✅ Imported ${result.imported} new entries, ${result.updated} updated, ${result.skipped} skipped.`,
          'success'
        );

        await Storage.addBackupLog({ type: 'import', label: `Imported from ${file.name} (${result.imported} new)` });

        renderPage(_currentPage);
        updateSidebarUser();
        showToast('Backup restored successfully!', 'success');
        renderBackup();
      } catch (err) {
        if (err instanceof SyntaxError) {
          showImportStatus('Corrupted backup file (invalid JSON).', 'error');
        } else {
          showImportStatus('Import failed: ' + err.message, 'error');
        }
      }
    };
    reader.onerror = () => showImportStatus('Could not read file.', 'error');
    reader.readAsText(file);
  }

  function showImportStatus(message, type) {
    const el = document.getElementById('import-status');
    if (!el) return;
    el.style.display = 'block';
    el.className     = `import-status ${type}`;
    el.textContent   = message;
    if (type === 'success') {
      setTimeout(() => { el.style.display = 'none'; }, 6000);
    }
  }

  /* ---- Achievement Checks -------------------------- */

  async function checkAchievements() {
    const streak      = Analytics.calculateStreaks(_entries);
    const stats       = Analytics.calculateTotalStats(_entries);
    const consistency = Analytics.calculateConsistency(_entries);

    // Award any newly qualifying achievements — earned badges are never revoked
    const newlyEarned = await Rewards.checkAndAwardAchievements(_entries, streak, stats, consistency, _prefs.dailyGoalMin, _prefs.goalHistory);
    _earnedAch = await Storage.getAllAchievements();

    for (const ach of newlyEarned) {
      _badgeQueue.push(ach);
    }

    if (!_badgeShowing && _badgeQueue.length > 0) {
      showNextBadge();
    }

    // Mark achievements nav badge
    const navBadge = document.getElementById('nav-badge-achievements');
    if (navBadge && newlyEarned.length > 0) {
      navBadge.style.display = 'inline';
    }
  }

  function showNextBadge() {
    const ach = _badgeQueue.shift();
    if (!ach) { _badgeShowing = false; return; }

    _badgeShowing = true;
    const modal = document.getElementById('badge-modal');
    if (!modal) { _badgeShowing = false; return; }

    setEl('badge-modal-icon', ach.icon);
    setEl('badge-modal-name', ach.name);
    setEl('badge-modal-desc', ach.desc);
    setEl('badge-modal-xp',   `+${ach.xp} XP`);
    modal.style.display = 'flex';

    Rewards.fireConfetti('achievement');

    document.getElementById('badge-modal-close').onclick = () => {
      closeBadgeModal();
    };
  }

  function closeBadgeModal() {
    document.getElementById('badge-modal').style.display = 'none';
    _badgeShowing = false;
    if (_badgeQueue.length > 0) {
      setTimeout(showNextBadge, 400);
    }
  }

  /* ---- Theme & Accent ------------------------------ */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.checked = theme === 'dark';
  }

  function applyAccent(accent) {
    document.documentElement.setAttribute('data-accent', accent);
    syncTimerGradient(accent);
  }

  function syncTimerGradient(accent) {
    const panel = document.getElementById('pomo-panel');
    if (!panel) return;
    const map = { purple: 1, blue: 2, green: 4, orange: 6, pink: 7, red: 8 };
    panel.dataset.grad = String(map[accent] || 1);
  }

  /* ---- Live Clock ---------------------------------- */

  function setupClock() {
    const el = document.getElementById('dashboard-clock');
    if (!el) return;

    const PERIODS = [
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
      { label: 'Dawn',      icon: '🌅', a: '#f97316', b: '#fbbf24' },
      { label: 'Morning',   icon: '☀️',  a: '#f59e0b', b: '#10b981' },
      { label: 'Morning',   icon: '☀️',  a: '#f59e0b', b: '#10b981' },
      { label: 'Morning',   icon: '☀️',  a: '#f59e0b', b: '#10b981' },
      { label: 'Morning',   icon: '☀️',  a: '#f59e0b', b: '#10b981' },
      { label: 'Morning',   icon: '☀️',  a: '#f59e0b', b: '#10b981' },
      { label: 'Morning',   icon: '☀️',  a: '#f59e0b', b: '#10b981' },
      { label: 'Afternoon', icon: '🌤️',  a: '#3b82f6', b: '#06b6d4' },
      { label: 'Afternoon', icon: '🌤️',  a: '#3b82f6', b: '#06b6d4' },
      { label: 'Afternoon', icon: '🌤️',  a: '#3b82f6', b: '#06b6d4' },
      { label: 'Afternoon', icon: '🌤️',  a: '#3b82f6', b: '#06b6d4' },
      { label: 'Afternoon', icon: '🌤️',  a: '#3b82f6', b: '#06b6d4' },
      { label: 'Evening',   icon: '🌆', a: '#8b5cf6', b: '#ec4899' },
      { label: 'Evening',   icon: '🌆', a: '#8b5cf6', b: '#ec4899' },
      { label: 'Evening',   icon: '🌆', a: '#8b5cf6', b: '#ec4899' },
      { label: 'Evening',   icon: '🌆', a: '#8b5cf6', b: '#ec4899' },
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
    ];

    // Build DOM once
    el.innerHTML = `
      <div class="clock-inner">
        <div class="clock-top-row">
          <span id="clock-period-icon"></span>
          <span id="clock-period-label"></span>
          <span class="clock-top-sep">·</span>
          <span id="clock-date-row" class="clock-date-row"></span>
        </div>
        <div class="clock-time-row">
          <span id="clock-hm" class="clock-hm"></span>
          <span class="clock-colon">:</span>
          <span id="clock-ss" class="clock-ss"></span>
          <span id="clock-ampm" class="clock-ampm"></span>
        </div>
        <div class="clock-sec-bar"><div id="clock-sec-fill" class="clock-sec-fill"></div></div>
      </div>`;

    const iconEl  = document.getElementById('clock-period-icon');
    const labelEl = document.getElementById('clock-period-label');
    const dateEl  = document.getElementById('clock-date-row');
    const hmEl    = document.getElementById('clock-hm');
    const ssEl    = document.getElementById('clock-ss');
    const ampmEl  = document.getElementById('clock-ampm');
    const fillEl  = document.getElementById('clock-sec-fill');

    let lastHour = -1;

    const tick = () => {
      const now    = new Date();
      const h      = now.getHours();
      const s      = now.getSeconds();
      const period = PERIODS[h];

      if (h !== lastHour) {
        lastHour = h;
        el.style.setProperty('--clock-a', period.a);
        el.style.setProperty('--clock-b', period.b);
        if (iconEl)  iconEl.textContent  = period.icon;
        if (labelEl) labelEl.textContent = period.label;
      }

      const t    = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const ampm = t.slice(-2);
      const hm   = t.slice(0, -3).trim();
      const date = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

      if (dateEl) dateEl.textContent = date;
      if (hmEl)   hmEl.textContent   = hm;
      if (ssEl)   ssEl.textContent   = String(s).padStart(2, '0');
      if (ampmEl) ampmEl.textContent = ampm;
      if (fillEl) fillEl.style.width = `${(s / 60) * 100}%`;
    };

    tick();
    setInterval(tick, 1000);
  }

  /* ---- Daily Reminder ------------------------------ */

  function setupReminder() {
    // Wire Test button
    document.getElementById('test-reminder-btn')?.addEventListener('click', async () => {
      if (!('Notification' in window)) {
        showToast('Your browser does not support notifications.', 'error');
        return;
      }
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      if (perm === 'denied') {
        showToast('Notifications are blocked. Enable them in your browser settings, then try again.', 'warning');
        return;
      }
      if (perm !== 'granted') return;
      fireReminder(true);
      showToast('Test notification sent!', 'success');
    });

    // Align to the next minute boundary, then tick every 60 s
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    setTimeout(() => {
      checkReminder();
      setInterval(checkReminder, 60_000);
    }, msToNextMinute);
  }

  function checkReminder() {
    if (!_prefs.reminder) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const now  = new Date();
    const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    if (hhmm !== (_prefs.reminderTime || '20:00')) return;

    // Fire at most once per day
    const today = Analytics.today();
    const shownKey = 'lt_reminder_shown';
    if (localStorage.getItem(shownKey) === today) return;
    localStorage.setItem(shownKey, today);

    fireReminder(false);
  }

  function fireReminder(isTest) {
    const today    = Analytics.today();
    const todayMin = _entries
      .filter(e => e.date === today)
      .reduce((s, e) => s + (e.durationMinutes || 0), 0);
    const goalMin = _prefs.dailyGoalMin || 60;

    let body;
    if (todayMin === 0) {
      body = "You haven't logged any learning today. Time to get started!";
    } else if (todayMin < goalMin) {
      const left = Analytics.formatDuration(goalMin - todayMin);
      body = `You've logged ${Analytics.formatDuration(todayMin)} today — ${left} left to hit your daily goal!`;
    } else {
      body = `Daily goal smashed! You've logged ${Analytics.formatDuration(todayMin)} today. Keep it up!`;
    }

    if (isTest) body = `[Test] ${body}`;

    try {
      new Notification('LearnTrack', {
        body,
        icon: 'assets/icons/icon-192.png',
        tag:  isTest ? 'learntrack-test' : 'learntrack-daily-reminder',
      });
    } catch (err) {
      showToast('Could not send notification: ' + err.message, 'error');
    }
  }

  /* ---- Pomodoro Timer ------------------------------ */

  function setupPomodoro() {
    // Toggle panel from floating FAB
    document.getElementById('pomo-fab')?.addEventListener('click', () => {
      if (PomodoroTimer.isPanelOpen()) PomodoroTimer.closePanel();
      else { syncTimerGradient(_prefs.accent); PomodoroTimer.openPanel(); }
    });

    // "Log this session" button — pre-fills the entry modal
    document.getElementById('pomo-log-btn')?.addEventListener('click', () => {
      const last = PomodoroTimer.getLastWork();
      if (!last) return;
      openEntryModal(null);
      if (last.topic) {
        const topicEl = document.getElementById('entry-topic');
        if (topicEl) topicEl.value = last.topic;
      }
      const durEl = document.getElementById('entry-duration');
      if (durEl) durEl.value = last.minutes;
      PomodoroTimer.closePanel();
    });

    // Init with callback that fires when a session ends
    PomodoroTimer.init(({ wasWork }) => {
      if (wasWork) showToast('🍅 Focus session complete! Take a well-earned break.', 'success');
      else         showToast('☕ Break over! Ready to focus again?', 'info');
    });
  }

  function setupThemeToggle() {
    document.getElementById('theme-toggle')?.addEventListener('change', async (e) => {
      const next = e.target.checked ? 'dark' : 'light';
      _prefs.theme = next;
      await Storage.setPref('theme', next);
      applyTheme(next);
      document.querySelectorAll('.theme-option').forEach(b => b.classList.toggle('active', b.dataset.theme === next));
    });

  }

  function applyCompact(compact) {
    document.body.classList.toggle('compact-mode', !!compact);
  }

  /* ---- User Picker --------------------------------- */

  function setupUserPicker() {
    document.getElementById('create-user-submit-btn')?.addEventListener('click', () => {
      const name = document.getElementById('new-user-name-input')?.value.trim();
      if (!name) { showToast('Please enter a name', 'warning'); return; }
      const existing = UserManager.getUsers().find(u => u.name.toLowerCase() === name.toLowerCase());
      if (existing) { showToast(`A profile named "${existing.name}" already exists.`, 'warning'); return; }
      const user = UserManager.createUser(name);
      switchUser(user.id, name);
    });
    document.getElementById('new-user-name-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('create-user-submit-btn')?.click();
    });
    document.getElementById('user-picker-cancel-btn')?.addEventListener('click', closeUserPicker);
    document.getElementById('user-picker-modal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('user-picker-modal')) closeUserPicker();
    });
  }

  function openUserPicker(canCancel = true) {
    const modal = document.getElementById('user-picker-modal');
    if (!modal) return;

    const listSection = document.getElementById('user-list-section');
    if (listSection) {
      const users    = UserManager.getUsers();
      const activeId = UserManager.getActiveId();
      listSection.innerHTML = users.map(u => `
        <div class="user-pick-item${u.id === activeId ? ' current' : ''}" data-uid="${u.id}" role="button" tabindex="0">
          <div class="user-pick-avatar" style="background:${u.color}">${u.name.charAt(0).toUpperCase()}</div>
          <span class="user-pick-name">${escapeHtml(u.name)}</span>
          ${u.id === activeId ? '<span class="user-pick-active-badge">Current</span>' : ''}
        </div>
      `).join('');
      listSection.querySelectorAll('.user-pick-item').forEach(el => {
        el.addEventListener('click', () => {
          const uid = el.dataset.uid;
          if (uid !== UserManager.getActiveId()) { switchUser(uid); } else { closeUserPicker(); }
        });
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') el.click(); });
      });
    }

    const nameInput = document.getElementById('new-user-name-input');
    if (nameInput) nameInput.value = '';

    const footer = document.getElementById('user-picker-footer');
    if (footer) footer.style.display = canCancel ? 'flex' : 'none';

    modal.style.display = 'flex';
    setTimeout(() => nameInput?.focus(), 100);
  }

  function closeUserPicker() {
    const modal = document.getElementById('user-picker-modal');
    if (modal) modal.style.display = 'none';
  }

  async function switchUser(userId, defaultUsername = null) {
    closeUserPicker();
    UserManager.setActiveId(userId);
    _badgeQueue.length = 0;
    _badgeShowing      = false;
    try {
      await Storage.init(userId);
      _entries   = await Storage.getAllEntries();
      _prefs     = { ...DEFAULT_PREFS, ...(await Storage.getAllPrefs()) };
      _earnedAch = await Storage.getAllAchievements();
    } catch (err) {
      console.error('[App] Switch user error:', err);
    }
    // For a brand-new profile, use its name as the default display name
    if (defaultUsername && _prefs.username === DEFAULT_PREFS.username) {
      _prefs.username = defaultUsername;
      await Storage.setPref('username', defaultUsername);
    }
    applyTheme(_prefs.theme);
    applyAccent(_prefs.accent);
    applyCompact(_prefs.compact);
    updateSidebarUser();
    // Restore this profile's last backup timestamp
    _lastAutoBackup = parseInt(localStorage.getItem(`lt_last_auto_backup_${userId}`) || '0', 10);
    const sbEl = document.getElementById('sidebar-backup-status');
    if (sbEl) sbEl.style.display = _lastAutoBackup ? 'flex' : 'none';
    if (_lastAutoBackup) updateSidebarBackupStatus(false);
    navigateTo('dashboard');
    showToast(`Switched to "${UserManager.getActive()?.name || 'profile'}"`, 'success');
  }

  function renderUsersManagement() {
    const list = document.getElementById('users-management-list');
    if (!list) return;
    const users    = UserManager.getUsers();
    const activeId = UserManager.getActiveId();

    list.innerHTML = users.map(u => `
      <div class="user-manage-row${u.id === activeId ? ' active-user' : ''}">
        <div class="user-manage-avatar" style="background:${u.color}">${u.name.charAt(0).toUpperCase()}</div>
        <div class="user-manage-info">
          <div class="user-manage-name-wrap">
            <span class="user-manage-name">${escapeHtml(u.name)}</span>
            <input type="text" class="user-manage-rename-input hidden" value="${escapeHtml(u.name)}" maxlength="30" />
          </div>
          ${u.id === activeId ? '<span class="user-active-badge">Active</span>' : ''}
        </div>
        <div class="user-manage-actions">
          <button class="btn btn-ghost btn-sm" data-action="user-rename" data-uid="${u.id}" title="Rename profile">✏️</button>
          <button class="btn btn-primary btn-sm hidden" data-action="user-rename-save" data-uid="${u.id}">Save</button>
          ${u.id !== activeId ? `<button class="btn btn-ghost btn-sm" data-action="user-switch" data-uid="${u.id}">Switch</button>` : ''}
          ${users.length > 1 && u.id !== activeId ? `<button class="btn btn-ghost btn-sm btn-danger-ghost" data-action="user-delete" data-uid="${u.id}">Delete</button>` : ''}
        </div>
      </div>
    `).join('') || '<p class="settings-hint">No profiles found.</p>';

    list.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.dataset.uid;
        const row = btn.closest('.user-manage-row');
        if (btn.dataset.action === 'user-switch') { switchUser(uid); return; }
        if (btn.dataset.action === 'user-delete') { confirmDeleteUser(uid); return; }
        if (btn.dataset.action === 'user-rename') {
          row?.querySelector('.user-manage-name')?.classList.add('hidden');
          const input = row?.querySelector('.user-manage-rename-input');
          if (input) { input.classList.remove('hidden'); input.focus(); input.select(); }
          btn.classList.add('hidden');
          row?.querySelector('[data-action="user-rename-save"]')?.classList.remove('hidden');
        }
        if (btn.dataset.action === 'user-rename-save') {
          const input   = row?.querySelector('.user-manage-rename-input');
          const newName = input?.value.trim();
          if (!newName) { showToast('Name cannot be empty', 'warning'); return; }
          const duplicate = UserManager.getUsers().find(u => u.id !== uid && u.name.toLowerCase() === newName.toLowerCase());
          if (duplicate) { showToast(`A profile named "${duplicate.name}" already exists.`, 'warning'); return; }
          UserManager.updateUser(uid, newName);
          if (uid === UserManager.getActiveId()) {
            _prefs.username = newName;
            Storage.setPref('username', newName);
            updateSidebarUser();
          }
          showToast('Profile renamed', 'success');
          renderUsersManagement();
        }
      });
    });

    list.querySelectorAll('.user-manage-rename-input').forEach(input => {
      input.addEventListener('keydown', e => {
        const row = input.closest('.user-manage-row');
        if (e.key === 'Enter')  row?.querySelector('[data-action="user-rename-save"]')?.click();
        if (e.key === 'Escape') renderUsersManagement();
      });
    });
  }

  function confirmDeleteUser(userId) {
    const user = UserManager.getUsers().find(u => u.id === userId);
    if (!user) return;
    showConfirm(
      `Delete "${user.name}" profile?`,
      'All learning data for this profile will be permanently deleted. This cannot be undone.',
      () => {
        UserManager.deleteUser(userId);
        showToast(`Profile "${user.name}" deleted`, 'info');
        renderUsersManagement();
        updateSidebarUser();
      }
    );
  }

  /* ---- Confirm Modal ------------------------------- */

  let _confirmCallback = null;

  function showConfirm(title, message, onConfirm) {
    _confirmCallback = onConfirm;
    setEl('confirm-modal-title', title);
    setEl('confirm-modal-message', message);
    document.getElementById('confirm-modal').style.display = 'flex';

    document.getElementById('confirm-ok').onclick = async () => {
      const cb = _confirmCallback; // capture before close clears it
      closeConfirmModal();
      if (cb) await cb();
    };

    document.getElementById('confirm-cancel').onclick = closeConfirmModal;
  }

  function closeConfirmModal() {
    document.getElementById('confirm-modal').style.display = 'none';
    _confirmCallback = null;
  }

  /* ---- Toast Notifications ------------------------- */

  function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
      <button class="toast-close" aria-label="Dismiss">✕</button>
    `;

    toast.querySelector('.toast-close')?.addEventListener('click', () => dismissToast(toast));
    container.appendChild(toast);

    setTimeout(() => dismissToast(toast), duration);
  }

  function dismissToast(toast) {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 250);
  }

  /* ---- Animated Counter ---------------------------- */

  function animateCounter(elId, target, decimals = 0, suffix = '') {
    const el = document.getElementById(elId);
    if (!el) return;

    const start    = 0;
    const duration = 600;
    const startTs  = performance.now();

    function step(ts) {
      const progress = Math.min((ts - startTs) / duration, 1);
      const ease     = 1 - Math.pow(1 - progress, 3);
      const current  = start + (target - start) * ease;
      el.textContent = decimals > 0 ? current.toFixed(decimals) + suffix : Math.round(current) + suffix;
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  /* ---- Utility Helpers ----------------------------- */

  function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function setInputVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  function setCheckbox(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = checked;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str || '');
    return d.innerHTML;
  }

  // Returns the URL only when it uses http(s); anything else (javascript:, data:,
  // vbscript:, …) is replaced with '#' to prevent stored-XSS via resource links.
  function safeHref(url) {
    try {
      const u = new URL(url);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? url : '#';
    } catch { return '#'; }
  }

  function capitalise(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  function formatRelativeDate(dateStr) {
    const today = Analytics.today();
    const diff  = Analytics.daysBetween(today, dateStr);
    if (dateStr === today) return 'Today';
    if (diff === 1)        return 'Yesterday';
    if (diff < 7)          return `${diff} days ago`;
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function formatDateRange(from, to) {
    const opts = { month: 'short', day: 'numeric' };
    const f    = new Date(from + 'T12:00:00').toLocaleDateString('en-US', opts);
    const t    = new Date(to   + 'T12:00:00').toLocaleDateString('en-US', opts);
    return `${f} – ${t}`;
  }

  function createEmptyState() {
    const el = document.createElement('div');
    el.id = 'log-empty-state';
    el.className = 'empty-state';
    el.innerHTML = `
      <div class="empty-icon">📚</div>
      <h3>No learning entries yet</h3>
      <p>Start tracking your learning journey.</p>
      <button class="btn btn-primary" onclick="document.getElementById('add-entry-btn').click()">Add First Entry</button>
    `;
    return el;
  }

  /* ---- Public API ---------------------------------- */
  return { init, navigateTo, showToast };

})();

/* ---- Boot ---------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  App.init().catch(err => console.error('[App] Fatal error:', err));
});
