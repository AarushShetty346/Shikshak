// The voice agent writes maths as plain text ("x^2 - 5x + 6 = 0"), because tool parameters
// pass through string templates where LaTeX backslashes are fragile. This turns that text
// into pieces the board can render, with superscripts and proper symbols.

export interface MathPart {
  text: string;
  sup?: boolean;
  sub?: boolean;
}

const REPLACEMENTS: [RegExp, string][] = [
  [/\bsqrt\s*/g, "√"],
  [/\+-|\+\/-/g, "±"],
  [/<=/g, "≤"],
  [/>=/g, "≥"],
  [/!=/g, "≠"],
  [/=>/g, "⇒"],
  [/->/g, "→"],
  [/\*/g, "×"],
  [/\btheta\b/gi, "θ"],
  [/\balpha\b/gi, "α"],
  [/\bbeta\b/gi, "β"],
  [/\bpi\b/g, "π"],
  [/\bdeg\b/g, "°"],
  [/\btherefore\b/gi, "∴"],
];

export function prettify(text: string): string {
  let out = text;
  for (const [pattern, symbol] of REPLACEMENTS) out = out.replace(pattern, symbol);
  return out;
}

/** Splits text into normal and superscript parts: "x^2 + 2^(n+1)" -> x, 2(sup), " + 2", n+1(sup). */
export function toMathParts(text: string): MathPart[] {
  const s = prettify(text);
  const parts: MathPart[] = [];
  let buf = "";
  let i = 0;
  while (i < s.length) {
    // Subscripts: a_n, a_10, a_(n+1), x_1
    if (s[i] === "_" && i + 1 < s.length && i > 0 && /[A-Za-z0-9)]/.test(s[i - 1])) {
      if (buf) parts.push({ text: buf });
      buf = "";
      i++;
      let sub = "";
      if (s[i] === "(" || s[i] === "{") {
        const close = s[i] === "(" ? ")" : "}";
        i++;
        while (i < s.length && s[i] !== close) sub += s[i++];
        i++;
      } else {
        while (i < s.length && /[A-Za-z0-9]/.test(s[i]) && sub.length < 3) sub += s[i++];
      }
      parts.push({ text: sub, sub: true });
      continue;
    }
    if (s[i] === "^" && i + 1 < s.length) {
      if (buf) parts.push({ text: buf });
      buf = "";
      i++;
      let exp = "";
      if (s[i] === "(" || s[i] === "{") {
        const close = s[i] === "(" ? ")" : "}";
        let depth = 0;
        i++;
        while (i < s.length && !(s[i] === close && depth === 0)) {
          if (s[i] === "(" || s[i] === "{") depth++;
          if (s[i] === ")" || s[i] === "}") depth--;
          exp += s[i++];
        }
        i++; // skip the closing bracket
      } else if (s[i] === "-" || /[0-9]/.test(s[i])) {
        exp += s[i++];
        while (i < s.length && /[0-9]/.test(s[i])) exp += s[i++];
      } else {
        exp += s[i++];
      }
      parts.push({ text: exp, sup: true });
    } else {
      buf += s[i++];
    }
  }
  if (buf) parts.push({ text: buf });
  return parts;
}

/** Tool calls send steps as one string. Accept "||", newlines, or a JSON array. */
export function splitSteps(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
  const text = String(raw ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) return splitSteps(arr);
    } catch {
      // not JSON, fall through
    }
  }
  return text
    .split(/\s*\|\|\s*|\r?\n|\\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
