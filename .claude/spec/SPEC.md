# LearnTrack — As-Built Product Specification

**Version:** 1.0.0  
**Last updated:** 2026-05-30  
**Status:** Implemented & live

---

## Overview

LearnTrack is a frontend-only, browser-based SPA for tracking daily learning activity. It runs entirely in the browser with no backend, persists all data via IndexedDB, and works across desktop and mobile.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Markup | HTML5 |
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
├── styles/
│   └── main.css            — All styles, CSS variables, responsive, themes
├── scripts/
│   ├── app.js              — Core app, routing, page renderers, PDF report
│   ├── storage.js          — IndexedDB wrapper, per-user stores
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
- App logo + LearnTrack title
- Nav links: Dashboard, Daily Log, Analytics, Calendar, Achievements, Profiles, Settings, Backup
- Dark/Light theme toggle switch
- App version label

### Bottom nav (mobile)
Five items: Home (Dashboard), Log, + (FAB — opens Add Entry modal), Stats (Analytics), Awards (Achievements)

### Pages (8 total)

| Page id | Route | Description |
|---|---|---|
| `dashboard` | default | Overview, stats, widgets |
| `log` | Daily Log | Entry list, search, filter |
| `analytics` | Analytics | Charts, insights, PDF report |
| `calendar` | Calendar | Month grid, day panel, streaks |
| `achievements` | Achievements | Badges, XP, level, medals |
| `profiles` | Profiles | Multi-user management |
| `settings` | Settings | Appearance, goals, categories |
| `backup` | Backup & Restore | JSON export/import per user |

---

## 1. Dashboard

### Stats Grid (6 cards)
- **Total Hours** — cumulative time studied, with weekly trend indicator
- **Current Streak** — active streak days; sub-stat shows longest streak
- **Total Entries** — all-time log count
- **Avg Hours/Day** — total hours ÷ active days
- **Consistency** — % of last 30 days with at least one entry
- **Level** — current XP level with inline progress bar

### Insights Strip (7 cards, auto-fit grid)
Cards rendered by `insights.js generateInsights()`. No horizontal scroll — grid fills full width.

1. Best Day to Learn — day-of-week with highest avg session
2. Avg Session — total minutes ÷ total entries
3. Consistency — % of last 30 days active
4. Most Studied — top topic by total time
5. Current Streak — streak days + best streak
6. Total Hours — cumulative time across all active days
7. Topics Explored — count of unique topic labels

### Goal Progress
- **Daily Goal ring** — SVG circle showing today's logged time vs. daily goal (minutes)
- **Weekly Goal dots** — 7 day-of-week circles (green = goal met, amber = partial, gray = no entry)
- **Today Summary** — time logged today, entry count, top topic, "+ Log Entry" button

### Summary Row (3 cards)
- This Week — hours, entries, 7-day mini bar chart
- This Month — hours, entries, progress bar vs. monthly goal (hours)
- Next Milestone — closest unearned achievement with progress bar

### Medals Card
Separate widget. Gold / Silver / Bronze counts.

### Achievements Preview Card
Separate widget. Mini badge grid of earned badges. "View all" link → Achievements page.

> **Note:** Medals and Achievements are two separate cards, with Medals appearing first.

### Recent Activity Feed
Last 5 entries. Each shows topic, duration, category. "View all" links to Daily Log.

---

## 2. Daily Log

### Add / Edit Entry Modal

| Field | Type | Validation |
|---|---|---|
| Date | Read-only text, auto-filled to today | — |
| Duration | Number input (minutes) | Required, 1–1440 |
| Topic | Text input | Required |
| Category | Select dropdown (user-defined list) | — |
| Difficulty | Select: Beginner / Intermediate / Advanced / Expert | — |
| Mood | 5-button selector (😞 😐 🙂 😊 🚀, values 1–5) | — |
| Tags | Comma-separated text | — |
| Notes | Textarea (5 rows) with character count | Autosaves with indicator |
| Resources | Dynamic list — add/remove rows (type, title, URL) | — |

Notes autosave triggers after 800 ms of inactivity. Visual indicator shows: Saving… / Saved / Save failed.

### Entry List
- Grouped by month (collapsible sections)
- Each card shows: date badge, topic, category pill, difficulty, mood emoji, duration badge, tags, notes preview (90 chars), resource link icons, overflow menu (Edit / Duplicate / Delete)
- Pagination: 20 entries per page with "Load more"

### Search & Filter
- Keyword search (topic, notes, category, tags)
- Date range picker
- Category filter
- Difficulty filter
- Sort: Newest / Oldest / Longest duration

---

## 3. Analytics

### Charts (4 total)

