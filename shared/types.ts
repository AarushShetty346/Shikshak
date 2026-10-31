// Types shared by the browser and the server.

import type { Diagram } from "./diagram";

export type Point = [number, number];

/** A pen stroke in board coordinates: x in board units, y grows downward without limit. */
export interface Stroke {
  id: string;
  points: Point[];
  /** A typed line (the Type tool): drawn as text; points[0] is its top-left, and the points trace its box. */
  text?: string;
  /** Font size of a typed line, in board units. */
  size?: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One handwritten line of the student's work, numbered from 1, top to bottom. */
export interface WrittenLine {
  index: number;
  box: Box;
  strokeIds: string[];
}

/** A part of the study plan, shown on the board when the tutor reaches it. */
export interface SectionInfo {
  n: number;
  of: number;
}

export type WriteStyle = "heading" | "text" | "equation" | "steps" | "your_turn";
export type Place = "next" | "right";
export type MarkStyle = "underline" | "circle" | "box" | "tick" | "arrow";
export type HintLevel = "nudge" | "hint" | "step";

/** Tutor blocks: things that take space on the board. Each carries a label (B1, B2...) the tutor can point at. */
export type BlockEvent =
  | { type: "write"; id: string; label: string; style: WriteStyle; lines: string[]; place: Place; replaces: string | null; questionId?: string | null }
  | { type: "draw"; id: string; label: string; diagram: Diagram; caption: string; place: Place; replaces: string | null }
  | { type: "steps"; id: string; label?: string; title: string; steps: string[]; section?: SectionInfo; checked?: boolean }
  | { type: "problem"; id: string; label?: string; problem: string; questionId?: string | null; kind?: "practice" | "diagnostic" | "transfer" }
  | { type: "plan"; id: string; label?: string; title: string; items: string[] }
  /** Start a fresh page (new topic). Earlier pages stay above; the board scrolls to the new one. */
  | { type: "page"; id: string }
  /** A real page of the student's uploaded material, shown on the board with its source. */
  | { type: "source"; id: string; label: string; docId: string; docName: string; page: number | null; caption: string; photo?: boolean }
  /**
   * "Fix it" on a photo of the student's paper: the same photo with the slips marked on it (each a
   * strip of the photo with the correction), and each question in it solved as an exam answer.
   */
  | { type: "fix"; id: string; label: string; photoLabel: string; docId: string; questions: FixQuestion[]; simulated?: boolean }
  /** One rung of the hint ladder for the current question (nudge, hint, one worked step). */
  | { type: "hint"; id: string; label: string; questionId: string; level: HintLevel; rung: number; of: number; text: string };

/** One question found in a photo by "Fix it". */
export interface FixQuestion {
  question: string;
  status: "correct" | "mistake" | "incomplete" | "unreadable";
  /** Where the student's lines go wrong on the photo, with what they should say. */
  marks: { top: number; bottom: number; fix: string }[];
  /** The full solution, one exam-style line each (=, ∴, ∵, ⇒). */
  solution: string[];
}

/**
 * Something the tutor puts on the shared board, or a change to it. These are saved in the board
 * snapshot and replayed exactly after a reload or reconnect.
 */
export type BoardEvent =
  | BlockEvent
  /** Point at something already on the board. line is 1-based within the block, or null for the whole block. */
  | { type: "highlight"; id: string; target: string; line: number | null; style: MarkStyle; note: string; band?: { top: number; bottom: number } | null }
  /** Rub out a block (its space stays, so the student's writing never moves). */
  | { type: "erase"; target: string }
  /** Rub out the student's own ink, because they asked: the last thing they drew, or all of it. */
  | { type: "wipe_ink"; scope: "last" | "all" }
  /** The doubt is answered: continue writing what was paused. */
  | { type: "resume" }
  /** Circle a line of a capture the student sent. box is that line's place on the board (board units). */
  | { type: "mark"; captureId: string; questionId: string | null; line: number; note: string; box: Box | null; on?: PhotoBand | null }
  | { type: "correct"; captureId: string | null; questionId: string | null; note: string; box: Box | null; on?: PhotoBand | null };

/**
 * A strip of a photo on the board (block label, and its top and bottom as fractions of the photo's
 * height). Marks on a photo of paper working use it instead of a board box: only the browser knows
 * where the photo is laid out.
 */
export interface PhotoBand {
  label: string;
  top: number;
  bottom: number;
}

/** Short-lived signals that are shown but never saved or replayed. */
export type Signal =
  /** The tutor is looking at the student's latest work; the browser replies with a capture. */
  | { type: "checking"; requestId: string }
  | { type: "unclear"; note: string }
  /** Progress of a Done submission: received by the server, read, or failed. */
  | { type: "review"; captureId: string; questionId: string | null; state: "received" | "done" | "failed" | "stale"; status?: string; summary?: string; marks?: { got: number; of: number; provisional: boolean } };

export interface HighlightState {
  id: string;
  target: string;
  line: number | null;
  style: MarkStyle;
  note: string;
  /** For a line of a photo: where that line is, as fractions of the photo's height. */
  band?: { top: number; bottom: number } | null;
}

export interface MarkState {
  captureId: string;
  questionId: string | null;
  line: number;
  note: string;
  box: Box | null;
  on?: PhotoBand | null;
}

export interface CorrectState {
  captureId: string | null;
  questionId: string | null;
  note: string;
  box: Box | null;
  on?: PhotoBand | null;
}

/** The whole board as the student sees it: what a reload or reconnect restores. */
export interface BoardSnapshot {
  v: 1;
  /** Number of board events applied so far. Events carry the seq they produce. */
  seq: number;
  blocks: (BlockEvent & { erased?: boolean })[];
  highlights: HighlightState[];
  section: number | null;
  /** The question the student is answering now (public text only). */
  question: { id: string; text: string } | null;
  mark: MarkState | null;
  correct: CorrectState | null;
}

/** An uploaded file in a session, without its contents. */
export interface DocMeta {
  id: string;
  name: string;
  mediaType: string;
  pages: number | null;
  uploadedAt: number;
  bytes?: number;
}

/** Server -> browser WebSocket messages. sessionId lets the browser drop anything for another session. */
export type ServerMessage =
  | { kind: "welcome"; sessionId: string; snapshot: BoardSnapshot; docs: DocMeta[]; restored: boolean }
  | { kind: "event"; sessionId: string; seq: number; event: BoardEvent }
  | { kind: "signal"; sessionId: string; signal: Signal }
  | { kind: "error"; message: string };

/**
 * Browser -> server. Validated on the server (see shared/protocol.ts); anything else is rejected.
 * capture: the student's latest work as a PNG with line numbers in the margin, plus where each
 * line is on the board (so a correction circle can be restored later).
 */
export type ClientMessage =
  | {
      kind: "capture";
      id: string;
      reason: "done" | "request";
      /** For a request: which "checking" signal this answers. */
      requestId?: string | null;
      /** Which question this work answers (null if none on the board). */
      questionId: string | null;
      png: string | null;
      lineCount: number;
      lines: Box[];
      /** The student wrote over a photo pinned on the board: png is that photo with their ink on top. */
      photoLabel?: string | null;
    }
  /** The student interrupted (Stop button, or pressed Talk while the tutor was speaking). */
  | { kind: "interrupt"; reason: "doubt" | "speech" }
  /** After a server restart: the board this device saved. Adopted only if the server has nothing. */
  | { kind: "hydrate"; snapshot: BoardSnapshot }
  /** Ask for the full snapshot again (the browser noticed a gap in event numbers). */
  | { kind: "sync" };

export type Language = "hi" | "hinglish" | "en" | "ta" | "te";

export const LANGUAGE_NAMES: Record<Language, string> = {
  hi: "Hindi",
  hinglish: "Hinglish (Hindi-English mix, Roman script)",
  en: "English",
  ta: "Tamil",
  te: "Telugu",
};

/** The language code Bolna's voice runs in for each choice. Hinglish uses the Hindi voice. */
export const VOICE_LANGUAGE: Record<Language, "hi" | "en" | "ta" | "te"> = { hi: "hi", hinglish: "hi", en: "en", ta: "ta", te: "te" };

/**
 * How far each language has been checked. Tamil and Telugu work through the same providers but
 * have not been reviewed by a fluent speaker yet, so the app labels them "preview".
 */
export const LANGUAGE_STATUS: Record<Language, "reviewed" | "preview"> = { hi: "reviewed", hinglish: "reviewed", en: "reviewed", ta: "reviewed", te: "reviewed" };

export function isLanguage(v: unknown): v is Language {
  return typeof v === "string" && v in LANGUAGE_NAMES;
}

/** The tutor's first sentence, already in the student's language (sent as {{greeting}}). */
export function greetingFor(language: Language, name: string, topic: string, resuming = false): string {
  const who = name && name !== "student" ? ` ${name}` : "";
  if (resuming) {
    switch (language) {
      case "hi":
        return `वापस स्वागत है${who}! चलिए, जहाँ रुके थे वहीं से आगे पढ़ते हैं।`;
      case "en":
        return `Welcome back${who}! Let's pick up where we left off.`;
      case "ta":
        return `மீண்டும் வருக${who}! நிறுத்திய இடத்திலிருந்து தொடரலாம்.`;
      case "te":
        return `మళ్ళీ స్వాగతం${who}! ఆపిన చోటు నుండి కొనసాగిద్దాం.`;
      default:
        return `Welcome back${who}! Chalo, jahan ruke the wahin se aage badhte hain.`;
    }
  }
  switch (language) {
    case "hi":
      return `नमस्ते${who}! मैं शिक्षक हूँ, आपकी ट्यूटर। आज हम ${topic} पढ़ेंगे। शुरू करें?`;
    case "en":
      return `Hello${who}! I am Shikshak, your tutor. Today we'll learn ${topic}. Shall we start?`;
    case "ta":
      return `வணக்கம்${who}! நான் ஷிக்ஷக், உங்கள் ஆசிரியர். இன்று நாம் ${topic} படிப்போம். தொடங்கலாமா?`;
    case "te":
      return `నమస్తే${who}! నేను శిక్షక్, మీ ట్యూటర్‌ని. ఈ రోజు మనం ${topic} నేర్చుకుందాం. మొదలుపెడదామా?`;
    default:
      return `Namaste${who}! Main Shikshak hoon, aapki tutor. Aaj hum ${topic} padhenge. Shuru karein?`;
  }
}
