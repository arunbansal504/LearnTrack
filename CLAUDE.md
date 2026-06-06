# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Your Role

You are an expert front-end developer with 20+ years of experience building highly professional, production-grade web applications — including large-scale projects at companies like Google. Apply that depth of expertise to every code suggestion, review, and architectural decision in this project.

---

## Running the App

There is no build step or bundler, but the app **must be served over http(s) / localhost** — the application code is loaded as ES modules (`<script type="module">`), and browsers block module imports over the `file://` protocol. Opening `index.html` directly will fail with CORS/module errors.

Run any static server from the project root and open the served URL:

```
# Pick one — both serve the current directory:
npx serve                    # then open the printed http://localhost:3000
python -m http.server 8000   # then open http://localhost:8000
# Or use the VS Code "Live Server" extension → "Open with Live Server".
```

`localhost` is a secure context, so the File System Access auto-backup (`showDirectoryPicker`) still works.

All external dependencies (Chart.js, canvas-confetti, jsPDF, Google Fonts) are loaded from CDN as classic global scripts. If offline, these degrade gracefully: chart renderers (`charts.js`) guard on `typeof Chart` and show an inline "Charts unavailable" placeholder, PDF export guards on `window.jspdf`, and confetti calls guard on `typeof confetti`.

---

## Tests

There is a Jest suite at `tests/academic-goals.test.js` (pure-logic tests that replicate goal/analytics behavior — no DOM, no app import). Run it with:

```
npm install   # one-time, installs jest as a devDependency
npm test      # runs jest
```

There is no CI wired up yet; run `npm test` locally before committing logic changes.

---

## Architecture

### Single-file SPA

`index.html` contains every page as a `<section data-page="...">` element. Navigation works by showing/hiding these sections — no URL routing, no history API. The active section is toggled by `navigateTo(pageId)` (in `scripts/app/nav.js`).

### Two module systems (important)

The codebase mixes two patterns on purpose:

1. **Shared libraries — classic global IIFEs.** `storage.js`, `analytics.js`, `charts.js`, `rewards.js`, `calendar.js`, `insights.js`, `timer.js` each expose a single global via the IIFE pattern:
   ```js
   const ModuleName = (() => { /* private state */ return { ... }; })();
   ```
   These expose the globals `Storage`, `Analytics`, `Charts`, `Rewards`, `Calendar`, `Insights`, `PomodoroTimer`. They are loaded as **classic** `<script>` tags and are **not** ES modules.

2. **The app itself — ES modules** under `scripts/app/`. `app.js` was split into ~12 focused ES modules plus `scripts/app/state.js` (shared state) and a `scripts/main.js` entry point. They use real `import`/`export`. The app modules read the shared-library globals (`Storage`, etc.) and CDN globals (`Chart`, `confetti`, `window.jspdf`) as **ambient globals** — *only inside functions, never at module top level* (top-level reads can run before a global exists). Do not `import` those; they aren't modules.

**Load order in `index.html`:** the 7 classic library scripts load first (so their globals exist), then `<script type="module" src="scripts/main.js">`. Classic scripts run before deferred modules, so ordering among the app modules doesn't matter — only `state.js` is conceptually first (everything imports it).

App modules (`scripts/app/`): `state` (shared state + constants + `debounce`), `utils`, `users`, `nav`, `dashboard`, `log`, `deleted-logs`, `goals`, `reports`, `achievements`, `settings`, `widgets`, `core`. `main.js` imports `init`/`navigateTo`/`showToast`, exposes them on `window.App` (for inline handlers / console), and boots on `DOMContentLoaded`.

### Shared state

All cross-module mutable state lives on the single `state` object exported by `scripts/app/state.js`. Modules `import { state }` and mutate properties (`state.entries = [...]`, `state.prefs`, `state.goals`, `state.earnedAch`, …). **Never reassign the `state` binding itself** — imports are read-only; mutating a property is how state is shared. (Formerly these were `_entries`, `_prefs`, etc. closure vars inside the `App` IIFE.)

### Data Flow

1. On init, `init()` calls `Storage.init(userId)` to open the correct IndexedDB database
2. All entries are loaded into `state.entries`
3. Every page render reads from `state.entries` in memory — no async DB reads during render
4. Writes go through `Storage.*` methods and update `state.entries` in place
5. Analytics functions in `analytics.js` are pure — they take `entries` as a parameter and return computed values

### Per-User Storage

Each user profile maps to a separate IndexedDB database:
- First (default) user → `LearnTrackDB`
- Additional users → `LearnTrackDB_u${timestamp}`

`UserManager` (in `scripts/app/users.js`) reads the user list and active user from plain `localStorage` keys (`lt_users`, `lt_active_user`) because IndexedDB isn't open yet when the user picker runs.

A separate IndexedDB `LearnTrackHandles` stores the File System Access API directory handle globally across all profiles.

---

## Pages (11 total)

