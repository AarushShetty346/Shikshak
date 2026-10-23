// A tiny diagram language the tutor writes in one line, e.g. "ap: 2, 5, 8, 11 | d = 3".
// The server checks it when the tool is called; the board draws it in chalk, piece by piece,
// while the tutor talks about it. Shared so both sides agree on what is valid.

export type Diagram =
  | { type: "ap"; terms: string[]; d: string | null }
  | { type: "numberline"; from: number; to: number; points: { x: number; label: string }[] }
  | { type: "graph"; exprs: string[]; points: { x: number; y: number; label: string }[]; xmin: number; xmax: number }
  | { type: "triangle"; labels: [string, string, string]; sides: { AB?: string; BC?: string; CA?: string }; angle: { at: string; label: string } | null; right: boolean }
  | { type: "table"; header: string[]; rows: string[][] };

export const DIAGRAM_EXAMPLES = [
  "ap: 2, 5, 8, 11 | d = 3",
  "numberline: -5..5 | points: -2, 3 | labels: a, b",
  "graph: y = x^2 - 4 ; y = 2x | points: (2,0), (-2,0) | x: -4..4",
  "triangle: right | vertices: A, B, C | AB = 3, BC = 4, AC = 5 | angle: theta at A",
  "table: n, a_n ; 1, 2 ; 2, 5 ; 3, 8",
];

/** How many pieces the board reveals one by one while the tutor talks. */
export function diagramPieces(d: Diagram): number {
  switch (d.type) {
    case "ap":
      return d.terms.length * 2 - 1;
    case "numberline":
      return 1 + d.points.length;
    case "graph":
      return 1 + d.exprs.length + d.points.length;
    case "triangle":
      return 1 + Object.keys(d.sides).length + (d.angle ? 1 : 0);
    case "table":
      return 1 + d.rows.length;
  }
}

function parts(spec: string): { kind: string; head: string; rest: Map<string, string>; extra: string[] } {
  const segs = spec.split("|").map((s) => s.trim()).filter(Boolean);
  const first = segs.shift() ?? "";
  const colon = first.indexOf(":");
  const kind = (colon >= 0 ? first.slice(0, colon) : first).trim().toLowerCase();
  const head = colon >= 0 ? first.slice(colon + 1).trim() : "";
  const rest = new Map<string, string>();
  const extra: string[] = [];
  for (const s of segs) {
    const m = /^([a-z_ ]+):\s*(.*)$/i.exec(s);
    if (m) rest.set(m[1].trim().toLowerCase(), m[2].trim());
    else extra.push(s);
  }
  return { kind, head, rest, extra };
}

const list = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const num = (s: string) => {
  const n = Number(s.replace(/[−–]/g, "-"));
  if (!Number.isFinite(n)) throw new Error(`"${s}" is not a number`);
  return n;
};
function range(s: string, fallback: [number, number]): [number, number] {
  const m = /^\s*(-?[\d.]+)\s*\.\.\s*(-?[\d.]+)\s*$/.exec(s.replace(/[−–]/g, "-"));
  if (!m) return fallback;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a < b ? [a, b] : fallback;
}

