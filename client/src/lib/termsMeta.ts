// The small facts about the terms that the always-loaded parts of the app
// need — the version consent is stored against, and who to contact — kept
// apart from the full legal text in terms.ts, so that text (the bulk of it)
// can load with the screens that show it instead of on every first visit.
// terms.ts re-exports all of this; import from either.

/**
 * Bump when the terms change materially.
 *
 * Consent is stored against this version, so raising it re-prompts everyone.
 * That is the point: agreement to a document is agreement to *that* document,
 * and silently carrying it forward to a rewritten one is not consent.
 */
export const TERMS_VERSION = '1.3';

export const TERMS_EFFECTIVE_DATE = '13 October 2026';

export const SUPPORT_EMAIL = 'jobarick@gmail.com';
export const SUPPORT_PHONE = '+255 713 455 454';

/**
 * Public-facing business/sales contact, shown on the landing page and the
 * auth page's enterprise door. Deliberately separate from SUPPORT_EMAIL:
 * that address is where account-support tickets and the legal documents
 * above tell a user to write for a privacy/data request, and a "talk to
 * sales" inquiry should not compete with that inbox unless someone chooses
 * to point both at the same place.
 */
export const SALES_EMAIL = 'lab@idesign.co.tz';

/** Where "Talk to us" (enterprise pricing, billing) sends a visitor — the agency's own site, not a mailto. */
export const IDESIGN_URL = 'https://idesign.co.tz';

/**
 * Who provides the Service.
 *
 * Named in one place and used everywhere — the terms, the privacy policy, the
 * About screen and the support page — because a document that asks somebody to
 * agree to something should say who they are agreeing with, and three
 * different spellings of that across an app is its own kind of unreliable.
 */
export const PROVIDER = 'Idefenda Lab';
