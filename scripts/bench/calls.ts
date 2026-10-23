// Measured latency and actual cost from real Bolna calls (no new calls are placed; this only reads
// the call records Bolna already keeps). For each turn Bolna records: speech-to-text latency per
// partial transcript, LLM time to first/last token, synthesizer time to first audio, and
// interruption statistics; each call has an itemised charge.
//
//   npm run bench:calls                    all agents in .env, last 50 calls each
//   npm run bench:calls -- --limit 200
//
// Writes benchmark/results/calls-<timestamp>.{json,md}.
//
// "Estimated response time" per turn = final transcript latency + LLM time to first token +
// synthesizer time to first audio. It's built from Bolna's component timings; it isn't a
// microphone-to-speaker measurement (turn detection and network to the browser aren't included).

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { summarise, turnsFromExecution, type CallRecord } from "./stats";

const limit = Number(process.argv[process.argv.indexOf("--limit") + 1]) || 50;
const key = process.env.BOLNA_API_KEY;
if (!key) {
  console.error("Set BOLNA_API_KEY in .env to read call records.");
  process.exit(1);
}
const agents = Object.entries({ normal: process.env.BOLNA_AGENT_ID, slower: process.env.BOLNA_AGENT_ID_SLOW, faster: process.env.BOLNA_AGENT_ID_FAST }).filter(([, id]) => id) as [string, string][];

const records: CallRecord[] = [];
for (const [speed, id] of agents) {
  const r = await fetch(`https://api.bolna.ai/v2/agent/${id}/executions?page_size=${Math.min(limit, 100)}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) {
    console.error(`Bolna said ${r.status} for the ${speed} agent`);
    continue;
  }
  const data = (await r.json()) as { data?: unknown[] } | unknown[];
  const list = (Array.isArray(data) ? data : (data.data ?? [])) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const e of list.slice(0, limit)) records.push({ ...turnsFromExecution(e), agent: speed });
}

const s = summarise(records);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = path.resolve("benchmark", "results");
mkdirSync(dir, { recursive: true });
const ms = (v: number | null) => (v === null ? "n/a" : `${Math.round(v)} ms`);
const md = [
  `# Measured from real Bolna calls (${new Date().toISOString().slice(0, 16)} UTC)`,
  "",
  `Calls analysed: ${s.calls} (with turn timings: ${s.callsWithTurns}), turns: ${s.turns}. Agents: ${agents.map(([n]) => n).join(", ")}.`,
  `Configuration seen: ${[...s.configs].join("; ") || "n/a"}`,
  "",
  "| Measure | Median | p95 |",
  "| --- | --- | --- |",
  `| Speech-to-text (final transcript) | ${ms(s.stt.median)} | ${ms(s.stt.p95)} |`,
  `| LLM time to first token | ${ms(s.llmFirst.median)} | ${ms(s.llmFirst.p95)} |`,
  `| LLM time to last token | ${ms(s.llmLast.median)} | ${ms(s.llmLast.p95)} |`,
  `| Voice: time to first audio | ${ms(s.ttsFirst.median)} | ${ms(s.ttsFirst.p95)} |`,
  `| **Estimated response time** (STT + LLM first token + first audio) | **${ms(s.response.median)}** | **${ms(s.response.p95)}** |`,
  "",
  `Interruptions: ${s.interruptions} in ${s.calls} calls. Calls that ended with an error: ${s.failed}.`,
  "",
  "## Actual charges (from Bolna's call records)",
  "",
  `Total: ${s.cost.total.toFixed(2)} over ${s.minutes.toFixed(1)} minutes of calls = ${s.minutes ? (s.cost.total / s.minutes).toFixed(2) : "n/a"} per minute (account currency).`,
  `Per call: median ${s.cost.perCallMedian.toFixed(2)}. Calls of 5 minutes or more ("a lesson"): ${s.lessons.count}, median charge ${s.lessons.median === null ? "n/a" : s.lessons.median.toFixed(2)}.`,
  `Where the money goes: LLM ${s.cost.llm.toFixed(2)}, voice ${s.cost.tts.toFixed(2)}, speech-to-text ${s.cost.stt.toFixed(2)}, platform ${s.cost.platform.toFixed(2)}.`,
  "",
  "Notes: the response time is built from Bolna's component timings, not measured end to end at the student's speaker. Model-only comparisons are in bench:models results.",
].join("\n");
writeFileSync(path.join(dir, `calls-${stamp}.md`), md + "\n");
writeFileSync(path.join(dir, `calls-${stamp}.json`), JSON.stringify({ generatedAt: new Date().toISOString(), summary: { ...s, configs: [...s.configs] }, records }, null, 2));
console.log(md);
console.log(`\nSaved benchmark/results/calls-${stamp}.md`);
