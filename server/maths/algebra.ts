// Parsing and exact algebra for class 10 maths: expressions, equations, polynomials, and solving
// linear and quadratic equations and pairs of linear equations. No eval: a small hand-written
// parser builds a tree, which is evaluated with exact arithmetic (exact.ts).

import { MathError, Q, Surd, trigExact } from "./exact";

export type Node =
  | { k: "num"; v: Q }
  | { k: "var"; name: string }
  | { k: "neg"; a: Node }
  | { k: "add" | "sub" | "mul" | "div"; a: Node; b: Node }
  | { k: "pow"; a: Node; e: Node }
  | { k: "fn"; name: string; a: Node };

const FUNC_ORDER = ["cosec", "sqrt", "sin", "cos", "tan", "csc", "sec", "cot"];

type Tok = { t: "num"; v: string } | { t: "id"; v: string } | { t: "op"; v: string } | { t: "(" } | { t: ")" } | { t: "fn"; v: string; pow?: number };

/** Turns typed or spoken-style maths into a clean form the parser reads. */
export function normalise(src: string): string {
  return String(src)
    .replace(/[−–—]/g, "-")
    .replace(/[×·∙]/g, "*")
    .replace(/÷/g, "/")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/°/g, "")
    .replace(/θ/g, "theta")
    .replace(/√\s*(\d+(?:\.\d+)?|[A-Za-z])/g, "sqrt($1)")
    .replace(/√/g, "sqrt")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(src: string): Tok[] {
  const s = normalise(src);
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " ") {
      i++;
      continue;
    }
    if (/[\d.]/.test(c)) {
      let j = i;
      while (j < s.length && /[\d.]/.test(s[j])) j++;
      out.push({ t: "num", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      const word = /^[A-Za-z]+(?:_[A-Za-z0-9]+)?/.exec(s.slice(i))![0];
      const lower = word.toLowerCase();
      // Longest function name first, so "cosec" isn't read as "cos" + "ec".
      const fn = FUNC_ORDER.find((f) => lower.startsWith(f));
      if (fn && !word.includes("_")) {
        // "sin", or "sinA" / "cosx": the function, then whatever letters follow.
        // "sin^2 A" is read here as one token meaning (sin A)^2.
        i += fn.length;
        const pw = /^\s*\^\s*(\d)/.exec(s.slice(i));
        if (pw && fn !== "sqrt") {
          out.push({ t: "fn", v: fn, pow: Number(pw[1]) });
          i += pw[0].length;
        } else out.push({ t: "fn", v: fn });
      } else if (lower === "theta" || word.includes("_") || word.length === 1) {
        out.push({ t: "id", v: lower === "theta" ? "theta" : word });
        i += word.length;
      } else {
        // "xy" or "ab" is a product of single-letter variables
        for (const ch of word) out.push({ t: "id", v: ch });
        i += word.length;
      }
      continue;
    }
    if ("+-*/^".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      out.push({ t: "(" });
      i++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      out.push({ t: ")" });
      i++;
      continue;
    }
    throw new MathError(`can't read "${c}"`);
  }
  // Implicit multiplication: 2x, 2(x+1), x(x-2), (a)(b), 2sqrt(3), 3sin 30
  const withMul: Tok[] = [];
  for (const tok of out) {
    const prev = withMul[withMul.length - 1];
    const prevEnds = prev && (prev.t === "num" || prev.t === "id" || prev.t === ")");
    const startsValue = tok.t === "num" || tok.t === "id" || tok.t === "(" || tok.t === "fn";
    if (prevEnds && startsValue) withMul.push({ t: "op", v: "*" });
    withMul.push(tok);
  }
  return withMul;
}

