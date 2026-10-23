// The problem library: lookup, independent verification, choosing problems, and matching a
// student's answer against the right answer and known misconception traps.

import { chainHolds, sameExpression, solveOne, solvePair, value, type Env } from "../maths/algebra";
import { compareAnswer, describeAnswer, type AnswerSpec, type Comparison } from "../maths/answers";
import { Q, Surd } from "../maths/exact";
import { AP_PROBLEMS, AP_SKILLS } from "./ap";
import { MISCONCEPTIONS } from "./misconceptions";
import { MORE_PROBLEMS, MORE_SKILLS } from "./more";
import type { ChapterId, Kind, Problem, Skill } from "./types";

export const PROBLEMS: Problem[] = [...AP_PROBLEMS, ...MORE_PROBLEMS];
export const SKILLS: Skill[] = [...AP_SKILLS, ...MORE_SKILLS];
export { MISCONCEPTIONS };

const byId = new Map(PROBLEMS.map((p) => [p.id, p]));

export function problem(id: string): Problem | undefined {
  return byId.get(id);
}

export function skill(id: string): Skill | undefined {
  return SKILLS.find((s) => s.id === id);
}

export const CHAPTER_NAMES: Record<ChapterId, string> = {
  ap: "Arithmetic Progressions",
  quadratic: "Quadratic Equations",
  linear: "Linear Equations",
  trig: "Introduction to Trigonometry",
};

/** Guesses the chapter from a topic name (for diagnostics and choosing practice). */
export function chapterForTopic(topic: string): ChapterId | null {
  const t = topic.toLowerCase();
  if (/arithmetic|\bap\b|progression|sequence/.test(t)) return "ap";
  if (/quadratic|factoris|factoriz/.test(t)) return "quadratic";
  if (/linear|pair of|simultaneous/.test(t)) return "linear";
  if (/trig|sin|cos|tan/.test(t)) return "trig";
  return null;
}

// ---------- independent verification ----------

const V = (s: string): Surd => value(s);
const ints = (n: number) => Surd.rational(new Q(BigInt(n)));

/** The answer computed by an algorithm from the problem's data, as an AnswerSpec-comparable value. */
export function computedAnswer(p: Problem): { kind: "values"; values: Surd[] } | { kind: "pair"; values: Record<string, Q> } | { kind: "expression"; expr: string } {
  const v = p.verify;
  switch (v.kind) {
    case "ap_term":
      return { kind: "values", values: [V(v.a).add(ints(v.n - 1).mul(V(v.d)))] };
    case "ap_sum":
      return { kind: "values", values: [ints(v.n).div(ints(2)).mul(ints(2).mul(V(v.a)).add(ints(v.n - 1).mul(V(v.d))))] };
    case "ap_find_n":
      return { kind: "values", values: [V(v.term).sub(V(v.a)).div(V(v.d)).add(ints(1))] };
    case "ap_general":
      return { kind: "expression", expr: `(${v.a}) + (n - 1)*(${v.d})` };
    case "ap_d": {
      const ds = v.terms.slice(1).map((t, i) => V(t).sub(V(v.terms[i])));
      if (!ds.every((d) => d.eq(ds[0]))) throw new Error(`${p.id}: terms are not an AP`);
      return { kind: "values", values: [ds[0]] };
    }
    case "equation": {
      const r = solveOne(v.equation);
      if (r.kind !== "roots") throw new Error(`${p.id}: equation has no unique roots`);
      return { kind: "values", values: r.roots };
    }
    case "pair": {
      const r = solvePair(v.equations[0], v.equations[1]);
      if (r.kind !== "unique") throw new Error(`${p.id}: pair has no unique solution`);
      return { kind: "pair", values: r.values };
    }
    case "evaluate":
      return { kind: "values", values: [V(v.expr)] };
    case "discriminant":
      return { kind: "values", values: [V(v.b).mul(V(v.b)).sub(ints(4).mul(V(v.a)).mul(V(v.c)))] };
    case "expand":
      return { kind: "expression", expr: v.expr };
  }
}

