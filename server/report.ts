// The end-of-class report, built only from what was recorded in the class: the board (what was
// covered) and the attempts (what was tried, with how much help). No praise or mastery is
// invented: a class with little recorded work says exactly that. The same inputs always give the
// same report (it is cached by a hash of its inputs and rebuilt when they change).

import { createHash } from "node:crypto";
import { CHAPTER_NAMES } from "./curriculum/library";
import { misconception } from "./curriculum/misconceptions";
import type { ChapterId } from "./curriculum/types";
import { getLearner, independent, learnerAttempts, sessionAttempts, skillProgress, suggestNext, type Attempt } from "./learners";
import type { Session } from "./sessions";
import { store } from "./store";

export interface ProblemLine {
  question: string;
  result: "solved alone" | "solved with hints" | "solved after seeing the solution" | "not solved yet" | "skipped" | "couldn't be read";
  hints: number;
  tries: number;
  mistakes: string[];
  corrected: boolean;
}

export interface SessionReport {
  version: string;
  sessionId: string;
  learnerName: string | null;
  topic: string;
  date: number;
  minutes: number | null;
  covered: string[];
  problems: ProblemLine[];
  counts: { attempted: number; solvedAlone: number; solvedWithHelp: number; notSolved: number; hints: number };
  mistakesCorrected: { mistake: string; question: string }[];
  needsPractice: string[];
  next: string;
  /** True when too little was recorded to say much. */
  sparse: boolean;
  note: string;
  generatedAt: number;
}

function covered(s: Session): string[] {
  const out: string[] = [];
  for (const b of s.board.blocks) {
    if (b.type === "steps" && b.title && b.title !== "Solution") out.push(b.title);
    if (b.type === "write" && b.style === "heading") out.push(b.lines.join(" "));
  }
  if (s.study) for (let i = 0; i < s.study.section; i++) out.push(s.study.plan.sections[i].title);
  return [...new Set(out.map((x) => x.trim()).filter(Boolean))].slice(0, 8);
}

function lineFor(atts: Attempt[]): ProblemLine {
  const final = atts.at(-1)!;
  const correct = atts.find((a) => a.outcome === "correct");
  const mistakes = [...new Set(atts.flatMap((a) => a.misconceptions.map((m) => misconception(m.id)?.name ?? m.id)))];
  const wrongFirst = atts.some((a) => a.outcome === "incorrect" || a.outcome === "partial");
  const result: ProblemLine["result"] = correct
    ? correct.revealed
      ? "solved after seeing the solution"
      : independent(correct)
        ? "solved alone"
        : "solved with hints"
    : final.outcome === "skipped" || final.outcome === "unanswered"
      ? "skipped"
      : atts.every((a) => a.outcome === "unreadable")
        ? "couldn't be read"
        : "not solved yet";
  return { question: final.questionText, result, hints: Math.max(...atts.map((a) => a.hints)), tries: atts.filter((a) => a.outcome !== "skipped").length, mistakes, corrected: Boolean(correct && wrongFirst) };
}

export function buildReport(s: Session): SessionReport {
  const atts = sessionAttempts(s.id);
  const byQ = new Map<string, Attempt[]>();
  for (const a of atts) byQ.set(a.questionId, [...(byQ.get(a.questionId) ?? []), a]);
  const problems = [...byQ.values()].map(lineFor);
  const learner = s.learnerId ? getLearner(s.learnerId) : null;
  const minutes = s.calls.length ? Math.round(s.calls.reduce((m, c) => m + ((c.endedAt ?? c.startedAt) - c.startedAt), 0) / 60000) : null;
  const skills = [...new Set(atts.map((a) => a.skill).filter((x): x is string => Boolean(x)))];
  const progress = skills.map((sk) => skillProgress(atts, sk));
  const needsPractice = progress.filter((p) => p.status === "learning" || p.followUpDue).map((p) => p.name);
  const all = learner ? learnerAttempts(learner) : atts;
  const next = suggestNext(all, skills.map((sk) => skillProgress(all, sk)));
  const counts = {
    attempted: problems.filter((p) => p.result !== "skipped").length,
    solvedAlone: problems.filter((p) => p.result === "solved alone").length,
    solvedWithHelp: problems.filter((p) => p.result === "solved with hints" || p.result === "solved after seeing the solution").length,
    notSolved: problems.filter((p) => p.result === "not solved yet" || p.result === "couldn't be read").length,
    hints: problems.reduce((n, p) => n + p.hints, 0),
  };
  const mistakesCorrected = problems.filter((p) => p.corrected).map((p) => ({ mistake: p.mistakes[0] ?? "a slip", question: p.question }));
  const topic = s.topic || (s.study?.plan.topic ?? "") || (atts[0]?.chapter ? CHAPTER_NAMES[atts[0].chapter as ChapterId] : "Maths");
  const sparse = atts.filter((a) => a.outcome !== "skipped").length === 0;
  const report: Omit<SessionReport, "version" | "generatedAt"> = {
    sessionId: s.id,
    learnerName: learner?.name ?? (s.studentName || null),
    topic,
    date: s.lastActive,
    minutes,
    covered: covered(s),
    problems,
    counts,
    mistakesCorrected,
    needsPractice,
    next: next ? `${next.statement} (${next.why.replace(/\.$/, "")})` : sparse ? "Try a practice question next time so there's work to look at." : counts.solvedAlone && !needsPractice.length ? "A harder or fresh question on the same topic." : "Another practice question on the same skill.",
    sparse,
    note: sparse
      ? "No answers were checked in this class yet, so there's nothing to report on how it went. This is not a judgement."
      : `Based on ${atts.length} recorded attempt${atts.length === 1 ? "" : "s"} in this class. Practice feedback, not an exam result.`,
  };
  const version = createHash("sha1").update(JSON.stringify(report)).digest("hex").slice(0, 16);
  return { ...report, version, generatedAt: Date.now() };
}

/** The report for a session, rebuilt only when what it's based on has changed. */
export function reportFor(s: Session): SessionReport {
  const fresh = buildReport(s);
  const saved = store.get<SessionReport>("reports", s.id);
  if (saved && saved.version === fresh.version) return saved;
  store.put("reports", s.id, fresh);
  return fresh;
}

