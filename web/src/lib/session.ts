// Learning sessions, like chats: each has its own id (also the code that links the voice call to
// this board), board, strokes, plan, uploaded files and settings. Kept on this device
// (localStorage for small state, IndexedDB for files). A new session always starts blank.

import type { BoardEvent, DocMeta, Language } from "../../../shared/types";
import type { PlanResult } from "../components/Setup";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const INDEX_KEY = "shikshak.sessions";

export type Speed = "slower" | "normal" | "faster";

export interface SessionMeta {
  id: string;
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
  events: BoardEvent[];
  plan: PlanResult | null;
  docs: DocMeta[];
  speed: Speed;
  handsFree: boolean;
}

export const isDev = new URLSearchParams(location.search).has("dev");

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the lesson still works, it just won't be saved on this device
  }
}

export function newCode(): string {
  const existing = new Set(listSessions(true).map((s) => s.id));
  for (;;) {
    let code = "";
    for (const b of crypto.getRandomValues(new Uint8Array(6))) code += ALPHABET[b % ALPHABET.length];
    if (!existing.has(code)) return code;
  }
}

export function listSessions(includeArchived = false): SessionMeta[] {
  return read<SessionMeta[]>(INDEX_KEY, [])
    .filter((s) => includeArchived || !s.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSession(id: string): SessionMeta | undefined {
  return read<SessionMeta[]>(INDEX_KEY, []).find((s) => s.id === id);
}

export function saveSession(meta: SessionMeta) {
  const all = read<SessionMeta[]>(INDEX_KEY, []).filter((s) => s.id !== meta.id);
  write(INDEX_KEY, [...all, meta]);
}

export function updateSession(id: string, patch: Partial<SessionMeta>) {
  const meta = getSession(id);
  if (meta) saveSession({ ...meta, ...patch, updatedAt: patch.updatedAt ?? Date.now() });
}

export function loadData(id: string): SessionData {
  return read<SessionData>(`shikshak.session.${id}`, { events: [], plan: null, docs: [], speed: "normal", handsFree: false });
}

export function saveData(id: string, patch: Partial<SessionData>) {
  write(`shikshak.session.${id}`, { ...loadData(id), ...patch });
}

export async function deleteSession(id: string) {
  const all = read<SessionMeta[]>(INDEX_KEY, []).filter((s) => s.id !== id);
  write(INDEX_KEY, all);
  try {
    localStorage.removeItem(`shikshak.session.${id}`);
    localStorage.removeItem(`shikshak.board.${id}`);
  } catch {
    // ignore
  }
  const { deleteDocs } = await import("./docStore");
  await deleteDocs(id).catch(() => {});
}

/** Which session is open, in the URL (#/s/ABC123) so refresh and back/forward work. */
export function sessionFromHash(): string | null {
  const m = /^#\/s\/([A-Z0-9]{4,12})$/.exec(location.hash);
  return m ? m[1] : null;
}
