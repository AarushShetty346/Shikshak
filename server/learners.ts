// Learners, what they attempted, and what we can honestly say about them.
//
// A learner belongs to one device and can have many class sessions; several learners can share a
// device without their histories mixing. Everything we "know" about a learner is derived from
// recorded attempts (the evidence), never invented: memory, mastery, misconceptions and the next
// suggested exercise are all recomputed from attempts, so recomputing twice gives the same result.

import { getDevice, randomId, updateDevice } from "./auth";
import { config } from "./config";
import { CHAPTER_NAMES, problem, PROBLEMS, skill as skillById, SKILLS } from "./curriculum/library";
import { misconception } from "./curriculum/misconceptions";
import type { ChapterId, Problem } from "./curriculum/types";
import { isLanguage, type Language } from "../shared/types";
import type { Session } from "./sessions";
import { store } from "./store";

// ---------- learners ----------

export interface Learner {
  id: string;
  deviceId: string;
  name: string;
  grade: string;
  language: Language;
  /** IANA time zone for streaks and phone call windows. */
  timezone: string;
  createdAt: number;
  updatedAt: number;
  sessions: string[];
  /** Misconceptions the student (or a teacher) said were wrongly inferred. */
  rejectedMisconceptions: { id: string; at: number }[];
  /** Streak bookkeeping (Phase 9): learning days in the learner's own time zone. */
  activeDays: string[];
  /** Phone revision calls with recorded answers (their attempt logs are "ph_<callId>"). */
  phoneCalls?: string[];
}

export class LearnerError extends Error {
  override name = "LearnerError";
}

const validTz = (tz: unknown): string => {
  try {
    if (typeof tz === "string" && tz) {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz;
    }
  } catch {
    // fall through
  }
  return "Asia/Kolkata";
};

export function createLearner(deviceId: string, input: { name?: unknown; grade?: unknown; language?: unknown; timezone?: unknown }): Learner {
  const mine = getDevice(deviceId)?.learners ?? [];
  if (mine.length >= config.limits.maxLearnersPerOwner()) throw new LearnerError(`This device already has ${mine.length} learners.`);
  const name = String(input.name ?? "").trim().slice(0, 40);
  if (!name) throw new LearnerError("Give the learner a name (or a nickname).");
  const l: Learner = {
    id: `l_${randomId(12)}`,
    deviceId,
    name,
    grade: /^(8|9|10|11|12)$/.test(String(input.grade)) ? String(input.grade) : "10",
    language: isLanguage(input.language) ? input.language : "hinglish",
    timezone: validTz(input.timezone),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessions: [],
    rejectedMisconceptions: [],
    activeDays: [],
  };
  store.put("learners", l.id, l, { immediate: true });
  updateDevice(deviceId, (d) => (d.learners = [...(d.learners ?? []), l.id]));
  return l;
}

export function getLearner(id: unknown): Learner | null {
  const key = String(id ?? "");
  if (!/^l_[A-Za-z0-9_-]{8,30}$/.test(key)) return null;
  return store.get<Learner>("learners", key) ?? null;
}

export function learnerForDevice(id: unknown, deviceId: string): Learner | null {
  const l = getLearner(id);
  return l && l.deviceId === deviceId ? l : null;
}

export function listLearners(deviceId: string): Learner[] {
  return (getDevice(deviceId)?.learners ?? []).map((id) => getLearner(id)).filter((l): l is Learner => Boolean(l));
}

export function saveLearner(l: Learner) {
  l.updatedAt = Date.now();
  store.put("learners", l.id, l);
}

export function updateLearner(l: Learner, patch: { name?: unknown; grade?: unknown; language?: unknown; timezone?: unknown }) {
  if (typeof patch.name === "string" && patch.name.trim()) l.name = patch.name.trim().slice(0, 40);
  if (/^(8|9|10|11|12)$/.test(String(patch.grade))) l.grade = String(patch.grade);
  if (isLanguage(patch.language)) l.language = patch.language;
  if (patch.timezone !== undefined) l.timezone = validTz(patch.timezone);
  saveLearner(l);
}

/** Links a session to its learner (both sides). */
export function attachSession(l: Learner, sessionId: string) {
  if (!l.sessions.includes(sessionId)) l.sessions.push(sessionId);
  saveLearner(l);
}

