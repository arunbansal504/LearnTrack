/* ================================================================
   test-accounts.js — Local-only test accounts (no cloud).

   Emails listed here log in WITHOUT an OTP and WITHOUT ever touching
   Supabase. They are meant for exercising the application layer
   (profiles, entries, goals, settings) without creating or reading
   any row in the cloud. For such a session:
     • "Send code" on the landing page logs straight in.
     • No accounts/subscriptions/profiles rows are ever written.
     • Cloud UI (Auto Cloud Backup, manual sync/restore) is disabled.
     • Sign-out keeps the browser data (linked to the test email) and
       shows no cloud-backup modal.

   This file has NO app-shell dependencies so it can be imported from
   both landing.js and the app modules. Only the OTP/email login path
   consults it — Google OAuth is unaffected.

   Marker: while a test session is active, localStorage holds
   `lt_test_account` = the test email. A synthetic account id
   (`test:<email>`) scopes/links the browser data, mirroring how a
   real Supabase account id (auth.users.id) is used elsewhere.
   ================================================================ */

// Add tester emails here (lowercase). Each can sign in with just "Send code".
export const TEST_ACCOUNTS = [
  'tester@example.com',
];

const TEST_SESSION_KEY = 'lt_test_account';

function normalize(email) {
  return (email || '').trim().toLowerCase();
}

// Is this email configured as a no-cloud test account?
export function isTestAccount(email) {
  return TEST_ACCOUNTS.includes(normalize(email));
}

// Synthetic, stable account id used to scope/link local data.
export function testAccountId(email) {
  return 'test:' + normalize(email);
}

// The active test session's email, or null when not in a test session.
export function getTestSession() {
  try { return localStorage.getItem(TEST_SESSION_KEY) || null; } catch { return null; }
}

export function isTestSession() {
  return !!getTestSession();
}

// Begin / end a local test session (no Supabase involved).
export function startTestSession(email) {
  try { localStorage.setItem(TEST_SESSION_KEY, normalize(email)); } catch { /* ignore */ }
}
export function endTestSession() {
  try { localStorage.removeItem(TEST_SESSION_KEY); } catch { /* ignore */ }
}
