import { useCallback, useEffect, useRef, useState } from "react";
import type { WsServerMsg, WsClientMsg } from "@channelers/shared";

/**
 * One socket to the brain. Parses every server message and hands it to `onMessage`;
 * returns `send` for client commands. Auto-reconnects.
 */
export function useBrainSocket(onMessage?: (m: WsServerMsg) => void) {
  const [connected, setConnected] = useState(false);
  const cb = useRef(onMessage);
  cb.current = onMessage;
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1000);
      };
      ws.onmessage = (ev) => {
        try {
          cb.current?.(JSON.parse(ev.data) as WsServerMsg);
        } catch {
          /* ignore non-JSON frames */
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((cmd: WsClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd));
  }, []);

  return { connected, send };
}
