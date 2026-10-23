// Starting voice classes: mints a short-lived Bolna web-call session for one of this device's
// sessions, with the lesson context built here on the server (the browser can't inject prompt
// variables). Enforces per-device and server-wide limits on concurrent calls and on estimated
// minutes per day, so a bug or a misbehaving client can't run up the bill.

import { greetingFor, LANGUAGE_NAMES, VOICE_LANGUAGE } from "../shared/types";
import { randomId } from "./auth";
import { lessonState } from "./board";
import { config } from "./config";
import { addUsage, usedToday } from "./limits";
import { docList } from "./material";
import { outlineFor } from "./plan";
import { save, type Session } from "./sessions";

export type Speed = "slower" | "normal" | "faster";

interface ActiveCall {
  id: string;
  deviceId: string;
  sessionId: string;
  startedAt: number;
}
const active = new Map<string, ActiveCall>();

/** Bolna can't change voice speed mid-call, so there's one agent per speed (set up by bolna:setup). */
export function agentForSpeed(speed: unknown): string | undefined {
  if (speed === "slower") return process.env.BOLNA_AGENT_ID_SLOW || undefined;
  if (speed === "faster") return process.env.BOLNA_AGENT_ID_FAST || undefined;
  return undefined;
}

/**
 * Languages the deployed Bolna agents were set up with (BOLNA_AGENT_LANGUAGES, default "hi,en").
 * Tamil and Telugu need the agents re-created with npm run bolna:setup first.
 */
export function agentLanguages(): string[] {
  return (process.env.BOLNA_AGENT_LANGUAGES || "hi,en")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function voiceConfigured(): boolean {
  return Boolean(process.env.BOLNA_API_KEY && process.env.BOLNA_AGENT_ID);
}

/** Calls that ended without telling us count as the longest possible call. */
function expire(now: number) {
  const maxMs = config.voice.maxCallMinutes() * 60_000;
  for (const c of active.values()) {
    if (now - c.startedAt > maxMs) {
      active.delete(c.id);
      addUsage(`device_${c.deviceId}`, "voice_minutes", config.voice.maxCallMinutes());
      addUsage("global", "voice_minutes", config.voice.maxCallMinutes());
    }
  }
}

const runningMinutes = (filter: (c: ActiveCall) => boolean, now: number) =>
  [...active.values()].filter(filter).reduce((m, c) => m + (now - c.startedAt) / 60_000, 0);

export function voiceUsage(deviceId: string, now = Date.now()) {
  expire(now);
  return {
    deviceMinutes: usedToday(`device_${deviceId}`, "voice_minutes") + runningMinutes((c) => c.deviceId === deviceId, now),
    globalMinutes: usedToday("global", "voice_minutes") + runningMinutes(() => true, now),
    deviceCalls: [...active.values()].filter((c) => c.deviceId === deviceId).length,
    globalCalls: active.size,
  };
}

/** The lesson context the tutor's prompt needs, built from the session (never from the browser). */
export function buildUserData(s: Session, opts: { speed: Speed; resuming: boolean; memory?: string }): Record<string, unknown> {
  const plan = s.study?.plan ?? null;
  const topic = s.topic || plan?.topic || "maths";
  return {
    session_code: s.id,
    greeting: greetingFor(s.language, s.studentName, plan?.title || topic, opts.resuming),
    student_name: s.studentName || "student",
    grade: s.grade,
    language: s.language,
    language_name: LANGUAGE_NAMES[s.language],
    topic,
    speed: opts.speed,
    lesson_plan: plan ? outlineFor(plan) : "No prepared plan. Ask the student what they are stuck on, then teach it on the board with write and draw.",
    lesson_state: lessonState(s) || "New class: nothing has been taught yet.",
    material: docList(s),
    learner_memory: opts.memory || "No saved memory about this student yet. Don't claim to remember anything.",
  };
}

export type MintResult = { status: number; body: unknown; callId?: string };

export async function mintVoice(s: Session, opts: { speed: Speed; resuming: boolean; memory?: string }, fetchImpl: typeof fetch = fetch): Promise<MintResult> {
  if (!voiceConfigured()) return { status: 503, body: { error: "Voice isn't set up on this server yet." } };
  const now = Date.now();
  const u = voiceUsage(s.deviceId, now);
  if (u.deviceCalls >= config.voice.maxConcurrentPerOwner()) return { status: 409, body: { error: "A class is already running on this device. Pause it first." } };
  if (u.globalCalls >= config.voice.maxConcurrentGlobal()) return { status: 503, body: { error: "All voice lines are busy. Try again in a minute." } };
  if (u.deviceMinutes >= config.voice.minutesPerOwnerPerDay()) return { status: 429, body: { error: "Today's voice time on this device is used up. Try again tomorrow." } };
  if (u.globalMinutes >= config.voice.minutesGlobalPerDay()) return { status: 503, body: { error: "Shikshak has reached today's voice limit. Try again tomorrow." } };

  if (!agentLanguages().includes(VOICE_LANGUAGE[s.language]))
    return {
      status: 409,
      body: { error: `${LANGUAGE_NAMES[s.language]} voice isn't set up on this server yet (preview). The board still works; for a voice class, pick Hindi, Hinglish or English.` },
    };
  const agentId = agentForSpeed(opts.speed) ?? process.env.BOLNA_AGENT_ID!;
  const userData = buildUserData(s, opts);
  const lang = VOICE_LANGUAGE[s.language];
  let r: Response;
  try {
    r = await fetchImpl("https://api.bolna.ai/web-call/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.BOLNA_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, user_data: userData, ...(lang ? { agent_data: { language: lang } } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error("[voice] mint failed", (err as Error).message);
    return { status: 502, body: { error: "Couldn't reach the voice service." } };
  }
  const text = await r.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: "The voice service sent an unexpected reply." };
  }
  if (!r.ok) {
    console.error("[voice] Bolna refused", r.status, text.slice(0, 200));
    return { status: r.status === 429 ? 503 : 502, body: { error: r.status === 429 ? "All voice lines are busy. Try again in a minute." : "The voice service couldn't start the class." } };
  }
  const callId = `c_${randomId(9)}`;
  active.set(callId, { id: callId, deviceId: s.deviceId, sessionId: s.id, startedAt: now });
  s.calls.push({ id: callId, startedAt: now, endedAt: null });
  addUsage(`device_${s.deviceId}`, "voice_calls", 1);
  addUsage("global", "voice_calls", 1);
  save(s);
  return { status: 200, body, callId };
}

/** The browser reports the call ended (Pause, hang-up, page closed). Idempotent. */
export function endVoice(s: Session, callId: string): boolean {
  const c = active.get(callId);
  const rec = s.calls.find((x) => x.id === callId);
  if (!c || c.sessionId !== s.id) return false;
  active.delete(callId);
  const minutes = Math.min(config.voice.maxCallMinutes(), (Date.now() - c.startedAt) / 60_000);
  addUsage(`device_${c.deviceId}`, "voice_minutes", minutes);
  addUsage("global", "voice_minutes", minutes);
  if (rec) rec.endedAt = Date.now();
  save(s);
  return true;
}

export function resetVoice() {
  active.clear();
}
