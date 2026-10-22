// Everything Shikshak needs from a Bolna agent, built from files in this repo:
// the prompt and welcome message (bolna/agent-prompt.md) and the four tool definitions.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Spoken while a tool runs. Keyed by language; Bolna plays the one matching the language the agent is speaking. */
export type Spoken = Record<"hi" | "en", string>;

export interface ToolDef {
  name: string;
  description: string;
  pre_call_message: Spoken;
  parameters: { type: "object"; properties: Record<string, { type: string; description: string }>; required: string[] };
  key: "custom_task";
  value: { method: "POST"; param: Record<string, string>; url: string; api_token: string | null; headers: Record<string, string> };
}

const SESSION = {
  session_code: { type: "string", description: "The session code from the prompt. Always pass it exactly." },
};

function tool(
  base: string,
  token: string | null,
  opts: { name: string; description: string; pre_call_message: Spoken; properties: ToolDef["parameters"]["properties"]; required: string[] },
): ToolDef {
  const all = { ...SESSION, ...opts.properties };
  return {
    name: opts.name,
    description: opts.description,
    pre_call_message: opts.pre_call_message,
    parameters: { type: "object", properties: all, required: ["session_code", ...opts.required] },
    key: "custom_task",
    value: {
      method: "POST",
      param: Object.fromEntries(Object.keys(all).map((k) => [k, `%(${k})s`])),
      url: `${base}/tools/${opts.name}`,
      api_token: token,
      headers: { "Content-Type": "application/json" },
    },
  };
}

export function buildTools(publicUrl: string, toolsToken?: string): ToolDef[] {
  const base = publicUrl.replace(/\/$/, "");
  const token = toolsToken ? `Bearer ${toolsToken}` : null;
  return [
    tool(base, token, {
      name: "show_steps",
      description:
        "Write worked steps on the student's chalkboard. Use whenever you explain a method, solve an example, or answer a doubt that needs maths written down. Call it, then talk through the lines as they appear.",
      // Never leave this empty: Bolna then plays its own English filler ("Just give me a moment...").
      pre_call_message: { hi: "अच्छा।", en: "Okay." },
      properties: {
        title: { type: "string", description: "Short heading for this block, e.g. 'Factorisation'." },
        steps: {
          type: "string",
          description: "The lines to write, separated by ' || '. Plain text maths, no LaTeX. Example: 2x + 3 = 7 || 2x = 4 || x = 2",
        },
      },
      required: ["steps"],
    }),
    tool(base, token, {
      name: "give_problem",
      description: "Put a practice problem in the student's notebook and clear their page. Use when it is the student's turn to solve something.",
      pre_call_message: { hi: "अच्छा, एक सवाल देती हूँ।", en: "Okay, here is one for you." },
      properties: {
        problem: { type: "string", description: "The problem as plain text, e.g. 'Solve: x^2 - 7x + 12 = 0'." },
        answer: { type: "string", description: "The correct final answer, for checking. Never read it aloud." },
      },
      required: ["problem", "answer"],
    }),
    tool(base, token, {
      name: "check_work",
      description:
        "Look at what the student has written in their notebook and find the first wrong step. Use when the student says they are done, says 'check karo', 'ho gaya', 'dekho', asks if they are right, or seems stuck.",
      pre_call_message: { hi: "एक सेकंड, देखती हूँ।", en: "One second, let me look." },
      properties: {},
      required: [],
    }),
    tool(base, token, {
      name: "clear_board",
      description: "Wipe the chalkboard. Only use when moving to a completely new topic.",
      pre_call_message: { hi: "अच्छा।", en: "Okay." },
      properties: {},
      required: [],
    }),
  ];
}

