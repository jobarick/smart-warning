// Tanzanian mobile number handling.
//
// Every collections API in this market wants the same thing — MSISDN in full
// international form with no plus sign, e.g. 255713455454 — while every human
// types the local form, 0713 455 454. Normalising in one place means the rest
// of the payment code can assume it already holds a valid MSISDN.
//
// The operator matters as well as the number: a USSD push has to be sent on the
// network that actually holds the wallet, and the prefix is the only thing that
// tells us which one that is.

// Prefix → operator, by Tanzania's national numbering plan. Keyed on the two
// digits after the country code (i.e. the local number minus its leading 0).
const PREFIXES = {
  // Vodacom — M-Pesa
  74: 'mpesa', 75: 'mpesa', 76: 'mpesa',
  // Tigo — now branded Mixx by Yas
  65: 'mixx_by_yas', 67: 'mixx_by_yas', 71: 'mixx_by_yas',
  // Airtel — Airtel Money
  68: 'airtel_money', 69: 'airtel_money', 78: 'airtel_money',
  // Halotel — HaloPesa
  61: 'halopesa', 62: 'halopesa',
  // Zantel — EzyPesa
  77: 'ezypesa',
  // TTCL — no consumer wallet, but the number is still valid
  73: 'ttcl',
};

// Wallets we can actually collect from. TTCL is a real network with no mobile
// money product, so a number on it is well-formed but not chargeable — the
// distinction the UI needs to explain the difference to a customer.
const COLLECTABLE = new Set(['mixx_by_yas', 'mpesa', 'airtel_money', 'halopesa', 'ezypesa']);

// Display names, and the channel identifiers ClickPesa reports back on a
// payment. Their names are the legacy carrier ones, so Mixx by Yas arrives as
// TIGO-PESA; mapping both directions keeps that vendor detail out of our data.
const OPERATORS = {
  mixx_by_yas:  { label: 'Mixx by Yas',   short: 'Mixx',   channel: 'TIGO-PESA' },
  mpesa:        { label: 'Vodacom M-Pesa', short: 'M-Pesa', channel: 'M-PESA' },
  airtel_money: { label: 'Airtel Money',  short: 'Airtel', channel: 'AIRTEL-MONEY' },
  halopesa:     { label: 'HaloPesa',      short: 'Halo',   channel: 'HALOPESA' },
  ezypesa:      { label: 'EzyPesa',       short: 'Ezy',    channel: 'EZYPESA' },
  ttcl:         { label: 'TTCL',          short: 'TTCL',   channel: null },
};

const CHANNEL_TO_OPERATOR = Object.entries(OPERATORS).reduce((acc, [key, meta]) => {
  if (meta.channel) acc[meta.channel] = key;
  return acc;
}, {});

// Strip everything that isn't a digit. Users paste numbers with spaces, dashes,
// parentheses and a leading +; none of it carries meaning.
function digits(input) {
  return String(input == null ? '' : input).replace(/\D+/g, '');
}

// Normalise any of the forms a Tanzanian number is written in to a bare MSISDN:
//   0713455454     → 255713455454
//   +255 713 455 454 → 255713455454
//   255713455454   → 255713455454
//   713455454      → 255713455454
// Returns null when the input cannot be one of those.
function normalize(input) {
  let d = digits(input);
  if (!d) return null;

  // 00 is the other international prefix still in common use here.
  if (d.startsWith('00')) d = d.slice(2);

  if (d.startsWith('255')) {
    // Already international.
  } else if (d.startsWith('0')) {
    d = `255${d.slice(1)}`;
  } else if (d.length === 9) {
    // Bare subscriber number, no trunk prefix.
    d = `255${d}`;
  } else {
    return null;
  }

  // 255 + 9 subscriber digits.
  if (d.length !== 12) return null;
  if (!PREFIXES[Number(d.slice(3, 5))]) return null;
  return d;
}

// Which network a number belongs to, or null if it isn't a valid TZ mobile.
function operatorOf(input) {
  const msisdn = normalize(input);
  if (!msisdn) return null;
  return PREFIXES[Number(msisdn.slice(3, 5))] || null;
}

function isValid(input) {
  return normalize(input) !== null;
}

// Whether we can raise a USSD push against this number at all.
function isCollectable(input) {
  const op = operatorOf(input);
  return op !== null && COLLECTABLE.has(op);
}

// Human-facing form: +255 713 455 454. Used in confirmations and receipts,
// never sent to an API.
function format(input) {
  const msisdn = normalize(input);
  if (!msisdn) return String(input == null ? '' : input);
  const sub = msisdn.slice(3);
  return `+255 ${sub.slice(0, 3)} ${sub.slice(3, 6)} ${sub.slice(6)}`;
}

// Last four digits only, for logs and support tickets. A full MSISDN is
// personal data and there is no reason for it to sit in a log file.
function mask(input) {
  const msisdn = normalize(input);
  if (!msisdn) return '••••';
  return `•••• ${msisdn.slice(-4)}`;
}

function operatorMeta(operator) {
  return OPERATORS[operator] || null;
}

// Map a ClickPesa channel string back to our operator key.
function operatorFromChannel(channel) {
  if (!channel) return null;
  return CHANNEL_TO_OPERATOR[String(channel).toUpperCase()] || null;
}

module.exports = {
  normalize,
  operatorOf,
  operatorMeta,
  operatorFromChannel,
  isValid,
  isCollectable,
  format,
  mask,
  digits,
  OPERATORS,
  COLLECTABLE,
};
