// Checked maths and teaching moves for the voice tutor. Heavy work (solving, checking, choosing
// the next move) happens here, in tools, so the spoken turn stays short and fast.
//
//   next_problem   put a checked library problem on the board (practice, transfer, diagnostic)
//   solve          a worked solution with exactly how much of it was verified
//   give_hint      the hint ladder: nudge -> hint -> one worked step (enforced in order)
//   show_solution  the whole checked solution, only after the ladder or when the student asks
//   check_answer   compare an answer the student said aloud, deterministically
//   plan_next      what to do now, from the lesson, the attempt, hints used and the learner's record
//   diagnostic     run the short starting check for a new topic
//
// Guarantees, stated precisely: a solution is called "checked" only when its recorded checks
// justify it (see Solution.verified). Live speech is not checked; only what goes through here.

import { randomUUID } from "node:crypto";
import type { Request, Response, Router } from "express";
import { randomId } from "./auth";
import { newQuestionId } from "./board";
import { chapterForTopic, checkAnswer, diagnosticSet, pickProblem, problem as libraryProblem, PROBLEMS, skill as skillById } from "./curriculum/library";
import { misconception } from "./curriculum/misconceptions";
import type { ChapterId, Kind, Problem } from "./curriculum/types";
import { attemptFor, getLearner, learnerAttempts, recordAttempt, sessionAttempts, skillProgress, suggestNext, type Outcome } from "./learners";
import { chargeModelCall, withModelSlot } from "./limits";
import { askJson, hasModel } from "./llm";
import { compareAnswer, describeAnswer, type AnswerSpec } from "./maths/answers";
import { solveFreeform } from "./maths/solver";
import { solveOne, normalise, value as mathValue } from "./maths/algebra";
import { boardMap, emit, nextLabel, recordBlock, save, touch, type ActiveQuestion, type Session, type Solution } from "./sessions";

export interface ToolDeps {
  readParams: (req: Request) => Record<string, unknown>;
  resolve: (id: unknown) => Session | null;
  NO_SESSION: Record<string, unknown>;
}

const str = (v: unknown, max = 600) => String(v ?? "").trim().slice(0, max);

// ---------- solutions ----------

function keepSolution(s: Session, sol: Solution) {
  s.solutions = [...s.solutions.filter((x) => x.id !== sol.id), sol].slice(-20);
}

function librarySolution(p: Problem): Solution {
  return {
    id: `sol_${p.id}`,
    problemId: p.id,
    question: p.statement,
    answer: p.answer,
    steps: p.steps.map((st) => ({ text: st.text, checked: Boolean(st.check) })),
    hints: p.hints,
    verified: "library",
    createdAt: Date.now(),
  };
}

/** How much of a solution is verified, in words the tutor can repeat honestly. */
export function verificationNote(sol: Solution): string {
  const checked = sol.steps.filter((x) => x.checked).length;
  switch (sol.verified) {
    case "library":
      return `From the checked problem library: the answer and ${checked} calculation step(s) are verified by the maths engine.`;
    case "exact":
      return `Solved by the maths engine: the answer is exact and ${checked} of ${sol.steps.length} line(s) are verified.`;
    case "substitution":
      return "A model proposed this; only the final answer was verified (by substituting it back). The steps are not verified.";
    default:
      return "Not verified: this kind of problem can't be checked automatically. Don't present it as checked.";
  }
}

const MODEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "steps", "hints"],
  properties: {
    answer: { type: "string" },
    steps: { type: "array", items: { type: "string" } },
    hints: { type: "array", items: { type: "string" } },
  },
};

