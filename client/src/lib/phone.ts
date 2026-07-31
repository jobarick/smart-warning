// Tanzanian mobile number handling, client side.
//
// ⚠️ This mirrors server/payments/phone.js. The two must stay in step — the
// server re-validates everything sent to it, so a divergence shows up as the
// UI accepting a number the API then rejects. Change both together.
//
// It exists separately because the checkout screen has to name the customer's
// operator, format as they type, and reject an unusable number before it costs
// them a round trip.

export type Operator =
  | 'mixx_by_yas'
  | 'mpesa'
  | 'airtel_money'
  | 'halopesa'
  | 'ezypesa'
  | 'ttcl';

// Prefix (the two digits after the country code) → network.
const PREFIXES: Record<number, Operator> = {
  74: 'mpesa', 75: 'mpesa', 76: 'mpesa',
  65: 'mixx_by_yas', 67: 'mixx_by_yas', 71: 'mixx_by_yas',
  68: 'airtel_money', 69: 'airtel_money', 78: 'airtel_money',
  61: 'halopesa', 62: 'halopesa',
  77: 'ezypesa',
  73: 'ttcl',
};

export interface OperatorMeta {
  id: Operator;
  label: string;
  short: string;
  /** What the customer sees on their handset — used in the "enter your PIN" copy. */
  wallet: string;
  collectable: boolean;
}

export const OPERATORS: Record<Operator, OperatorMeta> = {
  mixx_by_yas:  { id: 'mixx_by_yas',  label: 'Mixx by Yas',    short: 'Mixx',   wallet: 'Mixx',        collectable: true },
  mpesa:        { id: 'mpesa',        label: 'Vodacom M-Pesa', short: 'M-Pesa', wallet: 'M-Pesa',      collectable: true },
  airtel_money: { id: 'airtel_money', label: 'Airtel Money',   short: 'Airtel', wallet: 'Airtel Money', collectable: true },
  halopesa:     { id: 'halopesa',     label: 'HaloPesa',       short: 'Halo',   wallet: 'HaloPesa',    collectable: true },
  ezypesa:      { id: 'ezypesa',      label: 'EzyPesa',        short: 'Ezy',    wallet: 'EzyPesa',     collectable: true },
  ttcl:         { id: 'ttcl',         label: 'TTCL',           short: 'TTCL',   wallet: '',            collectable: false },
};

/** The three the checkout screen offers, in the order they matter here. */
export const OFFERED: Operator[] = ['mixx_by_yas', 'mpesa', 'airtel_money'];

export function digitsOnly(input: string): string {
  return (input || '').replace(/\D+/g, '');
}

/** Any local or international form → bare MSISDN (255…), or null. */
export function normalize(input: string): string | null {
  let d = digitsOnly(input);
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);

  if (d.startsWith('255')) {
    /* already international */
  } else if (d.startsWith('0')) {
    d = `255${d.slice(1)}`;
  } else if (d.length === 9) {
    d = `255${d}`;
  } else {
    return null;
  }

  if (d.length !== 12) return null;
  if (!PREFIXES[Number(d.slice(3, 5))]) return null;
  return d;
}

export function operatorOf(input: string): Operator | null {
  const msisdn = normalize(input);
  if (!msisdn) return null;
  return PREFIXES[Number(msisdn.slice(3, 5))] ?? null;
}

export function isValid(input: string): boolean {
  return normalize(input) !== null;
}

export function isCollectable(input: string): boolean {
  const op = operatorOf(input);
  return op !== null && OPERATORS[op].collectable;
}

/** Display form: +255 713 455 454. */
export function format(input: string): string {
  const msisdn = normalize(input);
  if (!msisdn) return input || '';
  const sub = msisdn.slice(3);
  return `+255 ${sub.slice(0, 3)} ${sub.slice(3, 6)} ${sub.slice(6)}`;
}

/**
 * Progressive formatting for a field being typed into.
 *
 * Deliberately does not rewrite what the customer is typing into international
 * form mid-entry — someone who starts "07…" should keep seeing "07…", because
 * a field that rearranges itself under the cursor is how you get a mistyped
 * number. It only spaces the digits; format() gives the canonical form once the
 * number is complete.
 */
export function formatAsTyped(input: string): string {
  const raw = (input || '').trim();
  const plus = raw.startsWith('+');
  let d = digitsOnly(raw);
  if (!d) return plus ? '+' : '';

  if (d.startsWith('255')) {
    const sub = d.slice(3, 12);
    const parts = [sub.slice(0, 3), sub.slice(3, 6), sub.slice(6, 9)].filter(Boolean);
    return `+255${parts.length ? ` ${parts.join(' ')}` : ''}`;
  }

  if (d.startsWith('0')) d = d.slice(0, 10);
  else d = d.slice(0, 9);

  // 0713 455 454
  if (d.startsWith('0')) {
    const a = d.slice(0, 4);
    const b = d.slice(4, 7);
    const c = d.slice(7, 10);
    return [a, b, c].filter(Boolean).join(' ');
  }
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 9);
  return [a, b, c].filter(Boolean).join(' ');
}

export function operatorMeta(op: Operator | null): OperatorMeta | null {
  return op ? OPERATORS[op] : null;
}
