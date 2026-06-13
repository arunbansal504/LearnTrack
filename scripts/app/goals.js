/* ===== goals.js — extracted from app.js ===== */
import { state, DEFAULT_PREFS, debounce } from './state.js';
import { checkAchievements } from './achievements.js';
import { triggerAutoBackup } from './core.js';
import { renderGoalsDashboardWidget } from './dashboard.js';

import { openEntryModal } from './log.js';
import { clearLogFilters, navigateTo, renderPage, updateDgFilterToggleState, updateSidebarUser } from './nav.js';
import { populateCategorySelects, saveNewCategory } from './settings.js';
import { _closeModal, _openModal, capitalise, escapeHtml, formatRelativeDate, linkifyNotes, setEl, setInputVal, showConfirm, showToast } from './utils.js';

  export const _chevronRight = `<svg class="linked-item-nav-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;

  export function _openLinkedItemsModal(titleText, bodyHtml, onBodyClick, wideModal = false) {
    document.getElementById('linked-items-title').textContent = titleText;
    const body = document.getElementById('linked-items-body');
    body.innerHTML = bodyHtml;
    const modal = document.getElementById('linked-items-modal');
    const inner = modal.querySelector('.linked-items-modal-inner');
    if (wideModal) inner.classList.remove('modal-sm');
    else           inner.classList.add('modal-sm');
    const closeBtn  = document.getElementById('linked-items-close');
    const closeBtnF = document.getElementById('linked-items-close-btn');
    const close = () => {
      document.removeEventListener('keydown', onKey);
      _closeModal(modal);
      modal.style.display = 'none';
    };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    closeBtn.onclick  = close;
    closeBtnF.onclick = close;
    modal.onclick = e => { if (e.target === modal) close(); };
    body.onclick = onBodyClick ? e => onBodyClick(e, close) : null;
    modal.style.display = 'flex';
    _openModal(modal);
    document.addEventListener('keydown', onKey);
    setTimeout(() => closeBtnF.focus(), 0);
  }

  export function showLinkedGoalsPopover(_anchor, entry) {
    const goals = (entry.goalIds || []).map(id => state.goals.find(g => g.id === id)).filter(Boolean);
    if (!goals.length) return;
    const typeLabel = { time: '⏳ Study Hours', count: '🏆 Problem Count', checklist: '📋 Task List', exam: '🎓 Exam Prep' };
    const items = goals.map(g => `
      <label class="link-goal-item is-linked" style="cursor:default">
        <input type="checkbox" checked disabled style="display:none" />
        <span class="link-goal-item-main">
          <span class="link-goal-item-title">${escapeHtml(g.title)}</span>
          <span class="link-goal-item-meta">
            <span class="goal-type-chip" data-type="${g.type}">${typeLabel[g.type] || g.type}</span>
            ${g.category ? `<span class="goal-cat-chip">${escapeHtml(g.category)}</span>` : ''}
            ${g.priority ? `<span class="goal-priority-chip goal-priority-${g.priority}">${capitalise(g.priority)}</span>` : ''}
          </span>
        </span>
        <button type="button" class="lg-view-goal-btn linked-item-navigate" data-goal-id="${g.id}">View</button>
      </label>`).join('');
    const bodyHtml = `<div style="padding:var(--s-4) var(--s-6)">
      <p class="link-goal-hint">Goals this deleted entry was linked to.</p>
      <div class="link-goal-list">${items}</div>
    </div>`;
    _openLinkedItemsModal(`Linked Goals (${goals.length})`, bodyHtml, (e, close) => {
      const btn = e.target.closest('.linked-item-navigate');
      if (btn) {
        state.dlReturnEntry  = entry;
        state.dlReturnGoalId = btn.dataset.goalId;
        close();
        state.goalScrollTarget = btn.dataset.goalId;
        navigateTo('goals');
      }
    }, true);
  }

  export function showLinkedEntriesPopover(_anchor, goal) {
    const entries = state.entries.filter(e => Array.isArray(e.goalIds) && e.goalIds.includes(goal.id));
    if (!entries.length) return;
    const diffLabel = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
    const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const totalMin = entries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
    const rows = entries.map(e => `
      <li class="linked-item-row linked-entry-row" data-difficulty="${e.difficulty || ''}">
        <div class="linked-item-bar"></div>
        <div class="linked-item-content">
          <div class="linked-item-main">
            <span class="linked-item-title">${escapeHtml(e.topic)}</span>
            <span class="linked-entry-dur">${Analytics.formatDuration(e.durationMinutes || 0)}</span>
          </div>
          <div class="linked-item-meta">
            <span class="goal-cat-chip">${fmtDate(e.date)}</span>
            ${e.category ? `<span class="goal-cat-chip">${escapeHtml(e.category)}</span>` : ''}
            ${e.difficulty ? `<span class="linked-entry-diff-chip diff-${e.difficulty}">${diffLabel[e.difficulty]}</span>` : ''}
          </div>
        </div>
      </li>`).join('');
    const bodyHtml = `
      <ul class="linked-items-list">${rows}</ul>
      <div class="linked-entries-total">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Total time logged: <strong>${Analytics.formatDuration(totalMin)}</strong>
      </div>`;
    _openLinkedItemsModal(`Logged Entries (${entries.length})`, bodyHtml);
  }

  /* ---- Duplicate Goal Warning ---------------------- */

  export let _dupGoalKeyHandler = null;

  export function _attachDupGoalKeyboard() {
    if (_dupGoalKeyHandler) document.removeEventListener('keydown', _dupGoalKeyHandler);
    _dupGoalKeyHandler = e => {
      if (e.key === 'Escape') { e.preventDefault(); closeDupGoalModal(); }
      if (e.key === 'Enter') {
        const focused = document.activeElement;
        if (focused && focused.closest('#dup-goal-modal')) { e.preventDefault(); focused.click(); }
      }
    };
    document.addEventListener('keydown', _dupGoalKeyHandler);
  }

  export function showDupGoalWarning(count, title, onCreateAnyway) {
    const noun = count === 1 ? 'goal' : 'goals';
    const verb = count === 1 ? 'exists'  : 'exist';

    const namePill = document.getElementById('dup-goal-name-display');
    namePill.textContent = `"${title}"`;
    namePill.style.display = 'inline-block';

    document.getElementById('dup-goal-message').innerHTML =
      `<strong>${count}</strong> ${noun} with <strong>Open</strong> status and same name already ${verb}. ` +
      `Do you still want to create another goal with the same name?`;

    const createBtn = document.getElementById('dup-goal-create');
    const cancelBtn = document.getElementById('dup-goal-cancel');

    createBtn.textContent = 'Yes, create anyway';
    createBtn.className   = 'btn btn-primary';
    cancelBtn.textContent = 'No, go back';

    createBtn.onclick = () => { closeDupGoalModal(); onCreateAnyway(); };
    cancelBtn.onclick = closeDupGoalModal;
    document.getElementById('dup-goal-modal').onclick = e => { if (e.target.id === 'dup-goal-modal') closeDupGoalModal(); };

    _attachDupGoalKeyboard();
    const dupModal = document.getElementById('dup-goal-modal');
    dupModal.style.display = 'flex';
    _openModal(dupModal);
    setTimeout(() => createBtn.focus(), 0);
  }

  export function closeDupGoalModal() {
    if (_dupGoalKeyHandler) {
      document.removeEventListener('keydown', _dupGoalKeyHandler);
      _dupGoalKeyHandler = null;
    }
    const modal = document.getElementById('dup-goal-modal');
    _closeModal(modal);
    modal.style.display = 'none';
  }

  export function setupGoalModal() {
    document.getElementById('new-goal-btn')?.addEventListener('click', () => openGoalModal());
    document.getElementById('goal-modal-close')?.addEventListener('click', closeGoalModal);
    document.getElementById('goal-modal-cancel')?.addEventListener('click', closeGoalModal);
    document.getElementById('goal-modal-save')?.addEventListener('click', () => saveGoalFromModal());

    // Custom spinner buttons for goal number inputs
    ['goal-target-hours', 'goal-target-count'].forEach(fieldId => {
      document.querySelectorAll(`.dur-spin-btn[data-field="${fieldId}"]`).forEach(btn => {
        btn.addEventListener('click', () => {
          const input = document.getElementById(fieldId);
          if (!input) return;
          if (btn.dataset.dir === 'up') input.stepUp();
          else input.stepDown();
          input.dispatchEvent(new Event('input'));
        });
      });
    });
    // Intentionally no outside-click-to-close for the goal modal —
    // users may click the overlay accidentally while filling in a form.

    // Esc closes modal, Enter saves (unless inside textarea or milestone input)
    document.addEventListener('keydown', e => {
      const modal = document.getElementById('goal-modal');
      if (!modal || modal.style.display === 'none') return;
      // Don't handle keys when a child modal is open on top
      if (document.getElementById('dup-goal-modal')?.style.display === 'flex') return;
      if (e.key === 'Escape') { e.preventDefault(); closeGoalModal(); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON' && !e.target.classList.contains('ms-label')) {
        e.preventDefault();
        saveGoalFromModal();
      }
    });

    // Show/hide type-specific fields when type changes
    document.getElementById('goal-type')?.addEventListener('change', () => {
      _updateGoalTypeFields();
    });

    // Add milestone button
    document.getElementById('add-milestone-btn')?.addEventListener('click', () => {
      _addMilestoneRow('');
    });

    // Inline "add new category" from the goal modal
    document.getElementById('goal-category')?.addEventListener('change', function() {
      const row   = document.getElementById('goal-new-category-row');
      const input = document.getElementById('goal-new-category-input');
      if (this.value === '__new__') {
        this.value = '';
        if (row) row.style.display = 'flex';
        if (input) input.focus();
      } else {
        if (row) row.style.display = 'none';
      }
    });

    const _confirmGoalNewCat = async () => {
      const input = document.getElementById('goal-new-category-input');
      const val   = input?.value.trim();
      if (!val) { input?.focus(); return; }
      const added = await saveNewCategory(val);
      if (added) {
        const catSel = document.getElementById('goal-category');
        catSel.innerHTML = '<option value="">Any category</option>' +
          (state.prefs.categories || []).map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('') +
          '<option value="__new__" class="category-add-opt">＋ Add new category…</option>';
        catSel.value = val;
        document.getElementById('goal-new-category-row').style.display = 'none';
        if (input) input.value = '';
      }
    };
    document.getElementById('goal-new-category-add')?.addEventListener('click', _confirmGoalNewCat);
    document.getElementById('goal-new-category-cancel')?.addEventListener('click', () => {
      document.getElementById('goal-new-category-row').style.display = 'none';
      document.getElementById('goal-new-category-input').value = '';
    });
    document.getElementById('goal-new-category-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); _confirmGoalNewCat(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); document.getElementById('goal-new-category-cancel').click(); }
    });
  }

  export function _updateGoalTypeFields() {
    const type = document.getElementById('goal-type')?.value;
    ['time','count','checklist','exam'].forEach(t => {
      const el = document.getElementById(`goal-fields-${t}`);
      if (el) el.style.display = t === type ? '' : 'none';
    });
    const placeholders = {
      time:      'e.g. Study Maths',
      count:     'e.g. Solve 50 problems',
      checklist: 'e.g. Complete Science chapters',
      exam:      'e.g. Board Exam',
    };
    const titleInput = document.getElementById('goal-title');
    if (titleInput) titleInput.placeholder = placeholders[type] || 'Enter goal title';
  }

  export function openGoalModal(goalId) {
    const modal = document.getElementById('goal-modal');
    if (!modal) return;

    // Populate category dropdown
    const catSel = document.getElementById('goal-category');
    if (catSel) {
      catSel.innerHTML = '<option value="">Any category</option>' +
        (state.prefs.categories || []).map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('') +
        '<option value="__new__" class="category-add-opt">＋ Add new category…</option>';
    }

    // Reset inline new-category row
    const _ncRow = document.getElementById('goal-new-category-row');
    const _ncInp = document.getElementById('goal-new-category-input');
    if (_ncRow) _ncRow.style.display = 'none';
    if (_ncInp) _ncInp.value = '';

    const goal = goalId ? state.goals.find(g => g.id === goalId) : null;
    document.getElementById('goal-modal-title').textContent = goal ? 'Edit Goal' : 'New Goal';
    document.getElementById('goal-id').value          = goal?.id          || '';
    document.getElementById('goal-title').value       = goal?.title       || '';
    document.getElementById('goal-type').value        = goal?.type        || 'time';
    document.getElementById('goal-category').value    = goal?.category    || '';
    document.getElementById('goal-priority').value    = goal?.priority    || 'medium';
    // '0000-01-01' means "from beginning" — browsers can't render year 0, so show as blank
    document.getElementById('goal-start-date').value  = (goal?.startDate && goal.startDate !== '0000-01-01') ? goal.startDate : (goal ? '' : Analytics.today());
    const targetDateEl = document.getElementById('goal-target-date');
    targetDateEl.value = goal?.targetDate || '';
    targetDateEl.min   = Analytics.today();
    document.getElementById('goal-description').value = goal?.description || '';
    document.getElementById('goal-target-hours').value  = goal?.targetMinutes ? (goal.targetMinutes / 60) : '';
    document.getElementById('goal-target-count').value  = goal?.targetCount  || '';
    document.getElementById('goal-count-unit').value    = goal?.unit         || '';

    // Render existing milestones
    const msList = document.getElementById('goal-milestones-list');
    if (msList) {
      msList.innerHTML = '';
      (goal?.milestones || []).forEach(m => _addMilestoneRow(m.label, m.id, m.done));
    }

    _updateGoalTypeFields();
    modal.style.display = 'flex';
    _openModal(modal);
    document.getElementById('goal-title')?.focus();
  }

  export function closeGoalModal() {
    const modal = document.getElementById('goal-modal');
    if (!modal) return;
    _closeModal(modal);
    modal.style.display = 'none';
  }

  export function duplicateGoal(goalId) {
    const orig = state.goals.find(g => g.id === goalId);
    if (!orig) return;
    // Pre-populate modal with the original goal's data, then patch the duplicate-specific fields
    openGoalModal(goalId);
    document.getElementById('goal-id').value             = '';
    document.getElementById('goal-modal-title').textContent = 'New Goal';
    document.getElementById('goal-title').value          = orig.title + ' (copy)';
    document.getElementById('goal-start-date').value     = Analytics.today();
    document.getElementById('goal-target-date').value    = '';
    document.querySelectorAll('#goal-milestones-list .ms-done').forEach(cb => { cb.checked = false; });
  }

  export function _addMilestoneRow(label = '', id = null, done = false) {
    const list = document.getElementById('goal-milestones-list');
    if (!list) return;
    const msId = id || `ms-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const row = document.createElement('div');
    row.className = 'milestone-row';
    row.dataset.msId = msId;
    row.innerHTML = `
      <input type="checkbox" class="ms-done" ${done ? 'checked' : ''} aria-label="Done" />
      <input type="text" class="form-input ms-label" value="${escapeHtml(label)}" placeholder="e.g. Sorting Algorithms" maxlength="120" />
      <button type="button" class="btn btn-ghost btn-icon ms-remove" aria-label="Remove milestone">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    row.querySelector('.ms-remove').addEventListener('click', () => row.remove());
    const labelInput = row.querySelector('.ms-label');
    labelInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); saveGoalFromModal(); }
    });
    list.appendChild(row);
    // Only auto-focus when adding a new empty row (not when loading existing milestones)
    if (!label) setTimeout(() => labelInput.focus(), 0);
  }

  export async function saveGoalFromModal(skipDupCheck = false) {
    const id       = document.getElementById('goal-id').value;
    const title    = document.getElementById('goal-title').value.trim();
    const type     = document.getElementById('goal-type').value;
    const category = document.getElementById('goal-category').value;
    const priority = document.getElementById('goal-priority').value;
    const startDate  = document.getElementById('goal-start-date').value;
    const targetDate = document.getElementById('goal-target-date').value;
    const description = document.getElementById('goal-description').value.trim();

    if (!title) { showToast('Please enter a goal title.', 'warning'); document.getElementById('goal-title').focus(); return; }
    if (targetDate && targetDate < Analytics.today()) {
      showToast('Deadline / Exam date cannot be in the past.', 'warning');
      document.getElementById('goal-target-date').focus();
      return;
    }

    const existing = id ? state.goals.find(g => g.id === id) : null;
    const goal = {
      ...(existing || {}),
      id:          id || undefined,
      title,
      type,
      category,
      priority,
      startDate:   startDate || (existing?.startDate ?? Analytics.today()),
      targetDate:  targetDate || null,
      description,
      status:      existing?.status || 'active',
      completedAt: existing?.completedAt || null,
    };

    // Type-specific fields
    if (type === 'time') {
      const hrs = parseFloat(document.getElementById('goal-target-hours').value);
      if (!hrs || hrs <= 0) { showToast('Please enter a target number of hours.', 'warning'); document.getElementById('goal-target-hours').focus(); return; }
      goal.targetMinutes = Math.round(hrs * 60);
      // Progress is link-based: a new time goal starts at 0 and the user links
      // entries to it afterward (via the 🔗 icon on the Daily Log or "Log entry").
    } else if (type === 'count') {
      const cnt = parseInt(document.getElementById('goal-target-count').value, 10);
      if (!cnt || cnt <= 0) { showToast('Please enter a target count.', 'warning'); document.getElementById('goal-target-count').focus(); return; }
      goal.targetCount  = cnt;
      goal.currentCount = existing?.currentCount || 0;
      goal.unit         = document.getElementById('goal-count-unit').value.trim();
    } else if (type === 'checklist') {
      const rows = document.querySelectorAll('#goal-milestones-list .milestone-row');
      if (rows.length === 0) { showToast('Please add at least one milestone.', 'warning'); document.getElementById('add-milestone-btn').focus(); return; }
      goal.milestones = Array.from(rows).map(row => ({
        id:    row.dataset.msId,
        label: row.querySelector('.ms-label')?.value.trim() || '',
        done:  row.querySelector('.ms-done')?.checked || false,
      })).filter(m => m.label);
    }

    // Duplicate check — all fields valid; warn if other open goals share this name.
    // Skipped for edits and when the user already confirmed.
    if (!id && !skipDupCheck) {
      const titleLower = title.toLowerCase();
      const openDupCount = state.goals.filter(
        g => g.status === 'active' && g.title.toLowerCase() === titleLower
      ).length;
      if (openDupCount > 0) {
        showDupGoalWarning(openDupCount, title, () => saveGoalFromModal(true));
        return;
      }
    }

    const saved = await Storage.saveGoal(goal);
    const idx = state.goals.findIndex(g => g.id === saved.id);
    if (idx >= 0) state.goals[idx] = saved;
    else { state.goals.unshift(saved); state.goalsRenderOrder = null; } // new goal — re-sort so it lands in position

    closeGoalModal();
    showToast(id ? 'Goal updated!' : 'Goal created!', 'success');
    await checkAchievements();
    updateSidebarUser();
    if (state.currentPage === 'goals') renderGoals();
    if (state.currentPage === 'dashboard') renderGoalsDashboardWidget();
    triggerAutoBackup();
  }

  export async function deleteGoal(goalId) {
    showConfirm('Delete this goal?', 'It will move to Deleted Goals where you can restore it.', async () => {
      await Storage.softDeleteGoal(goalId);
      state.goals = state.goals.filter(g => g.id !== goalId);
      state.goalsRenderOrder = null;
      showToast('Goal moved to Deleted Goals.', 'info');
      await checkAchievements();
      if (state.currentPage === 'goals') renderGoals();
      if (state.currentPage === 'dashboard') renderGoalsDashboardWidget();
      updateSidebarUser();
      triggerAutoBackup();
    });
  }

  export async function toggleMilestone(goalId, msId) {
    const goal = state.goals.find(g => g.id === goalId);
    if (!goal || !goal.milestones) return;
    const ms = goal.milestones.find(m => m.id === msId);
    if (!ms) return;
    ms.done = !ms.done;
    _maybeAutoComplete(goal);
    await _persistGoalAndRefresh(goal);
  }

  export async function setGoalCount(goalId, value) {
    const goal = state.goals.find(g => g.id === goalId);
    if (!goal) return;
    goal.currentCount = Math.max(0, Math.min(value, goal.targetCount || Infinity));
    _maybeAutoComplete(goal);
    await _persistGoalAndRefresh(goal);
  }

  export async function adjustGoalCount(goalId, delta) {
    const goal = state.goals.find(g => g.id === goalId);
    if (!goal) return;
    await setGoalCount(goalId, (goal.currentCount || 0) + delta);
  }

  export function _maybeAutoComplete(goal) {
    if (goal.type === 'exam' || goal.type === 'time') return;
    const prog = Analytics.goalProgress(goal, state.entries);
    const done = prog.current >= prog.target;
    if (goal.status === 'active' && done) {
      // For checklist and count goals, prompt the user to log an entry before completing.
      _showLogBeforeCompletePrompt(goal, prog);
    } else if (goal.status === 'completed' && !done) {
      goal.status = 'active';
      goal.completedAt = null;
      goal.progressSnapshot = null;
      showToast('Goal re-opened — progress dropped below 100%.', 'info');
    }
  }

  export function _showLogBeforeCompletePrompt(goal, prog) {
    const typeLabel = goal.type === 'checklist' ? 'all tasks' : `${prog.current} / ${prog.target}${goal.unit ? ' ' + goal.unit : ''}`;
    document.getElementById('log-prompt-message').innerHTML =
      `You've completed ${typeLabel} for "<strong>${escapeHtml(goal.title)}</strong>". Want to log a study entry to document your work?` +
      `<span class="log-prompt-warning">⚠️ Close this window or click "Already Logged" only if you have already logged.</span>`;
    state.pendingCompleteGoalId = goal.id;
    const logPromptModal = document.getElementById('log-prompt-modal');
    logPromptModal.style.display = 'flex';
    _openModal(logPromptModal);
    document.body.style.overflow = 'hidden';
  }

  // Shared handler for × button, Esc, and "Already Logged" — all complete the goal immediately.
  export async function _dismissLogPromptAndComplete() {
    const _lpm = document.getElementById('log-prompt-modal');
    if (_lpm?.style.display !== 'flex') return;
    _closeModal(_lpm);
    _lpm.style.display = 'none';
    document.body.style.overflow = '';
    const goalId = state.pendingCompleteGoalId;
    state.pendingCompleteGoalId = null;
    const goal = state.goals.find(g => g.id === goalId);
    if (!goal) return;
    const prog = Analytics.goalProgress(goal, state.entries);
    goal.status = 'completed';
    goal.completedAt = Date.now();
    goal.progressSnapshot = prog;
    await _persistGoalAndRefresh(goal);
    showToast('🎉 Goal completed!', 'success');
    await checkAchievements();
  }

  export function _setupLogPromptModal() {
    document.getElementById('log-prompt-log')?.addEventListener('click', () => {
      const _lpm2 = document.getElementById('log-prompt-modal');
      _closeModal(_lpm2, true); // entry-modal opens immediately after; skip return
      _lpm2.style.display = 'none';
      document.body.style.overflow = '';
      const goalId = state.pendingCompleteGoalId;
      // state.pendingCompleteGoalId stays set so saveEntryFromModal can complete the goal after save.
      state.pendingEntryGoalId = goalId;
      const goal = state.goals.find(g => g.id === goalId);
      openEntryModal(null, null, { goalForTitle: goal?.title || '' });
    });

    document.getElementById('log-prompt-skip')?.addEventListener('click', _dismissLogPromptAndComplete);
    document.getElementById('log-prompt-close')?.addEventListener('click', _dismissLogPromptAndComplete);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') _dismissLogPromptAndComplete();
    });
  }

  export async function completeGoal(goalId) {
    const goal = state.goals.find(g => g.id === goalId);
    if (!goal) return;
    // Treat archived+completed the same as completed: Re-open goes straight to active
    const isEffectivelyComplete = goal.status === 'completed' || (goal.status === 'archived' && goal.completedAt);
    goal.status = isEffectivelyComplete ? 'active' : 'completed';
    if (!isEffectivelyComplete) {
      goal.completedAt = Date.now();
      goal.progressSnapshot = Analytics.goalProgress(goal, state.entries);
    } else {
      goal.progressSnapshot = null;
      // For time goals still at/over their target: keep completedAt so the render-loop
      // auto-complete guard (!completedAt) doesn't immediately re-complete the goal.
      // For all other types (or time goals below target), clear it normally.
      const prog = Analytics.goalProgress(goal, state.entries);
      if (goal.type === 'time' && prog.pct >= 100) {
        // completedAt stays; signals "user consciously reopened past target"
      } else {
        goal.completedAt = null;
      }
    }
    await _persistGoalAndRefresh(goal);
    showToast(isEffectivelyComplete ? 'Goal re-opened.' : '🎉 Goal completed!', 'success');
  }

  export async function archiveGoal(goalId) {
    const goal = state.goals.find(g => g.id === goalId);
    if (!goal) return;
    if (goal.status === 'archived') {
      // Restore to completed if it was completed before archiving, otherwise active
      goal.status = goal.completedAt ? 'completed' : 'active';
      if (goal.status === 'active') goal.progressSnapshot = null; // clear only when going back to active
    } else {
      goal.status = 'archived';
      // Preserve existing snapshot (set at completion time); only capture if none exists yet
      if (!goal.progressSnapshot) goal.progressSnapshot = Analytics.goalProgress(goal, state.entries);
    }
    await _persistGoalAndRefresh(goal);
  }

  export async function _persistGoalAndRefresh(goal) {
    const saved = await Storage.saveGoal(goal);
    const idx = state.goals.findIndex(g => g.id === saved.id);
    if (idx >= 0) state.goals[idx] = saved;
    await checkAchievements();
    updateSidebarUser();
    if (state.currentPage === 'goals') renderGoals();
    if (state.currentPage === 'dashboard') renderGoalsDashboardWidget();
    triggerAutoBackup();
  }

  export function _goalStatusOf(goal) {
    if (goal.status === 'completed' || goal.status === 'archived') return goal.status;
    if (goal.targetDate && goal.targetDate < Analytics.today()) return 'overdue';
    return 'active';
  }

  // Open a blank, fully-editable Daily Log entry modal that will be auto-linked to this
  // goal on save. The entry's topic/category can be anything — the link is what counts.
  export function logEntryForGoal(goalId) {
    const goal = state.goals.find(g => g.id === goalId);
    if (!goal) return;
    state.pendingEntryGoalId = goalId;
    openEntryModal(null, null, { goalForTitle: goal.title || '' });
  }

  // Navigate to the Daily Log filtered to the entries explicitly linked to this goal.
  export function viewGoalEntries(goalId) {
    const goal = state.goals.find(g => g.id === goalId);
    if (!goal) return;

    const linked = state.entries.filter(e => Array.isArray(e.goalIds) && e.goalIds.includes(goalId));
    if (!linked.length) {
      showToast('No entries logged for this goal yet.', 'info');
      return;
    }

    // Clear any visible filters so only the link filter applies.
    clearLogFilters();
    state.logLinkedGoalFilter = goal.id;
    state.logGoalContext = { id: goal.id, title: goal.title || '' };

    // Expand every month that holds a linked entry so the logs aren't hidden behind a
    // collapsed month group when the user lands on the Daily Log.
    linked.forEach(e => {
      const key = (e.date || '').slice(0, 7);
      if (key) state.monthCollapsedState[key] = false;
    });

    navigateTo('log');
  }

  /* ---- Link Entry → Goals modal -------------------- */

  export let _linkGoalEntryId        = null;

  export let _linkGoalSelection      = new Set(); // live checkbox state, decoupled from filtering

  // Re-open the "Link to Goals" modal after the user jumped to a goal card via its "View" button.
  // Shared by the "Back to Linking" chip and the Esc key while on the Goals page.
  export function reopenLinkModalFromGoal() {
    const entryId = state.linkModalReturnEntryId;
    if (!entryId) return;
    state.linkModalReturnEntryId = null;
    state.linkModalReturnGoalId  = null;
    navigateTo('log');
    // openLinkGoalModal needs the log page rendered first so the modal overlay exists.
    setTimeout(() => openLinkGoalModal(entryId), 50);
  }

  export function reopenLinkedGoalsModal() {
    const entry = state.dlReturnEntry;
    if (!entry) return;
    state.dlReturnEntry  = null;
    state.dlReturnGoalId = null;
    navigateTo('deleted-logs');
    setTimeout(() => showLinkedGoalsPopover(null, entry), 50);
  }

  export function setupLinkGoalModal() {
    document.getElementById('link-goal-close')?.addEventListener('click', closeLinkGoalModal);
    document.getElementById('link-goal-cancel')?.addEventListener('click', closeLinkGoalModal);
    document.getElementById('link-goal-save')?.addEventListener('click', saveEntryGoalLinks);
    document.getElementById('link-goal-modal')?.addEventListener('click', e => {
      if (e.target.id === 'link-goal-modal') closeLinkGoalModal();
    });
    document.addEventListener('keydown', e => {
      const modal = document.getElementById('link-goal-modal');
      if (!modal || modal.style.display === 'none') return;
      if (e.key === 'Escape') { e.preventDefault(); closeLinkGoalModal(); }
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); saveEntryGoalLinks(); }
    });
    ['lg-search', 'lg-filter-type', 'lg-filter-category', 'lg-filter-priority'].forEach(id => {
      document.getElementById(id)?.addEventListener('input',  renderLinkGoalList);
      document.getElementById(id)?.addEventListener('change', renderLinkGoalList);
    });
    // Track selection independently of which goals are currently visible after filtering.
    document.getElementById('lg-goal-list')?.addEventListener('change', e => {
      const cb = e.target.closest('.lg-goal-cb');
      if (!cb) return;
      if (cb.checked) _linkGoalSelection.add(cb.value);
      else _linkGoalSelection.delete(cb.value);
      cb.closest('.link-goal-item')?.classList.toggle('is-linked', cb.checked);
    });
  }

  export function openLinkGoalModal(entryId) {
    const entry = state.entries.find(e => e.id === entryId);
    if (!entry) return;
    _linkGoalEntryId   = entryId;
    _linkGoalSelection = new Set(entry.goalIds || []);

    // Reset filters to defaults
    setInputVal('lg-search', '');
    ['lg-filter-type', 'lg-filter-priority'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const catSel = document.getElementById('lg-filter-category');
    if (catSel) {
      const cats = state.prefs.categories || DEFAULT_PREFS.categories;
      catSel.innerHTML = '<option value="">All categories</option>' +
        cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      catSel.value = '';
    }

    renderLinkGoalList();
    const modal = document.getElementById('link-goal-modal');
    modal.style.display = 'flex';
    _openModal(modal);
    document.body.style.overflow = 'hidden';
  }

  export function closeLinkGoalModal() {
    const modal = document.getElementById('link-goal-modal');
    if (!modal) return;
    _closeModal(modal);
    modal.style.display = 'none';
    document.body.style.overflow = '';
    _linkGoalEntryId = null;
  }

  export function renderLinkGoalList() {
    const listEl = document.getElementById('lg-goal-list');
    if (!listEl) return;
    const entry = state.entries.find(e => e.id === _linkGoalEntryId);
    const linkedOrig = new Set(entry?.goalIds || []);

    const search = (document.getElementById('lg-search')?.value || '').toLowerCase().trim();
    const typeF  = document.getElementById('lg-filter-type')?.value || '';
    const catF   = document.getElementById('lg-filter-category')?.value || '';
    const priF   = document.getElementById('lg-filter-priority')?.value || '';

    // Open goals (active/overdue), plus any goal this entry is already linked to so it
    // can still be unlinked even if it's since been completed or archived.
    let goals = state.goals.filter(g => {
      const st = _goalStatusOf(g);
      return st === 'active' || st === 'overdue' || linkedOrig.has(g.id);
    });
    if (typeF)  goals = goals.filter(g => g.type === typeF);
    if (catF)   goals = goals.filter(g => g.category === catF);
    if (priF)   goals = goals.filter(g => g.priority === priF);
    if (search) goals = goals.filter(g => (g.title || '').toLowerCase().includes(search));

    goals.sort((a, b) => (_linkGoalSelection.has(b.id) ? 1 : 0) - (_linkGoalSelection.has(a.id) ? 1 : 0));

    if (!goals.length) {
      listEl.innerHTML = `<div class="link-goal-empty">No matching open goals.</div>`;
      return;
    }

    const typeLabel = { time: '⏳ Study Hours', count: '🏆 Problem Count', checklist: '📋 Task List', exam: '🎓 Exam Prep' };
    listEl.innerHTML = goals.map(g => {
      const checked = _linkGoalSelection.has(g.id);
      return `
        <label class="link-goal-item${checked ? ' is-linked' : ''}">
          <input type="checkbox" class="lg-goal-cb" value="${g.id}" ${checked ? 'checked' : ''} />
          <span class="link-goal-item-main">
            <span class="link-goal-item-title">${escapeHtml(g.title)}</span>
            <span class="link-goal-item-meta">
              <span class="goal-type-chip" data-type="${g.type}">${typeLabel[g.type] || g.type}</span>
              ${g.category ? `<span class="goal-cat-chip">${escapeHtml(g.category)}</span>` : ''}
              <span class="goal-priority-chip goal-priority-${g.priority}">${capitalise(g.priority || '')}</span>
            </span>
          </span>
          <button type="button" class="lg-view-goal-btn" data-goal-id="${g.id}" title="View this goal">View</button>
        </label>`;
    }).join('');

    // View buttons navigate to the Goals page, closing the modal first.
    listEl.querySelectorAll('.lg-view-goal-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation(); // don't toggle the checkbox
        state.goalScrollTarget       = btn.dataset.goalId;
        state.linkModalReturnEntryId = _linkGoalEntryId;
        state.linkModalReturnGoalId  = btn.dataset.goalId;
        closeLinkGoalModal();
        navigateTo('goals');
      });
    });
  }

  export async function saveEntryGoalLinks() {
    const entry = state.entries.find(e => e.id === _linkGoalEntryId);
    if (!entry) { closeLinkGoalModal(); return; }
    const prevCount = Array.isArray(entry.goalIds) ? entry.goalIds.length : 0;
    const n = _linkGoalSelection.size;
    entry.goalIds = Array.from(_linkGoalSelection);
    await Storage.saveEntry(entry);
    closeLinkGoalModal();
    const toast = n > 0 ? `Linked to ${n} goal${n === 1 ? '' : 's'}.`
                : prevCount > 0 ? 'All goal links removed.'
                : null;
    if (toast) showToast(toast, 'success');
    await checkAchievements();
    renderPage(state.currentPage);
    updateSidebarUser();
    triggerAutoBackup();
  }

  export function updateGoalsSelectionBar() {
    const selBar   = document.getElementById('goals-selection-bar');
    const bulkActs = document.getElementById('goals-bulk-actions');
    const label    = document.getElementById('goals-selection-label');
    const total    = document.querySelectorAll('.goals-checkbox').length;
    const n        = state.goalsSelection.size;

    if (selBar) selBar.style.display = total > 0 ? 'flex' : 'none';
    if (label) label.textContent = n === 0 ? '' : `${n} ${n === 1 ? 'goal' : 'goals'} selected`;
    if (bulkActs) bulkActs.style.display = n > 0 ? 'flex' : 'none';

    document.querySelectorAll('.goals-sec-checkbox').forEach(scb => {
      const key    = scb.dataset.secKey;
      const secCbs = document.querySelectorAll(`.goals-checkbox[data-sec="${key}"]`);
      const sel    = [...secCbs].filter(cb => state.goalsSelection.has(cb.dataset.id)).length;
      scb.indeterminate = sel > 0 && sel < secCbs.length;
      scb.checked = secCbs.length > 0 && sel === secCbs.length;
    });

    document.querySelectorAll('.goal-card').forEach(card => {
      card.classList.toggle('goal-card-selected', state.goalsSelection.has(card.dataset.id));
    });
  }

  export function bulkDeleteGoals() {
    const ids = [...state.goalsSelection];
    if (!ids.length) return;
    const n = ids.length;
    showConfirm(
      `Delete ${n} ${n === 1 ? 'goal' : 'goals'}?`,
      'They will move to Deleted Goals where you can restore them.',
      async () => {
        await Promise.all(ids.map(id => Storage.softDeleteGoal(id)));
        state.goals = state.goals.filter(g => !ids.includes(g.id));
        state.goalsSelection.clear();
        state.goalsRenderOrder = null;
        showToast(`${n} ${n === 1 ? 'goal' : 'goals'} moved to Deleted Goals.`, 'info');
        await checkAchievements();
        renderGoals();
        if (state.currentPage === 'dashboard') renderGoalsDashboardWidget();
        updateSidebarUser();
        triggerAutoBackup();
      }
    );
  }

  export function renderGoals() {
    const container = document.getElementById('goals-list');
    if (!container) return;

    // Setup filter chips one-time
    const filterRow = document.getElementById('goals-filter-row');
    if (filterRow && !filterRow.dataset.wired) {
      filterRow.dataset.wired = '1';
      filterRow.querySelectorAll('.goals-filter-chip[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
          filterRow.querySelectorAll('.goals-filter-chip[data-filter]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.goalsFilter = btn.dataset.filter;
          state.goalsRenderOrder = null;
          renderGoals();
        });
      });
      filterRow.querySelectorAll('.goals-filter-chip[data-filter-type]').forEach(btn => {
        btn.addEventListener('click', () => {
          const isActive = btn.classList.contains('active');
          filterRow.querySelectorAll('.goals-filter-chip[data-filter-type]').forEach(b => b.classList.remove('active'));
          if (!isActive) { btn.classList.add('active'); state.goalsTypeFilter = btn.dataset.filterType; }
          else state.goalsTypeFilter = '';
          state.goalsRenderOrder = null;
          renderGoals();
        });
      });
      document.getElementById('goals-reset-filters')?.addEventListener('click', () => {
        state.goalsFilter     = 'all';
        state.goalsTypeFilter = '';
        state.goalsSearch     = '';
        state.goalsCollapsedSnapshot = null;
        state.goalsRenderOrder = null;
        filterRow.querySelectorAll('.goals-filter-chip[data-filter]').forEach(b => b.classList.remove('active'));
        filterRow.querySelector('.goals-filter-chip[data-filter="all"]')?.classList.add('active');
        filterRow.querySelectorAll('.goals-filter-chip[data-filter-type]').forEach(b => b.classList.remove('active'));
        const si = document.getElementById('goals-search');
        if (si) si.value = '';
        renderGoals();
      });

      document.getElementById('goals-clear-selection-btn')?.addEventListener('click', () => {
        state.goalsSelection.clear();
        document.querySelectorAll('.goals-checkbox').forEach(cb => { cb.checked = false; });
        const all = document.getElementById('goals-select-all');
        if (all) { all.checked = false; all.indeterminate = false; }
        updateGoalsSelectionBar();
      });

      document.getElementById('goals-bulk-delete-btn')?.addEventListener('click', bulkDeleteGoals);
    }

    // Highlight Clear Filters button when any filter/search is active
    const clearBtn = document.getElementById('goals-reset-filters');
    if (clearBtn) {
      const hasFilters = state.goalsFilter !== 'all' || state.goalsTypeFilter !== '' || state.goalsSearch !== '';
      clearBtn.classList.toggle('filters-active', hasFilters);
    }

    // Setup search input one-time
    const searchInput = document.getElementById('goals-search');
    if (searchInput && !searchInput.dataset.wired) {
      searchInput.dataset.wired = '1';
      const _goalsSearchRender = debounce(() => {
        const prev = state.goalsSearch;
        state.goalsSearch = searchInput.value.trim().toLowerCase();
        state.goalsRenderOrder = null;
        if (state.goalsSearch && !prev) {
          // Search just started — snapshot current state then expand all
          state.goalsCollapsedSnapshot = { ...state.goalsCollapsed };
          state.goalsCollapsed = { overdue: false, open: false, completed: false, archived: false };
        } else if (!state.goalsSearch && prev) {
          // Search cleared — restore pre-search state
          if (state.goalsCollapsedSnapshot) {
            state.goalsCollapsed = state.goalsCollapsedSnapshot;
            state.goalsCollapsedSnapshot = null;
          }
        }
        renderGoals();
      }, 150);
      searchInput.addEventListener('input', _goalsSearchRender);
    }

    const today = Analytics.today();
    let _goalStateChanged = false;
    let goals = state.goals.map(g => {
      const isLocked = g.status === 'completed' || g.status === 'archived';

      // Completed/archived goals use a frozen snapshot so daily-log changes
      // never update their displayed progress.
      if (isLocked && g.progressSnapshot) {
        return { ...g, derivedStatus: _goalStatusOf(g), prog: g.progressSnapshot };
      }

      const prog = Analytics.goalProgress(g, state.entries);
      if (g.type === 'time' && g.status === 'active') {
        if (!g.completedAt && prog.pct >= 100) {
          // First time reaching 100% — auto-complete and freeze snapshot
          g.status = 'completed';
          g.completedAt = Date.now();
          g.progressSnapshot = prog;
          Storage.saveGoal(g);
          _goalStateChanged = true;
        } else if (g.completedAt && prog.pct < 100) {
          // Manually reopened at 100% but progress since dropped — reset the guard
          // so the next crossing of 100% fires auto-complete again
          g.completedAt = null;
          Storage.saveGoal(g);
          _goalStateChanged = true;
        }
      }

      // Fallback for completed time goals that pre-date the snapshot feature:
      // force 100% so they don't show a fluctuating bar.
      let displayProg = prog;
      if (g.status === 'completed' && g.type === 'time' && !g.progressSnapshot) {
        displayProg = { ...prog, pct: 100 };
      }

      const derivedStatus = _goalStatusOf(g);
      return { ...g, derivedStatus, prog: displayProg };
    });
    if (_goalStateChanged) checkAchievements();

    // Filter
    if (state.goalsFilter !== 'all') goals = goals.filter(g => g.derivedStatus === state.goalsFilter);
    if (state.goalsTypeFilter) goals = goals.filter(g => g.type === state.goalsTypeFilter);
    if (state.goalsSearch) {
      const q = state.goalsSearch;
      goals = goals.filter(g =>
        g.title.toLowerCase().includes(q) ||
        (g.description || '').toLowerCase().includes(q) ||
        (g.category || '').toLowerCase().includes(q)
      );
    }

    // Sort helpers — applied per-section after the section split below.
    const _priorityRank  = { high: 0, medium: 1, low: 2 };
    const _byUpdated     = (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    const _byPriorityUpdated = (a, b) => {
      const pd = (_priorityRank[a.priority] ?? 1) - (_priorityRank[b.priority] ?? 1);
      return pd !== 0 ? pd : _byUpdated(a, b);
    };
    // On in-page re-renders keep the visual order stable; on fresh load apply the sort fn.
    const _stableSort = (arr, freshFn) => {
      if (state.goalsRenderOrder) {
        const om = new Map(state.goalsRenderOrder.map((id, i) => [id, i]));
        arr.sort((a, b) => {
          const ai = om.has(a.id) ? om.get(a.id) : -1;
          const bi = om.has(b.id) ? om.get(b.id) : -1;
          if (ai === -1 && bi === -1) return freshFn(a, b);
          if (ai === -1) return -1; // new goal floats to top of its section
          if (bi === -1) return 1;
          return ai - bi;
        });
      } else {
        arr.sort(freshFn);
      }
    };

    if (goals.length === 0) {
      container.innerHTML = `
        <div class="goals-empty-wrap">
          <div class="empty-state">
            <div class="empty-icon">🎯</div>
            <h3>No goals yet</h3>
            <p>${state.goalsSearch ? `No goals match "${escapeHtml(state.goalsSearch)}".` : state.goalsFilter !== 'all' || state.goalsTypeFilter ? 'No goals match this filter.' : 'Set academic goals to track your targets, deadlines and milestones.'}</p>
            ${state.goalsFilter === 'all' && !state.goalsTypeFilter && !state.goalsSearch ? `<button class="btn btn-primary" id="goals-empty-add">Create First Goal</button>` : ''}
          </div>
        </div>`;
      document.getElementById('goals-empty-add')?.addEventListener('click', () => openGoalModal());
      state.goalsSelection.clear();
      updateGoalsSelectionBar();
      return;
    }

    // When "All" is selected, render labelled sections for every status
    if (state.goalsFilter === 'all') {
      // If navigating from dashboard to a specific goal, ensure its section is expanded
      if (state.goalScrollTarget) {
        const tgt = goals.find(g => g.id === state.goalScrollTarget);
        if (tgt) {
          const secKey = tgt.derivedStatus === 'active' ? 'open' : tgt.derivedStatus;
          state.goalsCollapsed[secKey] = false;
        }
      }

      const overdue   = goals.filter(g => g.derivedStatus === 'overdue');
      const open      = goals.filter(g => g.derivedStatus === 'active');
      const completed = goals.filter(g => g.derivedStatus === 'completed');
      const archived  = goals.filter(g => g.derivedStatus === 'archived');

      // Open/overdue: priority first, then most recently updated.
      // Completed/archived: most recently updated only.
      _stableSort(overdue,   _byPriorityUpdated);
      _stableSort(open,      _byPriorityUpdated);
      _stableSort(completed, _byUpdated);
      _stableSort(archived,  _byUpdated);
      state.goalsRenderOrder = [...overdue, ...open, ...completed, ...archived].map(g => g.id);

      const renderSection = (label, icon, items, emptyMsg, extraClass = '') => {
        const key       = label.toLowerCase();
        const collapsed = !!state.goalsCollapsed[key];
        const body      = items.length
          ? `<div class="goals-grid goals-section-body${collapsed ? ' goals-sec-collapsed' : ''}">${items.map(g => _renderGoalCard(g)).join('')}</div>`
          : emptyMsg
          ? `<div class="goals-section-empty goals-section-body${collapsed ? ' goals-sec-collapsed' : ''}"><span class="gse-icon">${icon}</span><span class="gse-text">${emptyMsg}</span></div>`
          : '';
        const secCb = items.length ? `
          <label onclick="event.stopPropagation()" style="display:flex;align-items:center;flex-shrink:0;cursor:pointer">
            <input type="checkbox" class="goals-sec-checkbox" data-sec-key="${key}"
              style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer" />
          </label>` : '';
        return `
          <div class="goals-section${extraClass ? ' ' + extraClass : ''}">
            <div class="goals-section-hd goals-sec-toggle" data-sec-key="${key}">
              ${secCb}
              <span class="goals-section-icon">${icon}</span>
              <span class="goals-section-label">${label}</span>
              <span class="goals-section-count">${items.length}</span>
              <span class="goals-sec-chevron${collapsed ? ' goals-sec-chevron-up' : ''}"></span>
            </div>
            ${body}
          </div>`;
      };

      const sectionKeys = [...(overdue.length ? ['overdue'] : []), 'open', 'completed', 'archived'];
      const allCollapsed = sectionKeys.length > 0 && sectionKeys.every(k => !!state.goalsCollapsed[k]);
      const toggleAllBtn = `
        <div class="goals-sections-bar">
          <button class="btn btn-ghost goals-toggle-all-btn" id="goals-toggle-all" title="${allCollapsed ? 'Expand all sections' : 'Collapse all sections'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="${allCollapsed ? '4 14 12 6 20 14' : '4 10 12 18 20 10'}"/></svg>
            ${allCollapsed ? 'Expand All' : 'Collapse All'}
          </button>
        </div>`;

      container.innerHTML =
        toggleAllBtn +
        (overdue.length ? renderSection('Overdue', '⚠️', overdue, '', 'goals-section-overdue') : '') +
        renderSection('Open', '📋', open, 'No open goals.') +
        renderSection('Completed', '✅', completed, 'No completed goals yet.') +
        renderSection('Archived', '📦', archived, 'No archived goals.', 'goals-section-archived');

      document.getElementById('goals-toggle-all')?.addEventListener('click', () => {
        sectionKeys.forEach(k => { state.goalsCollapsed[k] = !allCollapsed; });
        renderGoals();
      });

      container.querySelectorAll('.goals-sec-toggle').forEach(hd => {
        hd.addEventListener('click', () => {
          const key = hd.dataset.secKey;
          state.goalsCollapsed[key] = !state.goalsCollapsed[key];
          renderGoals();
        });
      });

      // Section-level select-all checkboxes
      container.querySelectorAll('.goals-sec-checkbox').forEach(scb => {
        scb.addEventListener('change', e => {
          e.stopPropagation();
          const key    = scb.dataset.secKey;
          const secCbs = container.querySelectorAll(`.goals-checkbox[data-sec="${key}"]`);
          secCbs.forEach(cb => {
            cb.checked = scb.checked;
            scb.checked ? state.goalsSelection.add(cb.dataset.id) : state.goalsSelection.delete(cb.dataset.id);
          });
          updateGoalsSelectionBar();
        });
      });
    } else {
      // Single-filter view: open/overdue use priority+updated; completed/archived use updated only.
      const isOpenFilter = state.goalsFilter === 'active' || state.goalsFilter === 'overdue';
      _stableSort(goals, isOpenFilter ? _byPriorityUpdated : _byUpdated);
      state.goalsRenderOrder = goals.map(g => g.id);
      container.innerHTML = `<div class="goals-grid">${goals.map(g => _renderGoalCard(g)).join('')}</div>`;
    }

    _wireGoalCards(container);
    updateGoalsSelectionBar();

    if (state.goalScrollTarget) {
      const targetId = state.goalScrollTarget;
      state.goalScrollTarget = null;
      setTimeout(() => {
        const card = container.querySelector(`.goal-card[data-id="${targetId}"]`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('goal-card-highlight');
          setTimeout(() => card.classList.remove('goal-card-highlight'), 1800);
        }
      }, 50);
    }
  }

  export function _renderGoalCard(g) {
    const { derivedStatus, prog } = g;
    // Complete button shows "Re-open" for both completed and archived+completed goals
    const isReopenable = derivedStatus === 'completed' || (derivedStatus === 'archived' && g.completedAt);
    const daysLeft = g.targetDate ? Analytics.daysUntil(g.targetDate) : null;
    const countdownClass = derivedStatus === 'overdue' ? 'countdown-overdue'
                         : daysLeft !== null && daysLeft <= 3 ? 'countdown-warn'
                         : derivedStatus === 'completed' ? 'countdown-done' : '';
    const countdownLabel = derivedStatus === 'overdue' ? `⚠️ Overdue by ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'}`
                         : daysLeft === null            ? ''
                         : daysLeft === 0               ? '📅 Due today!'
                         : `📅 ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;

    const typeLabel = { time: '⏳ Study Hours', checklist: '📋 Task List', count: '🏆 Problem Count', exam: '🎓 Exam Prep' }[g.type] || g.type;
    const priorityLabel = { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' }[g.priority] || '';

    let progressSection = '';
    if (g.type === 'time' || g.type === 'count') {
      progressSection = `
        <div class="goal-prog-bar-wrap">
          <div class="goal-prog-bar"><div class="goal-prog-fill ${derivedStatus === 'completed' ? 'completed' : ''}" style="width:${prog.pct}%"></div></div>
          <span class="goal-prog-label">${escapeHtml(prog.label)} (${prog.pct}%)</span>
        </div>`;
    } else if (g.type === 'checklist') {
      progressSection = `
        <div class="goal-prog-bar-wrap">
          <div class="goal-prog-bar"><div class="goal-prog-fill ${derivedStatus === 'completed' ? 'completed' : ''}" style="width:${prog.pct}%"></div></div>
          <span class="goal-prog-label">${prog.pct}% complete (${prog.current}/${prog.target})</span>
        </div>`;
    } else if (g.type === 'exam') {
      progressSection = '';
    }

    let extraControls = '';
    if (g.type === 'count' && derivedStatus !== 'completed' && derivedStatus !== 'archived') {
      extraControls = `
        <div class="goal-count-controls">
          <button class="btn btn-ghost btn-icon" data-action="count-dec" data-id="${g.id}" title="Decrement">−</button>
          <input type="number" class="goal-count-input" data-id="${g.id}" value="${g.currentCount || 0}" min="0" max="${g.targetCount || ''}" title="Click to edit" />
          <button class="btn btn-ghost btn-icon" data-action="count-inc" data-id="${g.id}" title="Increment">+</button>
        </div>`;
    }

    const isReadOnly = derivedStatus === 'completed' || derivedStatus === 'archived';
    let milestoneRows = '';
    if (g.type === 'checklist' && g.milestones?.length) {
      milestoneRows = `<div class="goal-milestones-display">
        ${g.milestones.map(m => `
          <label class="goal-ms-row ${m.done ? 'ms-done' : ''}${isReadOnly ? ' goal-ms-readonly' : ''}"${isReadOnly ? ' title="Reopen goal to make changes"' : ''}>
            <input type="checkbox" ${m.done ? 'checked' : ''} data-action="toggle-ms" data-id="${g.id}" data-msid="${m.id}"${isReadOnly ? ' disabled' : ''} />
            <span>${escapeHtml(m.label)}</span>
          </label>`).join('')}
      </div>
      `;
    }

    // Log Entry / View Logged Entries available on every goal type. Logging links a study
    // entry to the goal for the record; progress stays type-native (time = summed duration,
    // count = +/-, checklist = milestones, exam = countdown). Log Entry is offered only while
    // the goal is still in progress; View Logged Entries is always available.
    const canLog = derivedStatus === 'active' || derivedStatus === 'overdue';
    const goalLinks = `
        <div class="goal-card-links">
          ${canLog ? `<button type="button" class="goal-card-link" data-action="log-entry" data-id="${g.id}">＋ Log Entry</button>` : ''}
          <button type="button" class="goal-card-link goal-card-link-muted" data-action="view-entries" data-id="${g.id}">View Logged Entries</button>
        </div>`;

    const statusClass = derivedStatus === 'overdue' ? 'goal-card-overdue'
                      : derivedStatus === 'completed' ? 'goal-card-completed'
                      : derivedStatus === 'archived' ? 'goal-card-archived' : '';

    const statusChip = derivedStatus === 'completed'
      ? `<span class="goal-status-chip goal-status-chip-completed">✓ Completed</span>`
      : derivedStatus === 'archived'
      ? `<span class="goal-status-chip goal-status-chip-archived">Archived</span>`
      : derivedStatus === 'overdue'
      ? `<span class="goal-status-chip goal-status-chip-overdue">Overdue</span>`
      : `<span class="goal-status-chip goal-status-chip-open">Open</span>`;

    const secKey = derivedStatus === 'active' ? 'open' : derivedStatus;
    const isChecked = state.goalsSelection.has(g.id) ? 'checked' : '';
    return `
      <div class="goal-card ${statusClass}${state.goalsSelection.has(g.id) ? ' goal-card-selected' : ''}" data-id="${g.id}" data-type="${g.type}">
        <div class="goal-card-cb">
          <label onclick="event.stopPropagation()" style="display:flex;align-items:center;cursor:pointer">
            <input type="checkbox" class="goals-checkbox" data-id="${g.id}" data-sec="${secKey}" ${isChecked}
              style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer" />
          </label>
        </div>
        <div class="goal-card-header">
          <div class="goal-card-meta">
            ${statusChip}
            <span class="goal-type-chip" data-type="${g.type}">${typeLabel}</span>
            ${g.category ? `<span class="goal-cat-chip">${escapeHtml(g.category)}</span>` : ''}
            <span class="goal-priority-chip goal-priority-${g.priority}">${priorityLabel}</span>
            ${countdownLabel ? `<span class="goal-countdown ${countdownClass}">${countdownLabel}</span>` : ''}
          </div>
          <div class="goal-card-actions">
            <button class="btn btn-ghost btn-icon" data-action="edit" data-id="${g.id}" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn btn-ghost btn-icon" data-action="duplicate" data-id="${g.id}" title="Duplicate">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="btn btn-ghost btn-icon${isReopenable ? ' goal-btn-active-complete' : ''}" data-action="complete" data-id="${g.id}" title="${isReopenable ? 'Re-open' : 'Mark complete'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
            <button class="btn btn-ghost btn-icon${derivedStatus === 'archived' ? ' goal-btn-active-archive' : ''}" data-action="archive" data-id="${g.id}" title="${derivedStatus === 'archived' ? 'Unarchive' : 'Archive'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
            </button>
            <button class="btn btn-ghost btn-icon goal-delete-btn" data-action="delete" data-id="${g.id}" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </button>
          </div>
        </div>
        <h3 class="goal-card-title ${derivedStatus === 'completed' ? 'goal-title-done' : ''}">${escapeHtml(g.title)}</h3>
        ${g.description ? `<p class="goal-card-desc">${linkifyNotes(g.description)}</p>` : ''}
        ${progressSection}
        ${extraControls}
        ${milestoneRows}
        ${goalLinks}
        ${g.startDate ? `<div class="goal-card-dates">Started ${formatRelativeDate(g.startDate)}${g.targetDate ? ` · Due ${new Date(g.targetDate + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}` : ''}</div>` : ''}
        ${state.linkModalReturnGoalId === g.id ? (() => {
            const entry = state.entries.find(e => e.id === state.linkModalReturnEntryId);
            const label = entry ? escapeHtml(entry.topic || 'entry') : 'entry';
            return `<button type="button" class="log-goal-back-chip goal-card-link-modal-back" data-action="back-to-link-modal" data-id="${g.id}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              Back to Linking: ${label}
            </button>`;
          })() : ''}
        ${state.dlReturnGoalId === g.id ? (() => {
            const label = escapeHtml(state.dlReturnEntry?.topic || 'deleted entry');
            return `<button type="button" class="log-goal-back-chip" data-action="back-to-dl-link-modal" data-id="${g.id}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              Back to Deleted Log: ${label}
            </button>`;
          })() : ''}
      </div>`;
  }

  export function _wireGoalCards(container) {
    // Guard: only attach one listener per container element (re-renders keep the same DOM node)
    if (container.dataset.goalsWired) return;
    container.dataset.goalsWired = '1';
    container.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id     = btn.dataset.id;
      if (action === 'edit')       openGoalModal(id);
      if (action === 'duplicate')  duplicateGoal(id);
      if (action === 'log-entry')  logEntryForGoal(id);
      if (action === 'view-entries') viewGoalEntries(id);
      if (action === 'complete')   await completeGoal(id);
      if (action === 'archive')    await archiveGoal(id);
      if (action === 'delete')     await deleteGoal(id);
      if (action === 'count-inc')  await adjustGoalCount(id, 1);
      if (action === 'count-dec')  await adjustGoalCount(id, -1);
      if (action === 'toggle-ms')  await toggleMilestone(id, btn.dataset.msid);
      if (action === 'back-to-link-modal')    reopenLinkModalFromGoal();
      if (action === 'back-to-dl-link-modal') reopenLinkedGoalsModal();
    });

    container.addEventListener('change', e => {
      const cb = e.target.closest('.goals-checkbox');
      if (!cb) return;
      e.stopPropagation();
      cb.checked ? state.goalsSelection.add(cb.dataset.id) : state.goalsSelection.delete(cb.dataset.id);
      updateGoalsSelectionBar();
    });

    // Editable count input: inline validation + save on blur or Enter
    container.addEventListener('input', e => {
      const input = e.target.closest('.goal-count-input');
      if (!input) return;
      const val = parseInt(input.value, 10);
      const max = parseInt(input.max, 10);
      const controls = input.closest('.goal-count-controls');
      let warning = controls?.previousElementSibling;
      const hasWarning = warning?.classList.contains('goal-count-warning');
      if (!isNaN(val) && !isNaN(max) && val > max) {
        input.classList.add('goal-count-input--error');
        if (!hasWarning) {
          const w = document.createElement('p');
          w.className = 'goal-count-warning';
          w.textContent = `Value can't exceed target of ${max}`;
          controls.insertAdjacentElement('beforebegin', w);
        }
      } else {
        input.classList.remove('goal-count-input--error');
        if (hasWarning) warning.remove();
      }
    });
    container.addEventListener('change', async e => {
      const input = e.target.closest('.goal-count-input');
      if (!input) return;
      if (input.classList.contains('goal-count-input--error')) return;
      const val = parseInt(input.value, 10);
      if (!isNaN(val)) await setGoalCount(input.dataset.id, val);
    });
    container.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.closest('.goal-count-input')) e.target.blur();
    });
  }

  /* ---- Deleted Goals -------------------------------- */

  function applyDeletedGoalFilters(goals) {
    let list = [...goals];

    const search   = (document.getElementById('dg-search')?.value || '').toLowerCase().trim();
    const category = document.getElementById('dg-filter-category')?.value;
    const type     = document.getElementById('dg-filter-type')?.value;
    const sort     = document.getElementById('dg-filter-sort')?.value || 'deleted-newest';

    if (search)   list = list.filter(g =>
      g.title?.toLowerCase().includes(search) ||
      (g.description || '').toLowerCase().includes(search) ||
      (g.category || '').toLowerCase().includes(search)
    );
    if (category) list = list.filter(g => g.category === category);
    if (type)     list = list.filter(g => g.type === type);

    switch (sort) {
      case 'deleted-newest': list.sort((a, b) => b.deletedAt - a.deletedAt); break;
      case 'deleted-oldest': list.sort((a, b) => a.deletedAt - b.deletedAt); break;
      case 'az':             list.sort((a, b) => (a.title || '').localeCompare(b.title || '')); break;
      case 'za':             list.sort((a, b) => (b.title || '').localeCompare(a.title || '')); break;
    }
    return list;
  }

  export async function renderDeletedGoals() {
    const container = document.getElementById('dg-goals-container');
    if (!container) return;

    populateCategorySelects();

    const allDeleted = await Storage.getDeletedGoals();
    const filtered   = applyDeletedGoalFilters(allDeleted);

    if (filtered.length === 0) {
      const isEmpty = allDeleted.length === 0;
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${isEmpty ? '🗑️' : '🔍'}</div>
          <h3>${isEmpty ? 'No deleted goals' : 'No matching goals'}</h3>
          <p>${isEmpty ? 'Deleted goals will appear here for recovery.' : 'Try a different search.'}</p>
        </div>`;
      updateDgBulkBar();
      return;
    }

    const typeLabels = { time: '⏳ Study Hours', checklist: '📋 Task List', count: '🏆 Problem Count', exam: '🎓 Exam Prep' };

    container.innerHTML = filtered.map(g => {
      const deletedAgo   = _timeAgo(g.deletedAt);
      const checked      = state.deletedGoalsSelection.has(g.id) ? 'checked' : '';
      const selClass     = state.deletedGoalsSelection.has(g.id) ? ' dl-selected' : '';
      const linkedCount  = state.entries.filter(e => Array.isArray(e.goalIds) && e.goalIds.includes(g.id)).length;
      return `
        <div class="dg-goal-row${selClass}" data-id="${g.id}">
          <div class="dg-goal-checkbox">
            <label style="display:flex;align-items:center;cursor:pointer" onclick="event.stopPropagation()">
              <input type="checkbox" class="dg-checkbox" data-id="${g.id}" ${checked}
                style="width:15px;height:15px;cursor:pointer;accent-color:var(--accent)" />
            </label>
          </div>
          <div class="dg-goal-info">
            <span class="goal-type-chip" data-type="${g.type}">${typeLabels[g.type] || g.type}</span>
            <span class="dg-goal-title dg-title-link" data-dg-view="${g.id}" title="View details">${escapeHtml(g.title)}</span>
            ${g.category ? `<span class="goal-cat-chip">${escapeHtml(g.category)}</span>` : ''}
          </div>
          <div class="dg-goal-meta">
            <div class="dl-deleted-badge">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              ${deletedAgo}
            </div>
            <div class="dl-action-row">
              ${linkedCount ? `
              <button class="entry-link-icon-btn has-links dg-linked-entries-btn" data-id="${g.id}" title="${linkedCount} logged entr${linkedCount === 1 ? 'y' : 'ies'}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                <span class="entry-link-count">${linkedCount}</span>
              </button>` : ''}
              <button class="dl-restore-btn" data-dg-restore="${g.id}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                Restore
              </button>
              <button class="dl-delete-icon-btn" data-dg-delete="${g.id}" title="Delete permanently">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              </button>
            </div>
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('[data-dg-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const goal = filtered.find(g => g.id === btn.dataset.dgView);
        if (goal) showDeletedGoalDetail(goal);
      });
    });
    container.querySelectorAll('[data-dg-restore]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); restoreDeletedGoal(btn.dataset.dgRestore); });
    });
    container.querySelectorAll('[data-dg-delete]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); permanentDeleteGoal(btn.dataset.dgDelete); });
    });
    container.querySelectorAll('.dg-linked-entries-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const goal = filtered.find(g => g.id === btn.dataset.id);
        if (goal) showLinkedEntriesPopover(btn, goal);
      });
    });

    container.querySelectorAll('.dg-checkbox').forEach(cb => {
      cb.addEventListener('change', e => {
        e.stopPropagation();
        cb.checked ? state.deletedGoalsSelection.add(cb.dataset.id) : state.deletedGoalsSelection.delete(cb.dataset.id);
        updateDgBulkBar();
      });
    });

    updateDgBulkBar();
  }

  export function updateDgBulkBar() {
    const selBar   = document.getElementById('dg-selection-bar');
    const bulkActs = document.getElementById('dg-bulk-actions');
    const label    = document.getElementById('dg-selection-label');
    const allCheck = document.getElementById('dg-select-all');
    const allCbs   = document.querySelectorAll('.dg-checkbox');
    const total    = allCbs.length;
    const n        = state.deletedGoalsSelection.size;

    if (selBar) selBar.style.display = total > 0 ? 'flex' : 'none';

    if (allCheck) {
      allCheck.indeterminate = n > 0 && n < total;
      allCheck.checked = total > 0 && n === total;
    }

    if (label) label.textContent = n === 0 ? `Select all (${total})` : `${n} of ${total} selected`;
    if (bulkActs) bulkActs.style.display = n > 0 ? 'flex' : 'none';

    document.querySelectorAll('.dg-goal-row').forEach(row => {
      row.classList.toggle('dl-selected', state.deletedGoalsSelection.has(row.dataset.id));
    });
  }

  export function _timeAgo(ts) {
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60)   return 'just now';
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    const days = Math.floor(secs / 86400);
    if (days < 30) return `${days}d ago`;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  export async function restoreDeletedGoal(id) {
    await Storage.restoreGoal(id);
    const restored = await Storage.getGoal(id);
    if (restored) {
      const idx = state.goals.findIndex(g => g.id === id);
      if (idx >= 0) state.goals[idx] = restored; else state.goals.unshift(restored);
    }
    showToast('Goal restored!', 'success');
    await checkAchievements();
    if (state.currentPage === 'deleted-goals') await renderDeletedGoals();
    if (state.currentPage === 'goals') renderGoals();
    if (state.currentPage === 'dashboard') renderGoalsDashboardWidget();
    updateSidebarUser();
    triggerAutoBackup();
  }

  export function permanentDeleteGoal(id) {
    showConfirm('Delete permanently?', 'This goal will be gone forever and cannot be recovered.', async () => {
      await Storage.permanentlyDeleteGoal(id);
      showToast('Goal permanently deleted.', 'info');
      await renderDeletedGoals();
      triggerAutoBackup();
    });
  }

  export function showDeletedGoalDetail(g) {
    const modal   = document.getElementById('dg-detail-modal');
    const body    = document.getElementById('dg-detail-body');
    if (!modal || !body) return;

    setEl('dg-detail-title', g.title);

    const typeLabels     = { time: '⏳ Study Hours', checklist: '📋 Task List', count: '🏆 Problem Count', exam: '🎓 Exam Prep' };
    const priorityLabels = { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' };
    const statusLabels   = { active: 'Open', completed: 'Completed', archived: 'Archived' };

    // Progress section — use frozen snapshot for completed/archived goals, else compute live
    const snap = g.progressSnapshot || Analytics.goalProgress(g, state.entries);
    let progressHtml = '';
    if (g.type === 'time') {
      const currentH = snap.current / 60;
      const targetH  = snap.target  / 60;
      const pct      = snap.pct;
      progressHtml = `
        <div class="dg-detail-section">
          <div class="dg-detail-section-title">Progress</div>
          <div class="goal-prog-bar-wrap">
            <div class="goal-prog-bar"><div class="goal-prog-fill" style="width:${pct}%"></div></div>
            <span class="goal-prog-label">${currentH.toFixed(1)}h / ${targetH.toFixed(1)}h (${pct}%)</span>
          </div>
        </div>`;
    } else if (g.type === 'count') {
      const cur = snap.current;
      const tar = snap.target;
      const pct = snap.pct;
      progressHtml = `
        <div class="dg-detail-section">
          <div class="dg-detail-section-title">Progress</div>
          <div class="goal-prog-bar-wrap">
            <div class="goal-prog-bar"><div class="goal-prog-fill" style="width:${pct}%"></div></div>
            <span class="goal-prog-label">${cur} / ${tar} (${pct}%)</span>
          </div>
        </div>`;
    } else if (g.type === 'checklist' && g.milestones?.length) {
      const done  = g.milestones.filter(m => m.done).length;
      const total = g.milestones.length;
      const pct   = total > 0 ? Math.floor((done / total) * 100) : 0;
      progressHtml = `
        <div class="dg-detail-section">
          <div class="dg-detail-section-title">Milestones (${done}/${total} · ${pct}%)</div>
          <div class="dg-detail-milestones">
            ${g.milestones.map(m => `
              <div class="dg-detail-ms-row">
                <span class="dg-detail-ms-check">${m.done ? '✅' : '⬜'}</span>
                <span class="dg-detail-ms-label ${m.done ? 'dg-ms-done' : ''}">${escapeHtml(m.label)}</span>
              </div>`).join('')}
          </div>
        </div>`;
    } else if (g.type === 'exam') {
      progressHtml = g.targetDate ? `
        <div class="dg-detail-section">
          <div class="dg-detail-section-title">Exam Date</div>
          <span class="dg-detail-value">${new Date(g.targetDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>` : '';
    }

    // Dates section
    const fmt = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const datesRows = [
      g.startDate  ? `<div class="dg-detail-date-row"><span>Started</span><span>${new Date(g.startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>` : '',
      g.targetDate && g.type !== 'exam' ? `<div class="dg-detail-date-row"><span>Target date</span><span>${new Date(g.targetDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>` : '',
      g.completedAt ? `<div class="dg-detail-date-row"><span>Completed</span><span>${fmt(g.completedAt)}</span></div>` : '',
      `<div class="dg-detail-date-row dg-date-deleted"><span>Deleted</span><span>${fmt(g.deletedAt)}</span></div>`,
    ].filter(Boolean).join('');

    body.innerHTML = `
      <div class="dg-detail-chips">
        <span class="goal-type-chip" data-type="${g.type}">${typeLabels[g.type] || g.type}</span>
        ${g.category ? `<span class="goal-cat-chip">${escapeHtml(g.category)}</span>` : ''}
        <span class="goal-priority-chip goal-priority-${g.priority}">${priorityLabels[g.priority] || ''}</span>
        <span class="goal-status-chip goal-status-chip-${g.status === 'completed' ? 'completed' : g.status === 'archived' ? 'archived' : 'open'}">${statusLabels[g.status] || g.status}</span>
      </div>
      ${g.description ? `<p class="dg-detail-desc">${linkifyNotes(g.description)}</p>` : ''}
      ${progressHtml}
      ${datesRows ? `<div class="dg-detail-section"><div class="dg-detail-section-title">Dates</div><div class="dg-detail-dates">${datesRows}</div></div>` : ''}
    `;

    // Footer action buttons wiring
    document.getElementById('dg-detail-restore').onclick = async () => {
      closeDeletedGoalDetail();
      await restoreDeletedGoal(g.id);
    };
    document.getElementById('dg-detail-perm-delete').onclick = () => {
      closeDeletedGoalDetail();
      permanentDeleteGoal(g.id);
    };
    document.getElementById('dg-detail-close').onclick     = closeDeletedGoalDetail;
    document.getElementById('dg-detail-close-btn').onclick = closeDeletedGoalDetail;
    modal.onclick = e => { if (e.target === modal) closeDeletedGoalDetail(); };

    modal.style.display = 'flex';
    _openModal(modal);
    setTimeout(() => modal.querySelector('.modal')?.focus?.(), 0);
  }

  export function closeDeletedGoalDetail() {
    const modal = document.getElementById('dg-detail-modal');
    if (!modal) return;
    _closeModal(modal);
    modal.style.display = 'none';
  }

  export function setupDeletedGoalsPage() {
    const search = document.getElementById('dg-search');
    if (!search || search.dataset.wired) return;
    search.dataset.wired = '1';

    document.getElementById('dg-filter-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('dg-filter-panel');
      if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('dg-filter-clear')?.addEventListener('click', () => {
      ['dg-filter-category', 'dg-filter-type'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const sort = document.getElementById('dg-filter-sort');
      if (sort) sort.value = 'deleted-newest';
      search.value = '';
      updateDgFilterToggleState();
      renderDeletedGoals();
    });

    const _dgRender = debounce(() => { updateDgFilterToggleState(); renderDeletedGoals(); }, 150);
    ['dg-search', 'dg-filter-category', 'dg-filter-type', 'dg-filter-sort'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => { updateDgFilterToggleState(); renderDeletedGoals(); });
      if (el.tagName === 'INPUT') {
        el.addEventListener('input', _dgRender);
      }
    });

    document.getElementById('dg-select-all')?.addEventListener('change', e => {
      const checked = e.target.checked;
      document.querySelectorAll('.dg-checkbox').forEach(cb => {
        cb.checked = checked;
        checked ? state.deletedGoalsSelection.add(cb.dataset.id) : state.deletedGoalsSelection.delete(cb.dataset.id);
      });
      updateDgBulkBar();
    });

    document.getElementById('dg-clear-selection-btn')?.addEventListener('click', () => {
      state.deletedGoalsSelection.clear();
      document.querySelectorAll('.dg-checkbox').forEach(cb => { cb.checked = false; });
      const all = document.getElementById('dg-select-all');
      if (all) { all.checked = false; all.indeterminate = false; }
      updateDgBulkBar();
    });

    document.getElementById('dg-bulk-delete-btn')?.addEventListener('click', () => {
      if (!state.deletedGoalsSelection.size) return;
      const n = state.deletedGoalsSelection.size;
      showConfirm(
        `Permanently delete ${n} ${n === 1 ? 'goal' : 'goals'}?`,
        'This cannot be undone.',
        async () => {
          await Promise.all([...state.deletedGoalsSelection].map(id => Storage.permanentlyDeleteGoal(id)));
          state.deletedGoalsSelection.clear();
          showToast(`${n} ${n === 1 ? 'goal' : 'goals'} permanently deleted`, 'info');
          await renderDeletedGoals();
          triggerAutoBackup();
        }
      );
    });

    document.getElementById('dg-bulk-restore-btn')?.addEventListener('click', async () => {
      if (!state.deletedGoalsSelection.size) return;
      const ids = [...state.deletedGoalsSelection];
      await Promise.all(ids.map(id => Storage.restoreGoal(id)));
      for (const id of ids) {
        const restored = await Storage.getGoal(id);
        if (restored) {
          const idx = state.goals.findIndex(g => g.id === id);
          if (idx >= 0) state.goals[idx] = restored; else state.goals.unshift(restored);
        }
      }
      state.deletedGoalsSelection.clear();
      await checkAchievements();
      showToast(`${ids.length} ${ids.length === 1 ? 'goal' : 'goals'} restored`, 'success');
      await renderDeletedGoals();
      updateSidebarUser();
      triggerAutoBackup();
    });
  }