/** Parses the one-line diagram language. Throws with a short reason the tutor can act on. */
export function parseDiagram(raw: string): Diagram {
  const spec = String(raw ?? "").trim();
  const { kind, head, rest, extra } = parts(spec);
  switch (kind) {
    case "ap": {
      const terms = list(head).slice(0, 7);
      if (terms.length < 2) throw new Error("ap needs at least 2 terms, e.g. ap: 2, 5, 8, 11 | d = 3");
      const dm = /d\s*=\s*(.+)/i.exec(extra.join(" ") || rest.get("d") || "");
      return { type: "ap", terms, d: dm ? dm[1].trim() : rest.get("d") ?? null };
    }
    case "numberline": {
      const [from, to] = range(head, [-5, 5]);
      if (to - from > 40) throw new Error("numberline range is too wide; keep it within 40");
      const xs = list(rest.get("points")).map(num).slice(0, 8);
      const labels = list(rest.get("labels"));
      return { type: "numberline", from, to, points: xs.map((x, i) => ({ x, label: labels[i] ?? "" })) };
    }
    case "graph": {
      const exprs = head
        .split(";")
        .map((e) => e.trim().replace(/^y\s*=\s*/i, ""))
        .filter(Boolean)
        .slice(0, 3);
      if (!exprs.length) throw new Error("graph needs an equation, e.g. graph: y = x^2 - 4");
      for (const e of exprs) compileExpr(e); // throws if it can't be drawn
      const [xmin, xmax] = range(rest.get("x") ?? "", [-5, 5]);
      const points = [...(rest.get("points") ?? "").matchAll(/\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g)]
        .slice(0, 6)
        .map((m) => ({ x: Number(m[1]), y: Number(m[2]), label: "" }));
      return { type: "graph", exprs, points, xmin, xmax };
    }
    case "triangle": {
      const right = /right/i.test(head);
      const v = list(rest.get("vertices"));
      const labels: [string, string, string] = [v[0] || "A", v[1] || "B", v[2] || "C"];
      const sides: { AB?: string; BC?: string; CA?: string } = {};
      for (const seg of [...extra, ...[...rest.entries()].filter(([k]) => /^[a-z]{2}$/i.test(k)).map(([k, val]) => `${k}=${val}`)]) {
        for (const pair of seg.split(",")) {
          const m = /^\s*([A-Za-z])\s*([A-Za-z])\s*=\s*(.+?)\s*$/.exec(pair);
          if (!m) continue;
          const key = (m[1] + m[2]).toUpperCase();
          const val = m[3];
          const [a, b, c] = labels.map((l) => l.toUpperCase());
          if (key === a + b || key === b + a) sides.AB = val;
          else if (key === b + c || key === c + b) sides.BC = val;
          else if (key === a + c || key === c + a) sides.CA = val;
        }
      }
      const am = /^(.+?)\s+at\s+([A-Za-z])$/i.exec(rest.get("angle") ?? "");
      return { type: "triangle", labels, sides, angle: am ? { label: am[1].trim(), at: am[2].toUpperCase() } : null, right };
    }
    case "table": {
      const rows = head.split(";").map((r) => list(r)).filter((r) => r.length);
      if (rows.length < 2) throw new Error("table needs a header and at least one row, e.g. table: n, a_n ; 1, 2");
      const width = rows[0].length;
      return { type: "table", header: rows[0], rows: rows.slice(1, 9).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")) };
    }
    default:
      throw new Error(`Unknown diagram "${kind}". Use one of: ${DIAGRAM_EXAMPLES.join("  /  ")}`);
  }
}

// ---------- turning y = f(x) into drawable pieces ----------

/**
 * Samples f over [xmin, xmax] and splits the curve wherever it is undefined (sqrt of a negative,
 * division by zero) or jumps across an asymptote (1/x, tan), so no false vertical line is drawn.
 * Pieces are clipped to [ymin, ymax], ending exactly where they cross the edge.
 */
export function graphSegments(f: (x: number) => number, xmin: number, xmax: number, ymin: number, ymax: number, samples = 400): [number, number][][] {
  const out: [number, number][][] = [];
  let seg: [number, number][] = [];
  const span = ymax - ymin;
  const inside = (y: number) => y >= ymin && y <= ymax;
  const clampY = (y: number) => Math.max(ymin, Math.min(ymax, y));
  const close = () => {
    if (seg.length > 1) out.push(seg);
    seg = [];
  };
  let prev: [number, number] | null = null;
  for (let i = 0; i <= samples; i++) {
    const x = xmin + ((xmax - xmin) * i) / samples;
    const y = f(x);
    if (!Number.isFinite(y)) {
      close();
      prev = null;
      continue;
    }
    if (prev) {
      const [px, py] = prev;
      // An asymptote: the curve leaves through one edge and comes back through the other.
      const jump = Math.abs(y - py) > span * 2 || ((py > ymax && y < ymin) || (py < ymin && y > ymax));
      if (jump) {
        close();
        prev = [x, y];
        if (inside(y)) seg.push([x, y]);
        continue;
      }
      if (inside(py) !== inside(y)) {
        // Crossing the top or bottom edge: end (or start) the piece exactly on the edge.
        const edge = (inside(py) ? y : py) > ymax ? ymax : ymin;
        const t = (edge - py) / (y - py);
        const ex = px + (x - px) * t;
        if (inside(py)) {
          seg.push([ex, edge]);
          close();
        } else {
          seg.push([ex, edge]);
          seg.push([x, y]);
        }
        prev = [x, y];
        continue;
      }
    }
    if (inside(y)) seg.push([x, clampY(y)]);
    prev = [x, y];
  }
  close();
  return out;
}

// ---------- a small, safe expression compiler for y = f(x) ----------
// Supports numbers, x, + - * / ^, brackets, implicit multiplication (2x, 3(x+1), x(x-2)),
// and sqrt, abs, sin, cos, tan (degrees, as in class 10).

type Tok = { t: "num"; v: number } | { t: "x" } | { t: "op"; v: string } | { t: "fn"; v: string } | { t: "("; } | { t: ")" };

function tokenize(src: string): Tok[] {
  const s = src.replace(/\s+/g, "").replace(/[−–]/g, "-").replace(/×/g, "*").replace(/÷/g, "/").replace(/²/g, "^2").replace(/³/g, "^3");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[\d.]/.test(c)) {
      let j = i;
      while (j < s.length && /[\d.]/.test(s[j])) j++;
      out.push({ t: "num", v: Number(s.slice(i, j)) });
      i = j;
    } else if (c === "x" || c === "X") {
      out.push({ t: "x" });
      i++;
    } else if ("+-*/^".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else if (c === "(") {
      out.push({ t: "(" });
      i++;
    } else if (c === ")") {
      out.push({ t: ")" });
      i++;
    } else {
      const m = /^(sqrt|abs|sin|cos|tan)/i.exec(s.slice(i));
      if (!m) throw new Error(`can't draw "${src}"`);
      out.push({ t: "fn", v: m[1].toLowerCase() });
      i += m[1].length;
    }
  }
  // Implicit multiplication: 2x, 2(, x(, )(, )x, x2 (rare)
  const withMul: Tok[] = [];
  for (const tok of out) {
    const prev = withMul[withMul.length - 1];
    const prevEnds = prev && (prev.t === "num" || prev.t === "x" || prev.t === ")");
    const startsValue = tok.t === "num" || tok.t === "x" || tok.t === "(" || tok.t === "fn";
    if (prevEnds && startsValue) withMul.push({ t: "op", v: "*" });
    withMul.push(tok);
  }
  return withMul;
}

