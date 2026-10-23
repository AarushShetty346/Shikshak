// Phone revision calls for students on a basic phone: a short call (about 5 minutes) that asks up
// to three checked questions from the student's own recorded work, answered on the keypad.
//
// Off unless PHONE_CALLS_ENABLED is set. A call is only placed when ALL of these hold:
//   - an operator has put the number on PHONE_ALLOWLIST;
//   - a guardian gave consent and the student agreed (recorded, with the guardian's name);
//   - the student hasn't opted out (saying "stop", pressing 9, or in the app);
//   - it's inside the chosen window in the learner's own time zone (never before 9:00 or after 21:00);
//   - the number hasn't had its calls for the day, and no other call to it is in progress;
//   - the server-wide concurrent call cap isn't reached;
//   - there is something to revise (recorded mistakes or skills that need practice).
// Nothing schedules calls automatically: an operator triggers each one (admin endpoint), so no
// recurring schedule exists until someone deliberately builds and enables one.

import { randomId } from "./auth";
import { config } from "./config";
import { problem as problemById, PROBLEMS, checkAnswer } from "./curriculum/library";
import type { Problem } from "./curriculum/types";
import { learnerAttempts, localDay, memoryOf, recordPhoneAttempt, type Learner } from "./learners";
import { store } from "./store";
import { LANGUAGE_NAMES } from "../shared/types";

export interface PhoneItem {
  problemId: string;
  answeredAt: number | null;
  tries: number;
  outcome: "correct" | "incorrect" | null;
}

export interface PhoneCall {
  id: string;
  at: number;
  localDay: string;
  status: "queued" | "failed" | "ended";
  executionId: string | null;
  error: string | null;
  items: PhoneItem[];
}

export interface PhoneEnrolment {
  learnerId: string;
  deviceId: string;
  number: string;
  guardian: { name: string; consentAt: number };
  studentAssentAt: number;
  /** Local hours, [start, end). */
  window: { start: number; end: number };
  optedOut: { at: number; how: "keypad" | "voice" | "app" | "operator" } | null;
  createdAt: number;
  calls: PhoneCall[];
}

export class PhoneError extends Error {
  override name = "PhoneError";
}

export interface PhoneProvider {
  placeCall(req: { agentId: string; to: string; userData: Record<string, string> }): Promise<{ executionId: string }>;
}

const E164 = /^\+[1-9]\d{7,14}$/;
export const EARLIEST_HOUR = 9;
export const LATEST_HOUR = 21;
const MAX_ITEMS = 3;
const KEEP_CALLS = 30;

/** "+91 98765 43210" -> "+919876543210"; null if it isn't a plausible E.164 number. */
export function normaliseNumber(raw: unknown): string | null {
  const n = String(raw ?? "").replace(/[\s()-]/g, "");
  return E164.test(n) ? n : null;
}

export const maskNumber = (n: string) => `${n.slice(0, 3)}${"•".repeat(Math.max(0, n.length - 7))}${n.slice(-4)}`;

const callRef = (callId: string) => `c_${callId}`;

export function getEnrolment(learnerId: string): PhoneEnrolment | null {
  return store.get<PhoneEnrolment>("phone", learnerId) ?? null;
}

function save(e: PhoneEnrolment) {
  store.put("phone", e.learnerId, e);
}

/** A guardian enrols a learner. Consent and the student's agreement are both required. */
export function enrolPhone(
  l: Learner,
  input: { number?: unknown; guardianName?: unknown; guardianConsent?: unknown; studentAssent?: unknown; windowStart?: unknown; windowEnd?: unknown },
  now = Date.now(),
): PhoneEnrolment {
  const number = normaliseNumber(input.number);
  if (!number) throw new PhoneError("Enter the number with its country code, like +91 98765 43210.");
  const guardianName = String(input.guardianName ?? "").trim().slice(0, 60);
  if (!guardianName) throw new PhoneError("A parent or guardian needs to give their name.");
  if (input.guardianConsent !== true) throw new PhoneError("A parent or guardian needs to agree to the calls.");
  if (input.studentAssent !== true) throw new PhoneError("The student needs to agree to the calls too.");
  const clampHour = (v: unknown, d: number) => Math.min(LATEST_HOUR, Math.max(EARLIEST_HOUR, Number.isInteger(Number(v)) ? Number(v) : d));
  const start = clampHour(input.windowStart, 17);
  const end = clampHour(input.windowEnd, 19);
  if (end <= start) throw new PhoneError("The call window must end after it starts.");
  const old = getEnrolment(l.id);
  const e: PhoneEnrolment = {
    learnerId: l.id,
    deviceId: l.deviceId,
    number,
    guardian: { name: guardianName, consentAt: now },
    studentAssentAt: now,
    window: { start, end },
    optedOut: null,
    createdAt: old?.createdAt ?? now,
    calls: old?.number === number ? old.calls : [],
  };
  save(e);
  return e;
}

