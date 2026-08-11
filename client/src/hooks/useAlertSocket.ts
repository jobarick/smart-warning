import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrackMessage, WireMessage, WorkerInfo } from '../types';
import { parseWireMessage } from '../lib/validate';
import * as outbox from '../lib/outbox';
import * as trackBuffer from '../lib/trackBuffer';

export type SocketStatus = 'connecting' | 'open' | 'closed';

const WS_PORT = 3001;

// Where to reach the relay. In LAN/dev we derive it from the current host so
// phones connect with no config. For a hosted deployment (e.g. Vercel), set
// VITE_WS_URL at build time to the public relay URL, e.g. wss://relay.example.com.
function relayUrl(): string {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) return configured;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:${WS_PORT}`;
}
const HEARTBEAT_MS = 5000;

/**
 * How often to re-offer anything the relay has not yet echoed back. Slower than
 * the heartbeat: a queued alert that missed the join handshake should go again
 * promptly, but a relay that is refusing them should not be hammered.
 */
const FLUSH_MS = 3000;

/** Credentials presented to join the org room: a supervisor JWT or a join code. */
export interface JoinCredentials {
  token?: string;
  orgCode?: string;
}

/**
 * @param onMessage    handler for validated inbound messages
 * @param getSelfInfo  returns this device's current telemetry, or null to stay
 *                     anonymous (no roster entry). Read fresh on every heartbeat.
 * @param join         org credentials to present on connect. Changing them
 *                     reconnects. Omit for legacy single-room (no-DB) relays.
 * @param enabled      when false, no socket is opened (e.g. before the user has
 *                     passed the auth gate). Defaults to true.
 */
export function useAlertSocket(
  onMessage: (m: WireMessage) => void,
  getSelfInfo?: () => WorkerInfo | null,
  join?: JoinCredentials,
  enabled: boolean = true,
) {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [deviceCount, setDeviceCount] = useState(0);
  const [roster, setRoster] = useState<WorkerInfo[]>([]);
  // What is written down but not yet acknowledged by the relay. Surfaced so
  // that "offline and holding your alert" never looks like "delivered".
  // `queuedSince` is the oldest entry's age, which is what makes a real backlog
  // distinguishable from the few milliseconds every normal send spends here.
  const [queued, setQueued] = useState(() => outbox.size());
  const [queuedSince, setQueuedSince] = useState<number | null>(null);
  // Set when the relay rejects our credentials (close code 4001) — the caller
  // uses this to send the user back to the entry screen.
  const [joinRejected, setJoinRejected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const getSelfInfoRef = useRef(getSelfInfo);
  getSelfInfoRef.current = getSelfInfo;
  const joinRef = useRef(join);
  joinRef.current = join;
  // Reconnect when credentials change (e.g. worker → supervisor login).
  const joinKey = JSON.stringify(join ?? null);

  const syncQueue = useCallback(() => {
    const entries = outbox.pending();
    setQueued(entries.length);
    setQueuedSince(entries.length === 0 ? null : Math.min(...entries.map((e) => e.queuedAt)));
  }, []);
  const syncQueueRef = useRef(syncQueue);
  syncQueueRef.current = syncQueue;

  const sendHeartbeat = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const info = getSelfInfoRef.current?.();
    if (info) ws.send(JSON.stringify({ kind: 'heartbeat', ...info }));
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus('connecting');
      return;
    }
    let disposed = false;
    let retries = 0;
    let timer = 0;
    let beat = 0;
    let flushTimer = 0;
    setJoinRejected(false);

    const resetConnectionState = () => {
      setStatus('closed');
      setDeviceCount(0);
      setRoster([]);
    };
    const scheduleRetry = () => {
      if (!disposed) timer = window.setTimeout(connect, Math.min(1000 * 2 ** retries++, 10000));
    };

    const connect = () => {
      setStatus('connecting');
      let ws: WebSocket;
      try {
        ws = new WebSocket(relayUrl());
      } catch (err) {
        // Unlike every other failure here, a bad URL or a browser security
        // restriction (e.g. an insecure ws:// endpoint from a page loaded over
        // https) throws synchronously out of the constructor instead of
        // failing async via onerror/onclose. Uncaught, that took the whole
        // app down through render instead of just this connection attempt.
        console.error('[socket] failed to open WebSocket:', err);
        wsRef.current = null;
        resetConnectionState();
        scheduleRetry();
        return;
      }
      wsRef.current = ws;

      /**
       * Re-offer everything the relay has not echoed back yet.
       *
       * Deliberately not a one-shot on open: the relay ignores traffic from a
       * socket that has not finished joining its org room, and `join` is
       * resolved asynchronously, so the first attempt after a reconnect can be
       * dropped through no fault of the message. Entries survive until the echo
       * arrives, so repeating costs nothing and eventually wins.
       */
      const flush = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const entries = outbox.pending();
        if (entries.length > 0) {
          for (const e of entries) ws.send(JSON.stringify({ ...e.msg, replayed: true }));
          outbox.markAttempted(entries.map((e) => e.key));
        }

        // Positions taken while disconnected. Best-effort and cleared on send:
        // a duplicated point only thickens a trail, a lost alert does not.
        const buf = trackBuffer.buffered();
        if (buf && buf.points.length > 0) {
          const msg: TrackMessage = { kind: 'track', incidentId: buf.incidentId, points: buf.points };
          ws.send(JSON.stringify(msg));
          trackBuffer.clear();
        }
        syncQueueRef.current();
      };

      ws.onopen = () => {
        retries = 0;
        setStatus('open');
        // Join our org room if we have credentials; otherwise fall back to the
        // legacy shared-token flow for a no-DB single-room relay.
        const j = joinRef.current;
        if (j && (j.token || j.orgCode)) {
          ws.send(JSON.stringify({ kind: 'join', ...j }));
        } else {
          const token = import.meta.env.VITE_RELAY_TOKEN as string | undefined;
          if (token) ws.send(JSON.stringify({ kind: 'auth', token }));
        }
        const info = getSelfInfoRef.current?.();
        if (info) ws.send(JSON.stringify({ kind: 'hello', ...info }));
        beat = window.setInterval(() => {
          const i = getSelfInfoRef.current?.();
          if (i && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ kind: 'heartbeat', ...i }));
        }, HEARTBEAT_MS);
        flush();
        flushTimer = window.setInterval(flush, FLUSH_MS);
      };
      ws.onmessage = (e) => {
        let raw: unknown;
        try {
          raw = JSON.parse(e.data);
        } catch {
          return;
        }
        // Never trust the relay: a malformed type/severity used to crash every
        // connected client. Drop anything that doesn't match the schema.
        const msg = parseWireMessage(raw);
        if (!msg) return;
        if (msg.kind === 'presence') setDeviceCount(msg.count);
        else if (msg.kind === 'roster') setRoster(msg.workers);
        // The relay echoes alerts, all-clears and statuses to the whole room,
        // including whoever sent them. That echo is the only acknowledgement
        // the protocol offers, so it is what retires an outbox entry.
        else if (msg.kind === 'alert' || msg.kind === 'all-clear' || msg.kind === 'status') {
          if (outbox.confirm(msg)) syncQueueRef.current();
        }
        onMessageRef.current(msg);
      };
      ws.onclose = (e) => {
        clearInterval(beat);
        clearInterval(flushTimer);
        if (disposed) return;
        resetConnectionState();
        // 4001 = credentials rejected. Reconnecting won't help — surface it.
        if (e.code === 4001) {
          setJoinRejected(true);
          return;
        }
        scheduleRetry();
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(beat);
      clearInterval(flushTimer);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinKey, enabled]);

  /**
   * Returns true if the message went out over the wire.
   *
   * Life-safety messages are written to the outbox BEFORE the attempt, not
   * after it fails. A socket in OPEN state is not proof of delivery: the relay
   * silently ignores anything from a connection that has not finished joining
   * its org room, which is the state every reconnect passes through. Writing
   * first and retiring on the echo makes that window survivable instead of
   * merely unlikely. On the happy path the entry lives for a few milliseconds.
   */
  const send = useCallback((m: WireMessage): boolean => {
    if (m.kind === 'alert' || m.kind === 'all-clear' || m.kind === 'status') {
      outbox.enqueue(m);
      syncQueueRef.current();
    }
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(m));
      return true;
    }
    return false;
  }, []);

  return { status, deviceCount, roster, joinRejected, send, sendHeartbeat, queued, queuedSince };
}
