import { describe, expect, it } from "vitest";
import { cleanFix } from "./fix";

describe("cleanFix", () => {
  it("keeps sensible strips and short lines, and drops empty questions", () => {
    const out = cleanFix({
      note: "",
      questions: [
        { question: "  Solve  x + 1 = 2 ", status: "mistake", marks: [{ top: -1, bottom: 0.2, fix: "x = 1" }, { top: 0.9, bottom: 0.5, fix: "" }], solution: ["x + 1 = 2", "", "∴ x = 1"] },
        { question: "", status: "correct", marks: [], solution: [] },
        { question: "?", status: "bogus" as never, marks: [], solution: ["a".repeat(500)] },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      question: "Solve x + 1 = 2",
      status: "mistake",
      marks: [
        { top: 0, bottom: 0.2, fix: "x = 1" },
        { top: 0.9, bottom: 0.92, fix: "" },
      ],
      solution: ["x + 1 = 2", "∴ x = 1"],
    });
    expect(out[1].status).toBe("unreadable");
    expect(out[1].solution[0]).toHaveLength(200);
  });
});
