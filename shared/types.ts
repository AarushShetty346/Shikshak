// Types shared by the browser and the server.

export type Point = [number, number];

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

/** Something the tutor puts on screen. The server sends these to the browser. */
export type BoardEvent =
  | { type: "steps"; id: string; title: string; steps: string[] }
  | { type: "problem"; id: string; problem: string }
  | { type: "clear" }
  | { type: "checking" }
  | { type: "mark"; line: number; note: string }
  | { type: "correct"; note: string }
  | { type: "unclear"; note: string };

/** Server -> browser WebSocket messages. */
export type ServerMessage =
  | { kind: "welcome"; sessionCode: string; replay: BoardEvent[] }
  | { kind: "board"; event: BoardEvent };

/** Browser -> server WebSocket messages. */
export type ClientMessage = {
  kind: "canvas";
  /** PNG data URL of the student's work, with line numbers drawn in the margin. */
  png: string | null;
  lineCount: number;
};

export type Language = "hi" | "hinglish" | "ta" | "en";

export const LANGUAGE_NAMES: Record<Language, string> = {
  hi: "Hindi",
  hinglish: "Hinglish (Hindi-English mix, Roman script)",
  ta: "Tamil",
  en: "English",
};