/** Forgets everything recorded about a learner (attempts, memory) but keeps the profile. */
export function resetLearnerMemory(l: Learner) {
  for (const sid of logIds(l)) store.delete("attempts", sid);
  l.phoneCalls = [];
  l.rejectedMisconceptions = [];
  l.activeDays = [];
  saveLearner(l);
}

/** Deletes the learner and their records. Their sessions stay on the device but are unlinked. */
export function deleteLearner(l: Learner, unlink: (sessionId: string) => void) {
  for (const id of l.phoneCalls ?? []) store.delete("attempts", id);
  for (const sid of l.sessions) {
    store.delete("attempts", sid);
    unlink(sid);
  }
  store.delete("learners", l.id);
  updateDevice(l.deviceId, (d) => (d.learners = (d.learners ?? []).filter((x) => x !== l.id)));
}

// ---------- attempts: the evidence ----------

export type Outcome = "correct" | "incorrect" | "partial" | "incomplete" | "unreadable" | "unanswered" | "skipped";

export interface MisconceptionEvidence {
  id: string;
  /** high: the final answer is exactly what this mistake produces. medium: the handwriting reader suggested it. */
  confidence: "high" | "medium";
  note: string;
}

export interface Attempt {
  /** Unique per question + submission, so recording the same thing twice changes nothing. */
  key: string;
  sessionId: string;
  learnerId: string | null;
  questionId: string;
  problemId: string | null;
  questionText: string;
  skill: string | null;
  chapter: ChapterId | null;
  kind: "practice" | "diagnostic" | "transfer" | "tutor";
  source: "board" | "voice" | "diagnostic" | "phone";
  at: number;
  outcome: Outcome;
  /** Hint rungs shown before this attempt. */
  hints: number;
  /** The full solution was shown before this attempt. */
  revealed: boolean;
  line: number | null;
  answer: string | null;
  misconceptions: MisconceptionEvidence[];
  note: string;
}

export const independent = (a: Attempt) => a.hints === 0 && !a.revealed;

interface AttemptLog {
  sessionId: string;
  learnerId: string | null;
  items: Attempt[];
}

const MAX_ATTEMPTS_PER_SESSION = 300;

export function sessionAttempts(sessionId: string): Attempt[] {
  return store.get<AttemptLog>("attempts", sessionId)?.items ?? [];
}

/** Records an attempt once (by key). Returns false if it was already recorded. */
export function recordAttempt(s: Session, a: Omit<Attempt, "sessionId" | "learnerId" | "at"> & { at?: number }): boolean {
  const log = store.get<AttemptLog>("attempts", s.id) ?? { sessionId: s.id, learnerId: s.learnerId, items: [] };
  if (log.items.some((x) => x.key === a.key)) return false;
  log.learnerId = s.learnerId;
  log.items.push({ ...a, sessionId: s.id, learnerId: s.learnerId, at: a.at ?? Date.now() });
  if (log.items.length > MAX_ATTEMPTS_PER_SESSION) log.items.splice(0, log.items.length - MAX_ATTEMPTS_PER_SESSION);
  store.put("attempts", s.id, log);
  const l = s.learnerId ? getLearner(s.learnerId) : null;
  if (l && a.outcome !== "skipped") markActiveDay(l, a.at ?? Date.now());
  return true;
}

const logIds = (l: Learner) => [...l.sessions, ...(l.phoneCalls ?? [])];

/** All attempts of a learner across their sessions and phone calls, oldest first. */
export function learnerAttempts(l: Learner): Attempt[] {
  return logIds(l).flatMap((sid) => sessionAttempts(sid)).sort((a, b) => a.at - b.at);
}

