// Scripted classroom moments for comparing tutor models. Each uses the real agent prompt and the
// real tool definitions, and is scored automatically (scoring.ts). Voice and language quality
// still need a human: the replies are exported to a rating sheet.

export interface Scenario {
  id: string;
  what: string;
  language: "hinglish" | "hi" | "en";
  /** Prompt variables, filled into bolna/agent-prompt.md. */
  vars: Record<string, string>;
  /** The conversation so far (the last message is the student's). */
  messages: { role: "user" | "assistant"; content: string }[];
  /** Acceptable tool names (empty = a spoken reply without a tool is expected). */
  expectTools: string[];
  /** Extra checks on the tool arguments. */
  expectArgs?: Record<string, RegExp>;
  /** The reply must not give away this answer. */
  mustNotReveal?: string;
}

const base = (extra: Record<string, string> = {}) => ({
  session_code: "s_benchmarkbenchmarkbench",
  student_name: "Asha",
  grade: "10",
  language_name: "Hinglish (Hindi-English mix, Roman script)",
  topic: "Arithmetic progressions",
  lesson_plan: "No prepared plan. Ask the student what they are stuck on, then teach it on the board with write and draw.",
  material: "No material uploaded in this session.",
  lesson_state: "This class was paused and is now resuming; the board is still on their screen. Board so far: B1 (heading): Arithmetic Progression | B2 (problem): Find the 10th term of the AP: 2, 5, 8, ...",
  learner_memory: "Asha has no recorded work yet. Don't claim to remember anything.",
  greeting: "Namaste Asha!",
  ...extra,
});

export const SCENARIOS: Scenario[] = [
  {
    id: "done-pressed",
    what: "Student pressed Done on the board",
    language: "hinglish",
    vars: base(),
    messages: [
      { role: "assistant", content: "Chalo, ab yeh sawaal board pe solve karo, ek line mein ek step." },
      { role: "user", content: "dtmf_number: 1" },
    ],
    expectTools: ["look_at_board"],
  },
  {
    id: "stuck-hint",
    what: "Student is stuck: should get the next hint, not the answer",
    language: "hinglish",
    vars: base(),
    messages: [
      { role: "assistant", content: "Board pe sawaal hai: 10th term nikaalo. Try karo." },
      { role: "user", content: "Mujhe samajh nahi aa raha ma'am, kaise karun?" },
    ],
    expectTools: ["give_hint", "plan_next", "solve"],
    mustNotReveal: "29",
  },
  {
    id: "answer-aloud",
    what: "Student says an answer out loud",
    language: "hinglish",
    vars: base(),
    messages: [
      { role: "assistant", content: "Batao, 10th term kya aaya?" },
      { role: "user", content: "Ma'am mera answer 32 aaya." },
    ],
    expectTools: ["check_answer"],
    expectArgs: { answer: /32/ },
    mustNotReveal: "29",
  },
  {
    id: "new-topic-diagnostic",
    what: "A brand-new topic: offer or start the quick check",
    language: "hinglish",
    vars: base({ lesson_state: "New class: nothing has been taught yet." }),
    messages: [
      { role: "assistant", content: "Namaste Asha! Aaj hum Arithmetic progressions padhenge. Shuru karein?" },
      { role: "user", content: "Haan ma'am, shuru karte hain." },
    ],
    expectTools: ["diagnostic", "write", "show_section", "next_problem"],
  },
  {
    id: "explain-on-board",
    what: "Asked to explain the common difference on the board",
    language: "hinglish",
    vars: base(),
    messages: [{ role: "user", content: "Common difference kya hota hai? Board pe likh ke samjhao na." }],
    expectTools: ["write", "draw"],
    expectArgs: { content: /d|difference|a_?2/i },
  },
  {
    id: "hindi-reply",
    what: "A Hindi-speaking student: reply in Devanagari",
    language: "hi",
    vars: base({ language_name: "Hindi" }),
    messages: [{ role: "user", content: "मुझे AP में common difference समझ नहीं आया।" }],
    expectTools: ["write", "draw", ""],
  },
  {
    id: "back-after-doubt",
    what: "Doubt answered: continue the lesson where it was",
    language: "hinglish",
    vars: base(),
    messages: [
      { role: "assistant", content: "Haan, d hamesha baad wala term minus pehle wala hota hai." },
      { role: "user", content: "Achha theek hai, samajh gaya. Aage chaliye." },
    ],
    expectTools: ["continue_lesson", "plan_next", "next_problem"],
  },
  {
    id: "harder-problem",
    what: "Student asks for a harder problem",
    language: "hinglish",
    vars: base(),
    messages: [{ role: "user", content: "Ma'am ek aur, thoda mushkil wala sawaal do." }],
    expectTools: ["next_problem", "give_problem"],
  },
];
