/* ===== dashboard.js — extracted from app.js ===== */
import { state, DEFAULT_PREFS } from './state.js';
import { _goalStatusOf } from './goals.js';
import { openEntryModal } from './log.js';
import { navigateTo } from './nav.js';
import { UserManager } from './users.js';
import { animateCounter, escapeHtml, formatDateRange, formatRelativeDate, setEl } from './utils.js';

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

    // Next milestone — sourced from Rewards.ACHIEVEMENTS
    const earnedIds = new Set(state.earnedAch.map(a => a.id));
    const _goalHistory = state.prefs.goalHistory || [];
    const _fallbackGoal = state.prefs.dailyGoalMin || 60;
    const milGoalForDate = date => {
      let best = null;
      for (const g of _goalHistory) {
        if (g.from <= date && (!best || g.from > best.from)) best = g;
      }
      return best ? best.goalMin : _fallbackGoal;
    };
    const milestone = Insights.getNextMilestone(state.entries, streak, stats, earnedIds, consistency, milGoalForDate, state.goals);
    setEl('milestone-icon', milestone.icon);
    setEl('milestone-name', milestone.name);
    const milPct = milestone.allDone ? 100 : Math.round((milestone.current / milestone.max) * 100);
    const milBar = document.getElementById('milestone-bar');
    if (milBar) milBar.style.width = `${milPct}%`;
    setEl('milestone-meta', milestone.allDone ? 'All achievements unlocked!' : `${milestone.current} / ${milestone.max} (${milPct}%)`);

    // Wire milestone card click → achievements page (once per page lifecycle)
    const milCard = document.getElementById('milestone-card');
    if (milCard && !milCard.dataset.wired) {
      milCard.dataset.wired = '1';
      milCard.addEventListener('click', () => navigateTo('achievements'));
      milCard.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateTo('achievements'); }
      });
    }

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
      }

      // Fire confetti whenever pct crosses the 100% threshold.
      // prevPct === -1 means first render on this page load: delay 1300ms to clear the loading
      // overlay (overlay fades at 600ms after navigateTo, takes 400ms → gone by ~1000ms).
      // For a live transition (entry just logged), fire quickly so the ring animation settles first.
      const prevPct = state.goalLastPct;
      state.goalLastPct = pct;
      if (pct >= 100 && prevPct < 100) {
        setTimeout(_fireConfetti, prevPct < 0 ? 1300 : 300);
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
             title="${d.label}: ${Analytics.formatDuration(d.minutes)} / ${Analytics.formatDuration(dayGoal)} (${dayPct}%)">
          <div class="goal-day-label">${d.label}</div>
          <div class="goal-day-circle">${inner}</div>
        </div>`;
    }).join('');
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
    Charts.renderDailyTimeChart('daily-time-chart',
      Analytics.calculateDailyTimeSeries(_scopedEntries(state.dailyRange), Math.min(days, 90)));
  }

  export function renderDashboardMonthlyChart() {
    Charts.renderMonthlyChart('monthly-progress-chart',
      Analytics.calculateMonthlyTotals(state.entries, parseInt(state.monthlyRange, 10)));
  }

  export function renderDashboardCategoryChart() {
    Charts.renderTopicChart('topic-distribution-chart',
      Analytics.calculateTopicDistribution(_scopedEntries(state.categoryRange), state.prefs.categories || DEFAULT_PREFS.categories));
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
      Charts.renderHeatmap('heatmap-container', Analytics.calculateHeatmapData(state.entries));
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