/** Records a keypad answer from a phone revision call (once per key). */
export function recordPhoneAttempt(
  l: Learner,
  callId: string,
  a: { key: string; problem: Problem; outcome: "correct" | "incorrect"; answer: string; misconceptions: string[]; at: number },
): boolean {
  const id = `ph_${callId}`;
  const log = store.get<AttemptLog>("attempts", id) ?? { sessionId: id, learnerId: l.id, items: [] };
  if (log.items.some((x) => x.key === a.key)) return false;
  log.items.push({
    key: a.key,
    sessionId: id,
    learnerId: l.id,
    questionId: a.key,
    problemId: a.problem.id,
    questionText: a.problem.statement.slice(0, 200),
    skill: a.problem.skill,
    chapter: a.problem.chapter,
    kind: "practice",
    source: "phone",
    at: a.at,
    outcome: a.outcome,
    hints: 0,
    revealed: false,
    line: null,
    answer: a.answer,
    misconceptions: a.misconceptions.map((m) => ({ id: m, confidence: "high", note: "The keypad answer is exactly what this mistake produces." })),
    note: "Phone revision call (keypad)",
  });
  store.put("attempts", id, log);
  if (!(l.phoneCalls ?? []).includes(id)) l.phoneCalls = [...(l.phoneCalls ?? []), id].slice(-60);
  markActiveDay(l, a.at);
  saveLearner(l);
  return true;
}

/** Fills in the question details for an attempt on the current question. */
export function attemptFor(s: Session, a: { key: string; source: Attempt["source"]; outcome: Outcome; line?: number | null; answer?: string | null; misconceptions?: MisconceptionEvidence[]; note?: string }): Omit<Attempt, "sessionId" | "learnerId" | "at"> {
  const q = s.problem!;
  const p = q.problemId ? problem(q.problemId) : undefined;
  return {
    key: a.key,
    questionId: q.id,
    problemId: q.problemId ?? null,
    questionText: q.text.slice(0, 200),
    skill: p?.skill ?? q.skill ?? null,
    chapter: (p?.chapter ?? q.chapter ?? null) as ChapterId | null,
    kind: q.kind,
    source: a.source,
    outcome: a.outcome,
    hints: q.rung,
    revealed: Boolean(q.revealed),
    line: a.line ?? null,
    answer: a.answer ?? null,
    // Unreadable work never counts as a misconception.
    misconceptions: a.outcome === "unreadable" ? [] : (a.misconceptions ?? []),
    note: (a.note ?? "").slice(0, 200),
  };
}

// ---------- mastery: explicit, evidence-based rules ----------

export type SkillStatus = "not_started" | "learning" | "practising" | "secure";

export interface SkillProgress {
  skill: string;
  name: string;
  chapter: ChapterId;
  status: SkillStatus;
  attempts: number;
  independentCorrect: number;
  correctWithHelp: number;
  transferCorrect: number;
  mistakes: number;
  /** A mistake was seen and no independent correct answer on this skill has come since. */
  followUpDue: boolean;
  /** Why the status is what it is, in plain words. */
  because: string;
  lastAt: number | null;
}

/**
 * The rules, in order:
 *  - not started: no attempts.
 *  - learning: attempted, but never solved one alone (without hints or a shown solution).
 *  - practising: solved at least one alone, but not yet secure; also after a new mistake.
 *  - secure: at least two different problems solved alone, at least one of them a fresh transfer
 *    question, and the latest attempt on the skill was correct. One right answer, or answers
 *    reached with hints, never count as secure.
 */
export function skillProgress(attempts: Attempt[], skillId: string): SkillProgress {
  const sk = skillById(skillId);
  const mine = attempts.filter((a) => a.skill === skillId && a.outcome !== "skipped");
  const solvedAlone = mine.filter((a) => a.outcome === "correct" && independent(a));
  const distinctAlone = new Set(solvedAlone.map((a) => a.problemId ?? a.questionId));
  const transfer = solvedAlone.filter((a) => a.kind === "transfer");
  const mistakes = mine.filter((a) => a.outcome === "incorrect" || a.outcome === "partial");
  const last = mine.at(-1);
  const lastMistake = mistakes.at(-1);
  const followUpDue = Boolean(lastMistake && !solvedAlone.some((a) => a.at > lastMistake.at));
  let status: SkillStatus;
  let because: string;
  if (!mine.length) {
    status = "not_started";
    because = "No attempts yet.";
  } else if (!solvedAlone.length) {
    status = "learning";
    because = mine.some((a) => a.outcome === "correct") ? "Solved only with hints or a shown solution so far." : "Not solved yet.";
  } else if (distinctAlone.size >= 2 && transfer.length >= 1 && last?.outcome === "correct" && !followUpDue) {
    status = "secure";
    because = `Solved ${distinctAlone.size} different problems alone, including a new one.`;
  } else {
    status = "practising";
    because = followUpDue
      ? "Had a mistake recently; needs one more solved alone."
      : distinctAlone.size < 2
        ? "Solved one alone; needs another, different one."
        : "Needs a fresh (transfer) question solved alone.";
  }
  return {
    skill: skillId,
    name: sk?.name ?? skillId,
    chapter: (sk?.chapter ?? "ap") as ChapterId,
    status,
    attempts: mine.length,
    independentCorrect: solvedAlone.length,
    correctWithHelp: mine.filter((a) => a.outcome === "correct" && !independent(a)).length,
    transferCorrect: transfer.length,
    mistakes: mistakes.length,
    followUpDue,
    because,
    lastAt: last?.at ?? null,
  };
}

