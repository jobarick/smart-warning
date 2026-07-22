import { useCallback, useEffect, useRef, useState } from 'react';
import type { WireMessage } from '../types';
import { parseWireMessage } from '../lib/validate';

export type SocketStatus = 'connecting' | 'open' | 'closed';

const WS_PORT = 3001;

export function useAlertSocket(onMessage: (m: WireMessage) => void) {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [deviceCount, setDeviceCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let disposed = false;
    let retries = 0;
    let timer = 0;

    const connect = () => {
      setStatus('connecting');
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.hostname}:${WS_PORT}`);
      wsRef.current = ws;

      ws.onopen = () => {
        retries = 0;
        setStatus('open');
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
        onMessageRef.current(msg);
      };
      ws.onclose = () => {
        if (disposed) return;
        setStatus('closed');
        setDeviceCount(0);
        timer = window.setTimeout(connect, Math.min(1000 * 2 ** retries++, 10000));
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
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

  return { status, deviceCount, send };
}
