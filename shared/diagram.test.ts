import { describe, expect, it } from "vitest";
import { compileExpr, DIAGRAM_EXAMPLES, diagramPieces, parseDiagram } from "./diagram";

describe("diagram language", () => {
  it("parses every documented example", () => {
    for (const ex of DIAGRAM_EXAMPLES) expect(() => parseDiagram(ex)).not.toThrow();
  });

  it("reads an AP with its common difference, revealed term-arrow-term", () => {
    const d = parseDiagram("ap: 2, 5, 8, 11 | d = 3");
    expect(d).toEqual({ type: "ap", terms: ["2", "5", "8", "11"], d: "3" });
    expect(diagramPieces(d)).toBe(7);
  });

  it("reads triangles, number lines and tables", () => {
    const t = parseDiagram("triangle: right | vertices: P, Q, R | PQ = 3, QR = 4, PR = 5 | angle: theta at P");
    expect(t).toMatchObject({ type: "triangle", right: true, labels: ["P", "Q", "R"], sides: { AB: "3", BC: "4", CA: "5" }, angle: { at: "P", label: "theta" } });
    expect(parseDiagram("numberline: -3..3 | points: -1, 2 | labels: a, b")).toMatchObject({ from: -3, to: 3, points: [{ x: -1, label: "a" }, { x: 2, label: "b" }] });
    expect(parseDiagram("table: n, a_n ; 1, 2 ; 2, 5")).toEqual({ type: "table", header: ["n", "a_n"], rows: [["1", "2"], ["2", "5"]] });
  });

  it("explains what's wrong with a bad diagram", () => {
    expect(() => parseDiagram("pie chart: 1, 2")).toThrow(/Unknown diagram/);
    expect(() => parseDiagram("ap: 5")).toThrow(/at least 2 terms/);
    expect(() => parseDiagram("graph: y = hello")).toThrow();
  });

  it("evaluates graph equations with implicit multiplication and powers", () => {
    expect(compileExpr("x^2 - 4")(3)).toBe(5);
    expect(compileExpr("2x + 1")(2)).toBe(5);
    expect(compileExpr("x(x - 2)")(3)).toBe(3);
    expect(compileExpr("-x^2")(2)).toBe(-4);
    expect(compileExpr("sqrt(x) + 3(x+1)")(4)).toBe(17);
    expect(compileExpr("sin(30)")(0)).toBeCloseTo(0.5);
  });
});
