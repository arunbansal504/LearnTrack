/* ===== deleted-logs.js — extracted from app.js ===== */
import { state, LOG_PAGE_SIZE, debounce } from './state.js';
import { checkAchievements } from './achievements.js';
import { triggerAutoBackup } from './core.js';
import { showLinkedGoalsPopover } from './goals.js';
import { updateDlFilterToggleState, updateSidebarUser } from './nav.js';
import { getCategoryColor, populateCategorySelects } from './settings.js';
import { _closeModal, _openModal, capitalise, escapeHtml, linkifyNotes, safeHref, showConfirm, showToast } from './utils.js';

  /* ---- DELETED LOGS PAGE --------------------------- */

  export function setupDeletedLogsPage() {
    document.getElementById('dl-filter-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('dl-filter-panel');
      if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('dl-expand-toggle')?.addEventListener('click', () => {
      const groups = document.querySelectorAll('#dl-entries-container .month-group');
      const allExpanded = [...groups].every(g => !g.classList.contains('collapsed'));
      groups.forEach(g => {
        g.classList.toggle('collapsed', allExpanded);
        state.dlMonthCollapsedState[g.dataset.month] = allExpanded;
      });
      updateDlExpandToggle();
    });

    document.getElementById('dl-filter-clear')?.addEventListener('click', () => {
      ['dl-filter-date-from','dl-filter-date-to','dl-filter-category','dl-filter-difficulty'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const sort = document.getElementById('dl-filter-sort');
      if (sort) sort.value = 'deleted-newest';
      updateDlFilterToggleState();
      state.deletedPage = 1;
      renderDeletedLogs();
    });

    const _dlRender = debounce(() => { state.deletedPage = 1; updateDlFilterToggleState(); renderDeletedLogs(); }, 150);
    ['dl-search','dl-filter-date-from','dl-filter-date-to','dl-filter-category','dl-filter-difficulty','dl-filter-sort'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => { state.deletedPage = 1; updateDlFilterToggleState(); renderDeletedLogs(); });
      if (el.tagName === 'INPUT' && el.type !== 'date') {
        el.addEventListener('input', _dlRender);
      }
    });

    document.getElementById('dl-load-more-btn')?.addEventListener('click', () => {
      state.deletedPage++;
      renderDeletedLogs();
    });

    document.getElementById('dl-select-all')?.addEventListener('change', e => {
      const checked = e.target.checked;
      document.querySelectorAll('.dl-checkbox').forEach(cb => {
        cb.checked = checked;
        checked ? state.deletedSelection.add(cb.dataset.id) : state.deletedSelection.delete(cb.dataset.id);
      });
      updateDlBulkBar();
    });

    document.getElementById('dl-clear-selection-btn')?.addEventListener('click', () => {
      state.deletedSelection.clear();
      document.querySelectorAll('.dl-checkbox').forEach(cb => { cb.checked = false; });
      const all = document.getElementById('dl-select-all');
      if (all) all.checked = false;
      updateDlBulkBar();
    });

    document.getElementById('dl-bulk-delete-btn')?.addEventListener('click', () => {
      if (!state.deletedSelection.size) return;
      const n = state.deletedSelection.size;
      showConfirm(
        `Permanently delete ${n} ${n === 1 ? 'entry' : 'entries'}?`,
        'This cannot be undone.',
        async () => {
          await Promise.all([...state.deletedSelection].map(id => Storage.permanentlyDeleteEntry(id)));
          state.deletedSelection.clear();
          showToast(`${n} ${n === 1 ? 'entry' : 'entries'} permanently deleted`, 'info');
          state.deletedPage = 1;
          await renderDeletedLogs();
          triggerAutoBackup();
        }
      );
    });

    document.getElementById('dl-bulk-restore-btn')?.addEventListener('click', async () => {
      if (!state.deletedSelection.size) return;
      const ids = [...state.deletedSelection];
      await Promise.all(ids.map(id => Storage.restoreEntry(id)));
      for (const id of ids) {
        const restored = await Storage.getEntry(id);
        if (restored) state.entries.push(restored);
      }
      state.entries.sort((a, b) => new Date(b.date) - new Date(a.date));
      state.deletedSelection.clear();
      await checkAchievements();
      showToast(`${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} restored to Daily Log`, 'success');
      state.deletedPage = 1;
      await renderDeletedLogs();
      updateSidebarUser();
      triggerAutoBackup();
    });
  }

  export function updateDlBulkBar() {
    const selBar   = document.getElementById('dl-selection-bar');
    const bulkActs = document.getElementById('dl-bulk-actions');
    const label    = document.getElementById('dl-selection-label');
    const allCheck = document.getElementById('dl-select-all');
    const allCbs   = document.querySelectorAll('.dl-checkbox');
    const total    = allCbs.length;
    const n        = state.deletedSelection.size;

    // Show selection bar only when entries are rendered
    if (selBar) selBar.style.display = total > 0 ? 'flex' : 'none';

    // Top-level select-all state
    if (allCheck) {
      allCheck.indeterminate = n > 0 && n < total;
      allCheck.checked = total > 0 && n === total;
    }

    // Label: "Select all (N)" when nothing selected, "N of M selected" otherwise
    if (label) label.textContent = n === 0 ? `Select all (${total})` : `${n} of ${total} selected`;

    // Bulk action buttons: only when something is selected
    if (bulkActs) bulkActs.style.display = n > 0 ? 'flex' : 'none';

    // Sync selected visual state on cards
    document.querySelectorAll('.dl-entry-card').forEach(card => {
      card.classList.toggle('dl-selected', state.deletedSelection.has(card.dataset.id));
    });

    // Month-level checkbox states
    document.querySelectorAll('.dl-month-checkbox').forEach(mcb => {
      const monthCbs  = document.querySelectorAll(`.dl-checkbox[data-month-key="${mcb.dataset.month}"]`);
      const selCount  = [...monthCbs].filter(cb => state.deletedSelection.has(cb.dataset.id)).length;
      mcb.indeterminate = selCount > 0 && selCount < monthCbs.length;
      mcb.checked = monthCbs.length > 0 && selCount === monthCbs.length;
    });
  }

  export function applyDeletedFilters(entries) {
    let list = [...entries];

    const search   = (document.getElementById('dl-search')?.value || '').toLowerCase().trim();
    const dateFrom = document.getElementById('dl-filter-date-from')?.value;
    const dateTo   = document.getElementById('dl-filter-date-to')?.value;
    const category = document.getElementById('dl-filter-category')?.value;
    const diff     = document.getElementById('dl-filter-difficulty')?.value;
    const sort     = document.getElementById('dl-filter-sort')?.value || 'deleted-newest';

    if (search)   list = list.filter(e =>
      e.topic?.toLowerCase().includes(search) ||
      e.notes?.toLowerCase().includes(search) ||
      e.category?.toLowerCase().includes(search) ||
      e.tags?.some(t => t.toLowerCase().includes(search))
    );
    if (dateFrom) list = list.filter(e => e.date >= dateFrom);
    if (dateTo)   list = list.filter(e => e.date <= dateTo);
    if (category) list = list.filter(e => e.category === category);
    if (diff)     list = list.filter(e => e.difficulty === diff);

    switch (sort) {
      case 'deleted-newest':  list.sort((a, b) => b.deletedAt - a.deletedAt); break;
      case 'deleted-oldest':  list.sort((a, b) => a.deletedAt - b.deletedAt); break;
      case 'newest':          list.sort((a, b) => b.date.localeCompare(a.date)); break;
      case 'oldest':          list.sort((a, b) => a.date.localeCompare(b.date)); break;
      case 'duration-desc':   list.sort((a, b) => (b.durationMinutes||0) - (a.durationMinutes||0)); break;
      case 'duration-asc':    list.sort((a, b) => (a.durationMinutes||0) - (b.durationMinutes||0)); break;
    }
    return list;
  }

  export function applyDeletedGoalFilters(goals) {
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

  export function createDeletedEntryCard(entry) {
    const linkTitles = Array.isArray(entry.goalIds)
      ? entry.goalIds.map(id => { const g = state.goals.find(x => x.id === id); return g ? g.title : null; }).filter(Boolean)
      : [];
    const linkCount = linkTitles.length;
    const mood  = ['','😞','😐','🙂','😊','🚀'][entry.moodScore || 3];
    const d     = new Date(entry.date + 'T12:00:00');
    const diffMin = Math.floor((Date.now() - entry.deletedAt) / 60000);
    const diffHr  = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    const deletedAgo = diffDay > 0  ? `${diffDay}d ago`
                     : diffHr  > 0  ? `${diffHr}h ago`
                     : diffMin > 0  ? `${diffMin}m ago`
                     : 'just now';
    const deletedFull = new Date(entry.deletedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      + ' · ' + new Date(entry.deletedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    const checked  = state.deletedSelection.has(entry.id) ? 'checked' : '';
    const selClass = state.deletedSelection.has(entry.id) ? ' dl-selected' : '';
    const notesText = (entry.notes || '').trim();

    return `
      <div class="dl-entry-card${selClass}" data-id="${entry.id}" tabindex="0" role="article">
        <div class="dl-card-checkbox">
          <label style="display:flex;align-items:center;cursor:pointer" onclick="event.stopPropagation()">
            <input type="checkbox" class="dl-checkbox" data-id="${entry.id}" data-month-key="${entry.date.slice(0,7)}" ${checked}
              style="width:15px;height:15px;cursor:pointer;accent-color:var(--accent)" />
          </label>
        </div>
        <div class="dl-card-date">
          <div class="dl-card-date-day">${d.getDate()}</div>
          <div class="dl-card-date-mon">${d.toLocaleDateString('en-US',{month:'short'})}</div>
        </div>
        <div class="dl-card-body">
          <div class="dl-card-header">
            <span class="dl-card-topic dl-topic-link" data-dl-view="${entry.id}" title="View details">${escapeHtml(entry.topic)}</span>
            <span class="entry-category${!entry.category ? ' entry-category--none' : ''}">${escapeHtml(entry.category || 'Uncategorized')}</span>
          </div>
          <div class="dl-card-meta">
            <span class="entry-meta-item"><span class="difficulty-dot ${entry.difficulty}"></span>${capitalise(entry.difficulty || 'easy')}</span>
            <span>${mood}</span>
            <span class="entry-duration-badge">${Analytics.formatDuration(entry.durationMinutes || 0)}</span>
          </div>
          ${notesText ? `<div class="entry-notes-preview">${escapeHtml(notesText.length > 90 ? notesText.slice(0,90) + '…' : notesText)}</div>` : ''}
          ${entry.tags && entry.tags.length ? `<div class="entry-tags">${entry.tags.map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="dl-card-actions">
          <div class="dl-deleted-badge" title="${deletedFull}">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            ${deletedAgo}
          </div>
          <div class="dl-action-row">
            ${linkCount ? `
            <button class="entry-link-icon-btn has-links dl-linked-goals-btn" data-id="${entry.id}" title="Linked to ${linkCount} goal${linkCount === 1 ? '' : 's'}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              <span class="entry-link-count">${linkCount}</span>
            </button>` : ''}
            <button class="dl-restore-btn" data-restore="${entry.id}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              Restore
            </button>
            <button class="dl-delete-icon-btn" data-perm-delete="${entry.id}" title="Delete permanently">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </button>
          </div>
        </div>
      </div>`;
  }

  export async function renderDeletedLogs() {
    const container    = document.getElementById('dl-entries-container');
    const loadMoreCon  = document.getElementById('dl-load-more-container');
    if (!container) return;

    populateCategorySelects();

    const allDeleted = await Storage.getDeletedEntries();
    const filtered   = applyDeletedFilters(allDeleted);
    const paginated  = filtered.slice(0, state.deletedPage * LOG_PAGE_SIZE);

    if (filtered.length === 0) {
      const isEmpty = allDeleted.length === 0;
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${isEmpty ? '🗑️' : '🔍'}</div>
          <h3>${isEmpty ? 'Recycle bin is empty' : 'No matching entries'}</h3>
          <p>${isEmpty ? 'Deleted entries will appear here.' : 'Try adjusting your search or filters.'}</p>
        </div>`;
      if (loadMoreCon) loadMoreCon.style.display = 'none';
      updateDlBulkBar();
      updateDlExpandToggle();
      return;
    }

    // Group by month
    const groups = {};
    paginated.forEach(e => {
      const key = e.date.slice(0, 7);
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });
    const sortedKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    container.innerHTML = sortedKeys.map(key => {
      const entries  = groups[key];
      const totalMin = entries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
      const count    = entries.length;
      const label    = new Date(key + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const isCollapsed = state.dlMonthCollapsedState[key] ?? false;

      return `
        <div class="month-group${isCollapsed ? ' collapsed' : ''}" data-month="${key}">
          <div class="month-group-header">
            <div style="display:flex;align-items:center;gap:var(--s-2);flex:1;min-width:0">
              <label style="display:flex;align-items:center;flex-shrink:0;cursor:pointer" onclick="event.stopPropagation()">
                <input type="checkbox" class="dl-month-checkbox" data-month="${key}" style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer" />
              </label>
              <div class="month-group-title-row">
                <span class="month-group-title">${label}</span>
                <span class="month-group-count">${count} ${count === 1 ? 'entry' : 'entries'}</span>
              </div>
            </div>
            <div class="month-group-header-right">
              <span class="month-group-time">${Analytics.formatDuration(totalMin)}</span>
              <svg class="month-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
          <div class="month-group-body">
            ${entries.map(e => createDeletedEntryCard(e)).join('')}
          </div>
        </div>`;
    }).join('');

    // Collapse toggle
    container.querySelectorAll('.month-group-header').forEach(header => {
      header.addEventListener('click', () => {
        const group = header.closest('.month-group');
        const wasCollapsed = group.classList.contains('collapsed');
        group.classList.toggle('collapsed');
        state.dlMonthCollapsedState[group.dataset.month] = !wasCollapsed;
        updateDlExpandToggle();
      });
    });

    // Month-level select all
    container.querySelectorAll('.dl-month-checkbox').forEach(mcb => {
      mcb.addEventListener('change', e => {
        e.stopPropagation();
        const monthCbs = container.querySelectorAll(`.dl-checkbox[data-month-key="${mcb.dataset.month}"]`);
        monthCbs.forEach(cb => {
          cb.checked = mcb.checked;
          mcb.checked ? state.deletedSelection.add(cb.dataset.id) : state.deletedSelection.delete(cb.dataset.id);
        });
        updateDlBulkBar();
      });
    });

    // Checkbox change
    container.querySelectorAll('.dl-checkbox').forEach(cb => {
      cb.addEventListener('change', e => {
        e.stopPropagation();
        cb.checked ? state.deletedSelection.add(cb.dataset.id) : state.deletedSelection.delete(cb.dataset.id);
        updateDlBulkBar();
      });
    });

    // View / Restore / permanent delete buttons
    container.querySelectorAll('[data-dl-view]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const entry = paginated.find(en => en.id === btn.dataset.dlView);
        if (entry) showDeletedEntryDetail(entry);
      });
    });
    container.querySelectorAll('[data-restore]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); restoreDeletedEntry(btn.dataset.restore); });
    });
    container.querySelectorAll('[data-perm-delete]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); permanentDeleteEntry(btn.dataset.permDelete); });
    });

    container.querySelectorAll('.dl-linked-goals-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const entry = paginated.find(en => en.id === btn.dataset.id);
        if (entry) showLinkedGoalsPopover(btn, entry);
      });
    });

    if (loadMoreCon) loadMoreCon.style.display = filtered.length > paginated.length ? 'flex' : 'none';
    updateDlBulkBar();
    updateDlExpandToggle();
  }

  export function updateDlExpandToggle() {
    const btn = document.getElementById('dl-expand-toggle');
    if (!btn) return;
    const groups = document.querySelectorAll('#dl-entries-container .month-group');
    if (!groups.length) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    _setExpandToggleContent(btn, [...groups].every(g => !g.classList.contains('collapsed')));
  }

  export function _setExpandToggleContent(btn, allExpanded) {
    const expandIcon   = `<polyline points="6 7 12 12 18 7"/><polyline points="6 13 12 18 18 13"/>`;
    const collapseIcon = `<polyline points="6 12 12 7 18 12"/><polyline points="6 18 12 13 18 18"/>`;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${allExpanded ? collapseIcon : expandIcon}</svg>${allExpanded ? 'Collapse All' : 'Expand All'}`;
  }

  export async function restoreDeletedEntry(id) {
    await Storage.restoreEntry(id);
    const restored = await Storage.getEntry(id);
    if (restored) state.entries.push(restored);
    state.entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    state.deletedSelection.delete(id);
    await checkAchievements();
    showToast('Entry restored to Daily Log', 'success');
    await renderDeletedLogs();
    updateSidebarUser();
    triggerAutoBackup();
  }

  export function permanentDeleteEntry(id) {
    showConfirm('Delete permanently?', 'This cannot be undone — the entry will be gone forever.', async () => {
      await Storage.permanentlyDeleteEntry(id);
      state.deletedSelection.delete(id);
      showToast('Entry permanently deleted', 'info');
      await renderDeletedLogs();
      triggerAutoBackup();
    });
  }

  export function showDeletedEntryDetail(e) {
    const modal = document.getElementById('dl-detail-modal');
    const body  = document.getElementById('dl-detail-body');
    if (!modal || !body) return;

    const d    = new Date(e.date + 'T12:00:00');
    const mood = ['', '😞 Very bad', '😐 Okay', '🙂 Good', '😊 Great', '🚀 Excellent'][e.moodScore || 3];
    const fmt  = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const deletedFull = new Date(e.deletedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      + ' · ' + new Date(e.deletedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    const difficultyColors = { easy: 'var(--success)', medium: 'var(--warning)', hard: 'var(--danger)' };

    body.innerHTML = `
      <div class="dl-detail-meta">
        <div class="dl-detail-date">${d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
        <div class="dl-detail-chips">
          <span class="entry-category${!e.category ? ' entry-category--none' : ''}">${escapeHtml(e.category || 'Uncategorized')}</span>
          <span class="difficulty-pill" style="color:${difficultyColors[e.difficulty] || 'inherit'}">${capitalise(e.difficulty || 'easy')}</span>
          <span class="dl-detail-duration">${Analytics.formatDuration(e.durationMinutes || 0)}</span>
          <span title="Mood">${mood}</span>
        </div>
      </div>

      <div class="dl-detail-section">
        <div class="dl-detail-section-title">Topic</div>
        <div class="dl-detail-value">${escapeHtml(e.topic)}</div>
      </div>

      ${e.notes ? `
      <div class="dl-detail-section">
        <div class="dl-detail-section-title">Notes</div>
        <div class="dl-detail-notes">${linkifyNotes(e.notes)}</div>
      </div>` : ''}

      ${e.resources && e.resources.length ? `
      <div class="dl-detail-section">
        <div class="dl-detail-section-title">Resources</div>
        <div class="dl-detail-resources">
          ${e.resources.map(r => `<a href="${escapeHtml(safeHref(r.url))}" target="_blank" rel="noopener noreferrer" class="dl-detail-resource-link">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            ${escapeHtml(r.label || r.url)}
          </a>`).join('')}
        </div>
      </div>` : ''}

      <div class="dl-detail-section">
        <div class="dl-detail-section-title">Timestamps</div>
        <div class="dg-detail-dates">
          <div class="dg-detail-date-row"><span>Created</span><span>${fmt(e.createdAt)}</span></div>
          ${e.updatedAt && e.updatedAt !== e.createdAt ? `<div class="dg-detail-date-row"><span>Last edited</span><span>${fmt(e.updatedAt)}</span></div>` : ''}
          <div class="dg-detail-date-row dg-date-deleted"><span>Deleted</span><span>${deletedFull}</span></div>
        </div>
      </div>
    `;

    document.getElementById('dl-detail-restore').onclick = async () => {
      closeDeletedEntryDetail();
      await restoreDeletedEntry(e.id);
    };
    document.getElementById('dl-detail-perm-delete').onclick = () => {
      closeDeletedEntryDetail();
      permanentDeleteEntry(e.id);
    };
    document.getElementById('dl-detail-close').onclick     = closeDeletedEntryDetail;
    document.getElementById('dl-detail-close-btn').onclick = closeDeletedEntryDetail;
    modal.onclick = ev => { if (ev.target === modal) closeDeletedEntryDetail(); };

    modal.style.display = 'flex';
    _openModal(modal);
  }

  export function closeDeletedEntryDetail() {
    const modal = document.getElementById('dl-detail-modal');
    if (!modal) return;
    _closeModal(modal);
    modal.style.display = 'none';
  }

  export function setupTopicsModal() {
    const close = closeTopicsModal;
    document.getElementById('topics-modal-close')?.addEventListener('click', close);
    document.getElementById('topics-modal-close-btn')?.addEventListener('click', close);
    const modal = document.getElementById('topics-modal');
    if (modal) modal.addEventListener('click', ev => { if (ev.target === modal) close(); });

    // Delegated trigger: the "Subjects Explored" insight card is rendered with
    // data-insight-action="topics" by Insights.renderInsightsRow.
    const row = document.getElementById('insights-row');
    if (row) {
      row.addEventListener('click', e => {
        if (e.target.closest('[data-insight-action="topics"]')) showTopicsModal();
      });
      row.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-insight-action="topics"]')) {
          e.preventDefault();
          showTopicsModal();
        }
      });
    }
  }

  export function showTopicsModal() {
    const modal = document.getElementById('topics-modal');
    const body  = document.getElementById('topics-modal-body');
    const title = document.getElementById('topics-modal-title');
    if (!modal || !body) return;

    // Match the "Subjects Explored" insight grouping exactly (no knownCategories filtering).
    const dist = Analytics.calculateTopicDistribution(state.entries);
    if (title) title.textContent = `Subjects Explored`;

    if (!dist.length) {
      body.innerHTML = '<p class="topics-modal-empty">No topics logged yet.</p>';
      modal.style.display = 'flex';
      return;
    }

    const totalMins = dist.reduce((s, t) => s + t.minutes, 0);
    const maxMins   = dist[0].minutes;   // already sorted desc

    const rows = dist.map((t, i) => {
      const barPct  = Math.round((t.minutes / maxMins) * 100);
      const rawPct  = totalMins > 0 ? (t.minutes / totalMins) * 100 : 0;
      const pct     = rawPct > 0 && rawPct < 1 ? '<1%' : `${Math.round(rawPct)}%`;
      const color     = getCategoryColor(t.label);
      const rankLabel = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1;
      return `<li class="topics-modal-item">
        <span class="topics-modal-rank" style="background:${color}22;color:${color}">${rankLabel}</span>
        <span class="topics-modal-name">${escapeHtml(t.label)}</span>
        <span class="topics-modal-bar-wrap">
          <span class="topics-modal-bar" style="width:${barPct}%;background:${color}"></span>
        </span>
        <span class="topics-modal-pct">${pct}</span>
        <span class="topics-modal-time">${escapeHtml(Analytics.formatDuration(t.minutes))}</span>
      </li>`;
    }).join('');

    body.innerHTML = `
      <div class="topics-modal-header-row">
        <span class="topics-modal-col-rank">#</span>
        <span class="topics-modal-col-name">Subject</span>
        <span class="topics-modal-col-bar"></span>
        <span class="topics-modal-col-pct">Share</span>
        <span class="topics-modal-col-time">Time</span>
      </div>
      <ul class="topics-modal-list">${rows}</ul>
      <div class="topics-modal-footer">
        <span>${dist.length} subject${dist.length !== 1 ? 's' : ''}</span>
        <span>${escapeHtml(Analytics.formatDuration(totalMins))} total</span>
      </div>`;

    modal.style.display = 'flex';
    _openModal(modal);
    document.body.style.overflow = 'hidden';
    // Focus the scrollable body so arrow keys scroll the list, not the page.
    requestAnimationFrame(() => body.focus());
  }

  export function closeTopicsModal() {
    const modal = document.getElementById('topics-modal');
    if (!modal) return;
    _closeModal(modal);
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