/** Reads bolna/agent-prompt.md: the welcome message line, and the prompt below the "---" line. */
export function readPrompt(): { welcome: string; prompt: string } {
  const text = readFileSync(path.join(root, "bolna", "agent-prompt.md"), "utf8").replace(/\r\n/g, "\n");
  const welcome = /^Welcome message:\s*`([^`]+)`/m.exec(text)?.[1];
  const split = text.indexOf("\n---\n");
  if (!welcome || split < 0) throw new Error("bolna/agent-prompt.md is missing the welcome message line or the --- separator");
  return { welcome, prompt: text.slice(split + 5).trim() };
}

export interface VoiceOptions {
  /** Languages the agent can speak, ISO 639-1. The first is the default. Hinglish runs on "hi". */
  languages: ("hi" | "en")[];
  transcriber: { provider: string; model: string };
  synthesizer: { provider: string; model: string; voice: string; voice_id: string };
  llm: { provider: string; model: string };
  telephony: string;
}

// Defaults: Sarvam for Indian-language speech in and out (a buildathon sponsor), a fast GPT for the conversation.
export const DEFAULT_VOICE: VoiceOptions = {
  languages: ["hi", "en"],
  transcriber: { provider: "sarvam", model: "saaras:v3" },
  synthesizer: { provider: "sarvam", model: "bulbul:v3", voice: "suhani", voice_id: "suhani" },
  llm: { provider: "openai", model: "gpt-5.4-mini" },
  telephony: "plivo",
};

// Bolna's own system lines, in each language (it falls back to its English defaults otherwise).
const STILL_THERE: Spoken = {
  hi: "आप वहाँ हो? आराम से लिखो, हो जाए तो बताना।",
  en: "Are you still there? Take your time, and tell me when you're done.",
};
const GOODBYE: Spoken = {
  hi: "आज के लिए इतना ही। बहुत अच्छा किया, फिर मिलते हैं!",
  en: "That's all for today. Well done, see you next time!",
};

/** Request body for POST /v2/agent (create) and PUT /v2/agent/{id} (update). */
export function buildAgentPayload(opts: { publicUrl: string; toolsToken?: string; voice?: VoiceOptions }) {
  const v = opts.voice ?? DEFAULT_VOICE;
  const base = v.languages[0];
  const { welcome, prompt } = readPrompt();
  const tools = buildTools(opts.publicUrl, opts.toolsToken);
  const synthesizerFor = (language: string) => ({
    provider: v.synthesizer.provider,
    provider_config: { voice: v.synthesizer.voice, voice_id: v.synthesizer.voice_id, model: v.synthesizer.model, language },
  });

  return {
    agent_config: {
      agent_name: "Shikshak",
      agent_welcome_message: welcome,
      tasks: [
        {
          task_type: "conversation",
          toolchain: { execution: "sequential", pipelines: [["transcriber", "llm", "synthesizer"]] },
          tools_config: {
            llm_agent: {
              agent_type: "simple_llm_agent",
              agent_flow_type: "streaming",
              llm_config: {
                provider: v.llm.provider,
                model: v.llm.model,
                // Tool calls carry several board lines, so leave room beyond the 100-token default.
                max_tokens: 400,
                temperature: 1,
              },
            },
            synthesizer: { ...synthesizerFor(base), stream: true, buffer_size: 250, audio_format: "wav" },
            transcriber: {
              provider: v.transcriber.provider,
              model: v.transcriber.model,
              language: base,
              stream: true,
              encoding: "linear16",
              sampling_rate: 16000,
              endpointing: 300,
            },
            input: { provider: v.telephony, format: "wav" },
            output: { provider: v.telephony, format: "wav" },
            api_tools: {
              tools: tools.map(({ value: _value, ...def }) => def),
              tools_params: Object.fromEntries(
                tools.map((t) => [
                  t.name,
                  { method: t.value.method, url: t.value.url, api_token: t.value.api_token, param: JSON.stringify(t.value.param) },
                ]),
              ),
            },
            // One agent for Hindi/Hinglish ("hi") and English ("en"). The browser picks the starting
            // language per call, and Bolna's own lines (waiting, "still there?") follow the active language.
            multilingual_config: {
              enabled: true,
              active_language: base,
              languages: Object.fromEntries(
                v.languages.map((lang) => [
                  lang,
                  { transcriber: { language: lang }, synthesizer: synthesizerFor(lang), system_prompt: prompt, agent_name: "Shikshak" },
                ]),
              ),
            },
          },
          task_config: {
            // Bolna's defaults (90 s calls, hang up after 10 s of silence, "are you still there?"
            // after 10 s) would cut a class short and nag a student who is quietly writing.
            call_terminate: 1200,
            hangup_after_silence: 150,
            check_if_user_online: true,
            trigger_user_online_message_after: 45,
            check_user_online_message: STILL_THERE,
            call_hangup_message: GOODBYE,
            number_of_words_for_interruption: 2,
            incremental_delay: 400,
          },
        },
      ],
    },
    agent_prompts: { task_1: { system_prompt: prompt } },
  };
}
