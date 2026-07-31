// The plan catalogue — the single source of truth for what a tier costs, how
// many people it covers, and which features it unlocks.
//
// Prices are held per currency rather than converted at runtime. A shilling
// price that drifts with an exchange rate is a support ticket every month, and
// 8,000 TZS is a price a customer can recognise in a way 7,842 TZS is not.
//
// Read the ENTITLEMENTS list alongside billing/entitlements.js, which is where
// the rule that emergency alerting is never gated is enforced.

// Every capability that billing can speak about. Anything not named here is
// unconditionally available — which is the safe default for this product.
const FEATURES = {
  UNLIMITED_CONTACTS: 'unlimited_contacts',
  FAMILY_LOCATION: 'family_location',
  SAFETY_ASSISTANT: 'safety_assistant',
  SUPERVISOR_DASHBOARD: 'supervisor_dashboard',
  INCIDENT_REPORTS: 'incident_reports',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  EMERGENCY_DRILLS: 'emergency_drills',      // not built yet — gate is ready for it
  PRIORITY_SUPPORT: 'priority_support',
  CUSTOM_BILLING: 'custom_billing',
};

const F = FEATURES;

// Ordered cheapest → richest. `rank` lets an upgrade/downgrade be compared
// without hardcoding the order at each call site.
const PLANS = [
  {
    id: 'free',
    rank: 0,
    name: 'Free',
    audience: 'individual',
    tagline: 'Emergency alerting, for everyone.',
    seats: 1,
    price: { USD: 0, TZS: 0 },
    features: [],
    // Spelled out because it is the product's promise, not an upsell ladder:
    // the alert path is identical on every tier.
    includes: ['Emergency SOS alerts', 'Standard emergency contacts', 'Live location during an alert'],
  },
  {
    id: 'personal_pro',
    rank: 1,
    name: 'Personal Pro',
    audience: 'individual',
    tagline: 'For families who want everyone accounted for.',
    seats: 1,
    price: { USD: 3, TZS: 8000 },
    features: [F.UNLIMITED_CONTACTS, F.FAMILY_LOCATION, F.SAFETY_ASSISTANT],
    includes: ['Everything in Free', 'Unlimited emergency contacts', 'Family location sharing', 'Safety assistant guidance'],
  },
  {
    id: 'team',
    rank: 2,
    name: 'Team',
    audience: 'business',
    tagline: 'A supervisor watching over a single site.',
    seats: 50,
    price: { USD: 30, TZS: 80000 },
    features: [
      F.UNLIMITED_CONTACTS, F.FAMILY_LOCATION, F.SAFETY_ASSISTANT,
      F.SUPERVISOR_DASHBOARD, F.INCIDENT_REPORTS,
    ],
    includes: ['Everything in Personal Pro', 'Supervisor command centre', 'Incident history & roll call', 'Up to 50 people'],
  },
  {
    id: 'business',
    rank: 3,
    name: 'Business',
    audience: 'business',
    tagline: 'Multi-site operations that answer to an auditor.',
    seats: 250,
    minSeats: 51,
    price: { USD: 100, TZS: 260000 },
    features: [
      F.UNLIMITED_CONTACTS, F.FAMILY_LOCATION, F.SAFETY_ASSISTANT,
      F.SUPERVISOR_DASHBOARD, F.INCIDENT_REPORTS,
      F.ADVANCED_ANALYTICS, F.EMERGENCY_DRILLS, F.PRIORITY_SUPPORT,
    ],
    includes: ['Everything in Team', 'Advanced analytics', 'Emergency drills', 'Priority support', '51–250 people'],
  },
  {
    id: 'enterprise',
    rank: 4,
    name: 'Enterprise',
    audience: 'business',
    tagline: 'Priced per person, billed how your finance team needs.',
    seats: null, // custom — negotiated, not self-serve
    price: { USD: null, TZS: null },
    perSeat: { USD: { min: 1, max: 3 } },
    contactOnly: true,
    features: [
      F.UNLIMITED_CONTACTS, F.FAMILY_LOCATION, F.SAFETY_ASSISTANT,
      F.SUPERVISOR_DASHBOARD, F.INCIDENT_REPORTS,
      F.ADVANCED_ANALYTICS, F.EMERGENCY_DRILLS, F.PRIORITY_SUPPORT,
      F.CUSTOM_BILLING,
    ],
    includes: ['Everything in Business', 'Custom seat count', 'Custom billing terms', 'Named account contact'],
  },
];

const BY_ID = PLANS.reduce((acc, p) => { acc[p.id] = p; return acc; }, {});

const CURRENCIES = ['TZS', 'USD'];

// Only monthly is sold today. The cycle is carried through the schema and the
// API so annual terms can be added without a migration; anything else is
// rejected rather than silently treated as monthly.
const CYCLES = new Set(['monthly', 'annual']);

// Annual is billed at ten months — two months free. Kept here rather than as a
// second price field so the two can never disagree.
const ANNUAL_MONTHS = 10;

function getPlan(id) {
  return BY_ID[id] || null;
}

function isPlan(id) {
  return Boolean(BY_ID[id]);
}

// Price of one billing period, in the currency's own units (TZS is a whole
// number currency — there are no cents in practice). Returns null for tiers
// that are not self-serve.
function priceFor(planId, currency, cycle = 'monthly') {
  const plan = getPlan(planId);
  if (!plan) return null;
  if (!CURRENCIES.includes(currency)) return null;
  const monthly = plan.price[currency];
  if (monthly == null) return null;
  if (cycle === 'annual') return monthly * ANNUAL_MONTHS;
  return monthly;
}

// A plan is chargeable if it has a price we can actually collect. Free needs no
// payment; Enterprise is negotiated offline.
function isChargeable(planId, currency = 'TZS', cycle = 'monthly') {
  const amount = priceFor(planId, currency, cycle);
  return amount != null && amount > 0;
}

function planFeatures(planId) {
  const plan = getPlan(planId);
  return plan ? plan.features.slice() : [];
}

// How many people a tier covers. null means "no fixed limit" (Enterprise),
// which is not the same as zero.
function seatsFor(planId) {
  const plan = getPlan(planId);
  return plan ? plan.seats : null;
}

// The catalogue as the client renders it: prices resolved for one currency, so
// the pricing table never does arithmetic of its own.
function catalogue(currency = 'TZS', cycle = 'monthly') {
  const cur = CURRENCIES.includes(currency) ? currency : 'TZS';
  return PLANS.map((p) => ({
    id: p.id,
    name: p.name,
    rank: p.rank,
    audience: p.audience,
    tagline: p.tagline,
    seats: p.seats,
    minSeats: p.minSeats ?? null,
    currency: cur,
    cycle,
    price: priceFor(p.id, cur, cycle),
    perSeat: p.perSeat ? p.perSeat[cur] ?? null : null,
    contactOnly: Boolean(p.contactOnly),
    chargeable: isChargeable(p.id, cur, cycle),
    features: p.features.slice(),
    includes: p.includes.slice(),
  }));
}

module.exports = {
  FEATURES,
  PLANS,
  CURRENCIES,
  CYCLES,
  ANNUAL_MONTHS,
  getPlan,
  isPlan,
  priceFor,
  isChargeable,
  planFeatures,
  seatsFor,
  catalogue,
};
