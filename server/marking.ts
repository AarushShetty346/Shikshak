// Practice marking in the style of a CBSE board marking scheme. This is NOT an official CBSE mark:
// it's feedback that shows a student where marks come from.
//
// How the scheme is built for a library problem (deterministic, no model involved):
//   - every machine-checked step of the worked solution is a value point worth ½ mark;
//   - the correct final answer is worth 1 mark;
//   - each other correct method (the problem's alternates) is a scheme of its own, and the
//     student gets the best of them (a correct alternative method earns full marks).
// How the student's lines are marked:
//   - a step's ½ mark is earned by a line whose arithmetic holds and reaches that step's value (or,
//     for algebra steps, writes that step's form);
//   - an error is penalised once: after a wrong line, later steps that correctly carry the wrong
//     value forward still earn their marks ("follow-through"), and so does the final answer they lead to;
//   - lines the reader couldn't read earn nothing, and the result is marked provisional.
// These rules follow the published CBSE sample-paper marking schemes (½-mark value points) and
// the board's examiner instructions (an error is penalised only once; correct answers expressed
// differently get due marks). See docs/MARKING.md.

import { normalise, parse, sameExpression, splitChain, value, variables } from "./maths/algebra";
import type { Surd } from "./maths/exact";
import { compareAnswer } from "./maths/answers";
import type { Problem, Step } from "./curriculum/types";

export interface ValuePoint {
  step: string;
  marks: number;
  got: number;
  how: "shown" | "follow-through" | "missing";
}

export interface Marking {
  got: number;
  of: number;
  method: string;
  points: ValuePoint[];
  answer: { marks: number; got: number; how: "correct" | "follow-through" | "wrong" | "missing" };
  firstError: { line: number; note: string } | null;
  provisional: boolean;
  unreadableLines: number[];
  note: string;
}

export const MARKING_NOTE = "Practice marks in the style of a CBSE marking scheme (½ mark per key step, 1 for the answer). Not an official CBSE mark.";

/** "1) a = 2, d = 3\n2) ..." -> the written lines (the reader numbers them). */
export function readingLines(reading: string): string[] {
  return reading
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\d+\s*[).:-]\s*/, "").trim())
    .filter(Boolean);
}

