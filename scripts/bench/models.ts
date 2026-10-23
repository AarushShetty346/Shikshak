// Model-only comparison for the tutor's conversation model. Every candidate gets the same real
// agent prompt, the same tool definitions and the same scripted classroom moments (scenarios.ts);
// replies are scored automatically (scoring.ts) and exported to a CSV for human rating.
//
// This measures the model alone (time to first token over the provider's own API from this
// machine). It does not include speech-to-text, voice or Bolna's network hops: those are in
// bench:calls, measured from real calls.
//
//   npm run bench:models                                   every candidate that has a key
//   npm run bench:models -- --models gemini:gemini-3-flash-preview,openai:gpt-5.4-mini --repeat 3
//
// Candidates without a key are listed as "blocked" in the report, not skipped silently.
// Writes benchmark/results/models-<stamp>.{md,json} and a rating sheet models-<stamp>-rating.csv.

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { buildTools, readPrompt, type ToolDef } from "../bolnaConfig";
import { SCENARIOS, type Scenario } from "./scenarios";
import { enumsFromTools, scoreReply, type Reply, type Score } from "./scoring";
import { percentile } from "./stats";

type Provider = "gemini" | "openai" | "anthropic";
interface Candidate {
  provider: Provider;
  model: string;
}

const DEFAULT_CANDIDATES = "openai:gpt-5.4-mini,gemini:gemini-3-flash-preview,anthropic:claude-haiku-5-5";
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const candidates: Candidate[] = (arg("--models") ?? DEFAULT_CANDIDATES).split(",").map((s) => {
  const [provider, ...rest] = s.trim().split(":");
  return { provider: provider as Provider, model: rest.join(":") };
});
const repeat = Math.max(1, Number(arg("--repeat")) || 1);
const only = arg("--scenarios")?.split(",");
const gapMs = Number(arg("--gap")) || 0; // pause between requests, for free-tier limits

const KEYS: Record<Provider, string> = { gemini: "GEMINI_API_KEY", openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
const tools = buildTools("https://bench.invalid", undefined);
const { prompt } = readPrompt();
const enums = enumsFromTools(tools);

export function fillPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (m, k: string) => vars[k] ?? m);
}

const schemaOf = (t: ToolDef) => t.parameters;
const MAX_TOKENS = 400; // the same budget the live agent has

async function runGemini(model: string, system: string, s: Scenario): Promise<Reply> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const start = performance.now();
  let ttft: number | null = null;
  let text = "";
  let tool: string | null = null;
  let args: Record<string, unknown> = {};
  let usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
  const stream = await ai.models.generateContentStream({
    model,
    contents: s.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    config: {
      systemInstruction: system,
      maxOutputTokens: MAX_TOKENS,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: schemaOf(t) })) }],
    },
  });
  for await (const chunk of stream) {
    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      if ((p.text && !p.thought) || p.functionCall) ttft ??= performance.now() - start;
      if (p.text && !p.thought) text += p.text;
      if (p.functionCall && !tool) {
        tool = p.functionCall.name ?? null;
        args = (p.functionCall.args as Record<string, unknown>) ?? {};
      }
    }
    if (chunk.usageMetadata) usage = chunk.usageMetadata;
  }
  return { text, tool, args, ttftMs: ttft, totalMs: performance.now() - start, inputTokens: usage?.promptTokenCount ?? null, outputTokens: usage?.candidatesTokenCount ?? null, error: null };
}

async function runOpenAI(model: string, system: string, s: Scenario): Promise<Reply> {
  const start = performance.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: MAX_TOKENS,
      messages: [{ role: "system", content: system }, ...s.messages],
      tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: schemaOf(t) } })),
    }),
  });
  if (!res.ok || !res.body) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  let ttft: number | null = null;
  let text = "";
  let tool: string | null = null;
  let argText = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:") || line === "data: [DONE]") continue;
      const ev = JSON.parse(line.slice(5));
      if (ev.usage) usage = ev.usage;
      const d = ev.choices?.[0]?.delta;
      if (!d) continue;
      if (d.content || d.tool_calls) ttft ??= performance.now() - start;
      if (d.content) text += d.content;
      const call = d.tool_calls?.[0];
      if (call && (call.index ?? 0) === 0) {
        if (call.function?.name) tool ??= call.function.name;
        if (call.function?.arguments) argText += call.function.arguments;
      }
    }
  }
  let args: Record<string, unknown> = {};
  try {
    args = argText ? JSON.parse(argText) : {};
  } catch {
    args = { _unparsed: argText };
  }
  return { text, tool, args, ttftMs: ttft, totalMs: performance.now() - start, inputTokens: usage?.prompt_tokens ?? null, outputTokens: usage?.completion_tokens ?? null, error: null };
}

async function runAnthropic(model: string, system: string, s: Scenario): Promise<Reply> {
  const client = new Anthropic();
  const start = performance.now();
  let ttft: number | null = null;
  const stream = client.messages.stream({
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages: s.messages,
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: schemaOf(t) })),
  });
  stream.on("streamEvent", (ev) => {
    if (ev.type === "content_block_start" || ev.type === "content_block_delta") ttft ??= performance.now() - start;
  });
  const msg = await stream.finalMessage();
  let text = "";
  let tool: string | null = null;
  let args: Record<string, unknown> = {};
  for (const b of msg.content) {
    if (b.type === "text") text += b.text;
    if (b.type === "tool_use" && !tool) {
      tool = b.name;
      args = b.input as Record<string, unknown>;
    }
  }
  return { text, tool, args, ttftMs: ttft, totalMs: performance.now() - start, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, error: null };
}

const RUNNERS: Record<Provider, (model: string, system: string, s: Scenario) => Promise<Reply>> = {
  gemini: runGemini,
  openai: runOpenAI,
  anthropic: runAnthropic,
};

