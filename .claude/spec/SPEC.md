# LearnTrack — As-Built Product Specification

**Version:** 1.2.0  
**Last updated:** 2026-06-02  
**Status:** Implemented & live

---

## Overview

LearnTrack is a frontend-only, browser-based SPA for tracking daily learning activity. It runs entirely in the browser with no backend, persists all data via IndexedDB, and works across desktop and mobile.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Markup | HTML5 (+ `manifest.json` for PWA install) |
| Styles | CSS3, CSS custom properties |
| Logic | Vanilla JavaScript ES6+ (IIFE module pattern) |
| Charts | Chart.js (CDN) |
| PDF export | jsPDF v2.5.1 (CDN, vector text — not canvas) |
| Rewards animation | canvas-confetti (CDN) |
| Storage | IndexedDB (primary), localStorage (fallback) |

No React, Vue, Angular, or backend server.

---

## File Structure

```
/Learn Tracker
├── index.html              — Single HTML file, all pages
├── manifest.json           — PWA web app manifest (install support)
├── styles/
│   ├── main.css            — All styles, CSS variables, responsive, themes
│   ├── dashboard.css       — Dashboard-specific widget styles
│   └── animations.css      — Keyframe animations, transitions
├── scripts/
│   ├── app.js              — Core app, routing, page renderers, UserManager, PDF report
│   ├── storage.js          — IndexedDB wrapper, per-user stores, soft-delete
│   ├── analytics.js        — Stats, streak, heatmap, distribution functions
│   ├── charts.js           — All Chart.js chart renderers
│   ├── rewards.js          — XP, levels, medals, achievements engine
│   ├── calendar.js         — Calendar grid and day-panel module
│   ├── insights.js         — Insights cards, quotes, greeting, recommendations
│   └── timer.js            — Pomodoro timer and stopwatch
└── .claude/
    └── spec/
        └── SPEC.md         — This file
```

---

## Pages & Navigation

The app is a single-page app. Pages are `<section data-page="...">` elements shown/hidden by `navigateTo()`.

### Sidebar (desktop)
- User avatar (initials circle, color-coded), username, level badge
- XP progress bar with current / next-level XP label
- Streak chip (🔥 N day streak)
- Nav links: Dashboard, Daily Log, Deleted Logs, Calendar, Achievements, Reports, Profiles, Settings, Backup
- Dark/Light theme toggle switch
- Auto-backup status chip (shows time since last auto-backup); warning indicator when no folder is configured
- App version label
- Sidebar collapse toggle button
- **Mobile:** swipe left on the sidebar to close it

### Bottom nav (mobile)
Four items: Home (Dashboard), Log, + (FAB — opens Add Entry modal), Awards (Achievements)

### Pages (9 total)

| Page id | Nav label | Description |
|---|---|---|
| `dashboard` | Dashboard | Overview, stats, charts, insights, recent activity |
| `log` | Daily Log | Entry list, search, filter |
| `deleted-logs` | Deleted Logs | Recycle bin — soft-deleted entries, restore or permanently delete |
| `reports` | Reports | PDF monthly report generation with month picker and preview |
| `calendar` | Calendar | Month grid, day panel, streaks |
| `achievements` | Achievements | Badges, XP, level, medals |
| `profiles` | Profiles | Multi-user management |
| `settings` | Settings | Appearance, goals, categories |
| `backup` | Backup | JSON export/import per user |

> **No separate Analytics page.** The analytics charts (daily time, monthly, category, heatmap) and insights strip are embedded directly in the Dashboard.

---

## 1. Dashboard

### Page Header
- Personalized greeting (time-of-day based, with username)
- Live clock chip
- Daily quote chip (click to randomize)
- "Add Entry" primary button

### Stats Grid (6 cards)
- **Total Hours** — cumulative time studied, formatted `Xh Ym`
- **Current Streak** — active streak days; sub-stat shows longest streak
- **Total Entries** — all-time log count (animated counter)
- **Avg Hours/Day** — total minutes ÷ active unique days
- **Consistency** — % of last 30 days with at least one entry (animated counter)
- **Level** — current XP level (animated counter) with inline XP progress bar

### Insights Strip (up to 4 cards, auto-fit grid)
Cards rendered by `Insights.generateInsights()`. Grid fills full width.

1. Best Day to Learn — day-of-week with highest avg session
2. Avg Session — total minutes ÷ total entries
3. Most Studied — top topic/category by total time
4. Topics Explored — count of unique topic/category labels