| Chart | Type | Description |
|---|---|---|
| Daily Learning Time | Line | Hours per day for selected range |
| Topic Distribution | Doughnut | Top 10 topics by total time |
| Monthly Progress | Bar | Last 12 months total hours |
| Activity Heatmap | Custom grid | 52-week GitHub-style contribution heatmap, 5-level intensity |

> **Learning Curve chart was removed.** The `calculateLearningCurve()` analytics function still exists but is not rendered as a visualization anywhere in the UI.

### Time Range Selector
Dropdown: Last 7 days / Last 30 days / Last 90 days / Last year / All time

### Insights Strip
Same 7-card strip as Dashboard (re-rendered with selected range data).

### PDF Monthly Report
Triggered by "PDF Report" button. Uses **jsPDF** for native vector PDF (text is selectable/searchable).

Report contents:
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
- Table always spans full page width
- Text wraps within all columns (no clipping)
- Difficulty values are title-cased (Beginner, not beginner)
- Cell content is vertically centered
- Resource titles are clickable links; URL shown as plain gray text below

Report options checkboxes: Include Notes / Include Resources

---

## 4. Calendar

- Full month grid with day-header row (Sun–Sat)
- Day cells: date number + activity dot (4 intensity levels based on minutes) + entry count
- Other-month days shown dimmed
- Today highlighted; selected day highlighted
- Prev/Next/Today navigation buttons
- Click a day → right-side **Day Panel** shows entry list for that date
- Day Panel: day header, entry list (topic + duration + category), Quick Add button (today only), View Entries button

### Streak Stats (below calendar)
- Current Streak
- Longest Streak
- Missed Days (last 30 days)
- Motivational streak message

---

## 5. Achievements

### XP Hero Section
- Level ring (SVG circle progress)
- Level name + XP progress bar (current XP / next level threshold)
- Total XP card
- Badges earned count

### Levels (12 total)

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

### XP Calculation
- Base: 1 XP per minute logged
- Difficulty multiplier: Beginner 1×, Intermediate 1.5×, Advanced 2.2×, Expert 3×
- Mood bonus multiplier: mood 1 → 0.8×, mood 5 → 1.25× (linear)
- Daily goal bonus: `goal_minutes × 0.5` XP (once per day, when goal met)
- Streak multiplier (applied on top): 3-day 1.2×, 7-day 1.4×, 14-day 1.6×, 30-day 2.0×

### Medals (Daily Performance)
Based on difficulty-weighted score for the day vs. daily goal:
- Bronze: score ≥ 1.5× daily goal
- Silver: score ≥ 2× daily goal
- Gold: score ≥ 3× daily goal

### Achievements Grid
40+ badges across 9 categories. Filter tabs: All / Earned / Locked.

Each badge card: icon, name, description, progress bar, XP reward, lock/unlock state.

**Categories:**
1. First Steps — first entry, 10/25/50/100 entries
2. Streaks — 3/7/14/30/100-day streaks, Comeback Kid
3. Total Hours — 5/10/25/50/100/200/500 hours
4. Daily Goal — first goal met, 7-day goal streak, 30 days, Overachiever
5. Single Day — Deep Focus (3 h), Marathon Day (5 h)
6. Quality — Advanced/Expert Learner, Polymath, Thoughtful Notes, Resource Collector
7. Topics — Topic Master, Category Explorer, Multi-topic, Diverse Learner
8. Time of Day — Early Bird, Lunch Learner, Night Owl, Weekend Warrior
9. Consistency & Long-term — Consistency Master, Perfect Week, Monthly Dedication, Veteran (90 days)

### Badge Unlock Flow
- Modal animation on first unlock
- Confetti celebration (canvas-confetti)
- Queue system: shows one badge at a time if multiple unlock together

### Rewards Guide (collapsible)
In-page expandable section explaining XP sources, streak multipliers, medal logic, and level thresholds.

---

## 6. Profiles

Multi-user system. Each user gets a separate IndexedDB database.

- **Default user** → `LearnTrackDB`
- **Additional users** → `LearnTrackDB_u${timestamp}`
- Per-user localStorage keys for preferences

### Profile List
Each row: avatar (initials circle, color-coded), username, created date, Edit / Delete / Switch buttons.

### Add Profile
Modal with username field. New profile starts with empty data.

### Switching Profiles
Full app reload with new user's data.

---

## 7. Settings

### Profile
- Display Name
- Daily Goal (minutes, 5–720)
- Monthly Goal (hours, 1–200)

### Appearance
- Dark / Light theme toggle
- Accent color swatches (6: purple, blue, green, orange, pink, red)

> Compact mode is the **default and only mode**. The Normal/Compact toggle has been removed.

### Categories
- View / Add / Remove custom categories used in entry form

