import { describe, expect, it } from "vitest";
import { splitSteps, toMathParts } from "./mathText";

describe("toMathParts", () => {
  it("turns ^ into superscripts", () => {
    expect(toMathParts("x^2 - 5x + 6 = 0")).toEqual([{ text: "x" }, { text: "2", sup: true }, { text: " - 5x + 6 = 0" }]);
    expect(toMathParts("2^(n+1)")).toEqual([{ text: "2" }, { text: "n+1", sup: true }]);
  });

  it("swaps plain-text operators for symbols", () => {
    expect(toMathParts("sqrt(b^2 - 4ac)")[0].text).toBe("√(b");
    expect(toMathParts("x +- 3")[0].text).toBe("x ± 3");
    expect(toMathParts("sin theta * 2")[0].text).toBe("sin θ × 2");
  });
});

describe("splitSteps", () => {
  it("accepts ||, newlines, escaped newlines and JSON arrays", () => {
    expect(splitSteps("a || b ||c")).toEqual(["a", "b", "c"]);
    expect(splitSteps("a\nb")).toEqual(["a", "b"]);
    expect(splitSteps("a\nb")).toEqual(["a", "b"]);
    expect(splitSteps('["a","b"]')).toEqual(["a", "b"]);
    expect(splitSteps(["a", " "])).toEqual(["a"]);
    expect(splitSteps(undefined)).toEqual([]);
  });
});
