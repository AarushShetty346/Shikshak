// Draws a tutor diagram in chalk, revealing `shown` pieces in order (the board advances it
// while the tutor talks). Everything is in board units; the SVG scales with the board.

import { compileGraphExpr, graphSegments, type Diagram } from "../../../shared/diagram";
import { prettify as prettifyText } from "../../../shared/mathText";

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", n: "ⁿ", "-": "⁻" };
/** SVG text can't nest superscripts nicely, so use superscript characters: x^2 -> x². */
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", n: "ₙ" };
const prettify = (s: string) =>
  prettifyText(s)
    .replace(/_\(?([0-9n]+)\)?/g, (_, e: string) => e.split("").map((c) => SUB[c] ?? c).join(""))
    .replace(/\^\(?(-?[0-9n]+)\)?/g, (_, e: string) => e.split("").map((c) => SUP[c] ?? c).join(""));

const CHALK = "#f4f1e8";
const YELLOW = "#f6d77a";

/** Height in board units for a diagram drawn `width` units wide. */
/** Graphs and triangles don't need the full column: keep them a sensible size. */
export function diagramWidth(d: Diagram, width: number): number {
  return d.type === "graph" || d.type === "triangle" ? Math.min(width, 520) : width;
}

export function diagramHeight(d: Diagram, columnWidth: number): number {
  const width = diagramWidth(d, columnWidth);
  switch (d.type) {
    case "ap":
      return 150;
    case "numberline":
      return 120;
    case "graph":
      return Math.min(320, width * 0.7);
    case "triangle":
      return 260;
    case "table":
      return 46 * (d.rows.length + 1) + 8;
  }
}

export function DiagramView({ diagram, width: columnWidth, shown, values }: { diagram: Diagram; width: number; shown: number; values?: Record<string, number> }) {
  const width = diagramWidth(diagram, columnWidth);
  const height = diagramHeight(diagram, columnWidth);
  return (
    <svg
      className="diagram"
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: `${(width / columnWidth) * 100}%`, aspectRatio: `${width} / ${height}` }}
      aria-hidden="true"
    >
      <Body d={diagram} w={width} h={height} shown={shown} values={values} />
    </svg>
  );
}

/** A piece fades in and its lines draw themselves when it is reached. */
function Piece({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <g className="dpiece" data-on={on}>
      {children}
    </g>
  );
}

const Line = (p: React.SVGProps<SVGLineElement>) => <line stroke={CHALK} strokeWidth={3} strokeLinecap="round" pathLength={1} className="dline" {...p} />;
const Text = ({ children, ...p }: React.SVGProps<SVGTextElement>) => (
  <text fill={CHALK} fontFamily="Kalam, cursive" fontSize={26} textAnchor="middle" dominantBaseline="middle" {...p}>
    {children}
  </text>
);