| Page id | Purpose |
|---|---|
| `dashboard` | Stats, insights, charts, activity feed |
| `log` | Entry list, search, filter, add/edit |
| `deleted-logs` | Recycle bin — restore or permanently delete soft-deleted entries (auto-purged after 90 days) |
| `reports` | PDF monthly report generation with preview |
| `calendar` | Month grid, day panel |
| `goals` | Academic goals — create/track time, count, checklist, exam goals |
| `deleted-goals` | Recycle bin for goals — restore or permanently delete |
| `achievements` | XP, levels, badges, medals |
| `profiles` | Multi-user management |
| `settings` | Appearance, goals, categories |
| `backup` | JSON export/import per user |

> There is **no separate Analytics page**. All charts and insights are embedded in the Dashboard.

---

## Entry Object Shape

Every learning entry stored in IndexedDB has this shape:

```js
{
  id:              String,   // e.g. "1717000000000-abc1234"
  date:            String,   // "YYYY-MM-DD" in user's local timezone
  topic:           String,
  category:        String,   // one of _prefs.categories
  durationMinutes: Number,
  difficulty:      String,   // "easy" | "medium" | "hard"
  moodScore:       Number,   // 1–5
  notes:           String,
  resources:       Array,    // [{ label, url }]
  createdAt:       Number,   // Unix ms
  updatedAt:       Number,   // Unix ms
}
```

Entries in the `deletedEntries` store carry an additional `deletedAt: Number` field.

---

## Preferences Shape

`_prefs` is merged from `DEFAULT_PREFS` and the stored preferences. Key fields beyond the basics:

| Key | Type | Description |
|---|---|---|
| `goalHistory` | `[{ from: 'YYYY-MM-DD', goalMin }]` | Sorted ascending; sentinel `from: '0000-01-01'` is always prepended on migration |
| `monthlyGoalHistory` | `[{ from: 'YYYY-MM', goalHr }]` | Same pattern; sentinel `from: '0000-01'` |
| `categories` | `String[]` | User-editable list used in all dropdowns |

When reading the goal for a specific date, walk `goalHistory` backwards to find the last entry where `from <= date`.

---

## Key Patterns

### Adding a new page

1. Add `<section id="page-{name}" class="page" data-page="{name}">` in `index.html`
2. Add a nav link with `data-page="{name}"` to the sidebar
3. Add a `render{Name}()` function in the relevant `scripts/app/*.js` module, `export` it, `import` it into `scripts/app/nav.js`, and call it from the `renderPage` switch there

### Adding a new chart

Use `Charts.destroyChart(canvasId)` before calling any render function. Chart.js throws if you try to create a chart on a canvas that already has one. Every chart renderer in `charts.js` calls `destroyChart` at its top.

### Adding a new achievement

In `rewards.js`, add an entry to the `ACHIEVEMENTS` array with: `id`, `name`, `icon`, `desc`, `xp`, `check(context)`, `progress(context)`. The context object has `{ entries, streak, stats, consistency, dailyGoalMin, goalForDate }`. Progress returns `{ current, max }`.

### Difficulty levels

Entries use three difficulty values: `"easy"`, `"medium"`, `"hard"`. The old four-level system (beginner/intermediate/advanced/expert) was replaced. All analytics, XP, and medal calculations use these three values.

### CSS theming

All colors, spacing, and radii are CSS custom properties defined at `:root` in `styles/tokens.css` (the first stylesheet loaded). Dark mode overrides live on `[data-theme="dark"]`. Accent colors override `--accent` and related variables on `[data-accent="..."]`.

Compact mode is the default (`compact: true` in `DEFAULT_PREFS`). It applies reduced padding/font via `.compact-mode` on `<body>`. Never assume non-compact layout.

### Soft Delete

`Storage.deleteEntry(id)` (hard delete) is **not used** in the UI. The Daily Log calls `Storage.softDeleteEntry(id)` instead, which moves the entry to the `deletedEntries` store. The Deleted Logs page lets users restore or permanently remove them. Use soft delete for any user-triggered deletion.

### PDF Report (jsPDF)

The report in `generateMonthlyReport()` (in `scripts/app/reports.js`) uses **jsPDF directly** — no html2canvas, no DOM capture. Everything is drawn with `pdf.text()`, `pdf.rect()`, `pdf.line()`, `pdf.link()`. Coordinates are in points (pt). The helper functions `tx()`, `fillR()`, `strokeR()`, `hline()`, `needsPage()` are defined inside the function scope.

- `needsPage(h)` checks if `y + h > PH - MB` and adds a new page, resetting `y = MT`
- Column widths for Date/Category/Duration/Difficulty are content-measured via `colFit()`
- Topic/Notes/Resources split the remaining width at 15%/70%/15%

### Auto-Backup

After every entry save/delete, `triggerAutoBackup()` is called (1.5 s debounce). It writes to the persisted backup folder. On first launch, a blocking modal requires the user to pick a backup folder before accessing the app.

### Common Utility Functions

These helpers live in `scripts/app/utils.js` and are `export`ed; `import` the ones you need:

