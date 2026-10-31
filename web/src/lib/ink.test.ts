import { describe, expect, it } from "vitest";
import { lastBurstStart } from "./ink";

describe("lastBurstStart", () => {
  it("finds the last drawing: strokes without a long pause between them", () => {
    const s = [{ t: 0 }, { t: 1000 }, { t: 20_000 }, { t: 21_000 }, { t: 23_500 }];
    expect(lastBurstStart(s)).toBe(2);
    expect(s.slice(0, lastBurstStart(s))).toEqual([{ t: 0 }, { t: 1000 }]);
  });
  it("handles an empty board, one stroke, and strokes without times", () => {
    expect(lastBurstStart([])).toBe(0);
    expect(lastBurstStart([{ t: 5 }])).toBe(0);
    expect(lastBurstStart([{}, {}, {}])).toBe(2);
  });
});
