// The light SOS page (/sos.html). Every network call is mocked: nothing here
// can reach a real server or notify a real person.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SESSION_KEY = 'sw-session-v1';
const personal = {
  kind: 'supervisor', token: 'tok',
  user: { id: 'u1', email: 'a@example.com', name: 'Asha', role: 'supervisor', kind: 'individual' },
};

function mount() {
  document.body.innerHTML = '<main id="sos"></main>';
}

function geolocation(fix: { latitude: number; longitude: number; accuracy: number } | null) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) =>
        fix ? ok({ coords: fix } as GeolocationPosition) : fail({ code: 1 } as GeolocationPositionError),
    },
  });
}

async function load() {
  vi.resetModules();
  await import('./sos');
}

const root = () => document.getElementById('sos')!;
const button = (name: RegExp) => [...root().querySelectorAll('button')].find((b) => name.test(b.textContent ?? ''))!;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('alert-system-settings-v1', JSON.stringify({ locale: 'en' }));
  mount();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('light SOS page', () => {
  it('without a personal account, offers 112 and SMS and no send button', async () => {
    await load();
    expect(root().textContent).toContain('Quick SOS sends for personal accounts');
    expect(root().querySelector('a[href^="sms:"]')).toBeTruthy();
    expect(root().querySelector('.sos-big')).toBeNull();
  });

  it('one tap sends with the location and says how many people it reached', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(personal));
    geolocation({ latitude: -6.8, longitude: 39.28, accuracy: 15 });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      incidentId: 'x', contacted: [{ id: 'c1', name: 'B', delivered: true }, { id: 'c2', name: 'C', delivered: true }], skipped: [],
    }), { status: 201 }));
    await load();

    root().querySelector<HTMLButtonElement>('.sos-big')!.click();
    await vi.waitFor(() => expect(root().textContent).toContain('Sent to 2 of your Circle'));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/contacts/alert');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({ type: 'security', severity: 'critical', lat: -6.8, lng: 39.28 });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
    // Call and SMS stay on screen after a successful send too.
    expect(root().querySelector('a[href^="sms:"]')!.getAttribute('href')).toContain('maps.google.com');
  });

  it('a failed send says so, pushes the call, and retries with the same incident id', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(personal));
    geolocation(null);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"nope"}', { status: 500 }));
    await load();

    root().querySelector<HTMLButtonElement>('.sos-big')!.click();
    await vi.waitFor(() => expect(root().textContent).toContain('Not sent'));
    expect(root().classList.contains('sos-urgent')).toBe(true);
    expect(root().textContent).toContain('Location unknown');

    const firstId = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).id;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ incidentId: firstId, contacted: [], skipped: [], replayed: true }), { status: 200 }));
    button(/Try sending again/).click();
    await vi.waitFor(() => expect(root().textContent).toContain('Sent to 0'));
    const retryId = JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body)).id;
    expect(retryId).toBe(firstId);
  });

  it('nobody reached is treated as a failure, not a success', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(personal));
    geolocation({ latitude: -6.8, longitude: 39.28, accuracy: 15 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ incidentId: 'x', contacted: [], skipped: [] }), { status: 201 }));
    await load();
    root().querySelector<HTMLButtonElement>('.sos-big')!.click();
    await vi.waitFor(() => expect(root().textContent).toContain('Nobody in your Circle could be reached'));
    expect(root().classList.contains('sos-urgent')).toBe(true);
    await flush();
  });
});
