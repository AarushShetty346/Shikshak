import { describe, expect, it } from "vitest";
import { buildAgentPayload, buildTools, readPrompt } from "./bolnaConfig";

describe("Bolna agent config", () => {
  it("reads the welcome message and prompt from bolna/agent-prompt.md", () => {
    const { welcome, prompt } = readPrompt();
    expect(welcome).toBe("{{greeting}}");
    expect(prompt.startsWith("You are Shikshak")).toBe(true);
    expect(prompt).toContain("{{session_code}}");
  });

  it("points every tool at the server and passes the session code", () => {
    const tools = buildTools("https://x.example.org/", "tok");
    expect(tools.map((t) => t.name)).toEqual(["write", "draw", "highlight", "erase", "give_problem", "look_at_board", "continue_lesson", "show_section", "read_material", "show_page", "give_practice"]);
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

  it("is one agent that speaks Hindi and English, with Bolna's own lines in both", () => {
    const task = buildAgentPayload({ publicUrl: "https://x.example.org" }).agent_config.tasks[0];
    const ml = task.tools_config.multilingual_config;
    expect(ml.enabled).toBe(true);
    expect(Object.keys(ml.languages)).toEqual(["hi", "en"]);
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
    expect(Object.keys(params)).toEqual(["write", "draw", "highlight", "erase", "give_problem", "look_at_board", "continue_lesson", "show_section", "read_material", "show_page", "give_practice"]);
    expect(JSON.parse(params.write.param)).toEqual({ session_code: "%(session_code)s", kind: "%(kind)s", content: "%(content)s", place: "%(place)s", replace: "%(replace)s" });
    expect(task.tools_config.api_tools.tools[0]).not.toHaveProperty("value");
  });
});
