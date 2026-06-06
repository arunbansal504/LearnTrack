/* ===== settings.js — extracted from app.js ===== */
import { state, DEFAULT_PREFS, CATEGORY_PALETTE } from './state.js';
import { checkAchievements } from './achievements.js';
import { triggerAutoBackup, updateSidebarBackupStatus } from './core.js';
import { navigateTo, renderPage, updateSidebarUser } from './nav.js';
import { UserManager, openUserPicker, renderUsersManagement, switchUser } from './users.js';
import { escapeHtml, setCheckbox, setEl, setInputVal, showConfirm, showToast } from './utils.js';
import { applyAccent, applyCompact, applyTheme } from './widgets.js';
import * as Sync from './sync.js';

  /* ---- SETTINGS PAGE ------------------------------- */

  export function renderSettings() {
    setInputVal('setting-username',      state.prefs.username || '');
    setInputVal('setting-daily-goal',    state.prefs.dailyGoalMin || 60);
    setInputVal('setting-monthly-goal',  state.prefs.monthlyGoalHr || 20);
    sizeUsernameInput();
    setInputVal('setting-reminder-time', state.prefs.reminderTime || '20:00');
    setCheckbox('setting-compact',    state.prefs.compact || false);
    setCheckbox('setting-reminder',   state.prefs.reminder || false);

    // Theme options highlight
    document.querySelectorAll('.theme-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === (state.prefs.theme || 'dark'));
    });

    // Accent options
    document.querySelectorAll('.accent-swatch').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.accent === (state.prefs.accent || 'purple'));
    });

    // Reminder time row
    const rtRow = document.getElementById('reminder-time-row');
    if (rtRow) rtRow.style.display = state.prefs.reminder ? 'flex' : 'none';

    renderCategories();
    renderUsersManagement();
  }

  export function sizeUsernameInput() {
    const input = document.getElementById('setting-username');
    if (!input) return;
    const sizer = document.createElement('span');
    const style  = getComputedStyle(input);
    sizer.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.font};letter-spacing:${style.letterSpacing};padding:0`;
    sizer.textContent = input.value || input.placeholder || '';
    document.body.appendChild(sizer);
    const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const w = Math.max(60, sizer.offsetWidth + pad + 8);
    document.body.removeChild(sizer);
    input.style.width = w + 'px';
  }

  export function setupSettings() {
    document.getElementById('save-profile-btn')?.addEventListener('click', saveProfile);
    document.getElementById('cancel-profile-btn')?.addEventListener('click', () => navigateTo('dashboard'));
    document.getElementById('setting-username')?.addEventListener('input', sizeUsernameInput);

    ['setting-username', 'setting-daily-goal', 'setting-monthly-goal'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const btn = document.getElementById('save-profile-btn');
          if (btn) {
            btn.classList.add('btn-press');
            setTimeout(() => btn.classList.remove('btn-press'), 300);
          }
          saveProfile();
        }
      });
    });

    document.querySelectorAll('.theme-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        const theme = btn.dataset.theme;
        state.prefs.theme = theme;
        await Storage.setPref('theme', theme);
        applyTheme(theme);
        document.querySelectorAll('.theme-option').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
      });
    });

    document.querySelectorAll('.accent-swatch').forEach(btn => {
      btn.addEventListener('click', async () => {
        const accent = btn.dataset.accent;
        state.prefs.accent = accent;
        await Storage.setPref('accent', accent);
        applyAccent(accent);
        document.querySelectorAll('.accent-swatch').forEach(b => b.classList.toggle('active', b.dataset.accent === accent));
        Charts.refreshAllCharts();
      });
    });

    document.getElementById('setting-compact')?.addEventListener('change', async e => {
      state.prefs.compact = e.target.checked;
      await Storage.setPref('compact', e.target.checked);
      applyCompact(e.target.checked);
    });

    document.getElementById('setting-reminder')?.addEventListener('change', async e => {
      const enabled = e.target.checked;
      const rtRow   = document.getElementById('reminder-time-row');

      if (enabled) {
        if (!('Notification' in window)) {
          showToast('Your browser does not support notifications.', 'error');
          e.target.checked = false;
          return;
        }
        let perm = Notification.permission;
        if (perm === 'default') perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          showToast(
            perm === 'denied'
              ? 'Notifications are blocked. Enable them in your browser settings, then try again.'
              : 'Notification permission is required for reminders.',
            'warning'
          );
          e.target.checked = false;
          return;
        }
        showToast(`Reminder set for ${state.prefs.reminderTime || '20:00'} daily.`, 'success');
      }

      state.prefs.reminder = enabled;
      await Storage.setPref('reminder', enabled);
      if (rtRow) rtRow.style.display = enabled ? 'flex' : 'none';
    });

    document.getElementById('setting-reminder-time')?.addEventListener('change', async e => {
      state.prefs.reminderTime = e.target.value;
      await Storage.setPref('reminderTime', e.target.value);
    });

    document.getElementById('add-category-btn')?.addEventListener('click', addCategory);
    document.getElementById('new-category-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addCategory(); }
    });
    document.getElementById('new-profile-header-btn')?.addEventListener('click', () => openUserPicker(true));

    document.getElementById('reset-data-btn')?.addEventListener('click', () => {
      showConfirm('Reset all data?', 'This will permanently delete ALL your entries, achievements, and settings. This cannot be undone!', async () => {
        await Storage.resetAll();
        state.entries   = [];
        state.goals     = [];
        state.prefs     = { ...DEFAULT_PREFS };
        state.earnedAch = [];
        // Preserve the profile name from UserManager — it lives outside IndexedDB
        const activeUser = UserManager.getActive();
        if (activeUser) {
          state.prefs.username = activeUser.name;
          await Storage.setPref('username', activeUser.name);
        }
        applyTheme(state.prefs.theme);
        applyAccent(state.prefs.accent);
        applyCompact(state.prefs.compact);
        renderPage(state.currentPage);
        updateSidebarUser();
        showToast('All data has been reset.', 'warning');
      });
    });
  }

  export async function saveProfile() {
    const name  = document.getElementById('setting-username')?.value.trim() || 'Learner';
    const dailyRaw = parseInt(document.getElementById('setting-daily-goal')?.value, 10);
    const daily = isNaN(dailyRaw) ? 60 : dailyRaw;
    const monthlyRaw = parseInt(document.getElementById('setting-monthly-goal')?.value, 10);
    const monthly = isNaN(monthlyRaw) ? 20 : monthlyRaw;
    const reminderTime = document.getElementById('setting-reminder-time')?.value || '20:00';

    if (daily < 1) {
      showToast('Daily goal must be at least 1 minute.', 'warning');
      return;
    }
    if (daily > 1440) {
      showToast('Daily goal cannot exceed 24 hours (1440 minutes).', 'warning');
      return;
    }
    if (monthly < 1) {
      showToast('Monthly goal must be at least 1 hour.', 'warning');
      return;
    }

    // Track daily goal history so past medals/badges use the goal active on each day
    if (daily !== state.prefs.dailyGoalMin) {
      const today = Analytics.today();
      const history = [...(state.prefs.goalHistory || [])];
      if (!history.some(g => g.from === '0000-01-01')) {
        history.unshift({ from: '0000-01-01', goalMin: state.prefs.dailyGoalMin });
      }
      // What was the effective goal before today (ignoring any today override)?
      let prevBest = null;
      for (const g of history) {
        if (g.from < today && (!prevBest || g.from > prevBest.from)) prevBest = g;
      }
      const prevEffective = prevBest ? prevBest.goalMin : state.prefs.dailyGoalMin;
      const todayIdx = history.findIndex(g => g.from === today);
      if (daily === prevEffective) {
        // Reverting to what it already was — drop the today override if present
        if (todayIdx >= 0) history.splice(todayIdx, 1);
      } else {
        if (todayIdx >= 0) history[todayIdx].goalMin = daily; else history.push({ from: today, goalMin: daily });
      }
      state.prefs.goalHistory = history;
      await Storage.setPref('goalHistory', history);
    }

    // Track monthly goal history so past months use the goal active at that time
    if (monthly !== state.prefs.monthlyGoalHr) {
      const thisMonth = Analytics.today().slice(0, 7); // 'YYYY-MM'
      const mHistory = [...(state.prefs.monthlyGoalHistory || [])];
      if (!mHistory.some(g => g.from === '0000-01')) {
        mHistory.unshift({ from: '0000-01', goalHr: state.prefs.monthlyGoalHr });
      }
      // What was the effective goal before this month (ignoring any this-month override)?
      let prevBest = null;
      for (const g of mHistory) {
        if (g.from < thisMonth && (!prevBest || g.from > prevBest.from)) prevBest = g;
      }
      const prevEffective = prevBest ? prevBest.goalHr : state.prefs.monthlyGoalHr;
      const monthIdx = mHistory.findIndex(g => g.from === thisMonth);
      if (monthly === prevEffective) {
        // Reverting to what it already was — drop the this-month override if present
        if (monthIdx >= 0) mHistory.splice(monthIdx, 1);
      } else {
        if (monthIdx >= 0) mHistory[monthIdx].goalHr = monthly; else mHistory.push({ from: thisMonth, goalHr: monthly });
      }
      state.prefs.monthlyGoalHistory = mHistory;
      await Storage.setPref('monthlyGoalHistory', mHistory);
    }

    const profileChanged = name !== state.prefs.username || daily !== state.prefs.dailyGoalMin || monthly !== state.prefs.monthlyGoalHr;

    state.prefs.username      = name;
    state.prefs.dailyGoalMin  = daily;
    state.prefs.monthlyGoalHr = monthly;
    state.prefs.reminderTime  = reminderTime;

    await Storage.setPref('username', name);
    await Storage.setPref('dailyGoalMin', daily);
    await Storage.setPref('monthlyGoalHr', monthly);
    await Storage.setPref('reminderTime', reminderTime);

    await checkAchievements();
    updateSidebarUser();
    showToast('Profile saved!', 'success');
    if (profileChanged) triggerAutoBackup();
  }

  export function renderCategories() {
    const list = document.getElementById('categories-list');
    if (!list) return;
    const cats = state.prefs.categories || DEFAULT_PREFS.categories;
    list.innerHTML = cats.map((c, i) => `
      <div class="category-item" draggable="true" data-idx="${i}">
        <span class="category-drag-handle" title="Drag to reorder">⠿</span>
        <span>${escapeHtml(c)}</span>
        <button class="category-delete" data-cat="${escapeHtml(c)}" aria-label="Delete ${escapeHtml(c)}">✕</button>
      </div>
    `).join('');

    let dragIdx = null;
    const items = list.querySelectorAll('.category-item');

    items.forEach((el, i) => {
      el.addEventListener('dragstart', e => {
        dragIdx = i;
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => el.classList.add('cat-dragging'), 0);
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('cat-dragging');
        items.forEach(c => c.classList.remove('cat-drag-over'));
        dragIdx = null;
      });
      el.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      el.addEventListener('dragenter', e => {
        e.preventDefault();
        if (i !== dragIdx) {
          items.forEach(c => c.classList.remove('cat-drag-over'));
          el.classList.add('cat-drag-over');
        }
      });
      el.addEventListener('drop', async e => {
        e.preventDefault();
        if (dragIdx === null || dragIdx === i) return;
        const arr = state.prefs.categories || [];
        const moved = arr.splice(dragIdx, 1)[0];
        arr.splice(i, 0, moved);
        state.prefs.categories = arr;
        await Storage.setPref('categories', arr);
        renderCategories();
        populateCategorySelects();
      });

      // Touch drag support for mobile — long-press anywhere on the chip to
      // pick it up, then move to reorder. Native HTML5 DnD (draggable=true) is
      // disabled for the duration of the touch so a long-press can't trigger
      // the browser's stuck translucent drag-image, which previously left the
      // chip greyed-out (opacity 0.4) and unresponsive.
      let touchGhost = null;
      let touchOffsetX = 0;
      let touchOffsetY = 0;
      let isDragging = false;
      let touchStartX = 0;
      let touchStartY = 0;
      let longPressTimer = null;

      const itemAtPoint = (x, y) => {
        const target = document.elementFromPoint(x, y);
        const found = target && target.closest('.category-item');
        return (found && found !== el) ? found : null;
      };

      const clearLongPress = () => {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      };

      const beginTouchDrag = () => {
        longPressTimer = null;
        isDragging = true;
        dragIdx = i;
        const rect = el.getBoundingClientRect();
        touchOffsetX = touchStartX - rect.left;
        touchOffsetY = touchStartY - rect.top;
        touchGhost = el.cloneNode(true);
        touchGhost.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;opacity:0.85;pointer-events:none;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.25);transition:none;`;
        document.body.appendChild(touchGhost);
        el.classList.add('cat-dragging');
        if (navigator.vibrate) navigator.vibrate(10);
      };

      const touchCleanup = () => {
        clearLongPress();
        isDragging = false;
        dragIdx = null;
        if (touchGhost) { touchGhost.remove(); touchGhost = null; }
        el.classList.remove('cat-dragging');
        items.forEach(c => c.classList.remove('cat-drag-over'));
        el.setAttribute('draggable', 'true'); // restore native DnD for mouse
      };

      el.addEventListener('contextmenu', e => { if (isDragging) e.preventDefault(); });

      // touchstart: disable native drag, record position, arm long-press timer.
      // Do NOT preventDefault here — that would suppress the ✕ delete tap.
      el.addEventListener('touchstart', e => {
        el.setAttribute('draggable', 'false');
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        clearLongPress();
        longPressTimer = setTimeout(beginTouchDrag, 300);
      }, { passive: true });

      el.addEventListener('touchmove', e => {
        const touch = e.touches[0];
        if (!isDragging) {
          // Movement before the long-press fires means scroll intent — abort pickup.
          const dx = touch.clientX - touchStartX;
          const dy = touch.clientY - touchStartY;
          if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearLongPress();
          return;
        }
        e.preventDefault();
        touchGhost.style.left = `${touch.clientX - touchOffsetX}px`;
        touchGhost.style.top  = `${touch.clientY - touchOffsetY}px`;
        const over = itemAtPoint(touch.clientX, touch.clientY);
        items.forEach(c => c.classList.remove('cat-drag-over'));
        if (over) over.classList.add('cat-drag-over');
      }, { passive: false });

      el.addEventListener('touchend', async e => {
        if (!isDragging) { touchCleanup(); return; }
        const touch = e.changedTouches[0];
        const over = touch ? itemAtPoint(touch.clientX, touch.clientY) : null;
        const targetIdx = over ? [...items].indexOf(over) : null;
        const fromIdx = dragIdx;
        touchCleanup();
        if (targetIdx !== null && targetIdx !== fromIdx) {
          const arr = state.prefs.categories || [];
          const moved = arr.splice(fromIdx, 1)[0];
          arr.splice(targetIdx, 0, moved);
          state.prefs.categories = arr;
          await Storage.setPref('categories', arr);
          renderCategories();
          populateCategorySelects();
        }
      });

      el.addEventListener('touchcancel', touchCleanup);
    });

    list.querySelectorAll('.category-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteCategory(btn.dataset.cat));
    });
  }

  // Deterministic HSL→hex so generated category colors are valid hex (usable by both the
  // HTML report and the jsPDF hexRGB() parser).
  export function _hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const k = n => (n + h / 30) % 12;
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
  }

  // Ensures every given category has a stable, unique color in state.prefs.categoryColors.
  // Returns true if the map changed, so the caller can persist once.
  export function ensureCategoryColors(cats) {
    if (!state.prefs.categoryColors || typeof state.prefs.categoryColors !== 'object') state.prefs.categoryColors = {};
    const map  = state.prefs.categoryColors;
    const used = new Set(Object.values(map));
    let changed = false, gen = Object.keys(map).length;
    (cats || []).forEach(cat => {
      if (!cat || map[cat]) return;
      let color = CATEGORY_PALETTE.find(c => !used.has(c));
      while (!color) {                                   // palette exhausted → unique golden-angle hue
        const candidate = _hslToHex(Math.round((gen++ * 137.508) % 360), 65, 55);
        if (!used.has(candidate)) color = candidate;
      }
      map[cat] = color;
      used.add(color);
      changed = true;
    });
    return changed;
  }

  // Stable color for a single category (used by the Report screen). Lazily assigns + persists
  // a color for any category that doesn't have one yet.
  export function getCategoryColor(cat) {
    if (!(state.prefs.categoryColors && state.prefs.categoryColors[cat])) {
      if (ensureCategoryColors([cat])) Storage.setPref('categoryColors', state.prefs.categoryColors);
    }
    return state.prefs.categoryColors[cat];
  }

  export async function addCategory() {
    const input = document.getElementById('new-category-input');
    const val   = input?.value.trim();
    if (!val) return;
    const cats = state.prefs.categories || [];
    if (cats.includes(val)) { showToast('Category already exists', 'warning'); return; }
    cats.push(val);
    state.prefs.categories = cats;
    ensureCategoryColors(cats);                          // assign a unique color to the new category
    await Storage.setPref('categories', cats);
    await Storage.setPref('categoryColors', state.prefs.categoryColors);
    if (input) input.value = '';
    renderCategories();
    populateCategorySelects();
  }

  export async function deleteCategory(cat) {
    const cats = (state.prefs.categories || []).filter(c => c !== cat);
    state.prefs.categories = cats;
    await Storage.setPref('categories', cats);
    renderCategories();
    populateCategorySelects();
  }

  export function populateCategorySelects() {
    const cats = state.prefs.categories || DEFAULT_PREFS.categories;
    ['entry-category', 'filter-category', 'dl-filter-category', 'dg-filter-category'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const current = sel.value;
      const defaultOpt = id === 'entry-category' ? '<option value="">Select category</option>' : '<option value="">All categories</option>';
      sel.innerHTML = defaultOpt + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      sel.value = current;
    });
  }

  /* ---- BACKUP PAGE --------------------------------- */

  export function renderBackup() {
    const activeUser = UserManager.getActive();
    const filename   = getBackupFilename(activeUser);
    const folderName = localStorage.getItem('lt_backupFolderName');

    setEl('backup-entries-count',  state.entries.length);
    setEl('backup-profile-name',   activeUser?.name || '—');
    setEl('backup-filename',       filename);
    setEl('restore-profile-name',  activeUser?.name || '—');
    setEl('restore-filename',      filename);

    // Show/hide folder configured vs. unconfigured sections
    const configured = !!folderName;
    document.getElementById('backup-folder-configured')?.classList.toggle('hidden', !configured);
    document.getElementById('backup-folder-unconfigured')?.classList.toggle('hidden', configured);
    document.getElementById('restore-folder-info')?.classList.toggle('hidden', !configured);
    document.getElementById('restore-folder-unconfigured')?.classList.toggle('hidden', configured);

    if (configured) {
      setEl('backup-folder-name',  folderName);
      setEl('restore-folder-name', folderName);
    }

    Storage.getPref('lastBackupDate').then(d => {
      setEl('last-backup-date', d ? new Date(d).toLocaleDateString() : 'Never');
    });

    renderCloudSyncCard();
    renderBackupLog();
  }

  /* ---- CLOUD SYNC CARD ----------------------------- */

  const CLOUD_STATUS_TEXT = {
    disabled:    'Not configured',
    'signed-out':'Signed out',
    syncing:     'Syncing…',
    synced:      'Up to date',
    offline:     'Offline — will sync when back online',
    error:       'Sync error — will retry',
  };

  export function renderCloudSyncCard() {
    const card = document.getElementById('cloud-sync-card');
    if (!card) return;

    const configured = Sync.isConfigured();
    const signedIn   = Sync.isSignedIn() && Sync.isBound();

    document.getElementById('cloud-disabled')?.classList.toggle('hidden', configured);
    const showForm = configured && !signedIn;
    document.getElementById('cloud-signin-form')?.classList.toggle('hidden', !showForm);
    document.getElementById('cloud-signedin')?.classList.toggle('hidden', !configured || !signedIn);
    // Always start on the sign-in tab when the form becomes visible, with a clean slate
    if (showForm) {
      setCloudAuthMode('signin');
      const emailEl = document.getElementById('cloud-email');
      const passEl  = document.getElementById('cloud-password');
      const confEl  = document.getElementById('cloud-password-confirm');
      if (emailEl) emailEl.value = '';
      if (passEl)  passEl.value  = '';
      if (confEl)  confEl.value  = '';
      const statusEl = document.getElementById('cloud-auth-status');
      if (statusEl) statusEl.style.display = 'none';
    }

    if (configured && signedIn) {
      setEl('cloud-account-email', Sync.getAccountEmail() || '—');
      setEl('cloud-status-label',  CLOUD_STATUS_TEXT[Sync.getStatus()] || '—');
      const last = Sync.getLastCloudSync();
      setEl('cloud-last-sync', last ? new Date(last).toLocaleString() : 'Never');
    }
  }

  function showCloudAuthStatus(message, type) {
    const el = document.getElementById('cloud-auth-status');
    if (!el) return;
    el.style.display = 'block';
    el.className     = `import-status ${type}`;
    el.textContent   = message;
  }

  // Map raw Supabase auth errors to messages a user can act on.
  function friendlyAuthError(err) {
    const msg = (err?.message || '').toLowerCase();
    if (msg.includes('invalid login'))        return 'Incorrect email or password.';
    if (msg.includes('already registered'))   return 'That email already has an account — try signing in.';
    if (msg.includes('email not confirmed'))  return 'Please confirm your email first (check your inbox).';
    if (msg.includes('password'))             return 'Password must be at least 6 characters.';
    if (msg.includes('rate limit') || msg.includes('too many requests')) return 'Too many attempts — please wait a few minutes and try again.';
    if (msg.includes('failed to fetch') || msg.includes('network')) return 'Network error — check your connection.';
    return err?.message || 'Something went wrong. Please try again.';
  }

  let _cloudAuthMode = 'signin'; // 'signin' | 'signup'

  function setCloudAuthMode(mode) {
    _cloudAuthMode = mode;
    const confirmGroup = document.getElementById('cloud-confirm-group');
    const submitBtn    = document.getElementById('cloud-submit-btn');
    const modePrompt   = document.getElementById('cloud-mode-prompt');
    const modeToggle   = document.getElementById('cloud-mode-toggle');
    const passwordLabel = document.getElementById('cloud-password-label');
    const passwordInput = document.getElementById('cloud-password');
    const confirmInput  = document.getElementById('cloud-password-confirm');

    if (mode === 'signup') {
      confirmGroup?.classList.remove('hidden');
      if (confirmInput)  confirmInput.required        = true;
      if (submitBtn)     submitBtn.textContent         = 'Create Account';
      if (modePrompt)    modePrompt.textContent        = 'Already have an account?';
      if (modeToggle)    modeToggle.textContent        = 'Sign in';
      if (passwordInput) { passwordInput.autocomplete  = 'new-password'; passwordInput.placeholder = 'At least 6 characters'; }
    } else {
      confirmGroup?.classList.add('hidden');
      if (confirmInput)  { confirmInput.required = false; confirmInput.value = ''; }
      if (submitBtn)     submitBtn.textContent         = 'Sign In';
      if (modePrompt)    modePrompt.textContent        = "Don't have an account?";
      if (modeToggle)    modeToggle.textContent        = 'Create one';
      if (passwordInput) { passwordInput.autocomplete  = 'current-password'; passwordInput.placeholder = 'Enter your password'; }
    }
    // Clear status only when user manually toggles — not on background re-renders
  }

  async function doCloudAuth() {
    const email    = document.getElementById('cloud-email')?.value.trim();
    const password = document.getElementById('cloud-password')?.value || '';
    if (!email || !password) { showCloudAuthStatus('Enter your email and password.', 'error'); return; }

    if (_cloudAuthMode === 'signup') {
      const confirm = document.getElementById('cloud-password-confirm')?.value || '';
      if (!confirm) { showCloudAuthStatus('Please confirm your password.', 'error'); return; }
      if (password !== confirm) { showCloudAuthStatus('Passwords don\'t match.', 'error'); return; }
    }

    const btn = document.getElementById('cloud-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = _cloudAuthMode === 'signin' ? 'Signing in…' : 'Creating…'; }

    try {
      if (_cloudAuthMode === 'signup') {
        const data = await Sync.signUp(email, password);
        if (data.session) {
          // Email confirmation disabled — signed in immediately; form is already hidden,
          // so use a toast. Re-render to show the signed-in card state.
          showToast('Account created — your data is now syncing.', 'success');
          renderCloudSyncCard();
          renderPage(state.currentPage);
        } else {
          // Email confirmation required — switch to sign-in mode (so the button reads
          // "Sign In"), then show the message. Do NOT call renderCloudSyncCard() here
          // as it would wipe the status message immediately.
          setCloudAuthMode('signin');
          showCloudAuthStatus(
            'Check your email for a confirmation link, then come back here to sign in.',
            'success'
          );
        }
      } else {
        await Sync.signIn(email, password);
        showToast('Signed in — your data is now syncing across devices.', 'success');
        renderCloudSyncCard();
        renderPage(state.currentPage);
      }
    } catch (err) {
      showCloudAuthStatus(friendlyAuthError(err), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        // Restore the label based on current mode (setCloudAuthMode may have changed it).
        btn.textContent = _cloudAuthMode === 'signin' ? 'Sign In' : 'Create Account';
      }
    }
  }

  async function cloudSyncNow() {
    const btn  = document.getElementById('cloud-sync-now-btn');
    const orig = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
    try {
      await Sync.pushSnapshot();
      await Sync.pullSnapshot();
      showToast('Cloud sync complete.', 'success');
    } catch {
      showToast('Sync failed — check your connection.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
      renderCloudSyncCard();
    }
  }

  function cloudRestore() {
    showConfirm(
      'Restore from cloud?',
      'This pulls the latest cloud snapshot and merges it into this device. The newest version of each item wins — nothing is lost.',
      async () => {
        try {
          const r = await Sync.pullSnapshot({ force: true });
          showToast(r.applied ? 'Restored from cloud.' : 'Nothing newer in the cloud.', r.applied ? 'success' : 'info');
        } catch {
          showToast('Restore failed — check your connection.', 'error');
        } finally {
          renderBackup();
        }
      }
    );
  }

  function cloudSignOut() {
    showConfirm(
      'Sign out of cloud sync?',
      'Your data stays on this device. Syncing pauses until you sign in again.',
      async () => {
        await Sync.signOut();
        showToast('Signed out of cloud sync.', 'info');
        renderCloudSyncCard();
      }
    );
  }

  export async function renderBackupLog() {
    const container = document.getElementById('backup-history-list');
    if (!container) return;

    const logs = await Storage.getBackupLog();
    if (logs.length === 0) {
      container.innerHTML = '<div class="empty-state-small"><span>📭</span><p>No backups recorded yet.</p></div>';
      return;
    }

    container.innerHTML = logs.map(log => `
      <div class="backup-history-item">
        <span>${log.type === 'export' ? '💾' : '📂'} ${escapeHtml(log.label || 'Backup')}</span>
        <span class="backup-history-meta">${new Date(log.id).toLocaleString()}</span>
      </div>
    `).join('');
  }

  export function getBackupFilename(user) {
    const safeName = (user?.name || 'profile').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    return `learntrack-backup-${safeName}.json`;
  }

  // Retrieve stored handle and ensure permission is granted.
  // Must be called inside a user-gesture handler so requestPermission() can show UI.
  export async function getOrRequestFolderHandle(mode = 'readwrite') {
    if (!window.showDirectoryPicker) return null;
    try {
      const handle = await Storage.getDirectoryHandle();
      if (!handle) return null;
      let perm = await handle.queryPermission({ mode });
      if (perm !== 'granted') perm = await handle.requestPermission({ mode });
      return perm === 'granted' ? handle : null;
    } catch { return null; }
  }

  export async function configureBackupFolder() {
    if (!window.showDirectoryPicker) {
      showToast('Folder selection requires Chrome or Edge browser.', 'warning');
      return false;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await Storage.saveDirectoryHandle(handle);
      localStorage.setItem('lt_backupFolderName', handle.name);
      localStorage.removeItem('lt_backup_skipped');
      renderBackup();
      showToast(`Backup folder set to "${handle.name}"`, 'success');
      return true;
    } catch (err) {
      if (err.name !== 'AbortError') showToast('Could not set folder: ' + err.message, 'error');
      return false;
    }
  }

  export function setupBackup() {
    const warnChip = document.getElementById('sidebar-backup-warning');
    if (warnChip) {
      const goBackup = () => navigateTo('backup');
      warnChip.addEventListener('click', goBackup);
      warnChip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') goBackup(); });
    }

    document.getElementById('backup-btn')?.addEventListener('click', () => backupCurrentProfile());
    document.getElementById('load-backup-btn')?.addEventListener('click', loadBackupForProfile);
    document.getElementById('configure-folder-btn')?.addEventListener('click', configureBackupFolder);
    document.getElementById('change-folder-btn')?.addEventListener('click', configureBackupFolder);

    const browseInput = document.getElementById('browse-backup-input');
    document.getElementById('browse-backup-btn')?.addEventListener('click', () => browseInput?.click());
    browseInput?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) browseImportFile(file);
      browseInput.value = ''; // reset so same file can be picked again
    });

    // Cloud Sync card
    document.getElementById('cloud-signin-form')?.addEventListener('submit', e => { e.preventDefault(); doCloudAuth(); });
    document.getElementById('cloud-mode-toggle')?.addEventListener('click', () => {
      const statusEl = document.getElementById('cloud-auth-status');
      if (statusEl) statusEl.style.display = 'none';
      setCloudAuthMode(_cloudAuthMode === 'signin' ? 'signup' : 'signin');
    });
    document.getElementById('cloud-sync-now-btn')?.addEventListener('click', cloudSyncNow);
    document.getElementById('cloud-restore-btn')?.addEventListener('click', cloudRestore);
    document.getElementById('cloud-signout-btn')?.addEventListener('click', cloudSignOut);
    // Keep the card in step with background sync state changes (auto-push results, token refresh, etc.)
    document.addEventListener('lt-sync-changed', renderCloudSyncCard);
  }

  export async function backupCurrentProfile(silent = false) {
    if (!silent && state.entries.length === 0) {
      showToast('No data to save. Add some learning entries first.', 'warning');
      return;
    }

    // Use the stored folder handle; if missing, ask the user to configure one first (manual only)
    let dirHandle = await getOrRequestFolderHandle('readwrite');
    if (!dirHandle) {
      if (silent) throw new Error('No backup folder configured');
      showToast('Please configure a backup folder first.', 'warning');
      const ok = await configureBackupFolder();
      if (!ok) return;
      dirHandle = await getOrRequestFolderHandle('readwrite');
      if (!dirHandle) { showToast('Could not access backup folder.', 'error'); return; }
    }

    const activeUser = UserManager.getActive();
    const filename   = getBackupFilename(activeUser);

    try {
      const backup = await Storage.exportAll();
      // Always embed current in-memory profile data so defaults are captured even if never explicitly saved
      const { lastBackupDate: _dropped, compact: _compact, ...exportedPrefs } = backup.data.preferences;
      backup.data.preferences = {
        ...exportedPrefs,
        username:             state.prefs.username,
        dailyGoalMin:         state.prefs.dailyGoalMin,
        monthlyGoalHr:        state.prefs.monthlyGoalHr,
        goalHistory:          state.prefs.goalHistory || [],
        monthlyGoalHistory:   state.prefs.monthlyGoalHistory || [],
      };
      const json     = JSON.stringify(backup, null, 2);
      const fh       = await dirHandle.getFileHandle(filename, { create: true }); // overwrites if exists
      const writable = await fh.createWritable();
      await writable.write(json);
      await writable.close();

      await Storage.setPref('lastBackupDate', Date.now());
      await Storage.addBackupLog({ type: 'export', label: `Backed up → ${dirHandle.name}/${filename}` });
      state.lastAutoBackup = Date.now();
      localStorage.setItem(`lt_last_auto_backup_${UserManager.getActive()?.id || 'default'}`, state.lastAutoBackup);
      state.backupFailures = 0;
      state.backupFailing  = false;
      updateSidebarBackupStatus(true);
      if (!silent) {
        showToast('Backup completed successfully!', 'success');
        renderBackup();
      }
    } catch (err) {
      if (!silent && err.name !== 'AbortError') showToast('Backup failed: ' + err.message, 'error');
      if (silent) throw err;
    }
  }

  export async function loadBackupForProfile() {
    const activeUser = UserManager.getActive();
    const filename   = getBackupFilename(activeUser);

    // Load automatically from the stored folder — no picker shown
    const dirHandle = await getOrRequestFolderHandle('read');
    if (!dirHandle) {
      showImportStatus('No backup folder configured. Use "Configure Folder" to set one.', 'error');
      return;
    }

    try {
      let fileHandle;
      try {
        fileHandle = await dirHandle.getFileHandle(filename);
      } catch {
        showImportStatus(
          `No backup found for profile "${activeUser?.name || 'this profile'}". Expected file: ${filename}`,
          'error'
        );
        return;
      }
      const file = await fileHandle.getFile();
      importFile(file);
    } catch (err) {
      if (err.name !== 'AbortError') showToast('Could not read from folder: ' + err.message, 'error');
    }
  }

  export async function browseImportFile(file) {
    if (!file.name.endsWith('.json')) {
      showImportStatus('Only JSON backup files are supported.', 'error');
      return;
    }

    let backup;
    try {
      const text = await file.text();
      backup = JSON.parse(text);
    } catch {
      showImportStatus('Corrupted backup file (invalid JSON).', 'error');
      return;
    }

    if (!backup.version || !backup.appName || !backup.data) {
      showImportStatus('Invalid backup file format.', 'error');
      return;
    }
    if (backup.appName !== 'LearnTrack') {
      showImportStatus('Unsupported backup file (different app).', 'error');
      return;
    }

    const existingEntries = await Storage.getAllEntries();
    const users = UserManager.getUsers();
    const isFirstTime = existingEntries.length === 0
      && users.length <= 1
      && (users[0]?.name || '').toLowerCase() === 'me';

    if (isFirstTime) {
      // First launch — replace the default profile with what's in the file
      const result = await Storage.importAll(backup);
      state.entries   = await Storage.getAllEntries();
      state.earnedAch = await Storage.getAllAchievements();
      state.goals     = await Storage.getAllGoals();
      state.prefs     = { ...DEFAULT_PREFS, ...(await Storage.getAllPrefs()) };
      await checkAchievements();

      // Sync UserManager name with imported username
      const importedName = state.prefs.username;
      if (importedName) {
        const activeUser = UserManager.getActive();
        if (activeUser) UserManager.updateUser(activeUser.id, importedName);
      }

      applyTheme(state.prefs.theme);
      applyAccent(state.prefs.accent);
      applyCompact(state.prefs.compact);
      const skipNote = result.skipped > 0 ? ` (${result.skipped} invalid skipped)` : '';
      showImportStatus(`✅ Imported ${result.imported} entries into your profile.${skipNote}`, 'success');
      await Storage.addBackupLog({ type: 'import', label: `Browsed & imported: ${file.name}` });
    } else {
      // Existing data — create a new profile for the imported data and switch to it
      const importedName = backup.data.preferences?.username || file.name.replace(/\.json$/i, '');
      const duplicate = UserManager.getUsers().find(u => u.name.toLowerCase() === importedName.toLowerCase());
      if (duplicate) {
        showImportStatus(`A profile named "${duplicate.name}" already exists. Rename or delete it first.`, 'error');
        return;
      }
      const newUser = UserManager.createUser(importedName);
      await switchUser(newUser.id, importedName);

      // Now import into this fresh profile
      const result = await Storage.importAll(backup);
      state.entries   = await Storage.getAllEntries();
      state.earnedAch = await Storage.getAllAchievements();
      state.goals     = await Storage.getAllGoals();
      state.prefs     = { ...DEFAULT_PREFS, ...(await Storage.getAllPrefs()) };
      await checkAchievements();

      applyTheme(state.prefs.theme);
      applyAccent(state.prefs.accent);
      applyCompact(state.prefs.compact);
      const skipNote = result.skipped > 0 ? ` (${result.skipped} invalid skipped)` : '';
      showImportStatus(`✅ Created profile "${importedName}" with ${result.imported} imported entries.${skipNote}`, 'success');
      await Storage.addBackupLog({ type: 'import', label: `Browsed & imported as new profile: ${file.name}` });
    }

    renderPage(state.currentPage);
    updateSidebarUser();
    renderBackup();
  }

  export function importFile(file) {
    if (!file.name.endsWith('.json')) {
      showImportStatus('Invalid backup file format. Only JSON files are supported.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const raw    = e.target.result;
        if (!raw || raw.trim() === '') { showImportStatus('Empty backup file.', 'error'); return; }

        const backup = JSON.parse(raw);

        // Validate structure
        if (!backup.version || !backup.appName || !backup.data) {
          showImportStatus('Invalid backup file format.', 'error');
          return;
        }
        if (backup.appName !== 'LearnTrack') {
          showImportStatus('Unsupported backup file (different app).', 'error');
          return;
        }

        const result = await Storage.importAll(backup);

        // Refresh in-memory state including profile prefs
        state.entries   = await Storage.getAllEntries();
        state.earnedAch = await Storage.getAllAchievements();
        state.goals     = await Storage.getAllGoals();
        state.prefs     = { ...DEFAULT_PREFS, ...(await Storage.getAllPrefs()) };
        await checkAchievements();
        applyTheme(state.prefs.theme);
        applyAccent(state.prefs.accent);
        applyCompact(state.prefs.compact);

        const goalNote = result.prefsRestored > 0 ? ' Goal history restored.' : '';
        showImportStatus(
          `✅ Imported ${result.imported} new entries, ${result.updated} updated, ${result.skipped} skipped.${goalNote}`,
          'success'
        );

        await Storage.addBackupLog({ type: 'import', label: `Imported from ${file.name} (${result.imported} new)` });

        renderPage(state.currentPage);
        updateSidebarUser();
        showToast('Backup restored successfully!', 'success');
        renderBackup();
      } catch (err) {
        if (err instanceof SyntaxError) {
          showImportStatus('Corrupted backup file (invalid JSON).', 'error');
        } else {
          showImportStatus('Import failed: ' + err.message, 'error');
        }
      }
    };
    reader.onerror = () => showImportStatus('Could not read file.', 'error');
    reader.readAsText(file);
  }

  export function showImportStatus(message, type) {
    const el = document.getElementById('import-status');
    if (!el) return;
    el.style.display = 'block';
    el.className     = `import-status ${type}`;
    el.textContent   = message;
    if (type === 'success') {
      setTimeout(() => { el.style.display = 'none'; }, 6000);
    }
  }
