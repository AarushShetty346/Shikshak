// Reads what the student wrote or drew on the board: a worked solution, a question, a diagram.
// For working, finds the first wrong line. Runs when the student presses Done (so the tutor's
// later look is instant) and again only if the drawing changed.

import { createHash } from "node:crypto";
import { languageName } from "./claude";
import { config } from "./config";
import { chargeModelCall, withModelSlot } from "./limits";
import { askJson, dataUrlToAttachment, hasModel } from "./llm";
import { emit, signal, type Capture, type Session } from "./sessions";

export interface LookResult {
  /** What the student put on the board. */
  kind: "working" | "question" | "diagram" | "answer" | "other" | "empty";
  /** Plain-text reading of what is written, line by line ("1) ..."). Diagrams: a short description. */
  reading: string;
  /** For working or an answer: is it right? Otherwise "not_checked". */
  status: "correct" | "mistake" | "incomplete" | "unreadable" | "not_checked" | "empty";
  /** First wrong (or unreadable) line, 1-based, matching the numbers in the margin. */
  line: number | null;
  /** Short English description of the error, or of what the student is asking. */
  what_went_wrong: string;
  /** What the tutor could say, in the student's language. */
  say: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "reading", "status", "line", "what_went_wrong", "say"],
  properties: {
    kind: { type: "string", enum: ["working", "question", "diagram", "answer", "other", "empty"] },
    reading: { type: "string" },
    status: { type: "string", enum: ["correct", "mistake", "incomplete", "unreadable", "not_checked", "empty"] },
    line: { anyOf: [{ type: "integer" }, { type: "null" }] },
    what_went_wrong: { type: "string" },
    say: { type: "string" },
  },
};

const SYSTEM = `You are a patient class 10 maths teacher in India looking at what a student just wrote or drew on a shared blackboard during a live voice lesson.

The image shows only the student's own writing. Each handwritten line has a grey number in the left margin (1, 2, 3...).

First decide what it is:
- "working": steps solving a problem. Find the FIRST line where it goes wrong (arithmetic slip, dropped or flipped sign, wrong rule, copying error). Later lines that follow correctly from a wrong line are not separate mistakes.
- "answer": just a final answer. Check it against the problem.
- "question": the student wrote or drew a doubt (e.g. "?", an underlined term, "why?").
- "diagram": a figure, graph or sketch.
- "other" or "empty".

Fields:
- reading: what is written, in plain text maths (x^2, sqrt(x)), one line per numbered line like "1) x^2 - 5x + 6 = 0". For a diagram, one or two sentences describing it.
- status: for working/answer use "correct", "mistake", "incomplete" (right so far but unfinished) or "unreadable" (you can't read a line; never guess). For question/diagram/other use "not_checked". "empty" if nothing is written.
- line: the first wrong or unreadable line number, else null.
- what_went_wrong: one short English sentence: the exact error, or what the student seems to be asking.
- say: what the teacher could say out loud next, in {LANGUAGE}. One or two short spoken sentences. For a mistake name the line ("Step 2"), say what kind of slip it is, and ask them to look again without giving the answer. For a question or diagram, respond to it directly. Warm, never harsh. No symbols that are awkward to speak; say "minus", "plus", "square".
Use what the student said aloud and the board context to understand what they mean.`;

export async function lookAtWork(input: {
  png: string;
  lineCount: number;
  problem: string | null;
  answer?: string;
  boardContext: string[];
  studentSaid?: string;
  language: string;
}): Promise<LookResult> {
  const result = await askJson<LookResult>({
    system: SYSTEM.replace("{LANGUAGE}", languageName(input.language)),
    effort: "low",
    schema: SCHEMA,
    attachments: [dataUrlToAttachment(input.png)],
    text: [
      input.problem ? `Current problem: ${input.problem}` : "No problem was set; the student may be asking something.",
      input.answer ? `Expected final answer: ${input.answer}` : "",
      input.boardContext.length ? `Tutor's recent board lines: ${input.boardContext.join(" | ")}` : "",
      input.studentSaid ? `The student said: "${input.studentSaid}"` : "",
      `The student has written ${input.lineCount} line(s).`,
    ]
      .filter(Boolean)
      .join("\n"),
  });
  if (result.line !== null && (result.line < 1 || result.line > input.lineCount)) result.line = null;
  return result;
}

/** FAKE_CHECKER=1 and no model key: always flags line 2 (or says correct for one line). For UI work. */
function fakeLook(lineCount: number): LookResult {
  if (lineCount < 2)
    return { kind: "answer", reading: "1) (fake)", status: "correct", line: null, what_went_wrong: "", say: "Bilkul sahi! Shabash." };
  return {
    kind: "working",
    reading: "(fake checker)",
    status: "mistake",
    line: 2,
    what_went_wrong: "The -3 should become +3 when it moves to the other side.",
    say: "Step 2 mein negative sign chhoot gaya. Dobara dekho.",
  };
}

export function canLook(): boolean {
  return hasModel() || process.env.FAKE_CHECKER === "1";
}

export const EMPTY_LOOK: LookResult = {
  kind: "empty",
  reading: "",
  status: "empty",
  line: null,
  what_went_wrong: "Nothing new is written on the board.",
  say: "",
};

