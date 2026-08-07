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

// Every new account starts with a month of the paid experience.
//
// When it lapses the account falls to 'free', which still raises alarms, still
// calls emergency numbers, still receives alerts and still reads the safety
// library — see billing/entitlements.js. A trial that expires into a product
// that cannot call for help would be a worse thing to ship than no trial.
const TRIAL_DAYS = 30;

// What a trial serves, by the shape of the account. A person gets the personal
// tier; an organisation gets the entry business tier, because a coordinator
// evaluating this needs the dashboard to evaluate it at all.
const TRIAL_TIER = { individual: 'personal', org: 'team' };

/**
 * The monthly price, in each currency it is collected in.
 *
 * One configured number per currency, deliberately NOT a USD figure passed
 * through an exchange rate. A shilling price that drifts with the market is a
 * support conversation every month, and 2,500 TZS is a number a customer can
 * recognise on a USSD prompt in a way 2,483 TZS is not. When the rate moves
 * far enough to matter, someone changes the configured local price on purpose.
 *
 * Both plans on sale today — a person and a site — cost the same. That is a
 * deliberate stage, not an oversight: nothing about a site costs more to serve
 * yet, and a price difference would have to be justified to a customer.
 */
const MONTHLY_PRICE = {
  USD: Number(process.env.MONTHLY_PRICE_USD ?? 1),
  TZS: Number(process.env.MONTHLY_PRICE_TZS ?? 2500),
};

/** Bundle prices, held explicitly for the same reason as the monthly ones. */
const BUNDLE_PRICE = {
  USD: {
    monthly: MONTHLY_PRICE.USD,
    quarterly: Number(process.env.QUARTERLY_PRICE_USD ?? 2.6),
    half_year: Number(process.env.HALF_YEAR_PRICE_USD ?? 4.8),
    annual: Number(process.env.ANNUAL_PRICE_USD ?? 8.8),
  },
  TZS: {
    monthly: MONTHLY_PRICE.TZS,
    quarterly: Number(process.env.QUARTERLY_PRICE_TZS ?? 6500),
    half_year: Number(process.env.HALF_YEAR_PRICE_TZS ?? 12000),
    annual: Number(process.env.ANNUAL_PRICE_TZS ?? 22000),
  },
};

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
    id: 'personal',
    rank: 1,
    name: 'Personal',
    audience: 'individual',
    tagline: 'For one person, wherever they are.',
    seats: 1,
    price: MONTHLY_PRICE,
    // Multi-month terms matter more here than anywhere else in the catalogue.
    // Collecting the monthly price by mobile money costs a gateway fee and a
    // USSD prompt the customer has to complete, every single month — at this
    // price the monthly cycle barely pays for itself, and prepaid airtime has
    // already taught this market to buy time in blocks.
    bundles: BUNDLE_PRICE,
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
    // The same price as a personal account, on purpose. Nothing about a site
    // costs more to serve yet, and a difference would have to be justified to
    // a customer rather than assumed. Both come from one configured value.
    price: MONTHLY_PRICE,
    bundles: BUNDLE_PRICE,
    features: [
      F.UNLIMITED_CONTACTS, F.FAMILY_LOCATION, F.SAFETY_ASSISTANT,
      F.SUPERVISOR_DASHBOARD, F.INCIDENT_REPORTS,
    ],
    includes: ['Everything in Personal', 'Safety Coordinator command centre', 'Incident history & roll call', 'Up to 50 people'],
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

// Ids that have been renamed. A stored subscription still naming the old one
// must keep resolving to the tier the customer bought — without this, an
// unrecognised id falls through to 'free' and quietly removes what they paid
// for. Cheaper than a data migration and impossible to forget to run.
const LEGACY_IDS = { personal_pro: 'personal' };

const CURRENCIES = ['TZS', 'USD'];

// Terms that can be bought. Anything else is rejected rather than silently
// treated as monthly.
const CYCLES = new Set(['monthly', 'quarterly', 'half_year', 'annual']);

// How much time a term buys. Used to extend the period on renewal, so this is
// the calendar length — not the number of months charged for.
const CYCLE_MONTHS = { monthly: 1, quarterly: 3, half_year: 6, annual: 12 };

// Fallback for plans without explicit bundle prices: annual is billed at ten
// months, two months free. Plans that state their own bundle prices ignore it.
const ANNUAL_MONTHS = 10;

function canonicalId(id) {
  return LEGACY_IDS[id] || id;
}

function getPlan(id) {
  return BY_ID[canonicalId(id)] || null;
}

/** Calendar months a term covers, for extending a subscription period. */
function monthsFor(cycle) {
  return CYCLE_MONTHS[cycle] ?? 1;
}

// Recognised, including under a name it used to have. This has to resolve
// aliases as well: every caller uses it as the guard before trusting a stored
// tier, so if it answered false for a renamed id the alias would never be
// reached and the customer would silently drop to free.
function isPlan(id) {
  return Boolean(BY_ID[canonicalId(id)]);
}

// Price of one billing period, in the currency's own units (TZS is a whole
// number currency — there are no cents in practice). Returns null for tiers
// that are not self-serve.
function priceFor(planId, currency, cycle = 'monthly') {
  const plan = getPlan(planId);
  if (!plan) return null;
  if (!CURRENCIES.includes(currency)) return null;
  if (!CYCLES.has(cycle)) return null;

  // An explicit bundle price always wins. It is the number a customer was
  // quoted, and arithmetic that disagrees with the rate card is a support
  // ticket rather than a saving.
  const bundle = plan.bundles?.[currency]?.[cycle];
  if (bundle != null) return bundle;

  const monthly = plan.price[currency];
  if (monthly == null) return null;
  if (cycle === 'monthly') return monthly;
  if (cycle === 'annual') return monthly * ANNUAL_MONTHS;
  // A term this plan does not sell. Not an error, and deliberately not a
  // guess: silently inventing a quarterly price for a business tier would put
  // a number in front of a customer that nobody chose.
  return null;
}

/** Is this term on sale for this plan, in this currency? */
function cyclesFor(planId, currency = 'TZS') {
  return [...CYCLES].filter((c) => priceFor(planId, currency, c) != null);
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
    // What terms this plan is actually sold on, and what each costs, so a
    // pricing screen can offer bundles without doing arithmetic of its own.
    cycles: cyclesFor(p.id, cur).map((c) => ({
      cycle: c,
      months: monthsFor(c),
      price: priceFor(p.id, cur, c),
    })),
    trialDays: TRIAL_DAYS,
    features: p.features.slice(),
    includes: p.includes.slice(),
  }));
}

module.exports = {
  FEATURES,
  PLANS,
  CURRENCIES,
  CYCLES,
  CYCLE_MONTHS,
  ANNUAL_MONTHS,
  TRIAL_DAYS,
  TRIAL_TIER,
  MONTHLY_PRICE,
  BUNDLE_PRICE,
  canonicalId,
  getPlan,
  isPlan,
  priceFor,
  cyclesFor,
  monthsFor,
  isChargeable,
  planFeatures,
  seatsFor,
  catalogue,
};
