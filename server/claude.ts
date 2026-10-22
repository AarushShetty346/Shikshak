import Anthropic from "@anthropic-ai/sdk";
import { LANGUAGE_NAMES, type Language } from "../shared/types";

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

type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

/**
 * One Claude call that must return JSON matching `schema`.
 * Uses the server-side refusal fallback so a rare safety decline still gets an answer.
 */
export async function askJson<T>(opts: {
  system: string;
  content: ContentBlock[];
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<T> {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: opts.system,
    output_config: {
      effort: opts.effort,
      format: { type: "json_schema", schema: opts.schema },
    },
    messages: [{ role: "user", content: opts.content }],
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

export function dataUrlToImage(dataUrl: string): ContentBlock {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Expected a base64 image data URL");
  return {
    type: "image",
    source: { type: "base64", media_type: match[1] as "image/png", data: match[2] },
  };
}
