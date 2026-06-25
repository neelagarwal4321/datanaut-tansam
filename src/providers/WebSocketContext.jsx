import { createContext, useContext, useEffect, useRef, useCallback } from "react";
import { WS_URL_WITH_AUTH } from "../config.js";

const WebSocketContext = createContext(null);

/**
 * Single shared WebSocket connection for the entire app.
 * All charts subscribe here instead of each opening their own socket.
 */
export function WebSocketProvider({ children }) {
  const wsRef = useRef(null);
  // Map<connectionId, Set<handler>>
  const subsRef = useRef(new Map());
  const reconnectRef = useRef(null);
  const stoppedRef = useRef(false);
  const attemptsRef = useRef(0);

  const subscribe = useCallback((connectionId, handler) => {
    if (!subsRef.current.has(connectionId)) {
      subsRef.current.set(connectionId, new Set());
    }
    subsRef.current.get(connectionId).add(handler);
    return () => subsRef.current.get(connectionId)?.delete(handler);
  }, []);

  useEffect(() => {
    const connect = () => {
      if (stoppedRef.current) return;
      const ws = new WebSocket(WS_URL_WITH_AUTH);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptsRef.current = 0;
        if (reconnectRef.current) {
          clearTimeout(reconnectRef.current);
          reconnectRef.current = null;
        }
      };

      const scheduleReconnect = () => {
        if (stoppedRef.current || reconnectRef.current) return;
        attemptsRef.current += 1;
        // Exponential backoff: 2s, 4s, 8s, 16s, capped at 30s + up to 1s jitter
        const base = Math.min(2000 * Math.pow(2, attemptsRef.current - 1), 30_000);
        const delay = base + Math.random() * 1000;
        reconnectRef.current = setTimeout(() => {
          reconnectRef.current = null;
          connect();
        }, delay);
      };

      ws.onerror = scheduleReconnect;
      ws.onclose = scheduleReconnect;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (!msg?.id) return;
          subsRef.current.get(msg.id)?.forEach((fn) => fn(msg));
        } catch {
          // ignore malformed frames
        }
      };
    };

    stoppedRef.current = false;
    connect();

    return () => {
      stoppedRef.current = true;
      attemptsRef.current = 0;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, []); // WS_URL_WITH_AUTH is a build-time constant

  return (
    <WebSocketContext.Provider value={{ subscribe }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWsSubscribe(connectionId, handler) {
  const ctx = useContext(WebSocketContext);
  useEffect(() => {
    if (!connectionId || !handler || !ctx) return;
    return ctx.subscribe(connectionId, handler);
  }, [connectionId, handler, ctx]);
}
