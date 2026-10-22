import { createHash } from "node:crypto";
import type { WebSocket } from "ws";
import type { BoardEvent, ServerMessage } from "../shared/types";
import type { LookResult } from "./look";
import type { StudyPlan } from "./plan";

/** The student's work as sent by the browser (PNG with numbered lines). */
export interface Capture {
  id: string;
  reason: "done" | "request";
  png: string | null;
  lineCount: number;
  at: number;
  /** Same drawing => same hash, so a Done press and the tutor's later look share one analysis. */
  hash: string;
}

export interface Session {
  code: string;
  sockets: Set<WebSocket>;
  lastActive: number;
  /** Latest capture of the student's work. */
  capture: Capture | null;
  /** Analyses by capture hash; started on Done so the tutor's look is usually instant. */
  analyses: Map<string, Promise<LookResult>>;
  problem: { text: string; answer?: string; hint?: string } | null;
  language: string;
  /** Prepared study plan (from notes or a topic), with where the tutor has got to. */
  study: { plan: StudyPlan; section: number; practice: number; lastSectionAt: number; lastLabel?: string } | null;
  /** Tutor's recent board lines, as context for reading the student's work. */
  recentBoard: string[];
  /** Every labelled tutor block, so the tutor can point back at them (B1, B2...). */
  blocks: BoardBlock[];
  /** Where the lesson was when the student last interrupted, to resume from. */
  interrupt: { at: number; label: string | null; summary: string; section: number | null } | null;
  /** Board events, replayed when the tab reconnects. */
  history: BoardEvent[];
}

export interface BoardBlock {
  label: string;
  kind: string;
  summary: string;
  lines: number;
  erased: boolean;
}

const sessions = new Map<string, Session>();

export function nextLabel(s: Session): string {
  return `B${s.blocks.length + 1}`;
}

export function recordBlock(s: Session, block: Omit<BoardBlock, "erased">) {
  s.blocks.push({ ...block, erased: false });
}

export function findBlock(s: Session, label: string): BoardBlock | undefined {
  const key = label.trim().toUpperCase();
  return s.blocks.find((b) => b.label === key);
}

/** What is on the board now, compactly, for the tutor's LLM (it can't see the screen). */
export function boardMap(s: Session, limit = 8): string {
  const live = s.blocks.filter((b) => !b.erased).slice(-limit);
  if (!live.length) return "The board is empty.";
  return live.map((b) => `${b.label} (${b.kind}): ${b.summary}`).join(" | ");
}

export function normalizeCode(code: unknown): string {
  return String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function getOrCreate(code: string): Session {
  const key = normalizeCode(code);
  let s = sessions.get(key);
  if (!s) {
    s = {
      code: key,
      sockets: new Set(),
      lastActive: Date.now(),
      capture: null,
      analyses: new Map(),
      problem: null,
      language: "hinglish",
      study: null,
      recentBoard: [],
      blocks: [],
      interrupt: null,
      history: [],
    };
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

const HISTORY_LIMIT = 120;

export function emit(s: Session, event: BoardEvent) {
  if (event.type !== "checking" && event.type !== "unclear") s.history.push(event);
  if (s.history.length > HISTORY_LIMIT) s.history.splice(0, s.history.length - HISTORY_LIMIT);
  if (event.type === "steps") s.recentBoard = [...s.recentBoard, ...(event.title ? [event.title] : []), ...event.steps].slice(-12);
  if (event.type === "problem") s.recentBoard = [`Problem: ${event.problem}`];
  const msg: ServerMessage = { kind: "board", event };
  const data = JSON.stringify(msg);
  for (const ws of s.sockets) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
  touch(s);
}

export function hashPng(png: string | null): string {
  return createHash("sha1").update(png ?? "").digest("hex");
}

/** Waits briefly for the browser to send a capture newer than `since`. */
export async function freshCapture(s: Session, since: number, timeoutMs = 1500): Promise<Capture | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (s.capture && s.capture.at >= since) return s.capture;
    await new Promise((r) => setTimeout(r, 50));
  }
  return s.capture;
}

/** For tests. */
export function resetSessions() {
  sessions.clear();
}
