// Everything Shikshak needs from a Bolna agent, built from files in this repo:
// the prompt and welcome message (bolna/agent-prompt.md) and the four tool definitions.

import { readFileSync } from "node:fs";
import { DIAGRAM_EXAMPLES } from "../shared/diagram";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Spoken while a tool runs. Keyed by language; Bolna plays the one matching the language the agent is speaking. */
export type Spoken = Record<"hi" | "en", string> & Partial<Record<"ta" | "te", string>>;

/** Tamil and Telugu are in preview (not yet reviewed by fluent speakers): tools use a short neutral filler. */
const PREVIEW_FILLER = { ta: "சரி.", te: "సరే." };

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

const CALL = {
  call_code: { type: "string", description: "The call code from the prompt. Always pass it exactly." },
};

function tool(
  base: string,
  token: string | null,
  opts: { name: string; description: string; pre_call_message: Spoken; properties: ToolDef["parameters"]["properties"]; required: string[] },
  id: typeof SESSION | typeof CALL = SESSION,
): ToolDef {
  const all = { ...id, ...opts.properties };
  return {
    name: opts.name,
    description: opts.description,
    pre_call_message: { ...PREVIEW_FILLER, ...opts.pre_call_message },
    parameters: { type: "object", properties: all, required: [...Object.keys(id), ...opts.required] },
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
      name: "write",
      description:
        "Write on the shared blackboard. Use it the way a teacher uses chalk: a heading when starting a topic, a short definition, an equation, or a worked solution built step by step. Lines appear one by one while you speak, so explain them in the same order. Keep it to what matters; never write whole paragraphs.",
      pre_call_message: { hi: "अच्छा।", en: "Okay." },
      properties: {
        kind: {
          type: "string",
          description: "heading | text | equation | steps | your_turn. steps: a solution built line by line. your_turn: a question with space left for the student to work it out.",
        },
        content: {
          type: "string",
          description: "The lines, separated by ' || '. Plain-text maths, no LaTeX: x^2, sqrt(x), a_n = a + (n-1)d. Each line short.",
        },
        place: { type: "string", description: "next (below the latest writing, default) or right (beside it, for a diagram or side note on wide screens)." },
        replace: { type: "string", description: "Optional: a block label like B3 to rub out and write over in the same spot." },
      },
      required: ["kind", "content"],
    }),
    tool(base, token, {
      name: "draw",
      description:
        "Draw a diagram on the board when a picture explains it better: an AP as a chain of terms, a number line, a graph, a triangle, or a table. It draws itself piece by piece as you talk, so describe the pieces in order. Formats: " +
        DIAGRAM_EXAMPLES.join("  /  "),
      pre_call_message: { hi: "चलो, इसे बना के देखते हैं।", en: "Let me draw this." },
      properties: {
        diagram: { type: "string", description: "One line in one of the formats, e.g. 'ap: 2, 5, 8, 11 | d = 3'." },
        caption: { type: "string", description: "Optional short caption." },
        place: { type: "string", description: "next or right (beside the explanation)." },
        replace: { type: "string", description: "Optional block label to draw over." },
      },
      required: ["diagram"],
    }),
    tool(base, token, {
      name: "highlight",
      description:
        "Point at something already on the board while you talk about it: underline, circle or box a block or one of its lines, tick it, or put an arrow by it. Use it when you refer back ('remember this formula?') or stress the key part.",
      pre_call_message: { hi: "यह देखो।", en: "Look here." },
      properties: {
        target: { type: "string", description: "A block label from the board map, like 'B2', or a line in it, like 'B2 line 3'." },
        style: { type: "string", description: "underline | circle | box | tick | arrow" },
        note: { type: "string", description: "Optional 1-3 word chalk note beside it." },
      },
      required: ["target"],
    }),
    tool(base, token, {
      name: "erase",
      description:
        "Rub out a block that is no longer needed or was wrong (its space can be reused with write's replace), or 'all' to start a fresh page for a new topic when the board is crowded.",
      pre_call_message: { hi: "अच्छा।", en: "Okay." },
      properties: { target: { type: "string", description: "A block label like 'B3', or 'all'." } },
      required: ["target"],
    }),
    tool(base, token, {
      name: "give_problem",
      description: "Put a practice problem on the board with space below it for the student to solve. Use when it is the student's turn to solve something you made up.",
      pre_call_message: { hi: "अच्छा, एक सवाल देती हूँ।", en: "Okay, here's one for you." },
      properties: {
        problem: { type: "string", description: "The problem as plain text, e.g. 'Find the 10th term of 2, 5, 8, ...'." },
        answer: { type: "string", description: "The correct final answer, for checking. Never read it aloud." },
      },
      required: ["problem", "answer"],
    }),
    tool(base, token, {
      name: "look_at_board",
      description:
        "Look at what the student wrote or drew on the board: their working, a doubt, a diagram. Returns what is written and, for working, the first wrong step (the board circles it). Call it when you receive 'dtmf_number: 1' (the student pressed Done), or when they say they are done, 'check karo', 'ho gaya', 'dekho', 'maine likha hai', ask if they are right, or ask about something they drew.",
      pre_call_message: { hi: "एक सेकंड, देखती हूँ।", en: "One second, let me look." },
      properties: {
        student_said: {
          type: "string",
          description: "What the student said about their writing or drawing, in a few words, if anything (e.g. 'why is this minus?'). Empty if nothing.",
        },
      },
      required: [],
    }),
    tool(base, token, {
      name: "continue_lesson",
      description:
        "Call this right after you have answered a student's doubt or question that interrupted your explanation. It un-pauses the board and tells you exactly where the lesson was, so you can pick up from there.",
      pre_call_message: { hi: "अच्छा।", en: "Alright." },
      properties: {},
      required: [],
    }),
    tool(base, token, {
      name: "show_section",
      description:
        "Write the next part of today's prepared study plan on the board (made from the student's own notes if they uploaded any). Pass 'next' to move on, or a section number to go back or jump. Returns a short line to say and a question to ask. Only when the lesson plan lists sections.",
      pre_call_message: { hi: "अच्छा, बोर्ड पर देखो।", en: "Okay, look at the board." },
      properties: { section: { type: "string", description: "'next', or a section number from the lesson plan, e.g. '3'." } },
      required: ["section"],
    }),
    tool(base, token, {
      name: "read_material",
      description:
        "Ask the student's uploaded material (their textbook chapter PDF, notes or worksheet) a question. Answers come only from the actual pages, with page numbers, or say it isn't there. Use it when they mention their book or notes, ask about a page or figure, or right after they upload something ('dtmf_number: 4'). Never invent book content or page numbers.",
      pre_call_message: { hi: "एक सेकंड, आपकी किताब देखती हूँ।", en: "One second, let me check your book." },
      properties: {
        question: { type: "string", description: "What to look up, e.g. 'definition of common difference', 'which page has the circuit diagram', or 'what does this cover'." },
      },
      required: ["question"],
    }),
    tool(base, token, {
      name: "show_page",
      description:
        "Put a real page of the student's uploaded material on the board (with its source), e.g. the page with the figure you're about to explain. Then point at it with highlight using the label it returns.",
      pre_call_message: { hi: "यह देखो, आपकी किताब का पेज।", en: "Here's the page from your book." },
      properties: {
        page: { type: "string", description: "Page number in the PDF (first page = 1). For a photo, 1." },
        document: { type: "string", description: "Optional: which file (its number or part of its name) if they uploaded several." },
        caption: { type: "string", description: "Optional short caption, e.g. 'Fig 12.3 circuit'." },
      },
      required: ["page"],
    }),
    tool(base, token, {
      name: "give_practice",
      description:
        "Put the next prepared practice problem from the study plan on the board. Its answer stays hidden; look_at_board checks it. Only when the lesson plan says practice problems are ready.",
      pre_call_message: { hi: "अच्छा, एक सवाल देती हूँ।", en: "Okay, here is one for you." },
      properties: { number: { type: "string", description: "'next', or a practice number, e.g. '2'." } },
      required: ["number"],
    }),
    tool(base, token, {
      name: "next_problem",
      description:
        "Put a CHECKED problem from the library on the board (answer and solution verified, hints ready). Prefer this over making up problems. kind: practice (normal), transfer (a fresh one to see if they can do it alone), diagnostic (the quick check; usually via the diagnostic tool).",
      pre_call_message: { hi: "अच्छा, एक सवाल देती हूँ।", en: "Here's one for you." },
      properties: {
        kind: { type: "string", description: "practice | transfer | diagnostic" },
        skill: { type: "string", description: "Optional skill id, e.g. ap.nth_term, from plan_next or the memory note." },
        problem_id: { type: "string", description: "Optional exact problem id (e.g. from the memory note's suggested exercise)." },
      },
      required: ["kind"],
    }),
    tool(base, token, {
      name: "solve",
      description:
        "Get a worked solution for a problem (yours or the student's) BEFORE you teach or judge it. Returns the answer for your eyes only, steps, three hints, and exactly how much was verified ('library'/'exact' = checked; 'substitution' = only the final answer checked; 'unverified' = nothing checked: never call that checked). Never read out the answer.",
      pre_call_message: { hi: "एक सेकंड।", en: "One second." },
      properties: {
        problem: { type: "string", description: "The problem text (plain-text maths). Leave empty to solve the question on the board." },
        problem_id: { type: "string", description: "Optional library problem id." },
      },
      required: [],
    }),
    tool(base, token, {
      name: "give_hint",
      description:
        "Help with the current question one rung at a time: 1 a nudge (a question), 2 the method, 3 one worked step. Each call shows the next rung on the board. Never skip rungs; never give more help than this.",
      pre_call_message: { hi: "एक छोटा सा इशारा।", en: "Here's a small hint." },
      properties: {},
      required: [],
    }),
    tool(base, token, {
      name: "show_solution",
      description:
        "Write the full checked solution on the board. Only after all three hints, or when the student clearly asks to see it (then student_asked = true). Afterwards give a similar problem to try alone.",
      pre_call_message: { hi: "चलो, पूरा हल देखते हैं।", en: "Let's go through the full solution." },
      properties: { student_asked: { type: "string", description: "true if the student asked to see the solution, else false." } },
      required: ["student_asked"],
    }),
    tool(base, token, {
      name: "check_answer",
      description:
        "Check an answer the student SAID aloud against the current question, exactly (fractions, signs, both roots). Returns correct / incorrect / partial / approximate / unreadable, and a known misconception if their answer matches one. For written work use look_at_board.",
      pre_call_message: { hi: "देखती हूँ।", en: "Let me check." },
      properties: { answer: { type: "string", description: "The student's answer as they said it, e.g. 'x = 3 or 4', '29'." } },
      required: ["answer"],
    }),
    tool(base, token, {
      name: "plan_next",
      description:
        "Ask what to do next when unsure: uses the question, their attempts, hints used, the quick check and their record. Returns one action (nudge, next_hint, explain_step, equivalent_example, transfer_question, follow_up_check, diagnostic_question, continue_lesson) and which tool to call.",
      pre_call_message: { hi: "अच्छा।", en: "Okay." },
      properties: {},
      required: [],
    }),
    tool(base, token, {
      name: "diagnostic",
      description:
        "A short quick check (up to 4 questions) at the start of a NEW topic to find where to start. action: start, next (after each answer is checked), skip (if the student doesn't want it). It adapts: harder after a right answer, easier after a wrong one.",
      pre_call_message: { hi: "पहले एक छोटा सा चेक।", en: "First, a quick check." },
      properties: { action: { type: "string", description: "start | next | skip" } },
      required: ["action"],
    }),
    tool(base, token, {
      name: "skip_question",
      description: "The student wants to skip the current question (or doesn't know it in the quick check). Records it as skipped/unanswered, not wrong.",
      pre_call_message: { hi: "ठीक है।", en: "That's fine." },
      properties: {},
      required: [],
    }),
  ];
}