export interface MisconceptionSummary {
  id: string;
  name: string;
  remedy: string;
  count: number;
  confidence: "high" | "medium";
  lastAt: number;
  examples: string[];
  /** Answered correctly (alone, same skill) since it was last seen. */
  resolved: boolean;
}

export function misconceptionSummary(attempts: Attempt[], rejected: { id: string }[] = []): MisconceptionSummary[] {
  const out = new Map<string, MisconceptionSummary>();
  for (const a of attempts) {
    for (const m of a.misconceptions) {
      if (rejected.some((r) => r.id === m.id)) continue;
      const def = misconception(m.id);
      if (!def) continue;
      const cur = out.get(m.id) ?? { id: m.id, name: def.name, remedy: def.remedy, count: 0, confidence: m.confidence, lastAt: 0, examples: [], resolved: false };
      cur.count++;
      if (m.confidence === "high") cur.confidence = "high";
      cur.lastAt = Math.max(cur.lastAt, a.at);
      if (cur.examples.length < 3) cur.examples.push(a.questionText);
      out.set(m.id, cur);
    }
  }
  for (const s of out.values()) {
    const skillsHit = new Set(attempts.filter((a) => a.misconceptions.some((m) => m.id === s.id)).map((a) => a.skill));
    s.resolved = attempts.some((a) => a.at > s.lastAt && a.outcome === "correct" && independent(a) && skillsHit.has(a.skill));
  }
  return [...out.values()].sort((a, b) => b.lastAt - a.lastAt);
}

// ---------- memory ----------

export interface Memory {
  topics: { chapter: ChapterId; name: string; lastAt: number; attempts: number }[];
  strengths: { skill: string; name: string; because: string }[];
  needsPractice: { skill: string; name: string; because: string }[];
  mistakes: MisconceptionSummary[];
  checkpoint: { sessionId: string; topic: string; at: number } | null;
  next: { problemId: string; statement: string; why: string } | null;
  progress: SkillProgress[];
  evidenceCount: number;
}

/** Everything we can honestly say about a learner, derived only from their recorded attempts. */
export function memoryOf(l: Learner, lookupSession: (id: string) => { id: string; topic: string; lastActive: number } | null): Memory {
  const attempts = learnerAttempts(l);
  const progress = SKILLS.map((s) => skillProgress(attempts, s.id)).filter((p) => p.attempts > 0);
  const chapters = new Map<ChapterId, { lastAt: number; attempts: number }>();
  for (const a of attempts) {
    if (!a.chapter) continue;
    const c = chapters.get(a.chapter) ?? { lastAt: 0, attempts: 0 };
    c.lastAt = Math.max(c.lastAt, a.at);
    c.attempts++;
    chapters.set(a.chapter, c);
  }
  const mistakes = misconceptionSummary(attempts, l.rejectedMisconceptions);
  const sessions = l.sessions.map(lookupSession).filter((x): x is { id: string; topic: string; lastActive: number } => Boolean(x));
  const lastSession = sessions.sort((a, b) => b.lastActive - a.lastActive)[0];
  return {
    topics: [...chapters].map(([chapter, c]) => ({ chapter, name: CHAPTER_NAMES[chapter], ...c })).sort((a, b) => b.lastAt - a.lastAt),
    strengths: progress.filter((p) => p.status === "secure" || (p.status === "practising" && !p.followUpDue)).map((p) => ({ skill: p.skill, name: p.name, because: p.because })),
    needsPractice: progress.filter((p) => p.status === "learning" || p.followUpDue).map((p) => ({ skill: p.skill, name: p.name, because: p.because })),
    mistakes,
    checkpoint: lastSession ? { sessionId: lastSession.id, topic: lastSession.topic, at: lastSession.lastActive } : null,
    next: suggestNext(attempts, progress),
    progress,
    evidenceCount: attempts.length,
  };
}

