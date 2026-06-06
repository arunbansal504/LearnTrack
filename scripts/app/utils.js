/* ===== utils.js — extracted from app.js ===== */
import { state } from './state.js';
import { openEntryModal } from './log.js';

  // Single global scroll-key trap for every modal in the app.
  // Intercepts ArrowUp/Down, PageUp/Down, Space, Home, End while any .modal-overlay is
  // visible and redirects them to that modal's .modal-body, preventing the page from
  // scrolling. Skips interception when focus is inside a textarea/select/input so normal
  // in-field cursor movement still works.
  export function setupModalScrollTrap() {
    const SCROLL_KEYS = {
      ArrowDown:  60, ArrowUp: -60,
      PageDown:  0.8, PageUp: -0.8,
      ' ':        0.8,
      Home:      -Infinity, End: Infinity,
    };
    document.addEventListener('keydown', e => {
      if (!(e.key in SCROLL_KEYS)) return;
      // Let the key work normally inside text-entry elements.
      const tag = document.activeElement?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      // Find the topmost open modal overlay (highest z-index wins via DOM order).
      const openModal = [...document.querySelectorAll('.modal-overlay')]
        .reverse()
        .find(m => m.style.display !== 'none');
      if (!openModal) return;
      const scrollEl = openModal.querySelector('.modal-body');
      if (!scrollEl) return;
      e.preventDefault();
      const v = SCROLL_KEYS[e.key];
      scrollEl.scrollBy({ top: Math.abs(v) <= 1 ? v * scrollEl.clientHeight : v, behavior: 'smooth' });
    });
  }

  /* ---- Confirm Modal ------------------------------- */

  export let _confirmCallback = null;

  export function showConfirm(title, message, onConfirm) {
    _confirmCallback = onConfirm;
    setEl('confirm-modal-title', title);
    setEl('confirm-modal-message', message);
    const confirmModal = document.getElementById('confirm-modal');
    confirmModal.style.display = 'flex';
    _openModal(confirmModal);

    const okBtn = document.getElementById('confirm-ok');
    okBtn.onclick = async () => {
      const cb = _confirmCallback; // capture before close clears it
      closeConfirmModal();
      if (cb) await cb();
    };

    document.getElementById('confirm-cancel').onclick = closeConfirmModal;
    setTimeout(() => okBtn.focus(), 0);
  }

  export function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    _closeModal(modal);
    modal.style.display = 'none';
    _confirmCallback = null;
  }

  /* ---- Accessible modal helpers -------------------- */
  // Stores { trigger, removeTrap } per modal element so each modal independently
  // traps Tab focus while open and returns focus to its trigger on close.
  export const _modalTriggers = new Map();

  export function _openModal(modal) {
    const trigger = document.activeElement;
    const SEL = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    function onTab(e) {
      if (e.key !== 'Tab') return;
      const els = [...modal.querySelectorAll(SEL)].filter(el => el.offsetParent !== null);
      if (!els.length) { e.preventDefault(); return; }
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    modal.addEventListener('keydown', onTab);
    _modalTriggers.set(modal, { trigger, removeTrap: () => modal.removeEventListener('keydown', onTab) });
  }

  export function _closeModal(modal, skipReturn = false) {
    const s = _modalTriggers.get(modal);
    if (!s) return;
    s.removeTrap();
    _modalTriggers.delete(modal);
    if (!skipReturn && s.trigger && typeof s.trigger.focus === 'function') {
      setTimeout(() => s.trigger.focus(), 0);
    }
  }

  /* ---- Toast Notifications ------------------------- */

  export function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
      <button class="toast-close" aria-label="Dismiss">✕</button>
    `;

    toast.querySelector('.toast-close')?.addEventListener('click', () => dismissToast(toast));
    container.appendChild(toast);

    setTimeout(() => dismissToast(toast), duration);
  }

  export function dismissToast(toast) {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 250);
  }

  /* ---- Animated Counter ---------------------------- */

  export function animateCounter(elId, target, decimals = 0, suffix = '') {
    const el = document.getElementById(elId);
    if (!el) return;

    const start    = 0;
    const duration = 600;
    const startTs  = performance.now();

    function step(ts) {
      const progress = Math.min((ts - startTs) / duration, 1);
      const ease     = 1 - Math.pow(1 - progress, 3);
      const current  = start + (target - start) * ease;
      el.textContent = decimals > 0 ? current.toFixed(decimals) + suffix : Math.round(current) + suffix;
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  /* ---- Utility Helpers ----------------------------- */

  export function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  export function setInputVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  export function setCheckbox(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = checked;
  }

  export function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str || '');
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  // Toggle the selected mood button, keeping the `active` class and `aria-pressed`
  // state in sync so screen readers announce the current selection.
  export function setActiveMood(moodVal) {
    document.querySelectorAll('.mood-btn').forEach(b => {
      const isActive = b.dataset.mood === String(moodVal);
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  // Returns a safe href. Allows http/https/file; blocks javascript:, data:, etc.
  // Bare Windows paths (C:\...) and UNC paths (\\server\...) are converted to file:// URLs.
  export function safeHref(url) {
    if (!url) return '#';
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:') return url;
      return '#';
    } catch {
      if (/^[a-zA-Z]:[\\\/]/.test(url)) return 'file:///' + url.replace(/\\/g, '/');
      if (url.startsWith('\\\\')) return 'file:' + url.replace(/\\/g, '/');
      return '#';
    }
  }

  // Converts free-text notes into safe HTML for view mode: URLs become clickable links,
  // newlines become <br>. All text is HTML-escaped and every href is routed through
  // safeHref(), so raw user URLs never reach the DOM unsanitised.
  export function linkifyNotes(text) {
    const raw = String(text || '');
    const urlRe = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
    let out = '', last = 0, m;
    while ((m = urlRe.exec(raw)) !== null) {
      out += escapeHtml(raw.slice(last, m.index));
      let url = m[0], trail = '';
      // Keep trailing punctuation (e.g. a sentence-ending period) out of the link.
      const tm = url.match(/[.,;:!?)\]'"]+$/);
      if (tm) { trail = tm[0]; url = url.slice(0, -trail.length); }
      const href = safeHref(/^www\./i.test(url) ? 'https://' + url : url);
      out += href === '#'
        ? escapeHtml(url)
        : `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
      out += escapeHtml(trail);
      last = m.index + m[0].length;
    }
    out += escapeHtml(raw.slice(last));
    return out.replace(/\n/g, '<br>');
  }

  export function capitalise(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  export function formatRelativeDate(dateStr) {
    const today = Analytics.today();
    const diff  = Analytics.daysBetween(today, dateStr);
    if (dateStr === today) return 'Today';
    if (diff === 1)        return 'Yesterday';
    if (diff < 7)          return `${diff} days ago`;
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  export function formatDateRange(from, to) {
    const opts = { month: 'short', day: 'numeric' };
    const f    = new Date(from + 'T12:00:00').toLocaleDateString('en-US', opts);
    const t    = new Date(to   + 'T12:00:00').toLocaleDateString('en-US', opts);
    return `${f} – ${t}`;
  }

  export function createEmptyState() {
    const el = document.createElement('div');
    el.id = 'log-empty-state';
    el.className = 'empty-state';
    el.innerHTML = `
      <div class="empty-icon">📚</div>
      <h3>No learning entries yet</h3>
      <p>Start tracking your learning journey.</p>
      <button class="btn btn-primary" id="log-empty-add-btn">Add First Entry</button>
    `;
    el.querySelector('#log-empty-add-btn')?.addEventListener('click', () => openEntryModal());
    return el;
  }
