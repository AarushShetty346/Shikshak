import { describe, expect, it } from "vitest";
import { chainHolds, sameExpression, solveOne, solvePair, value } from "./algebra";
import { compareAnswer } from "./answers";
import { Q, Surd } from "./exact";

const v = (s: string) => value(s).toString();

describe("exact numbers", () => {
  it("keeps fractions exact", () => {
    expect(v("1/3 + 1/6")).toBe("1/2");
    expect(v("0.1 + 0.2")).toBe("3/10");
    expect(value("1.5").eq(value("3/2"))).toBe(true);
    expect(v("-(2)^2")).toBe("-4");
    expect(v("(-2)^2")).toBe("4");
    expect(v("2^-1")).toBe("1/2");
  });

  it("simplifies square roots and keeps them exact", () => {
    expect(value("sqrt(12)").eq(value("2*sqrt(3)"))).toBe(true);
    expect(value("√8").eq(value("2√2"))).toBe(true);
    expect(value("sqrt(3)*sqrt(3)").eq(value("3"))).toBe(true);
    expect(value("1/sqrt(2)").eq(value("sqrt(2)/2"))).toBe(true);
    expect(value("1/(2+sqrt(3))").eq(value("2 - sqrt(3)"))).toBe(true);
    expect(value("sqrt(2)").eq(value("1.414"))).toBe(false);
  });

  it("knows the standard trig values exactly (degrees)", () => {
    expect(value("sin 30").eq(value("1/2"))).toBe(true);
    expect(value("cos 60°").eq(value("1/2"))).toBe(true);
    expect(value("tan 60").eq(value("√3"))).toBe(true);
    expect(value("tan 30").eq(value("1/√3"))).toBe(true);
    expect(value("sin^2 30 + cos^2 30").eq(value("1"))).toBe(true);
    expect(value("cosec 30").eq(value("2"))).toBe(true);
    expect(() => value("tan 90")).toThrow();
    expect(() => value("sin 37")).toThrow();
  });

  it("refuses to divide by zero", () => {
    expect(() => value("1/0")).toThrow();
    expect(() => new Q(1n, 0n)).toThrow();
    expect(Surd.of(0).isZero()).toBe(true);
  });
});

describe("solving", () => {
  it("solves linear and quadratic equations exactly", () => {
    expect(solveOne("2x + 3 = 11")).toMatchObject({ kind: "roots", variable: "x" });
    expect((solveOne("2x + 3 = 11") as { roots: Surd[] }).roots.map(String)).toEqual(["4"]);
    expect((solveOne("x^2 - 7x + 12 = 0") as { roots: Surd[] }).roots.map(String)).toEqual(["3", "4"]);
    expect((solveOne("2x^2 + x - 6 = 0") as { roots: Surd[] }).roots.map(String)).toEqual(["-2", "3/2"]);
    const irr = solveOne("x^2 - 5x + 3 = 0") as { roots: Surd[] };
    expect(irr.roots[1].eq(value("(5 + sqrt(13))/2"))).toBe(true);
    expect(solveOne("x^2 + x + 1 = 0").kind).toBe("none");
    expect((solveOne("(x - 2)^2 = 0") as { roots: Surd[] }).roots.map(String)).toEqual(["2"]);
    expect((solveOne("x(x - 3) = 0") as { roots: Surd[] }).roots.map(String)).toEqual(["0", "3"]);
  });

  it("solves pairs of linear equations, and spots no/infinite solutions", () => {
    const r = solvePair("x + y = 3", "2x - y = 3");
    expect(r.kind).toBe("unique");
    expect(Object.fromEntries(Object.entries((r as { values: Record<string, Q> }).values).map(([k, q]) => [k, q.toString()]))).toEqual({ x: "2", y: "1" });
    expect(solvePair("x + y = 3", "2x + 2y = 6").kind).toBe("infinite");
    expect(solvePair("x + y = 3", "2x + 2y = 7").kind).toBe("none");
  });

  it("checks chains of working step by step", () => {
    expect(chainHolds("a_10 = 2 + 9*3 = 29", { a_10: value("29") })).toBe(true);
    expect(chainHolds("2 + 9*3 = 27")).toBe(false);
    expect(chainHolds("(x-2)(x-3) = x^2 - 5x + 6", { x: value("7") })).toBe(true);
    expect(sameExpression("(x - 2)(x - 3)", "x^2 - 5x + 6")).toBe(true);
    expect(sameExpression("(x + 2)^2", "x^2 + 4")).toBe(false);
    expect(sameExpression("3n + 2", "2 + 3n")).toBe(true);
    expect(sameExpression("2 + (n - 1)3", "3n - 1")).toBe(true);
  });
});