export function parse(src: string): Node {
  const toks = tokenize(src);
  if (!toks.length) throw new MathError("empty expression");
  let p = 0;
  const peek = () => toks[p];
  const expr = (): Node => {
    let left = term();
    for (let t = peek(); t && t.t === "op" && (t.v === "+" || t.v === "-"); t = peek()) {
      p++;
      left = { k: t.v === "+" ? "add" : "sub", a: left, b: term() };
    }
    return left;
  };
  const term = (): Node => {
    let left = unary();
    for (let t = peek(); t && t.t === "op" && (t.v === "*" || t.v === "/"); t = peek()) {
      p++;
      left = { k: t.v === "*" ? "mul" : "div", a: left, b: unary() };
    }
    return left;
  };
  // Minus binds looser than powers: -x^2 is -(x^2).
  const unary = (): Node => {
    const t = peek();
    if (t && t.t === "op" && t.v === "-") {
      p++;
      return { k: "neg", a: unary() };
    }
    if (t && t.t === "op" && t.v === "+") {
      p++;
      return unary();
    }
    return power();
  };
  const power = (): Node => {
    const base = atom();
    const t = peek();
    if (t && t.t === "op" && t.v === "^") {
      p++;
      return { k: "pow", a: base, e: unary() };
    }
    return base;
  };
  const atom = (): Node => {
    const t = toks[p++];
    if (!t) throw new MathError("expression ends too early");
    if (t.t === "num") {
      if ((t.v.match(/\./g) ?? []).length > 1) throw new MathError(`bad number ${t.v}`);
      return { k: "num", v: Q.parse(t.v) };
    }
    if (t.t === "id") return { k: "var", name: t.v };
    if (t.t === "fn") {
      const call: Node = { k: "fn", name: t.v, a: atom() };
      return t.pow ? { k: "pow", a: call, e: { k: "num", v: new Q(BigInt(t.pow)) } } : call;
    }
    if (t.t === "(") {
      const inner = expr();
      if (toks[p++]?.t !== ")") throw new MathError("missing )");
      return inner;
    }
    throw new MathError("unexpected symbol");
  };
  const tree = expr();
  if (p !== toks.length) throw new MathError("couldn't read the whole expression");
  return tree;
}

export type Env = Record<string, Surd>;

/** Exact value of an expression. Unknown variables are an error. */
export function evaluate(node: Node, env: Env = {}): Surd {
  switch (node.k) {
    case "num":
      return Surd.rational(node.v);
    case "var": {
      const v = env[node.name];
      if (!v) throw new MathError(`unknown value ${node.name}`);
      return v;
    }
    case "neg":
      return evaluate(node.a, env).neg();
    case "add":
      return evaluate(node.a, env).add(evaluate(node.b, env));
    case "sub":
      return evaluate(node.a, env).sub(evaluate(node.b, env));
    case "mul":
      return evaluate(node.a, env).mul(evaluate(node.b, env));
    case "div":
      return evaluate(node.a, env).div(evaluate(node.b, env));
    case "pow": {
      const e = evaluate(node.e, env).asRational();
      if (!e) throw new MathError("power must be a number");
      if (e.isInt()) return evaluate(node.a, env).pow(Number(e.n));
      if (e.eq(new Q(1n, 2n))) {
        const base = evaluate(node.a, env).asRational();
        if (!base) throw new MathError("can't take this root exactly");
        return Surd.sqrt(base);
      }
      throw new MathError("only whole-number or one-half powers");
    }
    case "fn": {
      const arg = evaluate(node.a, env);
      if (node.name === "sqrt") {
        const q = arg.asRational();
        if (!q) throw new MathError("can't take this root exactly");
        return Surd.sqrt(q);
      }
      const deg = arg.asRational();
      if (!deg) throw new MathError("angle must be a number");
      return trigExact(node.name, deg);
    }
  }
}

export function value(src: string, env: Env = {}): Surd {
  return evaluate(parse(src), env);
}

export function variables(node: Node, out = new Set<string>()): Set<string> {
  switch (node.k) {
    case "var":
      out.add(node.name);
      break;
    case "neg":
    case "fn":
      variables(node.a, out);
      break;
    case "pow":
      variables(node.a, out);
      variables(node.e, out);
      break;
    case "add":
    case "sub":
    case "mul":
    case "div":
      variables(node.a, out);
      variables(node.b, out);
      break;
  }
  return out;
}

// ---------- polynomials with exact fractional coefficients ----------

/** monomial key ("" for the constant, "x^2", "x*y") -> coefficient */
export type Poly = Map<string, Q>;

function monoKey(powers: Record<string, number>): string {
  return Object.keys(powers)
    .filter((v) => powers[v] > 0)
    .sort()
    .map((v) => (powers[v] === 1 ? v : `${v}^${powers[v]}`))
    .join("*");
}

