import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardEvent, BoardSnapshot, ClientMessage, DocMeta, ServerMessage, Signal } from "../../../shared/types";
import { apiFetch, ApiError } from "./api";

interface Handlers {
  /** This device's current board (the latest, not a copy from when the page opened). */
  snapshot: () => BoardSnapshot;
  /** Replace the board with the server's full snapshot (on connect, reconnect, or after a gap). */
  onSnapshot: (snap: BoardSnapshot, restored: boolean) => void;
  /** One board event. Return "gap" if events were missed; a fresh snapshot is then requested. */
  onEvent: (seq: number, event: BoardEvent) => "ok" | "dup" | "gap";
  onSignal: (signal: Signal) => void;
  /** The files the server has for this session (empty after a restart: send them again). */
  onDocs: (docs: DocMeta[]) => void;
  /** The session no longer exists on the server. */
  onGone?: () => void;
}

/**
 * Live connection to the server for ONE session. The server sends the whole board when the socket
 * opens, then numbered events. Anything addressed to another session is dropped, so a late event
 * from a previous lesson can never land on this board. Reconnects on its own with back-off; if the
 * server has lost the session's board (restart without a disk), it restores it from this device.
 */
export function useBoardSocket(serverId: string | null, handlers: Handlers) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    if (!serverId) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const send = (ws: WebSocket, msg: ClientMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    const schedule = () => {
      if (stopped) return;
      const delay = Math.min(10_000, 1000 * 2 ** Math.min(attempt++, 4));
      retry = setTimeout(connect, delay);
    };

    const connect = async () => {
      let ticket: string;
      try {
        ({ ticket } = await apiFetch<{ ticket: string }>(`/sessions/${serverId}/ws-ticket`, { method: "POST", body: {} }));
      } catch (err) {
        if (stopped) return;
        if (err instanceof ApiError && err.status === 404) return h.current.onGone?.();
        return schedule();
      }
      if (stopped) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws?ticket=${encodeURIComponent(ticket)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
      };
      ws.onclose = (e) => {
        if (wsRef.current === ws) wsRef.current = null;
        setConnected(false);
        if (e.code === 4004) return h.current.onGone?.();
        schedule();
      };
      ws.onmessage = (m) => {
        if (stopped) return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(m.data) as ServerMessage;
        } catch {
          return;
        }
        if (msg.kind === "error") return void console.warn("[board] server says:", msg.message);
        if (msg.sessionId !== serverId) return; // never another session's message
        if (msg.kind === "welcome") {
          const local = h.current.snapshot();
          const serverEmpty = msg.snapshot.seq === 0 && msg.snapshot.blocks.length === 0;
          if (serverEmpty && (local.seq > 0 || local.blocks.length) && !msg.restored) {
            // The server lost this board (restart): keep showing ours and give it back.
            send(ws, { kind: "hydrate", snapshot: local });
          } else {
            h.current.onSnapshot(msg.snapshot, msg.restored);
          }
          h.current.onDocs(msg.docs ?? []);
        } else if (msg.kind === "event") {
          if (h.current.onEvent(msg.seq, msg.event) === "gap") send(ws, { kind: "sync" });
        } else if (msg.kind === "signal") {
          h.current.onSignal(msg.signal);
        }
      };
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [serverId]);

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
