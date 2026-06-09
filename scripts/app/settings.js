/* ===== settings.js — extracted from app.js ===== */
import { state, DEFAULT_PREFS, CATEGORY_PALETTE } from './state.js';
import { checkAchievements } from './achievements.js';
import { triggerAutoBackup, updateSidebarBackupStatus } from './core.js';
import { navigateTo, renderPage, updateSidebarUser } from './nav.js';
import { UserManager, openUserPicker, renderUsersManagement, switchUser } from './users.js';
import { escapeHtml, setCheckbox, setEl, setInputVal, showConfirm, showToast } from './utils.js';
import { applyAccent, applyCompact, applyTheme } from './widgets.js';
import { canUse, loadEntitlements } from './entitlements.js';
import { getCloudProfileId } from './cloud-repo.js';
import * as Sync from './sync.js';
import * as Auth from './auth.js';
import { isTestSession, getTestSession, testAccountId } from './test-accounts.js';

  /* ---- Theme → accent pairings -------------------- */
  // Themed environments have a natural accent; neutral themes (light/dark) leave the user's accent unchanged.
  const THEME_ACCENTS = {
    midnight: '#38bdf8',
    solarized:'#2aa198',
    forest:   '#a3e635',
    sunset:   '#fb923c',
    ocean:    '#22d3ee',
    mocha:    '#c2410c',
    nord:     '#88c0d0',
    dracula:  '#ff79c6',
    lavender: '#7c3aed',
    crimson:  '#ff6b6b',
    aura:     '#a855f7',
    mint:     '#059669',
  };

  // Maps named preset accents to hex for display in per-theme chips.
  const NAMED_ACCENT_COLORS = {
    blue: '#3b82f6', purple: '#6c63ff', green: '#10b981',
    teal: '#14b8a6', orange: '#f97316', rose:  '#f43f5e',
  };

  /* ---- SETTINGS PAGE ------------------------------- */

  export function renderSettings() {
    setInputVal('setting-username',      state.prefs.username || '');
    setInputVal('setting-daily-goal',    state.prefs.dailyGoalMin || 60);
    setInputVal('setting-monthly-goal',  state.prefs.monthlyGoalHr || 20);
    sizeUsernameInput();
    setInputVal('setting-reminder-time', state.prefs.reminderTime || '20:00');
    setCheckbox('setting-reminder', state.prefs.reminder || false);

    // Reminder time row
    const rtRow = document.getElementById('reminder-time-row');
    if (rtRow) rtRow.style.display = state.prefs.reminder ? 'flex' : 'none';

    renderAppearance();
    renderCategories();
    renderUsersManagement();
    // Reload entitlements from cloud; re-render appearance + user management once resolved
    // so profile_limit and gated features always reflect the current subscription.
    loadEntitlements().finally(() => { renderAppearance(); renderUsersManagement(); });

    // Danger Zone: "Delete Account" is cloud-only — show it only when signed in.
    const delRow = document.getElementById('delete-account-row');
    if (delRow) delRow.style.display = Sync.isSignedIn() ? 'flex' : 'none';
  }

  export function renderAppearance() {
    const theme   = state.prefs.theme          || 'dark';
    const accent  = state.prefs.accent         || 'purple';
    const isHex   = accent.startsWith('#');

    // ---- plan tier badge ----
    const badge = document.getElementById('plan-tier-badge');
    if (badge) {
      const tier = state.tier || 'free';
      const labels = { free: 'Free', premium: 'Premium', family: 'Family' };
      badge.textContent = labels[tier] || tier;
      badge.dataset.tier = tier;
    }

    // ---- theme buttons ----
    document.querySelectorAll('.theme-option[data-theme]').forEach(btn => {
      const t      = btn.dataset.theme;
      const locked = !canUse('theme', t);
      btn.classList.toggle('active', t === theme);
      btn.dataset.locked = locked ? 'true' : 'false';
      const badge = btn.querySelector('.lock-badge');
      if (badge) badge.style.display = locked ? '' : 'none';
    });

    // ---- preset accent swatches ----
    document.querySelectorAll('.accent-swatch[data-accent]').forEach(btn => {
      const a      = btn.dataset.accent;
      const locked = !canUse('accent', a);
      btn.classList.toggle('active', !isHex && a === accent);
      btn.dataset.locked = locked ? 'true' : 'false';
      const badge = btn.querySelector('.lock-badge');
      if (badge) badge.style.display = locked ? '' : 'none';
    });

    // ---- custom hex swatch ----
    const customBtn = document.getElementById('custom-accent-open-btn');
    if (customBtn) {
      const locked = !canUse('feature', 'custom_accent');
      customBtn.dataset.locked = locked ? 'true' : 'false';
      customBtn.classList.toggle('active', isHex);
      const badge = customBtn.querySelector('.lock-badge');
      if (badge) badge.style.display = locked ? '' : 'none';
      // Show the current hex as a dot inside the swatch when active
      const icon = document.getElementById('custom-accent-icon');
      if (icon) icon.style.background = isHex ? accent : 'var(--surface)';
    }

    // ---- custom hex row ----
    const customRow   = document.getElementById('custom-accent-row');
    const customInput = document.getElementById('custom-accent-input');
    if (isHex) {
      customRow?.classList.remove('hidden');
      if (customInput) customInput.value = accent;
    } else {
      customRow?.classList.add('hidden');
    }

    // ---- reset-to-theme-default button ----
    // Visible only when the active theme has a paired default AND the current accent differs from it.
    const resetThemeBtn = document.getElementById('reset-theme-accent-btn');
    if (resetThemeBtn) {
      const themeDefault = THEME_ACCENTS[theme];
      const show = !!(themeDefault && accent !== themeDefault);
      resetThemeBtn.style.display = show ? '' : 'none';
      if (show) {
        const label = theme.charAt(0).toUpperCase() + theme.slice(1);
        resetThemeBtn.textContent = `Reset ${label} to default`;
      }
    }

    // ---- reset-all-theme-accents button ----
    // Visible when any theme has a stored override.
    const resetAllRow = document.getElementById('reset-all-theme-accents-row');
    const overrides = state.prefs.themeAccentOverrides || {};
    const overridePairs = Object.entries(overrides);
    if (resetAllRow) {
      resetAllRow.style.display = overridePairs.length > 0 ? '' : 'none';
    }

    // ---- per-theme reset chips ----
    // One chip per theme that has a custom override — lets the user reset a single theme.
    const perThemeRow = document.getElementById('reset-per-theme-row');
    if (perThemeRow) {
      if (overridePairs.length > 0) {
        perThemeRow.style.display = '';
        perThemeRow.innerHTML = overridePairs.map(([t, val]) => {
          const label = t.charAt(0).toUpperCase() + t.slice(1);
          const hex   = val.startsWith('#') ? val : (NAMED_ACCENT_COLORS[val] || '#6c63ff');
          return `<button class="theme-reset-chip" data-reset-theme="${t}" title="Reset ${label} to default"><span class="chip-dot" style="background:${hex}"></span><span>${label}</span><span class="chip-x">×</span></button>`;
        }).join('');
      } else {
        perThemeRow.style.display = 'none';
        perThemeRow.innerHTML = '';
      }
    }
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

    document.querySelectorAll('.theme-option[data-theme]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!canUse('theme', btn.dataset.theme)) {
          showToast('Upgrade to Premium to unlock this theme.', 'info');
          return;
        }
        const theme = btn.dataset.theme;
        state.prefs.theme = theme;
        await Storage.setPref('theme', theme);
        applyTheme(theme);

        // Use the user's saved override for this theme, falling back to the theme default.
        const overrides    = state.prefs.themeAccentOverrides || {};
        const accentToApply = overrides[theme] || THEME_ACCENTS[theme];
        if (accentToApply) {
          const isHex = accentToApply.startsWith('#');
          state.prefs.accent = accentToApply;
          state.prefs.customAccentHex = isHex ? accentToApply : null;
          await Storage.setPref('accent', accentToApply);
          await Storage.setPref('customAccentHex', isHex ? accentToApply : null);
          applyAccent(accentToApply);
          Charts.refreshAllCharts();
        }

        renderAppearance();
        _patchCloudAppearance();
      });
    });

    document.querySelectorAll('.accent-swatch[data-accent]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!canUse('accent', btn.dataset.accent)) {
          showToast('Upgrade to Premium to unlock this accent.', 'info');
          return;
        }
        const accent = btn.dataset.accent;
        state.prefs.accent       = accent;
        state.prefs.customAccentHex = null;
        await Storage.setPref('accent', accent);
        await Storage.setPref('customAccentHex', null);
        await _saveThemeAccentOverride(accent);
        applyAccent(accent);
        renderAppearance();
        Charts.refreshAllCharts();
        _patchCloudAppearance();
      });
    });

    // Custom hex swatch button — toggle the picker row (Premium only)
    document.getElementById('custom-accent-open-btn')?.addEventListener('click', () => {
      if (!canUse('feature', 'custom_accent')) {
        showToast('Upgrade to Premium to use a custom accent color.', 'info');
        return;
      }
      const row = document.getElementById('custom-accent-row');
      row?.classList.toggle('hidden');
    });

    // Apply custom hex
    document.getElementById('custom-accent-apply')?.addEventListener('click', async () => {
      const input = document.getElementById('custom-accent-input');
      const hex   = input?.value || '#6c63ff';
      state.prefs.accent          = hex;
      state.prefs.customAccentHex = hex;
      await Storage.setPref('accent', hex);
      await Storage.setPref('customAccentHex', hex);
      await _saveThemeAccentOverride(hex);
      applyAccent(hex);
      renderAppearance();
      Charts.refreshAllCharts();
      _patchCloudAppearance();
    });

    // Reset custom hex — revert to the theme's default accent (or purple for light/dark).
    // Also clears the per-theme override so the default sticks on next switch.
    document.getElementById('custom-accent-cancel')?.addEventListener('click', async () => {
      const theme         = state.prefs.theme || 'dark';
      const defaultAccent = THEME_ACCENTS[theme] || 'purple';
      state.prefs.accent          = defaultAccent;
      state.prefs.customAccentHex = null;
      await Storage.setPref('accent', defaultAccent);
      await Storage.setPref('customAccentHex', null);
      const overrides = { ...(state.prefs.themeAccentOverrides || {}) };
      delete overrides[theme];
      state.prefs.themeAccentOverrides = overrides;
      await Storage.setPref('themeAccentOverrides', overrides);
      applyAccent(defaultAccent);
      renderAppearance();
      Charts.refreshAllCharts();
      _patchCloudAppearance();
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
      const accountId       = state.syncSession?.user?.id || null;
      const localProfileId  = UserManager.getActiveId();
      const cloudProfileId  = accountId ? getCloudProfileId(localProfileId, accountId) : null;
      const willResetCloud  = Sync.isSignedIn() && !!cloudProfileId;

      const msg = willResetCloud
        ? 'This will permanently delete ALL entries, goals, achievements, and settings for this profile — both on this device and from the cloud. This cannot be undone!'
        : 'This will permanently delete ALL your entries, goals, achievements, and settings on this device. This cannot be undone!';

      showConfirm('Reset all data?', msg, async () => {
        // Wipe local data and clear the outbox so stale ops can't re-sync deleted data.
        await Storage.resetAll();
        await Storage.clearOutbox();

        // Wipe cloud data for this profile (entries/goals/achievements/categories/prefs).
        if (willResetCloud) {
          try {
            const { getClient } = await import('./sync.js');
            const sb = await getClient();
            const { error } = await sb.rpc('reset_profile_data', { p_profile_id: cloudProfileId });
            if (error) throw error;
          } catch (err) {
            console.warn('[Settings] cloud reset failed:', err?.message || err);
            showToast('Local data cleared. Cloud reset failed — try again while online.', 'warning');
          }
        }

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

    document.getElementById('reset-theme-accent-btn')?.addEventListener('click', async () => {
      const theme        = state.prefs.theme || 'dark';
      const themeDefault = THEME_ACCENTS[theme];
      if (!themeDefault) return;
      // Remove the per-theme override and apply the paired default.
      const overrides = { ...(state.prefs.themeAccentOverrides || {}) };
      delete overrides[theme];
      state.prefs.themeAccentOverrides = overrides;
      await Storage.setPref('themeAccentOverrides', overrides);
      const isHex = themeDefault.startsWith('#');
      state.prefs.accent          = themeDefault;
      state.prefs.customAccentHex = isHex ? themeDefault : null;
      await Storage.setPref('accent', themeDefault);
      await Storage.setPref('customAccentHex', isHex ? themeDefault : null);
      applyAccent(themeDefault);
      Charts.refreshAllCharts();
      renderAppearance();
      _patchCloudAppearance();
    });

    document.getElementById('reset-all-theme-accents-btn')?.addEventListener('click', async () => {
      // Clear all per-theme overrides and re-apply the current theme's default.
      state.prefs.themeAccentOverrides = {};
      await Storage.setPref('themeAccentOverrides', {});
      const theme        = state.prefs.theme || 'dark';
      const themeDefault = THEME_ACCENTS[theme];
      if (themeDefault) {
        const isHex = themeDefault.startsWith('#');
        state.prefs.accent          = themeDefault;
        state.prefs.customAccentHex = isHex ? themeDefault : null;
        await Storage.setPref('accent', themeDefault);
        await Storage.setPref('customAccentHex', isHex ? themeDefault : null);
        applyAccent(themeDefault);
        Charts.refreshAllCharts();
      }
      renderAppearance();
      _patchCloudAppearance();
      showToast('All theme accents reset to defaults.', 'info');
    });

    // Per-theme chip: reset just one theme's override.
    document.getElementById('reset-per-theme-row')?.addEventListener('click', async (e) => {
      const chip = e.target.closest('[data-reset-theme]');
      if (!chip) return;
      const targetTheme = chip.dataset.resetTheme;
      const overrides = { ...(state.prefs.themeAccentOverrides || {}) };
      delete overrides[targetTheme];
      state.prefs.themeAccentOverrides = overrides;
      await Storage.setPref('themeAccentOverrides', overrides);
      // If target is the active theme, immediately restore the theme default.
      if (targetTheme === (state.prefs.theme || 'dark')) {
        const themeDefault = THEME_ACCENTS[targetTheme];
        if (themeDefault) {
          const isHex = themeDefault.startsWith('#');
          state.prefs.accent          = themeDefault;
          state.prefs.customAccentHex = isHex ? themeDefault : null;
          await Storage.setPref('accent', themeDefault);
          await Storage.setPref('customAccentHex', isHex ? themeDefault : null);
          applyAccent(themeDefault);
          Charts.refreshAllCharts();
          _patchCloudAppearance();
        }
      }
      renderAppearance();
      const label = targetTheme.charAt(0).toUpperCase() + targetTheme.slice(1);
      showToast(`${label} accent reset to default.`, 'info');
    });

    document.getElementById('delete-account-btn')?.addEventListener('click', () => {
      if (!Sync.isSignedIn()) {
        showToast('Sign in to a cloud account first.', 'warning');
        return;
      }
      showDeleteAccountModal();
    });
  }

  // Typed-confirmation modal for account deletion. The red Delete button stays
  // disabled until the user types their account email (or "DELETE" if no email
  // is available). On confirm, account-session.js flags the cloud account for a
  // 60-day soft delete and tears down the local session (mirrors cloudSignOut).
  function showDeleteAccountModal() {
    const modal     = document.getElementById('delete-account-modal');
    const input     = document.getElementById('delete-account-confirm-input');
    const hint      = document.getElementById('delete-account-email-hint');
    const confirmBtn = document.getElementById('delete-account-confirm-btn');
    const cancelBtn = document.getElementById('delete-account-cancel');
    if (!modal || !input || !confirmBtn) {
      // Markup missing — fall back to the generic confirm dialog.
      showConfirm('Delete your account?', 'This schedules your cloud account and all its data for permanent deletion in 60 days. You can cancel by signing back in within that window.', () => _runAccountDeletion());
      return;
    }

    const expected = (Sync.getAccountEmail() || 'DELETE').trim();
    if (hint) hint.textContent = expected;
    input.placeholder = Sync.getAccountEmail() ? 'your email' : 'DELETE';
    input.value = '';
    confirmBtn.disabled = true;

    const matches = () => input.value.trim().toLowerCase() === expected.toLowerCase();

    function onInput() { confirmBtn.disabled = !matches(); }
    function cleanup() {
      modal.style.display = 'none';
      input.removeEventListener('input', onInput);
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn?.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
    }
    function onConfirm() {
      if (!matches()) return;
      cleanup();
      _runAccountDeletion();
    }
    function onCancel() { cleanup(); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
      if (e.key === 'Enter')  { e.preventDefault(); onConfirm(); }
    }

    input.addEventListener('input', onInput);
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn?.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);

    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 0);
  }

  function _runAccountDeletion() {
    import('./account-session.js')
      .then(m => m.handleAccountDeletion())
      .catch(err => {
        console.warn('[Settings] account deletion failed:', err);
        showToast('Could not delete your account — please try again.', 'error');
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
        await Storage.saveCategories(arr, state.prefs.categoryColors || {});
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
          await Storage.saveCategories(arr, state.prefs.categoryColors || {});
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
      if (ensureCategoryColors([cat])) Storage.saveCategories(state.prefs.categories || [], state.prefs.categoryColors);
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
    await Storage.saveCategories(cats, state.prefs.categoryColors);
    if (input) input.value = '';
    renderCategories();
    populateCategorySelects();
  }

  export async function deleteCategory(cat) {
    const cats = (state.prefs.categories || []).filter(c => c !== cat);
    state.prefs.categories = cats;
    await Storage.saveCategories(cats, state.prefs.categoryColors || {});
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
    const filename   = getBackupFilename(activeUser, currentAccountEmail());
    const folderName = localStorage.getItem('lt_backupFolderName');

    setEl('backup-entries-count',  state.entries.length);
    setEl('backup-profile-name',   activeUser?.name || '—');
    setEl('backup-filename',       filename);
    setEl('restore-profile-name',  activeUser?.name || '—');
    setEl('restore-filename',      filename);

    // Show/hide folder UI depending on FSA support + configuration state
    const hasFsa     = !!window.showDirectoryPicker;
    const configured = hasFsa && !!folderName;

    document.getElementById('fsa-backup-notice')?.classList.toggle('hidden', hasFsa);
    document.getElementById('backup-folder-configured')?.classList.toggle('hidden', !configured);
    document.getElementById('backup-folder-unconfigured')?.classList.toggle('hidden', !hasFsa || configured);

    document.getElementById('fsa-restore-notice')?.classList.toggle('hidden', hasFsa);
    document.getElementById('restore-folder-info')?.classList.toggle('hidden', !configured);
    document.getElementById('restore-folder-unconfigured')?.classList.toggle('hidden', !hasFsa || configured);

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

    // No-cloud test account: cloud sync is unavailable. Show a disabled state and
    // make sure no cloud controls are interactive.
    if (isTestSession()) {
      document.getElementById('cloud-disabled')?.classList.remove('hidden');
      document.getElementById('cloud-signedin')?.classList.add('hidden');
      const disabledMsg = document.getElementById('cloud-disabled-msg');
      if (disabledMsg) disabledMsg.textContent =
        'Cloud backup is unavailable for test accounts. Your data stays in this browser.';
      const autoEl = document.getElementById('cloud-auto-backup');
      if (autoEl) { autoEl.checked = false; autoEl.disabled = true; }
      renderSidebarCloudAccount();
      return;
    }

    const configured = Sync.isConfigured();
    const signedIn   = Sync.isSignedIn();

    document.getElementById('cloud-disabled')?.classList.toggle('hidden', configured);
    document.getElementById('cloud-signedin')?.classList.toggle('hidden', !configured || !signedIn);

    if (configured && signedIn) {
      setEl('cloud-account-email', Sync.getAccountEmail() || '—');
      const status = Sync.getStatus();
      setEl('cloud-status-label', CLOUD_STATUS_TEXT[status] || 'Signed in');
      const last = Sync.getLastCloudSync();
      setEl('cloud-last-sync', last ? new Date(last).toLocaleString() : 'Never');
      const autoEl = document.getElementById('cloud-auto-backup');
      if (autoEl) autoEl.checked = !!state.prefs.cloudAutoBackup;
    }

    renderSidebarCloudAccount();
  }

  function renderSidebarCloudAccount() {
    const btn      = document.getElementById('sidebar-signout-btn-inline');
    const welcome  = document.getElementById('sidebar-cloud-welcome');
    const nameEl   = document.getElementById('sidebar-cloud-name');

    // No-cloud test account: no real session, but still show the sign-out control
    // and the test email so the user can end the local session.
    const testEmail = getTestSession();
    if (testEmail) {
      if (btn)     btn.style.display     = '';
      if (welcome) welcome.style.display = 'block';
      if (nameEl)  nameEl.textContent    = testEmail;
      return;
    }

    const signedIn = Sync.isSignedIn();
    if (btn)     btn.style.display     = signedIn ? '' : 'none';
    if (welcome) welcome.style.display = signedIn ? 'block' : 'none';
    if (signedIn && nameEl) {
      const user     = state.syncSession?.user;
      const provider = user?.app_metadata?.provider;
      nameEl.textContent = provider === 'google'
        ? (user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || '')
        : (user?.email || '');
    }
  }

  function showCloudAuthStatus(message, type) {
    const el = document.getElementById('cloud-auth-status');
    if (!el) return;
    el.style.display = 'block';
    el.className     = `import-status ${type}`;
    el.textContent   = message;
  }

  function hideCloudAuthStatus() {
    const el = document.getElementById('cloud-auth-status');
    if (el) el.style.display = 'none';
  }

  // Switch between the email-entry step and the OTP-code step.
  function showOtpStep(step) {
    document.getElementById('cloud-otp-step1')?.classList.toggle('hidden', step !== 1);
    document.getElementById('cloud-otp-step2')?.classList.toggle('hidden', step !== 2);
    hideCloudAuthStatus();
  }

  // Called from renderCloudSyncCard when the form becomes visible — reset to step 1.
  function resetCloudAuthForm() {
    const emailEl = document.getElementById('cloud-email');
    const codeEl  = document.getElementById('cloud-otp-code');
    if (emailEl) emailEl.value = '';
    if (codeEl)  codeEl.value  = '';
    showOtpStep(1);
    hideCloudAuthStatus();
  }

  // Show a confirmation modal before pulling cloud data.
  // title / confirmText can be overridden for the "Restore" flow.
  // onConfirm → user agrees to pull; onSkip → user declines (push-only or cancel).
  function showSyncConfirmModal({ email, localUser, cloudInfo, title = 'Sync from Cloud?', confirmText = 'Sync & Continue', onConfirm, onSkip }) {
    const modal = document.getElementById('cloud-sync-confirm-modal');
    if (!modal) { onConfirm?.(); return; }

    const dateStr = cloudInfo?.updatedAt ? new Date(cloudInfo.updatedAt).toLocaleString() : null;
    setEl('sync-confirm-title', title);
    setEl('sync-confirm-account', email || '—');
    setEl('sync-confirm-local-user', localUser || '—');
    setEl('sync-confirm-cloud-date', dateStr || 'No backup date available');

    const confirmBtn  = document.getElementById('sync-confirm-ok');
    const skipBtn     = document.getElementById('sync-confirm-skip');
    if (confirmBtn) confirmBtn.textContent = confirmText;

    modal.style.display = 'flex';
    confirmBtn?.focus();

    function cleanup() {
      modal.style.display = 'none';
      confirmBtn?.removeEventListener('click', handleConfirm);
      skipBtn?.removeEventListener('click', handleSkip);
      document.removeEventListener('keydown', handleKey);
    }
    function handleConfirm() { cleanup(); onConfirm?.(); }
    function handleSkip()    { cleanup(); onSkip?.(); }
    function handleKey(e)    { if (e.key === 'Escape') { cleanup(); onSkip?.(); } }

    confirmBtn?.addEventListener('click', handleConfirm);
    skipBtn?.addEventListener('click', handleSkip);
    document.addEventListener('keydown', handleKey);
  }

  // Kept email in a closure so step-2 always uses the same address.
  let _otpEmail = '';

  async function sendOtp() {
    const email = (document.getElementById('cloud-email')?.value || '').trim();
    if (!email) { showCloudAuthStatus('Enter your email address.', 'error'); return; }
    const btn = document.getElementById('cloud-send-otp-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
      await Auth.requestEmailOtp(email);
      _otpEmail = email;
      const display = document.getElementById('cloud-otp-email-display');
      if (display) display.textContent = email;
      const codeEl = document.getElementById('cloud-otp-code');
      if (codeEl) { codeEl.value = ''; codeEl.focus(); }
      showOtpStep(2);
    } catch (err) {
      showCloudAuthStatus(Auth.friendlyAuthError(err), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Send Code'; }
    }
  }

  async function verifyOtp() {
    const code = (document.getElementById('cloud-otp-code')?.value || '').trim();
    if (!code) { showCloudAuthStatus('Enter the code from your email.', 'error'); return; }
    const btn = document.getElementById('cloud-verify-otp-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }
    try {
      await Auth.verifyEmailOtp(_otpEmail, code);
      // After OTP success, sync.js needs to know the session exists.
      // The supabase-js onAuthStateChange wired in initSync() propagates it,
      // but we also notify the card immediately.
      showToast('Signed in successfully.', 'success');
      renderCloudSyncCard();
      renderPage(state.currentPage);
    } catch (err) {
      showCloudAuthStatus(Auth.friendlyAuthError(err), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Verify & Sign In'; }
    }
  }

  async function cloudSyncNow() {
    const btn  = document.getElementById('cloud-sync-now-btn');
    const orig = btn?.textContent;
    let cloudInfo = null;
    try { cloudInfo = await Sync.peekCloudSnapshot(); } catch { /* ignore */ }

    showSyncConfirmModal({
      email:       Sync.getAccountEmail(),
      localUser:   UserManager.getActive()?.name || state.prefs.username || 'your profile',
      cloudInfo,
      title:       'Sync with Cloud?',
      confirmText: 'Sync',
      onConfirm: async () => {
        if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
        try {
          if (!await Sync.ensureManualSyncReady()) {
            showToast('Sign in and check your connection before syncing.', 'warning');
            return;
          }
          const { migrate } = await import('./migration.js');
          const Engine = await import('./sync-engine.js');
          await migrate();
          await Engine.drainOutbox({ manual: true });
          await Engine.pullDeltas({ manual: true });
          await Sync.pushSnapshot({ manual: true });
          showToast('Cloud sync complete.', 'success');
        } catch {
          showToast('Sync failed — check your connection.', 'error');
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = orig; }
          renderCloudSyncCard();
        }
      },
      onSkip: () => {
        /* user cancelled, nothing to do */
      },
    });
  }

  async function cloudRestore() {
    let cloudInfo = null;
    try { cloudInfo = await Sync.peekCloudSnapshot(); } catch { /* ignore */ }

    showSyncConfirmModal({
      email:       Sync.getAccountEmail(),
      localUser:   UserManager.getActive()?.name || state.prefs.username || 'your profile',
      cloudInfo,
      title:       'Restore from Cloud?',
      confirmText: 'Restore',
      onConfirm: async () => {
        try {
          if (!await Sync.ensureManualSyncReady()) {
            showToast('Sign in and check your connection before restoring.', 'warning');
            return;
          }
          const Engine = await import('./sync-engine.js');
          await Engine.pullDeltas({ manual: true });
          const r = await Sync.pullSnapshot({ force: true, manual: true });
          showToast(r.applied ? 'Restored from cloud.' : 'Restore checked cloud for updates.', r.applied ? 'success' : 'info');
        } catch {
          showToast('Restore failed — check your connection.', 'error');
        } finally {
          renderBackup();
        }
      },
      onSkip: () => { /* user cancelled, nothing to do */ },
    });
  }

  // Sign-out is orchestrated by account-session.js: it warns about unsynced
  // changes when Auto Cloud Backup is off (offering to push them first), then
  // clears this account's local data (keeping the local backup folder) and
  // redirects to the landing page.
  function cloudSignOut() {
    import('./account-session.js')
      .then(m => m.handleSignOut())
      .catch(err => {
        console.warn('[Settings] sign-out failed:', err);
        showToast('Sign-out failed — please try again.', 'error');
      });
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

  export function getBackupFilename(user, email) {
    const safeName = (user?.name || 'profile').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    if (email) {
      const safeEmail = email.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      return `learntrack-backup-${safeEmail}-${safeName}.json`;
    }
    return `learntrack-backup-${safeName}.json`;
  }

  /* ---- Account-linked local backups (req 4) ---------------------- */
  // The id/email of the account that owns the current session — a real Supabase
  // account, or the synthetic id for a no-cloud test account.
  function currentAccountId() {
    if (state.syncSession?.user?.id) return state.syncSession.user.id;
    const t = getTestSession();
    return t ? testAccountId(t) : null;
  }
  function currentAccountEmail() {
    if (state.syncSession?.user?.email) return state.syncSession.user.email;
    return getTestSession() || null;
  }

  // Decide whether a backup file may be loaded under the current account.
  // Files stamped with a DIFFERENT account are rejected; unstamped (legacy) files
  // are allowed and adopt the current account on the next backup.
  function backupAccountAllowed(backup) {
    const fileAccount = backup?.accountId || null;
    if (!fileAccount) return { ok: true };                  // legacy / unlinked
    if (fileAccount === currentAccountId()) return { ok: true };
    const who = backup?.accountEmail ? ` (${backup.accountEmail})` : '';
    return { ok: false, message: `This backup belongs to a different account${who}. Sign in with that account to restore it.` };
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

  /* ---- Cloud backup toggle — Yes/No confirmation modal ----------- */

  function showCloudBackupToggleModal(enabling, onConfirm) {
    const modal      = document.getElementById('cloud-backup-toggle-modal');
    const titleEl    = document.getElementById('cloud-toggle-modal-title');
    const bodyEl     = document.getElementById('cloud-toggle-modal-body');
    const confirmBtn = document.getElementById('cloud-toggle-confirm');
    const cancelBtn  = document.getElementById('cloud-toggle-cancel');

    if (!modal) { onConfirm(); return; }

    if (enabling) {
      if (titleEl)    titleEl.textContent = 'Enable Cloud Backup?';
      if (bodyEl)     bodyEl.textContent  = 'Your learning data for this profile will be uploaded to the cloud and kept in sync across devices. You can disable this at any time.';
      if (confirmBtn) { confirmBtn.textContent = 'Enable'; confirmBtn.className = 'btn btn-primary'; }
    } else {
      if (titleEl)    titleEl.textContent = 'Disable Cloud Backup?';
      if (bodyEl)     bodyEl.textContent  = 'Cloud sync will stop for this profile. Your data stays on this device — you can re-enable cloud backup at any time.';
      if (confirmBtn) { confirmBtn.textContent = 'Disable'; confirmBtn.className = 'btn btn-secondary'; }
    }

    modal.style.display = 'flex';
    confirmBtn?.focus();

    function cleanup() {
      modal.style.display = 'none';
      if (confirmBtn) confirmBtn.className = 'btn btn-primary';
      confirmBtn?.removeEventListener('click', handleConfirm);
      cancelBtn?.removeEventListener('click', handleCancel);
      document.removeEventListener('keydown', handleKey);
    }
    function handleConfirm() { cleanup(); onConfirm(); }
    function handleCancel()  { cleanup(); }
    function handleKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
      if (e.key === 'Enter')  { e.preventDefault(); cleanup(); onConfirm(); }
    }
    confirmBtn?.addEventListener('click', handleConfirm);
    cancelBtn?.addEventListener('click', handleCancel);
    document.addEventListener('keydown', handleKey);
  }

  async function _applyCloudBackupToggle(enabling) {
    const autoChk = document.getElementById('cloud-auto-backup');
    if (enabling) {
      if (!Sync.isSignedIn()) {
        showToast('Sign in to a cloud account before enabling cloud backup.', 'warning');
        return;
      }
      try {
        showToast('Setting up cloud backup…', 'info');
        const { migrate } = await import('./migration.js');
        await migrate();
      } catch (err) {
        console.warn('[CloudBackup] Migration failed:', err);
        showToast('Cloud backup setup failed — ' + (err.message || 'unknown error'), 'error');
        return;
      }
      state.prefs.cloudAutoBackup = true;
      if (autoChk) autoChk.checked = true;
      try { await Storage.setPref('cloudAutoBackup', true); } catch {}

      // Push the ACTIVE profile's structure (name/colour/appearance/default) and
      // flush any deletions queued while backup was off, so the cloud matches local.
      try {
        const aid = state.syncSession?.user?.id;
        const lid = UserManager.getActive()?.id;
        if (aid && lid) {
          const AS = await import('./account-session.js');
          await AS.reconcileProfileStructure(lid, aid);
          await AS.flushPendingProfileDeletes(aid);
        }
      } catch (err) { console.warn('[CloudBackup] reconcile on enable failed:', err); }

      // Activate the per-record sync engine now that a cloud profile UUID exists
      import('./sync-engine.js').then(mod => { mod.startEngine?.(); }).catch(() => {});
      showToast('Cloud backup enabled.', 'success');
    } else {
      state.prefs.cloudAutoBackup = false;
      if (autoChk) autoChk.checked = false;
      try { await Storage.setPref('cloudAutoBackup', false); } catch {}

      // Push directly to profile_prefs BEFORE stopping the engine.
      // The outbox drain requires cloudAutoBackup===true to run, and stopEngine() cancels
      // the drain timer immediately after — so the outbox op would never be flushed.
      // Without this push, sign-out deletes the local DB and re-login force-pulls
      // cloudAutoBackup:true from cloud, making the checkbox re-appear as checked.
      if (Sync.isSignedIn() && state.syncSession) {
        try {
          const sb  = await Sync.getClient();
          const aid = state.syncSession.user.id;
          const lid = UserManager.getActive()?.id || 'default';
          const pid = getCloudProfileId(lid, aid);
          if (pid) {
            await sb.from('profile_prefs').upsert(
              { profile_id: pid, account_id: aid, key: 'cloudAutoBackup', value: false, updated_at: new Date().toISOString() },
              { onConflict: 'profile_id,key' }
            );
          }
        } catch { /* non-critical */ }
      }

      import('./sync-engine.js').then(mod => { mod.stopEngine?.(); }).catch(() => {});
      showToast('Cloud backup disabled.', 'info');
    }
    renderCloudSyncCard();
  }

  /* ---- FSA-unavailable JSON download fallback -------------------- */

  async function downloadBackupJson() {
    const activeUser = UserManager.getActive();
    const filename   = getBackupFilename(activeUser, currentAccountEmail());
    const backup     = await Storage.exportAll();
    // Stamp the owning account (req 4) so it can only be restored under that account.
    backup.accountId    = currentAccountId();
    backup.accountEmail = currentAccountEmail();
    backup.profileName  = activeUser?.name || null;
    const { lastBackupDate: _drop, compact: _compact, ...exportedPrefs } = backup.data.preferences;
    backup.data.preferences = {
      ...exportedPrefs,
      username:           state.prefs.username,
      dailyGoalMin:       state.prefs.dailyGoalMin,
      monthlyGoalHr:      state.prefs.monthlyGoalHr,
      goalHistory:        state.prefs.goalHistory || [],
      monthlyGoalHistory: state.prefs.monthlyGoalHistory || [],
    };
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    await Storage.setPref('lastBackupDate', Date.now());
    await Storage.addBackupLog({ type: 'export', label: `Downloaded → ${filename}` });
    state.lastAutoBackup = Date.now();
    showToast('Backup downloaded.', 'success');
    renderBackup();
  }

  /* Persist the chosen accent for the current theme so switching themes and back
     restores the user's pick rather than the theme's factory default. */
  async function _saveThemeAccentOverride(accent) {
    const theme    = state.prefs.theme || 'dark';
    const overrides = { ...(state.prefs.themeAccentOverrides || {}) };
    overrides[theme] = accent;
    state.prefs.themeAccentOverrides = overrides;
    await Storage.setPref('themeAccentOverrides', overrides);
  }

  /* Patch the cloud profiles row and profile_prefs when theme/accent changes.
     Fires and forgets — non-critical. Local-first: only pushes in real time when
     Auto Cloud Backup is ON for this profile. When OFF, the local Storage.setPref
     calls still enqueue `pref` outbox ops, so the change is captured by the
     enable / sign-out backup drain instead. */
  async function _patchCloudAppearance() {
    if (!state.prefs.cloudAutoBackup) return;
    if (!Sync.isSignedIn()) return;
    const session = state.syncSession;
    if (!session) return;
    const accountId      = session.user.id;
    const localUser      = UserManager.getActive();
    const localProfileId = localUser?.id || 'default';
    const cloudProfileId = getCloudProfileId(localProfileId, accountId);
    if (!cloudProfileId) return;
    try {
      const sb             = await Sync.getClient();
      const theme          = state.prefs.theme          || 'dark';
      const accent         = state.prefs.accent         || 'purple';
      const customAccentHex = state.prefs.customAccentHex || null;
      const now            = new Date().toISOString();

      // Update display columns on the profiles row
      await sb.from('profiles').update({
        theme,
        accent,
        custom_accent_hex: customAccentHex,
      }).eq('id', cloudProfileId).eq('account_id', accountId);

      // Push directly to profile_prefs so appearance prefs survive forced re-login pulls.
      // This is a direct push (bypasses the outbox) so it works regardless of whether
      // Auto Cloud Backup is enabled — appearance settings should always follow the user.
      await sb.from('profile_prefs').upsert([
        { profile_id: cloudProfileId, account_id: accountId, key: 'theme',            value: theme,            updated_at: now },
        { profile_id: cloudProfileId, account_id: accountId, key: 'accent',           value: accent,           updated_at: now },
        { profile_id: cloudProfileId, account_id: accountId, key: 'customAccentHex',  value: customAccentHex,  updated_at: now },
      ], { onConflict: 'profile_id,key' });
    } catch { /* non-critical */ }
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

    document.getElementById('import-override-cancel')?.addEventListener('click', hideOverrideBanner);
    document.getElementById('import-override-confirm')?.addEventListener('click', () => {
      const fn = _pendingOverride;
      hideOverrideBanner();
      if (fn) fn().catch(err => showImportStatus('Import failed: ' + err.message, 'error'));
    });

    // Cloud Sync card actions
    document.getElementById('cloud-sync-now-btn')?.addEventListener('click', cloudSyncNow);
    document.getElementById('cloud-restore-btn')?.addEventListener('click', cloudRestore);
    // Sidebar sign-out button
    document.getElementById('sidebar-signout-btn-inline')?.addEventListener('click', cloudSignOut);
    const autoChk = document.getElementById('cloud-auto-backup');
    if (autoChk) {
      autoChk.addEventListener('change', (e) => {
        if (isTestSession()) { autoChk.checked = false; return; } // cloud disabled for test accounts
        const enabling = !!e.target.checked;
        // Revert the checkbox immediately — the modal re-applies it on confirm
        autoChk.checked = !enabling;
        showCloudBackupToggleModal(enabling, () => _applyCloudBackupToggle(enabling));
      });
    }
    // Keep the card in step with background sync state changes (auto-push results, token refresh, etc.)
    document.addEventListener('lt-sync-changed', renderCloudSyncCard);
  }

  export async function backupCurrentProfile(silent = false) {
    if (!silent && state.entries.length === 0) {
      showToast('No data to save. Add some learning entries first.', 'warning');
      return;
    }

    // Firefox / Safari — no FSA API: fall back to a JSON file download
    if (!window.showDirectoryPicker) {
      if (!silent) { await downloadBackupJson(); }
      else throw new Error('Auto-folder backup requires Chrome or Edge. Use cloud backup for automatic sync.');
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
    const filename   = getBackupFilename(activeUser, currentAccountEmail());

    try {
      const backup = await Storage.exportAll();
      // Stamp the owning account so the file can only be restored under that account.
      backup.accountId    = currentAccountId();
      backup.accountEmail = currentAccountEmail();
      backup.profileName  = activeUser?.name || null;
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
    const filename   = getBackupFilename(activeUser, currentAccountEmail());

    // Firefox / Safari — folder access unavailable
    if (!window.showDirectoryPicker) {
      showImportStatus('Folder restore is unavailable in this browser. Use "Browse File" to import a backup.', 'info');
      return;
    }

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

  // Executes the actual browse-import after validation passes (or override is confirmed).
  async function _doBrowseImport(backup, file) {
    const existingEntries = await Storage.getAllEntries();
    const users = UserManager.getUsers();
    const isFirstTime = existingEntries.length === 0
      && users.length <= 1
      && (users[0]?.name || '').toLowerCase() === 'me';

    if (isFirstTime) {
      const result = await Storage.importAll(backup);
      state.entries   = await Storage.getAllEntries();
      state.earnedAch = await Storage.getAllAchievements();
      state.goals     = await Storage.getAllGoals();
      state.prefs     = { ...DEFAULT_PREFS, ...(await Storage.getAllPrefs()) };
      await checkAchievements();

      // Restore profile name (preferred) then fall back to username pref.
      const restoredName = backup.profileName || state.prefs.username;
      if (restoredName) {
        const activeUser = UserManager.getActive();
        if (activeUser) UserManager.updateUser(activeUser.id, restoredName);
      }

      applyTheme(state.prefs.theme);
      applyAccent(state.prefs.accent);
      applyCompact(state.prefs.compact);
      const skipNote = result.skipped > 0 ? ` (${result.skipped} invalid skipped)` : '';
      showImportStatus(`✅ Imported ${result.imported} entries into your profile.${skipNote}`, 'success');
      await Storage.addBackupLog({ type: 'import', label: `Browsed & imported: ${file.name}` });
    } else {
      const importedName = backup.profileName || backup.data.preferences?.username || file.name.replace(/\.json$/i, '');
      const duplicate = UserManager.getUsers().find(u => u.name.toLowerCase() === importedName.toLowerCase());
      if (duplicate) {
        showImportStatus(`A profile named "${duplicate.name}" already exists. Rename or delete it first.`, 'error');
        return;
      }
      const newUser = UserManager.createUser(importedName);
      await switchUser(newUser.id, importedName);

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

    const allowed = backupAccountAllowed(backup);
    if (!allowed.ok) {
      const who = backup.accountEmail ? ` (${backup.accountEmail})` : '';
      showOverrideBanner(
        `This backup belongs to a different account${who}. If you recently changed your email address, click 'Import anyway' to recover your data.`,
        () => _doBrowseImport(backup, file)
      );
      return;
    }

    await _doBrowseImport(backup, file);
  }

  // Executes the actual folder-load import after validation passes (or override is confirmed).
  async function _doFolderImport(backup, file) {
    const result = await Storage.importAll(backup);

    state.entries   = await Storage.getAllEntries();
    state.earnedAch = await Storage.getAllAchievements();
    state.goals     = await Storage.getAllGoals();
    state.prefs     = { ...DEFAULT_PREFS, ...(await Storage.getAllPrefs()) };
    await checkAchievements();

    // Restore the profile name stored in the backup.
    if (backup.profileName) {
      const activeUser = UserManager.getActive();
      if (activeUser) UserManager.updateUser(activeUser.id, backup.profileName);
    }

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
  }

  export function importFile(file) {
    if (!file.name.endsWith('.json')) {
      showImportStatus('Invalid backup file format. Only JSON files are supported.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const raw = e.target.result;
        if (!raw || raw.trim() === '') { showImportStatus('Empty backup file.', 'error'); return; }

        const backup = JSON.parse(raw);

        if (!backup.version || !backup.appName || !backup.data) {
          showImportStatus('Invalid backup file format.', 'error');
          return;
        }
        if (backup.appName !== 'LearnTrack') {
          showImportStatus('Unsupported backup file (different app).', 'error');
          return;
        }

        const allowed = backupAccountAllowed(backup);
        if (!allowed.ok) {
          const who = backup.accountEmail ? ` (${backup.accountEmail})` : '';
          showOverrideBanner(
            `This backup belongs to a different account${who}. If you recently changed your email address, click 'Import anyway' to recover your data.`,
            () => _doFolderImport(backup, file)
          );
          return;
        }

        await _doFolderImport(backup, file);
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
    hideOverrideBanner();
    el.style.display = 'block';
    el.className     = `import-status ${type}`;
    el.textContent   = message;
    if (type === 'success') {
      setTimeout(() => { el.style.display = 'none'; }, 6000);
    }
  }

  // Pending "import anyway" callback — set when an account mismatch is shown.
  let _pendingOverride = null;

  function showOverrideBanner(message, executeFn) {
    _pendingOverride = executeFn;
    const banner = document.getElementById('import-override-banner');
    const msg    = document.getElementById('import-override-msg');
    const status = document.getElementById('import-status');
    if (status) status.style.display = 'none';
    if (msg)    msg.textContent = message;
    if (banner) banner.style.display = 'block';
  }

  function hideOverrideBanner() {
    _pendingOverride = null;
    const banner = document.getElementById('import-override-banner');
    if (banner) banner.style.display = 'none';
  }