describe("comparing answers by value", () => {
  it("roots in any order and any reasonable notation", () => {
    const spec = { type: "roots" as const, variable: "x", values: ["3", "4"] };
    for (const ok of ["x = 3 or x = 4", "4, 3", "x=4, x=3", "x = 3, 4", "3 and 4"]) expect(compareAnswer(spec, ok).verdict).toBe("correct");
    expect(compareAnswer(spec, "x = 3").verdict).toBe("partial");
    expect(compareAnswer(spec, "x = -3 or x = -4").verdict).toBe("incorrect");
    expect(compareAnswer(spec, "x = 3 or x = 5").verdict).toBe("partial");
    expect(compareAnswer(spec, "no real roots").verdict).toBe("incorrect");
    expect(compareAnswer(spec, "x = ?").verdict).toBe("unreadable");
  });

  it("values: fractions, decimals, surds and rounding", () => {
    expect(compareAnswer({ type: "value", value: "3/2" }, "1.5").verdict).toBe("correct");
    expect(compareAnswer({ type: "value", value: "29" }, "a_10 = 2 + 27 = 29").verdict).toBe("correct");
    expect(compareAnswer({ type: "value", value: "sqrt(3)/2" }, "√3/2").verdict).toBe("correct");
    expect(compareAnswer({ type: "value", value: "sqrt(3)/2" }, "0.866").verdict).toBe("approximate");
    expect(compareAnswer({ type: "value", value: "29" }, "30").verdict).toBe("incorrect");
    expect(compareAnswer({ type: "value", value: "29" }, "").verdict).toBe("unreadable");
  });

  it("pairs, expressions and 'no solution'", () => {
    expect(compareAnswer({ type: "pair", values: { x: "2", y: "1" } }, "y = 1, x = 2").verdict).toBe("correct");
    expect(compareAnswer({ type: "pair", values: { x: "2", y: "1" } }, "x = 2, y = 2").verdict).toBe("partial");
    expect(compareAnswer({ type: "expression", variable: "n", expr: "3n + 2" }, "a_n = 2 + 3n").verdict).toBe("correct");
    expect(compareAnswer({ type: "expression", variable: "n", expr: "3n + 2" }, "a_n = 3n + 1").verdict).toBe("incorrect");
    expect(compareAnswer({ type: "none", reason: "no real roots" }, "Koi real root nahi").verdict).toBe("correct");
  });
});

describe("audit regression BUG-03: 'Expand' needs an expanded answer", () => {
  it("accepts multiplied-out forms in any order and refuses brackets or uncollected terms", async () => {
    const { compareAnswer, isExpanded } = await import("./answers");
    const spec = { type: "expression", variable: "x", expr: "x^2 + 6x + 9", form: "expanded" } as const;
    for (const ok of ["x^2 + 6x + 9", "x² + 6x + 9", "9 + 6x + x^2", "x*x + 6*x + 9"]) expect(compareAnswer(spec, ok).verdict, ok).toBe("correct");
    for (const notYet of ["(x+3)(x+3)", "(x + 3)^2", "x^2 + 3x + 3x + 9", "x(x + 6) + 9"]) expect(compareAnswer(spec, notYet).verdict, notYet).toBe("incorrect");
    expect(compareAnswer(spec, "x^2 + 9").verdict).toBe("incorrect");
    // Without the form requirement (an nth term), an unexpanded equal expression still counts.
    expect(compareAnswer({ type: "expression", variable: "n", expr: "3n + 2" }, "2 + 3(n - 1) + 3").verdict).toBe("correct");
    expect(isExpanded("x^2 - 6x + 9")).toBe(true);
  });
});
