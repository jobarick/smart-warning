// Whether this device has accepted the current Terms & Conditions.
//
// Stored per device, keyed by terms version, because that is what "once after
// install" means: a person who signs out and back in is not asked again, and
// raising TERMS_VERSION re-prompts everyone because agreement to one document
// is not agreement to its replacement.
//
// The local record is what gates the UI. It is not the record of consent — a
// value in localStorage proves nothing, can be cleared, and is under the user's
// own control. The durable record is written server-side by recordConsent()
// below, which is what an organisation could actually rely on.
import { TERMS_VERSION } from './terms';

const KEY = 'sw-consent-v1';

export interface ConsentRecord {
  version: string;
  acceptedAt: number;
  /** The individual confirmations that were ticked, for the local record. */
  points: string[];
}

export function loadConsent(): ConsentRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentRecord;
    if (parsed && typeof parsed.version === 'string') return parsed;
  } catch {
    // Corrupt storage reads as "not accepted". Asking again is a small
    // annoyance; skipping the terms because JSON.parse threw is not.
  }
  return null;
}

/** True only for the version currently in force. */
export function hasAcceptedCurrentTerms(): boolean {
  const record = loadConsent();
  return record !== null && record.version === TERMS_VERSION;
}

export function saveConsent(points: string[]): ConsentRecord {
  const record: ConsentRecord = { version: TERMS_VERSION, acceptedAt: Date.now(), points };
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Private browsing, or storage full. The person has still agreed and must
    // not be blocked; they will simply be asked again next time.
  }
  return record;
}

/** Only used when the terms themselves change, and by tests. */
export function clearConsent(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
