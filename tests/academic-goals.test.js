/**
 * Academic Goals — Test Suite
 *
 * Coverage: Positive · Negative · Edge Cases · Boundary Value Analysis (BVA)
 * Goal types under test: time | checklist | count | exam
 *
 * How to run (requires Node ≥ 18 + Jest):
 *   npm init -y && npm i -D jest && npx jest tests/academic-goals.test.js
 *
 * The suite tests:
 *   A. Analytics.goalProgress()  — pure function, no DOM needed
 *   B. Goal validation rules     — mirrors saveGoal() guard logic
 *   C. Goal status derivation    — mirrors _goalStatusOf() logic
 *   D. Goal sort / filter logic  — mirrors renderGoals() ordering
 *   E. Milestone operations      — checklist-specific
 *   F. Achievement unlock checks — mirrors rewards.js check() predicates
 *   G. Count goal operations     — increment / decrement logic
 */

// ---------------------------------------------------------------------------
// Helpers — replicate the pure logic from the app without loading the app
// ---------------------------------------------------------------------------

/** Formats duration minutes to "Xh Ym" string (mirrors app helper) */
function formatDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Days between today and a YYYY-MM-DD target (negative = past) */
function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}

/**
 * Analytics.goalProgress — replicates app logic exactly
 * @param {Object} goal
 * @param {Array}  entries
 * @returns {{ pct: number, label: string, current: number, target: number }}
 *
 * IMPORTANT — time goals: the real app only filters by startDate (lower bound).
 * There is NO upper-bound filter on targetDate for time goals.
 *
 * IMPORTANT — count goals: the real app uses `|| 0` (not `?? 0`), but the
 * observable difference only matters for `false`/`null`/`''` which never
 * occur in practice; results are identical for numeric or undefined inputs.
 *
 * IMPORTANT — checklist goals: real app uses `milestones.length || 1` as
 * the divisor to avoid division-by-zero, so the internal target field is 1
 * when milestones is empty, but the label still prints the raw array length.
 *
 * IMPORTANT — exam goals: the real app does NOT short-circuit on
 * `status === 'completed'` for the label — pct is 100 for completed but the
 * label is still derived from daysUntil(). The 'Completed' label does not
 * exist in the real app; a completed exam with a past deadline shows
 * 'Deadline passed'. The singular/plural rule is: `day${days===1?'':'s'}`.
 */
function goalProgress(goal, entries) {
  const startDate = goal.startDate || '0000-01-01';

  if (goal.type === 'time') {
    // Real app only applies a lower-bound on startDate; no upper-bound on targetDate.
    const relevant = entries.filter(e => {
      if (e.date < startDate) return false;
      if (goal.category && goal.category !== '' && e.category !== goal.category) return false;
      return true;
    });
    const currentMins = relevant.reduce((s, e) => s + e.durationMinutes, 0);
    const target = goal.targetMinutes || 1;
    const pct = Math.min(100, Math.round((currentMins / target) * 100));
    return {
      pct,
      current: currentMins,
      target,
      label:   `${formatDuration(currentMins)} / ${formatDuration(target)}`,
    };
  }

  if (goal.type === 'count') {
    const current = goal.currentCount || 0;
    const target  = goal.targetCount  || 1;
    const pct = Math.min(100, Math.round((current / target) * 100));
    // Real app: `${current} / ${target} ${goal.unit || ''}`.trim()
    const label = `${current} / ${target}${goal.unit ? ' ' + goal.unit : ''}`;
    return { pct, current, target, label };
  }

  if (goal.type === 'checklist') {
    const milestones = goal.milestones || [];
    const done  = milestones.filter(m => m.done).length;
    const total = milestones.length;
    // Real app uses `total || 1` to avoid division-by-zero; pct guard handles empty.
    const divisor = total || 1;
    const pct = total === 0 ? 0 : Math.min(100, Math.round((done / divisor) * 100));
    return {
      pct,
      current: done,
      target:  total,
      label:   `${done} / ${total} tasks`,
    };
  }

  if (goal.type === 'exam') {
    // Real app does NOT short-circuit on status==='completed' for the label.
    // pct is 100 only when completed, but label is always derived from daysUntil.
    const pct  = goal.status === 'completed' ? 100 : 0;
    if (!goal.targetDate) {
      return { pct, current: 0, target: 0, label: 'No deadline set' };
    }
    const days = daysUntil(goal.targetDate);
    const label = days < 0    ? 'Deadline passed'
                : days === 0  ? 'Today!'
                :               `${days} day${days === 1 ? '' : 's'} left`;
    return { pct, current: Math.max(0, days), target: null, label };
  }

  return { pct: 0, current: 0, target: 0, label: '' };
}

/**
 * Validation — mirrors saveGoal() guards in saveGoalFromModal()
 * @returns {string|null} error message, or null if valid
 *
 * WHAT THE REAL APP ACTUALLY VALIDATES IN JS (saveGoalFromModal):
 *   1. title empty (after trim) → 'Please enter a goal title.'
 *   2. type === 'time' && (!hrs || hrs <= 0) → 'Please enter a target number of hours.'
 *   3. type === 'count' && (!cnt || cnt <= 0) → 'Please enter a target count.'
 *   4. type === 'checklist' && rows.length === 0 → 'Please add at least one milestone.'
 *
 * Constraints enforced ONLY by HTML attributes (NOT by JS):
 *   - title maxlength="120"
 *   - description maxlength="500"
 *   - goal-target-hours min="0.5" max="10000"
 *   - goal-target-count min="1" max="100000"
 *   - goal-count-unit maxlength="40"
 *   - goal type comes from a <select> — no JS validation for invalid strings
 *   - milestone label maxlength="120"; empty labels are SILENTLY filtered (.filter(m=>m.label))
 */
function validateGoal(form) {
  if (!form.title || !form.title.trim())    return 'Please enter a goal title.';
  if (!form.type)                           return 'Please select a goal type.';
  if (form.type === 'time') {
    if (!form.targetHours || form.targetHours <= 0)
      return 'Please enter a target number of hours.';
  }
  if (form.type === 'count') {
    if (!form.targetCount || form.targetCount <= 0)
      return 'Please enter a target count.';
  }
  if (form.type === 'checklist') {
    if (!form.milestones || form.milestones.length === 0)
      return 'Please add at least one milestone.';
  }
  return null;
}

