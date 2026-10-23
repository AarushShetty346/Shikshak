import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./protocol";

describe("client message validation", () => {
  it("accepts well-formed messages", () => {
    expect(parseClientMessage({ kind: "sync" }).ok).toBe(true);
    expect(parseClientMessage({ kind: "interrupt", reason: "doubt" }).ok).toBe(true);
    expect(
      parseClientMessage({ kind: "capture", id: "c1", reason: "done", questionId: "q_1", png: "data:image/png;base64,AAAA", lineCount: 1, lines: [{ x: 1, y: 2, w: 3, h: 4 }] }).ok,
    ).toBe(true);
  });

  it("rejects everything else", () => {
    for (const bad of [null, 1, "x", [], {}, { kind: "nope" }, { kind: "sync", extra: 1 }, { kind: "interrupt", reason: "boom" }]) expect(parseClientMessage(bad).ok).toBe(false);
    const base = { kind: "capture", id: "c1", reason: "done", questionId: null, png: "data:image/png;base64,AAAA", lineCount: 1, lines: [{ x: 1, y: 2, w: 3, h: 4 }] };
    expect(parseClientMessage({ ...base, png: "javascript:alert(1)" }).ok).toBe(false);
    expect(parseClientMessage({ ...base, lineCount: 2 }).ok).toBe(false); // lines don't match
    expect(parseClientMessage({ ...base, png: null }).ok).toBe(false); // lines but no image
    expect(parseClientMessage({ ...base, lineCount: 61, lines: Array(61).fill({ x: 0, y: 0, w: 1, h: 1 }) }).ok).toBe(false);
    expect(parseClientMessage({ ...base, lines: [{ x: Infinity, y: 0, w: 1, h: 1 }] }).ok).toBe(false);
    expect(parseClientMessage({ ...base, id: "../../etc" }).ok).toBe(false);
  });
});
