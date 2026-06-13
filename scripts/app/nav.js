/* ===== nav.js — extracted from app.js ===== */
import { state } from './state.js';
import { renderAchievements } from './achievements.js';
import { init } from './core.js';
import { cacheActiveUserStats, openMilestoneListModal, openTopTopicsModal, renderDashboard, renderDashboardHeatmap, showTopicsModal, showWeekdayModal } from './dashboard.js';
import { renderDeletedLogs } from './deleted-logs.js';
import { renderDeletedGoals, renderGoals, setupDeletedGoalsPage } from './goals.js';
import { openEntryModal, renderLog } from './log.js';
import { renderReports } from './reports.js';
import { renderBackup, renderSettings } from './settings.js';
import { UserManager, openUserPicker, renderUsersManagement } from './users.js';
import { loadEntitlements } from './entitlements.js';
import { setEl } from './utils.js';

  /* ---- Navigation ---------------------------------- */

  export function clearLogFilters() {
    ['log-search','filter-date-from','filter-date-to','filter-category','filter-difficulty'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const sort = document.getElementById('filter-sort');
    if (sort) sort.value = 'newest';
    state.logGoalContext = null;
    state.logLinkedGoalFilter = null;
    state.logMilestoneContext = null;
    updateFilterToggleState();
  }

  export function updateFilterToggleState() {
    const active =
      (document.getElementById('log-search')?.value || '') !== '' ||
      (document.getElementById('filter-date-from')?.value || '') !== '' ||
      (document.getElementById('filter-date-to')?.value || '') !== '' ||
      (document.getElementById('filter-category')?.value || '') !== '' ||
      (document.getElementById('filter-difficulty')?.value || '') !== '' ||
      (document.getElementById('filter-sort')?.value || 'newest') !== 'newest';
    document.getElementById('filter-toggle')?.classList.toggle('has-filters', active);
  }

  export function updateDlFilterToggleState() {
    const active =
      (document.getElementById('dl-search')?.value || '') !== '' ||
      (document.getElementById('dl-filter-date-from')?.value || '') !== '' ||
      (document.getElementById('dl-filter-date-to')?.value || '') !== '' ||
      (document.getElementById('dl-filter-category')?.value || '') !== '' ||
      (document.getElementById('dl-filter-difficulty')?.value || '') !== '' ||
      (document.getElementById('dl-filter-sort')?.value || 'deleted-newest') !== 'deleted-newest';
    document.getElementById('dl-filter-toggle')?.classList.toggle('has-filters', active);
  }

  export function updateDgFilterToggleState() {
    const active =
      (document.getElementById('dg-search')?.value || '') !== '' ||
      (document.getElementById('dg-filter-category')?.value || '') !== '' ||
      (document.getElementById('dg-filter-type')?.value || '') !== '' ||
      (document.getElementById('dg-filter-sort')?.value || 'deleted-newest') !== 'deleted-newest';
    document.getElementById('dg-filter-toggle')?.classList.toggle('has-filters', active);
  }

  export function setupNavigation() {
    document.querySelectorAll('[data-page]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const page = link.dataset.page;
        if (page === 'log') clearLogFilters();
        if (page === 'goals' && link.dataset.expandGoals) {
          state.goalsCollapsed = { overdue: false, open: false, completed: false, archived: false };
          state.goalsCollapsedSnapshot = null;
        }
        if (page) navigateTo(page);
      });
      if (link.getAttribute('role') === 'button') {
        link.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const page = link.dataset.page;
            if (page) navigateTo(page);
          }
        });
      }
    });

    const logoBtn = document.getElementById('logo-home-btn');
    if (logoBtn) {
      logoBtn.addEventListener('click', () => window.location.href = 'landing.html');
      logoBtn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') window.location.href = 'landing.html'; });
    }

    document.getElementById('daily-quote-chip')?.addEventListener('click', () => {
      setEl('daily-quote-text', Insights.getRandomQuote());
    });
  }

  export function navigateTo(page) {
    state.currentPage = page;

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

    // Clear goal-context breadcrumb and link filter when leaving the log page
    if (page !== 'log') { state.logGoalContext = null; state.logLinkedGoalFilter = null; state.logMilestoneContext = null; }
    // Clear the "back to link modal" chips when leaving the goals page
    if (page !== 'goals') {
      state.linkModalReturnEntryId = null; state.linkModalReturnGoalId = null;
      state.dlReturnEntry = null; state.dlReturnGoalId = null;
    }

    // Reset deleted logs state when navigating away
    if (page !== 'deleted-logs') {
      state.deletedPage = 1;
      state.deletedSelection.clear();
    }
    if (page !== 'deleted-goals') {
      state.deletedGoalsSelection.clear();
    }
    if (page !== 'goals') {
      state.goalsSelection.clear();
    }

    // Reset so renderGoalProgress treats each dashboard visit as a fresh arrival
    if (page === 'dashboard') state.goalLastPct = -1;

    renderPage(page);

    // Scroll to top
    window.scrollTo(0, 0);
  }

  /* ---- Sidebar ------------------------------------- */

  export function openMobileSidebar() {
    document.getElementById('sidebar')?.classList.add('mobile-open');
    document.getElementById('mobile-sidebar-overlay')?.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  export function closeMobileSidebar() {
    document.getElementById('sidebar')?.classList.remove('mobile-open');
    document.getElementById('mobile-sidebar-overlay')?.classList.remove('active');
    document.body.style.overflow = '';
  }

  export function setupSidebar() {
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        closeMobileSidebar();
      } else {
        document.getElementById('app').classList.toggle('sidebar-collapsed');
        setTimeout(() => {
          Charts.resizeAllCharts();
          if (state.currentPage === 'dashboard') {
            renderDashboardHeatmap();
          }
        }, 300);
      }
    });
    document.getElementById('user-switch-btn')?.addEventListener('click', e => { e.stopPropagation(); openUserPicker(true); });
    ['sidebar-level', 'sidebar-xp-bar', 'sidebar-xp-text', 'sidebar-level-title'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => navigateTo('achievements'));
    });
    const statLevelCard = document.getElementById('stat-level-card');
    if (statLevelCard) {
      statLevelCard.addEventListener('click', () => { state.achievementsReturnTo = 'dashboard'; navigateTo('achievements'); });
      statLevelCard.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); statLevelCard.click(); } });
    }

    // Total Hours, Streak, Total Entries → drill into log
    function _statCardToLog(label, buildStreakDates, source) {
      let streakDates;
      if (buildStreakDates) {
        const info = Analytics.calculateStreaks(state.entries);
        streakDates = new Set();
        if (info.current > 0) {
          const allDates = [...info.activeDates].sort().reverse();
          const latest   = allDates[0];
          let d = new Date(latest + 'T12:00:00');
          for (let i = 0; i < info.current; i++) {
            streakDates.add(d.toISOString().split('T')[0]);
            d.setDate(d.getDate() - 1);
          }
        }
      }
      state.logStatContext  = { label, streakDates, source };
      state.logForceExpand  = true;
      navigateTo('log');
    }
    [
      { id: 'stat-hours-card',   label: 'Total Hours',    streak: false, source: 'stat-hours'   },
      { id: 'stat-streak-card',  label: 'Current Streak', streak: true,  source: 'stat-streak'  },
      { id: 'stat-entries-card', label: 'Total Entries',  streak: false, source: 'stat-entries' },
    ].forEach(({ id, label, streak, source }) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click',   ()  => _statCardToLog(label, streak, source));
      el.addEventListener('keydown', e   => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
    });

    const todayCard = document.getElementById('today-summary-card');
    if (todayCard) {
      todayCard.addEventListener('click', e => {
        if (e.target.closest('.today-log-btn')) return;
        state.logStatContext = { label: 'Today', streakDates: new Set([Analytics.today()]), source: 'today-card' };
        state.logForceExpand = true;
        navigateTo('log');
      });
    }

    const weekCard = document.getElementById('summary-week-card');
    if (weekCard) {
      weekCard.addEventListener('click', () => {
        const w = Analytics.calculateWeeklySummary(state.entries);
        state.logStatContext = { label: 'This Week', dateFrom: w.from, dateTo: w.to, source: 'weekly-chart' };
        state.logForceExpand = true;
        navigateTo('log');
      });
    }

    const monthCard = document.getElementById('summary-month-card');
    if (monthCard) {
      monthCard.addEventListener('click', () => {
        const m = Analytics.calculateMonthlySummary(state.entries);
        state.logStatContext = { label: 'This Month', dateFrom: m.from, dateTo: m.to, source: 'monthly-chart' };
        state.logForceExpand = true;
        navigateTo('log');
      });
    }
    document.getElementById('mobile-sidebar-overlay')?.addEventListener('click', closeMobileSidebar);

    // Swipe left on the sidebar to close it on mobile
    const _swipeSidebar = document.getElementById('sidebar');
    if (_swipeSidebar) {
      let _swStartX = 0, _swStartY = 0, _swLastX = 0;
      let _swTracking = false, _swCommitted = false;

      _swipeSidebar.addEventListener('touchstart', e => {
        if (window.innerWidth > 768 || !_swipeSidebar.classList.contains('mobile-open')) return;
        _swStartX = _swLastX = e.touches[0].clientX;
        _swStartY = e.touches[0].clientY;
        _swTracking = true;
        _swCommitted = false;
      }, { passive: true });

      _swipeSidebar.addEventListener('touchmove', e => {
        if (!_swTracking) return;
        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;
        const dx = x - _swStartX;
        _swLastX = x;

        if (!_swCommitted) {
          if (Math.abs(dx) < 6 && Math.abs(y - _swStartY) < 6) return; // dead zone
          if (Math.abs(y - _swStartY) >= Math.abs(dx)) { _swTracking = false; return; } // vertical scroll
          _swCommitted = true;
          _swipeSidebar.style.transition = 'none';
        }

        _swipeSidebar.style.transform = `translateX(${Math.min(0, dx)}px)`;
      }, { passive: true });

      const _swFinish = () => {
        if (!_swTracking) return;
        _swTracking = false;
        if (!_swCommitted) return;
        _swCommitted = false;
        _swipeSidebar.style.transition = '';
        if (_swLastX - _swStartX < -80) {
          _swipeSidebar.style.transform = 'translateX(-100%)';
          closeMobileSidebar();
          _swipeSidebar.addEventListener('transitionend', () => { _swipeSidebar.style.transform = ''; }, { once: true });
        } else {
          _swipeSidebar.style.transform = '';
        }
      };

      _swipeSidebar.addEventListener('touchend',   _swFinish, { passive: true });
      _swipeSidebar.addEventListener('touchcancel', _swFinish, { passive: true });
    }
  }

  export function updateSidebarUser() {
    const streak  = Analytics.calculateStreaks(state.entries);
    const stats   = Analytics.calculateTotalStats(state.entries);
    const totalXP = Rewards.calculateTotalXP(state.entries, streak, state.prefs.dailyGoalMin, state.prefs.goalHistory, state.earnedAch);
    const lvInfo  = Rewards.getLevelInfo(totalXP);
    const activeUser = UserManager.getActive();
    const name    = activeUser?.name || state.prefs.username || 'Learner';

    setEl('sidebar-username', name);
    setEl('sidebar-level', lvInfo.level);
    setEl('sidebar-level-title', lvInfo.title);
    setEl('sidebar-streak-count', streak.current);
    setEl('user-initials', name.charAt(0).toUpperCase());

    const xpBar = document.getElementById('sidebar-xp-bar');
    if (xpBar) xpBar.style.width = `${lvInfo.progressPct}%`;
    setEl('sidebar-xp-text', `${lvInfo.xpIntoLevel} / ${lvInfo.xpNeededForNext || '∞'} XP`);

    // Tint avatar with user's color
    const avatar = document.getElementById('user-avatar');
    if (avatar && activeUser?.color) avatar.style.background = activeUser.color;

    // Show/hide switch button — only meaningful when there are multiple profiles
    const switchBtn = document.getElementById('user-switch-btn');
    if (switchBtn) switchBtn.style.display = UserManager.getUsers().length > 1 ? 'inline-flex' : 'none';
  }

  /* ---- Mobile Nav ---------------------------------- */

  export function setupMobileNav() {
    document.getElementById('mobile-more-btn')?.addEventListener('click', e => {
      e.preventDefault();
      const sidebar = document.getElementById('sidebar');
      if (sidebar?.classList.contains('mobile-open')) closeMobileSidebar();
      else openMobileSidebar();
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

  export function renderPage(page) {
    switch (page) {
      case 'dashboard':
        renderDashboard();
        if (state.dashboardReopenMilestoneModal) { state.dashboardReopenMilestoneModal = false; openMilestoneListModal(); }
        if (state.dashboardReopenWeekdayModal)   { state.dashboardReopenWeekdayModal = false;   showWeekdayModal(); }
        if (state.dashboardReopenTopicsModal)    { state.dashboardReopenTopicsModal   = false;   openTopTopicsModal(); }
        if (state.dashboardReopenSubjectsModal)  { state.dashboardReopenSubjectsModal = false;   showTopicsModal(); }
        if (state.dashboardScrollToCardId) {
          const cardId = state.dashboardScrollToCardId;
          state.dashboardScrollToCardId = null;
          setTimeout(() => {
            const card = document.getElementById(cardId);
            if (card) {
              card.scrollIntoView({ behavior: 'smooth', block: 'center' });
              card.classList.remove('chart-card--flash');
              void card.offsetWidth;
              card.classList.add('chart-card--flash');
              card.addEventListener('animationend', () => card.classList.remove('chart-card--flash'), { once: true });
            }
          }, 120);
        }
        break;
      case 'log':            renderLog();            break;
      case 'deleted-logs':   renderDeletedLogs();    break;
      case 'reports':        renderReports();        break;
      case 'calendar':       renderCalendar();       break;
      case 'goals':          state.goalsRenderOrder = null; renderGoals(); break;
      case 'deleted-goals':  setupDeletedGoalsPage(); renderDeletedGoals(); break;
      case 'achievements':   renderAchievements();   break;
      case 'profiles':       renderProfiles();       break;
      case 'settings':       renderSettings();       break;
      case 'backup':         renderBackup();         break;
    }
  }

  /* ---- CALENDAR PAGE ------------------------------- */

  export function renderCalendar() {
    Calendar.init(state.entries, {
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
            updateFilterToggleState();
        navigateTo('log');
      },
    });
  }

  /* ---- PROFILES PAGE ------------------------------- */

  export function renderProfiles() {
    cacheActiveUserStats();
    // Refresh entitlements from cloud so profile_limit reflects any plan changes,
    // then re-render so the limit note and create button state are always current.
    loadEntitlements().finally(() => renderUsersManagement());
  }
