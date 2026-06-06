# Learn Tracker

A personal learning journal — log study sessions, track goals, visualize progress, and earn achievements.

## Features

- **Daily Log** — Record sessions by topic, category, duration, difficulty (easy / medium / hard), and mood. Full search, filter, and soft-delete with a 90-day recycle bin.
- **Dashboard** — Live stats, streak counter, charts (daily/monthly/category), heatmap, and a top-goals widget.
- **Goals** — Time-based, count-based, checklist, and exam goals. Link log entries to goals; track progress rings.
- **Reports** — Generate a PDF monthly report entirely in-browser via jsPDF (no server required).
- **Calendar** — Month grid view; click any day to see or add entries.
- **Achievements** — XP system, levels, badges, and medals unlocked by study behavior.
- **Multiple Profiles** — Each user gets an isolated IndexedDB database. Switch profiles from the sidebar.
- **Auto-Backup** — Writes a JSON snapshot to a folder you choose via the File System Access API (requires `localhost`).
- **Settings** — Custom categories, category colors, daily/monthly goals, appearance (theme, accent, compact mode), and reminders.

---

## Getting Started

### Prerequisites

- A modern browser (Chrome, Edge, or any browser with ES module and IndexedDB support)
- Node.js (only needed to run the dev server or tests)

### Running the App

The app uses `<script type="module">`, so it **cannot** be opened as a `file://` URL — it must be served over HTTP.

Pick any static server from the project root:

```bash
# Option 1 — npx (no install needed)
npx serve

# Option 2 — Python
python -m http.server 8000

# Option 3 — VS Code
# Install the "Live Server" extension, then click "Go Live" in the status bar
```

Then open the printed `http://localhost:…` URL in your browser.

> **First launch:** a modal will ask you to pick a backup folder. This is required before the app opens. Choose any folder on your machine (or create a new one). The app will write automatic JSON backups there after every save.

### Running Tests

```bash
npm install   # first time only
npm test
```

The Jest suite covers pure analytics and goal logic (no DOM, no browser required). There are currently 196 passing tests across two files:

- `tests/analytics.test.js`
- `tests/academic-goals.test.js`

---

## Project Structure

```
Learn Tracker/
├── index.html                  # SPA shell — all 11 pages as <section> elements
├── scripts/
│   ├── main.js                 # ES module entry point — boots on DOMContentLoaded
│   ├── app/                    # App ES modules (split from the original app.js)
│   │   ├── state.js            # Shared mutable state, constants, DEFAULT_PREFS, debounce
│   │   ├── core.js             # init(), loadAndShowApp(), auto-backup, fatal-error
│   │   ├── nav.js              # navigateTo(), sidebar, mobile nav, renderPage() dispatch
│   │   ├── dashboard.js        # Dashboard renderers + chart wiring
│   │   ├── log.js              # Daily Log — entry list, entry modal, notes panel
│   │   ├── deleted-logs.js     # Deleted Logs recycle bin
│   │   ├── goals.js            # Goals page, goal modal, link-goal modal, deleted goals
│   │   ├── reports.js          # Report preview + PDF generation (jsPDF)
│   │   ├── achievements.js     # Achievements page + badge queue
│   │   ├── settings.js         # Settings page, categories CRUD, backup page
│   │   ├── widgets.js          # Clock, reminder, Pomodoro, theme/accent/compact
│   │   ├── users.js            # UserManager + user picker / profile management
│   │   └── utils.js            # setEl, escapeHtml, safeHref, showToast, formatters, modals
│   ├── storage.js              # IndexedDB wrapper (classic global: Storage)
│   ├── analytics.js            # Pure analytics functions (classic global: Analytics)
│   ├── charts.js               # Chart.js wrappers (classic global: Charts)
│   ├── rewards.js              # XP, levels, badges, achievements (classic global: Rewards)
│   ├── calendar.js             # Calendar widget (classic global: Calendar)
│   ├── insights.js             # Insights / quotes (classic global: Insights)
│   └── timer.js                # Pomodoro timer (classic global: PomodoroTimer)
├── styles/
│   ├── tokens.css              # CSS custom properties — load first
│   ├── base.css                # Reset, base elements
│   ├── layout.css              # Sidebar, main content, page framework
│   ├── buttons.css / forms.css / modals.css / feedback.css
│   ├── log.css / goals.css / calendar.css / achievements.css
│   ├── timer.css               # Pomodoro panel
│   ├── responsive.css          # All @media blocks
│   ├── compact-mode.css        # .compact-mode overrides (default layout)
│   ├── dashboard.css           # Dashboard widgets
│   └── animations.css          # Keyframe animations
├── tests/
│   ├── analytics.test.js
│   └── academic-goals.test.js
├── package.json
└── CLAUDE.md                   # Contributor / AI guidance
```

---

## Architecture

### Single-Page Application

`index.html` holds every page as a `<section data-page="…">`. Navigation is done by toggling CSS classes — no URL routing, no history API.

### Two Module Systems

| Layer | Pattern | Examples |
|---|---|---|
| Shared libraries | Classic IIFE globals | `Storage`, `Analytics`, `Charts`, `Rewards`, `Calendar`, `Insights`, `PomodoroTimer` |
| App code | ES modules (`import`/`export`) | `scripts/app/*.js` + `scripts/main.js` |

Classic library scripts load first, so their globals exist before the ES module entry point runs. App modules read these globals as ambient values **only inside functions** — never at module top level.

### Shared State

All cross-module mutable state is on a single exported `state` object in `scripts/app/state.js`. Modules import it and mutate properties (`state.entries = [...]`). Never reassign the `state` binding itself.

### Storage

Data is stored in **IndexedDB** (one database per user profile). Analytics functions are pure — they receive data as arguments and return computed values without touching storage directly.

### External Dependencies (CDN)

| Library | Purpose |
|---|---|
| [Chart.js](https://www.chartjs.org/) | All charts |
| [jsPDF](https://github.com/parallax/jsPDF) | PDF report generation |
| [canvas-confetti](https://github.com/catdad/canvas-confetti) | Achievement unlock animations |
| [Google Fonts](https://fonts.google.com/) | Inter typeface |

All four are loaded from CDN and degrade gracefully when offline.

---

## Pages

| Page | Description |
|---|---|
| Dashboard | Stats overview, charts, heatmap, insights, open goals |
| Daily Log | Add / edit / delete learning sessions |
| Deleted Logs | Restore or permanently delete soft-deleted entries |
| Reports | Generate and download a monthly PDF report |
| Calendar | Month grid — view or add entries by day |
| Goals | Create and track academic goals |
| Deleted Goals | Restore or permanently delete soft-deleted goals |
| Achievements | XP progress, level, badges, and medals |
| Profiles | Create, switch, and manage user profiles |
| Settings | Appearance, categories, daily/monthly goals, reminders |
| Backup | Export or import your data as JSON |

---

## Contributing

Run `npm test` before committing any changes to analytics or goal logic. See [CLAUDE.md](CLAUDE.md) for architectural conventions, patterns to follow, and things to avoid.