/** For shapes the maths engine can't solve: a model's solution, labelled by what could be verified. */
async function modelSolution(s: Session, question: string): Promise<Solution | null> {
  if (!hasModel()) return null;
  chargeModelCall(s.deviceId, "solve");
  const r = await withModelSlot(() =>
    askJson<{ answer: string; steps: string[]; hints: string[] }>({
      system:
        "You solve one class 10 maths problem for a tutor. Plain-text maths (x^2, sqrt(3)), no LaTeX. answer: the final answer only (e.g. 'x = 2 or x = 3', '29'). steps: 2 to 6 short board lines. hints: exactly three, increasing help: a nudge question, the method, one worked step; none may contain the final answer.",
      effort: "medium",
      schema: MODEL_SCHEMA,
      attachments: [],
      text: `Problem: ${question}`,
    }),
  );
  // Verify by substitution where the problem is a single equation in one unknown.
  let verified: Solution["verified"] = "unverified";
  let answer: AnswerSpec | null = null;
  const eq = /([^:]*=[^:]*)$/.exec(normalise(question))?.[1];
  if (eq) {
    try {
      const roots = solveOne(eq);
      if (roots.kind === "roots") {
        const spec: AnswerSpec = { type: "roots", variable: roots.variable, values: roots.roots.map(String) };
        if (compareAnswer(spec, r.answer).verdict === "correct") {
          verified = "substitution";
          answer = spec;
        }
      }
    } catch {
      // not checkable
    }
  }
  if (!answer) {
    try {
      mathValue(r.answer.replace(/^[a-z_]+\s*=\s*/i, ""));
      answer = { type: "value", value: r.answer.replace(/^[a-z_]+\s*=\s*/i, "") };
    } catch {
      answer = null;
    }
  }
  const hints = [...r.hints, "", "", ""].slice(0, 3) as [string, string, string];
  return { id: `sol_${randomId(8)}`, problemId: null, question, answer, steps: r.steps.slice(0, 8).map((t) => ({ text: t.slice(0, 200), checked: false })), hints, verified, createdAt: Date.now() };
}

/** A worked solution for a question: library first, then the maths engine, then (labelled) a model. */
export async function solutionFor(s: Session, question: string, problemId?: string | null): Promise<Solution | null> {
  const lib = problemId ? libraryProblem(problemId) : PROBLEMS.find((p) => normalise(p.statement) === normalise(question));
  if (lib) return librarySolution(lib);
  const exact = solveFreeform(question);
  if (exact) {
    const allChecked = exact.steps.some((x) => x.checked);
    return { id: `sol_${randomId(8)}`, problemId: null, question, answer: exact.answer, steps: exact.steps, hints: exact.hints, verified: allChecked ? "exact" : "unverified", createdAt: Date.now() };
  }
  return modelSolution(s, question);
}

// ---------- putting a question on the board ----------

export function askQuestion(s: Session, p: Problem, kind: "practice" | "diagnostic" | "transfer"): ActiveQuestion {
  const questionId = newQuestionId();
  const sol = librarySolution(p);
  keepSolution(s, sol);
  s.problem = {
    id: questionId,
    text: p.statement,
    answer: describeAnswer(p.answer),
    answerSpec: p.answer,
    problemId: p.id,
    skill: p.skill,
    chapter: p.chapter,
    kind,
    askedAt: Date.now(),
    rung: 0,
    solutionId: sol.id,
  };
  if (!s.used.includes(p.id)) s.used.push(p.id);
  const label = nextLabel(s);
  recordBlock(s, { label, kind: kind === "diagnostic" ? "quick check" : "problem", summary: p.statement.slice(0, 120), lines: 1 });
  emit(s, { type: "problem", id: randomUUID(), label, problem: p.statement, questionId, kind });
  return s.problem;
}

function chapterOf(s: Session): ChapterId | null {
  const p = s.problem?.problemId ? libraryProblem(s.problem.problemId) : undefined;
  return p?.chapter ?? chapterForTopic(`${s.topic} ${s.study?.plan.topic ?? ""}`);
}

// ---------- the hint ladder ----------

const LEVELS = ["nudge", "hint", "step"] as const;