### Goal Progress
- **Daily Goal ring** — SVG circle showing today's logged time vs. daily goal (minutes); green when met, amber when ≥ 50%, accent color otherwise
- **Weekly Goal dots** — 7 day-of-week circles; each uses the goal active on that date from `goalHistory`
  - Green + checkmark = goal met
  - Amber + % = partial
  - Gray = no entry
- **Today Summary** — time logged today, entry count, top topic, "+ Log Entry" button

### Summary Row (3 cards)
- This Week — hours, entries, 7-day mini bar chart (inline rendered bars, not Chart.js)
- This Month — hours, entries, progress bar vs. monthly goal (uses `monthlyGoalHistory` for historical goal values)
- Next Milestone — closest unearned achievement with progress bar

### Medals Card
Separate widget. Gold / Silver / Bronze counts.

### Achievements Preview Card
Separate widget. Mini badge grid (up to 15 badges: earned first sorted by most recent, then unearned). Shows earned count / total. "View all" link → Achievements page.

> **Note:** Medals and Achievements are two separate cards, with Medals appearing first.

### Recent Activity Feed
Last **8** entries. Each shows topic, category pill, date (relative), duration. Clicking an item opens the Edit modal.

### Analytics Section (on Dashboard)
Full analytics embedded in the Dashboard with tabbed range selectors:
- **Daily Learning Time** (line chart) — range tabs: 7 / 30 / 90 / 365 days
- **Monthly Progress** (bar chart) — range tabs: 3 / 6 / 12 months
- **Category Breakdown** (doughnut chart) — range tabs: 7 / 30 / 90 days
- **Activity Heatmap** (custom grid) — 52-week GitHub-style contribution heatmap, 5-level intensity

---

## 2. Daily Log

### Add / Edit Entry Modal

| Field | Type | Notes |
|---|---|---|
| Date | Date picker (editable for new entries, range: past 365 days to today) | Read-only when editing; locked to selected date when opened from Calendar |
| Duration | Two inputs: Hours + Minutes | Required; total must be > 0 |
| Topic | Text input | Required |
| Category | Select dropdown (user-defined list) | — |
| Difficulty | Select: Easy / Medium / Hard | — |
| Mood | 5-button selector (😞 😐 🙂 😊 🚀, values 1–5) | Defaults to 4 (😊) for new entries |
| Tags | Comma-separated text | — |
| Notes | Textarea (5 rows) | Saved on form submit |
| Resources | Dynamic list — add/remove rows (type, title, URL) | URL validation warning shown |

### Floating Notes Panel
Clicking a notes preview in the entry list opens a floating overlay (bottom-sheet style) with the full notes content. Closes via X button, backdrop click, or Escape key.

### Entry List
- **Expand All / Collapse All** toggle button
- Grouped by month (collapsible sections); current month starts expanded, others collapsed
- Each card shows: date badge, topic, category pill, difficulty dot, logged time (creation timestamp), duration badge, mood emoji, notes preview (90 chars, clickable → Floating Notes Panel), resource links, tags, icon action buttons (Edit / Duplicate / Delete)
- Delete moves entry to soft-delete (Deleted Logs) — it does **not** permanently remove immediately
- Pagination: 20 entries per page with "Load more"

### Search & Filter
- Keyword search (topic, notes, category, tags)
- Date range picker (from / to)
- Category filter
- Difficulty filter
- Sort: Newest / Oldest / Longest first / Shortest first
- Filter toggle button shows visual indicator (`.has-filters` class) when any filter is active

---

## 3. Deleted Logs (Recycle Bin)

Soft-deleted entries are stored in the `deletedEntries` IndexedDB store and displayed here.

- **Expand All / Collapse All** toggle button
- Grouped by month (collapsible sections); all months start expanded
- Each entry card shows topic, category, date, duration, difficulty dot, mood emoji, notes preview, tags, deletion time badge (relative + full tooltip), checkbox for bulk selection
- **Month-level select-all** checkbox per group (indeterminate state for partial selection)
- **Global select-all** checkbox + "N of M selected" / "Select all (N)" label
- **Bulk action bar** — appears when entries are selected: Restore selected / Permanently delete selected / Clear selection
- Individual entry buttons: Restore / Permanently Delete
- Search and filter controls (keyword, date range, category, difficulty)
- Sort options: Deleted newest / Deleted oldest / Original date newest / Original date oldest / Longest first / Shortest first
- Filter toggle shows visual indicator when active
- Pagination: 20 per page with "Load more"