/** The next exercise: a follow-up on the latest unresolved mistake, else practice on the weakest started skill. */
export function suggestNext(attempts: Attempt[], progress: SkillProgress[]): Memory["next"] {
  const used = new Set(attempts.map((a) => a.problemId).filter(Boolean));
  const follow = progress.filter((p) => p.followUpDue).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0];
  const target = follow ?? progress.find((p) => p.status === "learning") ?? progress.find((p) => p.status === "practising");
  if (!target) return null;
  const kind = target.status === "practising" && !target.followUpDue ? "transfer" : "practice";
  const p =
    PROBLEMS.find((x) => x.skill === target.skill && x.kinds.includes(kind) && !used.has(x.id)) ??
    PROBLEMS.find((x) => x.skill === target.skill && !used.has(x.id));
  if (!p) return null;
  return {
    problemId: p.id,
    statement: p.statement,
    why: target.followUpDue ? `A follow-up check after a recent mistake (${target.name})` : `${target.name}: ${target.because.replace(/\.$/, "")}`,
  };
}

const day = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/**
 * A short memory note for the next voice call. Every sentence is backed by recorded attempts; with
 * no evidence it says so, so the tutor never claims to remember something that didn't happen.
 */
export function memoryForCall(s: Session): string {
  const l = s.learnerId ? getLearner(s.learnerId) : null;
  if (!l) return "";
  const m = memoryOf(l, (id) => (id === s.id ? null : lookupSessionSummary(id)));
  if (!m.evidenceCount) return `${l.name} has no recorded work yet. Don't claim to remember anything; this is your first time seeing their work.`;
  const parts: string[] = [];
  const open = m.mistakes.filter((x) => !x.resolved).slice(0, 2);
  for (const x of open) parts.push(`Observed mistake (${x.count}×, last on ${day(x.lastAt)}): ${x.name}. Example question: "${x.examples[0]}". Remedy: ${x.remedy}`);
  for (const sgl of m.strengths.slice(0, 2)) parts.push(`Strength: ${sgl.name} (${sgl.because})`);
  for (const np of m.needsPractice.slice(0, 2)) parts.push(`Needs practice: ${np.name} (${np.because})`);
  if (m.next) parts.push(`Suggested next exercise (use next_problem with problem_id ${m.next.problemId}): ${m.next.why}`);
  return `What we have on record for ${l.name} (only say "last time..." about these):\n- ${parts.join("\n- ")}`.slice(0, 1400);
}

let lookupSessionSummary: (id: string) => { id: string; topic: string; lastActive: number } | null = () => null;
/** Wired by app.ts to avoid an import cycle with sessions.ts. */
export function setSessionLookup(fn: typeof lookupSessionSummary) {
  lookupSessionSummary = fn;
}

// ---------- streaks (Phase 9): meaningful learning days in the learner's time zone ----------

export function localDay(t: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}

function markActiveDay(l: Learner, t: number) {
  const d = localDay(t, l.timezone);
  if (l.activeDays.includes(d)) return; // repeated callbacks on the same day count once
  l.activeDays = [...l.activeDays, d].sort().slice(-400);
  saveLearner(l);
}

/** Current streak of consecutive learning days ending today or yesterday (a missed day just restarts it). */
export function streakOf(l: Learner, now = Date.now()): { current: number; best: number; today: boolean } {
  const days = new Set(l.activeDays);
  const today = localDay(now, l.timezone);
  const prev = (d: string) => {
    const t = new Date(`${d}T12:00:00Z`).getTime() - 86_400_000;
    return new Date(t).toISOString().slice(0, 10);
  };
  let start = days.has(today) ? today : prev(today);
  let current = 0;
  while (days.has(start)) {
    current++;
    start = prev(start);
  }
  let best = 0;
  let run = 0;
  let last: string | null = null;
  for (const d of [...days].sort()) {
    run = last && prev(d) === last ? run + 1 : 1;
    best = Math.max(best, run);
    last = d;
  }
  return { current, best, today: days.has(today) };
}