/**
 * Goal status derivation — mirrors _goalStatusOf()
 */
function goalStatusOf(goal, today = '2026-06-03') {
  if (goal.status === 'archived')   return 'archived';
  if (goal.status === 'completed')  return 'completed';
  if (goal.targetDate && goal.targetDate < today) return 'overdue';
  return 'active';
}

/**
 * Goal sort comparator — mirrors renderGoals() sort
 */
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
function sortGoals(goals) {
  return [...goals].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 1;
    const pb = PRIORITY_ORDER[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate);
    if (a.targetDate) return -1;
    if (b.targetDate) return 1;
    return b.createdAt - a.createdAt;
  });
}

/**
 * Achievement checks — mirrors rewards.js check() predicates
 */
const ACHIEVEMENTS = {
  goalSetter:         goals => goals.length >= 1,
  missionAccomplished:goals => goals.some(g => g.status === 'completed'),
  finisher:           goals => goals.filter(g => g.status === 'completed').length >= 5,
  beatTheClock:       goals => goals.some(g =>
    g.status === 'completed' &&
    g.targetDate &&
    g.completedAt &&
    new Date(g.targetDate + 'T23:59:59').getTime() > g.completedAt
  ),
};

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeEntry(overrides = {}) {
  return {
    id: `entry-${Date.now()}`,
    date: '2026-05-15',
    topic: 'Test Topic',
    category: 'Math',
    durationMinutes: 60,
    difficulty: 'medium',
    moodScore: 3,
    notes: '',
    resources: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeGoal(overrides = {}) {
  return {
    id: `goal-${Date.now()}`,
    title: 'Finish Calculus',
    type: 'time',
    category: 'Math',
    priority: 'medium',
    startDate: '2026-01-01',
    targetDate: '2026-12-31',
    description: '',
    status: 'active',
    targetMinutes: 3000,
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: null,
    ...overrides,
  };
}

// ===========================================================================
// A. Analytics.goalProgress()
// ===========================================================================

describe('A. Analytics.goalProgress()', () => {

  // ── A1 Time Goals ──────────────────────────────────────────────────────

  describe('A1 – Time Goals', () => {

    test('[POS] counts minutes from entries matching category and date range', () => {
      const goal = makeGoal({ targetMinutes: 120, category: 'Math', startDate: '2026-05-01', targetDate: '2026-05-31' });
      const entries = [
        makeEntry({ date: '2026-05-10', category: 'Math', durationMinutes: 60 }),
        makeEntry({ date: '2026-05-20', category: 'Math', durationMinutes: 60 }),
      ];
      const result = goalProgress(goal, entries);
      expect(result.pct).toBe(100);
      expect(result.current).toBe(120);
      expect(result.label).toBe('2h / 2h');
    });

    test('[POS] time goal with no category matches all categories', () => {
      const goal = makeGoal({ targetMinutes: 60, category: '', startDate: '2026-01-01', targetDate: null });
      const entries = [
        makeEntry({ date: '2026-05-10', category: 'Math',    durationMinutes: 30 }),
        makeEntry({ date: '2026-05-11', category: 'Science', durationMinutes: 30 }),
      ];
      const { pct } = goalProgress(goal, entries);
      expect(pct).toBe(100);
    });

    test('[POS] partial progress returns correct percentage', () => {
      const goal = makeGoal({ targetMinutes: 120, startDate: '2026-01-01' });
      const entries = [makeEntry({ category: 'Math', durationMinutes: 60 })];
      expect(goalProgress(goal, entries).pct).toBe(50);
    });

    test('[POS] pct is capped at 100 when current exceeds target', () => {
      const goal = makeGoal({ targetMinutes: 30 });
      const entries = [makeEntry({ category: 'Math', durationMinutes: 200 })];
      expect(goalProgress(goal, entries).pct).toBe(100);
    });

    test('[POS] entry on startDate is included', () => {
      const goal = makeGoal({ targetMinutes: 60, startDate: '2026-05-15' });
      const entries = [makeEntry({ date: '2026-05-15', category: 'Math', durationMinutes: 60 })];
      expect(goalProgress(goal, entries).pct).toBe(100);
    });

    test('[POS] entry on targetDate is included (no upper-bound filter in real app)', () => {
      // Real app has no upper-bound date filter; entries on/after targetDate are counted.
      const goal = makeGoal({ targetMinutes: 60, targetDate: '2026-05-15' });
      const entries = [makeEntry({ date: '2026-05-15', category: 'Math', durationMinutes: 60 })];
      expect(goalProgress(goal, entries).pct).toBe(100);
    });

    test('[NEG] entries before startDate are excluded', () => {
      const goal = makeGoal({ targetMinutes: 60, startDate: '2026-05-10' });
      const entries = [makeEntry({ date: '2026-05-09', category: 'Math', durationMinutes: 60 })];
      expect(goalProgress(goal, entries).pct).toBe(0);
    });

    test('[NEG] entries after targetDate are NOT excluded (real app has no upper-bound filter)', () => {
      // FIX: The real app's goalProgress() for time goals only applies a lower-bound
      // filter on startDate. It does NOT exclude entries that fall after targetDate.
      // Entries after the targetDate are still counted toward the goal's progress.
      const goal = makeGoal({ targetMinutes: 60, startDate: '2026-01-01', targetDate: '2026-04-30' });
      const entries = [makeEntry({ date: '2026-05-01', category: 'Math', durationMinutes: 60 })];
      expect(goalProgress(goal, entries).pct).toBe(100); // entry IS counted
    });

    test('[NEG] entries in wrong category are excluded', () => {
      const goal = makeGoal({ targetMinutes: 60, category: 'Math' });
      const entries = [makeEntry({ category: 'Science', durationMinutes: 60 })];
      expect(goalProgress(goal, entries).pct).toBe(0);
    });

    test('[EDGE] zero entries gives 0% progress', () => {
      const goal = makeGoal({ targetMinutes: 60 });
      expect(goalProgress(goal, []).pct).toBe(0);
    });

    test('[BVA] single minute entry against 1-minute target → 100%', () => {
      const goal = makeGoal({ targetMinutes: 1, category: '' });
      const entries = [makeEntry({ category: 'Any', durationMinutes: 1 })];
      expect(goalProgress(goal, entries).pct).toBe(100);
    });

    test('[BVA] 29 min logged against 30 min target → 97% (rounds down)', () => {
      const goal = makeGoal({ targetMinutes: 30, category: '' });
      const entries = [makeEntry({ category: 'Any', durationMinutes: 29 })];
      expect(goalProgress(goal, entries).pct).toBe(97);
    });
  });

  // ── A2 Count Goals ──────────────────────────────────────────────────────

  describe('A2 – Count Goals', () => {

    test('[POS] correct percentage and label for count goal', () => {
      const goal = makeGoal({ type: 'count', targetCount: 10, currentCount: 5, unit: 'problems' });
      const result = goalProgress(goal, []);
      expect(result.pct).toBe(50);
      expect(result.label).toBe('5 / 10 problems');
    });

    test('[POS] count goal with no unit omits unit in label', () => {
      const goal = makeGoal({ type: 'count', targetCount: 10, currentCount: 4, unit: '' });
      expect(goalProgress(goal, []).label).toBe('4 / 10');
    });

    test('[POS] completed count (current === target) → 100%', () => {
      const goal = makeGoal({ type: 'count', targetCount: 50, currentCount: 50 });
      expect(goalProgress(goal, []).pct).toBe(100);
    });

    test('[POS] count goal ignores logged entries', () => {
      const goal = makeGoal({ type: 'count', targetCount: 10, currentCount: 3 });
      const entries = [makeEntry({ durationMinutes: 999 })];
      expect(goalProgress(goal, entries).pct).toBe(30);
    });

    test('[NEG] currentCount undefined treated as 0', () => {
      const goal = makeGoal({ type: 'count', targetCount: 10 });
      delete goal.currentCount;
      expect(goalProgress(goal, []).pct).toBe(0);
    });

    test('[EDGE] count goal over-exceeded caps at 100%', () => {
      const goal = makeGoal({ type: 'count', targetCount: 5, currentCount: 999 });
      expect(goalProgress(goal, []).pct).toBe(100);
    });

    test('[BVA] currentCount = 0 → 0%', () => {
      const goal = makeGoal({ type: 'count', targetCount: 100, currentCount: 0 });
      expect(goalProgress(goal, []).pct).toBe(0);
    });

    test('[BVA] currentCount = 1 with targetCount 100 → 1%', () => {
      const goal = makeGoal({ type: 'count', targetCount: 100, currentCount: 1 });
      expect(goalProgress(goal, []).pct).toBe(1);
    });

    test('[BVA] currentCount = 99 with targetCount 100 → 99%', () => {
      const goal = makeGoal({ type: 'count', targetCount: 100, currentCount: 99 });
      expect(goalProgress(goal, []).pct).toBe(99);
    });

    test('[BVA] maximum targetCount 100000 with currentCount 50000 → 50%', () => {
      const goal = makeGoal({ type: 'count', targetCount: 100000, currentCount: 50000 });
      expect(goalProgress(goal, []).pct).toBe(50);
    });
  });

  // ── A3 Checklist Goals ──────────────────────────────────────────────────

  describe('A3 – Checklist Goals', () => {

    test('[POS] half milestones done → 50%', () => {
      const goal = makeGoal({
        type: 'checklist',
        milestones: [
          { id: 'm1', label: 'Task 1', done: true },
          { id: 'm2', label: 'Task 2', done: false },
        ],
      });
      const result = goalProgress(goal, []);
      expect(result.pct).toBe(50);
      expect(result.label).toBe('1 / 2 tasks');
    });

    test('[POS] all milestones done → 100%', () => {
      const goal = makeGoal({
        type: 'checklist',
        milestones: [
          { id: 'm1', label: 'A', done: true },
          { id: 'm2', label: 'B', done: true },
          { id: 'm3', label: 'C', done: true },
        ],
      });
      expect(goalProgress(goal, []).pct).toBe(100);
    });

    test('[POS] none done → 0%', () => {
      const goal = makeGoal({
        type: 'checklist',
        milestones: [
          { id: 'm1', label: 'A', done: false },
          { id: 'm2', label: 'B', done: false },
        ],
      });
      expect(goalProgress(goal, []).pct).toBe(0);
    });

    test('[EDGE] empty milestones array → 0% with correct label', () => {
      // FIX: Real app uses `milestones.length || 1` as divisor to avoid div-by-zero,
      // but the label still renders the raw array length (0). So label = '0 / 0 tasks'
      // is what the label string builds, even though internal target divisor is 1.
      const goal = makeGoal({ type: 'checklist', milestones: [] });
      const result = goalProgress(goal, []);
      expect(result.pct).toBe(0);
      expect(result.label).toBe('0 / 0 tasks');
    });

    test('[EDGE] milestones field missing → treated as empty', () => {
      const goal = makeGoal({ type: 'checklist' });
      delete goal.milestones;
      expect(goalProgress(goal, []).pct).toBe(0);
    });

    test('[BVA] single milestone, not done → 0%', () => {
      const goal = makeGoal({ type: 'checklist', milestones: [{ id: 'm1', label: 'X', done: false }] });
      expect(goalProgress(goal, []).pct).toBe(0);
    });

    test('[BVA] single milestone, done → 100%', () => {
      const goal = makeGoal({ type: 'checklist', milestones: [{ id: 'm1', label: 'X', done: true }] });
      expect(goalProgress(goal, []).pct).toBe(100);
    });

    test('[BVA] 1 of 3 done → 33%', () => {
      const goal = makeGoal({
        type: 'checklist',
        milestones: [
          { id: 'm1', label: 'A', done: true  },
          { id: 'm2', label: 'B', done: false },
          { id: 'm3', label: 'C', done: false },
        ],
      });
      expect(goalProgress(goal, []).pct).toBe(33);
    });
  });

  // ── A4 Exam Goals ───────────────────────────────────────────────────────

  describe('A4 – Exam Goals', () => {

    test('[POS] active exam with future date shows days-left label', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const dateStr = futureDate.toISOString().slice(0, 10);
      const goal = makeGoal({ type: 'exam', targetDate: dateStr, status: 'active' });
      const result = goalProgress(goal, []);
      expect(result.label).toBe('10 days left');
      expect(result.pct).toBe(0);
    });

    test('[POS] completed exam → 100% pct; label reflects days (no "Completed" short-circuit)', () => {
      // FIX: The real app does NOT have a 'Completed' label short-circuit for exam goals.
      // pct IS 100 when status==='completed', but the label is still derived from
      // daysUntil(targetDate). A past targetDate yields 'Deadline passed'.
      const goal = makeGoal({ type: 'exam', status: 'completed', targetDate: '2026-01-01' });
      const result = goalProgress(goal, []);
      expect(result.pct).toBe(100);
      expect(result.label).toBe('Deadline passed');
    });

    test('[POS] exam with no targetDate shows "No deadline set"', () => {
      const goal = makeGoal({ type: 'exam', targetDate: null, status: 'active' });
      expect(goalProgress(goal, []).label).toBe('No deadline set');
    });

    test('[EDGE] exam targetDate is today → "Today!" label', () => {
      const today = new Date().toISOString().slice(0, 10);
      const goal = makeGoal({ type: 'exam', targetDate: today, status: 'active' });
      expect(goalProgress(goal, []).label).toBe('Today!');
    });

    test('[EDGE] exam targetDate is yesterday → "Deadline passed"', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().slice(0, 10);
      const goal = makeGoal({ type: 'exam', targetDate: dateStr, status: 'active' });
      expect(goalProgress(goal, []).label).toBe('Deadline passed');
    });

    test('[BVA] exam 1 day away → "1 day left" (singular)', () => {
      // FIX: Real app uses `day${days === 1 ? '' : 's'}` — singular for exactly 1 day.
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const goal = makeGoal({ type: 'exam', targetDate: tomorrow.toISOString().slice(0, 10), status: 'active' });
      expect(goalProgress(goal, []).label).toBe('1 day left');
    });
  });
});

