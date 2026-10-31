// Exam mode (see server/exams.ts): papers in the board pattern, the invigilator's log, the marking.

import { apiFetch } from "./api";

export const QUESTION_COUNTS = [5, 10, 15, 20, 30] as const;
export const DURATIONS = [30, 45, 60, 90, 120, 180] as const;
export type ExamMode = "mock" | "exam";

export interface PaperQuestion {
  n: number;
  text: string;
  marks: number;
  options?: string[];
  or?: string;
}
export interface Paper {
  title: string;
  grade: string;
  subject: string;
  minutes: number;
  maxMarks: number;
  instructions: string[];
  sections: { id: string; title: string; instructions: string; questions: PaperQuestion[] }[];
  simulated?: boolean;
}
export interface Evaluation {
  total: number;
  max: number;
  questions: { n: number; awarded: number; max: number; steps: { text: string; awarded: number; max: number }[]; feedback: string }[];
  presentation: Record<"neatness" | "handwriting" | "steps" | "finalAnswers", { score: number; comment: string }>;
  strengths: string[];
  improve: string[];
  summary: string;
  simulated?: boolean;
}
export interface IntegrityEvent {
  at: number;
  kind: string;
  detail?: string;
}
export interface Exam {
  id: string;
  topic: string;
  mode: ExamMode;
  createdAt: number;
  paper: Paper;
  startedAt: number | null;
  endsAt: number | null;
  endedAt: number | null;
  events: IntegrityEvent[];
  evaluation: Evaluation | null;
}

export const listExams = (learnerId: string) => apiFetch<{ exams: Exam[] }>(`/exams?learnerId=${encodeURIComponent(learnerId)}`).then((r) => r.exams);
export const getExam = (id: string) => apiFetch<{ exam: Exam }>(`/exams/${id}`).then((r) => r.exam);
export const createExam = (body: { learnerId: string; topic: string; questions: number; minutes: number; mode: ExamMode; level?: "standard" | "basic" }) =>
  apiFetch<{ exam: Exam }>("/exams", { body }).then((r) => r.exam);
export const startExam = (id: string) => apiFetch<{ exam: Exam }>(`/exams/${id}/start`, { body: {} }).then((r) => r.exam);
export const logExamEvents = (id: string, events: { kind: string; detail?: string }[]) => apiFetch(`/exams/${id}/events`, { body: { events }, keepalive: true }).catch(() => {});
export const submitExam = (id: string, photos: { mediaType: string; data: string }[]) =>
  apiFetch<{ exam: Exam }>(`/exams/${id}/submit`, { body: { photos } }).then((r) => r.exam);
export const reviewExam = (id: string, sessionId: string) => apiFetch<{ question: string }>(`/exams/${id}/review`, { body: { sessionId } });

export const EVENT_LABEL: Record<string, string> = {
  started: "Exam started",
  "tab-hidden": "Left the exam tab or app",
  "window-left": "Switched to another window",
  "fullscreen-exit": "Left fullscreen",
  "screen-share-ended": "Stopped sharing the screen",
  "camera-off": "Camera turned off",
  returned: "Came back to the exam",
  ended: "Finished the exam",
  "time-up": "Time was up",
};
