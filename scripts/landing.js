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

/* ---- Redirect already-signed-in users ------------------------- */
async function maybeRedirectToApp() {
  const stored = localStorage.getItem(SB_AUTH_KEY);
  if (!stored) return;
  try {
    const sb = await getClient();
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      window.location.replace('app.html');
    }
  } catch { /* offline — stay on landing */ }
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
    if (!code) { showStatus(statusEl, 'Enter the 6-digit code.', 'error'); return; }
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

/* ---- Boot ----------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  wireTheme();
  wireAuth();
  maybeRedirectToApp();
});
