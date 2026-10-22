// One "ask for JSON" call that runs on whichever model has a key:
// Gemini (GEMINI_API_KEY, has a free tier) first, then Claude (ANTHROPIC_API_KEY).

import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { askClaudeJson, hasClaude, MODEL as CLAUDE_MODEL } from "./claude";

export interface Attachment {
  mediaType: string; // image/png, image/jpeg, application/pdf
  data: string; // base64, no data: prefix
}

export interface JsonRequest {
  system: string;
  attachments: Attachment[];
  text: string;
  schema: Record<string, unknown>;
  /** How hard to think. Only used where the provider supports it. */
  effort: "low" | "medium" | "high";
}

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

// Free-tier models get "high demand" errors at busy times, so we try several in order.
// Measured 2026-10-22 on the checker prompt, low thinking: gemini-3-flash-preview 2.2 s (steady),
// gemini-3.5-flash about 4 s (steady), gemini-3.6-flash often busy, gemini-flash-latest busy.
const GEMINI_FALLBACKS = (process.env.GEMINI_FALLBACKS || "gemini-3.5-flash,gemini-3.6-flash,gemini-flash-latest")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

export function geminiModels(): string[] {
  return [...new Set([GEMINI_MODEL, ...GEMINI_FALLBACKS])];
}

/** Errors worth trying another model for: overloaded, rate-limited, gone, or a server error. */
function isRetryable(err: unknown): boolean {
  const status = err instanceof ApiError ? err.status : undefined;
  return status === 429 || status === 404 || (status !== undefined && status >= 500);
}

export function hasGemini(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** A model is available for checking work and making plans. */
export function hasModel(): boolean {
  return hasGemini() || hasClaude();
}

export function modelName(): string {
  return hasGemini() ? GEMINI_MODEL : hasClaude() ? CLAUDE_MODEL : "none";
}

let gemini: GoogleGenAI | null = null;

const THINKING: Record<JsonRequest["effort"], ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

async function askGeminiOnce<T>(model: string, req: JsonRequest): Promise<T> {
  gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await gemini.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [...req.attachments.map((a) => ({ inlineData: { mimeType: a.mediaType, data: a.data } })), { text: req.text }],
      },
    ],
    config: {
      systemInstruction: req.system,
      responseMimeType: "application/json",
      responseJsonSchema: req.schema,
      // Less thinking keeps checks to a couple of seconds, which matters on a live call.
      thinkingConfig: { thinkingLevel: THINKING[req.effort] },
    },
  });
  const text = response.text;
  if (!text) throw new Error(`Gemini returned no text (finish reason: ${response.candidates?.[0]?.finishReason ?? "unknown"})`);
  return JSON.parse(text) as T;
}

async function askGeminiJson<T>(req: JsonRequest): Promise<T> {
  let lastError: unknown;
  for (const model of geminiModels()) {
    try {
      const result = await askGeminiOnce<T>(model, req);
      if (model !== GEMINI_MODEL) console.log(`[gemini] answered by fallback ${model}`);
      return result;
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) throw err;
      console.warn(`[gemini] ${model} unavailable (${(err as ApiError).status}), trying the next model`);
    }
  }
  throw lastError;
}

export async function askJson<T>(req: JsonRequest): Promise<T> {
  if (hasGemini()) return askGeminiJson<T>(req);
  if (hasClaude()) return askClaudeJson<T>(req);
  throw new Error("No model configured: set GEMINI_API_KEY (free tier) or ANTHROPIC_API_KEY");
}

export function dataUrlToAttachment(dataUrl: string): Attachment {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Expected a base64 image data URL");
  return { mediaType: match[1], data: match[2] };
}
