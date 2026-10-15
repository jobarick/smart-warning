// The plan a visitor tapped on the home page, carried through sign-up so they
// land on that plan's payment screen instead of having to find it again.
//
// Stored on this device only, for a short time, and only ever set by a tap on
// the page itself (never from a link), so nothing can pre-select a purchase.

const KEY = 'sw-intended-plan-v1';
export const INTENDED_PLAN_TTL_MS = 60 * 60 * 1000;

interface Stored { planId: string; audience: 'individual' | 'business'; at: number }

export function saveIntendedPlan(planId: string, audience: 'individual' | 'business', now = Date.now()) {
  try { localStorage.setItem(KEY, JSON.stringify({ planId, audience, at: now } satisfies Stored)); } catch { /* private mode */ }
}

export function peekIntendedPlan(now = Date.now()): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    if (!v || typeof v.planId !== 'string' || typeof v.at !== 'number' || now - v.at > INTENDED_PLAN_TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

/** Read once and forget, so the payment screen opens a single time. */
export function takeIntendedPlan(now = Date.now()): Stored | null {
  const v = peekIntendedPlan(now);
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return v;
}
