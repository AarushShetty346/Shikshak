import type { WebSocket } from "ws";
import type { BoardEvent, ServerMessage } from "../shared/types";

export interface Session {
  code: string;
  sockets: Set<WebSocket>;
  lastActive: number;
  /** Latest snapshot of the student's notebook. */
  canvas: { png: string | null; lineCount: number; at: number } | null;
  problem: { text: string; answer?: string } | null;
  language: string;
  /** Board events since the last clear, replayed when the tab reconnects. */
  history: BoardEvent[];
}

const sessions = new Map<string, Session>();

export function normalizeCode(code: unknown): string {
  return String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function getOrCreate(code: string): Session {
  const key = normalizeCode(code);
  let s = sessions.get(key);
  if (!s) {
    s = { code: key, sockets: new Set(), lastActive: Date.now(), canvas: null, problem: null, language: "hinglish", history: [] };
    sessions.set(key, s);
  }
  return s;
}

/**
 * Finds the session a tool call belongs to. The agent should pass the exact code (Bolna fills it
 * in from the prompt variable), but if it is mangled we fall back to the most recently active
 * session that has a browser connected, so a one-student demo can't break on a typo.
 */
export function resolve(code: unknown): Session | null {
  const exact = sessions.get(normalizeCode(code));
  if (exact) return exact;
  let best: Session | null = null;
  for (const s of sessions.values()) {
    if (s.sockets.size === 0) continue;
    if (!best || s.lastActive > best.lastActive) best = s;
  }
  return best;
}

export function touch(s: Session) {
  s.lastActive = Date.now();
}

export function emit(s: Session, event: BoardEvent) {
  if (event.type === "clear") s.history = [];
  else if (event.type !== "checking") s.history.push(event);
  if (s.history.length > 50) s.history.splice(0, s.history.length - 50);
  const msg: ServerMessage = { kind: "board", event };
  const data = JSON.stringify(msg);
  for (const ws of s.sockets) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
  touch(s);
}

/** For tests. */
export function resetSessions() {
  sessions.clear();
}