// ===========================================================================
// B. Goal Validation
// ===========================================================================

describe('B. Goal Validation', () => {

  // ── B1 Title ─────────────────────────────────────────────────────────────

  describe('B1 – Title', () => {
    test('[POS] valid title passes', () => {
      expect(validateGoal({ title: 'Finish Algebra', type: 'exam' })).toBeNull();
    });

    test('[NEG] empty title is rejected', () => {
      expect(validateGoal({ title: '', type: 'exam' })).toMatch(/title/i);
    });

    test('[NEG] whitespace-only title is rejected', () => {
      expect(validateGoal({ title: '   ', type: 'exam' })).toMatch(/title/i);
    });

    test('[BVA] title with exactly 1 character passes', () => {
      expect(validateGoal({ title: 'A', type: 'exam' })).toBeNull();
    });

    test('[BVA] title with exactly 120 characters passes', () => {
      // maxlength="120" is enforced by HTML; JS only checks empty. Both pass here.
      expect(validateGoal({ title: 'A'.repeat(120), type: 'exam' })).toBeNull();
    });

    test('[BVA] title with 121 characters — JS does NOT reject (HTML maxlength only)', () => {
      // FIX: Real app has no JS length check on title. maxlength="120" is a browser
      // attribute that prevents typing >120 chars; a programmatic form submission with
      // 121 chars would slip through JS validation and be accepted.
      expect(validateGoal({ title: 'A'.repeat(121), type: 'exam' })).toBeNull();
    });
  });

  // ── B2 Goal Type ────────────────────────────────────────────────────────

  describe('B2 – Goal Type', () => {
    test('[POS] all four valid types pass', () => {
      for (const type of ['time', 'checklist', 'count', 'exam']) {
        const form = type === 'time'      ? { title: 'G', type, targetHours: 10 }
                   : type === 'count'     ? { title: 'G', type, targetCount: 5 }
                   : type === 'checklist' ? { title: 'G', type, milestones: [{ label: 'M', done: false }] }
                   :                        { title: 'G', type };
        expect(validateGoal(form)).toBeNull();
      }
    });

    test('[NEG] missing type is rejected', () => {
      expect(validateGoal({ title: 'G' })).toMatch(/type/i);
    });

    test('[NEG] invalid type string — JS does NOT reject (type comes from a <select>)', () => {
      // FIX: Real app gets type from a <select> element; no JS check for invalid type
      // strings. An unknown type simply falls through all type branches and returns null.
      expect(validateGoal({ title: 'G', type: 'sprint' })).toBeNull();
    });
  });

  // ── B3 Time Target Hours ─────────────────────────────────────────────────

  describe('B3 – Time Target Hours', () => {
    test('[NEG] missing hours is rejected', () => {
      expect(validateGoal({ title: 'G', type: 'time' })).toMatch(/hours/i);
    });

    test('[NEG] 0 hours is rejected', () => {
      expect(validateGoal({ title: 'G', type: 'time', targetHours: 0 })).toMatch(/hours/i);
    });

    test('[NEG] negative hours is rejected', () => {
      expect(validateGoal({ title: 'G', type: 'time', targetHours: -1 })).toMatch(/hours/i);
    });

    test('[BVA] 0.4 hours — JS does NOT reject (min="0.5" is HTML-only; 0.4 > 0)', () => {
      // FIX: Real app only checks `!hrs || hrs <= 0`. 0.4 > 0 so it passes JS validation.
      // The min="0.5" constraint is enforced by the browser input, not by JS.
      expect(validateGoal({ title: 'G', type: 'time', targetHours: 0.4 })).toBeNull();
    });

    test('[BVA] 0.5 hours passes', () => {
      expect(validateGoal({ title: 'G', type: 'time', targetHours: 0.5 })).toBeNull();
    });

    test('[BVA] 0.6 hours passes', () => {
      expect(validateGoal({ title: 'G', type: 'time', targetHours: 0.6 })).toBeNull();
    });

    test('[BVA] 10000 hours passes', () => {
      expect(validateGoal({ title: 'G', type: 'time', targetHours: 10000 })).toBeNull();
    });

    test('[BVA] 10001 hours — JS does NOT reject (max="10000" is HTML-only)', () => {
      // FIX: Real app only checks `!hrs || hrs <= 0`. 10001 > 0 so it passes JS validation.
      // The max="10000" constraint is enforced by the browser input, not by JS.
      expect(validateGoal({ title: 'G', type: 'time', targetHours: 10001 })).toBeNull();
    });
  });

  // ── B4 Count Target ─────────────────────────────────────────────────────

  describe('B4 – Count Target', () => {
    test('[NEG] missing count is rejected', () => {
      expect(validateGoal({ title: 'G', type: 'count' })).toMatch(/count/i);
    });

    test('[NEG] 0 count is rejected', () => {
      expect(validateGoal({ title: 'G', type: 'count', targetCount: 0 })).toMatch(/count/i);
    });

    test('[NEG] negative count is rejected', () => {
      expect(validateGoal({ title: 'G', type: 'count', targetCount: -5 })).toMatch(/count/i);
    });

    test('[BVA] targetCount = 1 passes', () => {
      expect(validateGoal({ title: 'G', type: 'count', targetCount: 1 })).toBeNull();
    });

    test('[BVA] targetCount = 2 passes', () => {
      expect(validateGoal({ title: 'G', type: 'count', targetCount: 2 })).toBeNull();
    });

    test('[BVA] targetCount = 100000 passes', () => {
      expect(validateGoal({ title: 'G', type: 'count', targetCount: 100000 })).toBeNull();
    });

    test('[BVA] targetCount = 100001 — JS does NOT reject (max="100000" is HTML-only)', () => {
      // FIX: Real app only checks `!cnt || cnt <= 0`. 100001 > 0 so JS validation passes.
      // The max="100000" constraint is enforced by the browser input, not by JS.
      expect(validateGoal({ title: 'G', type: 'count', targetCount: 100001 })).toBeNull();
    });

    test('[NEG] unit exceeding 40 chars — JS does NOT reject (maxlength="40" is HTML-only)', () => {
      // FIX: Real app has no JS check on unit length; maxlength="40" is a browser attribute.
      expect(validateGoal({ title: 'G', type: 'count', targetCount: 5, unit: 'x'.repeat(41) }))
        .toBeNull();
    });

    test('[BVA] unit with exactly 40 chars passes', () => {
      expect(validateGoal({ title: 'G', type: 'count', targetCount: 5, unit: 'x'.repeat(40) })).toBeNull();
    });
  });

  // ── B5 Checklist Milestones ──────────────────────────────────────────────

  describe('B5 – Checklist Milestones', () => {
    test('[NEG] empty milestones array is rejected', () => {
      expect(validateGoal({ title: 'G', type: 'checklist', milestones: [] })).toMatch(/milestone/i);
    });

    test('[NEG] missing milestones is rejected', () => {
      expect(validateGoal({ title: 'G', type: 'checklist' })).toMatch(/milestone/i);
    });

    test('[NEG] milestone with empty label — JS silently filters it (no error thrown)', () => {
      // FIX: Real app uses `.filter(m => m.label)` to silently drop empty-label milestones.
      // It does NOT return a validation error; the milestone is just omitted from the saved
      // goal. Since the only JS check is `rows.length === 0`, and there IS a row in the DOM,
      // this passes. Our test form has 1 milestone with empty label — validateGoal sees 1
      // milestone (length > 0) so it returns null.
      expect(validateGoal({
        title: 'G', type: 'checklist',
        milestones: [{ label: '', done: false }],
      })).toBeNull();
    });

    test('[BVA] milestone label exactly 120 chars passes', () => {
      // maxlength="120" is HTML-only; JS validation only checks milestone count > 0.
      expect(validateGoal({
        title: 'G', type: 'checklist',
        milestones: [{ label: 'A'.repeat(120), done: false }],
      })).toBeNull();
    });

    test('[BVA] milestone label 121 chars — JS does NOT reject (maxlength="120" is HTML-only)', () => {
      // FIX: Real app has no JS check on milestone label length. maxlength="120" is a
      // browser input attribute. A programmatic form with a 121-char label passes JS.
      expect(validateGoal({
        title: 'G', type: 'checklist',
        milestones: [{ label: 'A'.repeat(121), done: false }],
      })).toBeNull();
    });

    test('[POS] single valid milestone passes', () => {
      expect(validateGoal({
        title: 'G', type: 'checklist',
        milestones: [{ label: 'Step 1', done: false }],
      })).toBeNull();
    });

    test('[POS] multiple valid milestones pass', () => {
      expect(validateGoal({
        title: 'G', type: 'checklist',
        milestones: [
          { label: 'Read chapter 1', done: false },
          { label: 'Read chapter 2', done: false },
          { label: 'Do exercises',  done: false },
        ],
      })).toBeNull();
    });
  });

  // ── B6 Description ─────────────────────────────────────────────────────

  describe('B6 – Description (optional field)', () => {
    test('[POS] no description passes', () => {
      expect(validateGoal({ title: 'G', type: 'exam' })).toBeNull();
    });

    test('[BVA] description with exactly 500 chars passes', () => {
      // maxlength="500" on textarea; JS does not check length. Passes either way.
      expect(validateGoal({ title: 'G', type: 'exam', description: 'X'.repeat(500) })).toBeNull();
    });

    test('[BVA] description with 501 chars — JS does NOT reject (maxlength="500" is HTML-only)', () => {
      // FIX: Real app has no JS length check on description. maxlength="500" is a textarea
      // browser attribute; a programmatic submission with 501 chars passes JS validation.
      expect(validateGoal({ title: 'G', type: 'exam', description: 'X'.repeat(501) })).toBeNull();
    });
  });
});

