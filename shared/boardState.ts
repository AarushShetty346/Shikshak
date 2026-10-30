// The board as a snapshot, and the one function that applies an event to it. The server keeps the
// authoritative snapshot; the browser keeps a copy. Both use this same reducer, so a reload, a
// reconnect or a server restart restores exactly the same board, and applying an event twice (a
// duplicate after reconnect) changes nothing.

import type { BlockEvent, BoardEvent, BoardSnapshot } from "./types";

export function emptySnapshot(): BoardSnapshot {
  return { v: 1, seq: 0, blocks: [], highlights: [], section: null, question: null, mark: null, correct: null };
}

const BLOCK_TYPES = new Set(["write", "draw", "steps", "problem", "plan", "page", "source", "hint"]);

export function isBlockEvent(e: BoardEvent): e is BlockEvent {
  return BLOCK_TYPES.has(e.type);
}

export function blockLabel(b: BlockEvent): string | undefined {
  return "label" in b ? b.label : undefined;
}

/** The question a block poses, if any. */
function questionOf(e: BlockEvent): { id: string; text: string } | null {
  if (e.type === "problem") return { id: e.questionId || e.id, text: e.problem };
  if (e.type === "write" && e.style === "your_turn") return { id: e.questionId || e.id, text: e.lines.join(" ") };
  return null;
}

/**
 * Applies one event. Returns a new snapshot (inputs are never mutated). Events with a seq at or
 * below the snapshot's seq are duplicates and are ignored by the caller (see applySeq).
 */
export function applyEvent(snap: BoardSnapshot, e: BoardEvent, maxBlocks = 400): BoardSnapshot {
  const next: BoardSnapshot = { ...snap, seq: snap.seq + 1 };
  if (isBlockEvent(e)) {
    if (snap.blocks.some((b) => "id" in b && b.id === e.id)) return next; // same block twice
    let blocks = [...snap.blocks, { ...e }];
    // A block that replaces another rubs the old one out.
    if ((e.type === "write" || e.type === "draw") && e.replaces) blocks = blocks.map((b) => (blockLabel(b) === e.replaces ? { ...b, erased: true } : b));
    next.blocks = trimBlocks(blocks, maxBlocks);
    if (e.type === "steps" && e.section) next.section = e.section.n;
    const q = questionOf(e);
    if (q) {
      // A new question replaces the old one, and its marks no longer apply.
      next.question = q;
      next.mark = null;
      next.correct = null;
    }
    if (e.type === "page") next.highlights = [];
    return next;
  }
  switch (e.type) {
    case "highlight":
      next.highlights = [...snap.highlights.filter((h) => h.id !== e.id), { id: e.id, target: e.target, line: e.line, style: e.style, note: e.note, ...(e.band ? { band: e.band } : {}) }].slice(-6);
      return next;
    case "erase":
      next.blocks = snap.blocks.map((b) => (blockLabel(b) === e.target ? { ...b, erased: true } : b));
      next.highlights = snap.highlights.filter((h) => h.target !== e.target);
      return next;
    case "mark":
      next.mark = { captureId: e.captureId, questionId: e.questionId, line: e.line, note: e.note, box: e.box, ...(e.on ? { on: e.on } : {}) };
      next.correct = null;
      return next;
    case "correct":
      next.correct = { captureId: e.captureId, questionId: e.questionId, note: e.note, box: e.box, ...(e.on ? { on: e.on } : {}) };
      next.mark = null;
      return next;
    case "resume":
      return next;
  }
}

/** Keeps the board bounded: drops whole old pages (never part of the current one). */
function trimBlocks<T extends BlockEvent>(blocks: T[], max: number): T[] {
  if (blocks.length <= max) return blocks;
  let cut = 0;
  while (blocks.length - cut > max) {
    const nextPage = blocks.findIndex((b, i) => i > cut && b.type === "page");
    if (nextPage < 0) {
      // One giant page: drop oldest blocks, keeping the current question visible.
      cut = blocks.length - max;
      break;
    }
    cut = nextPage;
  }
  return blocks.slice(cut);
}

/**
 * The browser side: applies an event that carries its seq. Returns "dup" for an event already
 * applied, "gap" when events were missed (ask the server for a fresh snapshot), else the new board.
 */
export function applySeq(snap: BoardSnapshot, seq: number, e: BoardEvent, maxBlocks?: number): BoardSnapshot | "dup" | "gap" {
  if (seq <= snap.seq) return "dup";
  if (seq > snap.seq + 1) return "gap";
  return applyEvent(snap, e, maxBlocks);
}
