// One "ask for JSON" call that runs on whichever model has a key:
// Gemini (GEMINI_API_KEY, has a free tier) first, then Claude (ANTHROPIC_API_KEY).

import { GoogleGenAI } from "@google/genai";
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

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

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

async function askGeminiJson<T>(req: JsonRequest): Promise<T> {
  gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
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
    },
  });
  const text = response.text;
  if (!text) throw new Error(`Gemini returned no text (finish reason: ${response.candidates?.[0]?.finishReason ?? "unknown"})`);
  return JSON.parse(text) as T;
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
