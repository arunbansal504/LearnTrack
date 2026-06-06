/* ===== log.js — extracted from app.js ===== */
import { state, debounce } from './state.js';
import { checkAchievements, closeBadgeModal } from './achievements.js';
import { triggerAutoBackup } from './core.js';
import { _setExpandToggleContent, closeDeletedEntryDetail, closeTopicsModal } from './deleted-logs.js';
import { _persistGoalAndRefresh, closeDeletedGoalDetail, openLinkGoalModal, reopenLinkModalFromGoal, reopenLinkedGoalsModal } from './goals.js';
import { navigateTo, renderPage, updateFilterToggleState, updateSidebarUser } from './nav.js';
import { populateCategorySelects } from './settings.js';
import { _closeModal, _openModal, capitalise, closeConfirmModal, createEmptyState, escapeHtml, linkifyNotes, safeHref, setActiveMood, showConfirm, showToast } from './utils.js';

  /* ---- LOG PAGE ------------------------------------ */

  export function renderLog() {
    populateCategorySelects();
    _renderLogGoalBreadcrumb();
    renderEntryList();
  }

  export function _renderLogGoalBreadcrumb() {
    const el = document.getElementById('log-goal-breadcrumb');
    if (!el) return;
    if (!state.logGoalContext) { el.innerHTML = ''; return; }
    const linkedHeader = state.logLinkedGoalFilter
      ? `<div class="log-goal-linked-header">
           <svg class="log-goal-linked-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
           <span>Entries Logged To Achieve Goal: <button type="button" class="log-goal-title-link" id="log-goal-title-btn">${escapeHtml(state.logGoalContext.title)}</button></span>
         </div>`
      : '';
    el.innerHTML = `
      <button type="button" class="log-goal-back-chip" id="log-goal-back-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back to your Goal: ${escapeHtml(state.logGoalContext.title)}
      </button>
      ${linkedHeader}`;
    const goToGoal = () => {
      const ctx = state.logGoalContext;
      state.logGoalContext = null;
      state.goalScrollTarget = ctx.id;
      navigateTo('goals');
    };
    document.getElementById('log-goal-back-btn')?.addEventListener('click', goToGoal);
    document.getElementById('log-goal-title-btn')?.addEventListener('click', goToGoal);
  }

  export function updateLogExpandToggle() {
    const btn = document.getElementById('log-expand-toggle');
    if (!btn) return;
    const groups = document.querySelectorAll('#entries-container .month-group');
    if (!groups.length) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    _setExpandToggleContent(btn, [...groups].every(g => !g.classList.contains('collapsed')));
  }

  export function renderEntryList(filter = {}) {
    const container  = document.getElementById('entries-container');
    const emptyState = document.getElementById('log-empty-state');
    if (!container) return;

    let filtered = applyFilters(state.entries, filter);

    const totalEl = document.getElementById('log-total-time');
    if (totalEl) {
      if (filtered.length > 0) {
        const totalMin = filtered.reduce((s, e) => s + (e.durationMinutes || 0), 0);
        totalEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span class="log-total-label">Total Learning Hours</span><span class="log-total-sep">·</span><span class="log-total-value">${Analytics.formatDuration(totalMin)}</span>`;
      } else {
        totalEl.innerHTML = '';
      }
    }

    if (filtered.length === 0) {
      container.innerHTML = '';
      container.appendChild(emptyState || createEmptyState());
      emptyState && (emptyState.style.display = 'flex');
      updateLogExpandToggle();
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    const currentMonth = Analytics.today().slice(0, 7);

    // Group by month
    const groups = {};
    filtered.forEach(e => {
      const key = e.date.slice(0, 7);
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });
    const sortedKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    const groupsHtml = sortedKeys.map(key => {
      const entries  = groups[key];
      const totalMin = entries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
      const count    = entries.length;
      const label    = new Date(key + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      const isCollapsed = key in state.monthCollapsedState
        ? state.monthCollapsedState[key]
        : key !== currentMonth;

      return `
        <div class="month-group${isCollapsed ? ' collapsed' : ''}" data-month="${key}">
          <div class="month-group-header">
            <div class="month-group-title-row">
              <span class="month-group-title">${label}</span>
              <span class="month-group-count">${count} ${count === 1 ? 'entry' : 'entries'}</span>
            </div>
            <div class="month-group-header-right">
              <span class="month-group-time">${Analytics.formatDuration(totalMin)}</span>
              <svg class="month-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
          <div class="month-group-body">
            ${entries.map(e => createEntryCard(e)).join('')}
          </div>
        </div>`;
    }).join('');

    container.innerHTML = groupsHtml;
    if (emptyState) container.appendChild(emptyState);

    // Toggle collapse
    container.querySelectorAll('.month-group-header').forEach(header => {
      header.addEventListener('click', () => {
        const group       = header.closest('.month-group');
        const key         = group.dataset.month;
        const wasCollapsed = group.classList.contains('collapsed');
        group.classList.toggle('collapsed');
        state.monthCollapsedState[key] = !wasCollapsed;
      });
    });

    // Bind card actions
    container.querySelectorAll('.entry-card [data-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        handleEntryAction(btn.dataset.action, btn.closest('.entry-card').dataset.id);
      });
    });

    // Notes link → open floating notes panel with full content from state.entries
    container.querySelectorAll('.entry-notes-link').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id    = btn.closest('.entry-card').dataset.id;
        const entry = state.entries.find(en => en.id === id);
        if (entry) openNotesPanel(entry.topic, entry.notes || '');
      });
    });

    // Resource links — stop propagation so they don't open the edit modal
    container.querySelectorAll('.entry-resource-link').forEach(a => {
      a.addEventListener('click', e => e.stopPropagation());
    });

    container.querySelectorAll('.entry-card').forEach(card => {
      card.addEventListener('click', e => {
        if (!e.target.closest('[data-action]')) {
          openEntryModal(card.dataset.id);
        }
      });
    });

    updateLogExpandToggle();
  }

  export function createEntryCard(entry) {
    const _activeGoalIdSet = new Set(state.goals.map(g => g.id));
    const linkCount = Array.isArray(entry.goalIds) ? entry.goalIds.filter(id => _activeGoalIdSet.has(id)).length : 0;
    const mood = ['','😞','😐','🙂','😊','🚀'][entry.moodScore || 3];
    const diffColors = { easy:'success', medium:'warning', hard:'danger' };
    const dc = diffColors[entry.difficulty] || 'text-2';
    const d  = new Date(entry.date + 'T12:00:00');

    // Fall back to timestamp encoded in id (format: "<ms>-<random>") if createdAt was lost on edit
    const createdTs = entry.createdAt || (entry.id ? parseInt(entry.id, 10) || 0 : 0);
    const loggedTime = createdTs
      ? new Date(createdTs).toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true,
        })
      : '';

    const resIcons = { link:'🔗', youtube:'▶️', course:'🎓', blog:'📰', github:'🐙', doc:'📄', pdf:'📋' };
    const resourceLinksHtml = (entry.resources || []).filter(r => r.url).map(r => {
      const icon  = resIcons[r.type] || '🔗';
      let   label = r.title || '';
      if (!label) {
        try { label = new URL(r.url).hostname.replace(/^www\./, ''); } catch { label = r.url; }
      }
      return `<a href="${escapeHtml(safeHref(r.url))}" target="_blank" rel="noopener noreferrer" class="entry-resource-link" title="${escapeHtml(r.url)}">${icon} ${escapeHtml(label)}</a>`;
    }).join('');

    const notesText = (entry.notes || '').trim();
    const notesHtml = notesText
      ? `<div class="entry-notes-preview entry-notes-link">${escapeHtml(notesText.length > 90 ? notesText.slice(0, 90) + '…' : notesText)}</div>`
      : '';

    return `
      <div class="entry-card" data-id="${entry.id}" data-difficulty="${entry.difficulty || 'easy'}" tabindex="0" role="article">
        <div class="entry-date-col">
          <div class="entry-date-day">${d.getDate()}</div>
          <div class="entry-date-mon">${d.toLocaleDateString('en-US',{month:'short'})}</div>
        </div>
        <div class="entry-content-col">
          <div class="entry-header">
            <div class="entry-topic">${escapeHtml(entry.topic)}</div>
            <span class="entry-category${!entry.category ? ' entry-category--none' : ''}">${escapeHtml(entry.category || 'Uncategorized')}</span>
          </div>
          <div class="entry-meta">
            <span class="entry-meta-item">
              <span class="difficulty-dot ${entry.difficulty}"></span>
              ${capitalise(entry.difficulty || 'easy')}
            </span>
            ${loggedTime ? `<span class="entry-meta-item"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="opacity:0.6"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${loggedTime}</span>` : ''}
          </div>
          ${notesHtml}
          ${resourceLinksHtml ? `<div class="entry-resource-links">${resourceLinksHtml}</div>` : ''}
          ${entry.tags && entry.tags.length ? `
            <div class="entry-tags">
              ${entry.tags.map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}
            </div>` : ''}
        </div>
        <div class="entry-actions-col">
          <span class="entry-duration-badge">${Analytics.formatDuration(entry.durationMinutes || 0)}</span>
          <span class="entry-mood-display">${mood}</span>
          <div class="entry-icon-actions">
            <button class="entry-link-icon-btn${linkCount ? ' has-links' : ''}" data-action="link-goal" aria-label="Link to goals" title="${linkCount ? `Linked to ${linkCount} goal${linkCount === 1 ? '' : 's'}` : 'Link to a goal'}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              ${linkCount ? `<span class="entry-link-count">${linkCount}</span>` : ''}
            </button>
            <button class="entry-edit-icon-btn" data-action="edit" aria-label="Edit entry" title="Edit">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="entry-duplicate-icon-btn" data-action="duplicate" aria-label="Duplicate entry" title="Duplicate">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="entry-delete-icon-btn" data-action="delete" aria-label="Delete entry" title="Delete">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  export function applyFilters(entries, filter = {}) {
    let list = [...entries];

    // "View logged entries" from a goal: restrict to entries explicitly linked to it.
    if (state.logLinkedGoalFilter) {
      list = list.filter(e => Array.isArray(e.goalIds) && e.goalIds.includes(state.logLinkedGoalFilter));
    }

    const search   = (document.getElementById('log-search')?.value || '').toLowerCase().trim();
    const dateFrom = document.getElementById('filter-date-from')?.value;
    const dateTo   = document.getElementById('filter-date-to')?.value;
    const category = document.getElementById('filter-category')?.value;
    const diff     = document.getElementById('filter-difficulty')?.value;
    const sort     = document.getElementById('filter-sort')?.value || 'newest';

    if (search) {
      list = list.filter(e =>
        e.topic?.toLowerCase().includes(search) ||
        e.notes?.toLowerCase().includes(search) ||
        e.category?.toLowerCase().includes(search) ||
        e.tags?.some(t => t.toLowerCase().includes(search))
      );
    }
    if (dateFrom) list = list.filter(e => e.date >= dateFrom);
    if (dateTo)   list = list.filter(e => e.date <= dateTo);
    if (category) list = list.filter(e => e.category === category);
    if (diff)     list = list.filter(e => e.difficulty === diff);

    const ts = e => e.createdAt || parseInt(e.id, 10) || 0;
    switch (sort) {
      case 'newest':
        list.sort((a, b) => b.date.localeCompare(a.date) || ts(b) - ts(a)); break;
      case 'oldest':
        list.sort((a, b) => a.date.localeCompare(b.date) || ts(a) - ts(b)); break;
      case 'duration-desc': list.sort((a, b) => (b.durationMinutes||0) - (a.durationMinutes||0)); break;
      case 'duration-asc':  list.sort((a, b) => (a.durationMinutes||0) - (b.durationMinutes||0)); break;
    }

    return list;
  }

  export function setupFilterPanel() {
    document.getElementById('filter-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('filter-panel');
      if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('filter-clear')?.addEventListener('click', () => {
      ['filter-date-from','filter-date-to','filter-category','filter-difficulty'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const sort = document.getElementById('filter-sort');
      if (sort) sort.value = 'newest';
      // Also drop the "linked to goal" view so the user sees all entries again.
      state.logLinkedGoalFilter = null;
      state.logGoalContext = null;
      _renderLogGoalBreadcrumb();
      updateFilterToggleState();
      renderEntryList();
    });

    const _logRender = debounce(() => { updateFilterToggleState(); renderEntryList(); }, 150);
    ['log-search','filter-date-from','filter-date-to','filter-category','filter-difficulty','filter-sort'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => { updateFilterToggleState(); renderEntryList(); });
      // Text inputs debounced; selects/date pickers fire change, so input is redundant for them
      if (el.tagName === 'INPUT' && el.type !== 'date') {
        el.addEventListener('input', _logRender);
      }
    });


    document.getElementById('add-entry-btn')?.addEventListener('click', () => openEntryModal());
    document.getElementById('quick-add-btn')?.addEventListener('click', () => openEntryModal());
    document.getElementById('log-empty-add-btn')?.addEventListener('click', () => openEntryModal());

    document.getElementById('log-expand-toggle')?.addEventListener('click', () => {
      const groups = document.querySelectorAll('#entries-container .month-group');
      const allExpanded = [...groups].every(g => !g.classList.contains('collapsed'));
      groups.forEach(g => {
        g.classList.toggle('collapsed', allExpanded);
        state.monthCollapsedState[g.dataset.month] = allExpanded;
      });
      updateLogExpandToggle();
    });
  }

  export function handleEntryAction(action, id) {
    if (action === 'edit')      openEntryModal(id);
    if (action === 'duplicate') duplicateEntry(id);
    if (action === 'delete')    confirmDeleteEntry(id);
    if (action === 'link-goal') openLinkGoalModal(id);
  }

  /* ---- Entry Modal --------------------------------- */

  export function setupEntryModal() {
    document.getElementById('modal-close')?.addEventListener('click', closeEntryModal);
    document.getElementById('modal-cancel')?.addEventListener('click', closeEntryModal);

    document.querySelectorAll('.dur-spin-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.field);
        if (!input) return;
        const dir  = parseInt(btn.dataset.dir, 10);
        const min  = parseInt(input.min, 10) || 0;
        const max  = parseInt(input.max, 10);
        const val  = parseInt(input.value, 10) || 0;
        const next = val + dir;
        if (next >= min && next <= max) input.value = next;
      });
    });

    // Limit hours to 2 digits, minutes to 4 digits
    const hoursInput = document.getElementById('entry-duration-hours');
    const minsInput  = document.getElementById('entry-duration-mins');
    if (hoursInput) hoursInput.addEventListener('input', function() {
      if (this.value.length > 2) this.value = this.value.slice(0, 2);
    });
    if (minsInput) minsInput.addEventListener('input', function() {
      if (this.value.length > 4) this.value = this.value.slice(0, 4);
    });

    // Entry modal only closes via X or Cancel — not by clicking the backdrop

    document.getElementById('entry-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      await saveEntryFromForm();
    });

    // Mood selector
    document.querySelectorAll('.mood-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setActiveMood(btn.dataset.mood);
        const moodInput = document.getElementById('entry-mood');
        if (moodInput) moodInput.value = btn.dataset.mood;
      });
    });

    // Add resource
    document.getElementById('add-resource-btn')?.addEventListener('click', addResourceRow);


    // Keyboard: Escape to close
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (_notesOverlay && _notesOverlay.classList.contains('visible')) {
          closeNotesPanel();
          return;
        }
        const modal = document.getElementById('entry-modal');
        if (modal && modal.style.display !== 'none') {
          closeEntryModal();
          e.stopImmediatePropagation(); // keep timer panel open behind the modal
          return;
        }
        const badge = document.getElementById('badge-modal');
        if (badge && badge.style.display !== 'none') closeBadgeModal();
        const confirm = document.getElementById('confirm-modal');
        if (confirm && confirm.style.display !== 'none') closeConfirmModal();
        const dlDetail = document.getElementById('dl-detail-modal');
        if (dlDetail && dlDetail.style.display !== 'none') closeDeletedEntryDetail();
        const dgDetail = document.getElementById('dg-detail-modal');
        if (dgDetail && dgDetail.style.display !== 'none') closeDeletedGoalDetail();
        const topicsModal = document.getElementById('topics-modal');
        if (topicsModal && topicsModal.style.display !== 'none') { closeTopicsModal(); return; }
        // Esc on a goal card reached via "View" in the link modal → back to "Link to Goals" (same as the back chip)
        if (state.currentPage === 'goals' && state.linkModalReturnEntryId) {
          reopenLinkModalFromGoal();
          return;
        }
        // Esc on a goal card reached via "View" in the deleted-log linked-goals modal → back to deleted logs + reopen modal
        if (state.currentPage === 'goals' && state.dlReturnEntry) {
          reopenLinkedGoalsModal();
          return;
        }
        // Esc on the Daily Log while a goal breadcrumb is shown → back to Goals (same as the back chip)
        if (state.currentPage === 'log' && state.logGoalContext) {
          const ctx = state.logGoalContext;
          state.logGoalContext = null;
          state.goalScrollTarget = ctx.id;
          navigateTo('goals');
        }
      }
    });
  }

  export function openEntryModal(id = null, prefillDate = null, prefill = null) {
    const modal   = document.getElementById('entry-modal');
    const form    = document.getElementById('entry-form');
    const title   = document.getElementById('modal-title');
    if (!modal || !form) return;

    form.reset();
    clearResourceRows();

    // Reset any lock left over from a previous "Log hours" open so normal adds/edits stay editable.
    document.getElementById('entry-topic').readOnly = false;
    document.getElementById('entry-category').disabled = false;

    const todayStr  = Analytics.today();
    const dateField = document.getElementById('entry-date');

    // New entry defaults: editable within the past year; if a specific date was
    // passed (e.g. from the calendar) lock it to that date instead.
    if (prefillDate) {
      dateField.value    = prefillDate;
      dateField.readOnly = true;
      dateField.removeAttribute('min');
      dateField.removeAttribute('max');
    } else {
      dateField.value    = todayStr;
      dateField.readOnly = false;
      dateField.min      = Analytics.daysAgo(365);
      dateField.max      = todayStr;
    }
    document.getElementById('entry-id').value = '';

    // Reset mood to 4
    setActiveMood('4');
    document.getElementById('entry-mood').value = '4';



    populateCategorySelects();

    if (id) {
      const entry = state.entries.find(e => e.id === id);
      if (!entry) return;

      title.textContent  = 'Edit Entry';
      // Date stays editable when editing, bounded to the last year and not future
      dateField.value    = entry.date;
      dateField.readOnly = false;
      dateField.min      = Analytics.daysAgo(365);
      dateField.max      = todayStr;
      document.getElementById('entry-id').value          = entry.id;
      document.getElementById('entry-topic').value       = entry.topic || '';
      document.getElementById('entry-category').value    = entry.category || '';
      const totalMin = entry.durationMinutes || 0;
      document.getElementById('entry-duration-hours').value    = Math.floor(totalMin / 60) || '';
      document.getElementById('entry-duration-mins').value     = totalMin % 60 || '';
      document.getElementById('entry-duration-hours').disabled = false;
      document.getElementById('entry-duration-mins').disabled  = false;
      document.getElementById('entry-difficulty').value  = entry.difficulty || 'medium';
      document.getElementById('entry-notes').value       = entry.notes || '';
      document.getElementById('entry-tags').value        = (entry.tags || []).join(', ');

      // Mood
      setActiveMood(String(entry.moodScore || 4));
      document.getElementById('entry-mood').value = entry.moodScore || 4;

      // Resources
      (entry.resources || []).forEach(r => addResourceRow(null, r));

    } else {
      title.textContent = 'New Learning Entry';
      document.getElementById('entry-duration-hours').disabled = false;
      document.getElementById('entry-duration-mins').disabled  = false;

      if (prefill) {
        const topicEl = document.getElementById('entry-topic');
        const catEl   = document.getElementById('entry-category');
        if (prefill.topic != null)    topicEl.value = prefill.topic;
        if (prefill.category != null) catEl.value   = prefill.category;
        if (prefill.lock) {
          topicEl.readOnly = true;
          catEl.disabled   = true;
          title.textContent = 'Log Study Hours';
        }
        // "Log Entry" from a goal card: blank, fully-editable form auto-linked to the goal on save.
        if (prefill.goalForTitle) {
          title.textContent = `Log Entry for Goal: ${prefill.goalForTitle}`;
        }
      }
    }

    modal.style.display = 'flex';
    _openModal(modal);
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      // When topic/category are locked, jump straight to duration so the user can type hours.
      const focusId = prefill?.lock ? 'entry-duration-hours' : 'entry-topic';
      document.getElementById(focusId)?.focus();
    }, 100);
  }

  export function closeEntryModal() {
    const modal = document.getElementById('entry-modal');
    // Skip focus return when re-showing the log-prompt modal — that modal takes over focus.
    _closeModal(modal, !!state.pendingCompleteGoalId);
    modal.style.display = 'none';
    // Drop any pending goal auto-link so a later normal "Add entry" isn't silently linked.
    state.pendingEntryGoalId = null;
    // Drop any pending timer reset so cancelling never wipes the timer; the save
    // path captures it before calling here, so a real save still resets the timer.
    state.pendingTimerReset = null;
    // If the entry modal was opened from the "log before complete" prompt and the user
    // cancelled (save clears state.pendingCompleteGoalId before calling here), re-show the prompt.
    if (state.pendingCompleteGoalId) {
      document.getElementById('log-prompt-modal').style.display = 'flex';
    } else {
      document.body.style.overflow = '';
    }
  }

  /* ---- Floating Notes Panel ------------------------ */

  export let _notesOverlay = null;

  export function openNotesPanel(topic, notes) {
    if (!_notesOverlay) {
      _notesOverlay = document.createElement('div');
      _notesOverlay.id = 'notes-float-overlay';
      _notesOverlay.innerHTML = `
        <div id="notes-float-panel" role="dialog" aria-modal="true" aria-labelledby="notes-panel-title">
          <div class="notes-panel-header">
            <div class="notes-panel-title-row">
              <span class="notes-panel-icon">📝</span>
              <span class="notes-panel-title" id="notes-panel-title"></span>
            </div>
            <button class="notes-panel-close" id="notes-panel-close" aria-label="Close notes">✕</button>
          </div>
          <div class="notes-panel-body" id="notes-panel-body"></div>
        </div>
      `;
      document.body.appendChild(_notesOverlay);

      document.getElementById('notes-panel-close').addEventListener('click', closeNotesPanel);
      // Close on backdrop click (clicking overlay but not the panel itself)
      _notesOverlay.addEventListener('click', e => {
        if (e.target === _notesOverlay) closeNotesPanel();
      });
    }

    document.getElementById('notes-panel-title').textContent = topic;

    // Build body content — preserve line breaks and make any URLs clickable.
    // linkifyNotes escapes all text and routes hrefs through safeHref.
    const bodyEl = document.getElementById('notes-panel-body');
    bodyEl.innerHTML = linkifyNotes(notes);

    _notesOverlay.classList.add('visible');
  }

  export function closeNotesPanel() {
    if (_notesOverlay) _notesOverlay.classList.remove('visible');
  }

  export async function saveEntryFromForm() {
    const id   = document.getElementById('entry-id').value;
    // Read the date from the form field; for edits fall back to the stored date
    // if the field was cleared, and finally to today as a last resort.
    const date = document.getElementById('entry-date').value
      || (id ? state.entries.find(e => e.id === id)?.date : null)
      || Analytics.today();

    const topic    = document.getElementById('entry-topic').value.trim();
    const category = document.getElementById('entry-category').value;
    const durationHours = parseInt(document.getElementById('entry-duration-hours').value, 10) || 0;
    const durationMins  = parseInt(document.getElementById('entry-duration-mins').value,  10) || 0;
    const duration = durationHours * 60 + durationMins;
    const diff     = document.getElementById('entry-difficulty').value;
    const notes    = document.getElementById('entry-notes').value.trim();
    const tags     = document.getElementById('entry-tags').value
                       .split(',').map(t => t.trim()).filter(Boolean);
    const mood     = parseInt(document.getElementById('entry-mood').value, 10) || 4;

    // Clear previous validation state
    ['entry-topic', 'entry-date', 'entry-duration-hours', 'entry-duration-mins'].forEach(fid => {
      document.getElementById(fid)?.removeAttribute('aria-invalid');
    });
    ['entry-topic-err', 'entry-date-err', 'entry-duration-err'].forEach(eid => {
      const el = document.getElementById(eid); if (el) el.textContent = '';
    });

    if (!topic) {
      const fld = document.getElementById('entry-topic');
      fld?.setAttribute('aria-invalid', 'true');
      const err = document.getElementById('entry-topic-err'); if (err) err.textContent = 'Topic is required.';
      showToast('Please enter a topic.', 'warning');
      fld?.focus();
      return;
    }

    if (!document.getElementById('entry-date').value) {
      const fld = document.getElementById('entry-date');
      fld?.setAttribute('aria-invalid', 'true');
      const err = document.getElementById('entry-date-err'); if (err) err.textContent = 'Please select a date.';
      showToast('Please select a date.', 'warning');
      fld?.focus();
      return;
    }

    if (date > Analytics.today()) {
      showToast('Cannot log entries for future dates.', 'warning');
      return;
    }

    if (!duration || duration < 1) {
      ['entry-duration-hours', 'entry-duration-mins'].forEach(fid => {
        document.getElementById(fid)?.setAttribute('aria-invalid', 'true');
      });
      const err = document.getElementById('entry-duration-err'); if (err) err.textContent = 'Please enter a valid duration (hours and/or minutes).';
      showToast('Please enter a valid duration.', 'warning');
      document.getElementById('entry-duration-hours')?.focus();
      return;
    }

    // Enforce 24-hour daily cap (1440 min), excluding the entry being edited
    const alreadyLoggedMin = state.entries
      .filter(e => e.date === date && e.id !== id)
      .reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
    if (alreadyLoggedMin + duration > 1440) {
      const remaining = 1440 - alreadyLoggedMin;
      showToast(
        remaining > 0
          ? `Daily limit reached. Only ${Analytics.formatDuration(remaining)} remaining for this date.`
          : `You've already logged 24 hours on ${date}. No more entries allowed for this day.`,
        'warning'
      );
      return;
    }

    // Collect resources
    const resources = [];
    document.querySelectorAll('.resource-row').forEach(row => {
      const type  = row.querySelector('.res-type')?.value;
      const title = row.querySelector('.res-title')?.value.trim();
      const url   = row.querySelector('.res-url')?.value.trim();
      if (url) resources.push({ type: type || 'link', title: title || url, url });
    });

    const isNew = !id;
    const existing = id ? state.entries.find(e => e.id === id) : null;
    const entry = {
      id:              id || undefined,
      date,
      topic,
      category,
      durationMinutes: duration,
      difficulty:      diff,
      notes,
      resources,
      tags,
      moodScore:       mood,
      ...(existing?.createdAt ? { createdAt: existing.createdAt } : {}),
      // Preserve existing goal links on edit; auto-link a new entry created from a goal card.
      ...(existing?.goalIds ? { goalIds: existing.goalIds }
         : state.pendingEntryGoalId ? { goalIds: [state.pendingEntryGoalId] } : {}),
    };

    const saved = await Storage.saveEntry(entry);

    // Update in-memory
    if (isNew) {
      state.entries.unshift(saved);
    } else {
      const idx = state.entries.findIndex(e => e.id === saved.id);
      if (idx >= 0) state.entries[idx] = saved;
    }

    // If this entry was saved as part of the "log before complete" prompt, complete the goal now.
    const completeGoalId = isNew ? state.pendingCompleteGoalId : null;
    state.pendingCompleteGoalId = null;

    const doTimerReset = state.pendingTimerReset;
    closeEntryModal();
    showToast(isNew ? 'Entry saved!' : 'Entry updated!', 'success');
    if (doTimerReset) doTimerReset();

    if (completeGoalId) {
      const goal = state.goals.find(g => g.id === completeGoalId);
      if (goal && goal.status === 'active') {
        const prog = Analytics.goalProgress(goal, state.entries);
        goal.status = 'completed';
        goal.completedAt = Date.now();
        goal.progressSnapshot = prog;
        await _persistGoalAndRefresh(goal);
        showToast('🎉 Goal completed!', 'success');
        await checkAchievements();
      }
    }

    // Show XP float only for new entries (edits adjust existing XP, not a new gain)
    if (isNew) {
      const xp = Rewards.calculateEntryXP(saved);
      Rewards.showXPFloat(xp, document.getElementById('quick-add-btn'));
    }

    // Check achievements
    await checkAchievements();

    // On mobile, redirect to Daily Log after a new entry so the user sees it immediately
    if (isNew && window.innerWidth <= 768) {
      navigateTo('log');
    } else {
      renderPage(state.currentPage);
    }
    updateSidebarUser();
    triggerAutoBackup();
  }

  /* ---- Resource Rows ------------------------------- */

  export function addResourceRow(e, prefill = null) {
    if (e) e.preventDefault();
    const list = document.getElementById('resources-list');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'resource-row';
    row.innerHTML = `
      <input type="hidden" class="res-type" value="link" />
      <input type="text" class="res-title" placeholder="Title (optional)" />
      <input type="url" class="res-url" placeholder="https://..." />
      <button type="button" class="resource-remove" aria-label="Remove resource">✕</button>
    `;

    if (prefill) {
      row.querySelector('.res-title').value = prefill.title || '';
      row.querySelector('.res-url').value   = prefill.url   || '';
    }

    row.querySelector('.resource-remove')?.addEventListener('click', () => row.remove());

    const warning = document.getElementById('resource-url-warning');
    if (list.children.length === 0 && warning) warning.style.display = 'flex';
    if (warning) setTimeout(() => warning.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);

    list.appendChild(row);
  }

  export function clearResourceRows() {
    const list = document.getElementById('resources-list');
    if (list) list.innerHTML = '';
    const warning = document.getElementById('resource-url-warning');
    if (warning) warning.style.display = 'none';
  }

  /* ---- Delete / Duplicate -------------------------- */

  export function confirmDeleteEntry(id) {
    showConfirm('Delete this entry?', 'It will move to Deleted Logs where you can restore it.', async () => {
      await Storage.softDeleteEntry(id);
      state.entries = state.entries.filter(e => e.id !== id);
      await checkAchievements();
      showToast('Entry moved to Deleted Logs', 'info');
      renderPage(state.currentPage);
      updateSidebarUser();
      triggerAutoBackup();
    });
  }

  export async function duplicateEntry(id) {
    const entry = state.entries.find(e => e.id === id);
    if (!entry) return;
    openEntryModal(null);
    setTimeout(() => {
      document.getElementById('entry-topic').value      = entry.topic;
      document.getElementById('entry-category').value   = entry.category || '';
      document.getElementById('entry-duration-hours').value = '';
      document.getElementById('entry-duration-mins').value  = '';
      document.getElementById('entry-difficulty').value = entry.difficulty || 'medium';
      document.getElementById('entry-notes').value      = entry.notes || '';
      document.getElementById('entry-tags').value       = (entry.tags || []).join(', ');
      document.querySelector(`.mood-btn[data-mood="${entry.moodScore || 4}"]`)?.click();
      (entry.resources || []).forEach(r => addResourceRow(null, r));
    }, 50);
  }
