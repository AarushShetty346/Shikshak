import { describe, expect, it } from "vitest";
import { compareAnswer } from "./answers";
import { solveFreeform } from "./solver";

const answerOf = (p: string) => solveFreeform(p)!.answer;

describe("solving made-up problems deterministically", () => {
  it("one equation", () => {
    const s = solveFreeform("Solve: 3x - 5 = 10")!;
    expect(s.kind).toBe("equation");
    expect(compareAnswer(s.answer, "x = 5").verdict).toBe("correct");
    expect(s.steps.every((st) => st.checked)).toBe(true);
    expect(compareAnswer(answerOf("x^2 - 9x + 20 = 0"), "4, 5").verdict).toBe("correct");
    expect(compareAnswer(answerOf("Solve x^2 + 2x + 5 = 0"), "no real roots").verdict).toBe("correct");
  });

  it("a pair of equations", () => {
    const s = solveFreeform("Solve: x + 2y = 7 and 3x - y = 7")!;
    expect(compareAnswer(s.answer, "x = 3, y = 2").verdict).toBe("correct");
    expect(s.steps.filter((st) => st.text.startsWith("Check")).every((st) => st.checked)).toBe(true);
  });

  it("evaluate with trig values", () => {
    expect(compareAnswer(answerOf("Evaluate: tan 45 + 2 sin 30"), "2").verdict).toBe("correct");
    expect(compareAnswer(answerOf("Find the value of cos^2 45 + sin^2 45"), "1").verdict).toBe("correct");
  });

  it("AP questions", () => {
    expect(compareAnswer(answerOf("Find the 12th term of the AP: 4, 9, 14, ..."), "59").verdict).toBe("correct");
    expect(compareAnswer(answerOf("Find the sum of the first 12 terms of the AP: 4, 9, 14, ..."), "378").verdict).toBe("correct");
    expect(compareAnswer(answerOf("Which term of the AP: 4, 9, 14, ... is 59?"), "12").verdict).toBe("correct");
    for (const p of ["Find the 12th term of the AP: 4, 9, 14, ...", "Which term of the AP: 4, 9, 14, ... is 59?"]) expect(solveFreeform(p)!.steps.filter((s) => s.checked).length).toBeGreaterThan(0);
  });

  it("says 'unsupported' instead of guessing", () => {
    expect(solveFreeform("Prove that the angle in a semicircle is a right angle")).toBeNull();
    expect(solveFreeform("Find the 10th term of the AP: 2, 5, 9, ...")).toBeNull(); // not an AP
    expect(solveFreeform("Solve x^3 = 8")).toBeNull();
  });
});
