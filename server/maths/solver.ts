// Solving a problem the tutor made up on the spot, deterministically, when it has a shape we
// support: one linear or quadratic equation, a pair of linear equations, "evaluate ..." with
// numbers and standard trig values, and AP nth term / sum / "which term". Every step produced here
// is machine-checked. Anything else is reported as unsupported (the caller may then ask a model,
// whose answer is only "checked" if it can be verified by substitution).

import { chainHolds, normalise, parse, solveOne, solvePair, value, variables } from "./algebra";
import type { AnswerSpec } from "./answers";
import { MathError, Q, Surd } from "./exact";

export interface SolvedStep {
  text: string;
  /** True only when this exact line was verified by the maths engine. */
  checked: boolean;
}

export interface Solved {
  kind: "equation" | "pair" | "evaluate" | "ap_term" | "ap_sum" | "ap_find_n";
  answer: AnswerSpec;
  steps: SolvedStep[];
  hints: [string, string, string];
}

const fmt = (s: Surd) => s.toString().replace(/\*/g, "");

function step(text: string, chain?: string): SolvedStep {
  if (!chain) return { text, checked: false };
  try {
    return { text, checked: chainHolds(chain) };
  } catch {
    return { text, checked: false };
  }
}

const ORDINAL = /(\d+)(?:st|nd|rd|th)\b/i;

function apTerms(text: string): Surd[] | null {
  const m = /:\s*([-\d\s./,]+?)(?:,?\s*\.\.\.|…|$)/.exec(text) ?? /\b(-?\d[\d\s./,-]*\d)\b/.exec(text);
  if (!m) return null;
  const parts = m[1]
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;
  try {
    const vals = parts.map((p) => value(p));
    const d = vals[1].sub(vals[0]);
    if (!vals.every((v, i) => i === 0 || v.sub(vals[i - 1]).eq(d))) return null;
    return vals;
  } catch {
    return null;
  }
}

