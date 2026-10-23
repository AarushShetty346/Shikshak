// The library is only "checked" if these pass: every stored answer equals what an independent
// algorithm computes, every checked step holds, hints don't leak answers, and every trap answer is
// exactly what the named wrong method produces.

import { describe, expect, it } from "vitest";
import { solveOne, solvePair, value } from "../maths/algebra";
import { Q, Surd } from "../maths/exact";
import { answerMatchesComputation, checkAnswer, diagnosticSet, failingSteps, hintsLeak, MISCONCEPTIONS, pickProblem, problem, PROBLEMS, SKILLS } from "./library";
import type { Problem } from "./types";

const V = (s: string) => value(s);

/** What a student with each misconception gets, computed by actually applying the wrong method. */
function wrongMethod(p: Problem, misconception: string): Surd[] | Record<string, Q> | string {
  const v = p.verify;
  const n = (x: number) => Surd.of(x);
  switch (misconception) {
    case "ap.index_off_by_one":
      if (v.kind === "ap_term") return [V(v.a).add(n(v.n).mul(V(v.d)))]; // a + nd
      if (v.kind === "ap_find_n") return [V(v.term).sub(V(v.a)).div(V(v.d))]; // forgets the +1
      if (v.kind === "ap_general") return `(${v.a}) + n*(${v.d})`;
      break;
    case "ap.d_sign": {
      if (v.kind === "ap_d") return [V(v.terms[0]).sub(V(v.terms[1]))];
      if (v.kind === "ap_term") return [V(v.a).add(n(v.n - 1).mul(V(v.d).neg()))];
      if (v.kind === "ap_sum") return [n(v.n).div(n(2)).mul(n(2).mul(V(v.a)).add(n(v.n - 1).mul(V(v.d).neg())))];
      break;
    }
    case "ap.sum_half":
      if (v.kind === "ap_sum") return [n(v.n).mul(n(2).mul(V(v.a)).add(n(v.n - 1).mul(V(v.d))))];
      break;
    case "alg.sign_transfer":
      if (p.id === "lin.one.01") return [n(11 + 3).div(n(2))]; // 2x + 3 = 11 -> 2x = 11 + 3
      break;
    case "alg.distribution":
      if (p.id === "lin.one.02") return [n(12 + 2).div(n(3))]; // 3(x - 2) -> 3x - 2
      break;
    case "quad.root_sign":
      if (v.kind === "equation") {
        const r = solveOne(v.equation);
        if (r.kind === "roots") return r.roots.map((x) => x.neg());
      }
      break;
    case "quad.square_identity":
      if (v.kind === "expand") return "x^2 + 9"; // (x + 3)^2 -> x^2 + 3^2
      break;
    case "quad.discriminant_sign":
      if (v.kind === "discriminant") return [V(v.b).mul(V(v.b)).add(n(4).mul(V(v.a)).mul(V(v.c)))];
      if (p.id === "quad.formula.01") {
        const d = V("(-5)^2 + 4*1*3");
        const root = Surd.sqrt(d.asRational()!);
        return [n(5).add(root).div(n(2)), n(5).sub(root).div(n(2))];
      }
      break;
    case "lin.elimination_sign":
      if (p.id === "lin.pair.02") {
        // (2x + 3y = 12) - (x - y = 1) done wrongly as x + 2y = 11, then with x - y = 1
        const r = solvePair("x + 2y = 11", "x - y = 1");
        if (r.kind === "unique") return r.values;
      }
      break;
    case "trig.ratio_swap":
      if (p.id === "trig.ratio.01") return [V("3/5")]; // adjacent AB / AC
      if (p.id === "trig.ratio.02") return [V("5/sqrt(5^2 + 12^2)")]; // opposite PQ / PR
      break;
    case "trig.value_swap":
      if (p.id === "trig.val.01") return [V("sin 60 + cos 30")];
      break;
    case "trig.identity_squares":
      if (p.id === "trig.id.01") return [V("1 - 3/5")];
      break;
  }
  throw new Error(`no wrong-method computation for ${misconception} on ${p.id}`);
}

