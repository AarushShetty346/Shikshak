// Learning sessions, like chats. Each has a local id (shown, and used for this device's storage)
// and a server id (a long random reference the server and the voice call use; the server also
// checks that this device owns it). Board, plan summary, files and settings are kept on this device
// (localStorage for small state, IndexedDB for files) so a class reopens exactly as it was, even if
// the server lost it.

import { applyEvent, emptySnapshot } from "../../../shared/boardState";
import type { BoardEvent, BoardSnapshot, DocMeta, Language } from "../../../shared/types";
import { apiFetch, ApiError } from "./api";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const INDEX_KEY = "shikshak.sessions";

export type Speed = "slower" | "normal" | "faster";

/** The parts of a lesson plan the browser may see (answers stay on the server). */
export interface PublicPlan {
  readable: "yes" | "partly" | "no" | "no_notes";
  readable_note: string;
  topic: string;
  title: string;
  goal: string;
  sections: { title: string; from_notes: boolean }[];
  practice: { problem: string }[];
}

export interface SessionMeta {
  id: string;
  /** The server's id for this session (absent until created on the server). */
  serverId?: string;
  learnerId?: string | null;
  name: string;
  studentName: string;
  grade: string;
  language: Language;
  topic: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  /** True once a class has been started at least once (Resume instead of Start). */
  started: boolean;
}

export interface SessionData {
  snapshot: BoardSnapshot;
  plan: PublicPlan | null;
  docs: DocMeta[];
  speed: Speed;
  handsFree: boolean;
  /** The quick check was offered (started or skipped) for this class. */
  quickOffered?: boolean;
}

export const isDev = typeof location !== "undefined" && new URLSearchParams(location.search).has("dev");

// ---------- storage that can fail ----------

let storageFailed = false;
const listeners = new Set<() => void>();
/** Called once when this device can't save (storage full, blocked, private mode). */
export function onStorageFailure(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export const storageWorking = () => !storageFailed;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback; // blocked or corrupted: start from the fallback
  }
}

export function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    if (!storageFailed) {
      storageFailed = true;
      for (const fn of listeners) fn();
    }
    return false;
  }
}

// ---------- sessions ----------

export function newCode(): string {
  const existing = new Set(listSessions(true).map((s) => s.id));
  for (;;) {
    let code = "";
    for (const b of crypto.getRandomValues(new Uint8Array(6))) code += ALPHABET[b % ALPHABET.length];
    if (!existing.has(code)) return code;
  }
}