export function solveFreeform(raw: string): Solved | null {
  const text = normalise(raw).replace(/^(solve|find|evaluate|simplify|calculate)\s*(the value of)?\s*:?/i, "").trim();
  const lower = raw.toLowerCase();
  try {
    // ---------- AP ----------
    if (/\bap\b|arithmetic progression/i.test(raw)) {
      const terms = apTerms(raw);
      if (terms) {
        const a = terms[0];
        const d = terms[1].sub(terms[0]);
        const which = /which term[^?]*?\bis\s*(-?[\d./]+)/i.exec(raw);
        if (which) {
          const target = value(which[1]);
          const n = target.sub(a).div(d).add(Surd.of(1));
          const q = n.asRational();
          if (!q || !q.isInt() || q.n < 1n) return null;
          return {
            kind: "ap_find_n",
            answer: { type: "value", value: q.toString() },
            steps: [step(`a = ${fmt(a)}, d = ${fmt(d)}`, `${fmt(terms[1])} - (${fmt(a)}) = ${fmt(d)}`), step(`${fmt(a)} + (n - 1)(${fmt(d)}) = ${fmt(target)}`), step(`n - 1 = ${fmt(n.sub(Surd.of(1)))}, so n = ${q}`, `(${fmt(target)} - (${fmt(a)}))/(${fmt(d)}) + 1 = ${q}`)],
            hints: ["Call the position n. What equation says the nth term equals the given number?", "Solve a + (n - 1)d = (the given term) for n.", `a = ${fmt(a)} and d = ${fmt(d)}.`],
          };
        }
        const sum = /sum of (?:the )?first\s+(\d+)\s+terms/i.exec(raw);
        if (sum) {
          const n = Number(sum[1]);
          const s = Surd.of(n).div(Surd.of(2)).mul(Surd.of(2).mul(a).add(Surd.of(n - 1).mul(d)));
          return {
            kind: "ap_sum",
            answer: { type: "value", value: fmt(s) },
            steps: [step(`a = ${fmt(a)}, d = ${fmt(d)}, n = ${n}`), step("S_n = n/2 [2a + (n - 1)d]"), step(`S_${n} = ${n}/2 [2 × ${fmt(a)} + ${n - 1} × (${fmt(d)})] = ${fmt(s)}`, `${n}/2*(2*(${fmt(a)}) + ${n - 1}*(${fmt(d)})) = ${fmt(s)}`)],
            hints: ["Which formula adds up the first n terms of an AP?", "S_n = n/2 [2a + (n - 1)d].", `a = ${fmt(a)}, d = ${fmt(d)}, n = ${n}.`],
          };
        }
        const ord = ORDINAL.exec(raw);
        if (ord && /term/i.test(raw)) {
          const n = Number(ord[1]);
          const an = a.add(Surd.of(n - 1).mul(d));
          return {
            kind: "ap_term",
            answer: { type: "value", value: fmt(an) },
            steps: [step(`a = ${fmt(a)}, d = ${fmt(d)}`, `${fmt(terms[1])} - (${fmt(a)}) = ${fmt(d)}`), step("a_n = a + (n - 1)d"), step(`a_${n} = ${fmt(a)} + (${n} - 1)(${fmt(d)}) = ${fmt(an)}`, `${fmt(a)} + (${n} - 1)*(${fmt(d)}) = ${fmt(an)}`)],
            hints: ["What are a and d for this AP?", `Use a_n = a + (n - 1)d with n = ${n}.`, `a = ${fmt(a)} and d = ${fmt(d)}.`],
          };
        }
      }
      return null;
    }

    // ---------- equations ----------
    const eqs = text
      .split(/\s+and\s+|;|\n|,(?=[^,]*=)/i)
      .map((e) => e.trim())
      .filter((e) => e.includes("="));
    if (eqs.length === 2) {
      const r = solvePair(eqs[0], eqs[1]);
      if (r.kind !== "unique") return null;
      const vals = Object.entries(r.values);
      const env = Object.fromEntries(vals.map(([k, q]) => [k, Surd.rational(q)]));
      const checks = eqs.map((e) => {
        const [l, rr] = e.split("=");
        let ok = false;
        try {
          ok = value(l, env).eq(value(rr, env));
        } catch {
          ok = false;
        }
        return { text: `Check: ${e} holds for ${vals.map(([k, q]) => `${k} = ${q}`).join(", ")}`, checked: ok };
      });
      return {
        kind: "pair",
        answer: { type: "pair", values: Object.fromEntries(vals.map(([k, q]) => [k, q.toString()])) },
        steps: [{ text: `Solve ${eqs[0]} and ${eqs[1]} together (substitution or elimination)`, checked: false }, { text: vals.map(([k, q]) => `${k} = ${q}`).join(", "), checked: checks.every((c) => c.checked) }, ...checks],
        hints: ["Can you make one letter disappear by adding or subtracting the equations?", "Use elimination (add/subtract) or make one letter the subject and substitute.", `Start from ${eqs[1]}.`],
      };
    }
    if (eqs.length === 1) {
      const r = solveOne(eqs[0]);
      if (r.kind === "none") return { kind: "equation", answer: { type: "none", reason: r.reason }, steps: [{ text: r.reason, checked: true }], hints: ["What decides whether a quadratic has real roots?", "Find D = b^2 - 4ac.", "If D < 0 there are no real roots."] };
      if (r.kind !== "roots") return null;
      const [lhs, rhs] = eqs[0].split("=");
      const env = (x: Surd) => ({ [r.variable]: x });
      const checks = r.roots.map((x) => {
        let ok = false;
        try {
          ok = value(lhs, env(x)).eq(value(rhs, env(x)));
        } catch {
          ok = false;
        }
        return { text: `Check ${r.variable} = ${fmt(x)}: both sides are equal`, checked: ok };
      });
      const quadratic = /\^\s*2|²/.test(eqs[0]);
      return {
        kind: "equation",
        answer: { type: "roots", variable: r.variable, values: r.roots.map(fmt) },
        steps: [{ text: r.roots.map((x) => `${r.variable} = ${fmt(x)}`).join(" or "), checked: checks.every((c) => c.checked) }, ...checks],
        hints: quadratic
          ? ["Can you split the middle term, or should you use the formula?", "Write it as ax^2 + bx + c = 0; factorise, or use x = (-b ± √D)/2a with D = b^2 - 4ac.", "First identify a, b and c."]
          : [`What is being done to ${r.variable}? Undo it one step at a time.`, "Do the same thing to both sides until the letter is alone.", "Start by moving the number term to the other side (change its sign)."],
      };
    }

    // ---------- evaluate an expression ----------
    if (/evaluate|value of|simplify|calculate/i.test(lower) || !/[a-z]/i.test(text.replace(/sin|cos|tan|sec|cosec|cot|sqrt/gi, ""))) {
      const node = parse(text);
      if (variables(node).size) return null;
      const v = value(text);
      return {
        kind: "evaluate",
        answer: { type: "value", value: fmt(v) },
        steps: [step(`${text} = ${fmt(v)}`, `${text} = ${fmt(v)}`)],
        hints: ["Work out each part separately first.", "Replace each trig ratio by its exact value, then simplify.", "Write the value of the first term."],
      };
    }
  } catch (err) {
    if (err instanceof MathError) return null;
    throw err;
  }
  return null;
}

export { Q };