function parseKey(key: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (!key) return out;
  for (const part of key.split("*")) {
    const [v, e] = part.split("^");
    out[v] = (out[v] ?? 0) + (e ? Number(e) : 1);
  }
  return out;
}

function clean(p: Poly): Poly {
  for (const [k, v] of p) if (v.isZero()) p.delete(k);
  return p;
}

const constPoly = (q: Q): Poly => clean(new Map([["", q]]));

function padd(a: Poly, b: Poly, sign = 1): Poly {
  const out = new Map(a);
  for (const [k, v] of b) out.set(k, (out.get(k) ?? Q.ZERO).add(sign > 0 ? v : v.neg()));
  return clean(out);
}

function pmul(a: Poly, b: Poly): Poly {
  const out: Poly = new Map();
  for (const [ka, va] of a)
    for (const [kb, vb] of b) {
      const pa = parseKey(ka);
      const pb = parseKey(kb);
      for (const [v, e] of Object.entries(pb)) pa[v] = (pa[v] ?? 0) + e;
      const key = monoKey(pa);
      out.set(key, (out.get(key) ?? Q.ZERO).add(va.mul(vb)));
    }
  return clean(out);
}

/** Expands an expression into a polynomial. Throws for anything that isn't one (x in a root, dividing by x). */
export function toPoly(node: Node, env: Env = {}): Poly {
  switch (node.k) {
    case "num":
      return constPoly(node.v);
    case "var": {
      const known = env[node.name];
      if (known) {
        const q = known.asRational();
        if (!q) throw new MathError("not a polynomial with whole/fraction coefficients");
        return constPoly(q);
      }
      return new Map([[node.name, Q.ONE]]);
    }
    case "neg":
      return padd(new Map(), toPoly(node.a, env), -1);
    case "add":
      return padd(toPoly(node.a, env), toPoly(node.b, env));
    case "sub":
      return padd(toPoly(node.a, env), toPoly(node.b, env), -1);
    case "mul":
      return pmul(toPoly(node.a, env), toPoly(node.b, env));
    case "div": {
      const d = toPoly(node.b, env);
      if (d.size > 1 || (d.size === 1 && !d.has(""))) throw new MathError("dividing by an expression with a variable");
      const c = d.get("") ?? Q.ZERO;
      if (c.isZero()) throw new MathError("division by zero");
      return pmul(toPoly(node.a, env), constPoly(Q.ONE.div(c)));
    }
    case "pow": {
      const e = evaluate(node.e).asRational();
      if (!e || !e.isInt() || e.n < 0n || e.n > 8n) throw new MathError("only small whole-number powers");
      let r = constPoly(Q.ONE);
      const base = toPoly(node.a, env);
      for (let i = 0n; i < e.n; i++) r = pmul(r, base);
      return r;
    }
    case "fn": {
      const v = evaluate(node, env).asRational();
      if (!v) throw new MathError("not a polynomial");
      return constPoly(v);
    }
  }
}

export function polyEqual(a: Poly, b: Poly): boolean {
  return padd(a, b, -1).size === 0;
}

export function polyVars(p: Poly): string[] {
  const out = new Set<string>();
  for (const k of p.keys()) for (const v of Object.keys(parseKey(k))) out.add(v);
  return [...out].sort();
}

/** Degree in one variable, and the coefficient of each power (only for a polynomial in that one variable). */
function univariate(p: Poly, v: string): Q[] {
  const coeffs: Q[] = [];
  for (const [k, c] of p) {
    const pw = parseKey(k);
    const others = Object.keys(pw).filter((x) => x !== v);
    if (others.length) throw new MathError("more than one unknown");
    const d = pw[v] ?? 0;
    coeffs[d] = (coeffs[d] ?? Q.ZERO).add(c);
  }
  for (let i = 0; i < coeffs.length; i++) coeffs[i] ??= Q.ZERO;
  return coeffs;
}

// ---------- equations ----------

export interface Equation {
  lhs: Node;
  rhs: Node;
}

/** "2x + 3 = 11" -> sides. Exactly one "=" (use splitChain for "a = b = c"). */
export function parseEquation(src: string): Equation {
  const parts = splitChain(src);
  if (parts.length !== 2) throw new MathError("expected one equation with a single '='");
  return { lhs: parse(parts[0]), rhs: parse(parts[1]) };
}

