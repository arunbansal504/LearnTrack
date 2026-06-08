/* ================================================================
   landing.js — Marketing landing page interactions + auth entry.
   Plain ES module; no app-shell dependencies.
   Supabase is loaded lazily (same CDN + config as app).
   ================================================================ */

const SUPABASE_URL      = 'https://codeflqdchbhsdjbuhqw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_p4sjIxGfeoFdFYKHy3BqCQ_HQ_nM0c3';
const SUPABASE_ESM      = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const SB_AUTH_KEY       = 'lt_sb_auth';

let _sb = null;
async function getClient() {
  if (_sb) return _sb;
  const mod = await import(/* @vite-ignore */ SUPABASE_ESM);
  _sb = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: SB_AUTH_KEY },
  });
  return _sb;
}

/* ---- Show signed-in state on the landing page ----------------- */
async function maybeRedirectToApp() {
  const stored = localStorage.getItem(SB_AUTH_KEY);
  if (!stored) return;
  try {
    const sb = await getClient();
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      showSignedInLanding(session, sb);
    }
  } catch { /* offline — stay on landing */ }
}

function showSignedInLanding(session, sb) {
  // Hide the auth form entirely
  const authBox = document.querySelector('.l-hero-auth');
  if (authBox) authBox.style.display = 'none';

  // Replace nav "Sign in" button with Dashboard link + Sign Out
  const navActions  = document.querySelector('.l-nav-actions');
  const signInBtn   = document.getElementById('nav-signin-btn');
  if (signInBtn) {
    // Turn the button into a Dashboard link
    const dashLink = document.createElement('a');
    dashLink.href      = 'app.html';
    dashLink.className = 'l-btn l-btn-primary';
    dashLink.textContent = 'Dashboard';
    signInBtn.replaceWith(dashLink);
  }

  if (navActions && !navActions.querySelector('#landing-signout-btn')) {
    const signOutBtn = document.createElement('button');
    signOutBtn.id          = 'landing-signout-btn';
    signOutBtn.type        = 'button';
    signOutBtn.className   = 'l-btn l-btn-ghost';
    signOutBtn.textContent = 'Sign Out';
    navActions.appendChild(signOutBtn);

    signOutBtn.addEventListener('click', async () => {
      try { await sb.auth.signOut(); } catch { /* ignore */ }
      try { localStorage.removeItem(SB_AUTH_KEY); } catch {}
      // Reload so the page resets cleanly to signed-out state
      window.location.reload();
    });
  }
}

/* ---- Status helper -------------------------------------------- */
function showStatus(el, msg, type) {
  if (!el) return;
  el.className = `l-auth-status ${type}`;
  el.textContent = msg;
}

function friendlyError(err) {
  const m = (err?.message || '').toLowerCase();
  if (m.includes('otp') || m.includes('token') || m.includes('invalid'))
    return 'That code is incorrect or has expired.';
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Too many attempts — please wait a minute.';
  if (m.includes('fetch') || m.includes('network'))
    return 'Network error — check your connection.';
  return err?.message || 'Something went wrong. Please try again.';
}

/* ---- OTP flow ------------------------------------------------- */
let _otpEmail = '';

function setStep(step) {
  const s1 = document.getElementById('landing-step1');
  const s2 = document.getElementById('landing-step2');
  if (step === 1) { s1?.classList.remove('hidden'); s2?.classList.add('l-otp-step2'); s2?.classList.remove('visible'); }
  else            { s1?.classList.add('hidden');    s2?.classList.add('visible'); s2?.classList.add('l-otp-step2'); }
  const status = document.getElementById('landing-auth-status');
  if (status) status.className = 'l-auth-status';
}

async function sendOtp(email, statusEl) {
  const sb = await getClient();
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

async function verifyOtp(email, token) {
  const sb = await getClient();
  const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
  return data;
}

async function signInWithGoogle() {
  const sb  = await getClient();
  const url  = `${location.protocol}//${location.host}/app.html`;
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: url } });
  if (error) throw error;
}

