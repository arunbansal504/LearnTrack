# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Running the App

There is no build step, bundler, or dev server. Open `index.html` directly in a browser:

```
# Windows
start index.html

# Or drag index.html into a browser window
```

All external dependencies (Chart.js, canvas-confetti, jsPDF, Google Fonts) are loaded from CDN. If offline, charts and PDF export will fail silently.

---

## Architecture

### Single-file SPA

`index.html` contains every page as a `<section data-page="...">` element. Navigation works by showing/hiding these sections — no URL routing, no history API. The active section is toggled by `navigateTo(pageId)` in `app.js`.

### Module Pattern

Every JS file exports a single global constant using the IIFE pattern:

```js
const ModuleName = (() => {
  // private state
  return { publicMethod1, publicMethod2 };
})();
```

Modules: `App`, `Storage`, `Analytics`, `Charts`, `Rewards`, `Calendar`, `Insights`, `PomodoroTimer`, `UserManager`.

**Script load order in `index.html` matters** — there is no bundler. Dependencies must appear before their consumers:
`storage.js` → `analytics.js` → `charts.js` → `rewards.js` → `calendar.js` → `insights.js` → `timer.js` → `app.js`

### Data Flow

1. On init, `App.init()` calls `Storage.init(userId)` to open the correct IndexedDB database
2. All entries are loaded into the module-level `_entries` array inside `App`
3. Every page render reads from `_entries` in memory — no async DB reads during render
4. Writes go through `Storage.*` methods and update `_entries` in place
5. Analytics functions in `analytics.js` are pure — they take `entries` as a parameter and return computed values

### Per-User Storage

Each user profile maps to a separate IndexedDB database:
- First (default) user → `LearnTrackDB`
- Additional users → `LearnTrackDB_u${timestamp}`

`UserManager` (top of `app.js`) reads the user list and active user from plain `localStorage` keys (`lt_users`, `lt_active_user`) because IndexedDB isn't open yet when the user picker runs.

---

## Key Patterns

### Adding a new page

1. Add `<section id="page-{name}" class="page" data-page="{name}">` in `index.html`
2. Add a nav link with `data-page="{name}"` to the sidebar
3. Add a `render{Name}()` function in `app.js` and call it from the `navigateTo` switch

### Adding a new chart

Use `Charts.destroyChart(canvasId)` before calling any render function. Chart.js throws if you try to create a chart on a canvas that already has one. Every chart renderer in `charts.js` should call `destroyChart` at its top.

### Adding a new achievement

In `rewards.js`, add an entry to the `ACHIEVEMENTS` array (id, name, description, icon, xp, maxProgress, condition function). The condition receives `(entries, prefs, streak)`. Progress is computed by `calculateAchievementProgress()`.

### CSS theming

All colors, spacing, and radii are CSS custom properties defined at `:root` in `main.css`. Dark mode overrides live on `[data-theme="dark"]`. Accent colors override `--accent` and related variables on `[data-accent="..."]`.

Compact mode is the default (`compact: true` in `DEFAULT_PREFS`). It applies reduced padding/font via `.compact-mode` on `<body>`. Never assume non-compact layout.

### PDF Report (jsPDF)

The report in `generateMonthlyReport()` (bottom of `app.js`) uses **jsPDF directly** — no html2canvas, no DOM capture. Everything is drawn with `pdf.text()`, `pdf.rect()`, `pdf.line()`, `pdf.link()`. Coordinates are in points (pt). The helper functions `tx()`, `fillR()`, `strokeR()`, `hline()`, `needsPage()` are defined inside the function scope.

- `needsPage(h)` checks if `y + h > PH - MB` and adds a new page, resetting `y = MT`
- Column widths for Date/Category/Duration/Difficulty are content-measured via `colFit()`
- Topic/Notes/Resources split the remaining width at 15%/70%/15%

---

## CSS Files

| File | Purpose |
|---|---|
| `styles/main.css` | Everything — layout, components, themes, responsive, compact mode |
| `styles/dashboard.css` | Dashboard-specific widget styles |
| `styles/animations.css` | Keyframe animations, transitions |

There is no CSS preprocessor. Variables use native `var(--name)` syntax.

---

## What Not to Do

- Don't add `<script type="module">` — the IIFE globals must be accessible across files loaded in order
- Don't use `async/await` at the top level of any module — the IIFE executes synchronously; async work happens inside methods
- Don't re-render an entire page on every data change — page renderers are called once on navigation; partial updates use targeted `setEl()` / `innerHTML` calls
- Don't call `Storage.*` inside analytics functions — they are pure and synchronous; data is passed in as arguments
- The `calculateLearningCurve()` function in `analytics.js` exists but its output is intentionally not charted — don't add a chart for it without discussing first
