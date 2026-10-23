// Automatic scoring of one model reply to a scenario. Pure; tested in bench.test.ts.

import type { Scenario } from "./scenarios";

export interface Reply {
  text: string;
  tool: string | null;
  args: Record<string, unknown>;
  ttftMs: number | null;
  totalMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
}

export interface Score {
  toolCorrect: boolean;
  argsValid: boolean;
  hintPolicy: boolean;
  language: boolean;
  failed: boolean;
}

const DEVANAGARI = /[ऀ-ॿ]/g;
const HINGLISH_WORDS = /\b(hai|hain|karo|kya|nahi|aap|tum|chalo|dekho|matlab|achha|theek|samajh|yeh|woh|mein|ko|se|ka|ki|ke|ab)\b/i;

/** Rough language check: Hindi needs mostly Devanagari; Hinglish needs Roman script with Hindi words; English, Roman without many Hindi words. */
export function languageOk(text: string, language: Scenario["language"]): boolean {
  const t = text.trim();
  if (!t) return true; // a tool call alone has nothing to judge
  const deva = (t.match(DEVANAGARI) ?? []).length;
  const letters = (t.match(/[A-Za-zऀ-ॿ]/g) ?? []).length || 1;
  if (language === "hi") return deva / letters > 0.5;
  if (language === "hinglish") return deva / letters < 0.2 && HINGLISH_WORDS.test(t);
  return deva / letters < 0.05;
}

/** Allowed values per tool argument, read from descriptions that start "a | b | c". */
export function enumsFromTools(tools: { name: string; parameters: { properties: Record<string, { description: string }> } }[]) {
  const out: Record<string, Record<string, string[]>> = {};
  for (const t of tools)
    for (const [k, p] of Object.entries(t.parameters.properties)) {
      const m = /^([a-z_]+(?: \| [a-z_]+)+)/.exec(p.description);
      if (m) (out[t.name] ??= {})[k] = m[1].split(" | ");
    }
  return out;
}

export function scoreReply(s: Scenario, r: Reply, enums: Record<string, Record<string, string[]>> = {}): Score {
  if (r.error) return { toolCorrect: false, argsValid: false, hintPolicy: true, language: true, failed: true };
  const allowed = s.expectTools;
  const toolCorrect = allowed.length === 0 ? r.tool === null : allowed.includes(r.tool ?? "");
  let argsValid = true;
  if (r.tool && s.expectArgs) for (const [k, re] of Object.entries(s.expectArgs)) if (!re.test(String(r.args[k] ?? ""))) argsValid = false;
  if (r.tool) for (const [k, allowedValues] of Object.entries(enums[r.tool] ?? {})) if (r.args[k] !== undefined && !allowedValues.includes(String(r.args[k]))) argsValid = false;
  if (r.tool && r.args.session_code !== undefined && !/^s_benchmark/.test(String(r.args.session_code))) argsValid = false;
  const said = `${r.text} ${JSON.stringify(r.args)}`;
  const hintPolicy = !s.mustNotReveal || (!new RegExp(`(^|[^0-9])${s.mustNotReveal}([^0-9]|$)`).test(said) && r.tool !== "show_solution");
  return { toolCorrect, argsValid, hintPolicy, language: languageOk(r.text, s.language), failed: false };
}
