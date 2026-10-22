// Draws a tutor diagram in chalk, revealing `shown` pieces in order (the board advances it
// while the tutor talks). Everything is in board units; the SVG scales with the board.

import { compileExpr, type Diagram } from "../../../shared/diagram";
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

export function DiagramView({ diagram, width: columnWidth, shown }: { diagram: Diagram; width: number; shown: number }) {
  const width = diagramWidth(diagram, columnWidth);
  const height = diagramHeight(diagram, columnWidth);
  return (
    <svg
      className="diagram"
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: `${(width / columnWidth) * 100}%`, aspectRatio: `${width} / ${height}` }}
      aria-hidden="true"
    >
      <Body d={diagram} w={width} h={height} shown={shown} />
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

function Body({ d, w, h, shown }: { d: Diagram; w: number; h: number; shown: number }) {
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
      const fns = d.exprs.map((e) => compileExpr(e));
      const xs = Array.from({ length: 121 }, (_, i) => d.xmin + ((d.xmax - d.xmin) * i) / 120);
      const ys = fns.flatMap((f) => xs.map(f)).filter((v) => Number.isFinite(v));
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
      return (
        <>
          <Piece on={shown > 0}>
            <Line x1={sx(d.xmin)} y1={sy(0)} x2={sx(d.xmax)} y2={sy(0)} />
            <Line x1={sx(Math.min(Math.max(0, d.xmin), d.xmax))} y1={sy(ymin)} x2={sx(Math.min(Math.max(0, d.xmin), d.xmax))} y2={sy(ymax)} />
            <Text x={sx(d.xmax) - 6} y={sy(0) + 20} fontSize={20}>
              x
            </Text>
            <Text x={sx(Math.min(Math.max(0, d.xmin), d.xmax)) + 16} y={sy(ymax) + 10} fontSize={20}>
              y
            </Text>
          </Piece>
          {fns.map((f, i) => {
            const pts = xs
              .map((x) => [x, f(x)] as const)
              .filter(([, y]) => Number.isFinite(y) && y >= ymin - 1 && y <= ymax + 1)
              .map(([x, y]) => `${sx(x).toFixed(1)},${sy(Math.max(ymin, Math.min(ymax, y))).toFixed(1)}`);
            return (
              <Piece key={i} on={shown > 1 + i}>
                <polyline points={pts.join(" ")} fill="none" stroke={colors[i % 3]} strokeWidth={3} pathLength={1} className="dline" />
                <Text x={sx(d.xmax) - 70} y={sy(Math.max(ymin, Math.min(ymax, f(d.xmax)))) - 18} fill={colors[i % 3]} fontSize={20}>
                  {`y = ${prettify(d.exprs[i])}`}
                </Text>
              </Piece>
            );
          })}
          {d.points.map((p, i) => (
            <Piece key={`p${i}`} on={shown > 1 + fns.length + i}>
              <circle cx={sx(p.x)} cy={sy(p.y)} r={7} fill={CHALK} />
              <Text x={sx(p.x)} y={sy(p.y) - 20} fontSize={19}>
                {`(${p.x}, ${p.y})`}
              </Text>
            </Piece>
          ))}
        </>
      );
    }
    case "triangle": {
      const top = { x: w * 0.3, y: 30 };
      const left = { x: w * 0.3, y: h - 40 };
      const right = { x: w * 0.75, y: h - 40 };
      // A is the top, B the corner (right angle when "right"), C the far end.
      const A = d.right ? top : { x: w * 0.42, y: 30 };
      const B = left;
      const C = right;
      const pos: Record<string, { x: number; y: number }> = { [d.labels[0].toUpperCase()]: A, [d.labels[1].toUpperCase()]: B, [d.labels[2].toUpperCase()]: C };
      const mid = (p: { x: number; y: number }, q: { x: number; y: number }) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      const sideLabels = [
        { key: "AB", at: mid(A, B), dx: -30, dy: 0, text: d.sides.AB },
        { key: "BC", at: mid(B, C), dx: 0, dy: 28, text: d.sides.BC },
        { key: "CA", at: mid(C, A), dx: 28, dy: -10, text: d.sides.CA },
      ].filter((s) => s.text);
      const ang = d.angle ? pos[d.angle.at] : null;
      return (
        <>
          <Piece on={shown > 0}>
            <path d={`M ${A.x} ${A.y} L ${B.x} ${B.y} L ${C.x} ${C.y} Z`} fill="none" stroke={CHALK} strokeWidth={3} strokeLinejoin="round" pathLength={1} className="dline" />
            {d.right && <path d={`M ${B.x} ${B.y - 22} L ${B.x + 22} ${B.y - 22} L ${B.x + 22} ${B.y}`} fill="none" stroke={CHALK} strokeWidth={2.5} />}
            <Text x={A.x - 18} y={A.y - 4}>{d.labels[0]}</Text>
            <Text x={B.x - 20} y={B.y + 14}>{d.labels[1]}</Text>
            <Text x={C.x + 20} y={C.y + 14}>{d.labels[2]}</Text>
          </Piece>
          {sideLabels.map((s, i) => (
            <Piece key={s.key} on={shown > 1 + i}>
              <Text x={s.at.x + s.dx} y={s.at.y + s.dy} fill={YELLOW} fontSize={24}>
                {prettify(s.text!)}
              </Text>
            </Piece>
          ))}
          {ang && d.angle && (
            <Piece on={shown > 1 + sideLabels.length}>
              <circle cx={ang.x} cy={ang.y} r={34} fill="none" stroke={YELLOW} strokeWidth={2} strokeDasharray="4 5" />
              <Text x={ang.x + (ang === C ? -52 : 30)} y={ang.y + (ang === A ? 48 : -22)} fill={YELLOW} fontSize={24}>
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