/** Does the stored answer equal what the algorithm computes? */
export function answerMatchesComputation(p: Problem): boolean {
  const c = computedAnswer(p);
  const a = p.answer;
  if (c.kind === "expression") return a.type === "expression" && sameExpression(a.expr, c.expr);
  if (c.kind === "pair") return a.type === "pair" && Object.entries(c.values).every(([k, q]) => a.values[k] !== undefined && V(a.values[k]).eq(Surd.rational(q)));
  const stored = a.type === "value" ? [a.value] : a.type === "roots" ? a.values : null;
  if (!stored || stored.length !== c.values.length) return false;
  const left = [...c.values];
  for (const s of stored) {
    const i = left.findIndex((x) => x.eq(V(s)));
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

/** Every checked step holds. Returns the steps that fail. */
export function failingSteps(p: Problem): string[] {
  const bad: string[] = [];
  for (const s of [...p.steps, ...(p.alternates ?? []).flatMap((a) => a.steps)]) {
    if (!s.check) continue;
    try {
      if ("identity" in s.check) {
        if (!sameExpression(s.check.identity[0], s.check.identity[1])) bad.push(s.text);
      } else {
        const env: Env = Object.fromEntries(Object.entries(s.check.env ?? {}).map(([k, x]) => [k, V(x)]));
        if (!chainHolds(s.check.chain, env)) bad.push(s.text);
      }
    } catch (err) {
      bad.push(`${s.text} (${(err as Error).message})`);
    }
  }
  return bad;
}

/** The nudge and the hint must not give away the final answer. */
export function hintsLeak(p: Problem): string[] {
  const answers = p.answer.type === "value" ? [p.answer.value] : p.answer.type === "roots" ? p.answer.values : p.answer.type === "pair" ? Object.values(p.answer.values) : [];
  const leaks: string[] = [];
  for (const h of p.hints.slice(0, 2)) {
    for (const a of answers) {
      if (a.length >= 1 && new RegExp(`(^|[^0-9./])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9./]|$)`).test(h) && !/^\d$/.test(a)) leaks.push(`"${h}" contains ${a}`);
    }
  }
  return leaks;
}

// ---------- checking an answer ----------

export interface AnswerCheck extends Comparison {
  /** Misconceptions the answer matches exactly (from the problem's traps). */
  misconceptions: string[];
}

/** Compares a student's final answer with the problem's, and with its known wrong answers. */
export function checkAnswer(p: Problem, text: string): AnswerCheck {
  const c = compareAnswer(p.answer, text);
  const misconceptions: string[] = [];
  if (c.verdict === "incorrect" || c.verdict === "partial") {
    for (const t of p.traps ?? []) {
      const trapSpec: AnswerSpec =
        p.answer.type === "roots"
          ? { type: "roots", variable: p.answer.variable, values: t.answer.replace(/x\s*=\s*/g, "").split(/\s+or\s+/) }
          : p.answer.type === "pair"
            ? { type: "pair", values: Object.fromEntries(t.answer.split(",").map((kv) => kv.split("=").map((s) => s.trim()))) }
            : p.answer.type === "expression"
              ? { type: "expression", variable: p.answer.variable, expr: t.answer }
              : { type: "value", value: t.answer };
      if (compareAnswer(trapSpec, text).verdict === "correct") misconceptions.push(t.misconception);
    }
  }
  return { ...c, misconceptions };
}

export { describeAnswer };

// ---------- choosing problems ----------

export interface Pick {
  chapter?: ChapterId | null;
  skill?: string | null;
  kind?: Kind;
  /** Problem ids already used in this session (not repeated). */
  exclude?: string[];
  difficulty?: 1 | 2 | 3;
}

export function pickProblem(opts: Pick): Problem | null {
  const pool = PROBLEMS.filter(
    (p) =>
      (!opts.chapter || p.chapter === opts.chapter) &&
      (!opts.skill || p.skill === opts.skill) &&
      (!opts.kind || p.kinds.includes(opts.kind)) &&
      !(opts.exclude ?? []).includes(p.id),
  );
  if (!pool.length) return null;
  if (opts.difficulty) {
    const exact = pool.filter((p) => p.difficulty === opts.difficulty);
    if (exact.length) return exact[0];
    return [...pool].sort((a, b) => Math.abs(a.difficulty - opts.difficulty!) - Math.abs(b.difficulty - opts.difficulty!))[0];
  }
  return [...pool].sort((a, b) => a.difficulty - b.difficulty)[0];
}

/** The diagnostic questions for a chapter, easiest first. */
export function diagnosticSet(chapter: ChapterId): Problem[] {
  return PROBLEMS.filter((p) => p.chapter === chapter && p.kinds.includes("diagnostic")).sort((a, b) => a.difficulty - b.difficulty);
}