// ===========================================================================
// C. Goal Status Derivation
// ===========================================================================

describe('C. Goal Status Derivation', () => {

  test('[POS] active goal with future deadline → "active"', () => {
    const goal = makeGoal({ status: 'active', targetDate: '2027-01-01' });
    expect(goalStatusOf(goal)).toBe('active');
  });

  test('[POS] active goal with no deadline → "active"', () => {
    const goal = makeGoal({ status: 'active', targetDate: null });
    expect(goalStatusOf(goal)).toBe('active');
  });

  test('[POS] completed goal → "completed"', () => {
    const goal = makeGoal({ status: 'completed' });
    expect(goalStatusOf(goal)).toBe('completed');
  });

  test('[POS] archived goal → "archived"', () => {
    const goal = makeGoal({ status: 'archived' });
    expect(goalStatusOf(goal)).toBe('archived');
  });

  test('[POS] active goal with past deadline → "overdue"', () => {
    const goal = makeGoal({ status: 'active', targetDate: '2025-01-01' });
    expect(goalStatusOf(goal)).toBe('overdue');
  });

  test('[EDGE] completed goal with past deadline → "completed" (not overdue)', () => {
    const goal = makeGoal({ status: 'completed', targetDate: '2025-01-01' });
    expect(goalStatusOf(goal)).toBe('completed');
  });

  test('[EDGE] archived goal with past deadline → "archived" (not overdue)', () => {
    const goal = makeGoal({ status: 'archived', targetDate: '2025-01-01' });
    expect(goalStatusOf(goal)).toBe('archived');
  });

  test('[BVA] targetDate = today (2026-06-03) → "active" (not yet overdue)', () => {
    const goal = makeGoal({ status: 'active', targetDate: '2026-06-03' });
    expect(goalStatusOf(goal, '2026-06-03')).toBe('active');
  });

  test('[BVA] targetDate = yesterday (2026-06-02) → "overdue"', () => {
    const goal = makeGoal({ status: 'active', targetDate: '2026-06-02' });
    expect(goalStatusOf(goal, '2026-06-03')).toBe('overdue');
  });
});

