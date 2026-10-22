import Anthropic from "@anthropic-ai/sdk";
import { LANGUAGE_NAMES, type Language } from "../shared/types";
import type { JsonRequest } from "./llm";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export function hasClaude(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function languageName(lang: string): string {
  return LANGUAGE_NAMES[lang as Language] ?? LANGUAGE_NAMES.hinglish;
}

/**
 * One Claude call that must return JSON matching `schema`.
 * Uses the server-side refusal fallback so a rare safety decline still gets an answer.
 */
export async function askClaudeJson<T>(req: JsonRequest): Promise<T> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = req.attachments.map((a) =>
    a.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } }
      : { type: "image", source: { type: "base64", media_type: a.mediaType as "image/png", data: a.data } },
  );
  content.push({ type: "text", text: req.text });

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: req.system,
    output_config: {
      effort: req.effort,
      format: { type: "json_schema", schema: req.schema },
    },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined this request");
  }
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
  return JSON.parse(text) as T;
}
