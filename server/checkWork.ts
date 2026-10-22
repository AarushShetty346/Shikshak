import { askJson, dataUrlToImage, languageName } from "./claude";

export interface CheckResult {
  status: "correct" | "mistake" | "incomplete" | "unreadable" | "empty";
  /** First wrong (or unreadable) line, 1-based, matching the numbers drawn in the margin. */
  line: number | null;
  /** Short English description, for logs and for the agent. */
  what_went_wrong: string;
  /** What the tutor should say, in the student's language. */
  say: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "line", "what_went_wrong", "say"],
  properties: {
    status: { type: "string", enum: ["correct", "mistake", "incomplete", "unreadable", "empty"] },
    line: { type: ["integer", "null"] },
    what_went_wrong: { type: "string" },
    say: { type: "string" },
  },
};

const SYSTEM = `You are a patient class 10 maths teacher in India checking a student's handwritten working.

The image shows the student's notebook. Each handwritten line has a grey number in the left margin (1, 2, 3...). Each line is one step.

Find the FIRST line where the working goes wrong: an arithmetic slip, a dropped or flipped sign, a wrong rule, a copying error from the previous line. Later lines that follow correctly from a wrong line are not separate mistakes.

Rules:
- status "correct": every line is right and the final answer is right.
- status "incomplete": everything so far is right but the student has not reached the answer yet.
- status "mistake": give the line number of the first wrong line.
- status "unreadable": you cannot read a line well enough to judge it. Give that line number. Never guess.
- status "empty": nothing is written.
- "what_went_wrong": one short English sentence naming the exact error, e.g. "Line 2: -3 moved to the right side but stayed -3 instead of becoming +3."
- "say": what the teacher says out loud, in {LANGUAGE}. One or two short spoken sentences. Name the line ("Step 2" / "Line 2"), say what kind of slip it is, and ask them to look again. Do not give away the full answer. Warm, never harsh. No symbols that are awkward to speak; say "minus", "plus", "square".`;

export async function checkWork(input: {
  png: string;
  lineCount: number;
  problem: string | null;
  answer?: string;
  language: string;
}): Promise<CheckResult> {
  const lang = languageName(input.language);
  const problem = input.problem ?? "(The tutor did not set a problem. Infer it from the first line.)";
  const result = await askJson<CheckResult>({
    system: SYSTEM.replace("{LANGUAGE}", lang),
    effort: "low",
    schema: SCHEMA,
    content: [
      dataUrlToImage(input.png),
      {
        type: "text",
        text:
          `Problem: ${problem}\n` +
          (input.answer ? `Expected final answer: ${input.answer}\n` : "") +
          `The student has written ${input.lineCount} line(s).`,
      },
    ],
  });
  if (result.line !== null && (result.line < 1 || result.line > input.lineCount)) result.line = null;
  return result;
}
