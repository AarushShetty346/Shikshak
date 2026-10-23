// Tools for running a small, honest pilot: pseudonymous participants, recorded consent (the
// signed paper forms stay with the facilitator), equivalent pre/post quizzes (and an optional
// delayed transfer check), timed responses, technical-problem notes, feedback, and an anonymised
// CSV export. Answer keys never leave the server.
//
// A small pilot is exploratory evidence: no control group, so it can't show that Shikshak caused
// any change. The export says so in its header.

import { randomId } from "./auth";
import { compareAnswer, type AnswerSpec } from "./maths/answers";
import { store } from "./store";

export interface QuizItem {
  id: string;
  skill: string;
  prompt: string;
  answer: AnswerSpec;
}

/**
 * Forms A (pre) and B (post) test the same skills with different numbers, item by item, at the
 * same difficulty. Form C is a delayed transfer check (new contexts). Answers are recomputed in
 * pilot.test.ts.
 */
export const QUIZ_FORMS: Record<"A" | "B" | "C", { title: string; items: QuizItem[] }> = {
  A: {
    title: "Arithmetic progressions: before",
    items: [
      { id: "A1", skill: "ap.common_difference", prompt: "Common difference of the AP: 6, 13, 20, 27, ...", answer: { type: "value", value: "7" } },
      { id: "A2", skill: "ap.nth_term", prompt: "The 12th term of the AP: 4, 7, 10, ...", answer: { type: "value", value: "37" } },
      { id: "A3", skill: "ap.nth_term", prompt: "The 10th term of the AP: 30, 26, 22, ...", answer: { type: "value", value: "-6" } },
      { id: "A4", skill: "ap.find_n", prompt: "Which term of the AP: 5, 9, 13, ... is 65?", answer: { type: "value", value: "16" } },
      { id: "A5", skill: "ap.sum", prompt: "Sum of the first 10 terms of the AP: 3, 7, 11, ...", answer: { type: "value", value: "210" } },
    ],
  },
  B: {
    title: "Arithmetic progressions: after",
    items: [
      { id: "B1", skill: "ap.common_difference", prompt: "Common difference of the AP: 8, 17, 26, 35, ...", answer: { type: "value", value: "9" } },
      { id: "B2", skill: "ap.nth_term", prompt: "The 12th term of the AP: 5, 9, 13, ...", answer: { type: "value", value: "49" } },
      { id: "B3", skill: "ap.nth_term", prompt: "The 10th term of the AP: 40, 35, 30, ...", answer: { type: "value", value: "-5" } },
      { id: "B4", skill: "ap.find_n", prompt: "Which term of the AP: 2, 8, 14, ... is 92?", answer: { type: "value", value: "16" } },
      { id: "B5", skill: "ap.sum", prompt: "Sum of the first 10 terms of the AP: 2, 6, 10, ...", answer: { type: "value", value: "200" } },
    ],
  },
  C: {
    title: "Arithmetic progressions: a week later (new situations)",
    items: [
      { id: "C1", skill: "ap.nth_term", prompt: "A plant is 12 cm tall and grows 3 cm every week. How tall is it at the start of week 9 (week 1 = 12 cm)?", answer: { type: "value", value: "36" } },
      { id: "C2", skill: "ap.find_n", prompt: "Seats: 15 in row 1, 2 more in each next row. Which row has 45 seats?", answer: { type: "value", value: "16" } },
      { id: "C3", skill: "ap.sum", prompt: "Saving ₹10 on day 1, ₹15 on day 2, ₹20 on day 3, and so on. Total saved in 8 days?", answer: { type: "value", value: "220" } },
    ],
  },
};

export type FormId = keyof typeof QUIZ_FORMS;

export interface Participant {
  id: string;
  /** Facilitator's device that runs the pilot (only it can see these records). */
  deviceId: string;
  /** Pseudonymous code chosen by the facilitator, e.g. "P07". No names. */
  code: string;
  consent: { guardianConsent: boolean; studentAssent: boolean; recordingAllowed: boolean; recordedAt: number };
  responses: { form: FormId; item: string; correct: boolean; verdict: string; ms: number; at: number }[];
  forms: { form: FormId; startedAt: number; finishedAt: number | null }[];
  technicalIssues: { at: number; note: string }[];
  feedback: { at: number; easy: number; helpful: number; wouldUse: number; comment: string } | null;
  createdAt: number;
}

export class PilotError extends Error {
  override name = "PilotError";
}

export function publicForm(form: FormId) {
  const f = QUIZ_FORMS[form];
  return { form, title: f.title, items: f.items.map((i) => ({ id: i.id, prompt: i.prompt })) };
}

export function createParticipant(deviceId: string, input: { code?: unknown; guardianConsent?: unknown; studentAssent?: unknown; recordingAllowed?: unknown }): Participant {
  const code = String(input.code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{1,3}\d{1,4}$/.test(code)) throw new PilotError('Use a code like "P07", never a name.');
  if (input.guardianConsent !== true || input.studentAssent !== true) throw new PilotError("A participant needs both a guardian's consent and the student's own agreement before taking part.");
  if (listParticipants(deviceId).some((p) => p.code === code)) throw new PilotError(`${code} already exists.`);
  const p: Participant = {
    id: `p_${randomId(10)}`,
    deviceId,
    code,
    consent: { guardianConsent: true, studentAssent: true, recordingAllowed: input.recordingAllowed === true, recordedAt: Date.now() },
    responses: [],
    forms: [],
    technicalIssues: [],
    feedback: null,
    createdAt: Date.now(),
  };
  store.put("pilot", p.id, p, { immediate: true });
  return p;
}