| Function | Purpose |
|---|---|
| `setEl(id, val)` | `document.getElementById(id).textContent = val` (null-safe) |
| `setInputVal(id, val)` | Sets `.value` on an input by id (null-safe) |
| `escapeHtml(str)` | XSS-safe HTML escape via `div.textContent` |
| `safeHref(url)` | Allows only `http:`, `https:`, `file:` protocols; blocks `javascript:`, `data:`. Windows paths (`C:\`) and UNC paths are converted to `file://` |
| `showToast(msg, type, duration)` | Shows a toast notification. Types: `'info'` \| `'success'` \| `'error'` \| `'warning'` |
| `animateCounter(elId, target, decimals, suffix)` | Animated number counter, 600 ms eased |
| `capitalise(str)` | Capitalizes first letter |

### CSS Version Query Strings

CSS and JS files are loaded with cache-busting query strings in `index.html` (e.g., `tokens.css?v=1`, `main.js?v=1`). When you change a file, increment the version number on its tag so browsers don't serve stale cached assets.

### IndexedDB Schema Changes

`DB_VERSION` in `storage.js` is currently `4`. If you add a new object store or index, increment `DB_VERSION` and add the corresponding `db.createObjectStore(...)` branch inside `req.onupgradeneeded`. The upgrade handler uses `if (!db.objectStoreNames.contains(...))` guards for safety.

---

## CSS Files

`main.css` was split into focused files **loaded in a fixed order** in `index.html`. The order is load-bearing: `tokens.css` must come first (everything uses its `var(--…)`), `responsive.css` and `compact-mode.css` come after the rules they override, and the whole set loads **before** `dashboard.css` and `animations.css` (which still override). Concatenating the split files in load order reproduces the original `main.css`.

Load order (all `styles/`): `tokens` → `base` → `layout` → `buttons` → `report-preview` → `forms` → `modals` → `feedback` → `log` → `settings-backup` → `calendar` → `achievements` → `chrome` → `responsive` → `profiles-users` → `compact-mode` → `timer` → `goals` → `deleted-goals` → `dashboard` → `animations`.

| File | Purpose |
|---|---|
| `tokens.css` | `:root` custom properties + `[data-theme]` / `[data-accent]` overrides (load first) |
| `base.css` | reset, base elements, focus, skip link, loading overlay, app-shell |
| `layout.css` | sidebar, main-content, page framework |
| `buttons.css`, `forms.css`, `modals.css`, `feedback.css` | reusable components |
| `report-preview.css`, `log.css`, `settings-backup.css`, `calendar.css`, `achievements.css`, `profiles-users.css`, `goals.css`, `deleted-goals.css` | page-specific styles |
| `timer.css` | Pomodoro timer panel (largest single feature) |
| `chrome.css` | clock chip, daily quote, mobile nav, analytics chart cards, tooltips, utilities |
| `responsive.css` | all `@media` query blocks |
| `compact-mode.css` | `.compact-mode` overrides (default layout) |
| `dashboard.css` | Dashboard-specific widget styles |
| `animations.css` | Keyframe animations, transitions |

There is no CSS preprocessor. Variables use native `var(--name)` syntax.

---

## What Not to Do

- Don't convert the 7 shared libraries (`storage.js`, `analytics.js`, `charts.js`, `rewards.js`, `calendar.js`, `insights.js`, `timer.js`) to ES modules — they must stay classic global IIFEs so the app modules can read them as ambient globals
- Don't reference ambient globals (`Storage`, `Analytics`, `Charts`, `Rewards`, `Calendar`, `Insights`, `PomodoroTimer`, `Chart`, `confetti`, `window.jspdf`) at the **top level** of an app module — only inside functions (top-level runs before a global may exist)
- Don't reassign the imported `state` binding — mutate its properties (`state.entries = …`). Don't add new shared mutable state as a module-level `let`; put it on the `state` object in `scripts/app/state.js`
- Don't do real work at an app module's top level — modules should only declare/`export` functions; wiring happens when `init()` runs them
- Don't use top-level `await` in any app module — async work happens inside methods
- Don't re-render an entire page on every data change — page renderers are called once on navigation; partial updates use targeted `setEl()` / `innerHTML` calls
- Don't call `Storage.*` inside analytics functions — they are pure and synchronous; data is passed in as arguments
- Don't use `Storage.deleteEntry()` directly in UI code — use `Storage.softDeleteEntry()` so entries go to Deleted Logs first
- The `calculateLearningCurve()` function in `analytics.js` exists but its output is intentionally not charted — don't add a chart for it without discussing first
- Don't use `"beginner"`, `"intermediate"`, `"advanced"`, or `"expert"` as difficulty values — the only valid values are `"easy"`, `"medium"`, `"hard"`
- Don't bypass `safeHref()` when building links from user-supplied URLs — raw user URLs must not go directly into `href` attributes
- Don't increment `DB_VERSION` without also handling the upgrade path in `onupgradeneeded`; old versions without the store will break on open
