/* ===== users.js — extracted from app.js ===== */
import { state, DEFAULT_PREFS } from './state.js';
import { init, triggerAutoBackup, updateSidebarBackupStatus } from './core.js';
import { navigateTo, updateSidebarUser } from './nav.js';
import { getBackupFilename } from './settings.js';
import { _closeModal, _openModal, escapeHtml, showConfirm, showToast } from './utils.js';
import { applyAccent, applyCompact, applyTheme } from './widgets.js';

export const UserManager = (() => {
  const USERS_KEY  = 'lt_users';
  const ACTIVE_KEY = 'lt_active_user';
  const COLORS = ['#6c63ff','#3b82f6','#10b981','#f59e0b','#ec4899','#ef4444'];

  function getUsers() {
    try {
      const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
      return users.map(u => ({ ...u, color: COLORS.includes(u.color) ? u.color : COLORS[0] }));
    } catch { return []; }
  }
  function saveUsers(users) { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }
  function getActiveId()    { return localStorage.getItem(ACTIVE_KEY); }
  function setActiveId(id)  { localStorage.setItem(ACTIVE_KEY, id); }
  function getActive() {
    const id = getActiveId();
    return id ? (getUsers().find(u => u.id === id) || null) : null;
  }
  function createUser(name) {
    const users = getUsers();
    // First user ever gets id 'default' → maps to the original LearnTrackDB (backwards compat)
    const id    = users.length === 0 ? 'default' : `u${Date.now()}`;
    const color = COLORS[users.length % COLORS.length];
    const user  = { id, name: name.trim() || 'Learner', color, createdAt: Date.now() };
    users.push(user);
    saveUsers(users);
    return user;
  }
  function updateUser(id, name) {
    const users = getUsers().map(u => u.id === id ? { ...u, name: name.trim() || u.name } : u);
    saveUsers(users);
  }
  function deleteUser(id) {
    saveUsers(getUsers().filter(u => u.id !== id));
    // Delete IndexedDB for this user
    const dbName = id === 'default' ? 'LearnTrackDB' : `LearnTrackDB_${id}`;
    try { indexedDB.deleteDatabase(dbName); } catch {}
    // Clean up localStorage fallback keys
    const prefix = id === 'default' ? 'lt_' : `lt_${id}_`;
    // Only remove user-specific keys, not the global lt_users / lt_active_user
    Object.keys(localStorage)
      .filter(k => k.startsWith(prefix) && k !== USERS_KEY && k !== ACTIVE_KEY)
      .forEach(k => localStorage.removeItem(k));
  }
  return { getUsers, saveUsers, getActiveId, setActiveId, getActive, createUser, updateUser, deleteUser };
})();

  /* ---- User Picker --------------------------------- */

  export function setupUserPicker() {
    document.getElementById('create-user-submit-btn')?.addEventListener('click', () => {
      const name = document.getElementById('new-user-name-input')?.value.trim();
      if (!name) { showToast('Please enter a name', 'warning'); return; }
      const existing = UserManager.getUsers().find(u => u.name.toLowerCase() === name.toLowerCase());
      if (existing) { showToast(`A profile named "${existing.name}" already exists.`, 'warning'); return; }
      const user = UserManager.createUser(name);
      switchUser(user.id, name);
    });
    document.getElementById('new-user-name-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('create-user-submit-btn')?.click();
    });
    document.getElementById('user-picker-cancel-btn')?.addEventListener('click', closeUserPicker);
    document.getElementById('user-picker-modal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('user-picker-modal')) closeUserPicker();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.getElementById('user-picker-modal')?.style.display === 'flex') closeUserPicker();
    });
  }

  export function openUserPicker(canCancel = true) {
    const modal = document.getElementById('user-picker-modal');
    if (!modal) return;

    const listSection = document.getElementById('user-list-section');
    if (listSection) {
      const users    = UserManager.getUsers();
      const activeId = UserManager.getActiveId();
      listSection.innerHTML = users.map(u => `
        <div class="user-pick-item${u.id === activeId ? ' current' : ''}" data-uid="${u.id}" role="button" tabindex="0">
          <div class="user-pick-avatar" style="background:${u.color}">${u.name.charAt(0).toUpperCase()}</div>
          <span class="user-pick-name">${escapeHtml(u.name)}</span>
          ${u.id === activeId ? '<span class="user-pick-active-badge">Current</span>' : ''}
        </div>
      `).join('');
      listSection.querySelectorAll('.user-pick-item').forEach(el => {
        el.addEventListener('click', () => {
          const uid = el.dataset.uid;
          if (uid !== UserManager.getActiveId()) { switchUser(uid); } else { closeUserPicker(); }
        });
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') el.click(); });
      });
    }

    const nameInput = document.getElementById('new-user-name-input');
    if (nameInput) nameInput.value = '';

    const footer = document.getElementById('user-picker-footer');
    if (footer) footer.style.display = canCancel ? 'flex' : 'none';

    modal.style.display = 'flex';
    _openModal(modal);
    setTimeout(() => nameInput?.focus(), 100);
  }

  export function closeUserPicker() {
    const modal = document.getElementById('user-picker-modal');
    if (!modal) return;
    _closeModal(modal);
    modal.style.display = 'none';
  }

  export async function switchUser(userId, defaultUsername = null) {
    closeUserPicker();
    UserManager.setActiveId(userId);
    state.badgeQueue.length = 0;
    state.badgeShowing      = false;
    try {
      await Storage.init(userId);
      state.entries   = await Storage.getAllEntries();
      state.prefs     = { ...DEFAULT_PREFS, ...(await Storage.getAllPrefs()) };
      state.earnedAch = await Storage.getAllAchievements();
      state.goals     = await Storage.getAllGoals();
    } catch (err) {
      console.error('[App] Switch user error:', err);
    }
    // For a brand-new profile, use its name as the default display name
    if (defaultUsername && state.prefs.username === DEFAULT_PREFS.username) {
      state.prefs.username = defaultUsername;
      await Storage.setPref('username', defaultUsername);
    }
    applyTheme(state.prefs.theme);
    applyAccent(state.prefs.accent);
    applyCompact(state.prefs.compact);
    updateSidebarUser();
    // Restore this profile's last backup timestamp
    state.lastAutoBackup = parseInt(localStorage.getItem(`lt_last_auto_backup_${userId}`) || '0', 10);
    const sbEl = document.getElementById('sidebar-backup-status');
    if (sbEl) sbEl.style.display = state.lastAutoBackup ? 'flex' : 'none';
    updateSidebarBackupStatus(false);
    navigateTo('dashboard');
    showToast(`Switched to "${UserManager.getActive()?.name || 'profile'}"`, 'success');
  }

  export function _getProfileStats(userId) {
    if (userId === UserManager.getActiveId()) {
      const streak  = Analytics.calculateStreaks(state.entries);
      const totalXP = Rewards.calculateTotalXP(state.entries, streak, state.prefs.dailyGoalMin, state.prefs.goalHistory, state.earnedAch);
      const lv      = Rewards.getLevelInfo(totalXP);
      return { level: lv.level, title: lv.title, xpIntoLevel: lv.xpIntoLevel, xpNeededForNext: lv.xpNeededForNext, progressPct: lv.progressPct, streak: streak.current };
    }
    try {
      const cached = JSON.parse(localStorage.getItem(`lt_ustats_${userId}`) || 'null');
      if (cached) return cached;
    } catch {}
    return { level: 1, title: 'Beginner', xpIntoLevel: 0, xpNeededForNext: 100, progressPct: 0, streak: 0 };
  }

  export function renderUsersManagement() {
    const list = document.getElementById('users-management-list');
    if (!list) return;
    const users    = UserManager.getUsers();
    const activeId = UserManager.getActiveId();
    const renameIconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    const deleteIconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

    list.innerHTML = users.map(u => {
      const isActive = u.id === activeId;
      const s = _getProfileStats(u.id);
      const xpNext = s.xpNeededForNext || 0;
      const xpDisplay = xpNext > 0 ? `${s.xpIntoLevel.toLocaleString()} / ${xpNext.toLocaleString()} XP` : `${s.xpIntoLevel.toLocaleString()} XP`;
      const canDelete = users.length > 1 && !isActive;
      return `
        <div class="profile-card${isActive ? ' active-profile' : ''}" data-uid="${u.id}">
          <div class="profile-card-avatar${!isActive ? ' profile-card-switchable' : ''}" style="background:${u.color}" ${!isActive ? `data-uid="${u.id}"` : ''}>${u.name.charAt(0).toUpperCase()}</div>
          <div class="profile-card-name-wrap">
            <span class="profile-card-name${!isActive ? ' profile-card-switchable' : ''}" ${!isActive ? `data-uid="${u.id}"` : ''}>${escapeHtml(u.name)}</span>
            <input type="text" class="profile-card-rename-input hidden" value="${escapeHtml(u.name)}" maxlength="30" />
          </div>
          <div class="profile-card-role">${escapeHtml(s.title.toUpperCase())}</div>
          <div class="profile-card-xp-section">
            <div class="profile-card-xp-row">
              <span class="level-label">Level ${s.level}</span>
              <span class="xp-fraction">${xpDisplay}</span>
            </div>
            <div class="profile-card-xp-bar-track">
              <div class="profile-card-xp-bar-fill" style="width:${s.progressPct}%;background:${u.color}"></div>
            </div>
          </div>
          <div class="profile-card-badges">
            <span class="profile-badge"><i class="profile-badge-icon">🔥</i>${s.streak}d</span>
            <span class="profile-badge"><i class="profile-badge-icon">🏆</i>Lv ${s.level}</span>
          </div>
          <div class="profile-card-actions">
            ${isActive
              ? `<button class="btn btn-current-profile">Current Profile</button>`
              : `<button class="btn btn-secondary user-manage-switchable" data-uid="${u.id}">Switch</button>`
            }
          </div>
          <div class="profile-card-mgmt">
            <button class="user-action-btn" data-action="user-rename" data-uid="${u.id}" title="Rename">${renameIconSvg}</button>
            <button class="btn btn-primary btn-sm hidden" data-action="user-rename-save" data-uid="${u.id}">Save</button>
            ${canDelete ? `<button class="user-action-btn user-action-btn--danger" data-action="user-delete" data-uid="${u.id}" title="Delete">${deleteIconSvg}</button>` : ''}
          </div>
        </div>
      `;
    }).join('') || '<p class="settings-hint">No profiles found.</p>';

    list.querySelectorAll('.user-manage-switchable, .profile-card-switchable').forEach(el => {
      el.addEventListener('click', () => switchUser(el.dataset.uid));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') switchUser(el.dataset.uid); });
    });

    list.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid  = btn.dataset.uid;
        const card = btn.closest('.profile-card');
        if (btn.dataset.action === 'user-delete') { confirmDeleteUser(uid); return; }
        if (btn.dataset.action === 'user-rename') {
          card?.querySelector('.profile-card-name')?.classList.add('hidden');
          const input = card?.querySelector('.profile-card-rename-input');
          if (input) { input.classList.remove('hidden'); input.focus(); input.select(); }
          btn.classList.add('hidden');
          card?.querySelector('[data-action="user-rename-save"]')?.classList.remove('hidden');
        }
        if (btn.dataset.action === 'user-rename-save') {
          const input   = card?.querySelector('.profile-card-rename-input');
          const newName = input?.value.trim();
          if (!newName) { showToast('Name cannot be empty', 'warning'); return; }
          const duplicate = UserManager.getUsers().find(u => u.id !== uid && u.name.toLowerCase() === newName.toLowerCase());
          if (duplicate) { showToast(`A profile named "${duplicate.name}" already exists.`, 'warning'); return; }
          const oldUser     = UserManager.getUsers().find(u => u.id === uid);
          const oldFilename = getBackupFilename(oldUser);
          UserManager.updateUser(uid, newName);
          if (uid === UserManager.getActiveId()) {
            triggerAutoBackup();
          }
          // Remove old backup file so the folder doesn't accumulate stale files
          Storage.getDirectoryHandle().then(async dirHandle => {
            if (!dirHandle) return;
            const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
            if (perm === 'granted') dirHandle.removeEntry(oldFilename).catch(() => {});
          }).catch(() => {});
          showToast('Profile renamed', 'success');
          renderUsersManagement();
        }
      });
    });

    list.querySelectorAll('.profile-card-rename-input').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  input.closest('.profile-card')?.querySelector('[data-action="user-rename-save"]')?.click();
        if (e.key === 'Escape') renderUsersManagement();
      });
    });
  }

  export function confirmDeleteUser(userId) {
    const user = UserManager.getUsers().find(u => u.id === userId);
    if (!user) return;
    showConfirm(
      `Delete "${user.name}" profile?`,
      'All learning data for this profile will be permanently deleted. This cannot be undone.',
      () => {
        UserManager.deleteUser(userId);
        showToast(`Profile "${user.name}" deleted`, 'info');
        renderUsersManagement();
        updateSidebarUser();
      }
    );
  }
