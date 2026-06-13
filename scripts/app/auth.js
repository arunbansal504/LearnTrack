/* ================================================================
   auth.js — Passwordless authentication (Email OTP + Google OAuth).

   Replaces the old email/password signUp/signIn in sync.js.
   The Supabase client singleton is owned by sync.js; we import
   getClient from there so both modules share the same instance.
   ================================================================ */

import { state }         from './state.js';
import { UserManager }   from './users.js';
import { getClient }     from './sync.js'; // single Supabase client singleton
import { setSyncStatus } from './sync.js';

/* ---- Per-profile metadata (mirrors sync.js conventions) ----------- */

function profileId() { return UserManager.getActiveId() || 'default'; }
function pkey(suffix) { return `lt_${suffix}_${profileId()}`; }

function setBoundAccount(uid) {
  if (uid) localStorage.setItem(pkey('sync_account'), uid);
  else     localStorage.removeItem(pkey('sync_account'));
}

// Derive the redirect URL for OAuth: always land on app.html in the same origin.
function appUrl() {
  const { protocol, host } = window.location;
  return `${protocol}//${host}/app.html`;
}

/* ---- Email OTP ---------------------------------------------------- */

// Step 1: send a one-time code to the user's inbox.
// `shouldCreateUser: true` means first-time visitors auto-register.
export async function requestEmailOtp(email) {
  const sb = await getClient();
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

// Step 2: verify the code the user typed.
// On success, stores the session and binds this profile to the account.
export async function verifyEmailOtp(email, token) {
  const sb = await getClient();
  const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;

  await sb.auth.getSession();
  const result = await sb.auth.getSession();
  const session = result.data.session || data.session;

  if (session) {
    state.syncSession = session;
    const accountId = session.user.id;

    // Determine if this account has been set up on this device before.
    // If not (first-ever sign-in, or signing into a different account), trigger
    // the full hydration flow via a page reload — the same path the landing page
    // uses. This ensures orphan local profiles get stashed and a fresh cloud
    // profile is created, rather than silently binding the active offline profile
    // to the cloud account and merging its data into the signed-in user.
    const isKnownAccount =
      localStorage.getItem('lt_account_owner') === accountId ||
      UserManager.getUsers().some(u => localStorage.getItem(`lt_sync_account_${u.id}`) === accountId);

    if (!isKnownAccount) {
      localStorage.setItem('lt_just_logged_in', '1');
      window.location.reload();
      return { ...data, session };
    }

    setBoundAccount(accountId);
    setSyncStatus('synced');
    document.dispatchEvent(new CustomEvent('lt-sync-changed'));
  }

  return { ...data, session };
}

/* ---- Google OAuth ------------------------------------------------- */

// Redirects the browser to Google; Supabase handles the code exchange
// and lands back at app.html with auth params in the URL.
export async function signInWithGoogle() {
  const sb = await getClient();
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options:  {
      redirectTo: appUrl(),
      // Force Google's account chooser every time, otherwise it silently
      // reuses the last-signed-in account after a sign-out / re-sign-in.
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
}

/* ---- Sign-out ----------------------------------------------------- */

export async function signOut() {
  try { const sb = await getClient(); await sb.auth.signOut(); } catch { /* ignore */ }
  state.syncSession = null;
  setBoundAccount(null);
}

/* ---- Friendly error messages -------------------------------------- */

export function friendlyAuthError(err) {
  console.error('[Auth] Supabase error:', err);
  const msg = (err?.message || '').toLowerCase();
  if (msg.includes('otp') || msg.includes('token') || msg.includes('invalid') || msg.includes('expired'))
    return 'That code is incorrect or has expired. Request a new one and enter the numeric code from your email.';
  if (msg.includes('rate limit') || msg.includes('too many'))
    return 'Too many attempts — please wait a minute and try again.';
  if (msg.includes('failed to fetch') || msg.includes('network'))
    return 'Network error — check your connection.';
  return err?.message || 'Something went wrong. Please try again.';
}
