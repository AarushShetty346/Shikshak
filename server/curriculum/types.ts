// The checked problem library: problems with answers, worked steps, a three-rung hint ladder, the
// misconceptions each one tends to expose, and how each is independently verified.
//
// Student-visible: statement only. Everything else is teacher-only and never leaves the server
// (see publicProblem()).

import type { AnswerSpec } from "../maths/answers";

export type ChapterId = "ap" | "quadratic" | "linear" | "trig";

export type Kind = "practice" | "diagnostic" | "transfer" | "demo";

export interface Step {
  /** One line of working, plain-text maths (as the tutor would write it on the board). */
  text: string;
  /**
   * A machine check for this line: an equality chain (every part must be equal), with values for
   * any letters in it. Lines without a check are explanations, not calculations.
   */
  check?: { chain: string; env?: Record<string, string> } | { identity: [string, string] };
}

/** How the stored answer is recomputed by a deterministic algorithm (not by trusting the author). */
export type Verify =
  | { kind: "ap_term"; a: string; d: string; n: number }
  | { kind: "ap_sum"; a: string; d: string; n: number }
  | { kind: "ap_find_n"; a: string; d: string; term: string }
  | { kind: "ap_general"; a: string; d: string }
  | { kind: "ap_d"; terms: string[] }
  | { kind: "equation"; equation: string }
  | { kind: "pair"; equations: [string, string] }
  | { kind: "evaluate"; expr: string }
  | { kind: "discriminant"; a: string; b: string; c: string }
  | { kind: "expand"; expr: string };

export interface Trap {
  misconception: string;
  /** The answer a student with this misconception typically gets (checked by a test). */
  answer: string;
}

export interface Problem {
  id: string;
  chapter: ChapterId;
  skill: string;
  difficulty: 1 | 2 | 3;
  kinds: Kind[];
  statement: string;
  answer: AnswerSpec;
  steps: Step[];
  /** Nudge (a question that points the way), hint (the method), one worked step (never the final answer). */
  hints: [string, string, string];
  prerequisites?: string[];
  traps?: Trap[];
  verify: Verify;
  /** Other correct ways to solve it, for the marking scheme and for accepting alternative methods. */
  alternates?: { name: string; steps: Step[] }[];
}

export interface Skill {
  id: string;
  chapter: ChapterId;
  name: string;
  /** Skills that should be secure first. */
  needs: string[];
}

export interface Misconception {
  id: string;
  chapter: ChapterId | "algebra";
  name: string;
  /** What the student does, in plain words. */
  pattern: string;
  /** How to address it (for the tutor). */
  remedy: string;
  /** A small example of the error. */
  example: string;
}

/** What may be sent to a browser: the question only. */
export function publicProblem(p: Problem) {
  return { id: p.id, chapter: p.chapter, skill: p.skill, statement: p.statement };
}

/**
 * Review status of the library, stated honestly. Every answer, step and trap is recomputed by the
 * tests (server/curriculum/library.test.ts); no teacher has reviewed the wording yet.
 */
export const LIBRARY_REVIEW = {
  automated: "Every answer, checked step and trap answer is recomputed by deterministic algorithms in the test suite.",
  human: null as null | { by: string; date: string },
  note: "Wording and pedagogy have not yet been reviewed by a practising class 10 maths teacher.",
};
