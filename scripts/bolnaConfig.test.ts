import { describe, expect, it } from "vitest";
import { buildAgentPayload, buildTools, promptFor, readLlmConfig, readPrompt, rollbackLlm, switchLlm } from "./bolnaConfig";

const TOOL_NAMES = [
  "write", "draw", "highlight", "erase", "give_problem", "look_at_board", "continue_lesson", "show_section", "read_material", "show_page", "give_practice",
  "next_problem", "solve", "give_hint", "show_solution", "check_answer", "plan_next", "diagnostic", "skip_question",
];

describe("Bolna agent config", () => {
  it("reads the welcome message and prompt from bolna/agent-prompt.md", () => {
    const { welcome, prompt } = readPrompt();
    expect(welcome).toBe("{{greeting}}");
    expect(prompt.startsWith("You are Shikshak")).toBe(true);
    expect(prompt).toContain("{{session_code}}");
  });

  it("points every tool at the server and passes the session code", () => {
    const tools = buildTools("https://x.example.org/", "tok");
    expect(tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    for (const t of tools) {
      expect(t.value.url).toBe(`https://x.example.org/tools/${t.name}`);
      expect(t.value.param.session_code).toBe("%(session_code)s");
      expect(t.parameters.required).toContain("session_code");
      expect(t.value.api_token).toBe("Bearer tok");
    }
  });

  it("never leaves a waiting line empty, and has Hindi and English versions", () => {
    for (const t of buildTools("https://x.example.org")) {
      expect(t.pre_call_message.hi.length).toBeGreaterThan(0);
      expect(t.pre_call_message.en.length).toBeGreaterThan(0);
      expect(t.pre_call_message.hi).toMatch(/[\u0900-\u097F]/); // Devanagari
    }
  });

  it("is one agent that speaks Hindi and English (Tamil and Telugu in preview), with Bolna's own lines in each", () => {
    const task = buildAgentPayload({ publicUrl: "https://x.example.org" }).agent_config.tasks[0];
    const ml = task.tools_config.multilingual_config;
    expect(ml.enabled).toBe(true);
    expect(Object.keys(ml.languages)).toEqual(["hi", "en", "ta", "te"]);
    expect(ml.languages.en.synthesizer.provider_config.language).toBe("en");
    expect(task.task_config.check_user_online_message.hi).toMatch(/[\u0900-\u097F]/);
    expect(task.task_config.trigger_user_online_message_after).toBeGreaterThanOrEqual(30);
  });

  it("builds an agent that won't hang up on a student who is writing", () => {
    const body = buildAgentPayload({ publicUrl: "https://x.example.org" });
    const task = body.agent_config.tasks[0];
    expect(task.task_config.call_terminate).toBeGreaterThanOrEqual(900);
    expect(task.task_config.hangup_after_silence).toBeGreaterThanOrEqual(60);
    expect(task.tools_config.llm_agent.llm_config.temperature).toBe(1);
    const params = task.tools_config.api_tools.tools_params;
    expect(Object.keys(params)).toEqual(TOOL_NAMES);
    expect(JSON.parse(params.write.param)).toEqual({ session_code: "%(session_code)s", kind: "%(kind)s", content: "%(content)s", place: "%(place)s", replace: "%(replace)s" });
    expect(task.tools_config.api_tools.tools[0]).not.toHaveProperty("value");
  });

  it("every tool the agent knows has a route on the server", async () => {
    const { toolsRouter } = await import("../server/tools");
    const router = toolsRouter() as unknown as { stack: { route?: { path: string } }[] };
    const routes = new Set(router.stack.map((l) => l.route?.path).filter(Boolean));
    for (const t of buildTools("https://x.example.org")) expect(routes.has(`/${t.name}`), t.name).toBe(true);
    // Imports the whole server on a cold cache, which can take more than the default 5 s.
  }, 30_000);
});

describe("conversation model choice", () => {
  const cfg = {
    current: { provider: "openai", model: "gpt-5.4-mini", since: "x", evidence: "calls" },
    previous: null,
  };

  it("the live agents use the model in bolna/llm.json", () => {
    const { current } = readLlmConfig();
    const body = buildAgentPayload({ publicUrl: "https://x.test" });
    expect(body.agent_config.tasks[0].tools_config.llm_agent.llm_config).toMatchObject({ provider: current.provider, model: current.model });
  });

  it("switching needs evidence and keeps the old model for rollback", () => {
    expect(() => switchLlm(cfg, { provider: "openai", model: "gpt-5.4" }, " ", "d")).toThrow(/evidence/);
    expect(() => switchLlm(cfg, { provider: "openai", model: "gpt-5.4-mini" }, "r.md", "d")).toThrow(/already/);
    const next = switchLlm(cfg, { provider: "openai", model: "gpt-5.4" }, "r.md", "2026-10-24");
    expect(next.current).toEqual({ provider: "openai", model: "gpt-5.4", since: "2026-10-24", evidence: "r.md" });
    expect(next.previous).toEqual(cfg.current);
    const back = rollbackLlm(next, "2026-10-25");
    expect(back.current).toMatchObject({ provider: "openai", model: "gpt-5.4-mini" });
    expect(back.previous?.model).toBe("gpt-5.4");
    expect(() => rollbackLlm(cfg, "d")).toThrow(/previous/);
  });
});

describe("phone revision agent", () => {
  it("has its own four tools keyed by call code, a short call limit and the keypad on", async () => {
    const { buildPhoneAgentPayload, buildPhoneTools } = await import("./bolnaConfig");
    const tools = buildPhoneTools("https://x.test", "tok");
    expect(tools.map((t) => t.name)).toEqual(["phone_question", "phone_answer", "phone_opt_out", "phone_end"]);
    for (const t of tools) {
      expect(t.parameters.required[0]).toBe("call_code");
      expect(t.parameters.properties).not.toHaveProperty("session_code");
      expect(t.value.url).toBe(`https://x.test/tools/${t.name}`);
    }
    const body = buildPhoneAgentPayload({ publicUrl: "https://x.test", toolsToken: "tok", maxCallSeconds: 240 });
    const task = body.agent_config.tasks[0];
    expect(task.task_config).toMatchObject({ call_terminate: 240, dtmf_enabled: true });
    expect(task.tools_config.api_tools.tools.map((t: { name: string }) => t.name)).toEqual(tools.map((t) => t.name));
    expect(body.agent_prompts.task_1.system_prompt).toContain("{{call_code}}");
    expect(body.agent_prompts.task_1.system_prompt).not.toContain("session_code");
    // The class agent is unchanged.
    expect(buildAgentPayload({ publicUrl: "https://x.test" }).agent_config.tasks[0].task_config.call_terminate).toBe(1200);
  });
});

describe("Tamil and Telugu (preview)", () => {
  it("every agent language has a transcriber, a voice and the prompt; every spoken line has all four languages", () => {
    const body = buildAgentPayload({ publicUrl: "https://x.test" });
    const cfg = body.agent_config.tasks[0].tools_config;
    const langs = cfg.multilingual_config.languages as Record<string, { transcriber: { language: string; provider: string; model: string }; synthesizer: { provider_config: { language: string } }; system_prompt: string }>;
    expect(Object.keys(langs)).toEqual(["hi", "en", "ta", "te"]);
    for (const [k, v] of Object.entries(langs)) {
      expect(v.transcriber.language).toBe(k);
      expect(v.transcriber).toMatchObject({ provider: "sarvam", model: "saaras:v4" });
      expect(v.synthesizer.provider_config.language).toBe(k);
      expect(v.system_prompt.length).toBeGreaterThan(500);
    }
    for (const t of cfg.api_tools.tools as { pre_call_message: Record<string, string> }[]) expect(Object.keys(t.pre_call_message).sort()).toEqual(["en", "hi", "ta", "te"]);
    const tc = body.agent_config.tasks[0].task_config as { check_user_online_message: Record<string, string>; call_hangup_message: Record<string, string> };
    expect(Object.keys(tc.check_user_online_message).sort()).toEqual(["en", "hi", "ta", "te"]);
    expect(Object.keys(tc.call_hangup_message).sort()).toEqual(["en", "hi", "ta", "te"]);
  });

  it("each language gets its own way of speaking; the rest of the prompt is the same", () => {
    const { prompt } = readPrompt();
    const body = buildAgentPayload({ publicUrl: "https://x.test" });
    const langs = body.agent_config.tasks[0].tools_config.multilingual_config.languages as Record<string, { system_prompt: string }>;
    expect(langs.hi.system_prompt).toBe(prompt);
    expect(langs.hi.system_prompt).toContain("feminine first-person forms in Hindi");
    for (const [lang, word] of [["en", "English"], ["ta", "Tamil"], ["te", "Telugu"]] as const) {
      const p = langs[lang].system_prompt;
      expect(p).toBe(promptFor(prompt, lang));
      expect(p).toContain(`Speak only in ${word}`);
      expect(p).not.toContain('"वाई"'); // Hindi-only letter spellings
      expect(p).not.toContain("feminine first-person forms in Hindi");
      expect(p).toContain("## Taking turns"); // the sections after it are kept
      expect(p.split("## How you speak").length).toBe(2);
    }
    expect(new Set(Object.values(langs).map((l) => l.system_prompt)).size).toBe(4);
  });
});