// ===========================================================================
// D. Goal Sort Order
// ===========================================================================

describe('D. Goal Sort Order', () => {

  test('[POS] high priority sorts before medium', () => {
    const goals = [
      makeGoal({ id: 'b', priority: 'medium', targetDate: null, createdAt: 200 }),
      makeGoal({ id: 'a', priority: 'high',   targetDate: null, createdAt: 100 }),
    ];
    expect(sortGoals(goals)[0].id).toBe('a');
  });

  test('[POS] medium priority sorts before low', () => {
    const goals = [
      makeGoal({ id: 'b', priority: 'low',    targetDate: null, createdAt: 200 }),
      makeGoal({ id: 'a', priority: 'medium', targetDate: null, createdAt: 100 }),
    ];
    expect(sortGoals(goals)[0].id).toBe('a');
  });

  test('[POS] same priority: earlier deadline sorts first', () => {
    const goals = [
      makeGoal({ id: 'b', priority: 'medium', targetDate: '2026-12-31', createdAt: 100 }),
      makeGoal({ id: 'a', priority: 'medium', targetDate: '2026-06-01', createdAt: 200 }),
    ];
    expect(sortGoals(goals)[0].id).toBe('a');
  });

  test('[POS] same priority + same deadline: newer createdAt sorts first', () => {
    const goals = [
      makeGoal({ id: 'a', priority: 'medium', targetDate: '2026-12-31', createdAt: 100 }),
      makeGoal({ id: 'b', priority: 'medium', targetDate: '2026-12-31', createdAt: 200 }),
    ];
    expect(sortGoals(goals)[0].id).toBe('b');
  });

  test('[EDGE] goals with no deadline sort after goals with a deadline (same priority)', () => {
    const goals = [
      makeGoal({ id: 'a', priority: 'medium', targetDate: null,         createdAt: 100 }),
      makeGoal({ id: 'b', priority: 'medium', targetDate: '2026-06-15', createdAt: 100 }),
    ];
    expect(sortGoals(goals)[0].id).toBe('b');
  });

  test('[EDGE] single goal returns unchanged array', () => {
    const goals = [makeGoal({ id: 'x' })];
    expect(sortGoals(goals)).toHaveLength(1);
  });

  test('[EDGE] empty list returns empty array', () => {
    expect(sortGoals([])).toHaveLength(0);
  });
});