/** The phone revision agent's tools (Phase 7): keyed by a call code, not a class session. */
export function buildPhoneTools(publicUrl: string, toolsToken?: string): ToolDef[] {
  const base = publicUrl.replace(/\/$/, "");
  const token = toolsToken ? `Bearer ${toolsToken}` : null;
  const number = { type: "string", description: "The question number, 1, 2 or 3." };
  return [
    tool(
      base,
      token,
      {
        name: "phone_question",
        description: "Gets question number N of this revision call, to read aloud. Says done when there are no more.",
        pre_call_message: { hi: "अगला सवाल।", en: "Next question." },
        properties: { number },
        required: ["number"],
      },
      CALL,
    ),
    tool(
      base,
      token,
      {
        name: "phone_answer",
        description: "Checks the student's keypad answer to question N exactly. Pass the digits from 'dtmf_number: <digits>'. Returns correct, or a hint for one more try.",
        pre_call_message: { hi: "देखते हैं।", en: "Let's see." },
        properties: { number, digits: { type: "string", description: "The digits they typed, e.g. 29." } },
        required: ["number", "digits"],
      },
      CALL,
    ),
    tool(
      base,
      token,
      {
        name: "phone_opt_out",
        description: "The student or family doesn't want these calls (said so, or pressed 9). Stops all future calls to this number.",
        pre_call_message: { hi: "ठीक है।", en: "Okay." },
        properties: { how: { type: "string", description: "keypad | voice" } },
        required: [],
      },
      CALL,
    ),
    tool(
      base,
      token,
      {
        name: "phone_end",
        description: "Call at the end of the call (all questions done, or they need to go). Records how it went.",
        pre_call_message: { hi: "ठीक है।", en: "Okay." },
        properties: {},
        required: [],
      },
      CALL,
    ),
  ];
}

