// Learners (profiles) on this device, their recorded progress, and class reports.

import type { Language } from "../../../shared/types";
import { apiFetch } from "./api";

export interface Learner {
  id: string;
  name: string;
  grade: string;
  language: Language;
  timezone: string;
  createdAt: number;
  sessions: number;
  streak: { current: number; best: number; today: boolean };
}

export interface SkillProgress {
  skill: string;
  name: string;
  chapter: string;
  status: "not_started" | "learning" | "practising" | "secure";
  attempts: number;
  independentCorrect: number;
  correctWithHelp: number;
  transferCorrect: number;
  mistakes: number;
  followUpDue: boolean;
  because: string;
  lastAt: number | null;
}

export interface MisconceptionSummary {
  id: string;
  name: string;
  remedy: string;
  count: number;
  confidence: "high" | "medium";
  lastAt: number;
  examples: string[];
  resolved: boolean;
}

export interface Memory {
  topics: { chapter: string; name: string; lastAt: number; attempts: number }[];
  strengths: { skill: string; name: string; because: string }[];
  needsPractice: { skill: string; name: string; because: string }[];
  mistakes: MisconceptionSummary[];
  checkpoint: { sessionId: string; topic: string; at: number } | null;
  next: { problemId: string; statement: string; why: string } | null;
  progress: SkillProgress[];
  evidenceCount: number;
}

export interface Report {
  version: string;
  learnerName: string | null;
  topic: string;
  date: number;
  minutes: number | null;
  covered: string[];
  problems: { question: string; result: string; hints: number; tries: number; mistakes: string[]; corrected: boolean }[];
  counts: { attempted: number; solvedAlone: number; solvedWithHelp: number; notSolved: number; hints: number };
  mistakesCorrected: { mistake: string; question: string }[];
  needsPractice: string[];
  next: string;
  sparse: boolean;
  note: string;
}

const SELECTED = "shikshak.learner";

export function selectedLearner(): string | null {
  try {
    return localStorage.getItem(SELECTED);
  } catch {
    return null;
  }
}

export function selectLearner(id: string | null) {
  try {
    if (id) localStorage.setItem(SELECTED, id);
    else localStorage.removeItem(SELECTED);
  } catch {
    // remembered for this page only
  }
}

// The last list the server sent, and the request in flight: the start screen fetches the list while
// it's showing, so the home screen can draw the right account at once instead of a blank or wrong one.
let known: Learner[] | null = null;
let inflight: Promise<Learner[]> | null = null;
export const cachedLearners = () => known;
export const listLearners = () =>
  (inflight ??= apiFetch<{ learners: Learner[] }>("/learners")
    .then((r) => (known = r.learners))
    .finally(() => (inflight = null)));
/** Remember a learner just made (until the next list arrives). */
export const rememberLearner = (l: Learner) => (known = [...(known ?? []).filter((x) => x.id !== l.id), l]);
export const createLearner = (input: { name: string; grade: string; language: Language }) =>
  apiFetch<{ learner: Learner }>("/learners", { body: { ...input, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }).then((r) => r.learner);
export const updateLearner = (id: string, patch: Partial<Pick<Learner, "name" | "grade" | "language" | "timezone">>) =>
  apiFetch<{ learner: Learner }>(`/learners/${id}`, { method: "PATCH", body: patch }).then((r) => r.learner);
export const deleteLearner = (id: string) => apiFetch(`/learners/${id}`, { method: "DELETE" });
export const learnerMemory = (id: string) => apiFetch<{ learner: Learner; memory: Memory }>(`/learners/${id}/memory`);
export const resetMemory = (id: string) => apiFetch(`/learners/${id}/reset-memory`, { method: "POST", body: {} });
export const rejectMisconception = (id: string, mid: string) => apiFetch(`/learners/${id}/misconceptions/${mid}/reject`, { method: "POST", body: {} });
export const sessionReport = (serverId: string) => apiFetch<{ report: Report }>(`/sessions/${serverId}/report`).then((r) => r.report);

export const STATUS_LABEL: Record<SkillProgress["status"], string> = {
  not_started: "Not started",
  learning: "Learning",
  practising: "Practising",
  secure: "Secure",
};
