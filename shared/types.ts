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