export function optOut(learnerId: string, how: NonNullable<PhoneEnrolment["optedOut"]>["how"], now = Date.now()): boolean {
  const e = getEnrolment(learnerId);
  if (!e) return false;
  if (!e.optedOut) e.optedOut = { at: now, how };
  save(e);
  return true;
}

/** Removes the number, consent and call records. */
export function removePhone(learnerId: string) {
  const e = getEnrolment(learnerId);
  if (!e) return;
  for (const c of e.calls) store.delete("phone", callRef(c.id));
  store.delete("phone", learnerId);
}

function localHour(t: number, tz: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(t));
  return Number(h);
}

/** Questions answerable on a keypad: a single whole-number answer. */
export const keypadFriendly = (p: Problem) => p.answer.type === "value" && /^\d{1,6}$/.test(p.answer.value);

/** Up to three keypad questions from what the learner's record says needs revising. */
export function revisionItems(l: Learner): Problem[] {
  const attempts = learnerAttempts(l);
  if (!attempts.length) return [];
  const m = memoryOf(l, () => null);
  const recent = new Set(attempts.slice(-40).map((a) => a.problemId));
  const wanted = [
    ...m.mistakes.filter((x) => !x.resolved).flatMap((x) => attempts.filter((a) => a.misconceptions.some((mm) => mm.id === x.id)).map((a) => a.skill)),
    ...m.needsPractice.map((x) => x.skill),
    ...m.progress.filter((p) => p.status !== "secure").map((p) => p.skill),
  ].filter((s): s is string => Boolean(s));
  const skills = [...new Set(wanted)];
  const out: Problem[] = [];
  for (const sk of skills) {
    const pool = PROBLEMS.filter((p) => p.skill === sk && keypadFriendly(p) && !out.includes(p));
    const pick = pool.find((p) => !recent.has(p.id)) ?? pool[0];
    if (pick) out.push(pick);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export type Eligibility = { ok: true; items: Problem[] } | { ok: false; reason: string };

function activeCalls(now: number): number {
  const maxMs = (config.phone.maxCallSeconds() + 120) * 1000;
  let n = 0;
  for (const id of store.ids("phone")) {
    if (id.startsWith("c_")) continue;
    const e = store.get<PhoneEnrolment>("phone", id);
    n += e?.calls.filter((c) => c.status === "queued" && now - c.at < maxMs).length ?? 0;
  }
  return n;
}

/** Every rule a call must pass, in the order an operator would want to read them. */
export function eligibility(l: Learner, now = Date.now()): Eligibility {
  if (!config.phone.enabled()) return { ok: false, reason: "Phone calls are turned off on this server (PHONE_CALLS_ENABLED)." };
  if (!process.env.BOLNA_PHONE_AGENT_ID) return { ok: false, reason: "No phone agent is set up (BOLNA_PHONE_AGENT_ID)." };
  const e = getEnrolment(l.id);
  if (!e) return { ok: false, reason: "No phone number is enrolled for this learner." };
  if (e.optedOut) return { ok: false, reason: "The student opted out of calls." };
  if (!e.guardian.consentAt || !e.studentAssentAt) return { ok: false, reason: "Consent is missing." };
  if (!config.phone.allowlist().includes(e.number)) return { ok: false, reason: "The number isn't on the operator's approved list (PHONE_ALLOWLIST)." };
  const hour = localHour(now, l.timezone);
  if (hour < Math.max(EARLIEST_HOUR, e.window.start) || hour >= Math.min(LATEST_HOUR, e.window.end))
    return { ok: false, reason: `Outside the call window (${e.window.start}:00 to ${e.window.end}:00, ${l.timezone}).` };
  if (e.calls.some((c) => c.status === "queued" && now - c.at < (config.phone.maxCallSeconds() + 120) * 1000))
    return { ok: false, reason: "A call to this number is already in progress." };
  const today = localDay(now, l.timezone);
  const todays = e.calls.filter((c) => c.localDay === today && c.status !== "failed");
  if (todays.length >= config.phone.maxCallsPerNumberPerDay()) return { ok: false, reason: "This number already had today's call." };
  if (activeCalls(now) >= config.phone.maxConcurrent()) return { ok: false, reason: "The server-wide limit on simultaneous calls is reached." };
  const items = revisionItems(l);
  if (!items.length) return { ok: false, reason: "Nothing to revise yet: there's no recorded work that needs practice." };
  return { ok: true, items };
}

/** Places one revision call if every rule passes. The provider is injected so tests never dial. */
export async function placeRevisionCall(l: Learner, provider: PhoneProvider, now = Date.now()): Promise<{ ok: true; call: PhoneCall } | { ok: false; reason: string }> {
  const check = eligibility(l, now);
  if (!check.ok) return check;
  const e = getEnrolment(l.id)!;
  const call: PhoneCall = {
    id: randomId(12),
    at: now,
    localDay: localDay(now, l.timezone),
    status: "queued",
    executionId: null,
    error: null,
    items: check.items.map((p) => ({ problemId: p.id, answeredAt: null, tries: 0, outcome: null })),
  };
  e.calls = [...e.calls, call].slice(-KEEP_CALLS);
  save(e);
  store.put("phone", callRef(call.id), { learnerId: l.id });
  try {
    const { executionId } = await provider.placeCall({
      agentId: process.env.BOLNA_PHONE_AGENT_ID!,
      to: e.number,
      userData: {
        call_code: call.id,
        student_name: l.name,
        language_name: LANGUAGE_NAMES[l.language] ?? "Hinglish",
        question_count: String(call.items.length),
        max_minutes: String(Math.round(config.phone.maxCallSeconds() / 60)),
      },
    });
    call.executionId = executionId;
  } catch (err) {
    call.status = "failed";
    call.error = String((err as Error).message ?? err).slice(0, 200);
  }
  save(e);
  return call.status === "failed" ? { ok: false, reason: `The call couldn't be placed: ${call.error}` } : { ok: true, call };
}

/** Bolna's outbound call API. Bolna's own calling guardrails stay on (bypass_call_guardrails is never sent). */
export function bolnaPhoneProvider(apiKey = process.env.BOLNA_API_KEY ?? ""): PhoneProvider {
  return {
    async placeCall({ agentId, to, userData }) {
      if (!apiKey) throw new Error("BOLNA_API_KEY is not set");
      const r = await fetch("https://api.bolna.ai/call", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId, recipient_phone_number: to, user_data: userData }),
      });
      const body = (await r.json().catch(() => ({}))) as { execution_id?: string; message?: string };
      if (!r.ok || !body.execution_id) throw new Error(`Bolna said ${r.status}${body.message ? `: ${body.message}` : ""}`);
      return { executionId: body.execution_id };
    },
  };
}