/** One written line can hold several statements: "a = 2, d = 5 - 2 = 3", "2x = 6, so x = 3". */
function segments(line: string): string[] {
  return line
    .split(/,|;|\bso\b|\btherefore\b|\bhence\b|⇒|=>|∴/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

const isLabel = (part: string) => /^[A-Za-z]{1,3}(_?\{?\w+\}?)?$/.test(part.replace(/\s+/g, "")) || /^(sin|cos|tan)\s*[A-Za-z]$/i.test(part);
const hasOp = (part: string) => /[-+*/^]|sqrt|sin|cos|tan/.test(normalise(part).replace(/^-/, ""));

function num(part: string): Surd | null {
  try {
    const node = parse(part);
    if (variables(node).size) return null;
    return value(part);
  } catch {
    return null;
  }
}

interface Seg {
  line: number;
  text: string;
  parts: string[];
  /** Numeric parts with their exact values (labels like "a_10" are skipped). */
  values: { part: string; v: Surd }[];
  /** Every numeric part has the same value. Null when there's nothing numeric to check. */
  holds: boolean | null;
  unreadable: boolean;
}

function analyse(lines: string[]): Seg[] {
  const out: Seg[] = [];
  lines.forEach((text, i) => {
    const unreadable = /\?\?|\[unclear\]|\[illegible\]|unreadable/i.test(text);
    for (const seg of segments(text)) {
      const parts = splitChain(seg);
      const values = parts.filter((p) => !isLabel(p)).flatMap((p) => {
        const v = num(p);
        return v ? [{ part: p, v }] : [];
      });
      const holds = values.length >= 2 ? values.every((x) => x.v.eq(values[0].v)) : null;
      out.push({ line: i + 1, text: seg, parts, values, holds, unreadable });
    }
  });
  return out;
}

/** Same algebraic form, not just the same polynomial: the top-level terms match, in any order. */
function sameForm(a: string, b: string): boolean {
  const key = (s: string) => {
    const t = normalise(s).replace(/\s+/g, "").replace(/\*/g, "");
    const terms: string[] = [];
    let depth = 0;
    let cur = "";
    for (const c of t) {
      if (c === "(") depth++;
      if (c === ")") depth--;
      if ((c === "+" || c === "-") && depth === 0 && cur) {
        terms.push(cur);
        cur = c === "-" ? "-" : "";
      } else cur += c === "+" && !cur ? "" : c;
    }
    if (cur) terms.push(cur);
    // Inside a term, bracketed factors can come in any order: (x - 4)(x - 3) = (x - 3)(x - 4).
    const factors = (term: string) => {
      const out: string[] = [];
      let d = 0;
      let piece = "";
      for (const c of term) {
        if (c === "(" && d === 0 && piece) {
          out.push(piece);
          piece = "";
        }
        piece += c;
        if (c === "(") d++;
        if (c === ")") {
          d--;
          if (d === 0) {
            out.push(piece);
            piece = "";
          }
        }
      }
      if (piece) out.push(piece);
      return out.sort().join("");
    };
    return terms.map(factors).sort().join("|");
  };
  try {
    return sameExpression(a, b) && key(a) === key(b);
  } catch {
    return false;
  }
}

/** Replaces whole-number literals in an expression (the correct value -> the student's wrong one). */
function substitute(expr: string, swaps: Map<string, string>): string {
  if (!swaps.size) return expr;
  return normalise(expr).replace(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g, (m) => swaps.get(m) ?? m);
}

const half = (n: number) => Math.round(n * 2) / 2;

/** Whether these lines earn a step: shown directly, or by correctly carrying an earlier slip forward. */
function stepEarned(step: Step, segs: Seg[], swaps: Map<string, string>): ValuePoint["how"] {
  const c = step.check!;
  if ("identity" in c) {
    // The form the step writes (from its own text), e.g. "x(x - 3) - 4(x - 3)".
    const forms = segments(step.text)
      .flatMap((t) => splitChain(t))
      .filter((part) => {
        try {
          return sameExpression(part, c.identity[0]);
        } catch {
          return false;
        }
      });
    return segs.some((s) => s.parts.some((part) => forms.some((f) => sameForm(part, f)))) ? "shown" : "missing";
  }
  let target: Surd | null = null;
  let carried: Surd | null = null;
  try {
    const parts = splitChain(c.chain);
    target = value(parts.at(-1)!, Object.fromEntries(Object.entries(c.env ?? {}).map(([k, v]) => [k, value(v)])));
    const shifted = substitute(parts[0], swaps);
    if (shifted !== normalise(parts[0])) carried = value(shifted);
  } catch {
    // a step the engine can't evaluate can't be matched
  }
  const reaches = (v: Surd | null) => v !== null && segs.some((s) => s.holds === true && s.values.some((x) => hasOp(x.part)) && s.values.some((x) => x.v.eq(v)));
  if (reaches(target)) return "shown";
  if (reaches(carried)) return "follow-through";
  return "missing";
}

/** Value points: checked steps whose own written line shows the checked work (a bare "Check:" note doesn't). */
const markable = (steps: Step[]) => steps.filter((s) => s.check && stepEarned(s, analyse([s.text]), new Map()) === "shown");

function markMethod(p: Problem, name: string, steps: Step[], segs: Seg[], final: string): Omit<Marking, "provisional" | "unreadableLines" | "note"> {
  const checked = markable(steps);
  // Wrong lines, in order: what the line should have equalled, and what the student wrote.
  const swaps = new Map<string, string>();
  let firstError: Marking["firstError"] = null;
  for (const s of segs) {
    if (s.holds !== false || s.unreadable) continue;
    const computed = s.values.find((x) => hasOp(x.part)) ?? s.values[0];
    const claimed = s.values.at(-1)!;
    firstError ??= { line: s.line, note: `${computed.part} is ${computed.v.toString()}, not ${claimed.part}.` };
    if (computed.v.isRational() && claimed.v.isRational()) swaps.set(computed.v.toString(), claimed.v.toString());
  }
  const readable = segs.filter((s) => !s.unreadable);
  const points: ValuePoint[] = checked.map((step) => {
    const how = stepEarned(step, readable, swaps);
    return { step: step.text, marks: 0.5, got: how === "missing" ? 0 : 0.5, how };
  });

  let answer: Marking["answer"] = { marks: 1, got: 0, how: final ? "wrong" : "missing" };
  if (final && compareAnswer(p.answer, final).verdict === "correct") answer = { marks: 1, got: 1, how: "correct" };
  else if (final && p.answer.type === "value" && swaps.size) {
    // The answer the student's own earlier slip leads to, carried through correctly.
    const last = [...checked].reverse().find((s) => s.check && "chain" in s.check);
    if (last && "chain" in last.check!) {
      try {
        const v = value(substitute(splitChain(last.check.chain)[0], swaps));
        const f = num(splitChain(final).at(-1) ?? "");
        if (f && f.eq(v) && points.some((x) => x.how === "follow-through")) answer = { marks: 1, got: 1, how: "follow-through" };
      } catch {
        // leave it wrong
      }
    }
  }
  const got = half(points.reduce((a, x) => a + x.got, 0) + answer.got);
  const of = half(points.reduce((a, x) => a + x.marks, 0) + answer.marks);
  return { got, of, method: name, points, answer, firstError };
}

/**
 * Marks written work on a library problem. `lines` are the student's lines as read; `finalAnswer`
 * is the final answer as read (falls back to the last line).
 */
export function markWork(p: Problem, lines: string[], finalAnswer?: string | null): Marking {
  const segs = analyse(lines);
  const final = (finalAnswer ?? "").trim() || (lines.at(-1) ?? "");
  const methods = [{ name: "Worked solution", steps: p.steps }, ...(p.alternates ?? []).map((a) => ({ name: a.name, steps: a.steps }))];
  const results = methods.map((m) => markMethod(p, m.name, m.steps, segs, final));
  // Best method by share of marks (methods can have different numbers of steps).
  const best = results.reduce((a, b) => (b.got / b.of > a.got / a.of ? b : a));
  const unreadableLines = [...new Set(segs.filter((s) => s.unreadable).map((s) => s.line))];
  return {
    ...best,
    provisional: unreadableLines.length > 0,
    unreadableLines,
    note: MARKING_NOTE,
  };
}

/** "1½ / 2" */
export function formatMarks(n: number): string {
  const whole = Math.floor(n);
  const h = n - whole >= 0.5 ? "½" : "";
  return whole === 0 && h ? h : `${whole}${h}`;
}

/** One line the tutor can read out or show. */
export function describeMarking(m: Marking): string {
  const lost = m.points.filter((x) => x.how === "missing").map((x) => x.step);
  const parts = [`Practice marks: ${formatMarks(m.got)} / ${formatMarks(m.of)}${m.provisional ? " (provisional: some lines couldn't be read)" : ""}.`];
  if (m.firstError) parts.push(`First slip on line ${m.firstError.line}; later steps that follow from it still got their marks.`);
  if (lost.length && m.got < m.of) parts.push(`Marks missed for: ${lost.slice(0, 2).join("; ")}.`);
  if (m.answer.how === "correct" && m.points.length && m.points.every((x) => x.how === "missing")) parts.push("The answer is right, but in the exam the steps carry marks too: show them.");
  return parts.join(" ");
}
