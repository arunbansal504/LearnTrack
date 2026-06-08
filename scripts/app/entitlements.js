/* ================================================================
   entitlements.js — Feature gating driven by the Supabase
   appearance_options catalog + the user's subscriptions.tier.

   canUse(kind, key) is always safe to call:
   • Online + signed-in → uses data fetched from Supabase.
   • Offline / signed-out → falls back to the built-in free-set or
     the last-known tier already in state.tier.

   Call loadEntitlements() once after sign-in to warm the cache.
   ================================================================ */

import { state } from './state.js';
import { getClient } from './sync.js';

const TIER_ORDER = { free: 0, premium: 1, family: 2 };

// Mirrors the 05_seed_appearance.sql seed — used when the catalog
// hasn't been fetched yet (first load, offline, not signed in).
const FREE_KEYS = new Set([
  'theme:light', 'theme:dark',
  'accent:blue', 'accent:purple',
]);

export async function loadEntitlements() {
  // Resolve the real session first — a signed-in user must never be routed
  // through the bypass path even if lt_skip_auth is still in localStorage.
  let session = state.syncSession;
  if (!session) {
    try {
      const sb = await getClient();
      const { data } = await sb.auth.getSession();
      session = data?.session ?? null;
      if (session) state.syncSession = session;
    } catch { /* offline or client not ready — fall through */ }
  }

  // TEMP: bypass login grants full access only when there is genuinely no
  // session (dev / offline use). A real signed-in session always takes
  // priority so the bypass can never inflate the tier for a logged-in user.
  if (!session && localStorage.getItem('lt_skip_auth')) {
    state.tier         = 'family';
    state.entitlements = null;
    state.profileLimit = 12;
    return;
  }

  if (!session) {
    state.tier         = 'free';
    state.entitlements = null;
    return;
  }

  try {
    const sb = await getClient();
    // Query the subscription row for the signed-in account (account_id maps to auth.users.id)
    const [subRes, optRes] = await Promise.all([
      sb.from('subscriptions').select('tier,status,profile_limit').eq('account_id', session.user.id).maybeSingle(),
      sb.from('appearance_options').select('kind,key,min_tier').order('sort_order'),
    ]);

    const sub = subRes.data || {};
    // A canceled or past_due subscription loses premium feature access.
    // Profile limit is kept from the DB for grandfathering (existing profiles stay usable).
    const isExpired = sub.status === 'canceled' || sub.status === 'past_due';
    state.tier         = isExpired ? 'free' : (sub.tier || 'free');
    state.profileLimit = sub.profile_limit ?? 1;
    state.entitlements = new Map(
      (optRes.data || []).map(o => [`${o.kind}:${o.key}`, o.min_tier])
    );
  } catch {
    if (!state.tier) state.tier = 'free';
  }
}

export function canUse(kind, key) {
  const lookup = `${kind}:${key}`;
  const tier   = state.tier || 'free';
  const rank   = TIER_ORDER[tier] ?? 0;

  // Only use the catalog when it has entries — an empty Map (e.g. fetch error)
  // is treated the same as null so the FREE_KEYS fallback below applies.
  if (state.entitlements?.size) {
    const minTier = state.entitlements.get(lookup);
    if (!minTier) return true;
    return rank >= (TIER_ORDER[minTier] ?? 0);
  }

  // Fallback — no catalog loaded yet.
  // Free users only get explicit free keys; premium/family get everything.
  return FREE_KEYS.has(lookup) || rank > 0;
}
