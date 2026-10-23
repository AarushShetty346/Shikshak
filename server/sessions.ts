// Learning sessions on the server. A session belongs to one device (and optionally one learner),
// has a long random id (also what the voice call carries so tool calls reach the right board), and
// keeps:
//   - the board snapshot the student sees (public, also kept on the device),
//   - teacher-only state: the current question's answer and solution, hint progress, the plan's
//     answer keys. Never sent to the browser.
//   - runtime state: open sockets, uploaded files (memory only), recent captures and analyses.
// Persistent parts are saved through the store; idle sessions are unloaded from memory and expired
// ones deleted (see sweep()).

import { createHash } from "node:crypto";
import type { WebSocket } from "ws";
import { applyEvent, emptySnapshot, isBlockEvent } from "../shared/boardState";
import type { BoardEvent, BoardSnapshot, Box, DocMeta, Language, ServerMessage, Signal } from "../shared/types";
import { getDevice, randomId, updateDevice } from "./auth";
import { config } from "./config";
import type { LookResult } from "./look";
import type { StudyPlan } from "./plan";
import { store } from "./store";

/** The student's work as sent by the browser (PNG with numbered lines, and where each line is). */
export interface Capture {
  id: string;
  reason: "done" | "request";
  requestId: string | null;
  questionId: string | null;
  png: string | null;
  lineCount: number;
  lines: Box[];
  at: number;
  /** Hash of the image only; analyses are cached by image + full question context (see look.ts). */
  hash: string;
}

/** The question the student is answering, with what only the teacher knows. */
export interface ActiveQuestion {
  id: string;
  text: string;
  /** Expected final answer, if known. Never sent to the browser. */
  answer?: string;
  hint?: string;
  /** Library problem id when the question comes from the checked problem library. */
  problemId?: string;
  kind: "practice" | "diagnostic" | "transfer" | "tutor";
  askedAt: number;
  /** Hint ladder progress for this question (0 = no help given yet). */
  rung: number;
}

export interface BoardBlock {
  label: string;
  kind: string;
  summary: string;
  lines: number;
  erased: boolean;
}

export interface SessionDoc extends DocMeta {
  /** base64 */
  data: string;
  bytes: number;
}

export interface StudyState {
  plan: StudyPlan;
  section: number;
  practice: number;
  lastSectionAt: number;
  lastLabel?: string;
}

/** What is saved for a session. */
export interface SessionRecord {
  id: string;
  /** Short name shown to the student (not a credential). */
  label: string;
  deviceId: string;
  learnerId: string | null;
  createdAt: number;
  lastActive: number;
  language: Language;
  grade: string;
  topic: string;
  studentName: string;
  board: BoardSnapshot;
  /** The tutor's view of the board: every labelled block, for pointing back at them. */
  blocks: BoardBlock[];
  labelCounter: number;
  recentBoard: string[];
  interrupt: { at: number; label: string | null; summary: string; section: number | null } | null;
  study: StudyState | null;
  problem: ActiveQuestion | null;
  docsMeta: DocMeta[];
  /** Voice calls minted for this session (for estimates and limits). */
  calls: { id: string; startedAt: number; endedAt: number | null }[];
}

export interface Session extends SessionRecord {
  sockets: Set<WebSocket>;
  docs: SessionDoc[];
  captures: Map<string, Capture>;
  analyses: Map<string, Promise<LookResult>>;
  /** Ids of "checking" requests still waiting for the browser's capture. */
  pendingRequests: Map<string, number>;
}

const loaded = new Map<string, Session>();
const SAFE_SESSION = /^s_[A-Za-z0-9_-]{16,40}$/;

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function shortLabel(): string {
  let out = "";
  for (const b of randomId(8)) out += ALPHABET[b.charCodeAt(0) % ALPHABET.length];
  return out.slice(0, 6);
}

