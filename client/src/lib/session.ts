// The client's org context, persisted across reloads. Two kinds:
//  • worker     — joined a team with its org code + a display name.
//  • supervisor — logged in with an account; carries a JWT + user/org info.
import type { AuthUser } from './api';
import { clearConsent } from './consent';
import * as outbox from './outbox';
import * as trackBuffer from './trackBuffer';
import { loadSettings, saveSettings } from './settings';

export type Session =
  | { kind: 'worker'; orgCode: string; orgName?: string; name: string }
  | { kind: 'supervisor'; token: string; user: AuthUser };

const KEY = 'sw-session-v1';

/** Which of the two shells was last open. Owned here so signing out can reset
 *  it: it used to persist across accounts, so the next person to sign in on
 *  this device booted straight into the previous one's command centre. */
export const VIEW_KEY = 'alert-system-view';
/** The incident a "yes, I'm safe" answer referred to. */
export const SAFE_FOR_KEY = 'sw-safe-for-v1';
/** The Android push registration for whoever was signed in. */
const DEVICE_TOKEN_KEY = 'sw-device-token-v1';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (s && (s.kind === 'worker' || s.kind === 'supervisor')) return s;
  } catch {
    /* ignore corrupt storage */
  }
  return null;
}

export function saveSession(s: Session): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}

/** Everything on this device that belonged to the person signing out.
 *
 *  `clearSession()` only ever dropped the token, so the next person to sign in
 *  inherited the previous one's display name, operator ID, zone, queued outbox
 *  messages, buffered location track, "I'm safe" answer and last-open view.
 *  That is what made a new user look like the old account had been restored.
 *
 *  Deliberately kept: the cached emergency-services directory, which is public
 *  reference data about a country rather than anything about a person, and the
 *  device's own preferences (theme, siren, brightness, vibration). Wiping those
 *  would punish the owner of the phone for someone else having borrowed it.
 *
 *  This runs only on an explicit sign-out or a session the server has rejected
 *  — never on a plain app restart, which must still restore the session. */
export function clearUserScopedState(): void {
  clearSession();
  localStorage.removeItem(VIEW_KEY);
  localStorage.removeItem(SAFE_FOR_KEY);
  localStorage.removeItem(DEVICE_TOKEN_KEY);
  outbox.clear();
  trackBuffer.clear();
  // A new person has to accept the terms themselves; acceptance is not a
  // property of the handset.
  clearConsent();
  // Identity fields go; device preferences stay.
  try {
    const prev = loadSettings();
    saveSettings({ ...prev, deviceName: '', operatorId: '', zone: '' });
  } catch {
    /* storage unavailable — nothing to leak */
  }
}

/** The credentials the WebSocket presents to join its org room. */
export function joinCredentials(s: Session | null): { token?: string; orgCode?: string } | undefined {
  if (!s) return undefined;
  return s.kind === 'supervisor' ? { token: s.token } : { orgCode: s.orgCode };
}

/** The bearer token for REST calls, if this session has one. */
export function sessionToken(s: Session | null): string | undefined {
  return s && s.kind === 'supervisor' ? s.token : undefined;
}

/** Display name for this session's device/user. */
export function sessionName(s: Session | null): string | undefined {
  if (!s) return undefined;
  return s.kind === 'supervisor' ? s.user.name : s.name;
}
