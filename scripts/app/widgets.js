/* ===== widgets.js — extracted from app.js ===== */
import { state } from './state.js';
import { init } from './core.js';
import { openEntryModal } from './log.js';
import { setInputVal, showToast } from './utils.js';

  /* ---- Theme & Accent ------------------------------ */

  export function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme || 'dark');
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.checked = (theme === 'dark' || theme === 'midnight');
  }

  export function applyAccent(accent) {
    if (accent && accent.startsWith('#')) {
      _applyCustomHexAccent(accent);
    } else {
      _clearCustomHexVars();
      document.documentElement.setAttribute('data-accent', accent || 'purple');
    }
    syncTimerGradient(accent);
  }

  export function syncTimerGradient(accent) {
    const panel = document.getElementById('pomo-panel');
    if (!panel) return;
    const map = { purple: 1, blue: 2, green: 4, orange: 6, pink: 7, red: 8 };
    panel.dataset.grad = String(map[accent] || 1);
  }

  /* ---- Custom hex accent helpers ------------------- */

  function _hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }

  function _hslToHexColor(h, s, l) {
    s /= 100; l /= 100;
    const a  = s * Math.min(l, 1 - l);
    const k  = n => (n + h / 30) % 12;
    const f  = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    const hx = x => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${hx(f(0))}${hx(f(8))}${hx(f(4))}`;
  }

  function _hexToHsl(hex) {
    const [r, g, b] = _hexToRgb(hex).map(x => x / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l * 100];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6;
    }
    return [h * 360, s * 100, l * 100];
  }

  function _applyCustomHexAccent(hex) {
    const [r, g, b]  = _hexToRgb(hex);
    const [h, s, l]  = _hexToHsl(hex);
    const light      = _hslToHexColor(h, s, Math.min(l + 14, 88));
    const dark       = _hslToHexColor(h, s, Math.max(l - 12, 20));
    const btn        = _hslToHexColor(h, Math.min(s + 5, 100), Math.max(l - 18, 18));
    const textLight  = _hslToHexColor(h, s, Math.max(l - 22, 15));
    const root = document.documentElement;
    root.style.setProperty('--accent',           hex);
    root.style.setProperty('--accent-light',     light);
    root.style.setProperty('--accent-dark',      dark);
    root.style.setProperty('--accent-glow',      `rgba(${r},${g},${b},0.25)`);
    root.style.setProperty('--accent-faint',     `rgba(${r},${g},${b},0.08)`);
    root.style.setProperty('--accent-btn',       btn);
    root.style.setProperty('--accent-text-light', textLight);
    root.removeAttribute('data-accent');
  }

  function _clearCustomHexVars() {
    const root = document.documentElement;
    ['--accent','--accent-light','--accent-dark','--accent-glow','--accent-faint','--accent-btn','--accent-text-light']
      .forEach(v => root.style.removeProperty(v));
  }

  /* ---- Live Clock ---------------------------------- */

  export function setupClock() {
    const el = document.getElementById('dashboard-clock');
    if (!el) return;

    const PERIODS = [
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
      { label: 'Dawn',      icon: '🌅', a: '#f97316', b: '#fbbf24' },
      { label: 'Morning',   icon: '☀️',  a: '#f59e0b', b: '#10b981' },
      { label: 'Morning',   icon: '☀️',  a: '#f59e0b', b: '#10b981' },
      { label: 'Morning',   icon: '☀️',  a: '#f59e0b', b: '#10b981' },
      { label: 'Morning',   icon: '☀️',  a: '#f59e0b', b: '#10b981' },
      { label: 'Morning',   icon: '☀️',  a: '#f59e0b', b: '#10b981' },
      { label: 'Morning',   icon: '☀️',  a: '#f59e0b', b: '#10b981' },
      { label: 'Afternoon', icon: '🌤️',  a: '#3b82f6', b: '#06b6d4' },
      { label: 'Afternoon', icon: '🌤️',  a: '#3b82f6', b: '#06b6d4' },
      { label: 'Afternoon', icon: '🌤️',  a: '#3b82f6', b: '#06b6d4' },
      { label: 'Afternoon', icon: '🌤️',  a: '#3b82f6', b: '#06b6d4' },
      { label: 'Afternoon', icon: '🌤️',  a: '#3b82f6', b: '#06b6d4' },
      { label: 'Evening',   icon: '🌆', a: '#8b5cf6', b: '#ec4899' },
      { label: 'Evening',   icon: '🌆', a: '#8b5cf6', b: '#ec4899' },
      { label: 'Evening',   icon: '🌆', a: '#8b5cf6', b: '#ec4899' },
      { label: 'Evening',   icon: '🌆', a: '#8b5cf6', b: '#ec4899' },
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
      { label: 'Night',     icon: '🌙', a: '#6366f1', b: '#4f46e5' },
    ];

    // Build DOM once
    el.innerHTML = `
      <div class="clock-inner">
        <div class="clock-top-row">
          <span id="clock-period-icon"></span>
          <span id="clock-period-label"></span>
          <span class="clock-top-sep">·</span>
          <span id="clock-date-row" class="clock-date-row"></span>
        </div>
        <div class="clock-time-row">
          <span id="clock-hm" class="clock-hm"></span>
          <span class="clock-colon">:</span>
          <span id="clock-ss" class="clock-ss"></span>
          <span id="clock-ampm" class="clock-ampm"></span>
        </div>
        <div class="clock-sec-bar"><div id="clock-sec-fill" class="clock-sec-fill"></div></div>
      </div>`;

    const iconEl  = document.getElementById('clock-period-icon');
    const labelEl = document.getElementById('clock-period-label');
    const dateEl  = document.getElementById('clock-date-row');
    const hmEl    = document.getElementById('clock-hm');
    const ssEl    = document.getElementById('clock-ss');
    const ampmEl  = document.getElementById('clock-ampm');
    const fillEl  = document.getElementById('clock-sec-fill');

    let lastHour = -1;

    const tick = () => {
      const now    = new Date();
      const h      = now.getHours();
      const s      = now.getSeconds();
      const period = PERIODS[h];

      if (h !== lastHour) {
        lastHour = h;
        el.style.setProperty('--clock-a', period.a);
        el.style.setProperty('--clock-b', period.b);
        if (iconEl)  iconEl.textContent  = period.icon;
        if (labelEl) labelEl.textContent = period.label;
      }

      const t    = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const ampm = t.slice(-2);
      const hm   = t.slice(0, -3).trim();
      const date = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

      if (dateEl) dateEl.textContent = date;
      if (hmEl)   hmEl.textContent   = hm;
      if (ssEl) ssEl.textContent = String(s).padStart(2, '0');
      if (ampmEl) ampmEl.textContent = ampm;
      if (fillEl) fillEl.style.width = `${(s / 60) * 100}%`;
    };

    tick();
    setInterval(tick, 1000);
  }

  /* ---- Daily Reminder ------------------------------ */

  export function setupReminder() {
    // Wire Test button
    document.getElementById('test-reminder-btn')?.addEventListener('click', async () => {
      if (!('Notification' in window)) {
        showToast('Your browser does not support notifications.', 'error');
        return;
      }
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      if (perm === 'denied') {
        showToast('Notifications are blocked. Enable them in your browser settings, then try again.', 'warning');
        return;
      }
      if (perm !== 'granted') return;
      fireReminder(true);
      showToast('Test notification sent!', 'success');
    });

    // Align to the next minute boundary, then tick every 60 s
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    setTimeout(() => {
      checkReminder();
      setInterval(checkReminder, 60_000);
    }, msToNextMinute);
  }

  export function checkReminder() {
    if (!state.prefs.reminder) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const now  = new Date();
    const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    if (hhmm !== (state.prefs.reminderTime || '20:00')) return;

    // Fire at most once per day
    const today = Analytics.today();
    const shownKey = 'lt_reminder_shown';
    if (localStorage.getItem(shownKey) === today) return;
    localStorage.setItem(shownKey, today);

    fireReminder(false);
  }

  export function fireReminder(isTest) {
    const today    = Analytics.today();
    const todayMin = state.entries
      .filter(e => e.date === today)
      .reduce((s, e) => s + (e.durationMinutes || 0), 0);
    const goalMin = state.prefs.dailyGoalMin || 60;

    let body;
    if (todayMin === 0) {
      body = "You haven't logged any learning today. Time to get started!";
    } else if (todayMin < goalMin) {
      const left = Analytics.formatDuration(goalMin - todayMin);
      body = `You've logged ${Analytics.formatDuration(todayMin)} today — ${left} left to hit your daily goal!`;
    } else {
      body = `Daily goal smashed! You've logged ${Analytics.formatDuration(todayMin)} today. Keep it up!`;
    }

    if (isTest) body = `[Test] ${body}`;

    try {
      new Notification('LearnTrack', {
        body,
        icon: 'assets/icons/icon-192.png',
        tag:  isTest ? 'learntrack-test' : 'learntrack-daily-reminder',
      });
    } catch (err) {
      showToast('Could not send notification: ' + err.message, 'error');
    }
  }

  /* ---- Pomodoro Timer ------------------------------ */

  export function setupPomoDrag() {
    const panel  = document.getElementById('pomo-panel');
    const handle = document.getElementById('pomo-drag-handle');
    if (!panel || !handle) return;

    let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

    function startDrag(clientX, clientY) {
      if (panel.classList.contains('fullscreen')) return false;
      const rect = panel.getBoundingClientRect();
      panel.style.transition = 'none';
      panel.style.top    = rect.top  + 'px';
      panel.style.left   = rect.left + 'px';
      panel.style.bottom = 'auto';
      panel.style.right  = 'auto';
      origLeft = rect.left;
      origTop  = rect.top;
      startX   = clientX;
      startY   = clientY;
      dragging = true;
      panel.classList.add('dragging');
      return true;
    }

    function moveDrag(clientX, clientY) {
      if (!dragging) return;
      const newLeft = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  origLeft + clientX - startX));
      const newTop  = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, origTop  + clientY - startY));
      panel.style.left = newLeft + 'px';
      panel.style.top  = newTop  + 'px';
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('dragging');
      panel.style.transition = '';
    }

    // Mouse drag (desktop only — skip on narrow viewports where panel is not floating)
    handle.addEventListener('mousedown', e => {
      if (window.innerWidth < 769) return;
      if (startDrag(e.clientX, e.clientY)) e.preventDefault();
    });
    document.addEventListener('mousemove', e => moveDrag(e.clientX, e.clientY));
    document.addEventListener('mouseup', endDrag);

    // Touch drag (mobile / tablet)
    handle.addEventListener('touchstart', e => {
      const t = e.touches[0];
      if (startDrag(t.clientX, t.clientY)) e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', e => {
      if (!dragging) return;
      moveDrag(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchend', endDrag);
    document.addEventListener('touchcancel', endDrag);
  }

  export function setupPomodoro() {
    setupPomoDrag();

    // Toggle panel from floating FAB
    document.getElementById('pomo-fab')?.addEventListener('click', () => {
      if (PomodoroTimer.isPanelOpen()) PomodoroTimer.closePanel();
      else { syncTimerGradient(state.prefs.accent); PomodoroTimer.openPanel(); }
    });

    // "Log" buttons — open the entry modal with the tracked duration pre-filled.
    // The timer's tracked time is reset only once the entry is actually saved.
    function logTimeFromTimer(totalSeconds, onSavedReset) {
      const totalMin = Math.max(1, Math.round(totalSeconds / 60));
      openEntryModal(null);
      setInputVal('entry-duration-hours', Math.floor(totalMin / 60) || '');
      setInputVal('entry-duration-mins',  totalMin % 60 || '');
      state.pendingTimerReset = onSavedReset;
    }

    document.getElementById('pomo-log-btn')?.addEventListener('click', () => {
      const sec = PomodoroTimer.getWorkSeconds();
      if (sec > 0) logTimeFromTimer(sec, () => PomodoroTimer.resetWorkLog());
    });

    document.getElementById('sw-log-btn')?.addEventListener('click', () => {
      const sec = PomodoroTimer.getStopwatchSeconds();
      if (sec > 0) logTimeFromTimer(sec, () => PomodoroTimer.resetStopwatch());
    });

    // Init with callback that fires when a session ends
    PomodoroTimer.init(({ wasWork }) => {
      if (wasWork) showToast('🍅 Focus session complete! Take a well-earned break.', 'success');
      else         showToast('☕ Break over! Ready to focus again?', 'info');
    });
  }

  export function setupThemeToggle() {
    document.getElementById('theme-toggle')?.addEventListener('change', async (e) => {
      const next = e.target.checked ? 'dark' : 'light';
      state.prefs.theme = next;
      await Storage.setPref('theme', next);
      applyTheme(next);
      document.querySelectorAll('.theme-option').forEach(b => b.classList.toggle('active', b.dataset.theme === next));
    });

  }

  export function applyCompact(compact) {
    document.body.classList.toggle('compact-mode', !!compact);
  }