function persisted(s: Session): SessionRecord {
  return {
    id: s.id,
    label: s.label,
    deviceId: s.deviceId,
    learnerId: s.learnerId,
    createdAt: s.createdAt,
    lastActive: s.lastActive,
    language: s.language,
    grade: s.grade,
    topic: s.topic,
    studentName: s.studentName,
    board: s.board,
    blocks: s.blocks,
    labelCounter: s.labelCounter,
    recentBoard: s.recentBoard,
    interrupt: s.interrupt,
    study: s.study,
    problem: s.problem,
    docsMeta: s.docs.length ? s.docs.map(docMeta) : s.docsMeta,
    calls: s.calls.slice(-50),
  };
}

export function docMeta(d: SessionDoc): DocMeta {
  return { id: d.id, name: d.name, mediaType: d.mediaType, pages: d.pages, uploadedAt: d.uploadedAt, bytes: d.bytes };
}

function live(rec: SessionRecord): Session {
  return { ...rec, sockets: new Set(), docs: [], captures: new Map(), analyses: new Map(), pendingRequests: new Map() };
}

export function save(s: Session) {
  store.put<SessionRecord>("sessions", s.id, persisted(s));
}

export interface NewSession {
  learnerId?: string | null;
  label?: string;
  language?: Language;
  grade?: string;
  topic?: string;
  studentName?: string;
}

export class LimitError extends Error {}

export function createSession(deviceId: string, opts: NewSession = {}): Session {
  const mine = getDevice(deviceId)?.sessions ?? [];
  if (mine.length >= config.limits.maxSessionsPerOwner()) throw new LimitError(`This device already has ${mine.length} sessions. Delete old ones to start a new one.`);
  const now = Date.now();
  const s = live({
    id: `s_${randomId(18)}`,
    label: (opts.label || shortLabel()).slice(0, 40),
    deviceId,
    learnerId: opts.learnerId ?? null,
    createdAt: now,
    lastActive: now,
    language: opts.language ?? "hinglish",
    grade: opts.grade ?? "10",
    topic: (opts.topic ?? "").slice(0, 120),
    studentName: (opts.studentName ?? "").slice(0, 40),
    board: emptySnapshot(),
    blocks: [],
    labelCounter: 0,
    recentBoard: [],
    interrupt: null,
    study: null,
    problem: null,
    docsMeta: [],
    calls: [],
  });
  loaded.set(s.id, s);
  store.put<SessionRecord>("sessions", s.id, persisted(s), { immediate: true });
  updateDevice(deviceId, (d) => (d.sessions = [...(d.sessions ?? []), s.id]));
  evictIfNeeded();
  return s;
}

/** Any session by id (loads it from disk if needed). For tool calls, which are authenticated separately. */
export function getSession(id: unknown): Session | null {
  const key = String(id ?? "").trim();
  if (!SAFE_SESSION.test(key)) return null;
  const hit = loaded.get(key);
  if (hit) return hit;
  const rec = store.get<SessionRecord>("sessions", key);
  if (!rec) return null;
  const s = live(rec);
  loaded.set(key, s);
  evictIfNeeded();
  return s;
}

/** A session only if this device owns it. */
export function sessionForDevice(id: unknown, deviceId: string): Session | null {
  const s = getSession(id);
  return s && s.deviceId === deviceId ? s : null;
}

/** Tool calls: the exact session the call names, never a fallback. */
export const resolve = getSession;

export function listSessions(deviceId: string): SessionRecord[] {
  return (getDevice(deviceId)?.sessions ?? [])
    .map((id) => getSession(id))
    .filter((s): s is Session => Boolean(s && s.deviceId === deviceId))
    .map(persisted);
}