---

## 4. Reports

Dedicated page for PDF monthly report generation.

- **Month picker** — select any month with data
- **Report options** checkboxes: Include Notes / Include Resources
- **Preview button** — renders a visual HTML preview of the report inline on the page
- **Download PDF button** — generates and downloads via jsPDF

### PDF Report Contents
Uses **jsPDF directly** — no html2canvas, no DOM capture. Everything drawn with `pdf.text()`, `pdf.rect()`, `pdf.line()`, `pdf.link()`. Coordinates are in points (pt).

- Header band (LearnTrack branding, month, username, generated date)
- 4 summary cards: Total Time, Sessions, Daily Goal %, Avg Mood
- Goal progress bars (daily + monthly)
- Daily bar chart (days with entries only)
- Weekly breakdown chart
- Category breakdown table with colored bars
- Top 10 topics (ranked, 1–3 get gold/silver/bronze badges)
- Calendar grid (compact month view, cell color = met/active/empty)
- All Entries table

**All Entries table column widths:**
- Date, Category, Duration, Difficulty — content-based (`colFit`, measures actual text)
- Topic, Notes, Resources — fixed percentage of remaining space: Topic 15%, Notes 70%, Resources 15%
- Table always spans full page width; text wraps within all columns
- Difficulty values are title-cased
- Resource titles are clickable links; URL shown as plain gray text below

Helper functions defined inside `generateMonthlyReport()`: `tx()`, `fillR()`, `strokeR()`, `hline()`, `needsPage()`.
- `needsPage(h)` checks if `y + h > PH - MB` and adds a new page, resetting `y = MT`
- Column widths for Date/Category/Duration/Difficulty measured via `colFit()`

---

## 5. Calendar

- Full month grid with day-header row (Sun–Sat)
- Day cells: date number + activity dot (4 intensity levels based on minutes vs 300 min max) + entry count
- Other-month days shown dimmed
- Today highlighted; selected day highlighted
- Prev/Next/Today navigation buttons
- **Click** a day → right-side **Day Panel** shows entry list for that date; click an entry → opens Edit modal
- **Double-click** a day with entries → navigates to Daily Log filtered to that date
- Day Panel: day header, entry list (topic + duration + category), Quick Add button (today and past only), View Entries button (disabled if no entries)

### Streak Stats (below calendar)
- Current Streak
- Longest Streak
- Missed Days (last N days — label shows window size)
- Motivational streak message

---

## 6. Achievements

### XP Hero Section
- Level ring (SVG circle progress)
- Level name + XP progress bar (current XP into level / XP needed for next)
- Total XP card (animated counter)
- Badges earned count (animated counter)

### Levels (30 total)

| Level | Name | XP Required |
|---|---|---|
| 1 | Beginner | 0 |
| 2 | Curious Mind | 100 |
| 3 | Explorer | 250 |
| 4 | Apprentice | 500 |
| 5 | Learner | 900 |
| 6 | Practitioner | 1,500 |
| 7 | Adept | 2,500 |
| 8 | Scholar | 4,000 |
| 9 | Expert | 6,500 |
| 10 | Master | 10,000 |
| 11 | Grand Master | 15,000 |
| 12 | Legend | 22,000 |
| 13 | Mythic | 32,000 |
| 14 | Sage | 45,000 |
| 15 | Virtuoso | 62,000 |
| 16 | Luminary | 85,000 |
| 17 | Oracle | 115,000 |
| 18 | Visionary | 155,000 |
| 19 | Prodigy | 205,000 |
| 20 | Mastermind | 275,000 |
| 21 | Enlightened | 360,000 |
| 22 | Transcendent | 470,000 |
| 23 | Ascendant | 610,000 |
| 24 | Immortal | 790,000 |
| 25 | Eternal | 1,000,000 |
| 26 | Mythweaver | 1,300,000 |
| 27 | Celestial | 1,650,000 |
| 28 | Cosmic | 2,100,000 |
| 29 | Divine | 2,700,000 |
| 30 | Infinite | 3,500,000 |