export function splitChain(src: string): string[] {
  return normalise(src)
    .split("=")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export type Roots = { kind: "roots"; variable: string; roots: Surd[] } | { kind: "none"; variable: string; reason: string } | { kind: "all"; variable: string };

/** Solves a linear or quadratic equation in one unknown, exactly. */
export function solveOne(eq: Equation | string): Roots {
  const e = typeof eq === "string" ? parseEquation(eq) : eq;
  const p = padd(toPoly(e.lhs), toPoly(e.rhs), -1);
  const vars = polyVars(p);
  if (vars.length > 1) throw new MathError("more than one unknown");
  const v = vars[0] ?? "x";
  if (!vars.length) return p.size === 0 ? { kind: "all", variable: v } : { kind: "none", variable: v, reason: "no value works" };
  const c = univariate(p, v);
  const deg = c.length - 1;
  if (deg === 1) return { kind: "roots", variable: v, roots: [Surd.rational(c[0].neg().div(c[1]))] };
  if (deg === 2) {
    const [cc, b, a] = c;
    const disc = b.mul(b).sub(new Q(4n).mul(a).mul(cc));
    if (disc.n < 0n) return { kind: "none", variable: v, reason: "no real roots (discriminant is negative)" };
    const twoA = Surd.rational(new Q(2n).mul(a));
    const minusB = Surd.rational(b.neg());
    const root = Surd.sqrt(disc);
    const r1 = minusB.add(root).div(twoA);
    const r2 = minusB.sub(root).div(twoA);
    return { kind: "roots", variable: v, roots: r1.eq(r2) ? [r1] : [r1, r2].sort((x, y) => x.toNumber() - y.toNumber()) };
  }
  throw new MathError(`equations of degree ${deg} aren't supported`);
}

/** Solves a pair of linear equations in two unknowns exactly (Cramer's rule). */
export function solvePair(e1: Equation | string, e2: Equation | string): { kind: "unique"; values: Record<string, Q> } | { kind: "none" | "infinite" } {
  const polys = [e1, e2].map((e) => {
    const eq = typeof e === "string" ? parseEquation(e) : e;
    return padd(toPoly(eq.lhs), toPoly(eq.rhs), -1);
  });
  const vars = [...new Set(polys.flatMap(polyVars))].sort();
  if (vars.length !== 2) throw new MathError("expected two unknowns");
  const [u, w] = vars;
  const row = (p: Poly) => {
    for (const k of p.keys()) if (k && !vars.includes(k)) throw new MathError("not linear");
    return { a: p.get(u) ?? Q.ZERO, b: p.get(w) ?? Q.ZERO, c: (p.get("") ?? Q.ZERO).neg() };
  };
  const [r1, r2] = polys.map(row);
  const det = r1.a.mul(r2.b).sub(r2.a.mul(r1.b));
  if (det.isZero()) {
    const consistent = r1.a.mul(r2.c).sub(r2.a.mul(r1.c)).isZero() && r1.b.mul(r2.c).sub(r2.b.mul(r1.c)).isZero();
    return { kind: consistent ? "infinite" : "none" };
  }
  return {
    kind: "unique",
    values: {
      [u]: r1.c.mul(r2.b).sub(r2.c.mul(r1.b)).div(det),
      [w]: r1.a.mul(r2.c).sub(r2.a.mul(r1.c)).div(det),
    },
  };
}

/**
 * Checks a written chain like "a_10 = 2 + 9*3 = 29": every part must have the same exact value,
 * given the known values. Returns false (not an error) when it doesn't hold.
 */
export function chainHolds(src: string, env: Env = {}): boolean {
  const parts = splitChain(src);
  if (parts.length < 2) throw new MathError("nothing to compare");
  const vals = parts.map((p) => value(p, env));
  return vals.every((v) => v.eq(vals[0]));
}

/** Two expressions are the same polynomial (e.g. 3n + 2 and 2 + 3n), checked exactly by expansion. */
export function sameExpression(a: string, b: string, env: Env = {}): boolean {
  return polyEqual(toPoly(parse(a), env), toPoly(parse(b), env));
}