export function listParticipants(deviceId: string): Participant[] {
  return store
    .ids("pilot")
    .map((id) => store.get<Participant>("pilot", id))
    .filter((p): p is Participant => Boolean(p && p.deviceId === deviceId))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function participantFor(id: string, deviceId: string): Participant | null {
  const p = store.get<Participant>("pilot", id);
  return p && p.deviceId === deviceId ? p : null;
}

export function startForm(p: Participant, form: FormId) {
  if (!p.forms.some((f) => f.form === form)) p.forms.push({ form, startedAt: Date.now(), finishedAt: null });
  store.put("pilot", p.id, p);
  return publicForm(form);
}

/** Records one answer (once per item and form). Returns whether it was right, for the export only. */
export function answerItem(p: Participant, form: FormId, itemId: string, answer: string, ms: number): { recorded: boolean } {
  const item = QUIZ_FORMS[form].items.find((i) => i.id === itemId);
  if (!item) throw new PilotError("Unknown question");
  if (!p.forms.some((f) => f.form === form)) throw new PilotError("Start this form first");
  if (p.responses.some((r) => r.form === form && r.item === itemId)) return { recorded: false };
  const verdict = String(answer ?? "").trim() ? compareAnswer(item.answer, String(answer)).verdict : "unanswered";
  p.responses.push({ form, item: itemId, correct: verdict === "correct", verdict, ms: Math.max(0, Math.min(Number(ms) || 0, 3_600_000)), at: Date.now() });
  const f = p.forms.find((x) => x.form === form)!;
  if (QUIZ_FORMS[form].items.every((i) => p.responses.some((r) => r.form === form && r.item === i.id))) f.finishedAt = Date.now();
  store.put("pilot", p.id, p);
  return { recorded: true };
}

export function noteIssue(p: Participant, note: string) {
  p.technicalIssues.push({ at: Date.now(), note: String(note).slice(0, 300) });
  store.put("pilot", p.id, p);
}

export function saveFeedback(p: Participant, input: { easy?: unknown; helpful?: unknown; wouldUse?: unknown; comment?: unknown }) {
  const scale = (v: unknown) => Math.max(1, Math.min(5, Math.round(Number(v) || 0))) || 0;
  p.feedback = { at: Date.now(), easy: scale(input.easy), helpful: scale(input.helpful), wouldUse: scale(input.wouldUse), comment: String(input.comment ?? "").slice(0, 600) };
  store.put("pilot", p.id, p);
}

export function deleteParticipant(p: Participant) {
  store.delete("pilot", p.id);
}

const csv = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Anonymised export: participant codes only, no names, no free-text answers. */
export function exportCsv(deviceId: string): string {
  const rows = [
    "# Shikshak pilot export. Exploratory evidence from a small group without a control group: it can't show cause and effect.",
    "participant,form,item,skill,correct,verdict,seconds,answered_at",
  ];
  for (const p of listParticipants(deviceId)) {
    for (const r of p.responses) {
      const item = QUIZ_FORMS[r.form].items.find((i) => i.id === r.item);
      rows.push([p.code, r.form, r.item, item?.skill, r.correct ? 1 : 0, r.verdict, (r.ms / 1000).toFixed(1), new Date(r.at).toISOString()].map(csv).join(","));
    }
  }
  rows.push("");
  rows.push("participant,form,started_at,finished_at,score,out_of");
  for (const p of listParticipants(deviceId)) {
    for (const f of p.forms) {
      const rs = p.responses.filter((r) => r.form === f.form);
      rows.push([p.code, f.form, new Date(f.startedAt).toISOString(), f.finishedAt ? new Date(f.finishedAt).toISOString() : "", rs.filter((r) => r.correct).length, QUIZ_FORMS[f.form].items.length].map(csv).join(","));
    }
  }
  rows.push("");
  rows.push("participant,technical_issue_at,note");
  for (const p of listParticipants(deviceId)) for (const t of p.technicalIssues) rows.push([p.code, new Date(t.at).toISOString(), t.note].map(csv).join(","));
  rows.push("");
  rows.push("participant,easy_1to5,helpful_1to5,would_use_1to5,comment");
  for (const p of listParticipants(deviceId)) if (p.feedback) rows.push([p.code, p.feedback.easy, p.feedback.helpful, p.feedback.wouldUse, p.feedback.comment].map(csv).join(","));
  return rows.join("\n") + "\n";
}

/** Summary per form, for the facilitator's screen. */
export function summary(deviceId: string) {
  const ps = listParticipants(deviceId);
  const byForm = (form: FormId) => {
    const done = ps.filter((p) => p.forms.some((f) => f.form === form && f.finishedAt));
    const scores = done.map((p) => p.responses.filter((r) => r.form === form && r.correct).length);
    return { form, completed: done.length, meanScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null, outOf: QUIZ_FORMS[form].items.length };
  };
  return {
    participants: ps.length,
    forms: (["A", "B", "C"] as const).map(byForm),
    caution: "Exploratory: a small group, no control group. Differences between before and after can come from practice, the quiz itself, or other teaching.",
  };
}