### XP Calculation
- Base: 1 XP per minute logged
- Difficulty multiplier: Easy 1×, Medium 1.5×, Hard 3×
- Mood bonus multiplier: mood 1 → 0.8×, mood 2 → 0.9×, mood 3 → 1.0×, mood 4 → 1.1×, mood 5 → 1.25×
- Daily goal bonus: `goal_minutes × 0.5` XP (once per day, when goal met; uses `goalHistory` for historical goal values)
- Streak multiplier (applied on top of total): 3-day 1.2×, 7-day 1.4×, 14-day 1.6×, 30-day 2.0×

### Medals (Daily Performance)
Based on difficulty-weighted score for the day vs. daily goal.  
Difficulty weights for medal scoring: Easy 0.9×, Medium 1.0×, Hard 1.5×

- Bronze: weighted score ≥ 1.5× daily goal
- Silver: weighted score ≥ 2× daily goal
- Gold: weighted score ≥ 3× daily goal

Both XP and medals use `goalHistory` to look up the goal that was active on each historical date.

### Achievements Grid
60+ badges across categories. Filter tabs: All / Earned / Locked.

Each badge card: icon, name, description, progress bar, XP reward, lock/unlock state, earned date (if earned).

**Categories and badges:**

1. **First Steps**
   - First Step (1 entry) — 50 XP
   - Habit Builder (10 entries) — 100 XP
   - On a Roll (25 entries) — 150 XP
   - Committed (50 entries) — 400 XP
   - Century Club (100 entries) — 600 XP
   - Double Century (200 entries) — 800 XP
   - Half Millennium (500 entries) — 2,000 XP

2. **Streaks**
   - 3-Day Streak — 75 XP
   - Week Warrior (7d) — 200 XP
   - Fortnight Focus (14d) — 400 XP
   - Monthly Master (30d) — 1,000 XP
   - Iron Will (50d) — 1,500 XP
   - Centurion (100d) — 2,000 XP
   - Year-Round Scholar (365d) — 5,000 XP
   - Comeback Kid (return after 7+ day break) — 100 XP

3. **Total Hours**
   - Getting Started (5h) — 50 XP
   - Tenacious (10h) — 100 XP
   - Quarter Century (25h) — 200 XP
   - Dedicated Scholar (50h) — 500 XP
   - 100 Hours! — 1,500 XP
   - Learning Machine (200h) — 2,000 XP
   - Half a Thousand (500h) — 5,000 XP
   - Three-Quarter Thousand (750h) — 7,500 XP
   - Millennium Learner (1000h) — 10,000 XP

4. **Daily Goal**
   - Goal Getter (first goal met) — 75 XP
   - Week of Wins (7 consecutive days meeting goal) — 300 XP
   - Fortnight Champion (14 consecutive days meeting goal) — 500 XP
   - Unstoppable (30 consecutive days meeting goal) — 1,000 XP
   - Consistent Champion (goal met on 30 different days) — 500 XP
   - Overachiever (2× daily goal in one day) — 150 XP

5. **Single Day**
   - Deep Focus (single session ≥ 3h) — 200 XP
   - Marathon Day (5h in one day) — 300 XP
   - Power Day (5 or more separate sessions in one day) — 200 XP

6. **Quality**
   - Hard Learner (10 hard sessions) — 200 XP
   - Polymath (all 3 difficulty levels used) — 200 XP
   - Thoughtful Notes (10 entries with notes) — 100 XP
   - Resource Collector (20 entries with resources) — 150 XP
   - Hardcore Scholar (50 hard sessions) — 800 XP
   - Note Pro (50 entries with notes) — 300 XP
   - Resource Master (50 entries with resources) — 400 XP
   - In the Zone (10 sessions with mood score of 5) — 200 XP

7. **Topics & Categories**
   - Topic Master (10h on one topic) — 300 XP
   - Category Explorer (3 different categories) — 75 XP
   - Multi-Topic Explorer (5 different categories) — 150 XP
   - Diverse Learner (7 different categories) — 400 XP
   - Category Completionist (10 different categories) — 500 XP
   - Deep Diver (50h on one topic) — 800 XP
   - Topic Maestro (5 different topics each with 5+ hours) — 400 XP

8. **Time of Day**
   - Early Bird (entry logged between 5–8 AM) — 75 XP
   - Lunch Learner (entry logged 12–2 PM) — 50 XP
   - Night Owl (entry logged after 10 PM) — 75 XP
   - Weekend Warrior (entries on both Sat + Sun in the same week) — 100 XP
   - Sunrise Scholar (10 entries before 8 AM) — 300 XP
   - Night Philosopher (10 entries after 10 PM) — 300 XP