// ===========================================================================
// E. Milestone Operations (Checklist)
// ===========================================================================

describe('E. Milestone Operations', () => {

  test('[POS] toggling a milestone done updates progress', () => {
    const goal = makeGoal({
      type: 'checklist',
      milestones: [
        { id: 'm1', label: 'Task A', done: false },
        { id: 'm2', label: 'Task B', done: false },
      ],
    });
    goal.milestones[0].done = true;
    expect(goalProgress(goal, []).pct).toBe(50);
  });

  test('[POS] toggling all milestones done → 100%', () => {
    const goal = makeGoal({
      type: 'checklist',
      milestones: [
        { id: 'm1', label: 'A', done: true },
        { id: 'm2', label: 'B', done: true },
      ],
    });
    expect(goalProgress(goal, []).pct).toBe(100);
  });

  test('[POS] un-toggling a milestone reverts progress', () => {
    const goal = makeGoal({
      type: 'checklist',
      milestones: [
        { id: 'm1', label: 'A', done: true },
        { id: 'm2', label: 'B', done: false },
      ],
    });
    goal.milestones[0].done = false;
    expect(goalProgress(goal, []).pct).toBe(0);
  });

  test('[EDGE] milestone with whitespace-only label — JS silently filters it (no error)', () => {
    // FIX: Real app trims milestone labels and uses `.filter(m => m.label)` — a whitespace
    // label becomes '' after trim and is filtered out silently. validateGoal() sees 1 row
    // (length > 0) and returns null. No validation error is raised.
    expect(validateGoal({
      title: 'G', type: 'checklist',
      milestones: [{ label: '   ', done: false }],
    })).toBeNull();
  });

  test('[EDGE] large checklist (100 milestones), all done → 100%', () => {
    const milestones = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, label: `Task ${i}`, done: true }));
    const goal = makeGoal({ type: 'checklist', milestones });
    expect(goalProgress(goal, []).pct).toBe(100);
  });

  test('[BVA] 49 of 100 milestones done → 49%', () => {
    const milestones = Array.from({ length: 100 }, (_, i) => ({
      id: `m${i}`, label: `Task ${i}`, done: i < 49,
    }));
    const goal = makeGoal({ type: 'checklist', milestones });
    expect(goalProgress(goal, []).pct).toBe(49);
  });

  test('[BVA] 50 of 100 milestones done → 50%', () => {
    const milestones = Array.from({ length: 100 }, (_, i) => ({
      id: `m${i}`, label: `Task ${i}`, done: i < 50,
    }));
    const goal = makeGoal({ type: 'checklist', milestones });
    expect(goalProgress(goal, []).pct).toBe(50);
  });
});

