import { beforeEach, describe, expect, it } from "vitest";
import type { BoardEvent } from "../shared/types";
import { continueLesson, draw, erase, highlight, noteInterrupt, parseTarget, write } from "./board";
import { createSession, resetSessions, type Session } from "./sessions";
import { store } from "./store";

let s: Session;
let sent: BoardEvent[] = [];
const events = () => sent;

beforeEach(() => {
  resetSessions();
  store.reset();
  s = createSession("d_test");
  sent = [];
  // A stand-in browser tab that records every board event it receives.
  const fake = { readyState: 1, OPEN: 1, send: (d: string) => { const m = JSON.parse(d); if (m.kind === "event") sent.push(m.event); }, close() {}, terminate() {} };
  s.sockets.add(fake as never);
});

describe("board actions", () => {
  it("labels blocks and returns a board map the tutor can point at", () => {
    const a = write(s, { kind: "heading", content: "Arithmetic Progression" });
    const b = write(s, { kind: "steps", content: "a_n = a + (n-1)d || a_4 = 2 + 3*3 || a_4 = 11" });
    expect(a.label).toBe("B1");
    expect(b.label).toBe("B2");
    expect(b.board).toContain("B1 (heading): Arithmetic Progression");
    expect(b.board).toContain("B2 (steps): a_n = a + (n-1)d / a_4 = 2 + 3*3 / a_4 = 11");
    expect(events()[1]).toMatchObject({ type: "write", label: "B2", style: "steps", lines: ["a_n = a + (n-1)d", "a_4 = 2 + 3*3", "a_4 = 11"], place: "next" });
  });

  it("draws a diagram, or explains the format when it can't", () => {
    expect(draw(s, { diagram: "ap: 2, 5, 8 | d = 3", place: "right" })).toMatchObject({ ok: true, label: "B1" });
    expect(events()[0]).toMatchObject({ type: "draw", place: "right", diagram: { type: "ap" } });
    const bad = draw(s, { diagram: "a nice circle" });
    expect(bad.ok).toBe(false);
    expect(String(bad.error)).toContain("ap: 2, 5, 8, 11");
  });

  it("highlights a block or one of its lines, and refuses unknown targets", () => {
    write(s, { kind: "steps", content: "x || y || z" });
    expect(highlight(s, { target: "b1 line 2", style: "circle", note: "yeh" })).toMatchObject({ ok: true });
    expect(events()[1]).toMatchObject({ type: "highlight", target: "B1", line: 2, style: "circle", note: "yeh" });
    expect(highlight(s, { target: "B9" }).ok).toBe(false);
    expect(parseTarget("B3:4")).toEqual({ label: "B3", line: 4 });
  });

  it("erases a block, rewrites in its place, and 'all' opens a new page", () => {
    write(s, { kind: "text", content: "wrong idea" });
    expect(erase(s, { target: "B1" })).toMatchObject({ ok: true });
    expect(events()[1]).toEqual({ type: "erase", target: "B1" });
    // A rubbed-out block's spot can be written over.
    const r = write(s, { kind: "text", content: "right idea", replace: "B1" });
    expect(r).toMatchObject({ ok: true, label: "B2" });
    expect(events().at(-1)).toMatchObject({ type: "write", replaces: "B1" });
    expect(write(s, { kind: "text", content: "x", replace: "B7" }).ok).toBe(false);
    expect(erase(s, { target: "all" })).toMatchObject({ ok: true });
    expect(events().slice(-2)).toEqual([{ type: "erase", target: "B2" }, expect.objectContaining({ type: "page" })]); // B1 was already gone
    expect(erase(s, { target: "B9" })).toMatchObject({ ok: false });
  });

  it("remembers where the lesson was when the student interrupted, and resumes there", () => {
    write(s, { kind: "heading", content: "AP" });
    write(s, { kind: "steps", content: "d = a2 - a1 || d = 5 - 2 = 3" });
    noteInterrupt(s);
    write(s, { kind: "text", content: "doubt answer" }); // the tutor answers the doubt on the board
    const r = continueLesson(s);
    expect(String(r.resume)).toContain("B2: d = a2 - a1 / d = 5 - 2 = 3");
    expect(events().at(-1)).toEqual({ type: "resume" });
    expect(s.board.seq).toBe(events().length);
    expect(s.interrupt).toBeNull();
  });
});
