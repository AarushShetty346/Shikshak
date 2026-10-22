import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardEvent, ClientMessage, ServerMessage } from "../../../shared/types";

/**
 * Live connection to the server. Board events (from the agent's tool calls) arrive here;
 * notebook snapshots go back. Reconnects on its own and replays the board after a reconnect.
 */
export function useBoardSocket(sessionCode: string, onEvent: (e: BoardEvent, replay: boolean) => void, onReset: () => void) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws?code=${encodeURIComponent(sessionCode)}`);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 1000);
      };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data) as ServerMessage;
        if (msg.kind === "welcome") {
          onResetRef.current();
          for (const e of msg.replay) onEventRef.current(e, true);
        } else if (msg.kind === "board") {
          onEventRef.current(msg.event, false);
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [sessionCode]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { connected, send };
}