export function giveHint(s: Session): Record<string, unknown> {
  const q = s.problem;
  if (!q) return { ok: false, error: "There's no question on the board. Give one with next_problem or give_problem first." };
  if (q.solved) return { ok: false, error: "They've already solved this one. Use plan_next or next_problem." };
  const sol = s.solutions.find((x) => x.id === q.solutionId);
  if (!sol) return { ok: false, error: "No checked solution yet for this question. Call solve first (it prepares the hints)." };
  if (q.rung >= 3) return { ok: true, done: true, rung: 3, note: "All three hints are on the board. If they're still stuck, use show_solution (or give an easier example)." };
  const rung = q.rung + 1;
  const text = sol.hints[rung - 1] || (rung === 3 ? sol.steps[0]?.text : "") || "Look again at the question: what is it asking for?";
  q.rung = rung;
  const label = nextLabel(s);
  recordBlock(s, { label, kind: `hint ${rung}`, summary: text.slice(0, 120), lines: 1 });
  emit(s, { type: "hint", id: randomUUID(), label, questionId: q.id, level: LEVELS[rung - 1], rung, of: 3, text: text.slice(0, 400) });
  save(s);
  return {
    ok: true,
    rung,
    of: 3,
    level: LEVELS[rung - 1],
    label,
    hint: text,
    note: rung < 3 ? "Say it in your own words, then wait for them to try. Don't add more help yet." : "That's the last hint. Wait for them to try; if still stuck, show_solution.",
  };
}

/** The whole checked solution, written on the board. Only after the ladder, or when the student asks for it. */
export function showSolution(s: Session, studentAsked: boolean): Record<string, unknown> {
  const q = s.problem;
  if (!q) return { ok: false, error: "There's no question on the board." };
  const sol = s.solutions.find((x) => x.id === q.solutionId);
  if (!sol) return { ok: false, error: "No solution prepared. Call solve first." };
  if (q.rung < 3 && !studentAsked && !q.solved)
    return { ok: false, error: `Not yet: give the hints first (${q.rung} of 3 shown) so they can still solve it themselves. If the student asked to see the solution, call again with student_asked true.` };
  q.revealed = true;
  const fullyChecked = sol.verified === "library" || sol.verified === "exact";
  const label = nextLabel(s);
  recordBlock(s, { label, kind: "solution", summary: sol.steps.map((x) => x.text).join(" / ").slice(0, 120), lines: sol.steps.length });
  emit(s, { type: "steps", id: randomUUID(), label, title: "Solution", steps: sol.steps.map((x) => x.text).slice(0, 12), checked: fullyChecked });
  save(s);
  return { ok: true, label, verification: verificationNote(sol), note: "Walk through it line by line, then give a similar question with next_problem kind transfer so they can try one alone." };
}

// ---------- answers said aloud ----------

export function checkSpoken(s: Session, answer: string, source: "voice" | "phone" = "voice"): Record<string, unknown> {
  const q = s.problem;
  if (!q) return { ok: false, error: "There's no question to check against." };
  if (!q.answerSpec) return { ok: false, error: "This question has no checked answer. Use solve first, or look_at_board for written work." };
  const p = q.problemId ? libraryProblem(q.problemId) : undefined;
  const c = p ? checkAnswer(p, answer) : { ...compareAnswer(q.answerSpec, answer), misconceptions: [] as string[] };
  const outcome: Outcome = c.verdict === "correct" ? "correct" : c.verdict === "partial" ? "partial" : c.verdict === "unreadable" ? "unreadable" : "incorrect";
  if (outcome === "correct") q.solved = true;
  recordAttempt(
    s,
    attemptFor(s, {
      key: `${q.id}:said:${answer.toLowerCase().replace(/\s+/g, "")}`,
      source,
      outcome,
      answer,
      misconceptions: c.misconceptions.map((id) => ({ id, confidence: "high" as const, note: `Said "${answer}", exactly what this mistake gives.` })),
      note: c.detail,
    }),
  );
  if (s.diagnostic?.status === "running") noteDiagnostic(s, q.id, outcome);
  save(s);
  const m = c.misconceptions[0] ? misconception(c.misconceptions[0]) : undefined;
  return {
    ok: true,
    verdict: c.verdict,
    understood: c.got,
    detail: c.detail,
    misconception: m ? { id: m.id, name: m.name, remedy: m.remedy } : null,
    note:
      c.verdict === "correct"
        ? "Correct. Praise the method briefly, then plan_next."
        : c.verdict === "approximate"
          ? "Right value but rounded: ask for the exact form."
          : "Not right yet. Don't give the answer: use give_hint, or ask them to check one step.",
  };
}

