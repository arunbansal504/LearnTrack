/* ===== reports.js — extracted from app.js ===== */
import { state } from './state.js';
import { _dailyGoalMinFor, _monthGoalHrFor } from './dashboard.js';
import { _goalStatusOf } from './goals.js';
import { ensureCategoryColors, getCategoryColor } from './settings.js';
import { capitalise, safeHref, showToast } from './utils.js';

  /* ---- REPORTS PAGE -------------------------------- */

  export function renderReports() {
    populateReportMonthSelect();

    const dlBtn = document.getElementById('download-report-btn');
    if (dlBtn && !dlBtn._bound) {
      dlBtn._bound = true;
      dlBtn.addEventListener('click', generateMonthlyReport);
    }

    const sel = document.getElementById('report-month');
    if (sel && !sel._bound) {
      sel._bound = true;
      sel.addEventListener('change', renderReportPreview);
    }

    ['report-inc-notes', 'report-inc-resources'].forEach(id => {
      const cb = document.getElementById(id);
      if (cb && !cb._bound) {
        cb._bound = true;
        cb.addEventListener('change', renderReportPreview);
      }
    });

    renderReportPreview();
  }

  /* ---- Monthly In-Page Report Preview -------------- */

  export function renderReportPreview() {
    const sel = document.getElementById('report-month');
    if (!sel) return;

    const container = document.getElementById('report-preview');

    if (!sel.value || sel.value === '') {
      if (container) {
        container.innerHTML = `
          <div style="padding:48px 24px;text-align:center;">
            <div style="font-size:40px;margin-bottom:12px;">📭</div>
            <div style="font-size:16px;font-weight:600;color:var(--text-1);margin-bottom:6px;">No learning entries yet</div>
            <div style="font-size:13px;color:var(--text-3);">Start logging sessions and your monthly report will appear here.</div>
          </div>`;
        container.classList.remove('hidden');
      }
      return;
    }

    const [year, month0] = sel.value.split('-').map(Number);
    const month = month0 - 1;

    const MONTHS    = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
    const monthStr  = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthEntries = state.entries
      .filter(e => e.date.startsWith(monthStr))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (monthEntries.length === 0) {
      if (container) {
        container.innerHTML = `
          <div style="padding:48px 24px;text-align:center;">
            <div style="font-size:40px;margin-bottom:12px;">📭</div>
            <div style="font-size:16px;font-weight:600;color:var(--text-1);margin-bottom:6px;">No entries for ${MONTHS[month]} ${year}</div>
            <div style="font-size:13px;color:var(--text-3);">There are no learning sessions recorded for this month.</div>
          </div>`;
        container.classList.remove('hidden');
      }
      return;
    }

    const incNotes     = document.getElementById('report-inc-notes')?.checked ?? true;
    const incResources = document.getElementById('report-inc-resources')?.checked ?? true;

    const fmt = m => Analytics.formatDuration(m);
    const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const CAT_PALETTE = {
      'Programming':   { bg:'#BFDBFE', color:'#1E40AF', bar:'#2563EB' },
      'Mathematics':   { bg:'#DDD6FE', color:'#5B21B6', bar:'#7C3AED' },
      'Languages':     { bg:'#A7F3D0', color:'#065F46', bar:'#059669' },
      'Science':       { bg:'#A5F3FC', color:'#155E75', bar:'#0891B2' },
      'Design':        { bg:'#FBCFE8', color:'#9D174D', bar:'#DB2777' },
      'Business':      { bg:'#FDE68A', color:'#92400E', bar:'#D97706' },
      'Other':         { bg:'#E5E7EB', color:'#374151', bar:'#4B5563' },
      'Uncategorized': { bg:'#F3F4F6', color:'#6B7280', bar:'#4B5563' },
    };
    // Extended pool for auto-assigned custom categories — hashed by name so colour is always consistent
    const CAT_COLOR_POOL = [
      { bg:'#FED7AA', color:'#9A3412', bar:'#C2410C' },
      { bg:'#A7F3D0', color:'#065F46', bar:'#047857' },
      { bg:'#F5D0FE', color:'#7E22CE', bar:'#86198F' },
      { bg:'#FECDD3', color:'#9F1239', bar:'#E11D48' },
      { bg:'#BBF7D0', color:'#14532D', bar:'#15803D' },
      { bg:'#BFDBFE', color:'#1E3A8A', bar:'#1D4ED8' },
      { bg:'#FEF3C7', color:'#92400E', bar:'#B45309' },
      { bg:'#BAE6FD', color:'#0C4A6E', bar:'#0369A1' },
      { bg:'#FBCFE8', color:'#831843', bar:'#BE185D' },
      { bg:'#D9F99D', color:'#3F6212', bar:'#4D7C0F' },
      { bg:'#FEF9C3', color:'#713F12', bar:'#A16207' },
      { bg:'#EDE9FE', color:'#4C1D95', bar:'#6D28D9' },
    ];
    const _catHash = s => Math.abs([...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0));
    const getCat = cat => CAT_PALETTE[cat] || CAT_COLOR_POOL[_catHash(cat) % CAT_COLOR_POOL.length];

    // ── Stats ──
    const totalMin      = monthEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
    const totalSessions = monthEntries.length;
    const activeDaySet  = new Set(monthEntries.map(e => e.date));
    const activeDays    = activeDaySet.size;
    const dailyGoalMin  = _dailyGoalMinFor(monthStr);
    const monthlyGoalHr = _monthGoalHrFor(monthStr);
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

    // ── Daily bars ──
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const DAY_NAMES_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dailyBars = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const ds   = `${monthStr}-${String(d).padStart(2, '0')}`;
      const mins = daysWithGoal.get(ds) || 0;
      dailyBars.push({ d, ds, mins, has: activeDaySet.has(ds), met: mins >= dailyGoalMin, dow: new Date(ds + 'T12:00:00').getDay() });
    }
    const daysWithEntries = dailyBars.filter(b => b.has);
    const maxDayMin = Math.max(...daysWithEntries.map(b => b.mins), 1);

    // ── Weekly data ──
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
    const topicDiffWt   = {};  // sum of (minutes × difficultyRank) for weighted-avg tiebreak
    const topicMoodWt   = {};  // sum of (minutes × moodScore) for weighted-avg tiebreak
    const _DIFF_RANK    = { easy: 1, medium: 2, hard: 3 };
    monthEntries.forEach(e => {
      if (!e.topic) return;
      const mins = e.durationMinutes || 0;
      topicMap[e.topic]      = (topicMap[e.topic]      || 0) + mins;
      topicSessions[e.topic] = (topicSessions[e.topic] || 0) + 1;
      topicDiffWt[e.topic]   = (topicDiffWt[e.topic]   || 0) + mins * (_DIFF_RANK[e.difficulty] ?? 2);
      topicMoodWt[e.topic]   = (topicMoodWt[e.topic]   || 0) + mins * (e.moodScore || 3);
      if (e.category && !topicCat[e.topic]) topicCat[e.topic] = e.category;
    });
    const topTopics = Object.entries(topicMap)
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        const avgDiffA = topicDiffWt[a[0]] / a[1];
        const avgDiffB = topicDiffWt[b[0]] / b[1];
        if (avgDiffB !== avgDiffA) return avgDiffB - avgDiffA;
        return (topicMoodWt[b[0]] / b[1]) - (topicMoodWt[a[0]] / a[1]);
      })
      .slice(0, 10);
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

    // ── Academic Goals (month-scoped) ──
    const todayStrRP  = Analytics.today();
    const _rpStatus   = g => {
      if (g.status === 'completed') return 'completed';
      if (g.targetDate && g.targetDate < todayStrRP) return 'overdue';
      return 'active';
    };
    const rpGoals = state.goals.filter(g => {
      if (g.status === 'archived') return false;
      const startedThisMonth   = g.startDate && g.startDate.startsWith(monthStr);
      const completedThisMonth = g.completedAt && (() => {
        const d = new Date(g.completedAt);
        return d.getFullYear() === year && d.getMonth() === month;
      })();
      return startedThisMonth || completedThisMonth;
    });
    const rpCntOverdue = rpGoals.filter(g => _rpStatus(g) === 'overdue').length;
    const rpCntDone    = rpGoals.filter(g => _rpStatus(g) === 'completed').length;
    const rpCntOpen    = rpGoals.length - rpCntOverdue - rpCntDone;

    const academicGoalsHtml = rpGoals.length === 0 ? '' : `
      <div class="rp-section">
        <div class="rp-section-title">Academic Goals</div>
        <div class="rp-ag-chips">
          <div class="rp-ag-chip"><div class="rp-ag-chip-count" style="color:var(--accent)">${rpCntOpen}</div><div class="rp-ag-chip-label">Open</div></div>
          <div class="rp-ag-chip"><div class="rp-ag-chip-count" style="color:#ef4444">${rpCntOverdue}</div><div class="rp-ag-chip-label">Overdue</div></div>
          <div class="rp-ag-chip"><div class="rp-ag-chip-count" style="color:#10b981">${rpCntDone}</div><div class="rp-ag-chip-label">Completed</div></div>
        </div>
        <table class="rp-table rp-ag-table">
          <thead><tr><th>Goal</th><th>Type</th><th>Status</th><th>Due</th><th>Progress</th></tr></thead>
          <tbody>
            ${[...rpGoals].sort((a, b) => {
              const o = { overdue: 0, active: 1, completed: 2 };
              return (o[_rpStatus(a)] ?? 1) - (o[_rpStatus(b)] ?? 1);
            }).map(g => {
              const st    = _rpStatus(g);
              const prog  = g.status === 'completed' && g.progressSnapshot
                ? g.progressSnapshot : Analytics.goalProgress(g, state.entries);
              const pct   = prog?.pct ?? 0;
              const stLbl = st === 'completed' ? '✓ Done' : st === 'overdue' ? 'Overdue' : 'Open';
              const stClr = st === 'completed' ? '#10b981' : st === 'overdue' ? '#ef4444' : 'var(--accent)';
              const _TYPE_PAL = {
                time:      { bg:'#BFDBFE', color:'#1E40AF', label:'⏳ Study Hours' },
                count:     { bg:'#DDD6FE', color:'#5B21B6', label:'🏆 Problem Count' },
                checklist: { bg:'#A7F3D0', color:'#065F46', label:'📋 Task List' },
                exam:      { bg:'#FECDD3', color:'#9F1239', label:'🎓 Exam Prep' },
              };
              const typePal = _TYPE_PAL[g.type] || _TYPE_PAL.exam;
              const typeT   = typePal.label;
              const dueT  = g.targetDate
                ? new Date(g.targetDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : '—';
              return `<tr>
                <td class="rp-tc-topic">${esc(g.title || '—')}</td>
                <td><span class="rp-badge" style="background:${typePal.bg};color:${typePal.color}">${typeT}</span></td>
                <td style="font-weight:${st !== 'active' ? '600' : '400'};color:${stClr}">${stLbl}</td>
                <td class="rp-tc-date">${dueT}</td>
                <td><div class="rp-ag-prog-wrap"><div class="rp-bar-wrap rp-ag-bar"><div class="rp-bar-fill" style="width:${pct}%;background:${st === 'completed' ? '#10b981' : 'var(--accent)'}"></div></div><span class="rp-ag-pct">${pct}%</span></div></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;

    const reportTitle = `${MONTHS[month]} ${year} — Learning Report`;
    const generatedOn = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const username    = state.prefs.username || 'Learner';

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

    // ── Daily chart HTML ──
    const dailyChartHtml = daysWithEntries.length === 0 ? '' : `
      <div class="rp-daily-chart">
        <div class="rp-daily-bars">
          ${daysWithEntries.map(({ d, mins, met, dow }) => {
            const heightPct = Math.max(6, Math.round((mins / maxDayMin) * 100));
            const dayLabel  = `${DAY_NAMES_SHORT[dow]} ${d}`;
            return `<div class="rp-daily-bar-col" title="${dayLabel} · ${fmt(mins)}">
              <div class="rp-daily-bar-outer">
                <div class="rp-daily-bar-inner${met ? ' met' : ''}" style="height:${heightPct}%"></div>
              </div>
              <div class="rp-daily-bar-day">${d}</div>
            </div>`;
          }).join('')}
        </div>
        <div class="rp-daily-legend">
          <span class="rp-daily-legend-dot met"></span><span>Goal met</span>
          <span class="rp-daily-legend-dot"></span><span>Active</span>
        </div>
      </div>`;

    // ── Weekly progress HTML ──
    const weeklyHtml = `
      <div class="rp-weekly-list">
        ${weeklyData.map(({ wk, start, end, wMins, wActive }) => {
          const pct = Math.round((wMins / maxWeekMin) * 100);
          return `<div class="rp-weekly-row">
            <div class="rp-wk-info">
              <span class="rp-wk-num">Wk ${wk}</span>
              <span class="rp-wk-dates">${MONTHS[month].slice(0,3)} ${start}–${end}</span>
            </div>
            <div class="rp-wk-bar-wrap">
              <div class="rp-wk-bar-fill" style="width:${pct}%"></div>
            </div>
            <div class="rp-wk-meta">
              <span class="rp-wk-time">${wMins > 0 ? fmt(wMins) : '—'}</span>
              <span class="rp-wk-days">${wActive} day${wActive !== 1 ? 's' : ''}</span>
            </div>
          </div>`;
        }).join('')}
      </div>`;

    const notesHdr = incNotes     ? '<th>Notes</th>'     : '';
    const resHdr   = incResources ? '<th>Resources</th>' : '';
    const entryRowsHtml = monthEntries.map(e => {
      const dateStr  = new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric' });
      const DIFF_BADGE = { easy:{bg:'#A7F3D0',color:'#065F46'}, medium:{bg:'#FDE68A',color:'#92400E'}, hard:{bg:'#FECDD3',color:'#9F1239'} };
      const diffBadge = DIFF_BADGE[e.difficulty] || { bg:'#6B7280', color:'#fff' };
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
        <td>${(({ bg, color }) => `<span class="rp-badge" style="background:${bg};color:${color}">${esc(e.category || 'Uncategorized')}</span>`)(getCat(e.category || 'Uncategorized'))}</td>
        <td class="rp-tc-dur">${fmt(e.durationMinutes || 0)}</td>
        <td>${e.difficulty ? `<span class="rp-badge" style="background:${diffBadge.bg};color:${diffBadge.color}">${capitalise(e.difficulty)}</span>` : '<span class="rp-muted">—</span>'}</td>
        ${notesCell}${resCell}
      </tr>`;
    }).join('');

    if (!container) return;

    container.innerHTML = `
      <div class="rp-header">
        <div>
          <div class="rp-title">${esc(reportTitle)}</div>
          <div class="rp-meta">Generated ${generatedOn} · ${esc(username)}</div>
        </div>
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

      ${daysWithEntries.length > 0 ? `
        <div class="rp-section">
          <div class="rp-section-title">Daily Learning Time</div>
          ${dailyChartHtml}
        </div>
        <div class="rp-section">
          <div class="rp-section-title">Weekly Progress</div>
          ${weeklyHtml}
        </div>` : ''}

      ${academicGoalsHtml}

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
  }

  /* ---- Monthly PDF Report -------------------------- */

  export function populateReportMonthSelect() {
    const sel = document.getElementById('report-month');
    if (!sel) return;
    const MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];

    // Collect only months that have at least one entry, grouped by year
    const monthSet = new Set(state.entries.map(e => e.date.slice(0, 7)));
    if (monthSet.size === 0) {
      sel.innerHTML = '<option value="">No entries yet</option>';
      return;
    }

    // Group months by year, most recent year first
    const byYear = {};
    [...monthSet].sort((a, b) => b.localeCompare(a)).forEach(val => {
      const year = val.slice(0, 4);
      (byYear[year] = byYear[year] || []).push(val);
    });

    sel.innerHTML = Object.entries(byYear)
      .sort((a, b) => b[0] - a[0])
      .map(([year, months]) =>
        `<optgroup label="${year}">${months.map(val => {
          const m0 = parseInt(val.slice(5), 10);
          return `<option value="${val}">${MONTHS[m0 - 1]}</option>`;
        }).join('')}</optgroup>`
      ).join('');
  }

  export async function generateMonthlyReport() {
    const sel = document.getElementById('report-month');
    if (!sel || !sel.value) {
      showToast('No months with logged entries available.', 'warning');
      return;
    }
    const [year, month0] = sel.value.split('-').map(Number);
    const month = month0 - 1;

    // Always reload goals to ensure latest state is in the report
    state.goals = await Storage.getAllGoals();

    const MONTHS   = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
    const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    const monthStr     = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthEntries = state.entries.filter(e => e.date.startsWith(monthStr))
                                 .sort((a, b) => a.date.localeCompare(b.date));

    if (monthEntries.length === 0) {
      showToast(`No entries found for ${MONTHS[month]} ${year}.`, 'warning');
      return;
    }

    const daysInMonth  = new Date(year, month + 1, 0).getDate();

    // Stats
    const totalMin      = monthEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
    const totalSessions = monthEntries.length;
    const activeDaySet  = new Set(monthEntries.map(e => e.date));
    const activeDays    = activeDaySet.size;
    const avgMin        = activeDays > 0 ? Math.round(totalMin / activeDays) : 0;
    const dailyGoalMin  = _dailyGoalMinFor(monthStr);
    const monthlyGoalHr = _monthGoalHrFor(monthStr);
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

    // Top topics — sorted by duration, then difficulty (hard > medium > easy), then mood
    const topicMap    = {};
    const _tDiffWt    = {};
    const _tMoodWt    = {};
    const _DIFF_RANK2 = { easy: 1, medium: 2, hard: 3 };
    monthEntries.forEach(e => {
      if (!e.topic) return;
      const mins = e.durationMinutes || 0;
      topicMap[e.topic] = (topicMap[e.topic] || 0) + mins;
      _tDiffWt[e.topic] = (_tDiffWt[e.topic] || 0) + mins * (_DIFF_RANK2[e.difficulty] ?? 2);
      _tMoodWt[e.topic] = (_tMoodWt[e.topic] || 0) + mins * (e.moodScore || 3);
    });
    const topTopics = Object.entries(topicMap)
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        const avgDiffA = _tDiffWt[a[0]] / a[1];
        const avgDiffB = _tDiffWt[b[0]] / b[1];
        if (avgDiffB !== avgDiffA) return avgDiffB - avgDiffA;
        return (_tMoodWt[b[0]] / b[1]) - (_tMoodWt[a[0]] / a[1]);
      })
      .slice(0, 10);
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

    // Ensure every category in this report has a stable, unique color before rendering.
    if (ensureCategoryColors(catSorted.map(([cat]) => cat))) {
      Storage.saveCategories(state.prefs.categories || [], state.prefs.categoryColors);
    }

    // Category rows
    const catRows = catSorted.map(([cat, mins], i) => {
      const color  = getCategoryColor(cat);
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
    const username     = state.prefs.username || 'Learner';
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
      let y = 70; // start below header band — overwritten by header section

      // Professional document palette — dark header anchor + teal data accent
      const CHDR  = [30, 41, 59];    // slate-800  #1E293B — header background
      const CI    = [13, 148, 136];  // teal-600   #0D9488 — primary data accent
      const CIL   = [153, 230, 219]; // teal-200   #99E6DB — light tint (calendar)
      const CIM   = [209, 213, 219]; // gray-300   #D1D5DB — neutral inactive
      const CBK   = [15, 23, 42];    // slate-950  #0F172A — primary text
      const CMID  = [51, 65, 85];    // slate-700  #334155 — body / table-header text
      const CGR   = [100, 116, 139]; // slate-500  #64748B — secondary
      const CLG   = [148, 163, 184]; // slate-400  #94A3B8 — muted
      const CDBG  = [241, 245, 249]; // slate-100  #F1F5F9 — table header bg
      const CBG   = [248, 250, 252]; // slate-50   #F8FAFC — page background
      const CBD   = [226, 232, 240]; // slate-200  #E2E8F0 — borders
      const CWH   = [255, 255, 255]; // white
      const CGRN  = [5, 150, 105];   // emerald-600 #059669 — completed / success
      const CRED  = [220, 38, 38];   // red-600    #DC2626 — overdue / error

      const clrF = c => pdf.setFillColor(c[0], c[1], c[2]);
      const clrD = c => pdf.setDrawColor(c[0], c[1], c[2]);
      const clrT = c => pdf.setTextColor(c[0], c[1], c[2]);

      // Category pill colors — { bg, text } tinted pairs (light bg + dark text)
      const _PDF_CAT_MAP = {
        'Programming':   { bg:[239,246,255], text:[30,64,175]   },
        'Mathematics':   { bg:[245,243,255], text:[91,33,182]   },
        'Languages':     { bg:[236,253,245], text:[6,95,70]     },
        'Science':       { bg:[236,254,255], text:[21,94,117]   },
        'Design':        { bg:[253,242,248], text:[157,23,77]   },
        'Business':      { bg:[255,251,235], text:[146,64,14]   },
        'Other':         { bg:[249,250,251], text:[55,65,81]    },
        'Uncategorized': { bg:[243,244,246], text:[107,114,128] },
      };
      const _PDF_CAT_POOL = [
        { bg:[255,247,237], text:[154,52,18]  }, { bg:[236,253,245], text:[6,78,59]    },
        { bg:[250,240,255], text:[126,34,206] }, { bg:[255,241,242], text:[159,18,57]  },
        { bg:[240,253,244], text:[20,83,45]   }, { bg:[239,246,255], text:[30,64,175]  },
        { bg:[254,252,232], text:[133,77,14]  }, { bg:[240,249,255], text:[12,74,110]  },
        { bg:[253,242,248], text:[131,24,67]  }, { bg:[247,254,231], text:[63,98,18]   },
        { bg:[254,249,195], text:[113,63,18]  }, { bg:[245,243,255], text:[76,29,149]  },
      ];
      const _pdfCatHash  = s => Math.abs([...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0));
      const getPdfCatClr = cat => _PDF_CAT_MAP[cat] || _PDF_CAT_POOL[_pdfCatHash(cat) % _PDF_CAT_POOL.length];
      const _PDF_DIFF_C  = {
        easy:   { bg:[236,253,245], text:[6,95,70]   },
        medium: { bg:[255,251,235], text:[146,64,14] },
        hard:   { bg:[255,241,242], text:[159,18,57] },
      };

      const drawPill = (label, x, y, rowH, clr) => {
        const pillH = 11, pillW = Math.min(pdf.getTextWidth(label) + 10, 96);
        const pillY = y + (rowH - pillH) / 2;
        pdf.setFillColor(...clr.bg);
        pdf.roundedRect(x, pillY, pillW, pillH, 2.5, 2.5, 'F');
        pdf.setTextColor(...clr.text);
        pdf.setFontSize(7); pdf.setFont(undefined, 'bold');
        pdf.text(label, x + 5, pillY + pillH - 3);
        pdf.setFont(undefined, 'normal'); pdf.setTextColor(...CBK);
      };

      function needsPage(h) {
        if (y + h > PH - MB) {
          pdf.addPage();
          fillR(0, 0, PW, PH, CBG);
          y = 40;
          return true;
        }
        return false;
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
        fillR(ML, y + 2, 2.5, 11, CI);
        tx(label.toUpperCase(), ML + 8, y + 10.5, 7.5, CGR, { bold: true });
        const lw2 = pdf.getTextWidth(label.toUpperCase());
        hline(ML + 8 + lw2 + 8, ML + CW, y + 7, CBD, 0.4);
        y += 20;
      }

      // ─── PAGE 1 BACKGROUND ───
      fillR(0, 0, PW, PH, CBG);

      // ─── HEADER BAND ───
      // Dark slate-800 background — gives the document an authoritative anchor
      fillR(0, 0, PW, 64, CHDR);
      // Teal left accent strip
      fillR(0, 0, 5, 64, CI);
      // Left: brand identity
      tx('LearnTrack', ML + 8, 26, 16, CWH, { bold: true });
      tx('Personal Learning Analytics', ML + 8, 42, 8.5, CLG);
      // Right: report metadata
      tx(reportTitle, PW - MR, 24, 13, CWH, { align: 'right', bold: true });
      tx(`${username}  ·  Generated ${generatedOn}`, PW - MR, 42, 8, CLG, { align: 'right' });
      y = 80;

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
        fillR(cx, y, cardW4, cardH, CWH);
        strokeR(cx, y, cardW4, cardH, CBD);
        tx(label.toUpperCase(), cx + 10, y + 16, 7, CGR, { bold: true });
        tx(String(value), cx + 10, y + 42, 20, CI, { bold: true });
        tx(sub, cx + 10, y + 55, 7.5, CLG);
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
        fillR(gx, y, gW, gH, CWH);
        strokeR(gx, y, gW, gH, CBD);
        tx(title, gx + 10, y + 16, 9, CBK, { bold: true });
        tx(`${pct}%`, gx + gW - 10, y + 16, 9, CI, { bold: true, align: 'right' });
        const bx = gx + 10, by = y + 27, bw = gW - 20, bh = 6;
        fillR(bx, by, bw, bh, CBD);
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
        fillR(bx, by, bw, bh, CBD);
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
      fillR(ML, y, 10, 10, CIL); strokeR(ML, y, 10, 10, CBD, 0.4);
      tx('Active', ML + 14, y + 9, 8, CGR);
      fillR(ML + 60, y, 10, 10, CI);
      tx('Goal met', ML + 74, y + 9, 8, CGR);
      y += 20;

      // ─── ACADEMIC GOALS ───
      const todayStr2 = Analytics.today();
      const rptGoals  = state.goals.filter(g => {
        if (g.status === 'archived') return false;
        const startedThisMonth   = g.startDate && g.startDate.startsWith(monthStr);
        const completedThisMonth = g.completedAt && (() => {
          const d = new Date(g.completedAt);
          return d.getFullYear() === year && d.getMonth() === month;
        })();
        return startedThisMonth || completedThisMonth;
      });

      if (rptGoals.length > 0) {
        // Derive status locally — no dependency on _goalStatusOf
        const _rptStatus = g => {
          if (g.status === 'completed') return 'completed';
          if (g.targetDate && g.targetDate < todayStr2) return 'overdue';
          return 'active';
        };

        const cntOpen     = rptGoals.filter(g => _rptStatus(g) === 'active').length;
        const cntOverdue  = rptGoals.filter(g => _rptStatus(g) === 'overdue').length;
        const cntDone     = rptGoals.filter(g => {
          if (g.status !== 'completed' || !g.completedAt) return false;
          const d = new Date(g.completedAt);
          return d.getFullYear() === year && d.getMonth() === month;
        }).length;

        needsPage(50);
        y += 8;
        sectionLabel('Academic Goals');

        // Summary chips
        const gChipW = (CW - 16) / 3;
        const gChipH = 34;
        [
          { label: 'Open',                 count: cntOpen,    c: CI   },
          { label: 'Overdue',              count: cntOverdue, c: CRED },
          { label: 'Completed this month', count: cntDone,    c: CGRN },
        ].forEach(({ label, count, c }, i) => {
          const cx = ML + i * (gChipW + 8);
          fillR(cx, y, gChipW, gChipH, CWH);
          strokeR(cx, y, gChipW, gChipH, CBD);
          tx(label.toUpperCase(), cx + 10, y + 13, 6.5, CLG, { bold: true });
          tx(String(count), cx + 10, y + 28, 15, c, { bold: true });
        });
        y += gChipH + 10;

        // Sort: overdue first, then open, then completed
        const _rptOrder = g => _rptStatus(g) === 'overdue' ? 0 : _rptStatus(g) === 'active' ? 1 : 2;
        const sortedRptGoals = [...rptGoals].sort((a, b) => _rptOrder(a) - _rptOrder(b));

        // Table
        const gRH    = 19;
        const wType  = 80, wStatus = 56, wDue = 52, wProg = 80;
        const wTitle = CW - wType - wStatus - wDue - wProg;
        const gXs    = [ML + 6, ML + wTitle, ML + wTitle + wType, ML + wTitle + wType + wStatus, ML + CW - wProg + 2];
        fillR(ML, y, CW, gRH, CDBG);
        hline(ML, ML + CW, y + gRH, CBD, 0.5);
        ['Goal', 'Type', 'Status', 'Due', 'Progress'].forEach((h, i) =>
          tx(h, gXs[i], y + 13, 8, CMID, { bold: true })
        );
        y += gRH;

        const drawGoalHeader = () => {
          fillR(ML, y, CW, gRH, CDBG);
          hline(ML, ML + CW, y + gRH, CBD, 0.5);
          ['Goal', 'Type', 'Status', 'Due', 'Progress'].forEach((h, i) =>
            tx(h, gXs[i], y + 13, 8, CMID, { bold: true })
          );
          y += gRH;
        };

        sortedRptGoals.forEach((goal, idx) => {
          if (needsPage(gRH)) drawGoalHeader();
          fillR(ML, y, CW, gRH, idx % 2 === 0 ? CWH : CDBG);
          hline(ML, ML + CW, y, CBD, 0.3);

          const gSt   = _rptStatus(goal);
          const gProg = goal.status === 'completed' && goal.progressSnapshot
            ? goal.progressSnapshot
            : Analytics.goalProgress(goal, state.entries);
          const gPct  = (gProg && gProg.pct != null) ? gProg.pct : 0;

          tx(pdf.splitTextToSize(goal.title || '—', wTitle - 14)[0] || '—', gXs[0], y + 13, 8, CBK);

          const _PDF_TYPE = {
            time:      { bg:[239,246,255], text:[30,64,175],  label:'Study Hours' },
            count:     { bg:[245,243,255], text:[91,33,182],  label:'Problem Count' },
            checklist: { bg:[236,253,245], text:[6,95,70],    label:'Task List' },
            exam:      { bg:[255,241,242], text:[159,18,57],  label:'Exam Prep' },
          };
          const typePdfDef = _PDF_TYPE[goal.type] || _PDF_TYPE.exam;
          drawPill(typePdfDef.label, gXs[1], y, gRH, typePdfDef);

          const stLabel = gSt === 'completed' ? '✓ Done' : gSt === 'overdue' ? 'Overdue' : 'Open';
          const stColor = gSt === 'completed' ? CGRN : gSt === 'overdue' ? CRED : CI;
          tx(stLabel, gXs[2], y + 13, 7.5, stColor, { bold: gSt !== 'active' });

          tx(goal.targetDate
            ? new Date(goal.targetDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '—', gXs[3], y + 13, 7.5, CLG);

          const pbX = gXs[4], pbW = wProg - 32, pbY = y + 6, pbH = 5;
          fillR(pbX, pbY, pbW, pbH, CBD);
          fillR(pbX, pbY, Math.max(2, pbW * Math.min(gPct, 100) / 100), pbH, gSt === 'completed' ? CGRN : CI);
          tx(`${gPct}%`, pbX + pbW + 5, y + 13, 7.5, CGR);

          y += gRH;
        });
        hline(ML, ML + CW, y, CBD, 0.5);
        y += 10;
      }

      // ─── CATEGORY BREAKDOWN ───
      if (catSorted.length > 0) {
        needsPage(44);
        y += 6;
        sectionLabel('Category Breakdown');
        const colXs = [ML + 6, ML + 200, ML + 262, ML + 316];
        const colWs = [194, 62, 54, CW - 282];
        const rH = 20;
        fillR(ML, y, CW, rH, CDBG); hline(ML, ML + CW, y + rH, CBD, 0.5);
        ['Category','Time','Share','Distribution'].forEach((h, i) =>
          tx(h, colXs[i], y + 14, 8, CMID, { bold: true })
        );
        y += rH;
        catSorted.forEach(([cat, mins], idx) => {
          needsPage(rH);
          if (idx % 2 === 1) fillR(ML, y, CW, rH, CWH);
          hline(ML, ML + CW, y, CBD, 0.3);
          const pct2   = totalMin > 0 ? Math.round((mins / totalMin) * 100) : 0;
          const dotRGB = hexRGB(getCategoryColor(cat));
          fillR(ML + 6, y + 7, 7, 7, dotRGB);
          const catTrunc = pdf.splitTextToSize(cat, 174)[0] || cat;
          tx(catTrunc, ML + 16, y + 14, 8.5, CBK);
          tx(fmt(mins), colXs[1], y + 14, 8.5, CGR);
          tx(`${pct2}%`, colXs[2], y + 14, 8.5, CGR);
          const bxC = colXs[3], bwC = colWs[3] - 6, byC = y + 7, bhC = 6;
          fillR(bxC, byC, bwC, bhC, CBD);
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
          fillR(bx2, by2, bw2, bh2, CBD);
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
        const wCat   = colFit(monthEntries.map(e => e.category || 'Uncategorized'), 'Category',   46, 110);
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
        const drawEntryHeader = () => {
          fillR(ML, y, tblW, tRowH, CDBG);
          hline(ML, ML + tblW, y + tRowH, CBD, 0.5);
          tCols.forEach((c, i) => tx(c.label, colX[i] + pad, y + 13, 8, CMID, { bold: true }));
          y += tRowH;
        };
        drawEntryHeader();

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
            entry.category || 'Uncategorized',
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

          if (needsPage(rowH)) drawEntryHeader();
          fillR(ML, y, tblW, rowH, idx % 2 === 0 ? CWH : CDBG);
          hline(ML, ML + tblW, y, CBD, 0.3);

          // Standard columns — vertically centered, full wrapping
          [
            { ci: 0, text: dateLabel,                       rc: CGR },
            { ci: 1, text: entry.topic || '',               rc: CBK },
            { ci: 3, text: fmt(entry.durationMinutes || 0), rc: CGR },
          ].forEach(({ ci, text, rc }) => {
            const lines = pdf.splitTextToSize(String(text), tCols[ci].w - pad * 2);
            const startY = y + (rowH - lines.length * lineH) / 2 + lineH;
            lines.forEach((line, li) =>
              tx(line, colX[ci] + pad, startY + li * lineH, 8, rc)
            );
          });

          // Category — tinted pill
          const catLabel = entry.category || 'Uncategorized';
          drawPill(catLabel, colX[2] + pad, y, rowH, getPdfCatClr(catLabel));

          // Difficulty — tinted pill
          const diffLabel = entry.difficulty ? entry.difficulty.charAt(0).toUpperCase() + entry.difficulty.slice(1) : null;
          if (diffLabel && _PDF_DIFF_C[entry.difficulty]) {
            drawPill(diffLabel, colX[4] + pad, y, rowH, _PDF_DIFF_C[entry.difficulty]);
          } else {
            tx('—', colX[4] + pad, y + (rowH - lineH) / 2 + lineH, 8, CGR);
          }

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
                  const safeUrl = safeHref(res.url);
                  if (safeUrl !== '#') pdf.link(colX[resColIdx] + pad, rsy - 9, lw, lineH, { url: safeUrl });
                });
              });
            }
          }

          y += rowH;
        });
        hline(ML, ML + tblW, y, CBD, 0.5);
        y += 8;
      }

      // ─── FOOTER — stamped on every page ───
      const totalPages = pdf.internal.getNumberOfPages();
      for (let pg = 1; pg <= totalPages; pg++) {
        pdf.setPage(pg);
        const footY = PH - 20;
        hline(ML, PW - MR, footY - 10, CBD, 0.5);
        tx('LearnTrack', ML, footY, 8, CI, { bold: true });
        tx('· Personal Learning Analytics', ML + 62, footY, 8, CLG);
        tx(`Page ${pg} of ${totalPages}`, PW / 2, footY, 8, CLG, { align: 'center' });
        tx(reportTitle, PW - MR, footY, 8, CLG, { align: 'right' });
      }

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