// ---------- during the call (the phone agent's tools) ----------

function callFor(callCode: unknown): { e: PhoneEnrolment; call: PhoneCall; l: Learner } | null {
  const code = String(callCode ?? "");
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(code)) return null;
  const ref = store.get<{ learnerId: string }>("phone", callRef(code));
  const e = ref ? getEnrolment(ref.learnerId) : null;
  const call = e?.calls.find((c) => c.id === code);
  const l = e ? store.get<Learner>("learners", e.learnerId) : null;
  return e && call && l ? { e, call, l } : null;
}

const NOT_A_CALL = { ok: false, error: "This isn't an active revision call. Say goodbye politely." };

/** Question n (1-based) of the call, read aloud by the agent. */
export function phoneQuestion(callCode: unknown, n: unknown) {
  const c = callFor(callCode);
  if (!c) return NOT_A_CALL;
  if (c.e.optedOut) return { ok: false, error: "The student opted out. Say goodbye politely." };
  const i = Number(n) - 1;
  const item = c.call.items[i];
  if (!item) return { ok: true, done: true, note: "No more questions. Thank them, say what went well, and say goodbye." };
  const p = problemById(item.problemId)!;
  return {
    ok: true,
    question: i + 1,
    of: c.call.items.length,
    text: p.statement,
    note: "Read the question slowly, twice if needed. They type the answer on the keypad and press #. Don't say the answer.",
  };
}

