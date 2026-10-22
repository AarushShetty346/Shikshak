import { describe, expect, it } from "vitest";
import { groupIntoLines } from "./lines";
import type { Point, Stroke } from "./types";

let n = 0;
// A fake handwritten glyph: a small zigzag at (x, y) with the given height.
const glyph = (x: number, y: number, h = 24): Stroke => ({
  id: `g${++n}`,
  points: [[x, y], [x + 6, y + h], [x + 12, y]] as Point[],
});
const dash = (x: number, y: number): Stroke => ({ id: `d${++n}`, points: [[x, y], [x + 14, y + 1]] });

describe("groupIntoLines", () => {
  it("groups glyphs on the same row into one line and numbers rows top to bottom", () => {
    const row1 = [glyph(80, 20), glyph(100, 22), dash(120, 32), glyph(140, 18)];
    const row2 = [glyph(80, 70), glyph(100, 72)];
    const row3 = [glyph(80, 121), dash(100, 131)];
    const lines = groupIntoLines([...row3, ...row1, ...row2]); // order of writing shouldn't matter
    expect(lines.map((l) => l.strokeIds.length)).toEqual([4, 2, 2]);
    expect(lines.map((l) => l.index)).toEqual([1, 2, 3]);
    expect(lines[0].box.y).toBeLessThan(lines[1].box.y);
  });

  it("keeps a minus sign with its line even though it is flat", () => {
    const lines = groupIntoLines([glyph(80, 20), dash(110, 30), glyph(130, 20)]);
    expect(lines).toHaveLength(1);
  });

  it("does not merge rows written close together on ruled lines", () => {
    // 48px ruled spacing, glyphs ~28px tall
    const lines = groupIntoLines([glyph(80, 12, 28), glyph(80, 60, 28), glyph(80, 108, 28)]);
    expect(lines).toHaveLength(3);
  });

  it("returns nothing for an empty page", () => {
    expect(groupIntoLines([])).toEqual([]);
  });
});
