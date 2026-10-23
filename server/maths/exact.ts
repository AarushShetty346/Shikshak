// Exact numbers for checking school maths: fractions (BigInt numerator/denominator) and sums of
// square roots with fractional coefficients, e.g. 3/2 + (1/2)√5, or √3/2 for sin 60°.
// Everything is exact: two values are equal only if they are mathematically equal.

export class Q {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new MathError("division by zero");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n < 0n ? -n : n, d);
    this.n = g > 1n ? n / g : n;
    this.d = g > 1n ? d / g : d;
  }
  static of(x: number | bigint | string): Q {
    if (typeof x === "bigint") return new Q(x);
    if (typeof x === "number") {
      if (!Number.isFinite(x)) throw new MathError("not a finite number");
      return Q.parse(String(x));
    }
    return Q.parse(x);
  }
  /** "12", "-3.25", "7/8" */
  static parse(s: string): Q {
    const t = s.trim();
    const frac = /^(-?\d+)\s*\/\s*(\d+)$/.exec(t);
    if (frac) return new Q(BigInt(frac[1]), BigInt(frac[2]));
    const dec = /^(-?)(\d*)(?:\.(\d+))?$/.exec(t);
    if (!dec || (!dec[2] && !dec[3])) throw new MathError(`not a number: ${s}`);
    const digits = dec[3] ?? "";
    const n = BigInt((dec[2] || "0") + digits) * (dec[1] ? -1n : 1n);
    return new Q(n, 10n ** BigInt(digits.length));
  }
  add(o: Q) {
    return new Q(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o: Q) {
    return new Q(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o: Q) {
    return new Q(this.n * o.n, this.d * o.d);
  }
  div(o: Q) {
    if (o.n === 0n) throw new MathError("division by zero");
    return new Q(this.n * o.d, this.d * o.n);
  }
  neg() {
    return new Q(-this.n, this.d);
  }
  pow(k: number): Q {
    if (!Number.isInteger(k)) throw new MathError("only whole-number powers");
    if (k < 0) return Q.ONE.div(this.pow(-k));
    let r: Q = Q.ONE;
    for (let i = 0; i < k; i++) r = r.mul(this);
    return r;
  }
  isZero() {
    return this.n === 0n;
  }
  isInt() {
    return this.d === 1n;
  }
  eq(o: Q) {
    return this.n === o.n && this.d === o.d;
  }
  cmp(o: Q): number {
    const a = this.n * o.d;
    const b = o.n * this.d;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  toNumber() {
    return Number(this.n) / Number(this.d);
  }
  toString() {
    return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`;
  }
  static readonly ZERO = new Q(0n);
  static readonly ONE = new Q(1n);
}

export class MathError extends Error {
  override name = "MathError";
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

/** Writes n = s² · r with r square-free (for n ≥ 1). */
function squareFree(n: bigint): { s: bigint; r: bigint } {
  if (n > 10n ** 12n) throw new MathError("number too large to simplify");
  let s = 1n;
  let r = n;
  for (let p = 2n; p * p <= r; p++) {
    while (r % (p * p) === 0n) {
      r /= p * p;
      s *= p;
    }
  }
  return { s, r };
}

/**
 * A sum Σ q_r · √r over square-free radicands r (r = 1 is the rational part). Closed under +, −, ×,
 * and division by a single-radical value; that covers class 10 (quadratic roots, trig ratios).
 */
export class Surd {
  /** radicand -> coefficient; never holds zero coefficients. */
  readonly terms: ReadonlyMap<bigint, Q>;
  constructor(terms: Map<bigint, Q>) {
    for (const [k, v] of terms) if (v.isZero()) terms.delete(k);
    this.terms = terms;
  }
  static rational(q: Q) {
    return new Surd(new Map([[1n, q]]));
  }
  static of(x: number | string | bigint) {
    return Surd.rational(Q.of(x));
  }
  /** √q for a rational q ≥ 0, simplified. */
  static sqrt(q: Q): Surd {
    if (q.n < 0n) throw new MathError("square root of a negative number");
    if (q.isZero()) return Surd.rational(Q.ZERO);
    // √(n/d) = √(n·d)/d
    const { s, r } = squareFree(q.n * q.d);
    return new Surd(new Map([[r, new Q(s, q.d)]]));
  }
  isRational() {
    return [...this.terms.keys()].every((k) => k === 1n);
  }
  rationalPart(): Q {
    return this.terms.get(1n) ?? Q.ZERO;
  }
  /** The value as a fraction, or null if it has a root in it. */
  asRational(): Q | null {
    return this.isRational() ? this.rationalPart() : null;
  }
  isZero() {
    return this.terms.size === 0;
  }
  add(o: Surd): Surd {
    const m = new Map(this.terms);
    for (const [k, v] of o.terms) m.set(k, (m.get(k) ?? Q.ZERO).add(v));
    return new Surd(m);
  }
  neg(): Surd {
    return new Surd(new Map([...this.terms].map(([k, v]) => [k, v.neg()])));
  }
  sub(o: Surd) {
    return this.add(o.neg());
  }
  mul(o: Surd): Surd {
    let out = new Surd(new Map());
    for (const [a, qa] of this.terms)
      for (const [b, qb] of o.terms) {
        // √a·√b = √(ab) = s√r
        const { s, r } = squareFree(a * b);
        out = out.add(new Surd(new Map([[r, qa.mul(qb).mul(new Q(s))]])));
      }
    return out;
  }
  div(o: Surd): Surd {
    if (o.isZero()) throw new MathError("division by zero");
    if (o.terms.size === 1) {
      // x / (q√r) = x·√r / (q·r)
      const [[r, q]] = [...o.terms];
      return this.mul(new Surd(new Map([[r, Q.ONE.div(q.mul(new Q(r)))]])));
    }
    if (o.terms.size === 2 && o.terms.has(1n)) {
      // x / (a + b√r): multiply by the conjugate (a − b√r) / (a² − b²r)
      const a = o.terms.get(1n)!;
      const [[r, b]] = [...o.terms].filter(([k]) => k !== 1n);
      const denom = a.mul(a).sub(b.mul(b).mul(new Q(r)));
      const conj = new Surd(new Map([[1n, a.div(denom)], [r, b.neg().div(denom)]]));
      return this.mul(conj);
    }
    throw new MathError("can't divide by this expression exactly");
  }
  pow(k: number): Surd {
    if (!Number.isInteger(k) || k < 0) {
      if (Number.isInteger(k) && k < 0) return Surd.of(1).div(this.pow(-k));
      throw new MathError("only whole-number powers");
    }
    let r = Surd.of(1);
    for (let i = 0; i < k; i++) r = r.mul(this);
    return r;
  }
  eq(o: Surd) {
    return this.sub(o).isZero();
  }
  toNumber(): number {
    let x = 0;
    for (const [k, v] of this.terms) x += v.toNumber() * Math.sqrt(Number(k));
    return x;
  }
  toString(): string {
    if (this.isZero()) return "0";
    return [...this.terms]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => (k === 1n ? v.toString() : `${v.eq(Q.ONE) ? "" : v.eq(Q.ONE.neg()) ? "-" : `${v}*`}sqrt(${k})`))
      .join(" + ")
      .replace(/\+ -/g, "- ");
  }
}

// ---------- exact trigonometric values (degrees), as in class 10 ----------

const HALF = new Q(1n, 2n);
const ROOT3_HALF = (): Surd => Surd.sqrt(new Q(3n)).mul(Surd.rational(HALF));
const ROOT2_HALF = (): Surd => Surd.sqrt(new Q(2n)).mul(Surd.rational(HALF));

/** sin, cos, tan, cosec, sec, cot of 0, 30, 45, 60, 90 degrees, exactly. Throws for other angles. */
export function trigExact(fn: string, degrees: Q): Surd {
  if (!degrees.isInt()) throw new MathError("only whole-degree angles");
  const a = Number(((degrees.n % 360n) + 360n) % 360n);
  const sinTable: Record<number, () => Surd> = {
    0: () => Surd.of(0),
    30: () => Surd.rational(HALF),
    45: ROOT2_HALF,
    60: ROOT3_HALF,
    90: () => Surd.of(1),
    120: ROOT3_HALF,
    135: ROOT2_HALF,
    150: () => Surd.rational(HALF),
    180: () => Surd.of(0),
  };
  const sinOf = (x: number): Surd => {
    if (x in sinTable) return sinTable[x]();
    if (x > 180 && x - 180 in sinTable) return sinTable[x - 180]().neg();
    throw new MathError(`no exact value for an angle of ${x}°`);
  };
  const sin = () => sinOf(a);
  const cos = () => sinOf((a + 90) % 360);
  switch (fn) {
    case "sin":
      return sin();
    case "cos":
      return cos();
    case "tan":
      return sin().div(nonZero(cos(), "tan"));
    case "cosec":
    case "csc":
      return Surd.of(1).div(nonZero(sin(), "cosec"));
    case "sec":
      return Surd.of(1).div(nonZero(cos(), "sec"));
    case "cot":
      return cos().div(nonZero(sin(), "cot"));
    default:
      throw new MathError(`unknown function ${fn}`);
  }
}

function nonZero(x: Surd, fn: string): Surd {
  if (x.isZero()) throw new MathError(`${fn} is not defined there`);
  return x;
}