describe("the problem library", () => {
  it("has unique ids, known skills, three hints and a statement for every problem", () => {
    expect(new Set(PROBLEMS.map((p) => p.id)).size).toBe(PROBLEMS.length);
    for (const p of PROBLEMS) {
      expect(SKILLS.some((s) => s.id === p.skill), p.id).toBe(true);
      expect(p.hints.every((h) => h.trim().length > 5), p.id).toBe(true);
      expect(p.statement.length).toBeGreaterThan(8);
      for (const pre of p.prerequisites ?? []) expect(SKILLS.some((s) => s.id === pre), `${p.id} needs ${pre}`).toBe(true);
    }
  });

  it.each(PROBLEMS.map((p) => [p.id, p] as const))("%s: the stored answer is what the algorithm computes", (_id, p) => {
    expect(answerMatchesComputation(p)).toBe(true);
  });

  it.each(PROBLEMS.map((p) => [p.id, p] as const))("%s: every checked step holds", (_id, p) => {
    expect(failingSteps(p)).toEqual([]);
  });

  it.each(PROBLEMS.map((p) => [p.id, p] as const))("%s: the nudge and hint don't give the answer away", (_id, p) => {
    expect(hintsLeak(p)).toEqual([]);
  });

  it.each(PROBLEMS.flatMap((p) => (p.traps ?? []).map((t) => [`${p.id} ${t.misconception}`, p, t] as const)))("%s: the trap answer is what the wrong method gives", (_l, p, t) => {
    expect(MISCONCEPTIONS.some((m) => m.id === t.misconception)).toBe(true);
    const wrong = wrongMethod(p, t.misconception);
    if (typeof wrong === "string") {
      expect(checkAnswer({ ...p, traps: [] }, t.answer).verdict).not.toBe("correct");
      expect(checkAnswer({ ...p, answer: { type: "expression", variable: "n", expr: wrong }, traps: [] }, t.answer).verdict === "correct" || checkAnswer({ ...p, answer: { type: "expression", variable: "x", expr: wrong }, traps: [] }, t.answer).verdict === "correct").toBe(true);
    } else if (Array.isArray(wrong)) {
      const spec = p.answer.type === "roots" ? { type: "roots" as const, variable: p.answer.variable, values: wrong.map(String) } : { type: "value" as const, value: wrong[0].toString() };
      expect(checkAnswer({ ...p, answer: spec, traps: [] }, t.answer).verdict).toBe("correct");
    } else {
      const spec = { type: "pair" as const, values: Object.fromEntries(Object.entries(wrong).map(([k, q]) => [k, q.toString()])) };
      expect(checkAnswer({ ...p, answer: spec, traps: [] }, t.answer).verdict).toBe("correct");
    }
    // ...and the library recognises a student who writes it.
    expect(checkAnswer(p, t.answer).misconceptions).toContain(t.misconception);
  });

  it("every misconception is used by at least one problem, across at least three chapters", () => {
    const used = new Set(PROBLEMS.flatMap((p) => (p.traps ?? []).map((t) => t.misconception)));
    for (const m of MISCONCEPTIONS) expect(used.has(m.id), m.id).toBe(true);
    expect(new Set(PROBLEMS.filter((p) => p.traps?.length).map((p) => p.chapter)).size).toBeGreaterThanOrEqual(3);
  });

  it("has a diagnostic set, practice and transfer questions for every chapter, and the demo problems", () => {
    for (const ch of ["ap", "quadratic", "linear", "trig"] as const) {
      expect(diagnosticSet(ch).length, ch).toBeGreaterThanOrEqual(2);
      expect(PROBLEMS.some((p) => p.chapter === ch && p.kinds.includes("transfer")), ch).toBe(true);
      expect(PROBLEMS.some((p) => p.chapter === ch && p.kinds.includes("practice")), ch).toBe(true);
    }
    expect(problem("ap.nth.demo")?.statement).toContain("10th term of the AP: 2, 5, 8");
    expect(diagnosticSet("ap").length).toBeGreaterThanOrEqual(4);
  });
});

describe("checking answers against the library", () => {
  it("accepts equivalent answers and names the misconception behind a trap answer", () => {
    const demo = problem("ap.nth.demo")!;
    expect(checkAnswer(demo, "a_10 = 29").verdict).toBe("correct");
    expect(checkAnswer(demo, "32")).toMatchObject({ verdict: "incorrect", misconceptions: ["ap.index_off_by_one"] });
    expect(checkAnswer(demo, "30")).toMatchObject({ verdict: "incorrect", misconceptions: [] });
    const q = problem("quad.fact.01")!;
    expect(checkAnswer(q, "x = 4, x = 3").verdict).toBe("correct");
    expect(checkAnswer(q, "x = -3 or x = -4").misconceptions).toEqual(["quad.root_sign"]);
  });

  it("never classes unreadable work as a misconception", () => {
    expect(checkAnswer(problem("ap.nth.demo")!, "x = ??")).toMatchObject({ verdict: "unreadable", misconceptions: [] });
  });

  it("picks problems by chapter, skill, kind and difficulty without repeats", () => {
    const first = pickProblem({ chapter: "ap", skill: "ap.nth_term", kind: "practice" })!;
    expect(first.skill).toBe("ap.nth_term");
    const next = pickProblem({ chapter: "ap", skill: "ap.nth_term", kind: "practice", exclude: [first.id] })!;
    expect(next.id).not.toBe(first.id);
    expect(pickProblem({ chapter: "ap", kind: "transfer", difficulty: 3 })?.difficulty).toBe(3);
  });
});
