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

function geolocation(fix: { latitude: number; longitude: number; accuracy: number } | null | 'hang') {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) => {
        if (fix === 'hang') return; // never answers: the page's own timeout must fire
        if (fix) ok({ coords: fix } as GeolocationPosition); else fail({ code: 1 } as GeolocationPositionError);
      },
    },
  });
}

function online(on: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
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
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); online(true); });

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
    // The server's replay answer carries no recipient list, so the page must
    // not claim a count; it says the alert was already received.
    await vi.waitFor(() => expect(root().textContent).toContain('already received this alert on an earlier try'));
    expect(root().textContent).not.toContain('Sent to 0');
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

  it('a GPS that never answers does not hold the alert: it goes out without a location after 6s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    localStorage.setItem(SESSION_KEY, JSON.stringify(personal));
    geolocation('hang');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      incidentId: 'x', contacted: [{ id: 'c1', name: 'B', delivered: true }], skipped: [],
    }), { status: 201 }));
    await load();
    root().querySelector<HTMLButtonElement>('.sos-big')!.click();
    expect(root().textContent).toContain('Finding your location');
    await vi.advanceTimersByTimeAsync(6100);
    vi.useRealTimers();
    await vi.waitFor(() => expect(root().textContent).toContain('Sent to 1 of your Circle'));
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.lat).toBeNull();
    expect(root().textContent).toContain('Location unknown');
  });

  it('a send still in flight after the 8s budget says "not sent yet, still trying", never "sent"', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    localStorage.setItem(SESSION_KEY, JSON.stringify(personal));
    geolocation(null);
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {})); // hangs
    await load();
    root().querySelector<HTMLButtonElement>('.sos-big')!.click();
    await vi.advanceTimersByTimeAsync(9000);
    expect(root().textContent).toContain('Not sent yet; still trying');
    expect(root().classList.contains('sos-urgent')).toBe(true);
    vi.useRealTimers();
  });

  it('offline: the send fails honestly and call / SMS stay available', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(personal));
    geolocation(null);
    online(false);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await load();
    root().querySelector<HTMLButtonElement>('.sos-big')!.click();
    await vi.waitFor(() => expect(root().textContent).toContain('Not sent'), { timeout: 5000 });
    expect(root().querySelector('a[href^="sms:"]')).toBeTruthy();
    expect(root().textContent).toContain('Call 112');
  });

  it('a failed "it is over" is reported, not claimed', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(personal));
    geolocation(null);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      incidentId: 'x', contacted: [{ id: 'c1', name: 'B', delivered: true }], skipped: [],
    }), { status: 201 }));
    await load();
    root().querySelector<HTMLButtonElement>('.sos-big')!.click();
    await vi.waitFor(() => expect(root().textContent).toContain('Sent to 1'));
    fetchMock.mockResolvedValue(new Response('{"error":"down"}', { status: 500 }));
    button(/It's over/).click();
    await vi.waitFor(() => expect(root().textContent).toContain("Couldn't tell your people it is over"));
    expect(root().textContent).not.toContain('Your people have been told');
  });

  it('works without crypto.randomUUID (older Android) and still sends a valid UUID', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(personal));
    geolocation(null);
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ incidentId: 'x', contacted: [], skipped: [] }), { status: 201 }));
    try {
      await load();
      root().querySelector<HTMLButtonElement>('.sos-big')!.click();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const id = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).id;
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: original });
    }
  });
});