// ---------- diagnostic ----------

export function startDiagnostic(s: Session, chapter: ChapterId | null): Record<string, unknown> {
  const ch = chapter ?? chapterOf(s);
  if (!ch) return { ok: false, error: "No checked questions for this topic yet. Ask a couple of questions yourself instead." };
  const set = diagnosticSet(ch);
  if (!set.length) return { ok: false, error: "No diagnostic questions for this topic." };
  s.diagnostic = { chapter: ch, items: [], status: "running", startSkill: null, startedAt: Date.now() };
  return nextDiagnostic(s);
}

/** Adapts: starts in the middle, goes harder after a right answer and easier after a wrong one; stops after 4. */
export function nextDiagnostic(s: Session): Record<string, unknown> {
  const d = s.diagnostic;
  if (!d || d.status !== "running") return { ok: false, error: "No quick check is running." };
  const set = diagnosticSet(d.chapter as ChapterId);
  const asked = new Set(d.items.map((i) => i.problemId));
  const last = d.items.at(-1);
  if (last?.outcome === "pending") return { ok: false, error: "The current quick-check question hasn't been answered yet. Use check_answer, look_at_board, or skip_question." };
  if (d.items.length >= Math.min(4, set.length)) return finishDiagnostic(s);
  const lastDiff = last ? (libraryProblem(last.problemId)?.difficulty ?? 2) : 2;
  const want = !last ? 1 : last.outcome === "correct" ? Math.min(3, lastDiff + 1) : Math.max(1, lastDiff - 1);
  const pool = set.filter((p) => !asked.has(p.id));
  if (!pool.length) return finishDiagnostic(s);
  const p = [...pool].sort((a, b) => Math.abs(a.difficulty - want) - Math.abs(b.difficulty - want))[0];
  const q = askQuestion(s, p, "diagnostic");
  d.items.push({ problemId: p.id, questionId: q.id, outcome: "pending" });
  save(s);
  return { ok: true, question: d.items.length, of: Math.min(4, set.length), problem: p.statement, note: "A quick check, not a test: ask them to try it alone (no hints), then check_answer or look_at_board. They can say 'skip'." };
}

export function noteDiagnostic(s: Session, questionId: string, outcome: Outcome) {
  const item = s.diagnostic?.items.find((i) => i.questionId === questionId);
  if (!item || item.outcome !== "pending") return;
  item.outcome = outcome === "correct" ? "correct" : outcome === "partial" ? "partial" : outcome === "unreadable" ? "unreadable" : outcome === "unanswered" || outcome === "skipped" ? "unanswered" : "incorrect";
}

function finishDiagnostic(s: Session): Record<string, unknown> {
  const d = s.diagnostic!;
  d.status = "done";
  // Start at the earliest skill (in teaching order) that wasn't answered correctly.
  const order = ["ap.common_difference", "ap.nth_term", "ap.general_term", "ap.find_n", "ap.sum", "lin.one_var", "lin.pair", "quad.expand", "quad.factorise", "quad.formula", "trig.ratios", "trig.values", "trig.identity"];
  const missed = d.items.filter((i) => i.outcome !== "correct").map((i) => libraryProblem(i.problemId)?.skill).filter((x): x is string => Boolean(x));
  d.startSkill = order.find((sk) => missed.includes(sk)) ?? null;
  save(s);
  const right = d.items.filter((i) => i.outcome === "correct").length;
  return {
    ok: true,
    done: true,
    right,
    of: d.items.length,
    unreadable: d.items.filter((i) => i.outcome === "unreadable").length,
    unanswered: d.items.filter((i) => i.outcome === "unanswered").length,
    start_with: d.startSkill ? skillById(d.startSkill)?.name : "the harder questions (they got everything right)",
    note: d.startSkill ? `Start teaching at: ${skillById(d.startSkill)?.name}. Tell them kindly what you'll work on.` : "They know the basics: move to transfer questions with next_problem kind transfer.",
  };
}