/* ---- Wire up the hero auth form ------------------------------- */
function wireAuth() {
  const statusEl   = document.getElementById('landing-auth-status');
  const emailInput = document.getElementById('landing-email');
  const sendBtn    = document.getElementById('landing-send-otp');
  const googleBtn  = document.getElementById('landing-google');
  const codeInput  = document.getElementById('landing-otp-code');
  const verifyBtn  = document.getElementById('landing-verify-otp');
  const backBtn    = document.getElementById('landing-otp-back');
  const resendBtn  = document.getElementById('landing-resend-otp');

  sendBtn?.addEventListener('click', async () => {
    const email = emailInput?.value.trim();
    if (!email) { showStatus(statusEl, 'Enter your email address.', 'error'); return; }
    sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
    try {
      await sendOtp(email);
      _otpEmail = email;
      const display = document.getElementById('landing-otp-email-display');
      if (display) display.textContent = email;
      setStep(2);
      codeInput?.focus();
    } catch (err) {
      showStatus(statusEl, friendlyError(err), 'error');
    } finally {
      sendBtn.disabled = false; sendBtn.textContent = 'Send Code';
    }
  });

  emailInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendBtn?.click(); } });

  verifyBtn?.addEventListener('click', async () => {
    const code = codeInput?.value.trim();
    if (!code) { showStatus(statusEl, 'Enter the code from your email.', 'error'); return; }
    verifyBtn.disabled = true; verifyBtn.textContent = 'Verifying…';
    try {
      await verifyOtp(_otpEmail, code);
      showStatus(statusEl, 'Signed in! Taking you to the app…', 'success');
      setTimeout(() => window.location.replace('app.html'), 800);
    } catch (err) {
      showStatus(statusEl, friendlyError(err), 'error');
    } finally {
      verifyBtn.disabled = false; verifyBtn.textContent = 'Verify & Continue';
    }
  });

  codeInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); verifyBtn?.click(); } });

  backBtn?.addEventListener('click', () => setStep(1));

  resendBtn?.addEventListener('click', async () => {
    resendBtn.disabled = true; resendBtn.textContent = 'Sending…';
    try {
      await sendOtp(_otpEmail);
      showStatus(statusEl, 'A new code was sent.', 'info');
      codeInput && (codeInput.value = '');
    } catch (err) {
      showStatus(statusEl, friendlyError(err), 'error');
    } finally {
      resendBtn.disabled = false; resendBtn.textContent = 'Resend code';
    }
  });

  document.getElementById('landing-skip-login')?.addEventListener('click', () => {
    localStorage.setItem('lt_skip_auth', '1');
    window.location.href = 'app.html';
  });

  googleBtn?.addEventListener('click', async () => {
    googleBtn.disabled = true; googleBtn.textContent = 'Redirecting…';
    try { await signInWithGoogle(); }
    catch (err) {
      showStatus(statusEl, friendlyError(err), 'error');
      googleBtn.disabled = false;
      googleBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Continue with Google`;
    }
  });
}

/* ---- Theme toggle --------------------------------------------- */
function wireTheme() {
  const btn = document.getElementById('landing-theme-toggle');
  if (!btn) return;

  const pref = localStorage.getItem('lt_landing_theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', pref);
  btn.setAttribute('aria-label', pref === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  btn.textContent = pref === 'dark' ? '☀️' : '🌙';

  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next    = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('lt_landing_theme', next);
    btn.textContent   = next === 'dark' ? '☀️' : '🌙';
    btn.setAttribute('aria-label', next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  });
}

/* ---- Sign-in modal -------------------------------------------- */

function openSigninModal() {
  const modal = document.getElementById('signin-modal');
  if (!modal) return;
  // Reset to step 1
  document.getElementById('modal-step1').style.display = '';
  document.getElementById('modal-step2').style.display = 'none';
  const statusEl = document.getElementById('modal-auth-status');
  if (statusEl) statusEl.className = 'l-auth-status';
  modal.style.display = 'flex';
  document.getElementById('modal-email')?.focus();
}

function closeSigninModal() {
  const modal = document.getElementById('signin-modal');
  if (modal) modal.style.display = 'none';
}

function wireModal() {
  const modal     = document.getElementById('signin-modal');
  const statusEl  = document.getElementById('modal-auth-status');
  const emailInput = document.getElementById('modal-email');
  const codeInput  = document.getElementById('modal-otp-code');
  let modalOtpEmail = '';

  document.getElementById('signin-modal-close')?.addEventListener('click', closeSigninModal);
  modal?.addEventListener('click', e => { if (e.target === modal) closeSigninModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal?.style.display === 'flex') closeSigninModal(); });

  document.getElementById('nav-signin-btn')?.addEventListener('click', openSigninModal);

  const sendBtn = document.getElementById('modal-send-otp');
  sendBtn?.addEventListener('click', async () => {
    const email = emailInput?.value.trim();
    if (!email) { showStatus(statusEl, 'Enter your email address.', 'error'); return; }
    sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
    try {
      await sendOtp(email);
      modalOtpEmail = email;
      const display = document.getElementById('modal-otp-email-display');
      if (display) display.textContent = email;
      document.getElementById('modal-step1').style.display = 'none';
      document.getElementById('modal-step2').style.display = '';
      codeInput?.focus();
      if (statusEl) statusEl.className = 'l-auth-status';
    } catch (err) {
      showStatus(statusEl, friendlyError(err), 'error');
    } finally {
      sendBtn.disabled = false; sendBtn.textContent = 'Send Code';
    }
  });

  emailInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendBtn?.click(); } });

  const verifyBtn = document.getElementById('modal-verify-otp');
  verifyBtn?.addEventListener('click', async () => {
    const code = codeInput?.value.trim();
    if (!code) { showStatus(statusEl, 'Enter the code from your email.', 'error'); return; }
    verifyBtn.disabled = true; verifyBtn.textContent = 'Verifying…';
    try {
      await verifyOtp(modalOtpEmail, code);
      showStatus(statusEl, 'Signed in! Taking you to the app…', 'success');
      setTimeout(() => window.location.replace('app.html'), 800);
    } catch (err) {
      showStatus(statusEl, friendlyError(err), 'error');
    } finally {
      verifyBtn.disabled = false; verifyBtn.textContent = 'Verify & Sign In';
    }
  });

  codeInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); verifyBtn?.click(); } });

  document.getElementById('modal-otp-back')?.addEventListener('click', () => {
    document.getElementById('modal-step1').style.display = '';
    document.getElementById('modal-step2').style.display = 'none';
    if (statusEl) statusEl.className = 'l-auth-status';
  });

  document.getElementById('modal-resend-otp')?.addEventListener('click', async () => {
    const btn = document.getElementById('modal-resend-otp');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await sendOtp(modalOtpEmail);
      showStatus(statusEl, 'A new code was sent.', 'info');
      if (codeInput) codeInput.value = '';
    } catch (err) {
      showStatus(statusEl, friendlyError(err), 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Resend code';
    }
  });

  document.getElementById('modal-google')?.addEventListener('click', async () => {
    const btn = document.getElementById('modal-google');
    btn.disabled = true; btn.textContent = 'Redirecting…';
    try { await signInWithGoogle(); }
    catch (err) {
      showStatus(statusEl, friendlyError(err), 'error');
      btn.disabled = false;
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Continue with Google`;
    }
  });
}

