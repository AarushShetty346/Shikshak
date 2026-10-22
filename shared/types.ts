// Types shared by the browser and the server.

export type Point = [number, number];

/** A pen stroke in board coordinates: x in 0..1000 (board width), y grows downward without limit. */
export interface Stroke {
  id: string;
  points: Point[];
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

/**
 * Something the tutor puts on the shared board, or a change to it. The server sends these to the
 * browser; the board lays tutor blocks out one after another, below whatever is already written.
 */
export type BoardEvent =
  | { type: "steps"; id: string; title: string; steps: string[]; section?: SectionInfo }
  | { type: "problem"; id: string; problem: string }
  | { type: "plan"; id: string; title: string; items: string[] }
  /** Start a fresh page (new topic). Earlier pages stay above; the board scrolls to the new one. */
  | { type: "page"; id: string }
  /** The tutor is looking at the student's latest work; the browser replies with a capture. */
  | { type: "checking" }
  /** Circle a line of a capture the student sent. */
  | { type: "mark"; captureId: string; line: number; note: string }
  | { type: "correct"; captureId: string | null; note: string }
  | { type: "unclear"; note: string };

/** Server -> browser WebSocket messages. */
export type ServerMessage =
  | { kind: "welcome"; sessionCode: string; replay: BoardEvent[] }
  | { kind: "board"; event: BoardEvent };

/**
 * Browser -> server: the student's latest work, as a PNG with line numbers in the margin.
 * Sent when the student presses Done, and whenever the server asks (a check is starting).
 */
export type ClientMessage = {
  kind: "capture";
  id: string;
  reason: "done" | "request";
  png: string | null;
  lineCount: number;
};

export type Language = "hi" | "hinglish" | "en";

export const LANGUAGE_NAMES: Record<Language, string> = {
  hi: "Hindi",
  hinglish: "Hinglish (Hindi-English mix, Roman script)",
  en: "English",
};

/** The language code Bolna's voice runs in for each choice. Hinglish uses the Hindi voice. */
export const VOICE_LANGUAGE: Record<Language, "hi" | "en"> = { hi: "hi", hinglish: "hi", en: "en" };

/** The tutor's first sentence, already in the student's language (sent as {{greeting}}). */
export function greetingFor(language: Language, name: string, topic: string): string {
  const who = name && name !== "student" ? ` ${name}` : "";
  switch (language) {
    case "hi":
      return `नमस्ते${who}! मैं आपकी मैथ्स टीचर हूँ। आज हम ${topic} पढ़ेंगे। शुरू करें?`;
    case "en":
      return `Hello${who}! I'm your maths teacher. Today we'll learn ${topic}. Shall we start?`;
    default:
      return `Namaste${who}! Main aapki maths teacher hoon. Aaj hum ${topic} padhenge. Shuru karein?`;
  }
}