function Body({ d, w, h, shown, values }: { d: Diagram; w: number; h: number; shown: number; values?: Record<string, number> }) {
  switch (d.type) {
    case "ap": {
      const n = d.terms.length;
      const box = Math.min(86, (w - 20) / (n * 1.6));
      const gap = box * 0.6;
      const total = n * box + (n - 1) * gap;
      const x0 = (w - total) / 2;
      const y = 74;
      const items: React.ReactNode[] = [];
      d.terms.forEach((t, i) => {
        const x = x0 + i * (box + gap);
        items.push(
          <Piece key={`t${i}`} on={shown > i * 2}>
            <rect x={x} y={y} width={box} height={box * 0.8} rx={8} fill="none" stroke={CHALK} strokeWidth={3} pathLength={1} className="dline" />
            <Text x={x + box / 2} y={y + box * 0.42} fontSize={Math.min(30, box * 0.42)}>
              {prettify(t)}
            </Text>
          </Piece>,
        );
        if (i < n - 1) {
          const ax = x + box / 2;
          const bx = ax + box + gap;
          items.push(
            <Piece key={`a${i}`} on={shown > i * 2 + 1}>
              <path d={`M ${ax} ${y - 4} Q ${(ax + bx) / 2} ${y - 52} ${bx} ${y - 4}`} fill="none" stroke={YELLOW} strokeWidth={2.5} pathLength={1} className="dline" />
              <path d={`M ${bx - 9} ${y - 14} L ${bx} ${y - 4} L ${bx - 12} ${y - 2}`} fill="none" stroke={YELLOW} strokeWidth={2.5} />
              {d.d && (
                <Text x={(ax + bx) / 2} y={y - 50} fill={YELLOW} fontSize={22}>
                  {d.d.startsWith("-") || d.d.startsWith("+") ? prettify(d.d) : `+${prettify(d.d)}`}
                </Text>
              )}
            </Piece>,
          );
        }
      });
      return <>{items}</>;
    }
    case "numberline": {
      const pad = 40;
      const y = 62;
      const span = d.to - d.from;
      const sx = (v: number) => pad + ((v - d.from) / span) * (w - pad * 2);
      const step = span <= 20 ? 1 : 5;
      const ticks: number[] = [];
      for (let v = Math.ceil(d.from / step) * step; v <= d.to; v += step) ticks.push(v);
      return (
        <>
          <Piece on={shown > 0}>
            <Line x1={pad - 16} y1={y} x2={w - pad + 16} y2={y} />
            {ticks.map((v) => (
              <g key={v}>
                <line x1={sx(v)} y1={y - 9} x2={sx(v)} y2={y + 9} stroke={CHALK} strokeWidth={2.5} />
                <Text x={sx(v)} y={y + 30} fontSize={20}>
                  {v}
                </Text>
              </g>
            ))}
          </Piece>
          {d.points.map((p, i) => (
            <Piece key={i} on={shown > i + 1}>
              <circle cx={sx(p.x)} cy={y} r={8} fill={YELLOW} />
              {p.label && (
                <Text x={sx(p.x)} y={y - 26} fill={YELLOW} fontSize={22}>
                  {p.label}
                </Text>
              )}
            </Piece>
          ))}
        </>
      );
    }
    case "graph": {
      const pad = 30;
      // A graph with sliders: the equation reads the slider values (the tutor's values until moved).
      const env: Record<string, number> = Object.fromEntries((d.params ?? []).map((q) => [q.name, values?.[q.name] ?? q.value]));
      const names = Object.keys(env);
      const fns = d.exprs.map((e) => {
        const g = compileGraphExpr(e, names);
        return (x: number) => g(x, env);
      });
      // ...and shows where the first curve crosses the x-axis, so moving a slider shows what changes.
      const roots = d.params?.length ? crossings(fns[0], d.xmin, d.xmax) : [];
      const shownExpr = (e: string) => (names.length ? tidy(e.replace(new RegExp(`(^|[^a-z])(${names.join("|")})(?![a-z])`, "gi"), (_m, pre: string, n: string) => pre + String(Math.round(env[n.toLowerCase()] * 100) / 100))) : e);
      const xs = Array.from({ length: 121 }, (_, i) => d.xmin + ((d.xmax - d.xmin) * i) / 120);
      // Range from the sensible part of each curve (ignore the huge values next to an asymptote).
      const ys = fns.flatMap((f) => xs.map(f)).filter((v) => Number.isFinite(v) && Math.abs(v) <= 20);
      const pys = d.points.map((p) => p.y);
      let ymin = Math.max(-20, Math.min(0, ...ys, ...pys));
      let ymax = Math.min(20, Math.max(0, ...ys, ...pys));
      if (ymax - ymin < 2) {
        ymin -= 1;
        ymax += 1;
      }
      const sx = (x: number) => pad + ((x - d.xmin) / (d.xmax - d.xmin)) * (w - pad * 2);
      const sy = (y: number) => h - pad - ((y - ymin) / (ymax - ymin)) * (h - pad * 2);
      const colors = [YELLOW, "#9fd3ff", "#ffb4a8"];
      // Where labels go, so none sits on another or on an axis letter: the equations in a top corner
      // away from the y-axis, "y" left of its axis, points beside their dot (flipped near the edges).
      const yAxisX = sx(Math.min(Math.max(0, d.xmin), d.xmax));
      const legendRight = yAxisX < w / 2;
      const halo = { stroke: "#1f3329", strokeWidth: 6, paintOrder: "stroke" as const, strokeLinejoin: "round" as const };
      const pointLabel = (px: number, py: number) => {
        const right = px + 90 < w;
        return { x: right ? px + 12 : px - 12, y: py - 18, textAnchor: right ? ("start" as const) : ("end" as const) };
      };
      return (
        <>
          <Piece on={shown > 0}>
            <Line x1={sx(d.xmin)} y1={sy(0)} x2={sx(d.xmax)} y2={sy(0)} />
            <Line x1={sx(Math.min(Math.max(0, d.xmin), d.xmax))} y1={sy(ymin)} x2={sx(Math.min(Math.max(0, d.xmin), d.xmax))} y2={sy(ymax)} />
            <Text x={sx(d.xmax) + 2} y={sy(0) + 20} fontSize={20} textAnchor="end" {...halo}>
              x
            </Text>
            <Text x={yAxisX - 12} y={sy(ymax) + 8} fontSize={20} textAnchor="end" {...halo}>
              y
            </Text>
          </Piece>
          {fns.map((f, i) => {
            // Separate pieces where the curve is undefined or jumps (1/x, tan): no false vertical lines.
            const segs = graphSegments(f, d.xmin, d.xmax, ymin, ymax);
            const last = segs.at(-1)?.at(-1);
            return (
              <Piece key={i} on={shown > 1 + i}>
                {segs.map((seg, j) => (
                  <polyline key={j} points={seg.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ")} fill="none" stroke={colors[i % 3]} strokeWidth={3} pathLength={1} className="dline" />
                ))}
                {last && (
                  <Text
                    x={legendRight ? w - 8 : 8}
                    y={20 + i * 24}
                    textAnchor={legendRight ? "end" : "start"}
                    fill={colors[i % 3]}
                    fontSize={20}
                    {...halo}
                  >
                    {`y = ${prettify(shownExpr(d.exprs[i]))}`}
                  </Text>
                )}
              </Piece>
            );
          })}
          {roots.map((r, i) => (
            <g key={`r${i}`} className="graph-root" style={{ opacity: shown > 1 ? 1 : 0, transition: "opacity 0.4s" }}>
              <circle cx={sx(r)} cy={sy(0)} r={7} fill="#7ee0a3" />
              <Text x={sx(r)} y={sy(0) + (i % 2 ? -18 : 30)} fontSize={18} fill="#7ee0a3" {...halo}>
                {fmt(r)}
              </Text>
            </g>
          ))}
          {d.points.map((p, i) => (
            <Piece key={`p${i}`} on={shown > 1 + fns.length + i}>
              <circle cx={sx(p.x)} cy={sy(p.y)} r={7} fill={CHALK} />
              <Text {...pointLabel(sx(p.x), sy(p.y))} fontSize={19} {...halo}>
                {`(${p.x}, ${p.y})`}
              </Text>
            </Piece>
          ))}
        </>
      );
    }
    case "triangle": {
      type P = { x: number; y: number };
      const L = d.labels.map((l) => l.toUpperCase());
      const len = (v?: string) => (v && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : null);
      const sideOf = (p: string, q: string) => {
        const k = [p, q].sort().join("");
        const map: Record<string, string | undefined> = { [[L[0], L[1]].sort().join("")]: d.sides.AB, [[L[1], L[2]].sort().join("")]: d.sides.BC, [[L[2], L[0]].sort().join("")]: d.sides.CA };
        return map[k];
      };
      const pos: Record<string, P> = {};
      if (d.right) {
        // The right angle (opposite the longest side) is the bottom-left corner; the other two corners
        // go up and to the right, drawn to scale when both legs are numbers.
        const corner = (d.rightAt ?? L[1]).toUpperCase();
        const [up, across] = L.filter((l) => l !== corner);
        const lu = len(sideOf(corner, up));
        const la = len(sideOf(corner, across));
        const maxH = h - 75;
        const maxW = w * 0.5;
        let hh = maxH;
        let ww = maxW * 0.9;
        if (lu && la) {
          const k = Math.min(maxH / lu, maxW / la);
          hh = Math.max(60, lu * k);
          ww = Math.max(60, la * k);
        }
        const B0 = { x: Math.max(50, (w - ww) / 2), y: h - 40 };
        pos[corner] = B0;
        pos[up] = { x: B0.x, y: B0.y - hh };
        pos[across] = { x: B0.x + ww, y: B0.y };
      } else {
        pos[L[0]] = { x: w * 0.42, y: 30 };
        pos[L[1]] = { x: w * 0.3, y: h - 40 };
        pos[L[2]] = { x: w * 0.75, y: h - 40 };
      }
      const [A, B, C] = L.map((l) => pos[l]);
      const centre = { x: (A.x + B.x + C.x) / 3, y: (A.y + B.y + C.y) / 3 };
      // Labels sit outside the triangle: pushed away from its centre.
      const away = (p: P, dist: number) => {
        const dx = p.x - centre.x;
        const dy = p.y - centre.y;
        const m = Math.hypot(dx, dy) || 1;
        return { x: p.x + (dx / m) * dist, y: p.y + (dy / m) * dist };
      };
      const mid = (p: P, q: P) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      const sideLabels = [
        { key: "AB", at: away(mid(A, B), 30), text: d.sides.AB },
        { key: "BC", at: away(mid(B, C), 30), text: d.sides.BC },
        { key: "CA", at: away(mid(C, A), 30), text: d.sides.CA },
      ].filter((x) => x.text);
      const corner = d.right ? pos[(d.rightAt ?? L[1]).toUpperCase()] : null;
      const ang = d.angle ? pos[d.angle.at] : null;
      // The marked angle: an arc between its two sides, with the name just inside it on the bisector.
      const arc = (() => {
        if (!ang || !d.angle) return null;
        const others = L.filter((l) => l !== d.angle!.at).map((l) => pos[l]);
        const unit = (q: P) => {
          const m = Math.hypot(q.x - ang.x, q.y - ang.y) || 1;
          return { x: (q.x - ang.x) / m, y: (q.y - ang.y) / m };
        };
        const [u, v] = others.map(unit);
        const shortest = Math.min(...others.map((q) => Math.hypot(q.x - ang.x, q.y - ang.y)));
        const r = Math.max(18, Math.min(30, shortest * 0.3));
        const sweep = u.x * v.y - u.y * v.x > 0 ? 1 : 0;
        const bis = { x: u.x + v.x, y: u.y + v.y };
        const bm = Math.hypot(bis.x, bis.y) || 1;
        // Far enough along the bisector for the name to fit between the two sides (narrow angles
        // push it out), but not beyond the middle of the shorter side.
        const cosHalf = Math.min(1, bm / 2);
        const sinHalf = Math.max(0.12, Math.sqrt(1 - cosHalf * cosHalf));
        const half = (prettify(d.angle.label).length * 12) / 2 + 6;
        const dist = Math.min(Math.max(r + 14, half / sinHalf), shortest * 0.5);
        return {
          d: `M ${ang.x + u.x * r} ${ang.y + u.y * r} A ${r} ${r} 0 0 ${sweep} ${ang.x + v.x * r} ${ang.y + v.y * r}`,
          label: { x: ang.x + (bis.x / bm) * dist, y: ang.y + (bis.y / bm) * dist },
        };
      })();
      return (
        <>
          <Piece on={shown > 0}>
            <path d={`M ${A.x} ${A.y} L ${B.x} ${B.y} L ${C.x} ${C.y} Z`} fill="none" stroke={CHALK} strokeWidth={3} strokeLinejoin="round" pathLength={1} className="dline" />
            {corner && <path d={`M ${corner.x} ${corner.y - 22} L ${corner.x + 22} ${corner.y - 22} L ${corner.x + 22} ${corner.y}`} fill="none" stroke={CHALK} strokeWidth={2.5} />}
            {L.map((l, i) => {
              const at = away(pos[l], 24);
              return (
                <Text key={l} x={at.x} y={at.y}>
                  {d.labels[i]}
                </Text>
              );
            })}
          </Piece>
          {sideLabels.map((x, i) => (
            <Piece key={x.key} on={shown > 1 + i}>
              <Text x={x.at.x} y={x.at.y} fill={YELLOW} fontSize={24}>
                {prettify(x.text!)}
              </Text>
            </Piece>
          ))}
          {arc && d.angle && (
            <Piece on={shown > 1 + sideLabels.length}>
              <path d={arc.d} fill="none" stroke={YELLOW} strokeWidth={2.5} />
              <Text x={arc.label.x} y={arc.label.y} fill={YELLOW} fontSize={22}>
                {prettify(d.angle.label)}
              </Text>
            </Piece>
          )}
        </>
      );
    }
    case "table": {
      const cols = d.header.length;
      const cw = Math.min(170, (w - 20) / cols);
      const x0 = (w - cw * cols) / 2;
      const rh = 46;
      const row = (cells: string[], r: number, bold: boolean) => (
        <Piece key={r} on={shown > r}>
          <rect x={x0} y={4 + r * rh} width={cw * cols} height={rh} fill="none" stroke={CHALK} strokeWidth={2} />
          {cells.map((c, i) => (
            <g key={i}>
              {i > 0 && <line x1={x0 + i * cw} y1={4 + r * rh} x2={x0 + i * cw} y2={4 + (r + 1) * rh} stroke={CHALK} strokeWidth={2} />}
              <Text x={x0 + i * cw + cw / 2} y={4 + r * rh + rh / 2} fill={bold ? YELLOW : CHALK} fontSize={23}>
                {prettify(c)}
              </Text>
            </g>
          ))}
        </Piece>
      );
      return (
        <>
          {row(d.header, 0, true)}
          {d.rows.map((r, i) => row(r, i + 1, false))}
        </>
      );
    }
  }
}

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace("-", "−");

/** Where f crosses zero between xmin and xmax (sign changes, refined by bisection). At most 4. */
function crossings(f: (x: number) => number, xmin: number, xmax: number): number[] {
  const out: number[] = [];
  const n = 400;
  let px = xmin;
  let py = f(px);
  for (let i = 1; i <= n && out.length < 4; i++) {
    const x = xmin + ((xmax - xmin) * i) / n;
    const y = f(x);
    if (Number.isFinite(py) && Number.isFinite(y)) {
      if (py === 0) out.push(px);
      else if (py * y < 0 && Math.abs(y - py) < 50) {
        let [a, b] = [px, x];
        for (let k = 0; k < 40; k++) {
          const m = (a + b) / 2;
          if (f(a) * f(m) <= 0) b = m;
          else a = m;
        }
        out.push((a + b) / 2);
      }
    }
    px = x;
    py = y;
  }
  return out;
}

/** "1 x^2 + -1 x + -6" -> "x^2 - x - 6": how a student would write the equation with the slider values in. */
function tidy(e: string): string {
  return e
    .replace(/\s+/g, " ")
    .replace(/\+\s*-\s*/g, "- ")
    .replace(/-\s*-\s*/g, "+ ")
    .replace(/(^|[^\d.])1\s*(?=x)/g, "$1")
    .replace(/(^|[^\d.])-1\s*(?=x)/g, "$1-")
    .replace(/(\d)\s+x/g, "$1x")
    .replace(/[+-]\s*0\s*x(\^\d)?\s*/g, "")
    .replace(/\s*[+-]\s*0(?![\d.x])/g, "")
    .trim();
}