/** A keypad answer: checked exactly; the first try is the recorded attempt. */
export function phoneAnswer(callCode: unknown, n: unknown, digits: unknown, now = Date.now()) {
  const c = callFor(callCode);
  if (!c) return NOT_A_CALL;
  const i = Number(n) - 1;
  const item = c.call.items[i];
  if (!item) return { ok: false, error: `There is no question ${n}.` };
  const raw = String(digits ?? "").replace(/^dtmf_number:\s*/i, "").replace(/[^0-9]/g, "");
  if (!raw) return { ok: false, error: "No digits came through. Ask them to type the answer and press #." };
  const p = problemById(item.problemId)!;
  const result = checkAnswer(p, raw);
  const correct = result.verdict === "correct";
  item.tries++;
  if (item.tries === 1) {
    item.answeredAt = now;
    item.outcome = correct ? "correct" : "incorrect";
    recordPhoneAttempt(c.l, c.call.id, {
      key: `phone:${c.call.id}:${i + 1}`,
      problem: p,
      outcome: correct ? "correct" : "incorrect",
      answer: raw,
      misconceptions: result.misconceptions,
      at: now,
    });
  }
  store.put("phone", c.e.learnerId, c.e);
  if (correct) return { ok: true, correct: true, note: "Correct. Praise briefly, then go to the next question." };
  if (item.tries === 1) return { ok: true, correct: false, hint: p.hints[0], note: "Not quite. Give this hint (don't say the answer) and let them try once more." };
  return { ok: true, correct: false, note: "Still not right. Don't give the answer; say you'll go over it together in the next class, then move on." };
}

export function phoneOptOut(callCode: unknown, how: "keypad" | "voice") {
  const c = callFor(callCode);
  if (!c) return NOT_A_CALL;
  optOut(c.e.learnerId, how);
  return { ok: true, note: "Done: no more calls. Confirm that politely and say goodbye." };
}

export function endPhoneCall(callCode: unknown) {
  const c = callFor(callCode);
  if (!c) return NOT_A_CALL;
  if (c.call.status === "queued") c.call.status = "ended";
  store.put("phone", c.e.learnerId, c.e);
  const right = c.call.items.filter((x) => x.outcome === "correct").length;
  return { ok: true, note: `Recorded. ${right} of ${c.call.items.length} right on the first try.` };
}

// ---------- what the app and the operator see ----------

export function publicPhone(l: Learner, now = Date.now()) {
  const e = getEnrolment(l.id);
  const check = eligibility(l, now);
  return {
    enabledOnServer: config.phone.enabled(),
    enrolled: Boolean(e),
    number: e ? maskNumber(e.number) : null,
    guardianName: e?.guardian.name ?? null,
    window: e?.window ?? null,
    optedOut: Boolean(e?.optedOut),
    approved: e ? config.phone.allowlist().includes(e.number) : false,
    readyNow: check.ok,
    why: check.ok ? null : check.reason,
    calls: (e?.calls ?? []).slice(-5).map((c) => ({ at: c.at, status: c.status, right: c.items.filter((x) => x.outcome === "correct").length, of: c.items.length })),
  };
}

/** Operator view: every enrolment, masked, with whether a call could go out now and why not. */
export function adminPhoneList(now = Date.now()) {
  return store
    .ids("phone")
    .filter((id) => !id.startsWith("c_"))
    .map((id) => store.get<PhoneEnrolment>("phone", id)!)
    .filter(Boolean)
    .map((e) => {
      const l = store.get<Learner>("learners", e.learnerId);
      const check = l ? eligibility(l, now) : { ok: false as const, reason: "Learner deleted." };
      return {
        learnerId: e.learnerId,
        number: maskNumber(e.number),
        approved: config.phone.allowlist().includes(e.number),
        optedOut: Boolean(e.optedOut),
        readyNow: check.ok,
        why: check.ok ? null : check.reason,
        calls: e.calls.length,
      };
    });
}
