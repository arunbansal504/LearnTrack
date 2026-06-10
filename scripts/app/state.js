/* ================================================================
   SHARED APP STATE  —  imported by every app/* module.
   Modules mutate properties on the single `state` object
   (e.g. `state.entries = [...]`). Never reassign the `state`
   binding itself — imports are read-only bindings, but mutating
   a property of the imported object is allowed and is how all
   cross-module state sharing works here.
   ================================================================ */

export const state = {
  /* ---- Core data ---- */
  entries:   [],
  prefs:     {},
  earnedAch: [],
  goals:     [],

  /* ---- Goals page UI ---- */
  goalRingListenerBound:    false,
  goalLastPct:              -1,   // -1 = not yet rendered; tracks previous pct to detect 100% transitions
  goalsFilter:            'all',
  goalsTypeFilter:        '',
  goalsSearch:            '',
  goalsCollapsed:         { overdue: false, open: false, completed: true, archived: true },
  goalsCollapsedSnapshot: null,
  goalScrollTarget:       null,
  goalsRenderOrder:       null, // null = re-sort on next render; array of IDs = stable order
  goalsSelection:         new Set(),
  deletedGoalsSelection:  new Set(),
  dashGoalsCollapsed:     false, // dashboard open-goals list, default expanded

  /* ---- Log ↔ goal context ---- */
  logGoalContext:        null, // { id, title } — set when navigating to log from a goal card
  logLinkedGoalFilter:   null, // goalId — Daily Log shows only entries linked to this goal
  pendingEntryGoalId:    null, // goalId — auto-link a brand-new entry to this goal on save
  pendingCompleteGoalId: null, // goalId — complete this goal after the prompted entry saves
  linkModalReturnEntryId: null, // set when user jumps to Goals via "View"; re-opens link modal on back
  linkModalReturnGoalId:  null, // which goal card shows the "back to linking" chip
  dlReturnEntry:          null, // deleted entry whose linked-goals modal should reopen on back
  dlReturnGoalId:         null, // which goal card shows the "back to deleted log" chip

  /* ---- Auto-backup ---- */
  autoBackupTimer:    null,
  lastAutoBackup:     0,
  backupInProgress:   false,
  backupPendingRetry: false,
  backupFailures:     0,     // consecutive auto-backup failures
  backupFailing:      false, // sticky warning state after repeated failures

  /* ---- Cloud sync (Supabase) ---- */
  syncSession:    null,        // current Supabase auth session, or null when signed out
  syncStatus:     'disabled',  // 'disabled' | 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error'
  lastCloudSync:  0,           // Unix ms of the last successful push/pull (UI label)
  cloudPushTimer: null,        // debounce handle for queueCloudPush()

  /* ---- Entitlements (appearance gating) ---- */
  tier:         'free',   // 'free' | 'premium' | 'family' — loaded by entitlements.js
  entitlements: null,     // Map<'kind:key', min_tier> — null = not yet fetched
  profileLimit: 2,        // max profiles allowed by the user's subscription

  /* ---- Routing / misc ---- */
  currentPage:       'dashboard',
  pendingTimerReset: null,   // fired once, only after a timer-initiated entry saves

  /* ---- Deleted logs ---- */
  deletedPage:      1,
  deletedSelection: new Set(),

  /* ---- Dashboard chart ranges ---- */
  dailyRange:    30,
  monthlyRange:  6,
  categoryRange: 30,

  /* ---- Collapsed month state ---- */
  monthCollapsedState:   {}, // key "YYYY-MM" -> true (collapsed) / false (expanded)
  dlMonthCollapsedState: {}, // same for Deleted Logs

  /* ---- Achievements ---- */
  achievementFilterMode: 'all',

  /* ---- Pending badge queue ---- */
  badgeQueue:   [],
  badgeShowing: false,
};

/* ---- App-wide constants ---- */
export const BACKUP_FAILURE_LIMIT = 3;
export const DELETED_RETENTION_DAYS = 90; // recycle-bin entries older than this are auto-purged on load
export const LOG_PAGE_SIZE = 20;
export const CLOUD_PUSH_DEBOUNCE = 2500; // ms to coalesce writes before pushing a snapshot to the cloud

/* ---- Default Preferences ---- */
export const DEFAULT_PREFS = {
  username:      'Learner',
  theme:         'dark',
  accent:        'purple',
  compact:       true,
  dailyGoalMin:  60,
  monthlyGoalHr: 20,
  reminder:      false,
  reminderTime:  '20:00',
  categories:    ['Programming','Mathematics','Languages','Science','Design','Business','Other'],
  categoryColors:       {},   // { categoryName: '#rrggbb' } — stable, unique per category (Report screen)
  goalHistory:          [],
  monthlyGoalHistory:   [],
  cloudAutoBackup:      false,
  customAccentHex:      null,   // '#rrggbb' when custom hex accent is active, else null
  themeAccentOverrides: {},    // { [themeName]: accentValue } — per-theme accent overrides
};

// Distinct base palette for category colors; beyond it we generate unique golden-angle hues.
export const CATEGORY_PALETTE = [
  '#4F46E5','#10B981','#F59E0B','#EF4444','#3B82F6','#EC4899','#8B5CF6','#06B6D4',
  '#84CC16','#F97316','#14B8A6','#A855F7','#EAB308','#0EA5E9','#F43F5E','#22C55E',
];

/* ---- Utility: debounce ---- */
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