/**
 * Everything a reading depends on. The same image means something different under a different
 * question, expected answer, language or spoken context, so all of it is part of the cache key.
 */
export function analysisKey(s: Session, capture: Capture, studentSaid?: string): string {
  const parts = [
    capture.hash,
    capture.questionId ?? "",
    s.problem?.id ?? "",
    s.problem?.text ?? "",
    s.problem?.answer ?? "",
    s.language,
    String(capture.lineCount),
    (studentSaid ?? "").trim().toLowerCase().replace(/\s+/g, " "),
  ];
  return createHash("sha1").update(parts.join("\u241f")).digest("hex");
}

/** Analysis for this capture in its current context, shared by everyone who asks for the same thing. */
export function analyze(s: Session, capture: Capture, studentSaid?: string): Promise<LookResult> {
  if (!capture.png || capture.lineCount === 0) return Promise.resolve(EMPTY_LOOK);
  const key = analysisKey(s, capture, studentSaid);
  const cached = s.analyses.get(key);
  if (cached) return cached;
  const problem = s.problem;
  const job = (async () => {
    if (!hasModel()) return fakeLook(capture.lineCount);
    chargeModelCall(s.deviceId, "check");
    return withModelSlot(() =>
      lookAtWork({
        png: capture.png!,
        lineCount: capture.lineCount,
        problem: problem?.text ?? null,
        answer: problem?.answer,
        boardContext: s.recentBoard,
        studentSaid,
        language: s.language,
      }),
    );
  })();
  s.analyses.set(key, job);
  // A failed analysis shouldn't stay cached; the next request retries.
  job.catch(() => s.analyses.delete(key));
  while (s.analyses.size > config.limits.maxAnalysesPerSession()) s.analyses.delete(s.analyses.keys().next().value!);
  return job;
}

/** True if this capture is still the student's latest answer to the question on the board now. */
export function isCurrent(s: Session, capture: Capture): boolean {
  if ((capture.questionId ?? null) !== (s.problem?.id ?? null)) return false;
  for (const c of s.captures.values()) if (c.questionId === capture.questionId && c.at > capture.at && c.lineCount > 0) return false;
  return true;
}

/**
 * Puts a reading on the board: circle the wrong line, stamp a correct answer. Only for the
 * student's current work on the current question; a late result for older work is dropped.
 */
export function publishResult(s: Session, capture: Capture, result: LookResult): boolean {
  if (!isCurrent(s, capture)) return false;
  if ((result.status === "mistake" || result.status === "unreadable") && result.line) {
    emit(s, {
      type: "mark",
      captureId: capture.id,
      questionId: capture.questionId,
      line: result.line,
      note: result.status === "unreadable" ? "Can't read this line" : result.what_went_wrong,
      box: capture.lines[result.line - 1] ?? null,
    });
  } else if (result.status === "correct") {
    emit(s, { type: "correct", captureId: capture.id, questionId: capture.questionId, note: result.what_went_wrong, box: capture.lines[capture.lines.length - 1] ?? null });
  }
  return true;
}

/** One-line summary of a reading for the student's feedback card. */
export function feedbackSummary(result: LookResult): string {
  const read = result.reading.split(/\r?\n/).slice(0, 3).join("  ·  ");
  switch (result.status) {
    case "correct":
      return `Correct. ${read}`;
    case "mistake":
      return `Step ${result.line ?? "?"} needs a look: ${result.what_went_wrong}`;
    case "incomplete":
      return `On the right track so far. ${read}`;
    case "unreadable":
      return `Couldn't read line ${result.line ?? "?"}. Rewrite it a little bigger?`;
    case "empty":
      return "Nothing new to read yet.";
    default:
      return result.what_went_wrong || read || "Read your work.";
  }
}

/**
 * The Done protocol on the server: acknowledge receipt at once, read the work, publish the result
 * to the board (so the student sees it even before the tutor speaks), and report failure clearly.
 */
export async function reviewSubmission(s: Session, capture: Capture, onResult?: (result: LookResult) => void) {
  const q = capture.questionId;
  signal(s, { type: "review", captureId: capture.id, questionId: q, state: "received" });
  if (!canLook()) {
    signal(s, { type: "review", captureId: capture.id, questionId: q, state: "failed", summary: "The board reader isn't set up on the server." });
    return;
  }
  try {
    const result = await analyze(s, capture);
    if (!publishResult(s, capture, result)) {
      signal(s, { type: "review", captureId: capture.id, questionId: q, state: "stale", summary: "There's a newer question or newer work on the board, so this one wasn't marked." });
      return;
    }
    onResult?.(result);
    signal(s, { type: "review", captureId: capture.id, questionId: q, state: "done", status: result.status, summary: feedbackSummary(result) });
  } catch (err) {
    console.error("[look] review failed", (err as Error).message);
    signal(s, { type: "review", captureId: capture.id, questionId: q, state: "failed", summary: (err as Error).name === "QuotaError" || (err as Error).name === "BusyError" ? (err as Error).message : "Couldn't read it just now. Tap Done again." });
  }
}
