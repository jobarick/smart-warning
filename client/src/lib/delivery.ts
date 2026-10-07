// What the person who raised an SOS is told about whether it actually left.
//
// The single most dangerous thing this app could do is look like it sent an
// alert when it did not. Before this, a held alert (relay unreachable, no
// signal) showed the same full screen "FIRE ALERT" as a delivered one, and the
// only honest line was a footer hidden under the overlay. Found in the
// 2026-10-07 safety audit by stopping the server and pressing SOS.
//
// Pure functions only, so the rules can be tested without a browser.

/** After this long without the relay's echo, stop saying "sending". */
export const SEND_BUDGET_MS = 8000;

/** The GSM standard emergency number: dialable on almost any network, even
 *  without a SIM. Offered whenever an alert has not reached anyone. */
export const FALLBACK_EMERGENCY_NUMBER = '112';

export type DeliveryState =
  | { kind: 'sending' }
  /** Nobody has it yet. The person must be told to call. */
  | { kind: 'not-sent' }
  /** The relay has it and broadcast it to the team. `others` is how many
   *  other devices were online to receive it live. */
  | { kind: 'sent-team'; others: number }
  /** Personal account: emailed to this many Trusted Circle members. */
  | { kind: 'sent-people'; count: number }
  /** Personal account: recorded, but nobody in the Circle could be reached. */
  | { kind: 'reached-nobody' };

export interface OrgDeliveryInput {
  alertId: string;
  raisedAt: number;
  now: number;
  /** Ids still waiting in the outbox for the relay's echo. */
  pendingAlertIds: string[];
  socketOpen: boolean;
  /** Devices in the room, this one included. */
  deviceCount: number;
  online: boolean;
}

export function orgDelivery(i: OrgDeliveryInput): DeliveryState {
  if (!i.pendingAlertIds.includes(i.alertId)) {
    return { kind: 'sent-team', others: Math.max(0, i.deviceCount - 1) };
  }
  const elapsed = i.now - i.raisedAt;
  // No network at all: there is nothing to wait for, say so at once.
  if (!i.online) return { kind: 'not-sent' };
  if (elapsed >= SEND_BUDGET_MS) return { kind: 'not-sent' };
  // A socket that is not even open gets a short grace for a reconnect that is
  // already under way, not the full budget.
  if (!i.socketOpen && elapsed >= 2000) return { kind: 'not-sent' };
  return { kind: 'sending' };
}

export interface PersonalDeliveryInput {
  phase: 'sending' | 'sent' | 'failed' | null;
  contactedCount?: number;
  replayed?: boolean;
  raisedAt: number;
  now: number;
  online: boolean;
}

export function personalDelivery(i: PersonalDeliveryInput): DeliveryState {
  if (i.phase === 'failed') return { kind: 'not-sent' };
  if (i.phase === 'sent') {
    if (i.replayed) return { kind: 'sent-people', count: i.contactedCount ?? 0 };
    return i.contactedCount ? { kind: 'sent-people', count: i.contactedCount } : { kind: 'reached-nobody' };
  }
  if (!i.online || i.now - i.raisedAt >= SEND_BUDGET_MS) return { kind: 'not-sent' };
  return { kind: 'sending' };
}

/** True when the person should be pushed towards calling or texting. */
export function needsFallback(state: DeliveryState): boolean {
  return state.kind === 'not-sent' || state.kind === 'reached-nobody';
}

export interface SmsInput {
  name: string;
  typeLabel: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  at: number;
  /** Already translated pieces, so this stays language neutral. */
  text: {
    body: (vars: { name: string; type: string; location: string; time: string }) => string;
    withLocation: (vars: { url: string; metres: string }) => string;
    noLocation: string;
  };
}

/**
 * An `sms:` link the phone's own messaging app can open with the text filled
 * in. No recipient: the person picks who to send it to (family, a neighbour).
 * Needs no internet and no Smart Warning server, only an SMS signal, which is
 * the point: it is the path left when everything else has failed.
 * `sms:?&body=` is the form both Android and iOS accept.
 */
export function smsHref(i: SmsInput): string {
  const location = i.lat != null && i.lng != null
    ? i.text.withLocation({
        url: `https://maps.google.com/?q=${i.lat.toFixed(5)},${i.lng.toFixed(5)}`,
        metres: i.accuracy != null ? String(Math.max(1, Math.round(i.accuracy))) : '?',
      })
    : i.text.noLocation;
  const time = new Date(i.at).toTimeString().slice(0, 5);
  const body = i.text.body({ name: i.name || 'Smart Warning', type: i.typeLabel, location, time });
  return `sms:?&body=${encodeURIComponent(body)}`;
}
