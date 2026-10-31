// Everything Shikshak needs from a Bolna agent, built from files in this repo:
// the prompt and welcome message (bolna/agent-prompt.md) and the four tool definitions.

import { readFileSync } from "node:fs";
import { DIAGRAM_EXAMPLES } from "../shared/diagram";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Spoken while a tool runs. Board tools that write at once get one or two words ("Look."), so the
 * filler is the start of her explanation, not a second voice before it. Keyed by language; Bolna plays the one matching the language the agent is speaking. */
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
      pre_call_message: { hi: "देखो।", en: "Look." },
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
      pre_call_message: { hi: "चलो, बनाते हैं।", en: "Let me draw it." },
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
        "Rub something off the board, only when the student asks you to. Your writing: a block label from the board map (e.g. 'B3'), or 'all' to clear your writing and start a fresh page. The student's own drawing or writing: 'student' for the last thing they drew or wrote, 'student all' for everything they wrote. Say it's gone only after this returns ok.",
      pre_call_message: { hi: "बस एक पल।", en: "Just a moment." },
      properties: { target: { type: "string", description: "A block label like 'B3', 'all', 'student' (their last drawing) or 'student all'." } },
      required: ["target"],
    }),
    tool(base, token, {
      name: "give_problem",
      description: "Put a practice problem on the board with space below it for the student to solve. Use when it is the student's turn to solve something you made up.",
      pre_call_message: { hi: "यह लो।", en: "Here you go." },
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
      pre_call_message: { hi: "एक सेकंड, आपका काम देख रही हूँ।", en: "One second, I'm looking at your work." },
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
      pre_call_message: { hi: "चलो।", en: "Right." },
      properties: {},
      required: [],
    }),
    tool(base, token, {
      name: "show_section",
      description:
        "Write the next part of today's prepared study plan on the board (made from the student's own notes if they uploaded any). Pass 'next' to move on, or a section number to go back or jump. Returns a short line to say and a question to ask. Only when the lesson plan lists sections.",
      pre_call_message: { hi: "अब अगला हिस्सा।", en: "Now the next part." },
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
      pre_call_message: { hi: "सोचने दो, कौन सा सवाल दूँ।", en: "Let me think of a good one for you." },
      properties: { number: { type: "string", description: "'next', or a practice number, e.g. '2'." } },
      required: ["number"],
    }),
    tool(base, token, {
      name: "next_problem",
      description:
        "Put a CHECKED problem from the library on the board (answer and solution verified, hints ready). Prefer this over making up problems. kind: practice (normal), transfer (a fresh one to see if they can do it alone), diagnostic (the quick check; usually via the diagnostic tool).",
      pre_call_message: { hi: "हम्म, एक अच्छा सा सवाल ढूँढती हूँ।", en: "Hmm, let me find a good question." },
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
      pre_call_message: { hi: "सोच रही हूँ, बस एक सेकंड।", en: "Thinking, just a second." },
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
      pre_call_message: { hi: "रुको, चेक करती हूँ।", en: "Hold on, let me check." },
      properties: { answer: { type: "string", description: "The student's answer as they said it, e.g. 'x = 3 or 4', '29'." } },
      required: ["answer"],
    }),
    tool(base, token, {
      name: "plan_next",
      description:
        "Ask what to do next when unsure: uses the question, their attempts, hints used, the quick check and their record. Returns one action (nudge, next_hint, explain_step, equivalent_example, transfer_question, follow_up_check, diagnostic_question, continue_lesson) and which tool to call.",
      pre_call_message: { hi: "सोचने दो, आगे क्या करें।", en: "Let me think about what's next." },
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
      pre_call_message: { hi: "कोई बात नहीं, आगे बढ़ते हैं।", en: "No problem, let's move on." },
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
  // Tamil and Telugu: supported by Sarvam saaras:v4 and bulbul:v3; preview.
  languages: ["hi", "en", "ta", "te"],
  // Sarvam saaras:v4: built for Indian languages (Hindi, Hinglish, Tamil, Telugu, Indian English).
  // Switched from Soniox stt-rt-v5 on 31 Oct 2026. Unlike Soniox it has no end-of-turn detection of
  // its own, so the 700 ms endpointing below decides when the student has finished.
  transcriber: { provider: "sarvam", model: "saaras:v4" },
  synthesizer: { provider: "sarvam", model: "bulbul:v3", voice: "suhani", voice_id: "suhani" },
  llm: currentLlm(),
  telephony: "plivo",
};

// Words the speech recogniser should expect in a maths class (no weights; Bolna strips them).
const MATHS_TERMS =
  "quadratic, equation, factorise, factorisation, discriminant, square root, x square, polynomial, coefficient, " +
  "arithmetic progression, trigonometry, theta, sine, cosine, tangent, Pythagoras, numerator, denominator";
/** Keywords per class language: the maths terms, plus everyday Hinglish words only where they're spoken. */
export const TRANSCRIBER_KEYWORDS: Record<"hi" | "en" | "ta" | "te", string> = {
  hi: `${MATHS_TERMS}, check karo, ho gaya, dekho`,
  en: MATHS_TERMS,
  ta: MATHS_TERMS,
  te: MATHS_TERMS,
};
const CLASS = "A class 10 maths tutoring session in India.";
const WORKING = "talks about equations, steps and their working, and often pauses mid-sentence while thinking or writing.";
/** What the speech recogniser is told about each class language (Bolna keeps one per language). */
export const TRANSCRIBER_CONTEXT: Record<"hi" | "en" | "ta" | "te", string> = {
  hi: `${CLASS} The student speaks Hindi or Hinglish (Hindi mixed with English maths words), ${WORKING}`,
  en: `${CLASS} The student speaks Indian English, ${WORKING}`,
  ta: `${CLASS} The student speaks Tamil, often with English maths words, ${WORKING}`,
  te: `${CLASS} The student speaks Telugu, often with English maths words, ${WORKING}`,
};

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

const READ_ALOUD =
  '- Everything you say is read aloud. Talk like a person: no bullet points, numbered lists, headings or line breaks. Never read symbols aloud; say "x square", "minus", "a n".';
const SHORT_TURNS = "- Keep each turn short: one to three sentences, then a question or a clear instruction so they know it's their turn.";
const EXAMPLES_NOTE = (name: string) =>
  `- The example phrases elsewhere in these instructions are in Hinglish only to show the tone. Never say them in Hindi: say the same kind of thing in ${name}.`;

/**
 * The "How you speak" section for each agent language. Hindi ("hi", which also runs Hinglish
 * classes) keeps the section as written in bolna/agent-prompt.md; English, Tamil and Telugu get
 * their own, so each language's prompt in Bolna is written for that language.
 */
export const HOW_YOU_SPEAK: Partial<Record<"hi" | "en" | "ta" | "te", string>> = {
  en: [
    "## How you speak",
    "- Speak only in English for the whole call, including short replies and the moments you need to think. Stay in English even if the student uses Hindi words or their words reach you in Devanagari. Switch only if the student asks you to.",
    "- Simple Indian English: short sentences and everyday words, the way a friendly tuition teacher talks. No Hindi sentences.",
    READ_ALOUD,
    '- When you need a moment (thinking, looking at their work, getting a question ready), say so naturally and vary it: "one second, let me think", "hmm, let\'s see", "let me check that", "give me a moment", "good question, let me think". Never use the same one twice in a row, and don\'t start every reply with "okay" or "so".',
    '- Spell single letters the way they sound, because the voice can\'t read a lone letter: say "wai" for y, "eks" for x, "ay" for a, "bee" for b, "see" for c, "en" for n, "dee" for d. For example say "wai equals four minus eks", never "y = 4 - x". On the board, write the normal letters.',
    SHORT_TURNS,
    EXAMPLES_NOTE("English"),
  ].join("\n"),
  ta: [
    "## How you speak",
    "- Speak only in Tamil, in Tamil script, for the whole call, including short replies and the moments you need to think. Stay in Tamil even if the student uses English or Hindi words, or their words reach you in another script. Switch only if the student asks you to.",
    "- Simple everyday spoken Tamil, the way a friendly tuition teacher in Tamil Nadu talks. Keep maths words students know in English (equation, term, square).",
    READ_ALOUD,
    "- When you need a moment (thinking, looking at their work, getting a question ready), say so naturally in Tamil and vary it. Never use the same phrase twice in a row.",
    '- Spell single letters the way they sound, because the voice can\'t read a lone letter: say the English letter name in Tamil script, for example எக்ஸ் for x and வை for y. On the board, write the normal letters.',
    SHORT_TURNS,
    EXAMPLES_NOTE("Tamil"),
  ].join("\n"),
  te: [
    "## How you speak",
    "- Speak only in Telugu, in Telugu script, for the whole call, including short replies and the moments you need to think. Stay in Telugu even if the student uses English or Hindi words, or their words reach you in another script. Switch only if the student asks you to.",
    "- Simple everyday spoken Telugu, the way a friendly tuition teacher in Andhra Pradesh or Telangana talks. Keep maths words students know in English (equation, term, square).",
    READ_ALOUD,
    "- When you need a moment (thinking, looking at their work, getting a question ready), say so naturally in Telugu and vary it. Never use the same phrase twice in a row.",
    '- Spell single letters the way they sound, because the voice can\'t read a lone letter: say the English letter name in Telugu script, for example ఎక్స్ for x and వై for y. On the board, write the normal letters.',
    SHORT_TURNS,
    EXAMPLES_NOTE("Telugu"),
  ].join("\n"),
};

/** The prompt for one agent language: the "How you speak" section swapped for that language's. */
export function promptFor(prompt: string, lang: "hi" | "en" | "ta" | "te"): string {
  const section = HOW_YOU_SPEAK[lang];
  if (!section) return prompt;
  const start = prompt.indexOf("## How you speak\n");
  const end = prompt.indexOf("\n## ", start + 1);
  if (start < 0 || end < 0) throw new Error('bolna/agent-prompt.md needs a "## How you speak" section followed by another "## " heading');
  return prompt.slice(0, start) + section + "\n" + prompt.slice(end);
}

/** Request body for POST /v2/agent (create) and PUT /v2/agent/{id} (update). */
/** The tutor's voice speed (one agent, so one speed; Bolna can't change it mid-call). */
export const VOICE_RATE = 1.1;

export function buildAgentPayload(opts: { publicUrl: string; toolsToken?: string; voice?: VoiceOptions }) {
  const v = opts.voice ?? DEFAULT_VOICE;
  const rate = VOICE_RATE;
  const base = v.languages[0];
  const { welcome, prompt } = readPrompt();
  const tools = buildTools(opts.publicUrl, opts.toolsToken);
  const synthesizerFor = (language: string) => ({
    provider: v.synthesizer.provider,
    provider_config: { voice: v.synthesizer.voice, voice_id: v.synthesizer.voice_id, model: v.synthesizer.model, language, speed: rate },
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
                // Tool calls carry several board lines, and medium reasoning's thinking counts against
                // this limit too, so leave plenty of room (the prompt keeps spoken turns short).
                max_tokens: 1200,
                temperature: 1,
                // Medium (team choice, 31 Oct 2026): more careful answers, at the cost of a longer
                // pause before she speaks. Not yet timed in a real class.
                reasoning_effort: "medium",
                verbosity: "medium",
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
              keywords: TRANSCRIBER_KEYWORDS[base],
              context: TRANSCRIBER_CONTEXT[base],
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
                  {
                    // Bolna needs the provider and model on each language once anything besides the language is set.
                    transcriber: {
                      provider: v.transcriber.provider,
                      model: v.transcriber.model,
                      language: lang,
                      keywords: TRANSCRIBER_KEYWORDS[lang],
                      context: TRANSCRIBER_CONTEXT[lang],
                    },
                    synthesizer: synthesizerFor(lang),
                    system_prompt: promptFor(prompt, lang),
                    agent_name: "Shikshak",
                  },
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
            // The tutor stops only after 3 words, so a cough, "hmm" or a word read aloud while writing
            // doesn't cut her off. The short delay makes her reply sooner once the student finishes.
            number_of_words_for_interruption: 3,
            incremental_delay: 200,
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
