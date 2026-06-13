/* ===== dashboard.js — extracted from app.js ===== */
import { state, DEFAULT_PREFS } from './state.js';
import { _goalStatusOf } from './goals.js';
import { openEntryModal } from './log.js';
import { navigateTo } from './nav.js';
import { UserManager } from './users.js';
import { getCategoryColor } from './settings.js';
import { _closeModal, _openModal, animateCounter, escapeHtml, formatDateRange, formatRelativeDate, setEl, showToast } from './utils.js';

  /* ---- DASHBOARD ----------------------------------- */

  export function cacheActiveUserStats() {
    const userId = UserManager.getActiveId();
    if (!userId) return;
    const streak  = Analytics.calculateStreaks(state.entries);
    const totalXP = Rewards.calculateTotalXP(state.entries, streak, state.prefs.dailyGoalMin, state.prefs.goalHistory, state.earnedAch);
    const lvInfo  = Rewards.getLevelInfo(totalXP);
    try {
      localStorage.setItem(`lt_ustats_${userId}`, JSON.stringify({
        xp:             totalXP,
        level:          lvInfo.level,
        title:          lvInfo.title,
        xpIntoLevel:    lvInfo.xpIntoLevel,
        xpNeededForNext:lvInfo.xpNeededForNext,
        progressPct:    lvInfo.progressPct,
        streak:         streak.current,
        updatedAt:      Date.now(),
      }));
    } catch {}
  }

  export async function renderDashboard() {
    const streak      = Analytics.calculateStreaks(state.entries);
    const stats       = Analytics.calculateTotalStats(state.entries);
    const consistency = Analytics.calculateConsistency(state.entries);
    const weekly      = Analytics.calculateWeeklySummary(state.entries);
    const monthly     = Analytics.calculateMonthlySummary(state.entries);
    const totalXP     = Rewards.calculateTotalXP(state.entries, streak, state.prefs.dailyGoalMin, state.prefs.goalHistory, state.earnedAch);
    const lvInfo      = Rewards.getLevelInfo(totalXP);
    const curve       = Analytics.calculateLearningCurve(state.entries);
    cacheActiveUserStats();

    // Greeting & quote
    const username = state.prefs.username || 'Learner';
    const greetingEl = document.getElementById('dashboard-greeting');
    if (greetingEl) {
      const greetingText = Insights.getGreeting(username);
      const splitIdx = greetingText.indexOf('! ');
      if (splitIdx !== -1) {
        // Build with text nodes so the user-supplied username can never inject HTML.
        const head = greetingText.slice(0, splitIdx + 1);
        const tail = greetingText.slice(splitIdx + 2);
        greetingEl.replaceChildren(
          document.createTextNode(head),
          document.createElement('br'),
          document.createTextNode(tail)
        );
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
    const monthGoalMin = _monthGoalHrFor(Analytics.today().slice(0, 7)) * 60;
    const monthPct     = Math.min(100, Math.round((monthly.totalMinutes / monthGoalMin) * 100));
    const monthBar     = document.getElementById('month-progress-bar');
    if (monthBar) monthBar.style.width = `${monthPct}%`;
    setEl('month-goal-text', `${monthPct}% of monthly goal`);

    // Next milestone — sourced from the 1000 code-generated Insights.MILESTONES
    const milestone = Insights.getNextMilestone(state.entries, streak, stats);
    setEl('milestone-icon', milestone.icon);
    setEl('milestone-name', milestone.name);
    const milPct = milestone.allDone ? 100 : Math.round((milestone.current / milestone.max) * 100);
    const milBar = document.getElementById('milestone-bar');
    if (milBar) milBar.style.width = `${milPct}%`;
    setEl('milestone-meta', milestone.allDone ? `${milestone.total} / ${milestone.total} (100%)` : `${milestone.current} / ${milestone.max} (${milPct}%)`);
    setEl('milestone-count', `${milestone.achieved} milestones achieved`);

    // Daily goal progress + today summary
    renderGoalProgress();
    renderTodaySummary();

    // Activity feed
    renderActivityFeed();


    // Badges mini grid + medals
    renderBadgesMini();
    renderMedals();

    // Academic Goals widget
    renderGoalsDashboardWidget();

    // Full analytics section
    renderDashboardAnalytics();
  }

  export function renderWeekBars(days) {
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

  export function _monthGoalHrFor(yearMonth) {
    const history = state.prefs.monthlyGoalHistory || [];
    if (!history.length) return state.prefs.monthlyGoalHr || 20;
    let best = null;
    for (const g of history) {
      if (g.from <= yearMonth && (!best || g.from > best.from)) best = g;
    }
    return best ? best.goalHr : (state.prefs.monthlyGoalHr || 20);
  }

  export function _dailyGoalMinFor(yearMonth) {
    const history = state.prefs.goalHistory || [];
    if (!history.length) return state.prefs.dailyGoalMin || 60;
    const [y, m] = yearMonth.split('-').map(Number);
    const lastDay = `${yearMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    let best = null;
    for (const g of history) {
      if (g.from <= lastDay && (!best || g.from > best.from)) best = g;
    }
    return best ? best.goalMin : (state.prefs.dailyGoalMin || 60);
  }

  export function renderGoalProgress() {
    const goalMin  = state.prefs.dailyGoalMin || 60;
    const todayStr = Analytics.today();
    const todayMin = state.entries
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

    const ringWrap = document.querySelector('.goal-ring-wrap');
    if (ringWrap) {
      ringWrap.classList.toggle('goal-ring-achieved', pct >= 100);

      const _fireConfetti = () => {
        if (typeof confetti === 'undefined') return;
        const rect = ringWrap.getBoundingClientRect();
        const ox = (rect.left + rect.width / 2) / window.innerWidth;
        const oy = (rect.top + rect.height / 2) / window.innerHeight;
        confetti({
          particleCount: 45,
          spread: 65,
          startVelocity: 22,
          gravity: 0.9,
          scalar: 0.85,
          origin: { x: ox, y: oy },
          colors: ['#10b981', '#6c63ff', '#f59e0b', '#ec4899', '#ffffff'],
        });
      };

      if (!state.goalRingListenerBound) {
        state.goalRingListenerBound = true;
        let _lastCelebMs = 0;

        // Desktop: hover triggers confetti (CSS handles glow)
        ringWrap.addEventListener('mouseenter', () => {
          if (!ringWrap.classList.contains('goal-ring-achieved')) return;
          const now = Date.now();
          if (now - _lastCelebMs < 2000) return;
          _lastCelebMs = now;
          _fireConfetti();
        });

        // Mobile: touchstart triggers confetti + one-shot glow class
        ringWrap.addEventListener('touchstart', () => {
          if (!ringWrap.classList.contains('goal-ring-achieved')) return;
          const now = Date.now();
          if (now - _lastCelebMs < 2000) return;
          _lastCelebMs = now;
          _fireConfetti();
          ringWrap.classList.remove('goal-ring-tapped');
          // Force reflow so re-tapping restarts the animation
          void ringWrap.offsetWidth;
          ringWrap.classList.add('goal-ring-tapped');
          setTimeout(() => ringWrap.classList.remove('goal-ring-tapped'), 1200);
        }, { passive: true });

        // Click → drill into today's log entries
        ringWrap.setAttribute('role', 'button');
        ringWrap.setAttribute('tabindex', '0');
        ringWrap.addEventListener('click', () => {
          const today = Analytics.today();
          state.logStatContext = { label: 'Today', dateFrom: today, dateTo: today, source: 'daily-goal-ring' };
          state.logForceExpand = true;
          navigateTo('log');
        });
        ringWrap.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ringWrap.click(); }
        });
      }

      // Fire confetti whenever pct crosses (or arrives at) 100%.
      // navigateTo resets goalLastPct to -1 so every dashboard visit re-arms the burst.
      // renderPage (entry save, no navigation) leaves goalLastPct at its last value, so
      // a re-render while already at 100% does NOT re-fire.
      // Delay: if the loading overlay is still up (initial page load) wait for it to clear;
      // otherwise a short pause lets the ring animation finish.
      const prevPct = state.goalLastPct;
      state.goalLastPct = pct;
      if (pct >= 100 && prevPct < 100) {
        const overlayUp = document.getElementById('loading-overlay')?.style.display !== 'none';
        setTimeout(_fireConfetti, overlayUp ? 1300 : 300);
      }
    }

    // Weekly goal bars — each day uses the goal that was active on that date
    const container = document.getElementById('goal-week-days');
    if (!container) return;
    const weekly      = Analytics.calculateWeeklySummary(state.entries);
    const goalHistory = state.prefs.goalHistory || [];
    const goalForDate = date => {
      if (!goalHistory.length) return goalMin;
      let best = null;
      for (const g of goalHistory) {
        if (g.from <= date && (!best || g.from > best.from)) best = g;
      }
      return best ? best.goalMin : goalMin;
    };
    const CHECK_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    container.innerHTML = weekly.days.map(d => {
      const dayGoal    = goalForDate(d.date);
      const dayPct     = Math.min(100, Math.round((d.minutes / dayGoal) * 100));
      const met        = d.minutes >= dayGoal;
      const hasData    = d.minutes > 0;
      const stateClass = met ? 'met' : hasData ? 'partial' : 'empty';
      const inner = met
        ? CHECK_SVG
        : hasData ? `<span class="goal-circle-pct">${dayPct}%</span>` : '';
      return `
        <div class="goal-day-item ${stateClass}${d.isToday ? ' is-today' : ''}"
             ${hasData ? `data-date="${d.date}"` : ''}
             title="${d.label}: ${Analytics.formatDuration(d.minutes)} / ${Analytics.formatDuration(dayGoal)} (${dayPct}%)">
          <div class="goal-day-label">${d.label}</div>
          <div class="goal-day-circle">${inner}</div>
        </div>`;
    }).join('');

    if (!container.dataset.clickWired) {
      container.dataset.clickWired = '1';
      container.addEventListener('click', e => {
        const item = e.target.closest('[data-date]');
        if (!item) return;
        const date  = item.dataset.date;
        const label = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        state.logStatContext = { label, streakDates: new Set([date]), source: 'week-rings' };
        state.logForceExpand = true;
        navigateTo('log');
      });
    }
  }

  export function renderTodaySummary() {
    const todayStr     = Analytics.today();
    const todayEntries = state.entries.filter(e => e.date === todayStr);
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

  export function renderActivityFeed() {
    const container = document.getElementById('activity-list');
    if (!container) return;

    const recent = state.entries.slice(0, 8);

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

  export async function renderBadgesMini() {
    const container = document.getElementById('badges-grid-mini');
    if (!container) return;

    const earnedMap = new Map(state.earnedAch.map(a => [a.id, a.earnedAt || 0]));
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

  export function renderMedals() {
    const medals = Rewards.calculateMedals(state.entries, state.prefs.dailyGoalMin, state.prefs.goalHistory);
    ['gold', 'silver', 'bronze'].forEach(tier => {
      document.querySelectorAll(`.medal-count-${tier}`).forEach(el => {
        el.textContent = medals[tier];
      });
    });
  }

  /* ---- ANALYTICS (embedded in dashboard) ----------- */

  export function _scopedEntries(rangeVal) {
    if (rangeVal === 'all') return state.entries;
    const days = parseInt(rangeVal, 10);
    return state.entries.filter(e => e.date >= Analytics.daysAgo(days));
  }

  export function _wireChartTabs(containerId, getVal, setVal, onRefresh) {
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

  export function renderDashboardDailyChart() {
    const days = state.dailyRange === 'all' ? 3650 : parseInt(state.dailyRange, 10);
    const data = Analytics.calculateDailyTimeSeries(_scopedEntries(state.dailyRange), Math.min(days, 90));
    Charts.renderDailyTimeChart('daily-time-chart', data, (date, label) => {
      if (!date) return;
      state.logStatContext = { label, streakDates: new Set([date]), source: 'daily-chart' };
      state.logForceExpand = true;
      navigateTo('log');
    });
  }

  export function renderDashboardMonthlyChart() {
    const data = Analytics.calculateMonthlyTotals(state.entries, parseInt(state.monthlyRange, 10));
    Charts.renderMonthlyChart('monthly-progress-chart', data, (from, to, label) => {
      if (!from) return;
      state.logStatContext = { label, dateFrom: from, dateTo: to, source: 'monthly-bar' };
      state.logForceExpand = true;
      navigateTo('log');
    });
  }

  export function renderDashboardCategoryChart() {
    const data = Analytics.calculateTopicDistribution(_scopedEntries(state.categoryRange), state.prefs.categories || DEFAULT_PREFS.categories);
    Charts.renderTopicChart('topic-distribution-chart', data, (category) => {
      if (!category) return;
      state.logStatContext = { label: category, category, source: 'category-chart' };
      state.logForceExpand = true;
      navigateTo('log');
    });
  }

  export function renderDashboardHeatmap() {
    Charts.renderHeatmap('heatmap-container', Analytics.calculateHeatmapData(state.entries), (date) => {
      const label = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      state.logStatContext = { label, streakDates: new Set([date]), source: 'heatmap' };
      state.logForceExpand = true;
      navigateTo('log');
    });
  }

  export function renderDashboardAnalytics() {
    const streak      = Analytics.calculateStreaks(state.entries);
    const stats       = Analytics.calculateTotalStats(state.entries);
    const consistency = Analytics.calculateConsistency(state.entries);
    const curve       = Analytics.calculateLearningCurve(state.entries);
    const insights    = Insights.generateInsights(state.entries, streak, stats, consistency, curve);
    Insights.renderInsightsRow('insights-row', insights);

    setTimeout(() => {
      renderDashboardDailyChart();
      renderDashboardMonthlyChart();
      renderDashboardCategoryChart();
      renderDashboardHeatmap();
    }, 50);

    _wireChartTabs('daily-range-tabs',
      () => state.dailyRange,    v => { state.dailyRange    = v; }, renderDashboardDailyChart);
    _wireChartTabs('monthly-range-tabs',
      () => state.monthlyRange,  v => { state.monthlyRange  = v; }, renderDashboardMonthlyChart);
    _wireChartTabs('category-range-tabs',
      () => state.categoryRange, v => { state.categoryRange = v; }, renderDashboardCategoryChart);
  }

  export function renderGoalsDashboardWidget() {
    const container = document.getElementById('goals-widget-list');
    if (!container) return;

    const today = Analytics.today();

    // --- Mini stats cards ---
    const statsRow = document.getElementById('goals-mini-stats-row');
    if (statsRow) {
      const openGoals      = state.goals.filter(g => g.status === 'active' && !(g.targetDate && g.targetDate < today));
      const overdueGoals   = state.goals.filter(g => g.status === 'active' && g.targetDate && g.targetDate < today);
      const completedGoals = state.goals.filter(g => g.status === 'completed');
      const archivedGoals  = state.goals.filter(g => g.status === 'archived');
      const overdueClass   = overdueGoals.length > 0 ? ' gms-danger' : '';
      statsRow.innerHTML = `
        <div class="goals-mini-stats">
          <div class="goals-mini-stat gms-clickable" data-gms-filter="all">
            <div class="gms-val">${state.goals.length}</div>
            <div class="gms-label">Total</div>
          </div>
          <div class="goals-mini-stat gms-clickable" data-gms-filter="open">
            <div class="gms-val">${openGoals.length}</div>
            <div class="gms-label">Open</div>
          </div>
          <div class="goals-mini-stat gms-clickable${overdueClass}" data-gms-filter="overdue">
            <div class="gms-val">${overdueGoals.length}</div>
            <div class="gms-label">Overdue</div>
          </div>
          <div class="goals-mini-stat gms-clickable" data-gms-filter="completed">
            <div class="gms-val">${completedGoals.length}</div>
            <div class="gms-label">Completed</div>
          </div>
          <div class="goals-mini-stat gms-clickable" data-gms-filter="archived">
            <div class="gms-val">${archivedGoals.length}</div>
            <div class="gms-label">Archived</div>
          </div>
        </div>`;

      statsRow.querySelectorAll('.gms-clickable').forEach(card => {
        card.addEventListener('click', () => {
          const f = card.dataset.gmsFilter;
          state.goalsFilter = 'all';
          if (f === 'all') {
            state.goalsCollapsed = { overdue: false, open: false, completed: false, archived: false };
          } else {
            state.goalsCollapsed = { overdue: true, open: true, completed: true, archived: true };
            if (f === 'open')      state.goalsCollapsed.open      = false;
            if (f === 'overdue')   state.goalsCollapsed.overdue   = false;
            if (f === 'completed') state.goalsCollapsed.completed = false;
            if (f === 'archived')  state.goalsCollapsed.archived  = false;
          }
          navigateTo('goals');
        });
      });
    }

    const active = state.goals
      .filter(g => g.status === 'active' || (g.status !== 'archived' && g.status !== 'completed'))
      .map(g => ({ ...g, prog: Analytics.goalProgress(g, state.entries), derivedStatus: _goalStatusOf(g) }))
      .filter(g => g.derivedStatus !== 'archived')
      .sort((a, b) => {
        const prio = { high: 0, medium: 1, low: 2 };
        const pDiff = (prio[a.priority] || 1) - (prio[b.priority] || 1);
        if (pDiff !== 0) return pDiff;
        if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate);
        if (a.targetDate) return -1;
        if (b.targetDate) return 1;
        return 0;
      })
      .slice(0, 4);

    if (active.length === 0) {
      container.innerHTML = `
        <div class="empty-state-small">
          <span>🎯</span>
          <p>No active goals. <button type="button" data-page="goals" style="background:none;border:none;color:var(--accent-text);cursor:pointer;font:inherit;padding:0;text-decoration:underline;">Set one now</button></p>
        </div>`;
      container.querySelector('[data-page]')?.addEventListener('click', e => { e.preventDefault(); navigateTo('goals'); });
      return;
    }

    const typeLabel = { time: '⏳ Study Hours', checklist: '📋 Task List', count: '🏆 Problem Count', exam: '🎓 Exam Prep' };
    const prioLabel = { high: 'High', medium: 'Med', low: 'Low' };

    const itemsHtml = active.map(g => {
      const daysLeft  = g.targetDate ? Analytics.daysUntil(g.targetDate) : null;
      const isOverdue = daysLeft !== null && daysLeft < 0;
      const deadline  = daysLeft === null ? '' : isOverdue ? '⚠️ Overdue' : daysLeft === 0 ? '📅 Due today' : `📅 ${daysLeft}d left`;
      const prio      = g.priority || 'medium';
      const progressBar = g.type !== 'exam'
        ? `<div class="goal-widget-bar"><div class="goal-widget-fill" style="width:${Math.min(g.prog.pct, 100)}%"></div></div>`
        : '';
      return `
        <div class="goal-widget-item" data-id="${g.id}" data-type="${g.type}" data-status="${isOverdue ? 'overdue' : 'active'}" role="button" tabindex="0">
          <span class="goal-widget-title">${escapeHtml(g.title)}</span>
          <div class="gwi-meta">
            <span class="gwi-type-tag">${typeLabel[g.type] || g.type}</span>
            ${g.category ? `<span class="gwi-sep">·</span><span class="gwi-cat-tag">${escapeHtml(g.category)}</span>` : ''}
            ${deadline ? `<span class="gwi-sep">·</span><span class="gwi-deadline${isOverdue ? ' overdue' : ''}">${deadline}</span>` : ''}
          </div>
          <div class="gwi-bottom">
            ${progressBar}
            <span class="gwi-prog-label">${g.prog.label}${g.type !== 'exam' ? ` <span class="gwi-pct">(${g.prog.pct}%)</span>` : ''}</span>
          </div>
          <span class="gwi-priority gwi-prio-${prio}">${prioLabel[prio] || prio}</span>
        </div>`;
    }).join('');

    container.innerHTML = `
      <div class="goals-section-hd goals-sec-toggle" id="gwi-toggle-hd">
        <span class="goals-section-icon">📋</span>
        <span class="goals-section-label">Open Goals</span>
        <span class="goals-section-count">${active.length}</span>
        <span class="goals-sec-chevron${state.dashGoalsCollapsed ? ' goals-sec-chevron-up' : ''}"></span>
      </div>
      <div id="gwi-items-wrap" class="goals-section-body${state.dashGoalsCollapsed ? ' goals-sec-collapsed' : ''}">
        ${itemsHtml}
      </div>`;

    container.querySelector('#gwi-toggle-hd').addEventListener('click', () => {
      state.dashGoalsCollapsed = !state.dashGoalsCollapsed;
      const wrap    = container.querySelector('#gwi-items-wrap');
      const chevron = container.querySelector('.goals-sec-chevron');
      wrap.classList.toggle('goals-sec-collapsed', state.dashGoalsCollapsed);
      chevron.classList.toggle('goals-sec-chevron-up', state.dashGoalsCollapsed);
    });

    container.querySelectorAll('.goal-widget-item').forEach(el => {
      el.addEventListener('click', () => {
        state.goalScrollTarget = el.dataset.id || null;
        navigateTo('goals');
      });
    });
  }

  /* ---- Milestone List Modal ------------------------ */

  export function openMilestoneListModal() {
    try {
      const overlay = document.getElementById('milestone-list-overlay');
      if (!overlay) { showToast('Milestone overlay not found', 'error'); return; }

      const streak  = Analytics.calculateStreaks(state.entries);
      const stats   = Analytics.calculateTotalStats(state.entries);
      const all     = Insights.getAllMilestonesWithStatus(state.entries, streak, stats);

      const body   = document.getElementById('milestone-list-body');
      const tabsEl = document.getElementById('milestone-list-tabs');

      function activate(tab) {
        state.milestoneActiveTab = tab;
        tabsEl.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        _renderMilestoneTab(body, all, tab);
      }

      tabsEl.querySelectorAll('[data-tab]').forEach(btn => { btn.onclick = () => activate(btn.dataset.tab); });
      activate(state.milestoneActiveTab || 'all');

      const closeBtn = document.getElementById('milestone-list-close');
      if (closeBtn) closeBtn.onclick = () => closeMilestoneListModal();
      overlay.onclick = e => { if (e.target === overlay) closeMilestoneListModal(); };

      const onKey = e => { if (e.key === 'Escape') { closeMilestoneListModal(); document.removeEventListener('keydown', onKey); } };
      document.addEventListener('keydown', onKey);

      overlay.style.display = 'flex';
      _openModal(overlay);

      if (state.milestoneModalFlashName) {
        const flashName = state.milestoneModalFlashName;
        state.milestoneModalFlashName = null;
        requestAnimationFrame(() => {
          for (const row of overlay.querySelectorAll('[data-name]')) {
            if (row.dataset.name === flashName) {
              row.scrollIntoView({ behavior: 'smooth', block: 'center' });
              row.classList.add('topics-modal-item--flash');
              row.addEventListener('animationend', () => row.classList.remove('topics-modal-item--flash'), { once: true });
              break;
            }
          }
        });
      }

      if (closeBtn) setTimeout(() => closeBtn.focus(), 0);
    } catch (err) {
      showToast(`Milestone modal error: ${err.message}`, 'error');
      console.error('[Milestone modal]', err);
    }
  }

  function closeMilestoneListModal() {
    const overlay = document.getElementById('milestone-list-overlay');
    _closeModal(overlay);
    overlay.style.display = 'none';
  }

  function _renderMilestoneTab(container, all, tab) {
    const items      = tab === 'all' ? all : all.filter(m => m.metric === tab);
    const globalNext = all.filter(m => m.isNext);   // always from ALL, survives tab switches
    const done       = items.filter(m => m.achieved);

    const UNIT   = { entries: 'entries', hours: 'hrs', streak: 'days' };
    const fmtCur = m => m.metric === 'hours' ? m.current.toFixed(1) : m.current;

    const rowHtml = (m, cls) => {
      const detail = `${fmtCur(m)} / ${m.target} ${UNIT[m.metric]}`;
      return `
        <div class="ml-row ${cls} ml-row-clickable" role="button" tabindex="0"
             data-metric="${m.metric}" data-target="${m.target}" data-name="${escapeHtml(m.name)}">
          <span class="ml-icon">${m.icon}</span>
          <div class="ml-info">
            <span class="ml-name">${escapeHtml(m.name)}</span>
            ${!m.achieved
              ? `<div class="ml-bar"><div class="ml-bar-fill" style="width:${m.pct}%"></div></div>
                 <span class="ml-progress-detail">${detail}</span>`
              : ''}
          </div>
          <span class="ml-badge">${m.achieved ? '✓' : `${m.pct}%`}</span>
        </div>`;
    };

    // Up Next — pinned panel above the scrollable body
    const upnextPanel = document.getElementById('milestone-list-upnext');
    if (upnextPanel) {
      upnextPanel.innerHTML = globalNext.length
        ? `<div class="ml-group-header">Up Next</div>${globalNext.map(m => rowHtml(m, 'ml-next')).join('')}`
        : '';
    }

    // Achieved — scrollable body
    container.innerHTML = done.length
      ? `<div class="ml-group-header">Milestones — ${done.length} achieved</div>${done.map(m => rowHtml(m, 'ml-done')).join('')}`
      : '<p class="ml-empty">No milestones achieved yet in this category.</p>';

    // Wire up click handlers on both panels
    [container, upnextPanel].forEach(root => {
      if (!root) return;
      root.querySelectorAll('.ml-row-clickable').forEach(row => {
        const open = () => {
          state.logMilestoneContext = {
            metric: row.dataset.metric,
            target: Number(row.dataset.target),
            name:   row.dataset.name,
          };
          state.logForceExpand = true;
          closeMilestoneListModal();
          navigateTo('log');
        };
        row.addEventListener('click', open);
        row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      });
    });
  }

  /* ---- Top Topics Modal ---------------------------- */

  export function setupTopTopicsModal() {
    document.getElementById('top-topics-close')?.addEventListener('click', closeTopTopicsModal);
    document.getElementById('top-topics-close-btn')?.addEventListener('click', closeTopTopicsModal);
    const overlay = document.getElementById('top-topics-overlay');
    if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) closeTopTopicsModal(); });

    const row = document.getElementById('insights-row');
    if (row) {
      row.addEventListener('click', e => {
        if (e.target.closest('[data-insight-action="top-topics"]')) openTopTopicsModal();
      });
      row.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-insight-action="top-topics"]')) {
          e.preventDefault(); openTopTopicsModal();
        }
      });
    }
  }

  export function openTopTopicsModal() {
    const overlay = document.getElementById('top-topics-overlay');
    const body    = document.getElementById('top-topics-body');
    if (!overlay || !body) return;

    const topicMins = {};
    for (const e of state.entries) {
      const t = (e.topic || '').trim() || 'Untitled';
      topicMins[t] = (topicMins[t] || 0) + (e.durationMinutes || 0);
    }
    const sorted    = Object.entries(topicMins).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const totalMins = sorted.reduce((s, [, m]) => s + m, 0);
    const maxMins   = sorted[0]?.[1] || 1;

    if (!sorted.length) {
      body.innerHTML = '<p class="topics-modal-empty">No topics logged yet.</p>';
    } else {
      const rows = sorted.map(([topic, mins], i) => {
        const barPct   = Math.round((mins / maxMins) * 100);
        const rawPct   = totalMins > 0 ? (mins / totalMins) * 100 : 0;
        const pct      = rawPct > 0 && rawPct < 1 ? '<1%' : `${Math.round(rawPct)}%`;
        const color    = getCategoryColor(topic);
        const rankLabel = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1;
        return `<li class="topics-modal-item topics-modal-item--clickable" data-topic="${escapeHtml(topic)}" role="button" tabindex="0" title="View log entries for ${escapeHtml(topic)}">
          <span class="topics-modal-rank" style="background:${color}22;color:${color}">${rankLabel}</span>
          <span class="topics-modal-name">${escapeHtml(topic)}</span>
          <span class="topics-modal-bar-wrap">
            <span class="topics-modal-bar" style="width:${barPct}%;background:${color}"></span>
          </span>
          <span class="topics-modal-pct">${pct}</span>
          <span class="topics-modal-time">${escapeHtml(Analytics.formatDuration(mins))}</span>
        </li>`;
      }).join('');

      body.innerHTML = `
        <div class="topics-modal-header-row">
          <span class="topics-modal-col-rank">#</span>
          <span class="topics-modal-col-name">Topic</span>
          <span class="topics-modal-col-bar"></span>
          <span class="topics-modal-col-pct">Share</span>
          <span class="topics-modal-col-time">Time</span>
        </div>
        <ul class="topics-modal-list">${rows}</ul>
        <div class="topics-modal-footer">
          <span>${sorted.length} topic${sorted.length !== 1 ? 's' : ''}</span>
          <span>${escapeHtml(Analytics.formatDuration(totalMins))} total</span>
        </div>`;
    }

    overlay.style.display = 'flex';
    _openModal(overlay);
    const onKey = e => { if (e.key === 'Escape') { closeTopTopicsModal(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);

    if (!body.dataset.clickWired) {
      body.dataset.clickWired = '1';
      body.addEventListener('click', e => {
        const item = e.target.closest('[data-topic]');
        if (!item) return;
        const topic = item.dataset.topic;
        state.logStatContext = { label: topic, topic, source: 'topics-modal' };
        state.logForceExpand = true;
        closeTopTopicsModal();
        navigateTo('log');
      });
      body.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-topic]')) {
          e.preventDefault();
          e.target.closest('[data-topic]').click();
        }
      });
    }

    if (state.topicsModalFlashTopic) {
      const flashTopic = state.topicsModalFlashTopic;
      state.topicsModalFlashTopic = null;
      requestAnimationFrame(() => {
        for (const item of body.querySelectorAll('[data-topic]')) {
          if (item.dataset.topic === flashTopic) {
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
            item.classList.add('topics-modal-item--flash');
            item.addEventListener('animationend', () => item.classList.remove('topics-modal-item--flash'), { once: true });
            break;
          }
        }
      });
    }

    requestAnimationFrame(() => body.focus());
  }

  function closeTopTopicsModal() {
    const overlay = document.getElementById('top-topics-overlay');
    if (!overlay) return;
    _closeModal(overlay);
    overlay.style.display = 'none';
  }

  /* ---- Subjects Explored Modal --------------------- */

  export function setupTopicsModal() {
    const close = closeTopicsModal;
    document.getElementById('topics-modal-close')?.addEventListener('click', close);
    document.getElementById('topics-modal-close-btn')?.addEventListener('click', close);
    const modal = document.getElementById('topics-modal');
    if (modal) modal.addEventListener('click', ev => { if (ev.target === modal) close(); });

    const row = document.getElementById('insights-row');
    if (row) {
      row.addEventListener('click', e => {
        if (e.target.closest('[data-insight-action="topics"]')) showTopicsModal();
      });
      row.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-insight-action="topics"]')) {
          e.preventDefault();
          showTopicsModal();
        }
      });
    }
  }

  export function showTopicsModal() {
    const modal = document.getElementById('topics-modal');
    const body  = document.getElementById('topics-modal-body');
    const title = document.getElementById('topics-modal-title');
    if (!modal || !body) return;

    const dist = Analytics.calculateTopicDistribution(state.entries);
    if (title) title.textContent = `Subjects Explored`;

    if (!dist.length) {
      body.innerHTML = '<p class="topics-modal-empty">No topics logged yet.</p>';
      modal.style.display = 'flex';
      return;
    }

    const totalMins = dist.reduce((s, t) => s + t.minutes, 0);
    const maxMins   = dist[0].minutes;

    const rows = dist.map((t, i) => {
      const barPct  = Math.round((t.minutes / maxMins) * 100);
      const rawPct  = totalMins > 0 ? (t.minutes / totalMins) * 100 : 0;
      const pct     = rawPct > 0 && rawPct < 1 ? '<1%' : `${Math.round(rawPct)}%`;
      const color     = getCategoryColor(t.label);
      const rankLabel = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1;
      return `<li class="topics-modal-item topics-modal-item--clickable" data-category="${escapeHtml(t.label)}" role="button" tabindex="0" title="View log entries for ${escapeHtml(t.label)}">
        <span class="topics-modal-rank" style="background:${color}22;color:${color}">${rankLabel}</span>
        <span class="topics-modal-name">${escapeHtml(t.label)}</span>
        <span class="topics-modal-bar-wrap">
          <span class="topics-modal-bar" style="width:${barPct}%;background:${color}"></span>
        </span>
        <span class="topics-modal-pct">${pct}</span>
        <span class="topics-modal-time">${escapeHtml(Analytics.formatDuration(t.minutes))}</span>
      </li>`;
    }).join('');

    body.innerHTML = `
      <div class="topics-modal-header-row">
        <span class="topics-modal-col-rank">#</span>
        <span class="topics-modal-col-name">Subject</span>
        <span class="topics-modal-col-bar"></span>
        <span class="topics-modal-col-pct">Share</span>
        <span class="topics-modal-col-time">Time</span>
      </div>
      <ul class="topics-modal-list">${rows}</ul>
      <div class="topics-modal-footer">
        <span>${dist.length} subject${dist.length !== 1 ? 's' : ''}</span>
        <span>${escapeHtml(Analytics.formatDuration(totalMins))} total</span>
      </div>`;

    modal.style.display = 'flex';
    _openModal(modal);
    document.body.style.overflow = 'hidden';

    if (!body.dataset.clickWired) {
      body.dataset.clickWired = '1';
      body.addEventListener('click', e => {
        const item = e.target.closest('[data-category]');
        if (!item) return;
        const category = item.dataset.category;
        state.logStatContext = { label: category, category, source: 'subjects-modal' };
        state.logForceExpand = true;
        closeTopicsModal();
        navigateTo('log');
      });
      body.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-category]')) {
          e.preventDefault();
          e.target.closest('[data-category]').click();
        }
      });
    }

    if (state.subjectsModalFlashCategory) {
      const flashCat = state.subjectsModalFlashCategory;
      state.subjectsModalFlashCategory = null;
      requestAnimationFrame(() => {
        for (const item of body.querySelectorAll('[data-category]')) {
          if (item.dataset.category === flashCat) {
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
            item.classList.add('topics-modal-item--flash');
            item.addEventListener('animationend', () => item.classList.remove('topics-modal-item--flash'), { once: true });
            break;
          }
        }
      });
    }

    requestAnimationFrame(() => body.focus());
  }

  export function closeTopicsModal() {
    const modal = document.getElementById('topics-modal');
    if (!modal) return;
    _closeModal(modal);
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }

  /* ---- Best Day to Learn Modal --------------------- */

  export function setupWeekdayModal() {
    const close = closeWeekdayModal;
    document.getElementById('weekday-modal-close')?.addEventListener('click', close);
    document.getElementById('weekday-modal-close-btn')?.addEventListener('click', close);
    const modal = document.getElementById('weekday-modal');
    if (modal) modal.addEventListener('click', ev => { if (ev.target === modal) close(); });

    const row = document.getElementById('insights-row');
    if (row) {
      row.addEventListener('click', e => {
        if (e.target.closest('[data-insight-action="best-day"]')) showWeekdayModal();
      });
      row.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-insight-action="best-day"]')) {
          e.preventDefault();
          showWeekdayModal();
        }
      });
    }
  }

  export function showWeekdayModal() {
    const modal = document.getElementById('weekday-modal');
    const body  = document.getElementById('weekday-modal-body');
    if (!modal || !body) return;

    const data          = Analytics.weekdayBreakdown(state.entries);
    const totalSessions = data.reduce((s, d) => s + d.count, 0);

    if (!totalSessions) {
      body.innerHTML = '<p class="topics-modal-empty">No entries logged yet.</p>';
      modal.style.display = 'flex';
      _openModal(modal);
      return;
    }

    const maxAvg = data.find(d => d.avg > 0)?.avg || 1;
    let ranked = 0;
    const rows = data.map((d, i) => {
      const hasData  = d.count > 0;
      const barPct   = hasData ? Math.round((d.avg / maxAvg) * 100) : 0;
      ranked++;
      const rankLabel = !hasData ? '—' : ranked === 1 ? '🥇' : ranked === 2 ? '🥈' : ranked === 3 ? '🥉' : ranked;
      const avgLabel  = hasData ? escapeHtml(Analytics.formatDuration(d.avg)) : '—';
      const clickable = hasData ? `data-day-index="${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(d.day)}" data-day-name="${escapeHtml(d.day)}" role="button" tabindex="0" style="cursor:pointer"` : '';
      return `<li class="topics-modal-item weekday-modal-grid" ${clickable}>
        <span class="topics-modal-rank" style="${hasData ? '' : 'opacity:0.35'}">${rankLabel}</span>
        <span class="topics-modal-name" style="${hasData ? '' : 'opacity:0.4'}">${escapeHtml(d.day)}</span>
        <span class="topics-modal-bar-wrap">
          <span class="topics-modal-bar" style="width:${barPct}%;background:var(--accent)"></span>
        </span>
        <span class="topics-modal-pct">${avgLabel}</span>
        <span class="topics-modal-time">${d.count}</span>
      </li>`;
    }).join('');

    body.innerHTML = `
      <div class="topics-modal-header-row weekday-modal-grid">
        <span class="topics-modal-col-rank">#</span>
        <span class="topics-modal-col-name">Day</span>
        <span class="topics-modal-col-bar"></span>
        <span class="topics-modal-col-pct">Avg</span>
        <span class="topics-modal-col-time">Logs</span>
      </div>
      <ul class="topics-modal-list">${rows}</ul>
      <div class="topics-modal-footer" style="justify-content:flex-end;padding-top:0;padding-bottom:0">
        <span>${totalSessions} session${totalSessions !== 1 ? 's' : ''} total</span>
      </div>`;

    body.querySelector('.topics-modal-list')?.addEventListener('click', e => {
      const item = e.target.closest('[data-day-index]');
      if (!item) return;
      state.logWeekdayFilter = { day: item.dataset.dayName, index: parseInt(item.dataset.dayIndex, 10) };
      state.logForceExpand   = true;
      closeWeekdayModal();
      navigateTo('log');
    });
    body.querySelector('.topics-modal-list')?.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-day-index]')) {
        e.preventDefault();
        e.target.closest('[data-day-index]').click();
      }
    });

    modal.style.display = 'flex';
    _openModal(modal);
    document.body.style.overflow = 'hidden';
    const onKey = e => { if (e.key === 'Escape') { closeWeekdayModal(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);

    if (state.weekdayModalFlashDay) {
      const flashDay = state.weekdayModalFlashDay;
      state.weekdayModalFlashDay = null;
      requestAnimationFrame(() => {
        const list = body.querySelector('.topics-modal-list');
        if (!list) return;
        for (const item of list.querySelectorAll('[data-day-name]')) {
          if (item.dataset.dayName === flashDay) {
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
            item.classList.add('topics-modal-item--flash');
            item.addEventListener('animationend', () => item.classList.remove('topics-modal-item--flash'), { once: true });
            break;
          }
        }
      });
    }

    requestAnimationFrame(() => body.focus());
  }

  export function closeWeekdayModal() {
    const modal = document.getElementById('weekday-modal');
    if (!modal) return;
    _closeModal(modal);
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
