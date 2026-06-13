/* ===================================================
   LEARNTRACK — SMART INSIGHTS ENGINE
   Generates text insights, recommendation cards,
   and learning curve annotations.
   =================================================== */

'use strict';

const Insights = (() => {

  /* ---- Daily Motivational Quotes ------------------- */

  const QUOTES = [
    "The expert in anything was once a beginner.",
    "An investment in knowledge pays the best interest. — Benjamin Franklin",
    "Live as if you were to die tomorrow. Learn as if you were to live forever. — Gandhi",
    "The beautiful thing about learning is nobody can take it away from you.",
    "Education is the passport to the future, for tomorrow belongs to those who prepare for it today.",
    "The more that you read, the more things you will know.",
    "Anyone who stops learning is old, whether at twenty or eighty.",
    "The capacity to learn is a gift; the ability to learn is a skill; the willingness to learn is a choice.",
    "Learning never exhausts the mind. — Leonardo da Vinci",
    "Develop a passion for learning. If you do, you will never cease to grow.",
    "The only true wisdom is in knowing you know nothing. — Socrates",
    "It does not matter how slowly you go, as long as you do not stop. — Confucius",
    "In learning you will teach, and in teaching you will learn.",
    "Mistakes are the portals of discovery.",
    "Persistence is the twin sister of excellence.",
    "Small steps every day lead to big results.",
    "Today's learner is tomorrow's leader.",
    "Consistency beats perfection.",
    "Every day you don't learn is a day you stay the same.",
    "Push yourself, because no one else is going to do it for you.",
  ];

  function getDailyQuote() {
    const dayIndex = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
    return QUOTES[dayIndex % QUOTES.length];
  }

  function getRandomQuote() {
    return QUOTES[Math.floor(Math.random() * QUOTES.length)];
  }

  /* ---- Greeting ------------------------------------ */

  function getGreeting(username = 'Learner') {
    const h = new Date().getHours();
    const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    const greetings = {
      morning:   [`Good morning, ${username}! Ready to learn something amazing today?`,
                  `Rise and learn, ${username}! 🌅`,
                  `Morning, ${username}! Make today count.`],
      afternoon: [`Good afternoon, ${username}! Keep the momentum going!`,
                  `Hey ${username}! How's the learning session going?`,
                  `Afternoon, ${username}! Great time for a deep dive.`],
      evening:   [`Good evening, ${username}! One more session before the day ends?`,
                  `Evening, ${username}! Wind down with something new.`,
                  `Hey ${username}! Evening study sessions are powerful.`],
    };
    const list = greetings[part];
    return list[Math.floor(Math.random() * list.length)];
  }

  /* ---- Generate Insight Cards ---------------------- */

  function generateInsights(entries, streak, stats, consistency, curve) {
    const insights = [];

    if (entries.length === 0) return insights;

    // Best learning day
    const bestDay = Analytics.bestLearningDay(entries);
    insights.push({
      label: 'Best Day to Learn',
      value: bestDay,
      sub:   'Highest average session',
      icon:  '📅',
    });

    // Average session
    insights.push({
      label: 'Avg Session',
      value: Analytics.formatDuration(Math.round(stats.totalMinutes / Math.max(stats.totalEntries, 1))),
      sub:   'Per learning entry',
      icon:  '⏱️',
    });

    // Most studied topic (grouped by the entry's topic field, not its category)
    const topicMins = {};
    for (const e of entries) {
      const t = (e.topic || '').trim() || 'Untitled';
      topicMins[t] = (topicMins[t] || 0) + (e.durationMinutes || 0);
    }
    const topTopic = Object.entries(topicMins).sort((a, b) => b[1] - a[1])[0];
    if (topTopic) {
      insights.push({
        label: 'Most Studied Topic',
        value: topTopic[0],
        sub:   `${Analytics.formatDuration(topTopic[1])} total`,
        icon:  '📚',
      });
    }

    const topicDist = Analytics.calculateTopicDistribution(entries);

    // Topics explored
    if (topicDist.length > 0) {
      insights.push({
        label:  'Subjects Explored',
        value:  `${topicDist.length}`,
        sub:    'Click here for details',
        icon:   '🗂️',
        action: 'topics',   // makes the card clickable → opens the subjects breakdown modal
      });
    }

    return insights;
  }

  /* ---- Render Insights Row ------------------------- */

  function renderInsightsRow(containerId, insights) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (insights.length === 0) {
      container.innerHTML = '<div class="insight-card"><div class="insight-label">Add entries</div><div class="insight-value">to see insights</div></div>';
      return;
    }

    container.innerHTML = insights.map(ins => {
      const clickable = ins.action
        ? ` insight-card-clickable" role="button" tabindex="0" data-insight-action="${escapeHtml(ins.action)}`
        : '';
      return `
      <div class="insight-card hover-lift${clickable}">
        <div class="insight-label">${ins.icon} ${ins.label}</div>
        <div class="insight-value">${escapeHtml(ins.value)}</div>
        ${ins.sub ? `<div class="insight-sub">${escapeHtml(ins.sub)}</div>` : ''}
      </div>
    `;
    }).join('');
  }

  /* ---- Learning Curve Chips ------------------------ */

  function renderCurveInsights(containerId, curve) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const chips = [];

    if (!curve || curve.points.length < 2) {
      container.innerHTML = '<span class="curve-insight-chip neutral">📊 Add more entries to see your learning curve</span>';
      return;
    }

    if (curve.burnout) {
      chips.push({ cls: 'warning', text: '⚠️ Activity dropped — time to recharge?' });
    } else if (curve.plateau) {
      chips.push({ cls: 'warning', text: '📊 Plateau detected — try a new topic!' });
    }

    if (curve.momentum === 'rising') {
      chips.push({ cls: 'positive', text: '📈 Momentum rising — great work!' });
    } else if (curve.momentum === 'dropping') {
      chips.push({ cls: 'warning', text: '📉 Momentum slowing — keep pushing!' });
    } else if (curve.momentum === 'stable') {
      chips.push({ cls: 'neutral', text: '➡️ Consistent momentum' });
    }

    container.innerHTML = chips.map(c =>
      `<span class="curve-insight-chip ${c.cls}">${c.text}</span>`
    ).join('') || '<span class="curve-insight-chip neutral">📊 Your learning journey</span>';
  }

  /* ---- Streak Motivational Message ----------------- */

  function getStreakInsight(streak, consistency) {
    if (streak.current === 0) {
      return "Start your streak today! Even 10 minutes counts. 🌱";
    }
    if (streak.current >= 30) {
      return `🏆 Incredible! ${streak.current}-day streak. You're in the top 1% of learners!`;
    }
    if (streak.current >= 7) {
      return `🔥 ${streak.current}-day streak! You're forming a powerful learning habit.`;
    }
    if (consistency >= 80) {
      return "🎯 Your consistency is excellent. Keep showing up every day!";
    }
    return `🙂 ${streak.current}-day streak. Build to 7 days for the Week Warrior badge!`;
  }

  /* ---- Next Milestone Calculation ------------------ */

  // 1000 milestones generated in code (not tied to the badge collection):
  //   350 — total entries logged   (1..350 entries)
  //   500 — total hours studied    (1..500 hours)
  //   150 — longest streak in days (1..150 days)
  const MILESTONES = (() => {
    const list = [];
    for (let i = 1; i <= 350; i++) {
      list.push({ metric: 'entries', target: i, icon: '📝', name: `Log ${i} ${i === 1 ? 'Entry' : 'Entries'}` });
    }
    for (let i = 1; i <= 500; i++) {
      list.push({ metric: 'hours', target: i, icon: '⏳', name: `Study ${i} ${i === 1 ? 'Hour' : 'Hours'} Total` });
    }
    for (let i = 1; i <= 150; i++) {
      list.push({ metric: 'streak', target: i, icon: '🔥', name: `${i}-Day Streak` });
    }
    return list;
  })();

  function getNextMilestone(entries, streak, stats) {
    streak = streak || {};
    stats  = stats  || {};

    // Current value per metric. Hours keep one decimal so the progress bar
    // moves within an hour; streak uses the longest ever so a milestone,
    // once reached, stays achieved.
    const values = {
      entries: stats.totalEntries || 0,
      hours:   Math.round(((stats.totalMinutes || 0) / 60) * 10) / 10,
      streak:  Math.max(streak.longest || 0, streak.current || 0),
    };

    let achieved = 0;
    let next = null;   // unachieved milestone closest to completion
    for (const m of MILESTONES) {
      const cur = values[m.metric];
      if (cur >= m.target) { achieved++; continue; }
      const ratio = cur / m.target;
      if (!next || ratio > next.ratio) {
        next = { name: m.name, icon: m.icon, current: cur, max: m.target, ratio };
      }
    }

    if (!next) {
      return {
        name: `Great, you have achieved all ${MILESTONES.length} milestones`,
        icon: '🏆',
        current: MILESTONES.length,
        max: MILESTONES.length,
        achieved,
        total: MILESTONES.length,
        allDone: true,
      };
    }

    return { ...next, achieved, total: MILESTONES.length, allDone: false };
  }

  /* ---- Recommendation Cards ----------------------- */

  function generateRecommendations(entries, streak, stats, consistency) {
    const recs = [];

    if (entries.length === 0) {
      recs.push({ icon: '🚀', title: 'Start your journey', desc: 'Log your first learning session to begin tracking progress.' });
      return recs;
    }

    if (streak.current === 0) {
      recs.push({ icon: '🔥', title: 'Rebuild your streak', desc: 'Log a session today to start a new streak.' });
    }

    if (consistency < 50) {
      recs.push({ icon: '📅', title: 'Improve consistency', desc: 'Try to learn at least 15 minutes every day for a week.' });
    }

    const topicDist = Analytics.calculateTopicDistribution(entries);
    if (topicDist.length === 1) {
      recs.push({ icon: '🗺️', title: 'Explore new topics', desc: 'Diversifying your studies builds broader skills.' });
    }

    const avgSession = stats.totalMinutes / Math.max(stats.totalEntries, 1);
    if (avgSession < 30) {
      recs.push({ icon: '⏱️', title: 'Longer sessions', desc: 'Aim for 45-60 min sessions for deeper learning.' });
    }

    return recs;
  }

  /* ---- Helpers ------------------------------------- */

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str || '');
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  /* ---- Public API ---------------------------------- */
  return {
    getDailyQuote,
    getRandomQuote,
    getGreeting,
    generateInsights,
    renderInsightsRow,
    renderCurveInsights,
    getStreakInsight,
    getNextMilestone,
    generateRecommendations,
  };

})();
