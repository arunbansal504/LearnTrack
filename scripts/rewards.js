/* ===================================================
   LEARNTRACK — REWARDS & GAMIFICATION ENGINE
   XP · Levels · Badges · Achievements · Celebrations
   =================================================== */

'use strict';

const Rewards = (() => {

  /* ---- XP & Level Config ----------------------------- */

  const XP_PER_MINUTE     = 1;
  const XP_STREAK_BONUS   = { 3: 1.2, 7: 1.4, 14: 1.6, 30: 2.0 };
  const XP_DIFFICULTY_MULT= { easy: 1, medium: 1.5, hard: 3 };
  const XP_MOOD_BONUS     = { 1: 0.8, 2: 0.9, 3: 1.0, 4: 1.1, 5: 1.25 };

  const LEVELS = [
    { level: 1,  title: 'Beginner',        xpNeeded: 0    },
    { level: 2,  title: 'Curious Mind',    xpNeeded: 100  },
    { level: 3,  title: 'Explorer',        xpNeeded: 250  },
    { level: 4,  title: 'Apprentice',      xpNeeded: 500  },
    { level: 5,  title: 'Learner',         xpNeeded: 900  },
    { level: 6,  title: 'Practitioner',    xpNeeded: 1500 },
    { level: 7,  title: 'Adept',           xpNeeded: 2500 },
    { level: 8,  title: 'Scholar',         xpNeeded: 4000 },
    { level: 9,  title: 'Expert',          xpNeeded: 6500 },
    { level: 10, title: 'Master',          xpNeeded: 10000},
    { level: 11, title: 'Grand Master',    xpNeeded: 15000},
    { level: 12, title: 'Legend',          xpNeeded: 22000},
  ];

  /* ---- Achievement Definitions ----------------------- */

  // Helper: day gap between two YYYY-MM-DD strings (safe across timezones)
  function _daysBetween(a, b) {
    return Math.round(
      (new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000
    );
  }

  // Helper: group entry minutes by date
  function _byDate(entries) {
    const m = {};
    for (const e of entries) {
      if (e.date) m[e.date] = (m[e.date] || 0) + (e.durationMinutes || 0);
    }
    return m;
  }

  const ACHIEVEMENTS = [
    /* ---- First steps -------------------------------- */
    {
      id:    'first_entry',
      name:  'First Step',
      icon:  '🌱',
      desc:  'Log your very first learning entry.',
      xp:    50,
      check: ({ entries }) => entries.length >= 1,
      progress: ({ entries }) => ({ current: Math.min(entries.length, 1), max: 1 }),
    },

    /* ---- Session count ------------------------------ */
    {
      id:    'entries_10',
      name:  'Habit Builder',
      icon:  '📝',
      desc:  'Log 10 learning sessions.',
      xp:    100,
      check: ({ entries }) => entries.length >= 10,
      progress: ({ entries }) => ({ current: Math.min(entries.length, 10), max: 10 }),
    },
    {
      id:    'entries_25',
      name:  'On a Roll',
      icon:  '🎲',
      desc:  'Log 25 learning sessions.',
      xp:    150,
      check: ({ entries }) => entries.length >= 25,
      progress: ({ entries }) => ({ current: Math.min(entries.length, 25), max: 25 }),
    },
    {
      id:    'entries_50',
      name:  'Committed',
      icon:  '💪',
      desc:  'Log 50 learning sessions.',
      xp:    400,
      check: ({ entries }) => entries.length >= 50,
      progress: ({ entries }) => ({ current: Math.min(entries.length, 50), max: 50 }),
    },
    {
      id:    'entries_100',
      name:  'Century Club',
      icon:  '💯',
      desc:  'Log 100 learning sessions.',
      xp:    600,
      check: ({ entries }) => entries.length >= 100,
      progress: ({ entries }) => ({ current: Math.min(entries.length, 100), max: 100 }),
    },

    /* ---- Streaks ------------------------------------ */
    {
      id:    'streak_3',
      name:  '3-Day Streak',
      icon:  '🔥',
      desc:  'Learn for 3 consecutive days.',
      xp:    75,
      check: ({ streak }) => streak.current >= 3,
      progress: ({ streak }) => ({ current: Math.min(streak.current, 3), max: 3 }),
    },
    {
      id:    'streak_7',
      name:  'Week Warrior',
      icon:  '⚔️',
      desc:  'Maintain a 7-day learning streak.',
      xp:    200,
      check: ({ streak }) => streak.current >= 7 || streak.longest >= 7,
      progress: ({ streak }) => ({ current: Math.min(Math.max(streak.current, streak.longest), 7), max: 7 }),
    },
    {
      id:    'streak_14',
      name:  'Fortnight Focus',
      icon:  '📅',
      desc:  'Maintain a 14-day learning streak.',
      xp:    400,
      check: ({ streak }) => streak.current >= 14 || streak.longest >= 14,
      progress: ({ streak }) => ({ current: Math.min(Math.max(streak.current, streak.longest), 14), max: 14 }),
    },
    {
      id:    'streak_30',
      name:  'Monthly Master',
      icon:  '🏆',
      desc:  'Keep a 30-day learning streak.',
      xp:    1000,
      check: ({ streak }) => streak.current >= 30 || streak.longest >= 30,
      progress: ({ streak }) => ({ current: Math.min(Math.max(streak.current, streak.longest), 30), max: 30 }),
    },
    {
      id:    'streak_100',
      name:  'Centurion',
      icon:  '🛡️',
      desc:  'Reach a 100-day learning streak.',
      xp:    2000,
      check: ({ streak }) => streak.current >= 100 || streak.longest >= 100,
      progress: ({ streak }) => ({ current: Math.min(Math.max(streak.current, streak.longest), 100), max: 100 }),
    },
    {
      id:    'comeback_kid',
      name:  'Comeback Kid',
      icon:  '🔄',
      desc:  'Return to learning after a 7+ day break.',
      xp:    100,
      check: ({ entries }) => {
        if (entries.length < 2) return false;
        const dates = [...new Set(entries.map(e => e.date))].sort();
        for (let i = 1; i < dates.length; i++) {
          if (_daysBetween(dates[i - 1], dates[i]) >= 7) return true;
        }
        return false;
      },
      progress: ({ entries }) => {
        if (entries.length < 2) return { current: 0, max: 1 };
        const dates = [...new Set(entries.map(e => e.date))].sort();
        for (let i = 1; i < dates.length; i++) {
          if (_daysBetween(dates[i - 1], dates[i]) >= 7) return { current: 1, max: 1 };
        }
        return { current: 0, max: 1 };
      },
    },

    /* ---- Total hours -------------------------------- */
    {
      id:    'hours_5',
      name:  'Getting Started',
      icon:  '⏳',
      desc:  'Reach 5 total learning hours.',
      xp:    50,
      check: ({ stats }) => stats.totalHours >= 5,
      progress: ({ stats }) => ({ current: Math.min(Math.round(stats.totalHours * 10) / 10, 5), max: 5 }),
    },
    {
      id:    'hours_10',
      name:  'Tenacious',
      icon:  '⏱️',
      desc:  'Reach 10 total learning hours.',
      xp:    100,
      check: ({ stats }) => stats.totalHours >= 10,
      progress: ({ stats }) => ({ current: Math.min(Math.round(stats.totalHours), 10), max: 10 }),
    },
    {
      id:    'hours_25',
      name:  'Quarter Century',
      icon:  '🕰️',
      desc:  'Reach 25 total learning hours.',
      xp:    200,
      check: ({ stats }) => stats.totalHours >= 25,
      progress: ({ stats }) => ({ current: Math.min(Math.round(stats.totalHours), 25), max: 25 }),
    },
    {
      id:    'hours_50',
      name:  'Dedicated Scholar',
      icon:  '📚',
      desc:  'Reach 50 total learning hours.',
      xp:    500,
      check: ({ stats }) => stats.totalHours >= 50,
      progress: ({ stats }) => ({ current: Math.min(Math.round(stats.totalHours), 50), max: 50 }),
    },
    {
      id:    'hours_100',
      name:  '100 Hours!',
      icon:  '🎖️',
      desc:  'Reach 100 total learning hours.',
      xp:    1500,
      check: ({ stats }) => stats.totalHours >= 100,
      progress: ({ stats }) => ({ current: Math.min(Math.round(stats.totalHours), 100), max: 100 }),
    },
    {
      id:    'hours_200',
      name:  'Learning Machine',
      icon:  '🤖',
      desc:  'Reach 200 total learning hours.',
      xp:    2000,
      check: ({ stats }) => stats.totalHours >= 200,
      progress: ({ stats }) => ({ current: Math.min(Math.round(stats.totalHours), 200), max: 200 }),
    },
    {
      id:    'hours_500',
      name:  'Half a Thousand',
      icon:  '🌟',
      desc:  'Reach 500 total learning hours.',
      xp:    5000,
      check: ({ stats }) => stats.totalHours >= 500,
      progress: ({ stats }) => ({ current: Math.min(Math.round(stats.totalHours), 500), max: 500 }),
    },

    /* ---- Daily goal --------------------------------- */
    {
      id:    'daily_goal_first',
      name:  'Goal Getter',
      icon:  '🎯',
      desc:  'Meet your daily learning goal for the first time.',
      xp:    75,
      check: ({ entries, goalForDate }) => {
        const m = _byDate(entries);
        return Object.entries(m).some(([date, v]) => v >= goalForDate(date));
      },
      progress: ({ entries, goalForDate }) => {
        const m = _byDate(entries);
        return { current: Object.entries(m).some(([date, v]) => v >= goalForDate(date)) ? 1 : 0, max: 1 };
      },
    },
    {
      id:    'daily_goal_streak_7',
      name:  'Week of Wins',
      icon:  '📆',
      desc:  'Meet your daily goal 7 days in a row.',
      xp:    300,
      check: ({ entries, goalForDate }) => {
        const m = _byDate(entries);
        const dates = Object.keys(m).sort();
        let run = 0;
        for (let i = 0; i < dates.length; i++) {
          if (m[dates[i]] >= goalForDate(dates[i])) {
            run = (i > 0 && _daysBetween(dates[i - 1], dates[i]) === 1) ? run + 1 : 1;
            if (run >= 7) return true;
          } else { run = 0; }
        }
        return false;
      },
      progress: ({ entries, goalForDate }) => {
        const m = _byDate(entries);
        const dates = Object.keys(m).sort();
        let run = 0, best = 0;
        for (let i = 0; i < dates.length; i++) {
          if (m[dates[i]] >= goalForDate(dates[i])) {
            run = (i > 0 && _daysBetween(dates[i - 1], dates[i]) === 1) ? run + 1 : 1;
            best = Math.max(best, run);
          } else { run = 0; }
        }
        return { current: Math.min(best, 7), max: 7 };
      },
    },
    {
      id:    'daily_goal_30',
      name:  'Consistent Champion',
      icon:  '🥊',
      desc:  'Meet your daily goal on 30 different days.',
      xp:    500,
      check: ({ entries, goalForDate }) => {
        return Object.entries(_byDate(entries)).filter(([date, v]) => v >= goalForDate(date)).length >= 30;
      },
      progress: ({ entries, goalForDate }) => {
        const count = Object.entries(_byDate(entries)).filter(([date, v]) => v >= goalForDate(date)).length;
        return { current: Math.min(count, 30), max: 30 };
      },
    },
    {
      id:    'overachiever',
      name:  'Overachiever',
      icon:  '🚀',
      desc:  'Log twice your daily goal in a single day.',
      xp:    150,
      check: ({ entries, goalForDate }) => {
        return Object.entries(_byDate(entries)).some(([date, v]) => v >= goalForDate(date) * 2);
      },
      progress: ({ entries, goalForDate }) => {
        return { current: Object.entries(_byDate(entries)).some(([date, v]) => v >= goalForDate(date) * 2) ? 1 : 0, max: 1 };
      },
    },

    /* ---- Single-day performance --------------------- */
    {
      id:    'deep_focus',
      name:  'Deep Focus',
      icon:  '🔬',
      desc:  'Log a single session of 3+ hours.',
      xp:    200,
      check: ({ entries }) => entries.some(e => (e.durationMinutes || 0) >= 180),
      progress: ({ entries }) => ({
        current: entries.some(e => (e.durationMinutes || 0) >= 180) ? 1 : 0,
        max: 1,
      }),
    },
    {
      id:    'marathon_day',
      name:  'Marathon Day',
      icon:  '🏃',
      desc:  'Log 5+ hours of learning in a single day.',
      xp:    300,
      check: ({ entries }) => Object.values(_byDate(entries)).some(v => v >= 300),
      progress: ({ entries }) => {
        const best = Math.max(0, ...Object.values(_byDate(entries)));
        return { current: Math.min(Math.floor(best / 60), 5), max: 5 };
      },
    },

    /* ---- Difficulty & quality ----------------------- */
    {
      id:    'hard_learner',
      name:  'Hard Learner',
      icon:  '🧗',
      desc:  'Complete 10 hard-difficulty sessions.',
      xp:    200,
      check: ({ entries }) =>
        entries.filter(e => e.difficulty === 'hard').length >= 10,
      progress: ({ entries }) => ({
        current: Math.min(entries.filter(e => e.difficulty === 'hard').length, 10),
        max: 10,
      }),
    },
    {
      id:    'polymath',
      name:  'Polymath',
      icon:  '🧠',
      desc:  'Log sessions at all 3 difficulty levels.',
      xp:    200,
      check: ({ entries }) => {
        const d = new Set(entries.map(e => e.difficulty).filter(Boolean));
        return ['easy','medium','hard'].every(x => d.has(x));
      },
      progress: ({ entries }) => {
        const d = new Set(entries.map(e => e.difficulty).filter(Boolean));
        const levels = ['easy','medium','hard'];
        return { current: levels.filter(x => d.has(x)).length, max: 3 };
      },
    },
    {
      id:    'notes_taker',
      name:  'Thoughtful Notes',
      icon:  '🗒️',
      desc:  'Add notes to 10 different entries.',
      xp:    100,
      check: ({ entries }) => entries.filter(e => (e.notes || '').trim()).length >= 10,
      progress: ({ entries }) => ({
        current: Math.min(entries.filter(e => (e.notes || '').trim()).length, 10),
        max: 10,
      }),
    },
    {
      id:    'resource_hoarder',
      name:  'Resource Collector',
      icon:  '🔗',
      desc:  'Add resources to 20 entries.',
      xp:    150,
      check: ({ entries }) => entries.filter(e => e.resources && e.resources.length > 0).length >= 20,
      progress: ({ entries }) => ({
        current: Math.min(entries.filter(e => e.resources && e.resources.length > 0).length, 20),
        max: 20,
      }),
    },

    /* ---- Topics & categories ------------------------ */
    {
      id:    'topic_master',
      name:  'Topic Master',
      icon:  '🏫',
      desc:  'Log 10+ hours on a single topic.',
      xp:    300,
      check: ({ entries }) => {
        const t = {};
        for (const e of entries) if (e.topic) t[e.topic] = (t[e.topic] || 0) + (e.durationMinutes || 0);
        return Object.values(t).some(v => v >= 600);
      },
      progress: ({ entries }) => {
        const t = {};
        for (const e of entries) if (e.topic) t[e.topic] = (t[e.topic] || 0) + (e.durationMinutes || 0);
        const best = Math.max(0, ...Object.values(t));
        return { current: Math.min(Math.floor(best / 60), 10), max: 10 };
      },
    },
    {
      id:    'category_3',
      name:  'Category Explorer',
      icon:  '🗂️',
      desc:  'Learn in 3 different categories.',
      xp:    75,
      check: ({ entries }) => new Set(entries.map(e => e.category).filter(Boolean)).size >= 3,
      progress: ({ entries }) => ({
        current: Math.min(new Set(entries.map(e => e.category).filter(Boolean)).size, 3),
        max: 3,
      }),
    },
    {
      id:    'multi_topic',
      name:  'Multi-Topic Explorer',
      icon:  '🗺️',
      desc:  'Learn in 5 different categories.',
      xp:    150,
      check: ({ entries }) => new Set(entries.map(e => e.category).filter(Boolean)).size >= 5,
      progress: ({ entries }) => ({
        current: Math.min(new Set(entries.map(e => e.category).filter(Boolean)).size, 5),
        max: 5,
      }),
    },
    {
      id:    'diverse_learner',
      name:  'Diverse Learner',
      icon:  '🌐',
      desc:  'Learn in 7 or more different categories.',
      xp:    400,
      check: ({ entries }) => new Set(entries.map(e => e.category).filter(Boolean)).size >= 7,
      progress: ({ entries }) => ({
        current: Math.min(new Set(entries.map(e => e.category).filter(Boolean)).size, 7),
        max: 7,
      }),
    },

    /* ---- Time of day -------------------------------- */
    {
      id:    'early_bird',
      name:  'Early Bird',
      icon:  '🌅',
      desc:  'Log an entry before 8 AM.',
      xp:    75,
      check: ({ entries }) => entries.some(e => {
        if (!e.createdAt) return false;
        const h = new Date(e.createdAt).getHours();
        return h >= 5 && h < 8;
      }),
      progress: ({ entries }) => ({
        current: entries.some(e => { if (!e.createdAt) return false; const h = new Date(e.createdAt).getHours(); return h >= 5 && h < 8; }) ? 1 : 0,
        max: 1,
      }),
    },
    {
      id:    'lunch_learner',
      name:  'Lunch Learner',
      icon:  '🥗',
      desc:  'Log an entry between 12 PM and 2 PM.',
      xp:    50,
      check: ({ entries }) => entries.some(e => {
        if (!e.createdAt) return false;
        const h = new Date(e.createdAt).getHours();
        return h >= 12 && h < 14;
      }),
      progress: ({ entries }) => ({
        current: entries.some(e => { if (!e.createdAt) return false; const h = new Date(e.createdAt).getHours(); return h >= 12 && h < 14; }) ? 1 : 0,
        max: 1,
      }),
    },
    {
      id:    'night_owl',
      name:  'Night Owl',
      icon:  '🦉',
      desc:  'Log an entry after 10 PM.',
      xp:    75,
      check: ({ entries }) => entries.some(e => new Date(e.createdAt || e.date).getHours() >= 22),
      progress: ({ entries }) => ({
        current: entries.some(e => new Date(e.createdAt || e.date).getHours() >= 22) ? 1 : 0,
        max: 1,
      }),
    },
    {
      id:    'weekend_warrior',
      name:  'Weekend Warrior',
      icon:  '🎉',
      desc:  'Log entries on both Saturday and Sunday in the same week.',
      xp:    100,
      check: ({ entries }) => {
        const weeks = {};
        for (const e of entries) {
          const d = new Date(e.date + 'T12:00:00');
          const day = d.getDay();
          if (day === 0 || day === 6) {
            const mon = new Date(d);
            mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
            const key = mon.toISOString().slice(0, 10);
            if (!weeks[key]) weeks[key] = new Set();
            weeks[key].add(day);
          }
        }
        return Object.values(weeks).some(s => s.has(0) && s.has(6));
      },
      progress: ({ entries }) => {
        const weeks = {};
        for (const e of entries) {
          const d = new Date(e.date + 'T12:00:00');
          const day = d.getDay();
          if (day === 0 || day === 6) {
            const mon = new Date(d);
            mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
            const key = mon.toISOString().slice(0, 10);
            if (!weeks[key]) weeks[key] = new Set();
            weeks[key].add(day);
          }
        }
        const best = Object.values(weeks).reduce((n, s) => Math.max(n, s.size), 0);
        return { current: Math.min(best, 2), max: 2 };
      },
    },

    /* ---- Consistency & long-term -------------------- */
    {
      id:    'consistency_master',
      name:  'Consistency Master',
      icon:  '🏅',
      desc:  'Achieve 80%+ consistency for 30 days.',
      xp:    500,
      check: ({ consistency }) => consistency >= 80,
      progress: ({ consistency }) => ({ current: Math.min(consistency, 80), max: 80 }),
    },
    {
      id:    'weekly_perfect',
      name:  'Perfect Week',
      icon:  '✨',
      desc:  'Meet your daily goal every day for a full week.',
      xp:    400,
      check: ({ entries, goalForDate }) => {
        const m = _byDate(entries);
        const weeks = {};
        for (const [date, mins] of Object.entries(m)) {
          if (mins >= goalForDate(date)) {
            const d = new Date(date + 'T12:00:00');
            const day = d.getDay();
            const mon = new Date(d);
            mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
            const key = mon.toISOString().slice(0, 10);
            if (!weeks[key]) weeks[key] = new Set();
            weeks[key].add(date);
          }
        }
        return Object.values(weeks).some(s => s.size >= 7);
      },
      progress: ({ entries, goalForDate }) => {
        const m = _byDate(entries);
        const weeks = {};
        for (const [date, mins] of Object.entries(m)) {
          if (mins >= goalForDate(date)) {
            const d = new Date(date + 'T12:00:00');
            const day = d.getDay();
            const mon = new Date(d);
            mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
            const key = mon.toISOString().slice(0, 10);
            if (!weeks[key]) weeks[key] = new Set();
            weeks[key].add(date);
          }
        }
        const best = Object.values(weeks).reduce((n, s) => Math.max(n, s.size), 0);
        return { current: Math.min(best, 7), max: 7 };
      },
    },
    {
      id:    'monthly_dedication',
      name:  'Monthly Dedication',
      icon:  '📆',
      desc:  'Log learning on 20+ different days in a single month.',
      xp:    300,
      check: ({ entries }) => {
        const months = {};
        for (const e of entries) {
          const mo = e.date.slice(0, 7);
          if (!months[mo]) months[mo] = new Set();
          months[mo].add(e.date);
        }
        return Object.values(months).some(s => s.size >= 20);
      },
      progress: ({ entries }) => {
        const months = {};
        for (const e of entries) {
          const mo = e.date.slice(0, 7);
          if (!months[mo]) months[mo] = new Set();
          months[mo].add(e.date);
        }
        const best = Object.values(months).reduce((n, s) => Math.max(n, s.size), 0);
        return { current: Math.min(best, 20), max: 20 };
      },
    },
    {
      id:    'veteran',
      name:  'Veteran',
      icon:  '🎗️',
      desc:  'Keep learning across 90+ days (first to latest entry).',
      xp:    500,
      check: ({ entries }) => {
        if (entries.length < 2) return false;
        const dates = entries.map(e => e.date).sort();
        return _daysBetween(dates[0], dates[dates.length - 1]) >= 90;
      },
      progress: ({ entries }) => {
        if (entries.length < 2) return { current: 0, max: 90 };
        const dates = entries.map(e => e.date).sort();
        return { current: Math.min(_daysBetween(dates[0], dates[dates.length - 1]), 90), max: 90 };
      },
    },
  ];

  /* ---- XP Calculation -------------------------------- */

  function calculateEntryXP(entry) {
    const base    = (entry.durationMinutes || 0) * XP_PER_MINUTE;
    const diffMult= XP_DIFFICULTY_MULT[entry.difficulty] || 1;
    const moodMult= XP_MOOD_BONUS[entry.moodScore || 3] || 1;
    return Math.round(base * diffMult * moodMult);
  }

  // Returns the daily goal that was active on a given date, using recorded history.
  function _goalForDate(date, goalHistory, fallback) {
    if (!goalHistory || goalHistory.length === 0) return fallback;
    let best = null;
    for (const g of goalHistory) {
      if (g.from <= date && (!best || g.from > best.from)) best = g;
    }
    return best ? best.goalMin : fallback;
  }

  // XP bonus per day the daily goal is met: dayGoal × 0.5, using the goal active that day.
  function calculateDailyGoalXP(entries, dailyGoalMin, goalHistory) {
    if (!dailyGoalMin || dailyGoalMin <= 0) return 0;
    const byDate = {};
    for (const e of entries) {
      if (e.date) byDate[e.date] = (byDate[e.date] || 0) + (e.durationMinutes || 0);
    }
    let total = 0;
    for (const [date, mins] of Object.entries(byDate)) {
      const goal = _goalForDate(date, goalHistory, dailyGoalMin);
      if (mins >= goal) total += Math.round(goal * 0.5);
    }
    return total;
  }

  // Difficulty weights used when scoring daily medal eligibility.
  // Harder sessions earn more credit — easy work alone won't reach Silver/Gold.
  const MEDAL_DIFF_WEIGHT = { easy: 0.9, medium: 1.0, hard: 1.5 };

  // Medals use difficulty-weighted minutes vs the daily goal:
  //   Gold   — weighted score ≥ 3× daily goal
  //   Silver — weighted score ≥ 2× daily goal
  //   Bronze — weighted score ≥ 1.5× daily goal
  function calculateMedals(entries, dailyGoalMin, goalHistory) {
    const fallback = dailyGoalMin || 60;
    const byDate = {};
    for (const e of entries) {
      if (!e.date) continue;
      const w = MEDAL_DIFF_WEIGHT[e.difficulty] ?? 0.8;
      byDate[e.date] = (byDate[e.date] || 0) + (e.durationMinutes || 0) * w;
    }
    let gold = 0, silver = 0, bronze = 0;
    for (const [date, score] of Object.entries(byDate)) {
      const goal = _goalForDate(date, goalHistory, fallback);
      if      (score >= goal * 3)   gold++;
      else if (score >= goal * 2)   silver++;
      else if (score >= goal * 1.5) bronze++;
    }
    return { gold, silver, bronze };
  }

  function calculateTotalXP(entries, streak, dailyGoalMin, goalHistory) {
    let total = entries.reduce((sum, e) => sum + calculateEntryXP(e), 0);

    // Daily goal completion bonus
    total += calculateDailyGoalXP(entries, dailyGoalMin, goalHistory);

    // Streak bonus
    let streakBonus = 1;
    for (const [threshold, mult] of Object.entries(XP_STREAK_BONUS).reverse()) {
      if (streak.current >= parseInt(threshold)) { streakBonus = mult; break; }
    }
    total = Math.round(total * streakBonus);

    return total;
  }

  function getLevelInfo(totalXP) {
    let currentLevel = LEVELS[0];
    let nextLevel    = LEVELS[1];

    for (let i = LEVELS.length - 1; i >= 0; i--) {
      if (totalXP >= LEVELS[i].xpNeeded) {
        currentLevel = LEVELS[i];
        nextLevel    = LEVELS[i + 1] || null;
        break;
      }
    }

    const xpIntoLevel = totalXP - currentLevel.xpNeeded;
    const xpNeededForNext = nextLevel ? nextLevel.xpNeeded - currentLevel.xpNeeded : 0;
    const progressPct = nextLevel && xpNeededForNext > 0
      ? Math.min(100, Math.round((xpIntoLevel / xpNeededForNext) * 100))
      : 100;

    return {
      level:        currentLevel.level,
      title:        currentLevel.title,
      xpIntoLevel,
      xpNeededForNext,
      progressPct,
      nextLevel,
      totalXP,
    };
  }

  /* ---- Achievement Checking -------------------------- */

  async function checkAndAwardAchievements(entries, streak, stats, consistency, dailyGoalMin = 60, goalHistory = []) {
    const goalForDate = date => _goalForDate(date, goalHistory, dailyGoalMin);
    const context = { entries, streak, stats, consistency, dailyGoalMin, goalForDate };
    const newlyEarned = [];

    for (const ach of ACHIEVEMENTS) {
      const existing = await Storage.getAchievement(ach.id);
      if (existing) continue; // already earned

      if (ach.check(context)) {
        await Storage.saveAchievement({
          id:       ach.id,
          earnedAt: Date.now(),
        });
        newlyEarned.push(ach);
      }
    }

    return newlyEarned;
  }

  async function revokeStaleAchievements(entries, streak, stats, consistency, dailyGoalMin = 60, goalHistory = []) {
    const earned = await Storage.getAllAchievements();
    if (!earned.length) return;

    const goalForDate = date => _goalForDate(date, goalHistory, dailyGoalMin);
    const context = { entries, streak, stats, consistency, dailyGoalMin, goalForDate };

    for (const record of earned) {
      const achDef = ACHIEVEMENTS.find(a => a.id === record.id);
      if (!achDef) continue;
      if (!achDef.check(context)) {
        await Storage.remove(Storage.STORES.achievements, record.id);
      }
    }
  }

  /* ---- Build achievement display objects ------------- */

  async function buildAchievementList(entries, streak, stats, consistency, dailyGoalMin = 60, goalHistory = []) {
    const earned  = await Storage.getAllAchievements();
    const earnedIds = new Set(earned.map(a => a.id));
    const goalForDate = date => _goalForDate(date, goalHistory, dailyGoalMin);
    const context = { entries, streak, stats, consistency, dailyGoalMin, goalForDate };

    return ACHIEVEMENTS.map(ach => {
      const isEarned = earnedIds.has(ach.id);
      const prog = ach.progress(context);
      const current = isEarned ? prog.max : prog.current;
      return {
        ...ach,
        earned:          isEarned,
        earnedAt:        earned.find(a => a.id === ach.id)?.earnedAt || null,
        progressCurrent: current,
        progressMax:     prog.max,
        progressPct:     isEarned ? 100 : Math.round((prog.current / prog.max) * 100),
      };
    });
  }

  /* ---- Confetti / Celebration ----------------------- */

  function fireConfetti(type = 'achievement') {
    if (typeof confetti === 'undefined') return;

    if (type === 'achievement') {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#6c63ff', '#8b85ff', '#f59e0b', '#10b981', '#ec4899'],
      });
    } else if (type === 'levelup') {
      // Two bursts from sides
      confetti({ particleCount: 80, angle: 60, spread: 55, origin: { x: 0, y: 0.7 } });
      confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 1, y: 0.7 } });
    } else if (type === 'streak') {
      confetti({
        particleCount: 60,
        spread: 50,
        origin: { y: 0.7 },
        shapes: ['circle'],
        colors: ['#f59e0b', '#ef4444', '#ff6b35'],
      });
    }
  }

  /* ---- XP Float Animation ---------------------------- */

  function showXPFloat(amount, originEl) {
    const el = document.createElement('div');
    el.className = 'xp-float';
    el.textContent = `+${amount} XP`;

    if (originEl) {
      const rect = originEl.getBoundingClientRect();
      el.style.left = `${rect.left + rect.width / 2}px`;
      el.style.top  = `${rect.top}px`;
    } else {
      el.style.right  = '24px';
      el.style.bottom = '80px';
    }

    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  /* ---- Public API ------------------------------------ */
  return {
    ACHIEVEMENTS,
    LEVELS,
    calculateEntryXP,
    calculateDailyGoalXP,
    calculateMedals,
    calculateTotalXP,
    getLevelInfo,
    checkAndAwardAchievements,
    revokeStaleAchievements,
    buildAchievementList,
    fireConfetti,
    showXPFloat,
  };

})();