export function compileExpr(src: string): (x: number) => number {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const fns: Record<string, (v: number) => number> = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    sin: (v) => Math.sin((v * Math.PI) / 180),
    cos: (v) => Math.cos((v * Math.PI) / 180),
    tan: (v) => Math.tan((v * Math.PI) / 180),
  };
  type F = (x: number) => number;
  const expr = (): F => {
    let left = term();
    for (let t = peek(); t && t.t === "op" && (t.v === "+" || t.v === "-"); t = peek()) {
      p++;
      const right = term();
      const l = left;
      left = t.v === "+" ? (x) => l(x) + right(x) : (x) => l(x) - right(x);
    }
    return left;
  };
  const term = (): F => {
    let left = unary();
    for (let t = peek(); t && t.t === "op" && (t.v === "*" || t.v === "/"); t = peek()) {
      p++;
      const right = unary();
      const l = left;
      left = t.v === "*" ? (x) => l(x) * right(x) : (x) => l(x) / right(x);
    }
    return left;
  };
  // Minus binds looser than powers: -x^2 is -(x^2), as in maths.
  const unary = (): F => {
    const t = peek();
    if (t && t.t === "op" && t.v === "-") {
      p++;
      const v = unary();
      return (x) => -v(x);
    }
    if (t && t.t === "op" && t.v === "+") {
      p++;
      return unary();
    }
    return power();
  };
  const power = (): F => {
    const base = atom();
    const t = peek();
    if (t && t.t === "op" && t.v === "^") {
      p++;
      const exp = unary(); // allows 2^-1, and 2^3^2 = 2^(3^2)
      return (x) => Math.pow(base(x), exp(x));
    }
    return base;
  };
  const atom = (): F => {
    const t = toks[p++];
    if (!t) throw new Error(`can't draw "${src}"`);
    if (t.t === "num") return () => t.v;
    if (t.t === "x") return (x) => x;
    if (t.t === "fn") {
      const f = fns[t.v];
      const arg = atom();
      return (x) => f(arg(x));
    }
    if (t.t === "(") {
      const inner = expr();
      if (toks[p++]?.t !== ")") throw new Error(`missing ")" in "${src}"`);
      return inner;
    }
    throw new Error(`can't draw "${src}"`);
  };
  const fn = expr();
  if (p !== toks.length) throw new Error(`can't draw "${src}"`);
  return fn;
}