### Notifications
- Daily Reminder toggle
- Reminder Time picker (shown when enabled)
- Test Notification button

### Danger Zone
- Reset All Data (permanent delete of current user's data)

---

## 8. Backup & Restore

Per-profile JSON backup using **File System Access API** (with file-picker fallback for unsupported browsers).

### Backup
- Shows profile name, entry count, last backup date, filename
- "Backup Now" — writes `learntrack-backup-${profileName}.json` to user-selected folder
- Folder selection persisted; same folder used for future backups

### Restore
- "Load Backup" — auto-reads from configured folder (if available)
- "Browse File" — manual file picker
- Validates JSON structure before import
- First-launch import: replaces default empty profile
- Existing-data import: creates new profile with imported username
- Reports merge stats: new / updated / skipped entry counts

### Backup History
Last 5 backup/import operations with timestamp and type (💾 export / 📂 import).

### Backup JSON Format
```json
{
  "version": "1.0",
  "appName": "LearnTrack",
  "timestamp": 1234567890,
  "data": {
    "entries": [],
    "achievements": [],
    "preferences": {},
    "backupLog": []
  }
}
```

---

## 9. Pomodoro Timer & Stopwatch

Floating panel (bottom-right FAB, 🍅 icon). Collapsible.

### Pomodoro
- 3 modes: Focus (25 min default), Short Break (5 min), Long Break (15 min)
- Adjustable durations: work 1–90 min, breaks 1–30/60 min
- Presets: 15 / 25 / 45 / 60 min for work mode
- Countdown ring visualization
- Audio alert on completion (different tones for work vs. break)
- Session counter
- Gradient background changes per mode
- Browser title updates while running
- Requests notification permission for completion alerts

### Stopwatch
- Start / Pause / Resume / Reset
- Displays up to hours

---

## 10. Data Models

### Learning Entry
```javascript
{
  id: "timestamp-random",      // string, unique
  date: "YYYY-MM-DD",          // local date string
  topic: "string",             // required
  category: "string",
  durationMinutes: number,     // required, 1–1440
  difficulty: "beginner|intermediate|advanced|expert",
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

### Preferences
```javascript
{
  username: string,
  theme: "light|dark",
  accent: "purple|blue|green|orange|pink|red",
  compact: boolean,            // default true
  dailyGoalMin: number,
  monthlyGoalHr: number,
  reminder: boolean,
  reminderTime: "HH:MM",
  categories: [string],
  goalHistory: []              // for consistent XP calculation across time
}
```

---

## 11. Storage Engine

**Module:** `storage.js`  
**Primary:** IndexedDB  
**Fallback:** localStorage

### Object Stores (per user DB)

| Store | Purpose | Key indexes |
|---|---|---|
| `entries` | Learning log entries | date, category, topic |
| `achievements` | Earned badge records | — |
| `preferences` | User settings | — |
| `notes` | Full notes text (keyed by entry id) | — |
| `backupLog` | Last 5 backup/import operations | — |

### Key Functions
- `Storage.init(userId)` — open or create per-user DB
- `Storage.addEntry()`, `getEntry()`, `updateEntry()`, `deleteEntry()`, `getAllEntries()`
- `Storage.getAchievements()`, `setAchievements()`
- `Storage.getPref()`, `setPref()`, `getAllPrefs()`
- `Storage.getNotes()`, `setNotes()`
- `Storage.getBackupLog()`, `addBackupLog()`
- `Storage.importAll()`, `exportAll()`

---

## 12. Analytics Engine

**Module:** `analytics.js`

| Function | Output |
|---|---|
| `toDateStr(date)` | `"YYYY-MM-DD"` local |
| `today()` | Today's date string |
| `daysAgo(n)` | Date n days back |
| `daysBetween(a, b)` | Integer day count |
| `formatDuration(min)` | `"Xh Ym"` or `"Xm"` |
| `buildDateMap(entries)` | `{ date: [entries] }` |
| `calculateStreaks(entries)` | `{ current, longest, activeDates }` |
| `calculateTotalStats(entries)` | `{ totalMinutes, totalHours, totalEntries, uniqueDays, avgMinutesPerDay }` |
| `calculateConsistency(entries, days)` | `%` active days in window |
| `calculateWeeklySummary(entries)` | Week totals + daily breakdown |
| `calculateMonthlySummary(entries)` | Month totals + goal % |
| `calculateMonthlyTotals(entries, months)` | Last N months |
| `calculateDailyTimeSeries(entries, days)` | Daily hours array |
| `calculateTopicDistribution(entries)` | `[{ label, minutes, count }]` sorted |
| `calculateHeatmapData(entries)` | 52-week grid with 5-level intensity |
| `calculateLearningCurve(entries)` | `{ points, momentum, plateau, burnout }` — computed but not charted |
| `bestLearningDay(entries)` | Day-of-week name |
| `missedDays(entries, days)` | `{ missed, window }` |

---

## 13. Charts

**Module:** `charts.js` (Chart.js wrappers)

| Function | Chart type | Used on |
|---|---|---|
| `renderDailyTimeChart(id, data)` | Line | Analytics |
| `renderTopicChart(id, data)` | Doughnut | Analytics |
| `renderMonthlyChart(id, data)` | Bar | Analytics |
| `renderHeatmap(containerId, data)` | Custom DOM grid | Analytics |
| `renderWeekBars(id, data)` | Mini bar | Dashboard (This Week card) |
| `renderGoalRing(id, pct)` | SVG ring | Dashboard |
| `destroyChart(id)` | — | Cleanup before re-render |

> `renderLearningCurveChart()` and `renderDashboardCurve()` still exist in charts.js but are no longer called.

---

## 14. Insights Engine

**Module:** `insights.js`

| Function | Purpose |
|---|---|
| `getDailyQuote()` | Rotating motivational quote (changes daily) |
| `getRandomQuote()` | Random quote on demand |
| `getGreeting(username)` | Time-of-day greeting message |
| `generateInsights(entries, streak, stats, consistency, curve)` | Returns 7 insight card objects |
| `renderInsightsRow(containerId, insights)` | Renders insights grid to DOM |
| `renderCurveInsights(containerId, curve)` | Renders momentum/plateau/burnout chips |
| `getStreakInsight(streak)` | Returns motivational string |
| `getNextMilestone(achievements, entries)` | Closest unearned achievement |
| `generateRecommendations(entries, stats)` | Learning tip cards |

---

## 15. Rewards Engine

**Module:** `rewards.js`

| Function | Purpose |
|---|---|
| `calculateEntryXP(entry)` | XP for a single entry (base × difficulty × mood) |
| `calculateDailyGoalXP(entries, date, goalMin)` | Bonus XP when daily goal met |
| `calculateMedals(entries, goalMin)` | Count of gold/silver/bronze days |
| `calculateTotalXP(entries, prefs)` | Total XP across all entries |
| `getLevelForXP(xp)` | Returns `{ level, name, xpForLevel, xpForNext }` |
| `checkAchievements(entries, prefs, streak)` | Returns newly unlocked achievements |
| `calculateAchievementProgress(id, entries, prefs, streak)` | Progress value for a badge |

---

## 16. UI & Design System

### CSS Custom Properties (variables)
- `--accent` — accent color (changes with theme)
- `--surface`, `--surface-2` — card backgrounds
- `--border` — divider/border color
- `--text-1`, `--text-2`, `--text-3` — text hierarchy
- `--r-sm`, `--r-md`, `--r-lg` — border radius scale
- `--s-1` … `--s-8` — spacing scale
- `--shadow-sm`, `--shadow-md`, `--shadow-lg` — shadow levels

### Compact Mode
App always launches in compact mode (`compact: true` default). Compact mode applies tighter padding, smaller font sizes, and reduced gaps across all sections via `.compact-mode` class on `<body>`.

### Themes
- Light and Dark modes, toggled by sidebar switch or Settings page
- Theme stored in preferences, applied on load
- CSS handles full theme via variable overrides on `[data-theme="dark"]`

### Animations
- Page fade-in transitions
- Hover lift effect (`.hover-lift`)
- Confetti on badge unlock
- Animated XP counter
- Smooth chart transitions (Chart.js animations)
- Toast notifications (slide-in/out)

---

## 17. Toast Notifications

4 types: info, success, warning, error.  
Auto-dismiss after 3.5 s. Manual close button. Stack vertically.

---

## 18. Accessibility

- Semantic HTML (nav, main, section, article, button, label)
- ARIA labels on icon-only buttons
- Keyboard navigation (Enter / Space on custom controls)
- Focus indicators
- Role attributes on custom interactive elements
- Color contrast ratios meet WCAG AA for default themes

---

## What Was Planned But Not Implemented

| Feature | Status |
|---|---|
| Learning Curve chart | Function exists (`calculateLearningCurve`), no chart rendered |
| CSV export | Not implemented; only JSON backup + PDF report |
| Service worker / offline-first PWA | Not implemented |
| AI-generated insights | Not implemented |
| Drag-and-drop dashboard widgets | Not implemented |
| Social / sharing features | Not implemented |
| External calendar sync | Not implemented |
| Tags as primary filter in UI | Tags stored and searchable but no dedicated tag filter chip |
| Image/screenshot attachments | Not implemented |
