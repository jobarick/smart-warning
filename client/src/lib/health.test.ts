// fetchHealth decides which app a visitor gets. Reporting an unreachable
// backend as "orgs off" once put every visitor of the public site into legacy
// single-room mode during a backend outage (no landing page, no sign-in), so
// "could not reach it" must stay distinguishable from "it said no accounts".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHealth } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('fetchHealth', () => {
  it('reports an orgs-mode backend', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { persistence: true, orgs: true })));
    expect(await fetchHealth()).toEqual({ persistence: true, orgs: true });
  });

  it('reports a genuine single-room backend as orgs off', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { persistence: false, orgs: false })));
    expect(await fetchHealth()).toEqual({ persistence: false, orgs: false });
  });

  it('returns null, not orgs off, when the backend refuses every probe', async () => {
    // What a suspended Render service answers: 404 with no app behind it.
    vi.stubGlobal('fetch', vi.fn(() => respond(404, { error: 'Not Found' })));
    expect(await fetchHealth()).toBeNull();
  });

  it('returns null when the network itself fails (CORS, DNS, offline)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await fetchHealth()).toBeNull();
  });

  it('falls back to "/" for older backends', async () => {
    const fetchMock = vi.fn((url: string) => (url.endsWith('/api/health') ? respond(404, {}) : respond(200, { persistence: true, orgs: true })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchHealth()).toEqual({ persistence: true, orgs: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
