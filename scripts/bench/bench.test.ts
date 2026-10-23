import { describe, expect, it } from "vitest";
import { buildTools, readPrompt } from "../bolnaConfig";
import { fillPrompt } from "./models";
import { SCENARIOS } from "./scenarios";
import { enumsFromTools, languageOk, scoreReply, type Reply } from "./scoring";
import { percentile, summarise, turnsFromExecution } from "./stats";

const execution = {
  id: "e1",
  status: "completed",
  conversation_duration: 360,
  total_cost: 40,
  cost_breakdown: { llm: 5, synthesizer: 15, transcriber: 2, platform: 18 },
  usage_breakdown: { transcriber_model: "stt-rt-v5", synthesizer_model: "bulbul:v3", llm_usage_breakdown: { conversation: { model: "gpt-5.4-mini" } } },
  latency_data: {
    transcriber: { turns: [{ turn: 1, turn_latency: [{ audio_to_text_latency: 900 }, { audio_to_text_latency: 600 }] }, { turn: 2, turn_latency: [] }] },
    llm: { turns: [{ turn: 1, time_to_first_token: 800, time_to_last_token: 1300 }, { turn: 2, time_to_first_token: 1000 }] },
    synthesizer: { turns: [{ turn: 1, time_to_first_token: 150 }] },
    interruption_stats: { total_interruptions: 3 },
  },
};

describe("call statistics", () => {
  it("reads per-turn timings and itemised cost from a Bolna execution", () => {
    const r = turnsFromExecution(execution);
    expect(r.turns).toEqual([
      { stt: 600, llmFirst: 800, llmLast: 1300, ttsFirst: 150, response: 1550 },
      { stt: null, llmFirst: 1000, llmLast: null, ttsFirst: null, response: null },
    ]);
    expect(r.config).toBe("gpt-5.4-mini / stt-rt-v5 / bulbul:v3");
    expect(r.interruptions).toBe(3);
    expect(r.cost).toEqual({ total: 40, llm: 5, tts: 15, stt: 2, platform: 18 });
  });

  it("tolerates an execution with no latency or cost data", () => {
    const r = turnsFromExecution({ id: 7 });
    expect(r.turns).toEqual([]);
    expect(r.cost.total).toBe(0);
    expect(r.status).toBe("unknown");
  });

  it("takes nearest-rank percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([4, 1, 3, 2], 50)).toBe(2);
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95)).toBe(95);
  });

  it("summarises calls, counting only complete turns for response time", () => {
    const a = turnsFromExecution(execution);
    const b = { ...turnsFromExecution({ id: "e2", status: "error", conversation_duration: 60, total_cost: 4 }) };
    const s = summarise([a, b]);
    expect(s.calls).toBe(2);
    expect(s.callsWithTurns).toBe(1);
    expect(s.response).toEqual({ median: 1550, p95: 1550, n: 1 });
    expect(s.llmFirst.n).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.minutes).toBe(7);
    expect(s.lessons).toEqual({ count: 1, median: 40 });
  });
});

describe("model benchmark scoring", () => {
  const tools = buildTools("https://bench.invalid");
  const enums = enumsFromTools(tools);
  const reply = (over: Partial<Reply>): Reply => ({ text: "", tool: null, args: {}, ttftMs: 100, totalMs: 200, inputTokens: 1, outputTokens: 1, error: null, ...over });
  const stuck = SCENARIOS.find((s) => s.id === "stuck-hint")!;

  it("every scenario expects tools the agent really has, and fills every prompt variable", () => {
    const names = new Set(tools.map((t) => t.name));
    const { prompt } = readPrompt();
    for (const s of SCENARIOS) {
      for (const t of s.expectTools) if (t) expect(names, `${s.id}: ${t}`).toContain(t);
      expect(fillPrompt(prompt, s.vars), s.id).not.toMatch(/\{[a-z_]+\}/);
      expect(s.messages.at(-1)!.role).toBe("user");
    }
  });

  it("reads allowed values from tool descriptions", () => {
    expect(enums.write.kind).toEqual(["heading", "text", "equation", "steps", "your_turn"]);
  });

  it("scores the right tool, arguments and hint policy", () => {
    expect(scoreReply(stuck, reply({ tool: "give_hint", args: { session_code: "s_benchmarkbenchmarkbench" } }), enums)).toMatchObject({
      toolCorrect: true,
      argsValid: true,
      hintPolicy: true,
    });
    // Saying the answer, or showing the solution, breaks the hint policy.
    expect(scoreReply(stuck, reply({ text: "Answer 29 hai." }), enums).hintPolicy).toBe(false);
    expect(scoreReply(stuck, reply({ tool: "show_solution" }), enums).hintPolicy).toBe(false);
    expect(scoreReply(stuck, reply({ text: "Pehle 129 aur 290 mat socho" }), enums).hintPolicy).toBe(true);
    // A made-up session code or a kind the tool doesn't have is invalid.
    expect(scoreReply(stuck, reply({ tool: "give_hint", args: { session_code: "s_other" } }), enums).argsValid).toBe(false);
    expect(scoreReply(stuck, reply({ tool: "write", args: { kind: "text/equation" } }), enums)).toMatchObject({ toolCorrect: false, argsValid: false });
    expect(scoreReply(stuck, reply({ error: "rate limited (429)" }), enums).failed).toBe(true);
  });

  it("checks the reply language roughly", () => {
    expect(languageOk("Chalo, ab d nikaalo. Yeh kya hai?", "hinglish")).toBe(true);
    expect(languageOk("Let us find the common difference.", "hinglish")).toBe(false);
    expect(languageOk("चलो, अब d निकालते हैं।", "hi")).toBe(true);
    expect(languageOk("Chalo d nikaalo", "hi")).toBe(false);
    expect(languageOk("", "hi")).toBe(true);
  });
});
