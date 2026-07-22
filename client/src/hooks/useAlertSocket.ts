import { useCallback, useEffect, useRef, useState } from 'react';
import type { WireMessage, WorkerInfo } from '../types';
import { parseWireMessage } from '../lib/validate';

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
 * @param onMessage    handler for validated inbound messages
 * @param getSelfInfo  returns this device's current telemetry, or null to stay
 *                     anonymous (no roster entry). Read fresh on every heartbeat.
 */
export function useAlertSocket(onMessage: (m: WireMessage) => void, getSelfInfo?: () => WorkerInfo | null) {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [deviceCount, setDeviceCount] = useState(0);
  const [roster, setRoster] = useState<WorkerInfo[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const getSelfInfoRef = useRef(getSelfInfo);
  getSelfInfoRef.current = getSelfInfo;

  const sendHeartbeat = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const info = getSelfInfoRef.current?.();
    if (info) ws.send(JSON.stringify({ kind: 'heartbeat', ...info }));
  }, []);

  useEffect(() => {
    let disposed = false;
    let retries = 0;
    let timer = 0;
    let beat = 0;

    const connect = () => {
      setStatus('connecting');
      const ws = new WebSocket(relayUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        retries = 0;
        setStatus('open');
        const info = getSelfInfoRef.current?.();
        if (info) ws.send(JSON.stringify({ kind: 'hello', ...info }));
        beat = window.setInterval(() => {
          const i = getSelfInfoRef.current?.();
          if (i && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ kind: 'heartbeat', ...i }));
        }, HEARTBEAT_MS);
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
        onMessageRef.current(msg);
      };
      ws.onclose = () => {
        clearInterval(beat);
        if (disposed) return;
        setStatus('closed');
        setDeviceCount(0);
        setRoster([]);
        timer = window.setTimeout(connect, Math.min(1000 * 2 ** retries++, 10000));
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(beat);
      wsRef.current?.close();
    };
  }, []);

  /** Returns true if the message went out over the wire. */
  const send = useCallback((m: WireMessage): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(m));
      return true;
    }
    return false;
  }, []);

  return { status, deviceCount, roster, send, sendHeartbeat };
}
