// The reliability property the audit flagged as load-bearing: send() writes
// to the durable outbox BEFORE attempting delivery, a socket in OPEN state
// is not trusted as proof of delivery, and an entry only retires once the
// relay actually echoes the message back. This exercises that against a
// fake WebSocket rather than a real relay, which is enough to prove the
// hook's own logic is correct without standing up a server.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAlertSocket } from './useAlertSocket';
import * as outbox from '../lib/outbox';
import type { AlertMessage } from '../types';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: unknown[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000 });
  }

  // --- test-only helpers, not part of the real WebSocket API ---
  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function fireAlert(id: string): AlertMessage {
  return { kind: 'alert', id, type: 'fire', severity: 'critical', message: '', sender: 'Device', timestamp: Date.now() };
}

/** A SystemStatusMessage carries no id — every other outbox.Queueable kind does. */
function idOf(msg: outbox.Queueable): string | undefined {
  return msg.kind === 'status' ? undefined : msg.id;
}

let originalWebSocket: typeof WebSocket;

beforeEach(() => {
  localStorage.clear();
  MockWebSocket.instances = [];
  originalWebSocket = globalThis.WebSocket;
  // @ts-expect-error — a deliberately minimal stand-in, not the real interface
  globalThis.WebSocket = MockWebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  localStorage.clear();
});

async function firstSocket(): Promise<MockWebSocket> {
  await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
  return MockWebSocket.instances[0];
}

describe('send()', () => {
  it('writes to the durable outbox before attempting delivery, even once the socket is open', async () => {
    // The property this exists for: ws.send() succeeding proves the bytes
    // left the device, not that the relay accepted them (see outbox.ts) —
    // so the write must happen unconditionally, not only on failure.
    const { result } = renderHook(() => useAlertSocket(() => {}, undefined, undefined, true));
    const ws = await firstSocket();
    act(() => ws.open());
    await waitFor(() => expect(result.current.status).toBe('open'));

    const alert = fireAlert('a1');
    let sent = false;
    act(() => { sent = result.current.send(alert); });

    expect(sent).toBe(true); // the socket was open, so it went out
    expect(outbox.pending().some((e) => idOf(e.msg) === 'a1')).toBe(true); // AND it's durable regardless
  });

  it('returns false while disconnected, and still queues the message durably', () => {
    const { result } = renderHook(() => useAlertSocket(() => {}, undefined, undefined, true));
    // No open() call — the mock socket is still CONNECTING.
    const alert = fireAlert('a1');
    let sent = true;
    act(() => { sent = result.current.send(alert); });

    expect(sent).toBe(false);
    expect(outbox.pending().map((e) => idOf(e.msg))).toEqual(['a1']);
  });

  it('does not durably queue a heartbeat or presence-only traffic — only alert/all-clear/status', () => {
    const { result } = renderHook(() => useAlertSocket(() => {}, undefined, undefined, true));
    act(() => {
      // @ts-expect-error — deliberately an unsupported wire kind for this test
      result.current.send({ kind: 'heartbeat', id: 'h1' });
    });
    expect(outbox.size()).toBe(0);
  });
});

describe('reconnect flush', () => {
  it('an alert queued while disconnected is sent once the socket opens', async () => {
    const { result } = renderHook(() => useAlertSocket(() => {}, undefined, undefined, true));
    const alert = fireAlert('a1');
    act(() => { result.current.send(alert); }); // queued, socket still connecting

    const ws = await firstSocket();
    act(() => ws.open());
    await waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    const sentAlert = ws.sent.find((m) => (m as AlertMessage).kind === 'alert') as AlertMessage;
    expect(sentAlert.id).toBe('a1');
  });

  it('retires the outbox entry once the relay echoes the alert back, not before', async () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useAlertSocket(onMessage, undefined, undefined, true));
    const ws = await firstSocket();
    act(() => ws.open());
    await waitFor(() => expect(result.current.status).toBe('open'));

    const alert = fireAlert('a1');
    act(() => { result.current.send(alert); });
    expect(outbox.size()).toBe(1); // still waiting — ws.send() succeeding is not proof

    act(() => ws.receive(alert)); // the relay's echo, per its own protocol
    await waitFor(() => expect(outbox.size()).toBe(0));
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1', kind: 'alert' }));
  });

  it('a malformed inbound message is dropped rather than crashing the app', async () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useAlertSocket(onMessage, undefined, undefined, true));
    const ws = await firstSocket();
    act(() => ws.open());
    await waitFor(() => expect(result.current.status).toBe('open'));

    expect(() => act(() => ws.receive({ kind: 'alert', severity: 'not-a-real-severity' }))).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe('queued / queuedSince', () => {
  it('reports how many entries are outstanding', async () => {
    const { result } = renderHook(() => useAlertSocket(() => {}, undefined, undefined, true));
    act(() => {
      result.current.send(fireAlert('a1'));
      result.current.send(fireAlert('a2'));
    });
    await waitFor(() => expect(result.current.queued).toBeGreaterThanOrEqual(2));
  });
});

describe('enabled: false', () => {
  it('opens no socket at all — used before the auth gate is passed', () => {
    renderHook(() => useAlertSocket(() => {}, undefined, undefined, false));
    expect(MockWebSocket.instances).toHaveLength(0);
  });
});
