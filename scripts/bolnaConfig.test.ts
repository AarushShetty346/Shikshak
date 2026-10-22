import { describe, expect, it } from "vitest";
import { buildAgentPayload, buildTools, readPrompt } from "./bolnaConfig";

describe("Bolna agent config", () => {
  it("reads the welcome message and prompt from bolna/agent-prompt.md", () => {
    const { welcome, prompt } = readPrompt();
    expect(welcome).toContain("{{student_name}}");
    expect(prompt.startsWith("You are Shikshak")).toBe(true);
    expect(prompt).toContain("{{session_code}}");
  });

  it("points every tool at the server and passes the session code", () => {
    const tools = buildTools("https://x.example.org/", "tok");
    expect(tools.map((t) => t.name)).toEqual(["show_steps", "give_problem", "check_work", "clear_board"]);
    for (const t of tools) {
      expect(t.value.url).toBe(`https://x.example.org/tools/${t.name}`);
      expect(t.value.param.session_code).toBe("%(session_code)s");
      expect(t.parameters.required).toContain("session_code");
      expect(t.value.api_token).toBe("Bearer tok");
    }
  });

  it("builds an agent that won't hang up on a student who is writing", () => {
    const body = buildAgentPayload({ publicUrl: "https://x.example.org" });
    const task = body.agent_config.tasks[0];
    expect(task.task_config.call_terminate).toBeGreaterThanOrEqual(900);
    expect(task.task_config.hangup_after_silence).toBeGreaterThanOrEqual(60);
    expect(task.tools_config.llm_agent.llm_config.temperature).toBe(1);
    const params = task.tools_config.api_tools.tools_params;
    expect(Object.keys(params)).toEqual(["show_steps", "give_problem", "check_work", "clear_board"]);
    expect(JSON.parse(params.show_steps.param)).toEqual({ session_code: "%(session_code)s", title: "%(title)s", steps: "%(steps)s" });
    expect(task.tools_config.api_tools.tools[0]).not.toHaveProperty("value");
  });
});