9. **Consistency & Long-term**
   - Consistency Master (80%+ consistency over 30 days) — 500 XP
   - Perfect Week (daily goal met every day of a full Mon–Sun week) — 400 XP
   - Monthly Dedication (20+ different days logged in one calendar month) — 300 XP
   - Perfect Month (entries logged every single day of a calendar month) — 1,000 XP
   - Veteran (entries on 90+ distinct days) — 500 XP

### Badge Unlock Flow
- Modal animation on first unlock
- Confetti celebration (canvas-confetti) — different patterns for achievements, level-ups, streaks
- Queue system: shows one badge at a time if multiple unlock simultaneously
- `Rewards.revokeStaleAchievements()` re-checks earned badges and removes those whose condition is no longer met (e.g., after import or data deletion)

### Rewards Guide (collapsible)
In-page expandable section explaining XP sources, streak multipliers, medal logic, and all 30 level thresholds (dynamically generated from `Rewards.LEVELS`). Current level row is highlighted.

---

## 7. Profiles

Multi-user system. Each user gets a separate IndexedDB database.

- **Default user** → `LearnTrackDB`
- **Additional users** → `LearnTrackDB_${userId}` (userId = `u${timestamp}`)
- Per-user localStorage keys for preferences (prefix `lt_${userId}_`)

### Profile List
Each row: avatar (initials circle, color-coded from 6-color palette), username, created date, Edit / Delete / Switch buttons.

### Add Profile
Modal with username field. New profile starts with empty data.

### Switching Profiles
Full app reload with new user's data.

---

## 8. Settings

### Profile
- Display Name (auto-sizing input)
- Daily Goal (minutes, 5–720)
- Monthly Goal (hours, 1–200)

### Appearance
- Dark / Light theme (button toggle, not a switch)
- Accent color swatches (6: purple, blue, green, orange, pink, red)
- Compact mode toggle (checkbox)

> Compact mode is the **default** (`compact: true` in `DEFAULT_PREFS`). It applies reduced padding/font sizes via `.compact-mode` on `<body>`.

### Categories
- View / Add / Remove custom categories
- **Drag-to-reorder** with touch support (long-press to pick up on mobile)

### Notifications
- Daily Reminder toggle (requests browser notification permission if enabled)
- Reminder Time picker (shown when enabled)
- Test Notification button