// ---------- the next move ----------

export type Move = "diagnostic_question" | "nudge" | "next_hint" | "explain_step" | "equivalent_example" | "transfer_question" | "follow_up_check" | "continue_lesson";

/**
 * Chooses the next teaching move from stored state, without a model call. In order:
 * a running diagnostic; the current question (stuck -> next rung; mistake with a known
 * misconception -> address it with an equivalent example; solved -> a fresh transfer question);
 * a due follow-up from the learner's record; otherwise carry on with the lesson.
 */
export function planNext(s: Session): { action: Move; reason: string; tool: string; args?: Record<string, unknown>; say_hint?: string } {
  if (s.diagnostic?.status === "running") {
    const pending = s.diagnostic.items.at(-1)?.outcome === "pending";
    return pending
      ? { action: "diagnostic_question", reason: "A quick-check question is waiting for an answer.", tool: "check_answer or look_at_board" }
      : { action: "diagnostic_question", reason: "The quick check isn't finished.", tool: "diagnostic", args: { action: "next" } };
  }
  const q = s.problem;
  const attempts = sessionAttempts(s.id).filter((a) => q && a.questionId === q.id);
  const last = attempts.at(-1);
  if (q && !q.solved) {
    if (last && (last.outcome === "incorrect" || last.outcome === "partial")) {
      const mc = last.misconceptions[0];
      if (mc && q.rung >= 1) {
        const m = misconception(mc.id);
        return { action: "equivalent_example", reason: `Their answer shows: ${m?.name}.`, tool: "write", say_hint: m?.remedy, args: { kind: "text" } };
      }
      return q.rung === 0
        ? { action: "nudge", reason: "First wrong try: a nudge, not the method.", tool: "give_hint" }
        : q.rung < 3
          ? { action: "next_hint", reason: `Still not right after ${q.rung} hint(s).`, tool: "give_hint" }
          : { action: "explain_step", reason: "All hints used and still stuck.", tool: "show_solution" };
    }
    if (last?.outcome === "unreadable") return { action: "nudge", reason: "The work couldn't be read: ask them to rewrite the unclear line bigger. This isn't a mistake.", tool: "none" };
    return { action: "nudge", reason: "They're working on it. Wait; give a nudge only if they ask or go quiet.", tool: "give_hint" };
  }
  if (q && q.solved) {
    const independent = last && last.hints === 0 && !last.revealed;
    return independent
      ? { action: "transfer_question", reason: "Solved alone: check it transfers to a fresh problem.", tool: "next_problem", args: { kind: "transfer", skill: q.skill } }
      : { action: "equivalent_example", reason: "Solved with help: give a similar one to try alone.", tool: "next_problem", args: { kind: "practice", skill: q.skill } };
  }
  const l = s.learnerId ? getLearner(s.learnerId) : null;
  if (l) {
    const all = learnerAttempts(l);
    const due = [...new Set(all.map((a) => a.skill).filter((x): x is string => Boolean(x)))].map((sk) => skillProgress(all, sk)).find((p) => p.followUpDue);
    if (due) {
      const next = suggestNext(all, [due]);
      return { action: "follow_up_check", reason: `Follow-up after an earlier mistake on ${due.name.toLowerCase()}.`, tool: "next_problem", args: next ? { problem_id: next.problemId } : { skill: due.skill } };
    }
  }
  return { action: "continue_lesson", reason: "Nothing pending: continue the lesson.", tool: s.study ? "show_section" : "write" };
}

// ---------- the board guard ----------

/**
 * True if writing these lines would hand over the answer to the question the student is working
 * on (before they've solved it, and before the solution was deliberately shown).
 */