export function listSessions(includeArchived = false): SessionMeta[] {
  const all = read<unknown>(INDEX_KEY, []);
  return (Array.isArray(all) ? (all as SessionMeta[]) : [])
    .filter((s) => s && typeof s.id === "string")
    .filter((s) => includeArchived || !s.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSession(id: string): SessionMeta | undefined {
  return listSessions(true).find((s) => s.id === id);
}

export function saveSession(meta: SessionMeta) {
  const all = listSessions(true).filter((s) => s.id !== meta.id);
  write(INDEX_KEY, [...all, meta]);
}

export function updateSession(id: string, patch: Partial<SessionMeta>) {
  const meta = getSession(id);
  if (meta) saveSession({ ...meta, ...patch, updatedAt: patch.updatedAt ?? Date.now() });
}

const DEFAULT_DATA = (): SessionData => ({ snapshot: emptySnapshot(), plan: null, docs: [], speed: "normal", handsFree: false });

/** Older versions kept a list of events instead of a snapshot: replay them once. */
function migrate(raw: Record<string, unknown>): SessionData {
  // Only known fields survive: older versions also kept an event list and the plan's answer keys.
  const d = DEFAULT_DATA();
  const base: SessionData = {
    snapshot: (raw.snapshot as BoardSnapshot) ?? d.snapshot,
    plan: null,
    docs: Array.isArray(raw.docs) ? (raw.docs as DocMeta[]) : d.docs,
    speed: raw.speed === "slower" || raw.speed === "faster" ? raw.speed : "normal",
    handsFree: raw.handsFree === true,
    quickOffered: raw.quickOffered === true,
  };
  if (!raw.snapshot && Array.isArray(raw.events)) {
    let snap = emptySnapshot();
    for (const e of raw.events as BoardEvent[]) {
      if (!e || typeof e !== "object" || e.type === "mark" || e.type === "correct") continue; // old marks had no position
      try {
        snap = applyEvent(snap, e);
      } catch {
        // skip anything unreadable
      }
    }
    base.snapshot = snap;
  }
  const rawPlan = raw.plan as { plan?: PublicPlan } | PublicPlan | null | undefined;
  const plan = rawPlan && "plan" in rawPlan && rawPlan.plan ? rawPlan.plan : (rawPlan as PublicPlan | null | undefined);
  base.plan =
    plan && typeof plan === "object" && Array.isArray(plan.sections)
      ? {
          readable: plan.readable,
          readable_note: String(plan.readable_note ?? ""),
          topic: String(plan.topic ?? ""),
          title: String(plan.title ?? ""),
          goal: String(plan.goal ?? ""),
          sections: plan.sections.map((s) => ({ title: String(s.title ?? ""), from_notes: Boolean(s.from_notes) })),
          practice: (Array.isArray(plan.practice) ? plan.practice : []).map((p) => ({ problem: String(p.problem ?? "") })),
        }
      : null;
  if (!base.snapshot || base.snapshot.v !== 1 || !Array.isArray(base.snapshot.blocks)) base.snapshot = emptySnapshot();
  return base;
}

export function loadData(id: string): SessionData {
  const raw = read<Record<string, unknown> | null>(`shikshak.session.${id}`, null);
  return raw && typeof raw === "object" ? migrate(raw) : DEFAULT_DATA();
}

export function saveData(id: string, patch: Partial<SessionData>): boolean {
  // loadData returns only known fields, so this also drops anything an older version saved.
  return write(`shikshak.session.${id}`, { ...loadData(id), ...patch });
}

export async function deleteSession(id: string) {
  const meta = getSession(id);
  if (meta?.serverId) {
    await apiFetch(`/sessions/${meta.serverId}`, { method: "DELETE" }).catch((err) => {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    });
  }
  write(
    INDEX_KEY,
    listSessions(true).filter((s) => s.id !== id),
  );
  try {
    localStorage.removeItem(`shikshak.session.${id}`);
    localStorage.removeItem(`shikshak.board.${id}`);
  } catch {
    // ignore
  }
  const { deleteDocs } = await import("./docStore");
  await deleteDocs(id).catch(() => {});
}

interface ServerSession {
  id: string;
  label: string;
  plan: PublicPlan | null;
  docs: DocMeta[];
  started: boolean;
}

/**
 * Makes sure the server has this session and returns its server id. If the server lost it (or
 * never had it: sessions from before accounts), it is created again from what this device knows;
 * the board is then restored from this device when the class opens.
 */
export async function ensureServerSession(meta: SessionMeta): Promise<{ serverId: string; recreated: boolean; plan: PublicPlan | null }> {
  if (meta.serverId) {
    try {
      const r = await apiFetch<{ session: ServerSession }>(`/sessions/${meta.serverId}`);
      return { serverId: r.session.id, recreated: false, plan: r.session.plan };
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
  }
  const r = await apiFetch<{ session: ServerSession }>("/sessions", {
    body: { label: meta.name, topic: meta.topic, grade: meta.grade, language: meta.language, studentName: meta.studentName, learnerId: meta.learnerId ?? null },
  });
  updateSession(meta.id, { serverId: r.session.id, updatedAt: meta.updatedAt });
  return { serverId: r.session.id, recreated: true, plan: null };
}

/** Which session is open, in the URL (#/s/ABC123) so refresh and back/forward work. */
export function sessionFromHash(): string | null {
  const m = /^#\/s\/([A-Z0-9]{4,12})$/.exec(location.hash);
  return m ? m[1] : null;
}