/** Deletes a session everywhere: sockets closed, files and captures dropped, saved state removed. */
export function deleteSession(s: Session) {
  for (const ws of s.sockets) ws.close(4004, "session deleted");
  s.sockets.clear();
  s.docs = [];
  s.captures.clear();
  s.analyses.clear();
  loaded.delete(s.id);
  store.delete("sessions", s.id);
  updateDevice(s.deviceId, (d) => (d.sessions = (d.sessions ?? []).filter((x) => x !== s.id)));
  for (const id of store.ids("attempts")) if (id.startsWith(`${s.id}_`)) store.delete("attempts", id);
  store.delete("reports", s.id);
}

export function nextLabel(s: Session): string {
  s.labelCounter = Math.max(s.labelCounter, s.blocks.length) + 1;
  return `B${s.labelCounter}`;
}

export function recordBlock(s: Session, block: Omit<BoardBlock, "erased">) {
  s.blocks.push({ ...block, erased: false });
  if (s.blocks.length > config.limits.maxBoardBlocks()) s.blocks.splice(0, s.blocks.length - config.limits.maxBoardBlocks());
}

export function findBlock(s: Session, label: string): BoardBlock | undefined {
  const key = label.trim().toUpperCase();
  return s.blocks.find((b) => b.label === key);
}

/** What is on the board now, compactly, for the tutor's LLM (it can't see the screen). */
export function boardMap(s: Session, limit = 8): string {
  const shown = s.blocks.filter((b) => !b.erased).slice(-limit);
  if (!shown.length) return "The board is empty.";
  return shown.map((b) => `${b.label} (${b.kind}): ${b.summary}`).join(" | ");
}

export function touch(s: Session) {
  s.lastActive = Date.now();
}

function send(s: Session, msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const ws of s.sockets) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

/** Applies a board event, saves it, and sends it to every open tab of this session. */
export function emit(s: Session, event: BoardEvent) {
  s.board = applyEvent(s.board, event, config.limits.maxBoardBlocks());
  if (event.type === "steps") s.recentBoard = [...s.recentBoard, ...(event.title ? [event.title] : []), ...event.steps].slice(-12);
  if (event.type === "problem") s.recentBoard = [`Problem: ${event.problem}`];
  touch(s);
  save(s);
  send(s, { kind: "event", sessionId: s.id, seq: s.board.seq, event });
}

/** A short-lived signal (checking, review progress): sent, never saved. */
export function signal(s: Session, sig: Signal) {
  send(s, { kind: "signal", sessionId: s.id, signal: sig });
}

export function welcome(s: Session, restored = false): ServerMessage {
  return { kind: "welcome", sessionId: s.id, snapshot: s.board, docs: s.docs.length ? s.docs.map(docMeta) : [], restored };
}

/**
 * Rebuilds a session's board from what the browser saved, after the server lost it (a restart on
 * a host without a disk). Only when the server's board is empty, so it can never overwrite a live
 * lesson. Teacher-only state (answers) can't come from the browser and stays empty.
 */
export function hydrate(s: Session, snap: BoardSnapshot): boolean {
  if (s.board.seq > 0 || s.board.blocks.length) return false;
  s.board = snap;
  s.blocks = [];
  for (const b of snap.blocks) {
    if (!isBlockEvent(b) || !("label" in b) || !b.label) continue;
    const lines = b.type === "write" ? b.lines : b.type === "steps" ? b.steps : [];
    const summary =
      b.type === "write" || b.type === "steps"
        ? lines.join(" / ")
        : b.type === "problem"
          ? b.problem
          : b.type === "plan"
            ? b.title
            : b.type === "source"
              ? `${b.docName} page ${b.page ?? "-"}`
              : b.type === "hint"
                ? `${b.level}: ${b.text}`
                : b.caption;
    s.blocks.push({ label: b.label, kind: b.type === "write" ? b.style : b.type, summary: summary.slice(0, 120), lines: Math.max(1, lines.length), erased: Boolean(b.erased) });
  }
  s.labelCounter = s.blocks.reduce((m, b) => Math.max(m, Number(b.label.slice(1)) || 0), 0);
  if (snap.question && !s.problem) s.problem = { id: snap.question.id, text: snap.question.text, kind: "tutor", askedAt: Date.now(), rung: 0 };
  save(s);
  return true;
}

