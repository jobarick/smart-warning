// The client's org context, persisted across reloads. Two kinds:
//  • worker     — joined a team with its org code + a display name.
//  • supervisor — logged in with an account; carries a JWT + user/org info.
import type { AuthUser } from './api';

export type Session =
  | { kind: 'worker'; orgCode: string; orgName?: string; name: string }
  | { kind: 'supervisor'; token: string; user: AuthUser };

const KEY = 'sw-session-v1';

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