interface Row {
  candidate: string;
  scenario: string;
  run: number;
  reply: Reply;
  score: Score;
}

async function main() {
  const rows: Row[] = [];
  const blocked: string[] = [];
  const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.id));
  for (const c of candidates) {
    const name = `${c.provider}:${c.model}`;
    if (!RUNNERS[c.provider]) {
      blocked.push(`${name} (unknown provider)`);
      continue;
    }
    if (!process.env[KEYS[c.provider]]) {
      blocked.push(`${name} (needs ${KEYS[c.provider]})`);
      continue;
    }
    for (const s of scenarios) {
      for (let run = 1; run <= repeat; run++) {
        let reply!: Reply;
        // Free tiers allow a few requests a minute: on a rate limit, wait and try again (twice at most).
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            reply = await RUNNERS[c.provider](c.model, fillPrompt(prompt, s.vars), s);
            break;
          } catch (err) {
            const message = String((err as Error).message ?? err);
            const limited = /429|RESOURCE_EXHAUSTED|rate.?limit/i.test(message);
            reply = { text: "", tool: null, args: {}, ttftMs: null, totalMs: 0, inputTokens: null, outputTokens: null, error: limited ? "rate limited (429)" : message.slice(0, 200) };
            if (!limited || attempt === 2) break;
            console.log(`${name}  ${s.id}: rate limited, waiting 60 s`);
            await new Promise((r) => setTimeout(r, 60_000));
          }
        }
        if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
        const score = scoreReply(s, reply, enums);
        rows.push({ candidate: name, scenario: s.id, run, reply, score });
        console.log(`${name}  ${s.id.padEnd(22)} ${reply.error ? "ERROR " + reply.error : `${reply.tool ?? "(speech)"}  ttft ${reply.ttftMs === null ? "n/a" : Math.round(reply.ttftMs) + " ms"}  tool ${score.toolCorrect ? "ok" : "WRONG"}`}`);
      }
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.resolve("benchmark", "results");
  mkdirSync(dir, { recursive: true });
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
  const ms = (v: number | null) => (v === null ? "n/a" : `${Math.round(v)} ms`);
  const names = [...new Set(rows.map((r) => r.candidate))];
  const table = names.map((n) => {
    const rs = rows.filter((r) => r.candidate === n);
    const ok = rs.filter((r) => !r.score.failed);
    const ttft = ok.map((r) => r.reply.ttftMs).filter((v): v is number => v !== null);
    const policy = rs.filter((r) => SCENARIOS.find((s) => s.id === r.scenario)?.mustNotReveal);
    return `| ${n} | ${rs.length} | ${rs.length - ok.length} | ${ms(percentile(ttft, 50))} | ${ms(percentile(ttft, 95))} | ${pct(ok.filter((r) => r.score.toolCorrect).length, ok.length)} | ${pct(ok.filter((r) => r.score.argsValid).length, ok.length)} | ${pct(policy.filter((r) => r.score.hintPolicy && !r.score.failed).length, policy.length)} | ${pct(ok.filter((r) => r.score.language).length, ok.length)} |`;
  });
  const md = [
    `# Model-only comparison (${new Date().toISOString().slice(0, 16)} UTC)`,
    "",
    `${scenarios.length} scripted classroom moments x ${repeat} run(s), the real agent prompt and all ${tools.length} tool definitions, max ${MAX_TOKENS} output tokens.`,
    "Time to first token is measured from this machine to each provider's own API; it is not the latency a student hears (see bench:calls for that).",
    "",
    "| Candidate | Runs | Errors | TTFT median | TTFT p95 | Right tool | Valid arguments | No answer given away | Language (rough) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...table,
    "",
    blocked.length ? `Not run (no key or unknown provider): ${blocked.join("; ")}.` : "Every requested candidate ran.",
    "",
    "Scoring is automatic and coarse: \"right tool\" means one of the tools the scenario allows; the language check is a script-ratio heuristic. Teaching quality and Hinglish naturalness need the human rating sheet.",
    "This is a small smoke run; don't switch the live model on it alone.",
  ].join("\n");
  writeFileSync(path.join(dir, `models-${stamp}.md`), md + "\n");
  writeFileSync(path.join(dir, `models-${stamp}.json`), JSON.stringify({ generatedAt: new Date().toISOString(), repeat, blocked, rows }, null, 2));
  const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const sheet = [
    ["candidate_hidden", "scenario", "what", "student_said", "tutor_reply", "tool", "tool_args", "clarity_1to5", "warmth_1to5", "language_natural_1to5", "teaching_move_ok_yes_no", "notes"].join(","),
    // Shuffled so a rater doesn't see candidates in a fixed order; the key maps back.
    ...rows
      .map((r, i) => ({ r, k: (i * 2654435761) % 4294967296 }))
      .sort((a, b) => a.k - b.k)
      .map(({ r }) => {
        const s = SCENARIOS.find((x) => x.id === r.scenario)!;
        return [`M${names.indexOf(r.candidate) + 1}`, r.scenario, s.what, s.messages.at(-1)!.content, r.reply.text, r.reply.tool ?? "", JSON.stringify(r.reply.args), "", "", "", "", ""].map(csv).join(",");
      }),
  ].join("\n");
  writeFileSync(path.join(dir, `models-${stamp}-rating.csv`), "﻿" + sheet + "\n");
  writeFileSync(path.join(dir, `models-${stamp}-rating-key.txt`), names.map((n, i) => `M${i + 1} = ${n}`).join("\n") + "\n");
  console.log("\n" + md + `\n\nSaved benchmark/results/models-${stamp}.md (+ .json, rating sheet and key)`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("bench/models.ts")) await main();
