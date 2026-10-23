import { describe, expect, it } from "vitest";
import { applyEvent, applySeq, emptySnapshot } from "./boardState";
import type { BoardEvent } from "./types";

const write = (id: string, label: string, extra: object = {}): BoardEvent => ({ type: "write", id, label, style: "text", lines: [id], place: "next", replaces: null, ...extra }) as BoardEvent;

describe("board snapshot", () => {
  it("applies events in order and ignores duplicates and gaps", () => {
    let s = applyEvent(emptySnapshot(), write("a", "B1"));
    expect(s.seq).toBe(1);
    expect(applySeq(s, 1, write("a", "B1"))).toBe("dup");
    expect(applySeq(s, 3, write("c", "B3"))).toBe("gap");
    const next = applySeq(s, 2, write("b", "B2"));
    expect(next).not.toBe("gap");
    s = next as typeof s;
    expect(s.blocks.map((b) => b.type === "write" && b.label)).toEqual(["B1", "B2"]);
  });

  it("a new question replaces the old one and clears its marks", () => {
    let s = applyEvent(emptySnapshot(), { type: "problem", id: "p1", label: "B1", problem: "Q1", questionId: "q1" });
    s = applyEvent(s, { type: "mark", captureId: "c1", questionId: "q1", line: 2, note: "sign", box: { x: 1, y: 2, w: 3, h: 4 } });
    expect(s.mark?.box).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    s = applyEvent(s, write("y", "B2", { style: "your_turn", questionId: "q2" }));
    expect(s.question).toEqual({ id: "q2", text: "y" });
    expect(s.mark).toBeNull();
  });

  it("erasing and replacing mark blocks rubbed out; highlights on them go", () => {
    let s = applyEvent(emptySnapshot(), write("a", "B1"));
    s = applyEvent(s, { type: "highlight", id: "h", target: "B1", line: null, style: "box", note: "" });
    s = applyEvent(s, { type: "erase", target: "B1" });
    expect(s.blocks[0].erased).toBe(true);
    expect(s.highlights).toEqual([]);
    s = applyEvent(s, write("b", "B2", { replaces: "B1" }));
    expect(s.blocks.map((b) => Boolean(b.erased))).toEqual([true, false]);
  });

  it("stays bounded by dropping whole old pages", () => {
    let s = emptySnapshot();
    for (let i = 0; i < 30; i++) s = applyEvent(s, i % 10 === 0 ? { type: "page", id: `p${i}` } : write(`w${i}`, `B${i}`), 15);
    expect(s.blocks.length).toBeLessThanOrEqual(15);
    expect(s.blocks[0].type).toBe("page"); // cut at a page boundary
    expect(s.seq).toBe(30);
  });
});
