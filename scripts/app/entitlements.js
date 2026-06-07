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
  const session = state.syncSession;
  if (!session) {
    state.tier         = 'free';
    state.entitlements = null;
    return;
  }

  try {
    const sb = await getClient();
    const [subRes, optRes] = await Promise.all([
      sb.from('subscriptions').select('tier').single(),
      sb.from('appearance_options').select('kind,key,min_tier').order('sort_order'),
    ]);

    state.tier = subRes.data?.tier || 'free';
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

  if (state.entitlements) {
    const minTier = state.entitlements.get(lookup);
    if (!minTier) return true;
    return rank >= (TIER_ORDER[minTier] ?? 0);
  }

  // Fallback — no catalog loaded yet.
  // Free users only get explicit free keys; premium/family get everything.
  return FREE_KEYS.has(lookup) || rank > 0;
}
