// What a correct answer is, and comparing an answer against it by mathematical value (never as
// text): "x = 3 or x = 4", "4, 3", "x=4,x=3" all match roots {3, 4}; "1.5" matches 3/2;
// "a_n = 2 + 3n" matches 3n + 2.

import { normalise, parse, sameExpression, toPoly, value } from "./algebra";
import { MathError, Q, Surd } from "./exact";

export type AnswerSpec =
  /** One value: 29, 3/2, sqrt(3)/2. */
  | { type: "value"; value: string; unit?: string }
  /** Roots of an equation, any order: x = 3 or x = 4. */
  | { type: "roots"; variable: string; values: string[] }
  /** Values of two unknowns: x = 2, y = 1. */
  | { type: "pair"; values: Record<string, string> }
  /**
   * An expression in one variable, e.g. the nth term 3n + 2. With form "expanded" (an "Expand: ..."
   * question) the answer must also be written multiplied out, with like terms collected.
   */
  | { type: "expression"; variable: string; expr: string; form?: "expanded" }
  /** No solution, e.g. "no real roots". */
  | { type: "none"; reason: string };

export type Verdict = "correct" | "incorrect" | "partial" | "approximate" | "unreadable";

export interface Comparison {
  verdict: Verdict;
  /** What we understood the answer to be (for the tutor and the report). */
  got: string;
  detail: string;
}

/** The answer written in plain words, for the teacher's eyes only. */
export function describeAnswer(spec: AnswerSpec): string {
  switch (spec.type) {
    case "value":
      return `${spec.value}${spec.unit ? ` ${spec.unit}` : ""}`;
    case "roots":
      return spec.values.map((v) => `${spec.variable} = ${v}`).join(" or ");
    case "pair":
      return Object.entries(spec.values)
        .map(([k, v]) => `${k} = ${v}`)
        .join(", ");
    case "expression":
      return spec.expr;
    case "none":
      return spec.reason;
  }
}

const NONE_WORDS = /\b(no real (roots?|solutions?)|not real|no solution|no roots?|koi (real )?root nahi)\b/i;

/** The right-hand side of the last "=": "a_10 = 2 + 27 = 29" -> "29". */
function lastPart(text: string): string {
  const parts = normalise(text).split("=");
  return parts[parts.length - 1].trim();
}

/** Splits "x = 3 or x = 4", "3, 4", "3 and 4" into ["3", "4"] (dropping "x ="). */
function splitValues(text: string, variable?: string): string[] {
  const t = normalise(text);
  // Prose around the answer ("So x = 3 or x = 4, done"): take every "x = value" in it.
  if (variable) {
    const v = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = [...t.matchAll(new RegExp(`(?:^|[^A-Za-z_])${v}\\s*=\\s*([^,;]+?)(?=\\s*(?:,|;|\\bor\\b|\\band\\b|\\.?\\s*$))`, "g"))].map((m) => m[1].trim());
    if (found.length) {
      // "x = 3, 4" lists more values after the first one
      const rest = t.slice(t.lastIndexOf(found[found.length - 1]) + found[found.length - 1].length);
      const extra = rest
        .split(/\bor\b|\band\b|,|;/i)
        .map((p) => p.trim().replace(/\.$/, ""))
        .filter((p) => /^-?[\d(√s]/.test(p));
      return [...found, ...extra];
    }
  }
  return t
    .split(/\bor\b|\band\b|,|;|\|/i)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = /^([A-Za-z](?:_[A-Za-z0-9]+)?)\s*=\s*(.+)$/.exec(p);
      if (m && (!variable || m[1] === variable)) return m[2].trim();
      return p;
    });
}

/** Top-level terms of an expression: "x^2 + 6x - 9" -> 3. Signs inside brackets or after ^ * / don't split. */
function termCount(src: string): number {
  const t = normalise(src).replace(/\s+/g, "");
  let depth = 0;
  let n = 0;
  let inTerm = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    if (c === ")" || c === "]" || c === "}") depth--;
    const splits = (c === "+" || c === "-") && depth === 0 && !/[\^*/]/.test(t[i - 1] ?? "");
    if (splits) inTerm = false;
    else if (!inTerm) {
      inTerm = true;
      n++;
    }
  }
  return n;
}

/**
 * Written multiplied out: no brackets, and no like terms left to collect ("x^2 + 3x + 3x + 9" isn't).
 * The value is checked separately.
 */
