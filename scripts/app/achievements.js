/* ===== achievements.js — extracted from app.js ===== */
import { state } from './state.js';
import { renderMedals } from './dashboard.js';
import { navigateTo } from './nav.js';
import { _closeModal, _openModal, animateCounter, escapeHtml, setEl } from './utils.js';

  /* ---- ACHIEVEMENTS PAGE --------------------------- */

  export async function renderAchievements() {
    // Back-to-dashboard breadcrumb when arriving from the XP stat card
    const breadcrumb = document.getElementById('achievements-back-breadcrumb');
    if (breadcrumb) {
      if (state.achievementsReturnTo === 'dashboard') {
        breadcrumb.innerHTML = `
          <button type="button" class="log-goal-back-chip" id="achievements-back-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back to Dashboard
          </button>`;
        const goBack = () => { state.achievementsReturnTo = null; breadcrumb.innerHTML = ''; state.dashboardScrollToCardId = 'stat-level-card'; navigateTo('dashboard'); };
        document.getElementById('achievements-back-btn')?.addEventListener('click', goBack);
        const onEsc = e => { if (e.key === 'Escape') { document.removeEventListener('keydown', onEsc); goBack(); } };
        document.addEventListener('keydown', onEsc);
        // Open the level progression section and scroll the "YOU" row into view
        requestAnimationFrame(() => {
          const details = document.querySelector('.rewards-guide');
          if (details) details.open = true;
          const currentRow = document.querySelector('.current-level-row');
          if (currentRow) currentRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      } else {
        breadcrumb.innerHTML = '';
      }
    }

    const streak      = Analytics.calculateStreaks(state.entries);
    const stats       = Analytics.calculateTotalStats(state.entries);
    const consistency = Analytics.calculateConsistency(state.entries);
    const totalXP     = Rewards.calculateTotalXP(state.entries, streak, state.prefs.dailyGoalMin, state.prefs.goalHistory, state.earnedAch);
    const lvInfo      = Rewards.getLevelInfo(totalXP);

    // Medals
    renderMedals();

    // Level progression guide — built from Rewards.LEVELS so it's always in sync
    const levelsEl = document.getElementById('rewards-guide-levels');
    if (levelsEl) {
      levelsEl.innerHTML = Rewards.LEVELS.map((lv, i) => {
        const isLast    = i === Rewards.LEVELS.length - 1;
        const isCurrent = lv.level === lvInfo.level;
        const xpStr     = lv.xpNeeded.toLocaleString();
        const rowClass  = isCurrent ? 'current-level-row' : (isLast ? 'highlight-row' : '');
        return `<div class="rewards-guide-row${rowClass ? ' ' + rowClass : ''}">
          <span>Lv ${lv.level} · ${lv.title}${isCurrent ? ' <span class="level-you-pill">YOU</span>' : ''}</span>
          <span class="rgv${isLast && !isCurrent ? ' accent' : ''}">${xpStr} XP</span>
        </div>`;
      }).join('');
    }

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
    const allAch = await Rewards.buildAchievementList(state.entries, streak, stats, consistency, state.prefs.dailyGoalMin, state.prefs.goalHistory, state.goals);
    const earnedCount = allAch.filter(a => a.earned).length;
    animateCounter('badges-earned-count', earnedCount);

    const filtered = allAch.filter(a => {
      if (state.achievementFilterMode === 'earned') return a.earned;
      if (state.achievementFilterMode === 'locked') return !a.earned;
      return true;
    });

    renderAchievementsGrid(filtered);

    // Filter pills
    document.querySelectorAll('.filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.achievementFilterMode = btn.dataset.filter;
        renderAchievements();
      });
    });
  }

  export function renderAchievementsGrid(achievements) {
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

  /* ---- Achievement Checks -------------------------- */

  export async function checkAchievements() {
    const streak      = Analytics.calculateStreaks(state.entries);
    const stats       = Analytics.calculateTotalStats(state.entries);
    const consistency = Analytics.calculateConsistency(state.entries);

    // Revoke achievements that no longer qualify (e.g. after editing/deleting past entries)
    await Rewards.revokeStaleAchievements(state.entries, streak, stats, consistency, state.prefs.dailyGoalMin, state.prefs.goalHistory, state.goals);

    // Award any newly qualifying achievements
    const newlyEarned = await Rewards.checkAndAwardAchievements(state.entries, streak, stats, consistency, state.prefs.dailyGoalMin, state.prefs.goalHistory, state.goals);
    state.earnedAch = await Storage.getAllAchievements();

    for (const ach of newlyEarned) {
      state.badgeQueue.push(ach);
    }

    if (!state.badgeShowing && state.badgeQueue.length > 0) {
      showNextBadge();
    }

    // Mark achievements nav badge
    const navBadge = document.getElementById('nav-badge-achievements');
    if (navBadge && newlyEarned.length > 0) {
      navBadge.style.display = 'inline';
    }
  }

  export function showNextBadge() {
    const ach = state.badgeQueue.shift();
    if (!ach) { state.badgeShowing = false; return; }

    state.badgeShowing = true;
    const modal = document.getElementById('badge-modal');
    if (!modal) { state.badgeShowing = false; return; }

    setEl('badge-modal-icon', ach.icon);
    setEl('badge-modal-name', ach.name);
    setEl('badge-modal-desc', ach.desc);
    setEl('badge-modal-xp',   `+${ach.xp} XP`);
    modal.style.display = 'flex';
    _openModal(modal);

    Rewards.fireConfetti('achievement');

    const closeBtn = document.getElementById('badge-modal-close');
    closeBtn.onclick = () => closeBadgeModal();
    setTimeout(() => closeBtn.focus(), 0);
  }

  export function closeBadgeModal() {
    const modal = document.getElementById('badge-modal');
    _closeModal(modal, true);
    modal.style.display = 'none';
    state.badgeShowing = false;
    if (state.badgeQueue.length > 0) {
      setTimeout(showNextBadge, 400);
    }
  }