function readPromptFile(file: string): { welcome: string; prompt: string } {
  const text = readFileSync(path.join(root, "bolna", file), "utf8").replace(/\r\n/g, "\n");
  const welcome = /^Welcome message:\s*`([^`]+)`/m.exec(text)?.[1];
  const split = text.indexOf("\n---\n");
  if (!welcome || split < 0) throw new Error(`bolna/${file} is missing the welcome message line or the --- separator`);
  return { welcome, prompt: text.slice(split + 5).trim() };
}

/** Reads bolna/agent-prompt.md: the welcome message line, and the prompt below the "---" line. */
export function readPrompt(): { welcome: string; prompt: string } {
  return readPromptFile("agent-prompt.md");
}

export function readPhonePrompt(): { welcome: string; prompt: string } {
  return readPromptFile("phone-prompt.md");
}

export interface VoiceOptions {
  /** Languages the agent can speak, ISO 639-1. The first is the default. Hinglish runs on "hi". */
  languages: ("hi" | "en" | "ta" | "te")[];
  transcriber: { provider: string; model: string };
  synthesizer: { provider: string; model: string; voice: string; voice_id: string };
  llm: { provider: string; model: string };
  telephony: string;
}

export interface LlmChoice {
  provider: string;
  model: string;
  since: string;
  evidence: string;
}
export interface LlmConfig {
  note?: string;
  current: LlmChoice;
  previous: LlmChoice | null;
}
export const LLM_FILE = path.join(root, "bolna", "llm.json");

/** The conversation model (bolna/llm.json), the same on every agent. */
export function readLlmConfig(file = LLM_FILE): LlmConfig {
  return JSON.parse(readFileSync(file, "utf8")) as LlmConfig;
}
function currentLlm() {
  const { provider, model } = readLlmConfig().current;
  return { provider, model };
}

/** Switch to a new model, keeping the current one for rollback. Needs evidence (a benchmark result). */
export function switchLlm(cfg: LlmConfig, next: { provider: string; model: string }, evidence: string, today: string): LlmConfig {
  if (!evidence.trim()) throw new Error("A switch needs evidence: the benchmark result that supports it.");
  if (cfg.current.provider === next.provider && cfg.current.model === next.model) throw new Error("That model is already in use.");
  return { ...cfg, current: { ...next, since: today, evidence }, previous: cfg.current };
}

/** Go back to the previous model. */
export function rollbackLlm(cfg: LlmConfig, today: string): LlmConfig {
  if (!cfg.previous) throw new Error("There is no previous model to roll back to.");
  return { ...cfg, current: { ...cfg.previous, since: today, evidence: `Rolled back from ${cfg.current.provider}:${cfg.current.model}` }, previous: cfg.current };
}

// Defaults: Sarvam for Indian-language speech in and out (a buildathon sponsor), a fast GPT for the conversation.
export const DEFAULT_VOICE: VoiceOptions = {
  // Tamil and Telugu: supported by Soniox (ta, te) and Sarvam bulbul:v3 (ta-IN, te-IN); preview.
  languages: ["hi", "en", "ta", "te"],
  // Soniox: understands Hindi-English mixing and detects when the student has finished a thought
  // (semantic end of turn) instead of a fixed silence timer, so it doesn't cut in when they pause.
  transcriber: { provider: "soniox", model: "stt-rt-v5" },
  synthesizer: { provider: "sarvam", model: "bulbul:v3", voice: "suhani", voice_id: "suhani" },
  llm: currentLlm(),
  telephony: "plivo",
};

// Words the speech recogniser should expect in a maths class (no weights; Bolna strips them).
const MATHS_KEYWORDS =
  "quadratic, equation, factorise, factorisation, discriminant, square root, x square, polynomial, coefficient, " +
  "arithmetic progression, trigonometry, theta, sine, cosine, tangent, Pythagoras, numerator, denominator, check karo, ho gaya, dekho";
const TRANSCRIBER_CONTEXT =
  "A class 10 maths tutoring session in India. The student speaks Hindi, English or a mix (Hinglish), " +
  "talks about equations, steps and their working, and often pauses mid-sentence while thinking or writing.";

// Bolna's own system lines, in each language (it falls back to its English defaults otherwise).
const STILL_THERE: Spoken = {
  hi: "आप वहाँ हो? आराम से लिखो, हो जाए तो बताना।",
  en: "Are you still there? Take your time, and tell me when you're done.",
  ta: "நீங்கள் இருக்கிறீர்களா? நிதானமாக எழுதுங்கள், முடிந்ததும் சொல்லுங்கள்.",
  te: "మీరు ఉన్నారా? నెమ్మదిగా రాయండి, అయిపోయాక చెప్పండి.",
};
const GOODBYE: Spoken = {
  hi: "आज के लिए इतना ही। बहुत अच्छा किया, फिर मिलते हैं!",
  en: "That's all for today. Well done, see you next time!",
  ta: "இன்றைக்கு இவ்வளவுதான். நன்றாகச் செய்தீர்கள், மீண்டும் சந்திப்போம்!",
  te: "ఈరోజుకి ఇంతే. బాగా చేశారు, మళ్ళీ కలుద్దాం!",
};

/** Request body for POST /v2/agent (create) and PUT /v2/agent/{id} (update). */
/** Voice speed per agent (Bolna can't change it mid-call, so each speed is its own agent). */
export const SPEED_RATES = { slower: 0.95, normal: 1.1, faster: 1.3 } as const;
export type SpeedName = keyof typeof SPEED_RATES;

export function buildAgentPayload(opts: { publicUrl: string; toolsToken?: string; voice?: VoiceOptions; speed?: SpeedName }) {
  const v = opts.voice ?? DEFAULT_VOICE;
  const rate = SPEED_RATES[opts.speed ?? "normal"];
  const base = v.languages[0];
  const { welcome, prompt } = readPrompt();
  const tools = buildTools(opts.publicUrl, opts.toolsToken);
  const synthesizerFor = (language: string) => ({
    provider: v.synthesizer.provider,
    provider_config: { voice: v.synthesizer.voice, voice_id: v.synthesizer.voice_id, model: v.synthesizer.model, language, speed: rate },
  });

  return {
    agent_config: {
      agent_name: opts.speed && opts.speed !== "normal" ? `Shikshak (${opts.speed})` : "Shikshak",
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
              // Fallback silence before replying, for transcribers without their own turn detection.
              endpointing: 700,
              keywords: MATHS_KEYWORDS,
              context: TRANSCRIBER_CONTEXT,
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
            // Stop talking as soon as the student says a word.
            // Push-to-talk makes interruptions deliberate; 2 words avoids stray noise in hands-free mode.
            number_of_words_for_interruption: 2,
            incremental_delay: 400,
            // Keypad digits reach the LLM as "dtmf_number: 1": that's the board's Done button.
            dtmf_enabled: true,
          },
        },
      ],
    },
    agent_prompts: { task_1: { system_prompt: prompt } },
  };
}

/** The phone revision agent: same voices and model, its own prompt and tools, short calls, keypad on. */
export function buildPhoneAgentPayload(opts: { publicUrl: string; toolsToken?: string; maxCallSeconds?: number; voice?: VoiceOptions }) {
  const body = buildAgentPayload({ publicUrl: opts.publicUrl, toolsToken: opts.toolsToken, voice: opts.voice });
  const { welcome, prompt } = readPhonePrompt();
  const tools = buildPhoneTools(opts.publicUrl, opts.toolsToken);
  const task = body.agent_config.tasks[0];
  const cfg = task.tools_config;
  body.agent_config.agent_name = "Shikshak phone revision";
  body.agent_config.agent_welcome_message = welcome;
  cfg.api_tools = {
    tools: tools.map(({ value: _value, ...def }) => def),
    tools_params: Object.fromEntries(
      tools.map((t) => [t.name, { method: t.value.method, url: t.value.url, api_token: t.value.api_token, param: JSON.stringify(t.value.param) }]),
    ),
  };
  for (const lang of Object.values(cfg.multilingual_config.languages)) lang.system_prompt = prompt;
  body.agent_prompts.task_1.system_prompt = prompt;
  Object.assign(task.task_config, {
    // A revision call is short; the server also caps it (PHONE_MAX_CALL_SECONDS).
    call_terminate: opts.maxCallSeconds ?? 300,
    hangup_after_silence: 30,
    trigger_user_online_message_after: 15,
    dtmf_enabled: true,
  });
  return body;
}