// Number words a tutor might write instead of digits (English, Hindi in Roman script, Devanagari digits).
const NUMBER_WORDS: Record<string, number> = Object.fromEntries(
  [
    ["zero", "shunya"], ["one", "ek"], ["two", "do"], ["three", "teen"], ["four", "char", "chaar"], ["five", "paanch", "panch"],
    ["six", "chhe", "chhah", "che"], ["seven", "saat"], ["eight", "aath"], ["nine", "nau"], ["ten", "das"],
  ].flatMap((words, n) => words.map((w) => [w, n])),
);

/** Values written on their own in prose: "roots are 3 and 4", "x ∈ {3, 4}", "teen aur chaar" -> 3, 4. Not numbers inside expressions. */
function proseValues(text: string): string[] {
  const t = normalise(text).replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)));
  const out = [...t.matchAll(/(?<![\w^./*)])-?\d+(?:\.\d+)?(?:\/\d+)?(?![\w(^./*]|\s*[*/^(]|\s*[a-z]\b)/gi)].map((m) => m[0]);
  const minus = /\b(minus|negative|maainus|ऋण)\s+$/i;
  for (const m of t.toLowerCase().matchAll(/[a-z]+/g)) {
    const n = NUMBER_WORDS[m[0]];
    if (n !== undefined) out.push(minus.test(t.slice(0, m.index).toLowerCase()) ? String(-n) : String(n));
  }
  return out;
}

