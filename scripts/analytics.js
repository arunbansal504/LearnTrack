/* ===================================================
   LEARNTRACK — ANALYTICS ENGINE
   Streak tracking · Stats · Consistency · Learning curve
   =================================================== */

'use strict';

const Analytics = (() => {

  /* ---- Date Utilities (local timezone) --- */

  const _localFmt = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });

  // Returns "YYYY-MM-DD" in the user's local timezone
  function toDateStr(date) {
    const d = date instanceof Date ? date : new Date(date);
    return _localFmt.format(d);
  }

  function today() { return toDateStr(new Date()); }

  function daysBetween(dateStr1, dateStr2) {
    const d1 = new Date(dateStr1 + 'T12:00:00');
    const d2 = new Date(dateStr2 + 'T12:00:00');
    return Math.round(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
  }

  function daysAgo(n) {
    return toDateStr(new Date(Date.now() - n * 864e5));
  }

  function startOfWeek(dateStr) {
    const d   = new Date(dateStr + 'T12:00:00');
    const day = d.getDay();
    d.setTime(d.getTime() - day * 864e5);
    return toDateStr(d);
  }

  function formatDuration(minutes) {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  function formatHours(minutes) {
    return formatDuration(minutes);
  }

  /* ---- Build a date → entries map ------------------- */

  function buildDateMap(entries) {
    const map = {};
    for (const e of entries) {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    }
    return map;
  }

  /* ---- Streak Calculation ---------------------------- */

  function calculateStreaks(entries) {
    if (!entries.length) return { current: 0, longest: 0, activeDates: new Set() };

    const dateMap  = buildDateMap(entries);
    const dates    = Object.keys(dateMap).sort();
    const todayStr = today();
    const yestStr  = daysAgo(1);

    let currentStreak = 0;
    let longestStreak = 0;
    let streak        = 0;
    let prevDate      = null;

    // Sorted ascending
    for (const d of dates) {
      if (!prevDate) {
        streak = 1;
      } else {
        const diff = daysBetween(prevDate, d);
        streak = diff === 1 ? streak + 1 : 1;
      }
      longestStreak = Math.max(longestStreak, streak);
      prevDate = d;
    }

    // Current streak: from today or yesterday backwards
    const lastDate = dates[dates.length - 1];
    if (lastDate === todayStr || lastDate === yestStr) {
      let cursor = lastDate;
      let s = 0;
      while (dateMap[cursor]) {
        s++;
        const prev = new Date(cursor);
        prev.setDate(prev.getDate() - 1);
        cursor = toDateStr(prev);
      }
      currentStreak = s;
    }

    return {
      current: currentStreak,
      longest: longestStreak,
      activeDates: new Set(dates),
    };
  }

  /* ---- Total Stats ----------------------------------- */

  function calculateTotalStats(entries) {
    const totalMinutes = entries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
    const totalEntries = entries.length;

    // Unique active days
    const uniqueDays = new Set(entries.map(e => e.date)).size;

    const avgMinutesPerDay = uniqueDays > 0 ? Math.round(totalMinutes / uniqueDays) : 0;

    return {
      totalMinutes,
      totalHours: parseFloat((totalMinutes / 60).toFixed(1)),
      totalEntries,
      uniqueDays,
      avgMinutesPerDay,
    };
  }

  /* ---- Consistency Score (last 30 days) -------------- */

  function calculateConsistency(entries, days = 30) {
    const cutoff    = daysAgo(days);
    const recent    = entries.filter(e => e.date >= cutoff);
    const activeDays= new Set(recent.map(e => e.date)).size;
    const score     = Math.round((activeDays / days) * 100);
    return Math.min(score, 100);
  }

  /* ---- Weekly Summary -------------------------------- */

  function calculateWeeklySummary(entries) {
    const nowIST  = new Date(today() + 'T12:00:00');
    const dowIST  = nowIST.getDay() || 7; // 1=Mon..7=Sun (treat 0/Sun as 7)
    const mondayMs = nowIST.getTime() - (dowIST - 1) * 864e5;
    const thisMonday = toDateStr(new Date(mondayMs));
    const thisSunday = toDateStr(new Date(mondayMs + 6 * 864e5));

    const weekEntries = entries.filter(e => e.date >= thisMonday && e.date <= thisSunday);
    const totalMin    = weekEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0);

    // Daily breakdown (Mon - Sun)
    const days   = [];
    const labels = ['M','T','W','T','F','S','S'];
    for (let i = 0; i < 7; i++) {
      const ds = toDateStr(new Date(mondayMs + i * 864e5));
      const minutes = entries
        .filter(e => e.date === ds)
        .reduce((s, e) => s + (e.durationMinutes || 0), 0);
      days.push({ date: ds, label: labels[i], minutes, isToday: ds === today() });
    }

    return {
      from: thisMonday,
      to: thisSunday,
      totalMinutes: totalMin,
      totalHours: parseFloat((totalMin / 60).toFixed(1)),
      entries: weekEntries.length,
      days,
    };
  }

  /* ---- Monthly Summary ------------------------------- */

  function calculateMonthlySummary(entries) {
    // Derive year/month in IST from today's IST date string
    const todayIST = today();
    const year     = parseInt(todayIST.slice(0, 4), 10);
    const month    = parseInt(todayIST.slice(5, 7), 10) - 1; // 0-based
    const mm       = String(month + 1).padStart(2, '0');
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const from = `${year}-${mm}-01`;
    const to   = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`;

    const monthEntries = entries.filter(e => e.date >= from && e.date <= to);
    const totalMin     = monthEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0);

    return {
      from, to,
      totalMinutes: totalMin,
      totalHours: parseFloat((totalMin / 60).toFixed(1)),
      entries: monthEntries.length,
      daysInMonth,
    };
  }

  /* ---- Monthly Totals (for bar chart) ---------------- */

  function calculateMonthlyTotals(entries, months = 12) {
    const result  = [];
    const todayIST = today();
    const baseYear  = parseInt(todayIST.slice(0, 4), 10);
    const baseMonth = parseInt(todayIST.slice(5, 7), 10) - 1; // 0-based

    for (let i = months - 1; i >= 0; i--) {
      // Derive target year/month without relying on browser timezone
      let year  = baseYear;
      let month = baseMonth - i;
      while (month < 0)  { month += 12; year--; }
      while (month > 11) { month -= 12; year++; }

      const mm          = String(month + 1).padStart(2, '0');
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const from        = `${year}-${mm}-01`;
      const to          = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`;

      const monthEntries = entries.filter(e => e.date >= from && e.date <= to);
      const totalMin     = monthEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
      const label        = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

      result.push({ label, minutes: totalMin, hours: parseFloat((totalMin / 60).toFixed(1)) });
    }

    return result;
  }

  /* ---- Daily Time Series (for line chart) ------------ */

  function calculateDailyTimeSeries(entries, days = 30) {
    const result   = [];
    const nowMs    = Date.now();
    const labelFmt = new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric',
    });

    for (let i = days - 1; i >= 0; i--) {
      const ts  = nowMs - i * 864e5;
      const ds  = toDateStr(new Date(ts));
      const min = entries
        .filter(e => e.date === ds)
        .reduce((s, e) => s + (e.durationMinutes || 0), 0);

      result.push({
        date:    ds,
        label:   labelFmt.format(new Date(ts)),
        minutes: min,
        hours:   parseFloat((min / 60).toFixed(2)),
      });
    }

    return result;
  }

  /* ---- Topic Distribution ---------------------------- */

  function calculateTopicDistribution(entries, knownCategories) {
    const catSet = knownCategories ? new Set(knownCategories) : null;
    const map = {};
    for (const e of entries) {
      const raw = e.category || e.topic || '';
      const key = catSet ? (catSet.has(raw) ? raw : 'Uncategorized') : (raw || 'Uncategorized');
      map[key] = (map[key] || 0) + (e.durationMinutes || 0);
    }
    return Object.entries(map)
      .map(([label, minutes]) => ({ label, minutes, hours: parseFloat((minutes / 60).toFixed(1)) }))
      .sort((a, b) => b.minutes - a.minutes);
  }

  /* ---- Heatmap Data (last 52 weeks) ------------------ */

  function calculateHeatmapData(entries) {
    const dateMap  = buildDateMap(entries);
    const cells    = [];
    const todayStr = today();
    const nowMs    = Date.now();

    const istDow      = new Date(todayStr + 'T12:00:00').getDay(); // 0=Sun
    const startMs     = nowMs - (istDow + 52 * 7) * 864e5;
    const startStr    = toDateStr(new Date(startMs));

    const maxMinutes = Math.max(1, ...Object.values(dateMap).map(arr =>
      arr.reduce((s, e) => s + (e.durationMinutes || 0), 0)
    ));

    let dCursor = startStr;
    while (dCursor <= todayStr) {
      const dayEntries = dateMap[dCursor] || [];
      const minutes    = dayEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
      const level      = minutes === 0 ? 0
                       : minutes < maxMinutes * 0.25 ? 1
                       : minutes < maxMinutes * 0.5  ? 2
                       : minutes < maxMinutes * 0.75 ? 3
                       : 4;
      const weekday    = new Date(dCursor + 'T12:00:00').getDay();

      cells.push({ date: dCursor, minutes, level, weekday, label: `${dCursor}: ${formatDuration(minutes)}` });
      dCursor = toDateStr(new Date(new Date(dCursor + 'T12:00:00').getTime() + 864e5));
    }

    return cells;
  }

  /* ---- Learning Curve Algorithm ---------------------- */

  function calculateLearningCurve(entries) {
    if (entries.length < 2) return { points: [], momentum: 'start', plateau: false, burnout: false };

    const sorted  = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
    const dateMap = buildDateMap(sorted);
    const difficultyWeight = { beginner: 1, intermediate: 1.5, advanced: 2.2, expert: 3 };

    // Build a continuous daily series from first entry to today (capped at 365 days).
    // Use UTC-based string comparison (matching toDateStr / today()) to avoid local-midnight
    // vs UTC-midnight mismatch that drops today in timezones ahead of UTC.
    const todayStr = today();
    const allDates = [];
    let dCursor = sorted[0].date;
    while (dCursor <= todayStr) {
      allDates.push(dCursor);
      dCursor = toDateStr(new Date(new Date(dCursor + 'T12:00:00').getTime() + 864e5));
    }
    const cappedDates = allDates.length > 365 ? allDates.slice(-365) : allDates;

    const points = [];

    for (let i = 0; i < cappedDates.length; i++) {
      const d = cappedDates[i];

      // 7-day rolling window: score + active-day count
      let windowScore    = 0;
      let activeDaysInWindow = 0;

      for (let j = Math.max(0, i - 6); j <= i; j++) {
        const dd         = cappedDates[j];
        const dayEntries = dateMap[dd] || [];
        if (dayEntries.length > 0) activeDaysInWindow++;
        const dayScore   = dayEntries.reduce((s, e) => {
          const dw   = difficultyWeight[e.difficulty] || 1;
          const mood = (e.moodScore || 3) / 5;
          return s + (e.durationMinutes || 0) * dw * (0.5 + mood * 0.5);
        }, 0);
        windowScore += dayScore;
      }

      const avgDayScore = windowScore / 7;
      const streakBonus = activeDaysInWindow >= 5 ? 1.2 : activeDaysInWindow >= 3 ? 1.1 : 1;
      const curveValue  = parseFloat((avgDayScore * streakBonus / 10).toFixed(2));

      points.push({ date: d, value: curveValue, activeDaysInWindow });
    }

    // Momentum: compare avg of last 7 calendar days vs previous 7
    const momentum = (() => {
      if (points.length < 14) return points.some(p => p.value > 0) ? 'rising' : 'start';
      const last7 = points.slice(-7).reduce((s, p) => s + p.value, 0) / 7;
      const prev7 = points.slice(-14, -7).reduce((s, p) => s + p.value, 0) / 7;
      if (last7 > prev7 * 1.1) return 'rising';
      if (last7 < prev7 * 0.85) return 'dropping';
      return 'stable';
    })();

    // Plateau: last 14 calendar days variance < threshold
    const plateau = (() => {
      if (points.length < 14) return false;
      const vals     = points.slice(-14).map(p => p.value);
      const avg      = vals.reduce((s, v) => s + v, 0) / vals.length;
      if (avg === 0) return false;
      const variance = vals.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / vals.length;
      const stdDev   = Math.sqrt(variance);
      return stdDev / avg < 0.08; // < 8% coefficient of variation
    })();

    // Burnout: last 7 days dropped >40% vs previous 7 days
    const burnout = (() => {
      if (points.length < 14) return false;
      const last7 = points.slice(-7).reduce((s, p) => s + p.value, 0) / 7;
      const prev7 = points.slice(-14, -7).reduce((s, p) => s + p.value, 0) / 7;
      return prev7 > 0 && last7 < prev7 * 0.6;
    })();

    return { points, momentum, plateau, burnout };
  }

  /* ---- Best Learning Day ----------------------------- */

  function bestLearningDay(entries) {
    const dayTotals = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };
    const dayCounts = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };
    const dayNames  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    for (const e of entries) {
      const day = new Date(e.date).getDay();
      dayTotals[day] += (e.durationMinutes || 0);
      dayCounts[day]++;
    }

    let bestDay = 1, bestAvg = 0;
    for (let i = 0; i < 7; i++) {
      const avg = dayCounts[i] > 0 ? dayTotals[i] / dayCounts[i] : 0;
      if (avg > bestAvg) { bestAvg = avg; bestDay = i; }
    }

    return dayNames[bestDay];
  }

  /* ---- Missed Days (last 30) ------------------------- */

  function missedDays(entries, days = 30) {
    const window     = days - 1; // exclude today; check yesterday back (days-1) complete days
    const cutoff     = daysAgo(window);
    const activeDays = new Set(entries.filter(e => e.date >= cutoff).map(e => e.date));
    let missed = 0;
    for (let i = 1; i <= window; i++) {
      if (!activeDays.has(daysAgo(i))) missed++;
    }
    return { missed, window };
  }

  /* ---- Public API ------------------------------------ */
  return {
    // Helpers
    toDateStr,
    today,
    daysAgo,
    daysBetween,
    formatDuration,
    formatHours,
    buildDateMap,
    // Core calculations
    calculateStreaks,
    calculateTotalStats,
    calculateConsistency,
    calculateWeeklySummary,
    calculateMonthlySummary,
    calculateMonthlyTotals,
    calculateDailyTimeSeries,
    calculateTopicDistribution,
    calculateHeatmapData,
    calculateLearningCurve,
    bestLearningDay,
    missedDays,
  };

})();
