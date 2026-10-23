import { describe, expect, it } from "vitest";
import { describeAnswer, PROBLEMS, problem } from "./curriculum/library";
import type { Problem } from "./curriculum/types";
import { describeMarking, formatMarks, markWork, readingLines } from "./marking";

const nth = problem("ap.nth.demo")!;
const fact = problem("quad.fact.01")!;

describe("practice marking (CBSE style)", () => {
  it("full marks for complete, correct working", () => {
    const m = markWork(nth, ["a = 2, d = 5 - 2 = 3", "a_n = a + (n - 1)d", "a_10 = 2 + (10 - 1) × 3 = 2 + 27 = 29"], "29");
    expect(m).toMatchObject({ got: 2, of: 2, provisional: false, firstError: null });
    expect(m.points.every((p) => p.how === "shown")).toBe(true);
  });

  it("penalises an error once: later steps that carry it forward correctly keep their marks", () => {
    // d should be 3; the student wrote 4 and then worked correctly with 4.
    const m = markWork(nth, ["a = 2, d = 5 - 2 = 4", "a_10 = 2 + 9 × 4 = 38"], "38");
    expect(m.firstError).toMatchObject({ line: 1 });
    expect(m.points.map((p) => p.how)).toEqual(["missing", "follow-through"]);
    expect(m.answer.how).toBe("follow-through");
    expect(m.got).toBe(1.5);
  });

  it("a method error (wrong n - 1) loses the step and the answer", () => {
    const m = markWork(nth, ["a = 2, d = 5 - 2 = 3", "a_10 = 2 + 10 × 3 = 32"], "32");
    expect(m.points.map((p) => p.how)).toEqual(["shown", "missing"]);
    expect(m.answer.how).toBe("wrong");
    expect(m.got).toBe(0.5);
  });

  it("an answer alone gets the answer mark only, and says to show the steps", () => {
    const m = markWork(nth, ["29"], "29");
    expect(m.got).toBe(1);
    expect(describeMarking(m)).toMatch(/show them/);
  });

  it("an answer written differently but equal still counts", () => {
    expect(markWork(nth, ["a_10 = 2 + 9*3 = 29"], "a_10 = 29").answer.how).toBe("correct");
  });

  it("unreadable lines earn nothing and make the result provisional", () => {
    const m = markWork(nth, ["a = 2, d = 5 - 2 = 3", "a_10 = 2 + ?? = 29"], "29");
    expect(m.provisional).toBe(true);
    expect(m.unreadableLines).toEqual([2]);
    expect(m.points[1].how).toBe("missing");
    expect(describeMarking(m)).toMatch(/provisional/);
  });

  it("marks algebra steps by their written form, not just their value", () => {
    const full = markWork(fact, ["x^2 - 3x - 4x + 12 = 0", "x(x - 3) - 4(x - 3) = 0", "(x - 3)(x - 4) = 0", "x = 3 or x = 4"], "x = 3 or x = 4");
    expect(full).toMatchObject({ got: 2.5, of: 2.5 });
    // Jumping straight to the factors earns that step, not the splitting steps it skipped.
    const jump = markWork(fact, ["(x - 4)(x - 3) = 0", "x = 4 or x = 3"], "x = 4 or x = 3");
    expect(jump.points.map((p) => p.how)).toEqual(["missing", "missing", "shown"]);
    expect(jump.got).toBe(1.5);
  });

  it("a correct alternative method earns full marks", () => {
    const p: Problem = {
      ...nth,
      id: "test.alt",
      alternates: [
        {
          name: "Counting on from the first term",
          steps: [
            { text: "9 steps of 3 after 2", check: { chain: "9*3 = 27" } },
            { text: "2 + 27 = 29", check: { chain: "2 + 27 = 29" } },
          ],
        },
      ],
    };
    const m = markWork(p, ["9 × 3 = 27", "2 + 27 = 29"], "29");
    expect(m.method).toBe("Counting on from the first term");
    expect(m.got).toBe(m.of);
  });

  it("reads the reader's numbered lines", () => {
    expect(readingLines("1) a = 2\n2) d = 3\n\n3. a_10 = 29")).toEqual(["a = 2", "d = 3", "a_10 = 29"]);
  });

  it("formats half marks", () => {
    expect([0, 0.5, 1, 1.5, 2].map(formatMarks)).toEqual(["0", "½", "1", "1½", "2"]);
  });

  it("every library problem's own worked solution gets full marks (the scheme is consistent)", () => {
    for (const p of PROBLEMS) {
      const lines = p.steps.map((s) => s.text);
      const final = describeAnswer(p.answer);
      const m = markWork(p, lines, final);
      expect(m.got, `${p.id}: ${describeMarking(m)}`).toBe(m.of);
    }
  });
});

describe("practice marks on a board check", () => {
  it("are attached when the student works a library problem, and flag unreadable lines", async () => {
    const { verifyReading } = await import("./look");
    const s = { problem: { id: "q1", text: nth.statement, problemId: nth.id, answerSpec: nth.answer, kind: "practice", askedAt: 0, rung: 0 } } as never;
    const base = { kind: "working", what_went_wrong: "", say: "", misconception_id: "none" } as const;
    const ok = verifyReading(s, { ...base, reading: "1) d = 5 - 2 = 3\n2) a_10 = 2 + 9 × 3 = 29", status: "correct", line: null, final_answer: "29" });
    expect(ok.marks).toMatchObject({ got: 2, of: 2 });
    expect(ok.practice_marks).toMatch(/2 \/ 2/);
    const blurry = verifyReading(s, { ...base, reading: "1) d = 5 - 2 = 3\n2) a_10 = 2 + 9 × 3 = 29", status: "unreadable", line: 2, final_answer: "" });
    expect(blurry.marks).toMatchObject({ provisional: true, unreadableLines: [2] });
    // A question or a diagram isn't marked.
    expect(verifyReading(s, { ...base, kind: "question", reading: "why?", status: "not_checked", line: null, final_answer: "" }).marks).toBeUndefined();
  });
});