/** Roots stated by linear equations or factors in a write: "x - 3 = 0 or x - 4 = 0", "(x - 3)(x - 4) = 0". */
function statedRoots(lines: string[], spec: AnswerSpec): string[] {
  if (spec.type !== "roots") return [];
  const out: string[] = [];
  for (const line of lines)
    for (const part of normalise(line).split(/\bor\b|\band\b|,|;|\bso\b/i)) {
      if (!part.includes("=")) continue;
      try {
        const r = solveOne(part);
        if (r.kind !== "roots") continue;
        // A factored equation states every root; for a quadratic, "x - 3 = 0" states one. Other equations
        // (the question itself, or a linear question rearranged) don't count.
        const lhs = part.split("=")[0].replace(/\s+/g, "");
        const factored = /^-?[\w.]*(\([^()]+\))+$/.test(lhs) && /\(/.test(lhs);
        if (factored || (r.roots.length === 1 && spec.values.length > 1)) out.push(...r.roots.map((x) => x.toString()));
      } catch {
        // not an equation we can solve
      }
    }
  return out;
}

/**
 * True if these board lines would hand over the answer to the open question: the answer itself in
 * any order or spread over several lines, the roots in words, the factored form, or two lines of
 * the checked solution. Intermediate steps that are just the question rearranged ("2x = 8") are
 * allowed: they are what the third hint shows, and blocking them would block writing the question.
 */
export function revealsAnswer(s: Session, lines: string[]): boolean {
  const q = s.problem;
  if (!q || q.solved || q.revealed || !q.answerSpec) return false;
  const spec = q.answerSpec;
  const covers = (values: string[]) => {
    if (!values.length) return false;
    if (spec.type === "value") return values.some((v) => compareAnswer(spec, v).verdict === "correct");
    if (spec.type !== "roots") return false;
    return spec.values.every((want) => values.some((v) => compareAnswer({ type: "roots", variable: spec.variable, values: [want] }, v).verdict === "correct"));
  };
  for (const line of lines) {
    if (!/=|\bor\b/.test(line) && spec.type !== "value") continue;
    const parts = line.split("=");
    const rhs = parts[parts.length - 1];
    if (parts.length > 1 || spec.type === "value") {
      const v = compareAnswer(spec, spec.type === "roots" || spec.type === "pair" ? line : rhs);
      if (v.verdict === "correct") return true;
    }
  }
  // The answer spread over several lines: "x = 4 || x = 3".
  if (lines.length > 1 && (spec.type === "roots" || spec.type === "pair") && compareAnswer(spec, lines.join(", ")).verdict === "correct") return true;
  if (covers(statedRoots(lines, spec))) return true;
  // Values in prose only: a line with maths in it ("Evaluate: 2 tan^2 45° + ...") isn't a statement of the answer.
  const prose = (l: string) => !/[=+*/^×÷]|\b(sin|cos|tan|sec|cosec|cot|sqrt)\b/i.test(l);
  if (covers(lines.filter(prose).flatMap(proseValues))) return true;
  const sol = s.solutions.find((x) => x.id === q.solutionId);
  if (sol) {
    const norm = (t: string) => normalise(t).replace(/\s+/g, "").toLowerCase();
    const solLines = new Set(sol.steps.map((x) => norm(x.text)));
    if (lines.filter((l) => solLines.has(norm(l))).length >= 2) return true;
  }
  return false;
}

// ---------- tools ----------

export function teachingTools(router: Router, deps: ToolDeps) {
  const { readParams, resolve, NO_SESSION } = deps;
  const withSession = (fn: (s: Session, p: Record<string, unknown>) => unknown) => async (req: Request, res: Response) => {
    const p = readParams(req);
    const s = resolve(p.session_code);
    if (!s) return void res.json(NO_SESSION);
    touch(s);
    try {
      res.json(await fn(s, p));
    } catch (err) {
      const e = err as Error;
      console.error("[teaching]", e.message);
      res.json({ ok: false, error: e.name === "QuotaError" || e.name === "BusyError" ? e.message : "That didn't work just now. Carry on teaching without it." });
    }
  };

  router.all(
    "/next_problem",
    withSession((s, p) => {
      const kind = (["practice", "transfer", "diagnostic"].includes(str(p.kind)) ? str(p.kind) : "practice") as "practice" | "transfer" | "diagnostic";
      const pid = str(p.problem_id, 40);
      const chosen =
        (pid && libraryProblem(pid)) ||
        pickProblem({ chapter: chapterOf(s), skill: str(p.skill, 40) || s.problem?.skill || null, kind: kind as Kind, exclude: s.used }) ||
        pickProblem({ chapter: chapterOf(s), kind: kind as Kind, exclude: s.used }) ||
        pickProblem({ chapter: chapterOf(s), exclude: s.used });
      if (!chosen) return { ok: false, error: "No more checked problems for this topic. Make one up with give_problem, then call solve." };
      askQuestion(s, chosen, kind);
      return {
        ok: true,
        problem: chosen.statement,
        kind,
        skill: skillById(chosen.skill)?.name,
        note: `It's on the board. A checked solution is ready (don't say the answer). Ask them to solve it below, one step per line, and press Done. Use give_hint if they're stuck.${kind === "transfer" ? " This is a fresh question to see if they can do it alone: no hints unless they ask." : ""}`,
      };
    }),
  );

  router.all(
    "/solve",
    withSession(async (s, p) => {
      const pid = str(p.problem_id, 40) || null;
      const question = str(p.problem) || (pid ? libraryProblem(pid)?.statement : "") || s.problem?.text || "";
      if (!question) return { ok: false, error: "Which problem? Pass problem (the text) or problem_id." };
      const sol = await solutionFor(s, question, pid ?? (s.problem && question === s.problem.text ? s.problem.problemId : null));
      if (!sol) return { ok: false, error: "Can't solve or check this one automatically. Work it out carefully yourself and don't call it checked." };
      keepSolution(s, sol);
      // Link it to the question on the board if it's the same one.
      if (s.problem && normalise(s.problem.text) === normalise(question)) {
        s.problem.solutionId = sol.id;
        if (sol.answer && (sol.verified === "library" || sol.verified === "exact" || sol.verified === "substitution")) {
          s.problem.answerSpec = sol.answer;
          s.problem.answer = describeAnswer(sol.answer);
        }
      }
      save(s);
      return {
        ok: true,
        solution_id: sol.id,
        verified: sol.verified,
        verification: verificationNote(sol),
        answer_for_you_only: sol.answer ? describeAnswer(sol.answer) : null,
        steps: sol.steps,
        hints_ready: 3,
        note: "This is for you, not to read out. Never say the final answer before they've tried: use give_hint for help one rung at a time. Board lines that would give the answer away will be refused.",
      };
    }),
  );

  router.all(
    "/give_hint",
    withSession(async (s) => {
      // A tutor-made question gets a solution (and hints) on first use.
      if (s.problem && !s.problem.solutionId) {
        const sol = await solutionFor(s, s.problem.text, s.problem.problemId);
        if (sol) {
          keepSolution(s, sol);
          s.problem.solutionId = sol.id;
          if (sol.answer && sol.verified !== "unverified") s.problem.answerSpec = sol.answer;
        }
      }
      return giveHint(s);
    }),
  );

  router.all(
    "/show_solution",
    withSession((s, p) => showSolution(s, /^(true|1|yes)$/i.test(str(p.student_asked)))),
  );

  router.all(
    "/check_answer",
    withSession((s, p) => {
      const answer = str(p.answer, 200);
      if (!answer) return { ok: false, error: "Pass the answer the student said, e.g. answer: 'x = 3 or 4'." };
      return checkSpoken(s, answer);
    }),
  );

  router.all(
    "/skip_question",
    withSession((s) => {
      const q = s.problem;
      if (!q) return { ok: false, error: "Nothing to skip." };
      recordAttempt(s, attemptFor(s, { key: `${q.id}:skipped`, source: "voice", outcome: s.diagnostic?.status === "running" ? "unanswered" : "skipped", note: "Skipped" }));
      if (s.diagnostic?.status === "running") {
        noteDiagnostic(s, q.id, "unanswered");
        return nextDiagnostic(s);
      }
      q.solved = true;
      save(s);
      return { ok: true, note: "Skipped. Use plan_next or next_problem." };
    }),
  );

  router.all(
    "/diagnostic",
    withSession((s, p) => {
      const action = str(p.action) || "start";
      if (action === "skip") {
        if (s.diagnostic?.status === "running") s.diagnostic.status = "skipped";
        save(s);
        return { ok: true, note: "Quick check skipped. Start teaching from the beginning of the topic." };
      }
      if (action === "next" || (action === "start" && s.diagnostic?.status === "running")) return nextDiagnostic(s);
      return startDiagnostic(s, (["ap", "quadratic", "linear", "trig"].includes(str(p.chapter)) ? str(p.chapter) : null) as ChapterId | null);
    }),
  );

  router.all(
    "/plan_next",
    withSession((s) => {
      const move = planNext(s);
      return { ok: true, ...move, board: boardMap(s, 5) };
    }),
  );
}

/** For the browser: a short public view of a diagnostic (no answers). */
export function publicDiagnostic(s: Session) {
  const d = s.diagnostic;
  if (!d) return null;
  return { chapter: d.chapter, status: d.status, asked: d.items.length, right: d.items.filter((i) => i.outcome === "correct").length, startSkill: d.startSkill ? skillById(d.startSkill)?.name : null };
}

/** After the handwriting reader has marked the student's work: record it, and move the question on. */
export function afterReview(s: Session, capture: { questionId: string | null; hash: string }, result: { status: string; line: number | null; final_answer?: string | null; what_went_wrong: string; misconceptions?: { id: string; confidence: "high" | "medium"; note: string }[] }) {
  const q = s.problem;
  if (!q || capture.questionId !== q.id) return;
  const outcome: Outcome | null =
    result.status === "correct" ? "correct" : result.status === "mistake" ? "incorrect" : result.status === "incomplete" ? "incomplete" : result.status === "unreadable" ? "unreadable" : null;
  if (!outcome) return;
  recordAttempt(s, attemptFor(s, { key: `${q.id}:${capture.hash}`, source: "board", outcome, line: result.line, answer: result.final_answer ?? null, misconceptions: result.misconceptions ?? [], note: result.what_went_wrong }));
  if (outcome === "correct") q.solved = true;
  if (s.diagnostic?.status === "running") noteDiagnostic(s, q.id, outcome);
  save(s);
}