### Danger Zone
- Reset All Data (permanent delete of current user's data; preserves profile name from UserManager)

---

## 9. Backup & Restore

Per-profile JSON backup using **File System Access API** (with file-picker fallback for unsupported browsers).

### First-Launch Gate
On first launch, the app shows a blocking modal requiring the user to choose a backup folder before the app is accessible. The modal has both a "Choose Backup Folder" button and a **"Skip for now"** link — skipping sets `lt_backup_skipped = 'true'` in localStorage. The folder handle is persisted in a separate IndexedDB (`LearnTrackHandles`) so it survives profile switching.

### Auto-Backup
Permission is checked/requested during the user gesture (on entry save/delete), not inside the debounced timer. After every entry save/delete, a 1.5 s debounced backup is triggered. The sidebar shows "Auto-backed up — Xm ago" status chip. A warning indicator appears in the sidebar when no backup folder is configured.

### Backup
- Shows profile name, entry count, last backup date, filename
- "Backup Now" — writes `learntrack-backup-${profileName}.json` to configured folder
- Folder selection persisted in `LearnTrackHandles` IndexedDB; same folder used for future backups

### Restore
- "Load Backup" — auto-reads from configured folder
- "Browse File" — manual file picker
- Validates JSON structure before import
- Merge strategy:
  - Entries: keep entry with newest `updatedAt`
  - Deleted entries: add if not already present
  - Achievements: add if not already present
  - Preferences: `username`, `goalHistory`, `monthlyGoalHistory` always overwrite existing values; all other keys only fill if not already set
- Reports merge stats: new / updated / skipped entry counts + prefs restored count

### Backup History
Last 5 backup/import operations with timestamp and type (💾 export / 📂 import).

### Backup JSON Format (v2.0)
```json
{
  "version": "2.0",
  "appName": "LearnTrack",
  "exportedAt": 1234567890,
  "data": {
    "entries": [],
    "deletedEntries": [],
    "achievements": [],
    "preferences": {}
  }
}
```

> **Note:** The `version` field was `"1.0"` in older exports. The `deletedEntries` array and `exportedAt` top-level field are additions in v2.0.

---

## 10. Pomodoro Timer & Stopwatch

Floating panel (bottom-right FAB, 🍅 icon). Collapsible. Fullscreen toggle (Escape key exits or closes panel).

### Pomodoro
- 3 modes: Focus (25 min default), Short Break (5 min), Long Break (15 min)
- Adjustable durations: **work 1–999 min**, short break 1–30 min, long break 1–60 min
- Preset buttons: 15 / 25 / 45 / 60 min for work mode; plus a Custom option (opens inline input)
- Fine-tune buttons (− / +) to adjust duration by 1 min at a time
- Progress bar visualization
- "Time's up!" screen with dismiss button before transitioning to next mode
- Audio alert on completion — ascending arpeggio (C5 E5 G5 C6) for work done, descending chime (G5 E5 C5) for breaks done; subtle overtone for bell shimmer
- Session counter; every 4 work sessions auto-advances to Long Break
- Gradient background cycles through 8 color schemes (🎨 palette button)
- Browser title updates while running (`MM:SS · LearnTrack`)
- Notification permission requested on first Start press
- Progress state saved per mode when switching tabs; resumes if still running
- Fullscreen mode: shows ambient glow, live clock (12-hour format with AM/PM), rotating motivational quotes (every 10 s with fade transition)

### Stopwatch
- Start / Pause / Resume / Reset
- Displays `HH:MM:SS` when ≥ 1 hour, else `MM:SS`
- Browser title updates while running

---

## 11. Data Models

### Learning Entry
```javascript
{
  id: "timestamp-random",      // string, unique
  date: "YYYY-MM-DD",          // local date string
  topic: "string",             // required
  category: "string",
  durationMinutes: number,     // required, > 0
  difficulty: "easy|medium|hard",
  moodScore: number,           // 1–5
  notes: "string",
  tags: ["string"],
  resources: [
    { type: string, title: string, url: string }
  ],
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Deleted Entry
Same shape as Learning Entry, plus:
```javascript
{
  ...entry,
  deletedAt: timestamp,        // when it was soft-deleted
}
```

### Preferences
```javascript
{
  username: string,
  theme: "light|dark",
  accent: "purple|blue|green|orange|pink|red",
  compact: boolean,
  dailyGoalMin: number,
  monthlyGoalHr: number,
  reminder: boolean,
  reminderTime: "HH:MM",
  categories: [string],
  goalHistory: [{ from: "YYYY-MM-DD", goalMin: number }],         // tracks daily goal changes over time
  monthlyGoalHistory: [{ from: "YYYY-MM", goalHr: number }],      // tracks monthly goal changes over time
}
```

Both goal history arrays include a sentinel entry at `from: "0000-01-01"` / `from: "0000-01"` as a fallback for dates before any recorded change.

---

## 12. Storage Engine

**Module:** `storage.js`  
**Primary:** IndexedDB (`DB_VERSION = 2`)  
**Fallback:** localStorage

### Object Stores (per user DB)

| Store | Purpose | Key indexes |
|---|---|---|
| `entries` | Learning log entries | date, category, topic |
| `achievements` | Earned badge records | — |
| `preferences` | User settings (key/value) | — |
| `notes` | Full notes text (keyed by entry id) | — |
| `backupLog` | Last 5 backup/import operations | — |
| `deletedEntries` | Soft-deleted entries | deletedAt |

### Directory Handle Storage
A separate IndexedDB `LearnTrackHandles` stores the File System Access API directory handle globally (not per-user), so the backup folder survives profile switches.

### Key Functions
- `Storage.init(userId)` — open or create per-user DB
- `Storage.saveEntry()`, `getEntry()`, `getAllEntries()`, `deleteEntry()`
- `Storage.softDeleteEntry(id)` — moves entry to `deletedEntries` store
- `Storage.getDeletedEntries()` — returns all soft-deleted entries sorted by `deletedAt` desc
- `Storage.restoreEntry(id)` — moves back from `deletedEntries` to `entries`
- `Storage.permanentlyDeleteEntry(id)` — removes from `deletedEntries` permanently
- `Storage.getAchievement()`, `getAllAchievements()`, `saveAchievement()`
- `Storage.getPref()`, `setPref()`, `getAllPrefs()`
- `Storage.getNotes()`, `setNotes()` (via low-level `get`/`put`)
- `Storage.getBackupLog()`, `addBackupLog()`, `clearBackupLog()`
- `Storage.exportAll()` — returns v2.0 JSON with entries + deletedEntries + achievements + preferences
- `Storage.importAll(backup)` — merge strategy as described in Section 9
- `Storage.resetAll()` — clears all stores for current user
- `Storage.saveDirectoryHandle()`, `getDirectoryHandle()` — persist folder handle in `LearnTrackHandles`

---

## 13. Analytics Engine

**Module:** `analytics.js`

| Function | Output |
|---|---|
| `toDateStr(date)` | `"YYYY-MM-DD"` local (via `Intl.DateTimeFormat`) |
| `today()` | Today's date string |
| `daysAgo(n)` | Date n days back |
| `daysBetween(a, b)` | Integer day count |
| `startOfWeek(dateStr)` | Sunday of the week containing the date |
| `formatDuration(min)` | `"Xh Ym"`, `"Xh"`, or `"Xm"` |
| `formatHours(min)` | Alias for `formatDuration` |
| `buildDateMap(entries)` | `{ date: [entries] }` |
| `calculateStreaks(entries)` | `{ current, longest, activeDates }` |
| `calculateTotalStats(entries)` | `{ totalMinutes, totalHours, totalEntries, uniqueDays, avgMinutesPerDay }` |
| `calculateConsistency(entries, days)` | `%` active days in window |
| `calculateWeeklySummary(entries)` | Week totals + daily breakdown (Mon–Sun) |
| `calculateMonthlySummary(entries)` | Month totals + goal % |
| `calculateMonthlyTotals(entries, months)` | Last N months as `[{ label, minutes, hours }]` |
| `calculateDailyTimeSeries(entries, days)` | Daily hours array |
| `calculateTopicDistribution(entries, knownCategories?)` | `[{ label, minutes, hours }]` sorted; optional category whitelist groups unknowns as "Uncategorized" |
| `calculateHeatmapData(entries)` | 52-week grid with 5-level intensity (0–4) |
| `calculateLearningCurve(entries)` | `{ points, momentum, plateau, burnout }` — computed but **not charted** |
| `bestLearningDay(entries)` | Day-of-week name (3-letter) |
| `missedDays(entries, days)` | `{ missed, window }` |

---

## 14. Charts

**Module:** `charts.js` (Chart.js wrappers)

| Function | Chart type | Used on |
|---|---|---|
| `renderDailyTimeChart(id, data)` | Line | Dashboard (daily range tab) |
| `renderTopicChart(id, data)` | Doughnut | Dashboard (category range tab) |
| `renderMonthlyChart(id, data)` | Bar | Dashboard (monthly range tab) |
| `renderHeatmap(containerId, data)` | Custom DOM grid | Dashboard |
| `renderSparklineChart(id, data)` | Mini line | Dashboard weekly summary card |
| `renderLearningCurveChart(id, curveData)` | Line (dual dataset) | Exists in charts.js but **not called** |
| `renderDashboardCurve(id, curveData)` | Mini line | Exists in charts.js but **not called** |
| `refreshAllCharts()` | — | Re-creates all active charts with current theme/accent colors |
| `resizeAllCharts()` | — | Calls `.resize()` on all active Chart.js instances (used on sidebar toggle) |
| `destroyChart(id)` | — | Cleanup before re-render |

Charts read accent/text/border colors live from CSS custom properties via `getComputedStyle`, so they update automatically on theme/accent changes. `refreshAllCharts()` fully recreates each chart (not in-place patch) because Chart.js caches resolved styles.

Mobile heatmap: clips to show only complete months that fit without horizontal scroll, trimmed to a clean month boundary.

---

## 15. Insights Engine

**Module:** `insights.js`

| Function | Purpose |
|---|---|
| `getDailyQuote()` | Rotating motivational quote (changes daily, index by day number) |
| `getRandomQuote()` | Random quote on demand |
| `getGreeting(username)` | Time-of-day greeting (morning/afternoon/evening), chosen randomly from 3 variants |
| `generateInsights(entries, streak, stats, consistency, curve)` | Returns up to 4 insight card objects |
| `renderInsightsRow(containerId, insights)` | Renders insights grid to DOM |
| `renderCurveInsights(containerId, curve)` | Renders momentum/plateau/burnout chips |
| `getStreakInsight(streak, consistency)` | Returns motivational string |
| `getNextMilestone(entries, streak, stats)` | Closest incomplete milestone (from fixed candidate list) |
| `generateRecommendations(entries, streak, stats, consistency)` | Learning tip cards |

---

## 16. Rewards Engine

**Module:** `rewards.js`

| Function | Purpose |
|---|---|
| `calculateEntryXP(entry)` | XP for a single entry (base × difficulty × mood) |
| `calculateDailyGoalXP(entries, dailyGoalMin, goalHistory)` | Bonus XP for each day goal was met (uses historical goal values) |
| `calculateMedals(entries, dailyGoalMin, goalHistory)` | Count of gold/silver/bronze days |
| `calculateTotalXP(entries, streak, dailyGoalMin, goalHistory)` | Total XP = entry XP + goal bonus, then streak multiplier |
| `getLevelInfo(totalXP)` | Returns `{ level, title, xpIntoLevel, xpNeededForNext, progressPct, nextLevel, totalXP }` |
| `checkAndAwardAchievements(entries, streak, stats, consistency, goalMin, goalHistory)` | Checks all ACHIEVEMENTS, saves newly unlocked to Storage, returns array of newly earned |
| `revokeStaleAchievements(entries, streak, stats, consistency, goalMin, goalHistory)` | Removes achievements from Storage whose condition is no longer met |
| `buildAchievementList(entries, streak, stats, consistency, goalMin, goalHistory)` | Full list of all achievements with earned state and progress for display |
| `fireConfetti(type)` | Confetti burst — types: `'achievement'`, `'levelup'`, `'streak'` |
| `showXPFloat(amount, originEl)` | Animates `+N XP` float near the triggering element |

---

## 17. UI & Design System

### CSS Custom Properties (variables)
- `--accent` — accent color (changes with theme and accent setting)
- `--surface`, `--surface-2` — card backgrounds
- `--border` — divider/border color
- `--text-1`, `--text-2`, `--text-3` — text hierarchy
- `--r-sm`, `--r-md`, `--r-lg` — border radius scale
- `--s-1` … `--s-8` — spacing scale
- `--shadow-sm`, `--shadow-md`, `--shadow-lg` — shadow levels

### Compact Mode
App always launches in compact mode (`compact: true` default). Compact mode applies tighter padding, smaller font sizes, and reduced gaps via `.compact-mode` class on `<body>`. The setting is also exposed as a toggle in Settings.

### Themes
- Light and Dark modes, toggled by sidebar switch or Settings page (button toggle)
- Theme stored in preferences, applied on load
- CSS handles full theme via variable overrides on `[data-theme="dark"]`

### Animations
- Page fade-in transitions
- Hover lift effect (`.hover-lift`)
- Confetti on badge unlock
- Animated XP counter (`animateCounter()`)
- XP float animation (`.xp-float`)
- Smooth chart transitions (Chart.js animations)
- Toast notifications (slide-in/out)
- Sidebar backup status chip pop animation (`sbs-pop`)
- Fullscreen Pomodoro quote fade transition

---

## 18. Toast Notifications

4 types: info, success, warning, error.  
Auto-dismiss after 3.5 s. Manual close button. Stack vertically.

---

## 19. Accessibility

- Semantic HTML (nav, main, section, article, button, label)
- ARIA labels on icon-only buttons
- ARIA `role="gridcell"` on heatmap cells
- ARIA `role="button"` + `tabindex="0"` on calendar day cells
- ARIA `aria-current="page"` on active nav items
- ARIA `aria-live="polite"` on backup status chip
- Keyboard navigation (Enter / Space on custom controls; Escape exits Pomodoro fullscreen or closes open panel/modal)
- Focus indicators
- Color contrast ratios meet WCAG AA for default themes

---

## What Was Planned But Not Implemented

| Feature | Status |
|---|---|
| Learning Curve chart | `calculateLearningCurve()` and `renderLearningCurveChart()` exist, but no chart is rendered anywhere in the UI |
| CSV export | Not implemented; only JSON backup + PDF report |
| Service worker / offline-first PWA | `manifest.json` is present; no service worker |
| AI-generated insights | Not implemented |
| Drag-and-drop dashboard widgets | Not implemented |
| Social / sharing features | Not implemented |
| External calendar sync | Not implemented |
| Tags as primary filter in UI | Tags stored and searchable but no dedicated tag filter chip |
| Image/screenshot attachments | Not implemented |