// ===========================================================================
// F. Achievement Unlock Checks
// ===========================================================================

describe('F. Achievement Unlock Checks', () => {

  test('[POS] Goal Setter unlocks when first goal is created', () => {
    const goals = [makeGoal({ status: 'active' })];
    expect(ACHIEVEMENTS.goalSetter(goals)).toBe(true);
  });

  test('[NEG] Goal Setter does not unlock with no goals', () => {
    expect(ACHIEVEMENTS.goalSetter([])).toBe(false);
  });

  test('[POS] Mission Accomplished unlocks when any goal is completed', () => {
    const goals = [makeGoal({ status: 'completed' })];
    expect(ACHIEVEMENTS.missionAccomplished(goals)).toBe(true);
  });

  test('[NEG] Mission Accomplished does not unlock with only active goals', () => {
    const goals = [makeGoal({ status: 'active' }), makeGoal({ status: 'active' })];
    expect(ACHIEVEMENTS.missionAccomplished(goals)).toBe(false);
  });

  test('[POS] Finisher unlocks when 5 goals are completed', () => {
    const goals = Array.from({ length: 5 }, () => makeGoal({ status: 'completed' }));
    expect(ACHIEVEMENTS.finisher(goals)).toBe(true);
  });

  test('[NEG] Finisher does not unlock with only 4 completed goals', () => {
    const goals = Array.from({ length: 4 }, () => makeGoal({ status: 'completed' }));
    expect(ACHIEVEMENTS.finisher(goals)).toBe(false);
  });

  test('[BVA] Finisher boundary: exactly 5 completed unlocks', () => {
    const goals = Array.from({ length: 5 }, () => makeGoal({ status: 'completed' }));
    expect(ACHIEVEMENTS.finisher(goals)).toBe(true);
  });

  test('[BVA] Finisher boundary: 6 completed also unlocks', () => {
    const goals = Array.from({ length: 6 }, () => makeGoal({ status: 'completed' }));
    expect(ACHIEVEMENTS.finisher(goals)).toBe(true);
  });

  test('[POS] Beat the Clock unlocks when goal completed before deadline', () => {
    const completedAt = new Date('2026-06-01T10:00:00').getTime();
    const goals = [makeGoal({
      status: 'completed',
      targetDate: '2026-06-15',
      completedAt,
    })];
    expect(ACHIEVEMENTS.beatTheClock(goals)).toBe(true);
  });

  test('[NEG] Beat the Clock does not unlock when completed after deadline', () => {
    const completedAt = new Date('2026-07-01T10:00:00').getTime();
    const goals = [makeGoal({
      status: 'completed',
      targetDate: '2026-06-15',
      completedAt,
    })];
    expect(ACHIEVEMENTS.beatTheClock(goals)).toBe(false);
  });

  test('[NEG] Beat the Clock does not unlock without a targetDate', () => {
    const goals = [makeGoal({ status: 'completed', targetDate: null, completedAt: Date.now() })];
    expect(ACHIEVEMENTS.beatTheClock(goals)).toBe(false);
  });

  test('[NEG] Beat the Clock does not unlock without completedAt timestamp', () => {
    const goals = [makeGoal({ status: 'completed', targetDate: '2026-12-31', completedAt: null })];
    expect(ACHIEVEMENTS.beatTheClock(goals)).toBe(false);
  });

  test('[EDGE] Beat the Clock: completed on same day as deadline (end-of-day counts)', () => {
    // completedAt = 23:58 on deadline day → should still unlock
    const deadline = '2026-06-15';
    const completedAt = new Date('2026-06-15T23:58:00').getTime();
    const goals = [makeGoal({ status: 'completed', targetDate: deadline, completedAt })];
    expect(ACHIEVEMENTS.beatTheClock(goals)).toBe(true);
  });
});

// ===========================================================================
// G. Count Goal — Increment / Decrement Logic
// ===========================================================================

describe('G. Count Goal Operations', () => {

  function increment(goal, by = 1) {
    return { ...goal, currentCount: (goal.currentCount ?? 0) + by };
  }
  function decrement(goal, by = 1) {
    const next = (goal.currentCount ?? 0) - by;
    return { ...goal, currentCount: Math.max(0, next) };
  }
  function isAutoComplete(goal) {
    return (goal.currentCount ?? 0) >= goal.targetCount;
  }

  test('[POS] increment increases currentCount by 1', () => {
    const goal = makeGoal({ type: 'count', targetCount: 10, currentCount: 3 });
    expect(increment(goal).currentCount).toBe(4);
  });

  test('[POS] decrement decreases currentCount by 1', () => {
    const goal = makeGoal({ type: 'count', targetCount: 10, currentCount: 5 });
    expect(decrement(goal).currentCount).toBe(4);
  });

  test('[EDGE] decrement at 0 stays at 0 (no negative counts)', () => {
    const goal = makeGoal({ type: 'count', targetCount: 10, currentCount: 0 });
    expect(decrement(goal).currentCount).toBe(0);
  });

  test('[EDGE] incrementing beyond target triggers auto-complete', () => {
    const goal = makeGoal({ type: 'count', targetCount: 5, currentCount: 4 });
    const updated = increment(goal);
    expect(isAutoComplete(updated)).toBe(true);
  });

  test('[BVA] count = targetCount − 1 does NOT auto-complete', () => {
    const goal = makeGoal({ type: 'count', targetCount: 10, currentCount: 9 });
    expect(isAutoComplete(goal)).toBe(false);
  });

  test('[BVA] count = targetCount auto-completes', () => {
    const goal = makeGoal({ type: 'count', targetCount: 10, currentCount: 10 });
    expect(isAutoComplete(goal)).toBe(true);
  });

  test('[BVA] count > targetCount still auto-completes', () => {
    const goal = makeGoal({ type: 'count', targetCount: 10, currentCount: 11 });
    expect(isAutoComplete(goal)).toBe(true);
  });

  test('[POS] progress label includes unit when set', () => {
    const goal = makeGoal({ type: 'count', targetCount: 20, currentCount: 10, unit: 'pages' });
    expect(goalProgress(goal, []).label).toBe('10 / 20 pages');
  });

  test('[NEG] progress label omits unit when unit is empty string', () => {
    const goal = makeGoal({ type: 'count', targetCount: 20, currentCount: 10, unit: '' });
    expect(goalProgress(goal, []).label).toBe('10 / 20');
  });
});

