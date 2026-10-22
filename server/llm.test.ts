import { afterEach, describe, expect, it, vi } from "vitest";

const calls: unknown[] = [];
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async (params: unknown) => {
        calls.push(params);
        return { text: '{"status":"mistake","line":2,"what_went_wrong":"sign","say":"Step 2 dekho"}', candidates: [] };
      },
    };
  },
}));

const { askJson, hasModel, modelName } = await import("./llm");

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  calls.length = 0;
});

describe("model routing", () => {
  it("uses Gemini when GEMINI_API_KEY is set and sends image, schema and system prompt", async () => {
    process.env.GEMINI_API_KEY = "test";
    expect(hasModel()).toBe(true);
    expect(modelName()).toMatch(/gemini/);
    const out = await askJson<{ line: number }>({
      system: "You check maths.",
      attachments: [{ mediaType: "image/png", data: "AAAA" }],
      text: "Problem: x + 1 = 2",
      schema: { type: "object" },
      effort: "low",
    });
    expect(out.line).toBe(2);
    const p = calls[0] as { model: string; contents: { parts: unknown[] }[]; config: Record<string, unknown> };
    expect(p.contents[0].parts).toEqual([{ inlineData: { mimeType: "image/png", data: "AAAA" } }, { text: "Problem: x + 1 = 2" }]);
    expect(p.config).toMatchObject({ systemInstruction: "You check maths.", responseMimeType: "application/json", responseJsonSchema: { type: "object" } });
  });

  it("says clearly when no model is configured", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(hasModel()).toBe(false);
    await expect(askJson({ system: "", attachments: [], text: "", schema: {}, effort: "low" })).rejects.toThrow(/GEMINI_API_KEY/);
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  });
});