export function hashPng(png: string | null): string {
  return createHash("sha1").update(png ?? "").digest("hex");
}

/** Keeps the last captures; only the newest few keep their image (older ones keep line positions). */
export function storeCapture(s: Session, c: Capture) {
  s.captures.set(c.id, c);
  while (s.captures.size > 20) s.captures.delete(s.captures.keys().next().value!);
  const ids = [...s.captures.keys()];
  for (const id of ids.slice(0, -3)) {
    const old = s.captures.get(id)!;
    if (old.png) s.captures.set(id, { ...old, png: null });
  }
}

/** Latest capture for the current question. */
export function latestCapture(s: Session): Capture | null {
  let last: Capture | null = null;
  for (const c of s.captures.values()) if (!last || c.at >= last.at) last = c;
  return last;
}

/**
 * Waits for the browser's answer to one specific "checking" request. Never falls back to older
 * work: if no fresh capture arrives in time, returns null.
 */
export async function awaitCapture(s: Session, requestId: string, timeoutMs = 2500): Promise<Capture | null> {
  s.pendingRequests.set(requestId, Date.now());
  const until = Date.now() + timeoutMs;
  try {
    while (Date.now() < until) {
      for (const c of s.captures.values()) if (c.requestId === requestId) return c;
      await new Promise((r) => setTimeout(r, 40));
    }
    return null;
  } finally {
    s.pendingRequests.delete(requestId);
  }
}

// ---------- uploaded files: memory accounting ----------

export function totalDocBytes(): number {
  let n = 0;
  for (const s of loaded.values()) for (const d of s.docs) n += d.bytes;
  return n;
}

/** Frees memory by dropping files of the least recently active sessions (their devices re-send them on reconnect). */
export function makeRoomForDocs(needed: number, except: Session) {
  const cap = config.limits.maxTotalDocBytes();
  if (totalDocBytes() + needed <= cap) return true;
  const victims = [...loaded.values()].filter((s) => s !== except && s.docs.length && s.sockets.size === 0).sort((a, b) => a.lastActive - b.lastActive);
  for (const v of victims) {
    v.docsMeta = v.docs.map(docMeta);
    v.docs = [];
    if (totalDocBytes() + needed <= cap) return true;
  }
  return totalDocBytes() + needed <= cap;
}

// ---------- lifecycle ----------

function evictIfNeeded() {
  const max = config.limits.maxLoadedSessions();
  if (loaded.size <= max) return;
  const idle = [...loaded.values()].filter((s) => s.sockets.size === 0).sort((a, b) => a.lastActive - b.lastActive);
  for (const s of idle) {
    if (loaded.size <= max) break;
    unload(s);
  }
}

function unload(s: Session) {
  save(s);
  store.unload("sessions", s.id);
  loaded.delete(s.id);
}

/** Unloads idle sessions and deletes expired ones. Runs every few minutes. */
export function sweep(now = Date.now()) {
  const idleMs = config.limits.idleUnloadMinutes() * 60_000;
  for (const s of [...loaded.values()]) if (s.sockets.size === 0 && now - s.lastActive > idleMs) unload(s);
  const ttl = config.limits.sessionTtlDays() * 86_400_000;
  for (const id of store.ids("sessions")) {
    const rec = loaded.get(id) ?? store.get<SessionRecord>("sessions", id);
    if (rec && now - rec.lastActive > ttl) {
      const s = getSession(id);
      if (s) deleteSession(s);
    }
  }
}

let sweeper: ReturnType<typeof setInterval> | null = null;
export function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => sweep(), 5 * 60_000);
  sweeper.unref?.();
}

export function loadedCount() {
  return loaded.size;
}

/** For tests. */
export function resetSessions() {
  for (const s of loaded.values()) for (const ws of s.sockets) ws.terminate();
  loaded.clear();
}
