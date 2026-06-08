/* ===== users.js — extracted from app.js ===== */
import { state, DEFAULT_PREFS } from './state.js';
import { init, triggerAutoBackup, updateSidebarBackupStatus } from './core.js';
import { navigateTo, updateSidebarUser } from './nav.js';
import { getBackupFilename } from './settings.js';
import { _closeModal, _openModal, escapeHtml, showConfirm, showToast } from './utils.js';
import { applyAccent, applyCompact, applyTheme } from './widgets.js';
import { setCloudProfileId, getCloudProfileId } from './cloud-repo.js';

// Must match the default profile_limit in the subscriptions table (free tier).
const FREE_PROFILE_LIMIT = 5;

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

  /* ---- Cloud profile row creation ------------------ */
  // Called after a local profile is created. Inserts a row into the Supabase
  // `profiles` table and stores the returned UUID locally (for sync-engine).
  // Uses a dynamic import of sync.js to avoid a circular-dependency at module
  // evaluation time (sync.js already imports UserManager from this file).
  export async function createCloudProfileRow(localUser) {
    if (!state.syncSession) return; // not signed in — skip; migration handles existing profiles
    const { getClient } = await import('./sync.js');
    const sb        = await getClient();
    const accountId = state.syncSession.user.id;
    const users     = UserManager.getUsers();
    const { data, error } = await sb
      .from('profiles')
      .insert({
        account_id: accountId,
        name:       localUser.name,
        color:      localUser.color,
        sort_order: users.findIndex(u => u.id === localUser.id),
      })
      .select('id')
      .single();
    if (error) {
      if (error.message?.includes('profile_limit_reached') || error.code === 'P0001') {
        throw new Error('profile_limit_reached');
      }
      throw error; // network / RLS / other — caller logs and continues
    }
    setCloudProfileId(localUser.id, accountId, data.id);
  }

  /* ---- User Picker --------------------------------- */

  export function setupUserPicker() {
    document.getElementById('create-user-submit-btn')?.addEventListener('click', async () => {
      const nameInput = document.getElementById('new-user-name-input');
      const submitBtn = document.getElementById('create-user-submit-btn');
      const name = nameInput?.value.trim();

      if (!name) { showToast('Please enter a name.', 'warning'); return; }

      const allUsers = UserManager.getUsers();
      if (allUsers.find(u => u.name.toLowerCase() === name.toLowerCase())) {
        showToast(`A profile named "${name}" already exists.`, 'warning');
        return;
      }

      // Client-side guard — server enforces the same limit via trigger.
      if (allUsers.length >= FREE_PROFILE_LIMIT && !localStorage.getItem('lt_skip_auth')) {
        showToast(`You've reached the ${FREE_PROFILE_LIMIT}-profile limit for your plan.`, 'error');
        return;
      }

      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating…'; }

      const user = UserManager.createUser(name); // optimistic local-first create

      try {
        await createCloudProfileRow(user);
      } catch (err) {
        if (err.message === 'profile_limit_reached') {
          // Server rejected — roll back the local profile we just created
          UserManager.deleteUser(user.id);
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create'; }
          showToast('Profile limit reached. Upgrade your plan for more profiles.', 'error');
          return;
        }
        // Any other error (network / offline) — profile stays local; migration or next sync will create the cloud row
        console.warn('[Users] Cloud profile row creation skipped:', err?.message || err);
      }

      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create'; }
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

    // Show/hide profile creation form based on the profile limit
    const atLimit   = !localStorage.getItem('lt_skip_auth') && UserManager.getUsers().length >= FREE_PROFILE_LIMIT;
    const limitMsg  = document.getElementById('user-picker-limit-msg');
    const createRow = modal.querySelector('.user-create-row');
    const divider   = modal.querySelector('.user-create-divider');
    if (limitMsg)  limitMsg.style.display  = atLimit ? 'block' : 'none';
    if (createRow) createRow.style.display  = atLimit ? 'none'  : 'flex';
    if (divider)   divider.style.display    = 'flex'; // always show the divider

    const footer = document.getElementById('user-picker-footer');
    if (footer) footer.style.display = canCancel ? 'flex' : 'none';

    modal.style.display = 'flex';
    _openModal(modal);
    setTimeout(() => { if (!atLimit) nameInput?.focus(); }, 100);
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
    // If there's an active Supabase session and this profile isn't yet bound,
    // bind it so the Cloud Sync UI shows the signed-in state immediately.
    try {
      if (state.syncSession) {
        const boundKey = `lt_sync_account_${userId}`;
        if (!localStorage.getItem(boundKey)) {
          localStorage.setItem(boundKey, state.syncSession.user.id);
          document.dispatchEvent(new CustomEvent('lt-sync-changed'));
        }
      }
    } catch (e) { /* non-fatal */ }
  }

  export function _getProfileStats(userId) {
    if (userId === UserManager .getActiveId()) {
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
    const accountId       = state.syncSession?.user?.id || null;
    const defaultCloudPid = getCachedDefaultCloudProfileId(accountId);
    const isSignedIn      = !!state.syncSession;
    const renameIconSvg   = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    const deleteIconSvg   = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    const starOutlinedSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    const starFilledSvg   = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

    const limitNote = users.length >= FREE_PROFILE_LIMIT
      ? `<p class="settings-hint profile-limit-note profile-limit-note--full">Profile limit reached (${users.length}/${FREE_PROFILE_LIMIT}) — remove a profile to add another.</p>`
      : `<p class="settings-hint profile-limit-note">${users.length} / ${FREE_PROFILE_LIMIT} profiles used.</p>`;

    list.innerHTML = users.map(u => {
      const isActive  = u.id === activeId;
      const cloudPid  = accountId ? getCloudProfileId(u.id, accountId) : null;
      const isDefault = !!cloudPid && cloudPid === defaultCloudPid;
      const s = _getProfileStats(u.id);
      const xpNext = s.xpNeededForNext || 0;
      const xpDisplay = xpNext > 0 ? `${s.xpIntoLevel.toLocaleString()} / ${xpNext.toLocaleString()} XP` : `${s.xpIntoLevel.toLocaleString()} XP`;
      const canDelete = users.length > 1 && !isActive;
      return `
        <div class="profile-card${isActive ? ' active-profile' : ''}" data-uid="${u.id}">
          <div class="profile-card-avatar${!isActive ? ' profile-card-switchable' : ''}" style="background:${u.color}" ${!isActive ? `data-uid="${u.id}"` : ''}>${u.name.charAt(0).toUpperCase()}</div>
          <div class="profile-card-name-wrap">
            <span class="profile-card-name${!isActive ? ' profile-card-switchable' : ''}" ${!isActive ? `data-uid="${u.id}"` : ''}>${escapeHtml(u.name)}</span>
            ${isDefault ? '<span class="profile-default-badge">Default</span>' : ''}
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
            ${isSignedIn ? `<button class="user-action-btn user-action-btn--star${isDefault ? ' is-default' : ''}" data-action="set-default" data-uid="${u.id}" title="${isDefault ? 'Default on all devices' : 'Set as default profile'}">${isDefault ? starFilledSvg : starOutlinedSvg}</button>` : ''}
            ${canDelete ? `<button class="user-action-btn user-action-btn--danger" data-action="user-delete" data-uid="${u.id}" title="Delete">${deleteIconSvg}</button>` : ''}
          </div>
        </div>
      `;
    }).join('') + limitNote || '<p class="settings-hint">No profiles found.</p>';

    list.querySelectorAll('.user-manage-switchable, .profile-card-switchable').forEach(el => {
      el.addEventListener('click', () => switchUser(el.dataset.uid));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') switchUser(el.dataset.uid); });
    });

    list.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid  = btn.dataset.uid;
        const card = btn.closest('.profile-card');
        if (btn.dataset.action === 'user-delete') { confirmDeleteUser(uid); return; }
        if (btn.dataset.action === 'set-default') { if (!btn.classList.contains('is-default')) setDefaultProfile(uid); return; }
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
          // Sync the renamed name to the cloud profiles table
          if (state.syncSession) {
            const accountId = state.syncSession.user.id;
            const cloudPid  = getCloudProfileId(uid, accountId);
            if (cloudPid) {
              import('./sync.js').then(async ({ getClient }) => {
                try {
                  const sb = await getClient();
                  await sb.from('profiles').update({ name: newName }).eq('id', cloudPid);
                } catch (err) {
                  console.warn('[Users] Cloud profile rename failed:', err);
                }
              }).catch(() => {});
            }
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
      async () => {
        const accountId  = state.syncSession?.user?.id || null;
        const cloudPid   = accountId ? getCloudProfileId(userId, accountId) : null;

        UserManager.deleteUser(userId);

        // Clean up cloud-specific localStorage keys not covered by UserManager.deleteUser
        // (those use a different key prefix pattern than the user-id prefix)
        if (accountId) {
          localStorage.removeItem(`lt_cloud_pid_${userId}_${accountId}`);
          localStorage.removeItem(`lt_sync_wm_${userId}_${accountId}`);
        }

        // Delete the profile row from Supabase so it doesn't persist in the cloud
        if (cloudPid && state.syncSession) {
          import('./sync.js').then(async ({ getClient }) => {
            try {
              const sb = await getClient();
              await sb.from('profiles').delete().eq('id', cloudPid);
            } catch (err) {
              console.warn('[Users] Cloud profile delete failed:', err);
            }
          }).catch(() => {});
        }

        showToast(`Profile "${user.name}" deleted`, 'info');
        renderUsersManagement();
        updateSidebarUser();
      }
    );
  }

/* ---- Default profile (cloud) ----------------------------------- */

export function getCachedDefaultCloudProfileId(accountId) {
  if (!accountId) return null;
  return localStorage.getItem(`lt_default_profile_${accountId}`) || null;
}

// Called on sign-in on a new device. Fetches all cloud profiles for this account,
// creates matching local profiles, removes the empty auto-created "Me" placeholder,
// and switches to the cloud-designated default (or the first profile if none is set).
export async function loadCloudProfiles(session) {
  if (!session) return;
  const accountId = session.user.id;

  // The fresh-sign-in path (core.init → hydrateAllProfilesFromCloud) already
  // pulled every profile + data and set lt_account_owner. Skip to avoid a
  // duplicate restore and an unwanted force-switch to default on session resume.
  if (localStorage.getItem('lt_account_owner') === accountId) return;

  // If any local profile is already bound to this account, the device is set up — skip.
  const localProfiles = UserManager.getUsers();
  const anyBound = localProfiles.some(u =>
    localStorage.getItem(`lt_sync_account_${u.id}`) === accountId
  );
  if (anyBound) return;

  // Fetch all profiles for this account from Supabase.
  let cloudProfiles;
  try {
    const { getClient } = await import('./sync.js');
    const sb = await getClient();
    const { data, error } = await sb
      .from('profiles')
      .select('id, name, color, sort_order, is_default')
      .eq('account_id', accountId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    cloudProfiles = data;
  } catch (err) {
    console.warn('[Users] loadCloudProfiles fetch failed:', err?.message || err);
    return;
  }

  if (!cloudProfiles?.length) return; // First-time user — no cloud profiles to restore.

  // Delete the auto-created "Me" profile only if it is the sole local profile and has no data.
  const activeId     = UserManager.getActiveId();
  const currentUsers = UserManager.getUsers();
  if (currentUsers.length === 1 && currentUsers[0].name === 'Me' &&
      state.entries.length === 0 && state.goals.length === 0) {
    UserManager.deleteUser(activeId);
  }

  // Create a local profile for each cloud profile and map the cloud UUID.
  let defaultLocalId = null;
  for (const cp of cloudProfiles) {
    const localUser = UserManager.createUser(cp.name);
    if (cp.color) {
      const users = UserManager.getUsers();
      const idx   = users.findIndex(u => u.id === localUser.id);
      if (idx >= 0) { users[idx].color = cp.color; UserManager.saveUsers(users); }
    }
    setCloudProfileId(localUser.id, accountId, cp.id);
    localStorage.setItem(`lt_sync_account_${localUser.id}`, accountId);
    if (cp.is_default) {
      defaultLocalId = localUser.id;
      localStorage.setItem(`lt_default_profile_${accountId}`, cp.id);
    }
  }

  // If no explicit default exists, cache the first profile as the implicit default.
  if (!defaultLocalId) {
    const first = UserManager.getUsers()[0];
    if (first) {
      const cid = getCloudProfileId(first.id, accountId);
      if (cid) localStorage.setItem(`lt_default_profile_${accountId}`, cid);
      defaultLocalId = first.id;
    }
  }

  // Mark this device as owned by the account so later boots skip re-restoring
  // (mirrors hydrateAllProfilesFromCloud) and the isolation guard has a baseline.
  localStorage.setItem('lt_account_owner', accountId);

  if (defaultLocalId) await switchUser(defaultLocalId);
}

// Mark a local profile as the default on all devices by persisting `is_default`
// to the Supabase `profiles` table and updating the local cache.
export async function setDefaultProfile(localUserId) {
  if (!state.syncSession) { showToast('Sign in to set a default profile', 'warning'); return; }
  const accountId = state.syncSession.user.id;
  let cloudPid = getCloudProfileId(localUserId, accountId);

  // Profile predates cloud sync — create its cloud row on demand before proceeding.
  if (!cloudPid) {
    const localUser = UserManager.getUsers().find(u => u.id === localUserId);
    if (!localUser) return;
    try {
      await createCloudProfileRow(localUser);
      cloudPid = getCloudProfileId(localUserId, accountId);
    } catch (err) {
      console.warn('[Users] setDefaultProfile — cloud row creation failed:', err);
      showToast('Failed to sync profile to cloud', 'error');
      return;
    }
  }
  if (!cloudPid) { showToast('Profile not yet synced to cloud', 'warning'); return; }
  try {
    const { getClient } = await import('./sync.js');
    const sb = await getClient();
    await sb.from('profiles').update({ is_default: false }).eq('account_id', accountId);
    const { error } = await sb.from('profiles').update({ is_default: true }).eq('id', cloudPid);
    if (error) throw error;
    localStorage.setItem(`lt_default_profile_${accountId}`, cloudPid);
    const name = UserManager.getUsers().find(u => u.id === localUserId)?.name || 'Profile';
    showToast(`"${name}" is now your default profile on all devices`, 'success');
    renderUsersManagement();
  } catch (err) {
    console.warn('[Users] setDefaultProfile failed:', err);
    showToast('Failed to update default profile', 'error');
  }
}