/* ---- Dashboard preview interactivity -------------------------- */
function wirePreview() {
  const wrap = document.querySelector('.l-preview-wrap');
  if (!wrap) return;

  /* Live clock */
  const clockEl = document.getElementById('pv-clock');
  function tickClock() {
    if (!clockEl) return;
    const d = new Date();
    const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
    clockEl.textContent = `${(h % 12) || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
  }
  tickClock();
  setInterval(tickClock, 1000);

  /* Viewport-entry animations */
  let animated = false;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting || animated) return;
      animated = true;

      /* Week bars grow up */
      document.querySelectorAll('#pv-bars .l-preview-bar[data-h]').forEach((bar, i) => {
        setTimeout(() => { bar.style.height = bar.dataset.h + 'px'; }, i * 55);
      });

      /* Stat counters */
      document.querySelectorAll('.l-preview-stat-val[data-val]').forEach(el => {
        const target = +el.dataset.val, suffix = el.dataset.suffix || '';
        let cur = 0, step = target / 40;
        const t = setInterval(() => {
          cur = Math.min(cur + step, target);
          el.textContent = Math.round(cur) + suffix;
          if (cur >= target) clearInterval(t);
        }, 16);
      });

      /* XP bars */
      ['pv-sidebar-xp', 'pv-stat-xp'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.transition = 'width 1s ease 0.4s'; el.style.width = '62%'; }
      });

      /* Goal ring */
      const ring    = document.getElementById('pv-ring-fill');
      const ringPct = document.getElementById('pv-ring-pct');
      if (ring) {
        ring.style.strokeDashoffset = String(138.2 * 0.30);
        let p = 0;
        const pt = setInterval(() => {
          p = Math.min(p + 2, 70);
          if (ringPct) ringPct.textContent = p + '%';
          if (p >= 70) clearInterval(pt);
        }, 18);
      }
    }, { threshold: 0.15 }).observe(wrap);
  }

  /* Sidebar nav switching */
  const navItems = wrap.querySelectorAll('.l-preview-navitem[data-nav]');
  const views    = wrap.querySelectorAll('.l-preview-view');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.nav;
      navItems.forEach(n => n.classList.remove('l-preview-navitem--active'));
      item.classList.add('l-preview-navitem--active');
      views.forEach(v => { v.style.display = 'none'; });
      const vEl = wrap.querySelector(`.l-preview-view[data-view="${target}"]`);
      if (!vEl) return;
      vEl.style.display = '';

      if (target === 'goals') {
        wrap.querySelectorAll('.l-pv-gbar[data-w]').forEach(b => {
          b.style.width = '0%';
          requestAnimationFrame(() => {
            b.style.transition = 'width 0.8s ease';
            b.style.width = b.dataset.w + '%';
          });
        });
      }
      if (target === 'achievements') {
        const achXp = document.getElementById('pv-ach-xp');
        if (achXp) {
          achXp.style.width = '0%';
          requestAnimationFrame(() => {
            achXp.style.transition = 'width 1s ease 0.15s';
            achXp.style.width = '62%';
          });
        }
      }
    });
  });

  /* Bar hover tooltip */
  const barsEl = document.getElementById('pv-bars');
  const tipEl  = document.getElementById('pv-bar-tip');
  if (barsEl && tipEl) {
    barsEl.addEventListener('mouseover', e => {
      const col = e.target.closest('.l-preview-barcol');
      if (!col || !col.dataset.hours) { tipEl.style.display = 'none'; return; }
      tipEl.textContent = col.dataset.hours;
      tipEl.style.display = 'block';
    });
    barsEl.addEventListener('mousemove', e => {
      const wr = wrap.getBoundingClientRect();
      tipEl.style.left = (e.clientX - wr.left - 24) + 'px';
      tipEl.style.top  = (e.clientY - wr.top  - 32) + 'px';
    });
    barsEl.addEventListener('mouseleave', () => { tipEl.style.display = 'none'; });
  }

  /* Log filter chips */
  wrap.querySelectorAll('.l-preview-chips').forEach(group => {
    group.addEventListener('click', e => {
      const chip = e.target.closest('.l-preview-chip');
      if (!chip) return;
      group.querySelectorAll('.l-preview-chip').forEach(c => c.classList.remove('l-preview-chip--active'));
      chip.classList.add('l-preview-chip--active');
    });
  });

  /* "+ Add Entry" flash */
  document.getElementById('pv-add-btn')?.addEventListener('click', function () {
    if (this.dataset.busy) return;
    this.dataset.busy = '1';
    const orig = this.textContent;
    this.textContent = '✓ Added!';
    this.style.background = '#4caf8c';
    setTimeout(() => { this.textContent = orig; this.style.background = ''; delete this.dataset.busy; }, 1400);
  });
}

/* ---- Boot ----------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  wireTheme();
  wireAuth();
  wireModal();
  maybeRedirectToApp();
  wirePreview();
  document.getElementById('hero-get-started')?.addEventListener('click', openSigninModal);
  document.getElementById('hero-signin-link')?.addEventListener('click', openSigninModal);
});