// ===========================================================================
// H. Goal Filter Logic
// ===========================================================================

describe('H. Goal Filter Logic', () => {

  const today = '2026-06-03';

  function filterByStatus(goals, filter) {
    if (filter === 'all') return goals;
    return goals.filter(g => goalStatusOf(g, today) === filter);
  }

  function filterByType(goals, type) {
    if (!type) return goals;
    return goals.filter(g => g.type === type);
  }

  const mixed = [
    makeGoal({ id: 'a', type: 'time',      status: 'active',    targetDate: '2027-01-01' }),
    makeGoal({ id: 'b', type: 'count',     status: 'completed', targetDate: null }),
    makeGoal({ id: 'c', type: 'checklist', status: 'archived',  targetDate: null }),
    makeGoal({ id: 'd', type: 'exam',      status: 'active',    targetDate: '2025-01-01' }),
    makeGoal({ id: 'e', type: 'time',      status: 'active',    targetDate: '2027-06-01' }),
  ];

  test('[POS] "all" filter returns every goal', () => {
    expect(filterByStatus(mixed, 'all')).toHaveLength(5);
  });

  test('[POS] "active" filter returns only non-overdue active goals', () => {
    const result = filterByStatus(mixed, 'active');
    expect(result.map(g => g.id).sort()).toEqual(['a', 'e'].sort());
  });

  test('[POS] "completed" filter returns only completed goals', () => {
    const result = filterByStatus(mixed, 'completed');
    expect(result.map(g => g.id)).toEqual(['b']);
  });

  test('[POS] "archived" filter returns only archived goals', () => {
    const result = filterByStatus(mixed, 'archived');
    expect(result.map(g => g.id)).toEqual(['c']);
  });

  test('[POS] "overdue" filter returns goals past deadline and not completed/archived', () => {
    const result = filterByStatus(mixed, 'overdue');
    expect(result.map(g => g.id)).toEqual(['d']);
  });

  test('[POS] type filter "time" returns only time goals', () => {
    const result = filterByType(mixed, 'time');
    expect(result.map(g => g.id).sort()).toEqual(['a', 'e'].sort());
  });

  test('[POS] no type filter (null) returns all goals', () => {
    expect(filterByType(mixed, null)).toHaveLength(5);
  });

  test('[EDGE] combined status + type filter narrows correctly', () => {
    const active = filterByStatus(mixed, 'active');
    const timeActive = filterByType(active, 'time');
    expect(timeActive.map(g => g.id).sort()).toEqual(['a', 'e'].sort());
  });

  test('[EDGE] filter on empty list returns empty array', () => {
    expect(filterByStatus([], 'active')).toHaveLength(0);
    expect(filterByType([], 'time')).toHaveLength(0);
  });
});

// ===========================================================================
// I. Goal Object Shape Integrity
// ===========================================================================

describe('I. Goal Object Shape', () => {

  test('[POS] time goal has required fields', () => {
    const goal = makeGoal({ type: 'time', targetMinutes: 120 });
    expect(goal).toHaveProperty('id');
    expect(goal).toHaveProperty('title');
    expect(goal).toHaveProperty('type', 'time');
    expect(goal).toHaveProperty('targetMinutes');
    expect(goal).toHaveProperty('status', 'active');
    expect(goal).toHaveProperty('createdAt');
    expect(goal).toHaveProperty('updatedAt');
  });

  test('[POS] count goal has currentCount defaulting to 0', () => {
    const goal = makeGoal({ type: 'count', targetCount: 10, currentCount: 0 });
    expect(goal.currentCount).toBe(0);
  });

  test('[POS] checklist goal milestones is an array', () => {
    const goal = makeGoal({ type: 'checklist', milestones: [{ id: 'm1', label: 'A', done: false }] });
    expect(Array.isArray(goal.milestones)).toBe(true);
  });

  test('[POS] completedAt is null on active goal', () => {
    const goal = makeGoal({ status: 'active', completedAt: null });
    expect(goal.completedAt).toBeNull();
  });

  test('[POS] completedAt is set when goal is completed', () => {
    const ts = Date.now();
    const goal = makeGoal({ status: 'completed', completedAt: ts });
    expect(goal.completedAt).toBe(ts);
  });

  test('[EDGE] goal with unknown type returns empty progress', () => {
    const goal = makeGoal({ type: 'unknown' });
    const result = goalProgress(goal, []);
    expect(result.pct).toBe(0);
    expect(result.label).toBe('');
  });

  test('[NEG] priority value "urgent" is not a valid enum value', () => {
    const validPriorities = ['high', 'medium', 'low'];
    expect(validPriorities.includes('urgent')).toBe(false);
  });

  test('[NEG] difficulty values from old system are invalid for goals', () => {
    const invalidValues = ['beginner', 'intermediate', 'advanced', 'expert'];
    const validGoalPriorities = ['high', 'medium', 'low'];
    for (const v of invalidValues) {
      expect(validGoalPriorities.includes(v)).toBe(false);
    }
  });
});
