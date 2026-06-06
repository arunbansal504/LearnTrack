/* ================================================================
   CLOUD SYNC CONFIG — Supabase project credentials.

   These are PUBLIC values and safe to ship in client code:
     • The anon key is designed to be exposed in the browser.
     • Data isolation is enforced server-side by Row-Level Security
       (each user can only read/write their own snapshot row).

   To enable cloud sync, create a Supabase project and replace the
   two placeholders below with your Project URL and anon public key
   (Project Settings → API). Until then, isConfigured() returns false
   and the app shows the sync UI as unavailable.
   ================================================================ */

export const SUPABASE_URL      = 'https://snfppslemvlmocrxnooe.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_gXc-GvFEQrBNZzGJl1wxrQ_Z4yvG2lQ';

// True once real credentials have been filled in (not the shipped placeholders).
export function isConfigured() {
  return (
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) &&
    !SUPABASE_URL.includes('YOUR-PROJECT') &&
    !!SUPABASE_ANON_KEY &&
    !SUPABASE_ANON_KEY.includes('YOUR-ANON')
  );
}
