/* ===================================================
   LEARNTRACK — TIMER MODULE  (Pomodoro + Stopwatch)
   =================================================== */
'use strict';

const PomodoroTimer = (() => {

  const MODES = {
    work:       { label: 'Focus',       minutes: 25 },
    shortBreak: { label: 'Short Break', minutes: 5  },
    longBreak:  { label: 'Long Break',  minutes: 15 },
  };

  const MODE_LIMITS = {
    work:       { min: 1, max: 90 },
    shortBreak: { min: 1, max: 30 },
    longBreak:  { min: 1, max: 60 },
  };

  const RING_COLORS = { work: '#ef4444', shortBreak: '#10b981', longBreak: '#3b82f6' };
  const RING_FAINT  = {
    work:       'rgba(239,68,68,0.14)',
    shortBreak: 'rgba(16,185,129,0.14)',
    longBreak:  'rgba(59,130,246,0.14)',
  };
  const GRAD_COUNT = 3;

  /* ---- Pomodoro state ---- */
  let _mode      = 'work';
  let _timeLeft  = MODES.work.minutes * 60;
  let _totalTime = MODES.work.minutes * 60;
  let _running   = false;
  let _timerId   = null;
  let _sessions  = 0;
  let _cyclePos  = 0;
  let _onComplete = null;
  let _audioCtx  = null;
  let _lastWork  = null;
  let _notifAsked = false;
  let _timesUp   = false; // true while showing "Time's up!" screen
  let _nextMode  = null;  // mode to transition to when user dismisses time's up
  const _savedProgress = {};

  /* ---- Stopwatch state ---- */
  let _swRunning = false;
  let _swSeconds = 0;
  let _swTimerId = null;
  let _swLapRef  = 0; // seconds at last lap (unused in basic mode, reserved)

  /* ---- Helpers ---- */
  const _el = id => document.getElementById(id);

  function _fmt(s) {
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function _fmtSw(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    return h > 0 ? `${String(h).padStart(2,'0')}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  /* ---- Audio ---- */
  function _beep(isWork) {
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (_audioCtx.state === 'suspended') _audioCtx.resume();

      // Work done: triumphant ascending arpeggio (C5 E5 G5 C6), last note rings out
      // Break done: gentle descending chime (G5 E5 C5), softer ring-out
      const notes   = isWork ? [523, 659, 784, 1047] : [784, 659, 523];
      const spacing = isWork ? 0.28 : 0.32;
      const vol     = 0.32;

      notes.forEach((freq, i) => {
        const isLast = i === notes.length - 1;
        const ringOut = isLast ? (isWork ? 1.6 : 1.1) : 0.45;
        const t = _audioCtx.currentTime + i * spacing;

        // Main tone
        const osc = _audioCtx.createOscillator();
        const g   = _audioCtx.createGain();
        osc.connect(g); g.connect(_audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, t + ringOut);
        osc.start(t); osc.stop(t + ringOut + 0.05);

        // Subtle overtone at 2× for bell-like shimmer
        const osc2 = _audioCtx.createOscillator();
        const g2   = _audioCtx.createGain();
        osc2.connect(g2); g2.connect(_audioCtx.destination);
        osc2.type = 'sine';
        osc2.frequency.value = freq * 2;
        g2.gain.setValueAtTime(0, t);
        g2.gain.linearRampToValueAtTime(vol * 0.18, t + 0.01);
        g2.gain.exponentialRampToValueAtTime(0.001, t + ringOut * 0.6);
        osc2.start(t); osc2.stop(t + ringOut * 0.6 + 0.05);
      });
    } catch (_) {}
  }

  /* ---- Stopwatch UI ---- */
  function _updateSwUI() {
    const timeEl = _el('sw-time');
    if (timeEl) timeEl.textContent = _fmtSw(_swSeconds);

    const startBtn = _el('sw-start-btn');
    if (startBtn) {
      const playIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      const pauseIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
      if (_swRunning) {
        startBtn.innerHTML = `${pauseIcon} Pause`;
      } else if (_swSeconds > 0) {
        startBtn.innerHTML = `${playIcon} Resume`;
      } else {
        startBtn.innerHTML = `${playIcon} Start`;
      }
    }

    const resetBtn = _el('sw-reset-btn');
    if (resetBtn) resetBtn.style.display = _swSeconds > 0 ? 'inline-flex' : 'none';

    if (!_running) {
      document.title = _swRunning
        ? `${_fmtSw(_swSeconds)} · LearnTrack`
        : 'LearnTrack — Your Learning Journey';
    }
  }

  /* ---- Pomodoro UI ---- */
  function _updateUI() {
    const timeStr = _fmt(_timeLeft);
    const isIdle  = !_running && _timeLeft === _totalTime;

    /* Time display */
    const timeEl = _el('pomo-time');
    if (timeEl) timeEl.textContent = timeStr;

    /* Mode label — shown only during break modes */
    const labelEl = _el('pomo-mode-label');
    if (labelEl) labelEl.textContent = _mode !== 'work' ? MODES[_mode].label : '';

    /* Progress bar */
    const fillEl = _el('pomo-progress-fill');
    if (fillEl) {
      const pct = _totalTime > 0 ? (((_totalTime - _timeLeft) / _totalTime) * 100).toFixed(2) : 0;
      fillEl.style.width = pct + '%';
    }
    const progressWrap = _el('pomo-progress-wrap');
    if (progressWrap) progressWrap.style.visibility = isIdle ? 'hidden' : 'visible';

    /* Time's up screen — shown immediately after timer hits 0, before next mode */
    const timesUpRow = _el('pomo-timesup-row');
    if (timesUpRow) timesUpRow.style.display = _timesUp ? 'flex' : 'none';

    /* Mode buttons — hidden while running or in time's up state */
    const modesEl = _el('pomo-modes');
    if (modesEl) modesEl.style.display = (_running || _timesUp) ? 'none' : 'flex';
    document.querySelectorAll('.pomo-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === _mode);
    });

    /* Idle controls (presets + adjuster) — only during work idle, not time's up */
    const idleCtrl = _el('pomo-idle-controls');
    if (idleCtrl) idleCtrl.style.display = (_mode === 'work' && isIdle && !_timesUp) ? 'flex' : 'none';

    /* Reset button — shown when not idle or during time's up */
    const resetBtn = _el('pomo-reset-btn');
    if (resetBtn) resetBtn.style.display = (isIdle && !_timesUp) ? 'none' : 'inline-flex';

    /* Start/Pause button — hidden during time's up */
    const startBtn = _el('pomo-start-btn');
    if (startBtn) {
      startBtn.style.display = _timesUp ? 'none' : 'inline-flex';
      const playIcon  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      const pauseIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
      if (_running) {
        startBtn.innerHTML = `${pauseIcon} Pause`;
      } else if (!isIdle) {
        startBtn.innerHTML = `${playIcon} Resume`;
      } else {
        startBtn.innerHTML = `${playIcon} Start`;
      }
    }

    /* Duration adjuster label */
    const durLabel = _el('pomo-dur-label');
    if (durLabel) durLabel.textContent = `${MODES[_mode].minutes} min`;
    const durMinus = _el('pomo-dur-minus');
    const durPlus  = _el('pomo-dur-plus');
    if (durMinus) durMinus.disabled = _running;
    if (durPlus)  durPlus.disabled  = _running;

    /* FAB */
    const panel = _el('pomo-panel');
    const fab = _el('pomo-fab');
    if (fab) {
      const panelOpen = panel?.style.display !== 'none';
      fab.classList.toggle('running', _running);
      fab.classList.toggle('open', panelOpen);
      fab.style.setProperty('--pomo-color', RING_COLORS[_mode]);
      fab.style.setProperty('--pomo-faint',  RING_FAINT[_mode]);
      const fabContent = _el('pomo-fab-content');
      if (fabContent) fabContent.textContent = _running ? timeStr : '🍅';
    }

    document.title = _running
      ? `${timeStr} · LearnTrack`
      : 'LearnTrack — Your Learning Journey';
  }

  /* ---- Pomodoro timer logic ---- */
  function _complete() {
    _running = false;
    clearInterval(_timerId);
    _timerId  = null;
    _timeLeft = 0;
    _updateUI();

    const wasWork = _mode === 'work';
    _beep(wasWork);

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('LearnTrack', {
        body: wasWork ? '🍅 Focus session complete! Time for a break.' : '☕ Break\'s over — time to focus!',
      });
    }

    // Compute next mode but don't switch yet — wait for user to dismiss Time's up
    _timesUp = true;
    if (wasWork) {
      _sessions++;
      _cyclePos++;
      _lastWork = { minutes: MODES.work.minutes };
      _nextMode = _cyclePos >= 4 ? (_cyclePos = 0, 'longBreak') : 'shortBreak';
    } else {
      _nextMode = 'work';
    }

    _updateUI();

    if (_onComplete) _onComplete({ wasWork, sessions: _sessions, lastWork: _lastWork });
  }

  function _setMode(mode, resetCycle, saveProgress = false) {
    if (saveProgress && _timeLeft > 0 && _timeLeft < _totalTime) {
      _savedProgress[_mode] = { timeLeft: _timeLeft, wasRunning: _running };
    }

    clearInterval(_timerId);
    _timerId  = null;
    _running  = false;
    _mode     = mode;
    _totalTime = MODES[mode].minutes * 60;

    const saved = saveProgress && _savedProgress[mode];
    if (saved) {
      _timeLeft = saved.timeLeft;
    } else {
      _timeLeft = _totalTime;
      delete _savedProgress[mode];
    }

    if (resetCycle) _cyclePos = 0;

    if (saved?.wasRunning) {
      _running = true;
      _timerId = setInterval(() => { if (--_timeLeft <= 0) _complete(); else _updateUI(); }, 1000);
    }

    _updateUI();
  }

  /* ---- Duration adjustment ---- */
  function _adjustDuration(delta) {
    if (_running) return;
    const lim = MODE_LIMITS[_mode];
    MODES[_mode].minutes = Math.min(lim.max, Math.max(lim.min, MODES[_mode].minutes + delta));
    _totalTime = MODES[_mode].minutes * 60;
    _timeLeft  = _totalTime;
    _syncPresetsHighlight();
    _updateUI();
  }

  function _syncPresetsHighlight() {
    document.querySelectorAll('.pomo-preset').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.min) === MODES.work.minutes);
    });
  }

  /* ---- Public: Pomodoro ---- */
  function start() {
    if (_running) return;
    try { _audioCtx?.resume(); } catch (_) {}
    _running = true;
    _timerId = setInterval(() => { if (--_timeLeft <= 0) _complete(); else _updateUI(); }, 1000);
    _updateUI();
  }

  function pause() {
    if (!_running) return;
    _running = false;
    clearInterval(_timerId);
    _timerId = null;
    _updateUI();
  }

  function reset() {
    pause();
    _timesUp  = false;
    _nextMode = null;
    _timeLeft = _totalTime;
    delete _savedProgress[_mode];
    _updateUI();
  }

  function _dismissTimesUp() {
    const next = _nextMode || 'work';
    _timesUp  = false;
    _nextMode = null;
    _setMode(next, false);
  }

  /* ---- Public: Stopwatch ---- */
  function swToggle() {
    if (_swRunning) {
      _swRunning = false;
      clearInterval(_swTimerId);
      _swTimerId = null;
    } else {
      _swRunning = true;
      _swTimerId = setInterval(() => { _swSeconds++; _updateSwUI(); }, 1000);
    }
    _updateSwUI();
  }

  function swReset() {
    _swRunning = false;
    clearInterval(_swTimerId);
    _swTimerId = null;
    _swSeconds = 0;
    _updateSwUI();
  }

  /* ---- Panel open/close ---- */
  function openPanel() {
    const panel = _el('pomo-panel');
    if (panel) { panel.style.display = ''; _updateUI(); _updateSwUI(); }
  }

  function closePanel() {
    const panel = _el('pomo-panel');
    if (!panel) return;
    panel.style.display = 'none';
    if (panel.classList.contains('fullscreen')) {
      panel.classList.remove('fullscreen');
      const btn = _el('pomo-expand');
      if (btn) {
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
        btn.title = 'Fullscreen';
      }
    }
    _updateUI();
  }

  function isPanelOpen() {
    const panel = _el('pomo-panel');
    return panel ? panel.style.display !== 'none' : false;
  }

  function getLastWork() { return _lastWork; }

  /* ---- Init ---- */
  function init(onCompleteCb) {
    _onComplete = onCompleteCb;
    _updateUI();
    _updateSwUI();

    /* --- Tab switching --- */
    _el('pomo-tab-pomo')?.addEventListener('click', () => {
      _el('timer-section-sw')?.style && (_el('timer-section-sw').style.display = 'none');
      _el('timer-section-pomo')?.style && (_el('timer-section-pomo').style.display = '');
      _el('pomo-tab-sw')?.classList.remove('active');
      _el('pomo-tab-pomo')?.classList.add('active');
    });

    _el('pomo-tab-sw')?.addEventListener('click', () => {
      _el('timer-section-pomo')?.style && (_el('timer-section-pomo').style.display = 'none');
      _el('timer-section-sw')?.style && (_el('timer-section-sw').style.display = '');
      _el('pomo-tab-pomo')?.classList.remove('active');
      _el('pomo-tab-sw')?.classList.add('active');
      _updateSwUI();
    });

    /* --- Mode buttons (Focus / Short Break / Long Break) --- */
    document.querySelectorAll('.pomo-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => _setMode(btn.dataset.mode, false, true));
    });

    /* --- Preset buttons --- */
    document.querySelectorAll('.pomo-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        if (_running) return;
        const min = parseInt(btn.dataset.min);
        MODES.work.minutes = min;
        _mode      = 'work';
        _totalTime = min * 60;
        _timeLeft  = _totalTime;
        delete _savedProgress.work;
        _syncPresetsHighlight();
        _updateUI();
      });
    });

    /* --- Duration fine-tune --- */
    _el('pomo-dur-minus')?.addEventListener('click', () => _adjustDuration(-1));
    _el('pomo-dur-plus')?.addEventListener('click',  () => _adjustDuration(+1));

    /* --- Time's up dismiss → proceed to next mode --- */
    _el('pomo-timesup-btn')?.addEventListener('click', _dismissTimesUp);

    /* --- Pomodoro start/pause --- */
    _el('pomo-start-btn')?.addEventListener('click', () => {
      if (!_running && !_notifAsked && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        _notifAsked = true;
        Notification.requestPermission?.();
      }
      _running ? pause() : start();
    });

    /* --- Pomodoro reset --- */
    _el('pomo-reset-btn')?.addEventListener('click', reset);

    /* --- Stopwatch --- */
    _el('sw-start-btn')?.addEventListener('click', swToggle);
    _el('sw-reset-btn')?.addEventListener('click', swReset);

    /* --- Close --- */
    _el('pomo-close')?.addEventListener('click', closePanel);

    /* --- Fullscreen toggle --- */
    function _exitFullscreen() {
      const panel = _el('pomo-panel');
      if (!panel || !panel.classList.contains('fullscreen')) return;
      panel.classList.remove('fullscreen');
      const btn = _el('pomo-expand');
      if (btn) {
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
        btn.title = 'Fullscreen';
      }
    }

    _el('pomo-expand')?.addEventListener('click', () => {
      const panel = _el('pomo-panel');
      if (!panel) return;
      const isFs = panel.classList.toggle('fullscreen');
      const btn = _el('pomo-expand');
      if (btn) {
        btn.innerHTML = isFs
          ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v5H3M21 3l-7 7M16 21v-5h5M3 21l7-7"/></svg>`
          : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
        btn.title = isFs ? 'Exit fullscreen' : 'Fullscreen';
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') _exitFullscreen();
    });

    /* --- Gradient cycling --- */
    _el('pomo-palette')?.addEventListener('click', () => {
      const panel = _el('pomo-panel');
      if (!panel) return;
      const cur  = parseInt(panel.dataset.grad || '1');
      panel.dataset.grad = (cur % GRAD_COUNT) + 1;
    });
  }

  return { init, start, pause, reset, openPanel, closePanel, isPanelOpen, getLastWork };

})();
