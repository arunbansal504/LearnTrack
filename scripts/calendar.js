/* ===================================================
   LEARNTRACK — CALENDAR MODULE
   Full calendar view, date selection, streak display
   =================================================== */

'use strict';

const Calendar = (() => {

  let _currentYear  = new Date().getFullYear();
  let _currentMonth = new Date().getMonth();
  let _selectedDate = null;
  let _entries      = [];
  let _onDateSelect   = null;
  let _onAddEntry     = null;
  let _onViewEntries  = null;
  let _initialized    = false;

  const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];

  /* ---- Init ---------------------------------------- */

  function init(entries, { onDateSelect, onAddEntry, onViewEntries } = {}) {
    _entries       = entries;
    _onDateSelect  = onDateSelect;
    _onAddEntry    = onAddEntry;
    _onViewEntries = onViewEntries;

    if (!_initialized) {
      _initialized = true;

      document.getElementById('cal-prev')?.addEventListener('click', () => {
        _currentMonth--;
        if (_currentMonth < 0) { _currentMonth = 11; _currentYear--; }
        render();
      });

      document.getElementById('cal-next')?.addEventListener('click', () => {
        _currentMonth++;
        if (_currentMonth > 11) { _currentMonth = 0; _currentYear++; }
        render();
      });

      document.getElementById('cal-today')?.addEventListener('click', () => {
        _currentYear  = new Date().getFullYear();
        _currentMonth = new Date().getMonth();
        _selectedDate = Analytics.today();
        render();
        showDayPanel(_selectedDate);
      });

      document.getElementById('cal-quick-add')?.addEventListener('click', () => {
        if (_selectedDate && _onAddEntry) _onAddEntry(_selectedDate);
      });

      document.getElementById('cal-view-entries')?.addEventListener('click', () => {
        if (_selectedDate && _onViewEntries) _onViewEntries(_selectedDate);
      });
    }

    render();
    if (_selectedDate) showDayPanel(_selectedDate);
  }

  function update(entries) {
    _entries = entries;
    render();
    if (_selectedDate) showDayPanel(_selectedDate);
  }

  /* ---- Render Calendar Grid ------------------------ */

  function render() {
    const titleEl = document.getElementById('cal-month-title');
    if (titleEl) titleEl.textContent = `${MONTH_NAMES[_currentMonth]} ${_currentYear}`;

    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    grid.innerHTML = '';

    // Day headers
    DAY_NAMES.forEach(name => {
      const th = document.createElement('div');
      th.className     = 'cal-header-cell';
      th.textContent   = name;
      grid.appendChild(th);
    });

    // Build date → entries map
    const dateMap = Analytics.buildDateMap(_entries);

    // First day of month
    const firstDay  = new Date(_currentYear, _currentMonth, 1).getDay();
    const daysInMon = new Date(_currentYear, _currentMonth + 1, 0).getDate();
    const todayStr  = Analytics.today();

    // Blank cells before month start
    for (let i = 0; i < firstDay; i++) {
      const prevMonthDay = new Date(_currentYear, _currentMonth, -(firstDay - i - 1));
      const cell = createDayCell(
        prevMonthDay.getDate(),
        Analytics.toDateStr(prevMonthDay),
        dateMap,
        todayStr,
        true
      );
      grid.appendChild(cell);
    }

    // Month days
    for (let d = 1; d <= daysInMon; d++) {
      const ds   = `${_currentYear}-${String(_currentMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const cell = createDayCell(d, ds, dateMap, todayStr, false);
      grid.appendChild(cell);
    }

    // Trailing blank cells
    const total = firstDay + daysInMon;
    const rows  = Math.ceil(total / 7);
    const trailing = rows * 7 - total;
    for (let i = 1; i <= trailing; i++) {
      const nextDay = new Date(_currentYear, _currentMonth + 1, i);
      const cell    = createDayCell(i, Analytics.toDateStr(nextDay), dateMap, todayStr, true);
      grid.appendChild(cell);
    }

    // Update streak stats
    const streaks = Analytics.calculateStreaks(_entries);
    const { missed, window: missedWindow } = Analytics.missedDays(_entries, 30);
    setEl('cal-current-streak', streaks.current);
    setEl('cal-longest-streak', streaks.longest);
    setEl('cal-missed-days', missed);
    const missedLabelEl = document.getElementById('streak-missed-label');
    if (missedLabelEl) missedLabelEl.textContent = `Missed (${missedWindow}d)`;

    const msgEl = document.getElementById('streak-message');
    if (msgEl) msgEl.textContent = getStreakMessage(streaks.current);
  }

  function createDayCell(dayNum, ds, dateMap, todayStr, isOtherMonth) {
    const entries = dateMap[ds] || [];
    const totalMin = entries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
    const hasEntry = entries.length > 0;

    const cell = document.createElement('div');
    cell.className = 'cal-day';
    if (isOtherMonth) cell.classList.add('other-month');
    if (ds === todayStr)   cell.classList.add('today');
    if (ds === _selectedDate) cell.classList.add('selected');
    if (hasEntry) cell.classList.add('has-entry');

    // Day number
    const numEl = document.createElement('span');
    numEl.className   = 'cal-day-num';
    numEl.textContent = dayNum;
    cell.appendChild(numEl);

    // Activity indicator
    if (hasEntry && !isOtherMonth) {
      const maxMin = 300;
      const level  = totalMin === 0 ? 0
                   : totalMin < maxMin * 0.25 ? 1
                   : totalMin < maxMin * 0.5  ? 2
                   : totalMin < maxMin * 0.75 ? 3
                   : 4;

      const dot = document.createElement('div');
      dot.className = `cal-activity-dot level-${level}`;
      cell.appendChild(dot);

      const countEl = document.createElement('div');
      countEl.className   = 'cal-entry-count';
      countEl.textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
      cell.appendChild(countEl);
    }

    cell.addEventListener('click', () => {
      // Clear previous selection
      document.querySelectorAll('.cal-day.selected').forEach(el => el.classList.remove('selected'));
      cell.classList.add('selected');
      _selectedDate = ds;
      showDayPanel(ds);
      if (_onDateSelect) _onDateSelect(ds, entries);
    });

    cell.setAttribute('role', 'button');
    cell.setAttribute('aria-label', `${ds}${hasEntry ? `, ${entries.length} entries` : ''}`);
    cell.setAttribute('tabindex', '0');
    cell.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') cell.click(); });

    return cell;
  }

  /* ---- Day Panel ----------------------------------- */

  function showDayPanel(ds) {
    const headerEl   = document.getElementById('cal-day-header');
    const listEl     = document.getElementById('cal-day-entries');
    const actionsEl  = document.getElementById('cal-day-actions');
    const addBtn     = document.getElementById('cal-quick-add');
    const viewBtn    = document.getElementById('cal-view-entries');
    if (!headerEl || !listEl) return;

    const date     = new Date(ds + 'T12:00:00');
    const label    = date.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
    headerEl.textContent = label;

    const ts = e => e.createdAt || parseInt(e.id, 10) || 0;
    const dayEntries = _entries.filter(e => e.date === ds).sort((a, b) => ts(b) - ts(a));
    listEl.innerHTML = '';

    if (dayEntries.length === 0) {
      listEl.innerHTML = '<div class="empty-state-small"><span>📅</span><p>No entries for this day</p></div>';
    } else {
      dayEntries.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'cal-entry-item';
        item.innerHTML = `
          <div class="cal-entry-topic">${escapeHtml(entry.topic)}</div>
          <div class="cal-entry-meta">
            ${Analytics.formatDuration(entry.durationMinutes || 0)}
            ${entry.category ? ` · ${escapeHtml(entry.category)}` : ''}
          </div>
        `;
        item.addEventListener('click', () => {
          if (_onDateSelect) _onDateSelect(ds, dayEntries, entry);
        });
        listEl.appendChild(item);
      });
    }

    const hasEntries = dayEntries.length > 0;
    if (addBtn)    addBtn.style.display  = ds <= Analytics.today() ? 'flex' : 'none';
    if (viewBtn) {
      viewBtn.style.display = 'flex';
      viewBtn.disabled = !hasEntries;
    }
    if (actionsEl) actionsEl.style.display = 'flex';
  }

  /* ---- Streak Messages ----------------------------- */

  function getStreakMessage(streak) {
    if (streak === 0) return "Start your streak today! 🌱";
    if (streak === 1) return "Great start! Come back tomorrow 🙂";
    if (streak < 5)  return `${streak} days going! Keep it up! 🔥`;
    if (streak < 10) return `Amazing ${streak}-day streak! You're on fire! 🚀`;
    if (streak < 30) return `${streak} days! You're unstoppable! ⚡`;
    return `${streak} DAYS! You're a legend! 🏆`;
  }

  /* ---- Helpers ------------------------------------- */

  function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  /* ---- Public API ---------------------------------- */
  return { init, update };

})();