export function isExpanded(src: string): boolean {
  if (/[([{]/.test(normalise(src))) return false;
  try {
    return termCount(src) === toPoly(parse(src)).size;
  } catch {
    return false;
  }
}

function tryValue(text: string): Surd | null {
  try {
    return value(text);
  } catch {
    return null;
  }
}

/** Close to the exact value but written as a rounded decimal (e.g. 0.866 for √3/2). */
function approximately(got: string, want: Surd): boolean {
  const g = tryValue(got);
  if (!g || !/\d\.\d/.test(got)) return false;
  const w = want.toNumber();
  return Math.abs(g.toNumber() - w) <= Math.max(0.006, Math.abs(w) * 0.005);
}

export function compareAnswer(spec: AnswerSpec, raw: string): Comparison {
  const text = String(raw ?? "").trim();
  if (!text) return { verdict: "unreadable", got: "", detail: "No answer given." };
  try {
    switch (spec.type) {
      case "none":
        return NONE_WORDS.test(text) ? { verdict: "correct", got: text, detail: "Says there is no solution." } : { verdict: "incorrect", got: text, detail: `Expected: ${spec.reason}.` };
      case "value": {
        const want = value(spec.value);
        const got = lastPart(text.replace(new RegExp(`\\s*${spec.unit ?? "\\b\\B"}\\s*$`), ""));
        const g = tryValue(got);
        if (!g) return { verdict: "unreadable", got, detail: "Couldn't read that as a number." };
        if (g.eq(want)) return { verdict: "correct", got, detail: "Same value." };
        if (approximately(got, want)) return { verdict: "approximate", got, detail: "Right value, but rounded; the exact form is expected." };
        return { verdict: "incorrect", got, detail: `Different value.` };
      }
      case "roots": {
        if (NONE_WORDS.test(text)) return { verdict: "incorrect", got: text, detail: "Says there are no roots, but there are." };
        const wants = spec.values.map((v) => value(v));
        const gotParts = splitValues(text, spec.variable);
        const gots = gotParts.map(tryValue);
        if (gots.some((g) => !g)) return { verdict: "unreadable", got: gotParts.join(", "), detail: "Couldn't read every value." };
        const remaining = [...wants];
        let matched = 0;
        let extra = 0;
        for (const g of gots as Surd[]) {
          const i = remaining.findIndex((w) => w.eq(g));
          if (i >= 0) {
            remaining.splice(i, 1);
            matched++;
          } else extra++;
        }
        const got = gotParts.join(", ");
        if (matched === wants.length && extra === 0) return { verdict: "correct", got, detail: "All roots, nothing extra." };
        if (matched > 0) return { verdict: "partial", got, detail: `${matched} of ${wants.length} root(s) right${extra ? `, ${extra} wrong` : ""}.` };
        return { verdict: "incorrect", got, detail: "None of the roots match." };
      }
      case "pair": {
        const found: Record<string, Surd> = {};
        for (const part of normalise(text).split(/,|;|\band\b/i)) {
          const m = /^\s*([A-Za-z])\s*=\s*(.+?)\s*$/.exec(part);
          if (m) {
            const v = tryValue(m[2]);
            if (v) found[m[1]] = v;
          }
        }
        const keys = Object.keys(spec.values);
        if (keys.some((k) => !found[k])) return { verdict: "unreadable", got: text, detail: `Expected ${keys.join(" and ")} = ...` };
        const right = keys.filter((k) => found[k].eq(value(spec.values[k])));
        const got = keys.map((k) => `${k} = ${found[k].toString()}`).join(", ");
        if (right.length === keys.length) return { verdict: "correct", got, detail: "Both values right." };
        return { verdict: right.length ? "partial" : "incorrect", got, detail: `${right.length} of ${keys.length} right.` };
      }
      case "expression": {
        const got = lastPart(text);
        try {
          parse(got);
        } catch {
          return { verdict: "unreadable", got, detail: "Couldn't read the expression." };
        }
        if (!sameExpression(got, spec.expr)) return { verdict: "incorrect", got, detail: "A different expression." };
        if (spec.form === "expanded" && !isExpanded(got))
          return { verdict: "incorrect", got, detail: "Equal in value, but not expanded yet: multiply out the brackets and collect like terms." };
        return { verdict: "correct", got, detail: "Same expression." };
      }
    }
  } catch (err) {
    if (err instanceof MathError) return { verdict: "unreadable", got: text, detail: err.message };
    throw err;
  }
}

/** Exact value of a stored spec value (used by the library checks). */
export function specValue(v: string): Surd {
  return value(v);
}

export { Q };
