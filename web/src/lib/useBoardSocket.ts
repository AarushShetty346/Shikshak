import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardEvent, ClientMessage, DocMeta, ServerMessage } from "../../../shared/types";

interface Handlers {
  onEvent: (e: BoardEvent, replay: boolean) => void;
  onReset: () => void;
  /** What this device saved for the session, to restore the server after a restart. */
  saved: () => { events: BoardEvent[]; study: unknown };
  /** The documents the server has for this session (empty after a restart). */
  onDocs: (docs: DocMeta[]) => void;
}

/**
 * Live connection to the server for ONE session. Board events (from the tutor's tool calls) arrive
 * here; the student's work goes back. Anything addressed to another session is dropped, so a late
 * event from a previous lesson can never land on this board. Reconnects on its own; if the server
 * has lost the session (restart), it restores it from what this device saved.
 */
export function useBoardSocket(sessionCode: string, handlers: Handlers) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const h = useRef(handlers);
  h.current = handlers;

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
        if (stopped) return;
        const msg = JSON.parse(m.data) as ServerMessage;
        if (msg.kind === "welcome") {
          if (msg.sessionCode !== sessionCode) return;
          h.current.onReset();
          const saved = h.current.saved();
          if (msg.replay.length === 0 && saved.events.length) {
            // Server restarted: show what this device kept and give it back to the server.
            for (const e of saved.events) h.current.onEvent(e, true);
            ws.send(JSON.stringify({ kind: "hydrate", events: saved.events, study: saved.study } satisfies ClientMessage));
          } else {
            for (const e of msg.replay) h.current.onEvent(e, true);
          }
          h.current.onDocs(msg.docs ?? []);
        } else if (msg.kind === "board") {
          if (msg.sessionCode !== sessionCode) return; // never another session's event
          h.current.onEvent(msg.event, false);
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [sessionCode]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  return { connected, send };
}
