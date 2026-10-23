import express, { type NextFunction, type Request, type Response } from "express";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { parseClientMessage } from "../shared/protocol";
import { isLanguage, type Language } from "../shared/types";
import { issueTicket, redeemTicket, registerDevice, requireDevice, sameSecret } from "./auth";
import { noteInterrupt } from "./board";
import { config } from "./config";
import { allow, BusyError, chargeModelCall, QuotaError, withModelSlot } from "./limits";
import {
  getLearner as getLearnerSafe,
  attachSession,
  createLearner,
  deleteLearner,
  LearnerError,
  learnerForDevice,
  listLearners,
  memoryForCall,
  memoryOf,
  resetLearnerMemory,
  saveLearner,
  setSessionLookup,
  streakOf,
  updateLearner,
  type Learner,
} from "./learners";
import { MISCONCEPTIONS } from "./curriculum/library";
import { afterReview, askQuestion, checkSpoken, giveHint, nextDiagnostic, noteDiagnostic, publicDiagnostic, showSolution, startDiagnostic } from "./teaching";
import { attemptFor, recordAttempt } from "./learners";
import { pickProblem, chapterForTopic } from "./curriculum/library";
import { hasModel, modelName } from "./llm";
import { reviewSubmission } from "./look";
import { addDocs, checkFile, removeDoc } from "./material";
import { makePlan, publicPlan, type StudyPlan } from "./plan";
import { saveSample } from "./samples";
import {
  createSession,
  deleteSession,
  docMeta,
  getSession,
  hashPng,
  hydrate,
  LimitError,
  listSessions,
  save,
  sessionForDevice,
  storeCapture,
  touch,
  welcome,
  type Session,
  type SessionRecord,
} from "./sessions";
import { reportFor } from "./report";
import { answerItem, createParticipant, deleteParticipant, exportCsv, listParticipants, noteIssue, participantFor, PilotError, publicForm, saveFeedback, startForm, summary, type FormId } from "./pilot";
import { claimShareCode, createShareCode, grantsFor, revokeAllFor, revokeGrant, ShareError, teacherGrant } from "./shares";
import { toolsRouter } from "./tools";
import { checkProviders } from "./health";
import { adminPhoneList, bolnaPhoneProvider, enrolPhone, optOut, PhoneError, placeRevisionCall, publicPhone, removePhone, type PhoneProvider } from "./phone";
import { endVoice, mintVoice, voiceConfigured, voiceUsage, type Speed } from "./voice";

export { agentForSpeed } from "./voice";

/** "98765 43210" -> "+919876543210". Accepts full international numbers starting with +. */
export function toE164(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return null;
}

/** What the browser may see of a session (no teacher-only state). */
export function publicSession(s: SessionRecord & { docs?: { length: number } }) {
  return {
    id: s.id,
    label: s.label,
    learnerId: s.learnerId,
    createdAt: s.createdAt,
    lastActive: s.lastActive,
    language: s.language,
    grade: s.grade,
    topic: s.topic,
    studentName: s.studentName,
    docs: s.docsMeta,
    plan: s.study ? publicPlan(s.study.plan) : null,
    started: s.calls.length > 0,
    diagnostic: s.diagnostic ? { chapter: s.diagnostic.chapter, status: s.diagnostic.status, asked: s.diagnostic.items.length, right: s.diagnostic.items.filter((i) => i.outcome === "correct").length } : null,
  };
}

/** What the browser may see of a learner. */
export function publicLearner(l: Learner) {
  return { id: l.id, name: l.name, grade: l.grade, language: l.language, timezone: l.timezone, createdAt: l.createdAt, sessions: l.sessions.length, streak: streakOf(l) };
}

// ---------- lesson plan drafts: made in setup, attached when the session is created ----------

interface Draft {
  id: string;
  deviceId: string;
  createdAt: number;
  plan: StudyPlan;
  language: Language;
}
const drafts = new Map<string, Draft>();

function keepDraft(d: Draft) {
  const now = Date.now();
  for (const [k, v] of drafts) if (now - v.createdAt > 3_600_000) drafts.delete(k);
  const mine = [...drafts.values()].filter((x) => x.deviceId === d.deviceId).sort((a, b) => a.createdAt - b.createdAt);
  while (mine.length >= 5) drafts.delete(mine.shift()!.id);
  drafts.set(d.id, d);
}

const ipOf = (req: Request | IncomingMessage) => (req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");

function rateLimit(key: (req: Request) => string, perMinute: number, burst: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!allow(key(req), perMinute, burst)) {
      res.status(429).json({ error: "Too many requests. Wait a moment and try again." });
      return;
    }
    next();
  };
}

/** Loads the session named in the URL if this device owns it; 404 otherwise (never reveals other devices' sessions). */
function ownSession(req: Request, res: Response): Session | null {
  const s = sessionForDevice(req.params.id, req.device!.id);
  if (!s) res.status(404).json({ error: "This class doesn't exist on this device." });
  return s;
}

function sendLimitError(res: Response, err: unknown) {
  if (err instanceof QuotaError) return void res.status(429).json({ error: err.message });
  if (err instanceof BusyError) return void res.status(503).json({ error: err.message });
  if (err instanceof LimitError) return void res.status(409).json({ error: err.message });
  return false;
}

export function createApp(opts: { devTools?: boolean; phoneProvider?: PhoneProvider } = {}) {
  const app = express();
  setSessionLookup((id) => {
    const s = getSession(id);
    return s ? { id: s.id, topic: s.topic || s.label, lastActive: s.lastActive } : null;
  });
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  app.use("/tools", toolsRouter());

  // ---------- health ----------
  app.get("/api/health", (_req, res) => {
    const toolsAuth = Boolean(config.toolsToken());
    const ready = !config.production() || toolsAuth;
    res.status(ready ? 200 : 503).json({
      ok: true,
      ready,
      mode: config.production() ? "production" : "development",
      // These say what is configured, not that the provider works right now (see /api/health/providers).
      configured: {
        checker: hasModel(),
        model: modelName(),
        voice: voiceConfigured(),
        toolsAuth,
        publicUrl: Boolean(process.env.PUBLIC_URL && !process.env.PUBLIC_URL.includes("example.com")),
        persistence: config.dataDir() === ":memory:" ? "memory" : "disk",
        phone: config.phone.enabled(),
      },
      fakeChecker: !hasModel() && process.env.FAKE_CHECKER === "1",
      // Older pages read these.
      checker: hasModel(),
      model: modelName(),
      bolna: voiceConfigured(),
      publicUrl: Boolean(process.env.PUBLIC_URL && !process.env.PUBLIC_URL.includes("example.com")),
    });
  });

  // Whether each provider accepts its key right now (free metadata requests, cached 10 minutes).
  app.get("/api/health/providers", rateLimit((req) => `health:${ipOf(req)}`, 6, 6), async (_req, res) => {
    res.json(await checkProviders());
  });

  // ---------- operator (ADMIN_TOKEN) ----------
  const admin = express.Router();
  admin.use(rateLimit((req) => `admin:${ipOf(req)}`, 30, 10));
  admin.use((req, res, next) => {
    const token = config.phone.adminToken();
    if (!token) return void res.status(503).json({ error: "Operator endpoints are off: ADMIN_TOKEN is not set." });
    const h = req.headers.authorization ?? "";
    if (!sameSecret(h.startsWith("Bearer ") ? h.slice(7) : undefined, token)) return void res.status(401).json({ error: "unauthorized" });
    next();
  });
  admin.get("/phone", (_req, res) => void res.json({ enabled: config.phone.enabled(), enrolments: adminPhoneList() }));
  // One call, triggered by a person. There is deliberately no automatic schedule.
  admin.post("/phone/:learnerId/call", express.json({ limit: "4kb" }), async (req, res) => {
    if (req.body?.confirm !== true) return void res.status(400).json({ error: 'Send {"confirm": true} to place a real call.' });
    const l = getLearnerSafe(req.params.learnerId);
    if (!l) return void res.status(404).json({ error: "No such learner." });
    const r = await placeRevisionCall(l, opts.phoneProvider ?? bolnaPhoneProvider());
    res.status(r.ok ? 202 : 409).json(r.ok ? { ok: true, callId: r.call.id, questions: r.call.items.length } : r);
  });
  app.use("/api/admin", admin);

  // ---------- devices ----------
  app.post("/api/devices", rateLimit((req) => `dev:${ipOf(req)}`, 6, 10), (_req, res) => {
    const { device, token } = registerDevice();
    res.status(201).json({ deviceId: device.id, token });
  });

  const api = express.Router();
  api.use(requireDevice);
  api.use(rateLimit((req) => `api:${req.device!.id}`, 240, 60));
  const small = express.json({ limit: "256kb" });
  const big = express.json({ limit: `${Math.ceil((config.limits.maxSessionDocBytes() * 4) / 3 / 1024 / 1024) + 2}mb` });

  api.get("/me", (req, res) => {
    const u = voiceUsage(req.device!.id);
    res.json({
      deviceId: req.device!.id,
      voice: { minutesToday: Math.round(u.deviceMinutes * 10) / 10, minutesLimit: config.voice.minutesPerOwnerPerDay() },
    });
  });

  // ---------- sessions ----------
  api.get("/sessions", (req, res) => {
    res.json({ sessions: listSessions(req.device!.id).map(publicSession) });
  });

  api.post("/sessions", small, (req, res) => {
    const b = req.body ?? {};
    const draft = typeof b.draftId === "string" ? drafts.get(b.draftId) : undefined;
    if (b.draftId && (!draft || draft.deviceId !== req.device!.id)) return void res.status(409).json({ error: "That lesson plan has expired. Make it again." });
    const language = isLanguage(b.language) ? b.language : "hinglish";
    if (draft && draft.language !== language) return void res.status(409).json({ error: "The plan was made for a different language. Make it again." });
    const learner = b.learnerId ? learnerForDevice(b.learnerId, req.device!.id) : null;
    if (b.learnerId && !learner) return void res.status(404).json({ error: "That learner doesn't exist on this device." });
    try {
      const s = createSession(req.device!.id, {
        label: typeof b.label === "string" ? b.label.trim() : undefined,
        learnerId: learner?.id ?? null,
        language,
        grade: /^(8|9|10|11|12)$/.test(String(b.grade)) ? String(b.grade) : "10",
        topic: typeof b.topic === "string" ? b.topic.trim() : "",
        studentName: typeof b.studentName === "string" ? b.studentName.trim() : "",
      });
      if (draft) {
        s.study = { plan: draft.plan, section: 0, practice: 0, lastSectionAt: 0 };
        drafts.delete(draft.id);
        save(s);
      }
      if (learner) attachSession(learner, s.id);
      res.status(201).json({ session: publicSession(s) });
    } catch (err) {
      if (sendLimitError(res, err) === false) throw err;
    }
  });

  api.get("/sessions/:id", (req, res) => {
    const s = ownSession(req, res);
    if (s) res.json({ session: publicSession(s) });
  });

  api.patch("/sessions/:id", small, (req, res) => {
    const s = ownSession(req, res);
    if (!s) return;
    if (typeof req.body?.label === "string" && req.body.label.trim()) s.label = req.body.label.trim().slice(0, 40);
    // Linking an older class to a learner (once; a class never moves between learners).
    if (typeof req.body?.learnerId === "string") {
      const l = learnerForDevice(req.body.learnerId, req.device!.id);
      if (!l) return void res.status(404).json({ error: "That learner doesn't exist on this device." });
      if (s.learnerId && s.learnerId !== l.id) return void res.status(409).json({ error: "This class already belongs to another learner." });
      s.learnerId = l.id;
      attachSession(l, s.id);
    }
    save(s);
    res.json({ session: publicSession(s) });
  });

  api.delete("/sessions/:id", (req, res) => {
    const s = ownSession(req, res);
    if (!s) return;
    const l = s.learnerId ? learnerForDevice(s.learnerId, req.device!.id) : null;
    if (l) {
      l.sessions = l.sessions.filter((x) => x !== s.id);
      saveLearner(l);
    }
    deleteSession(s);
    res.status(204).end();
  });

  api.post("/sessions/:id/ws-ticket", (req, res) => {
    const s = ownSession(req, res);
    if (s) res.json({ ticket: issueTicket(req.device!.id, s.id) });
  });

  // ---------- documents ----------
  api.post("/sessions/:id/documents", big, (req, res) => {
    const s = ownSession(req, res);
    if (!s) return;
    const result = addDocs(s, Array.isArray(req.body?.files) ? req.body.files : [], { replace: req.body?.replace === true });
    if (result.error) return void res.status(400).json({ error: result.error });
    touch(s);
    res.json({ ok: true, docs: result.docs });
  });

  api.delete("/sessions/:id/documents/:docId", (req, res) => {
    const s = ownSession(req, res);
    if (!s) return;
    if (!removeDoc(s, String(req.params.docId))) return void res.status(404).json({ error: "No such file" });
    res.json({ ok: true, docs: s.docs.length ? s.docs.map(docMeta) : s.docsMeta });
  });

  // ---------- lesson plans (drafts, before the session exists) ----------
  api.post("/plans", big, async (req, res) => {
    if (!hasModel()) return void res.status(503).json({ error: "Planner is not set up (no GEMINI_API_KEY or ANTHROPIC_API_KEY)." });
    const b = req.body ?? {};
    const language = isLanguage(b.language) ? b.language : "hinglish";
    try {
      chargeModelCall(req.device!.id, "plan");
      const files = Array.isArray(b.files) ? b.files.slice(0, 6) : [];
      for (const f of files) {
        const r = checkFile(f);
        if (!r.ok) return void res.status(400).json({ error: r.error });
      }
      const plan = await withModelSlot(() =>
        makePlan({
          topic: typeof b.topic === "string" ? b.topic.slice(0, 120) : "",
          grade: /^(8|9|10|11|12)$/.test(String(b.grade)) ? String(b.grade) : "10",
          language,
          files: files.map((f: { mediaType: string; data: string }) => ({ mediaType: f.mediaType, data: f.data })),
        }),
      );
      if (plan.readable === "no") return void res.status(422).json({ error: `Couldn't read these notes: ${plan.readable_note || "try a flat, bright photo"}` });
      const draft: Draft = { id: `p_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`, deviceId: req.device!.id, createdAt: Date.now(), plan, language };
      keepDraft(draft);
      res.json({ draftId: draft.id, plan: publicPlan(plan) });
    } catch (err) {
      if (sendLimitError(res, err) !== false) return;
      console.error("[plan] failed", (err as Error).message);
      res.status(500).json({ error: "Could not make a plan. Try again or start without one." });
    }
  });

  // ---------- learners ----------
  api.get("/learners", (req, res) => {
    res.json({ learners: listLearners(req.device!.id).map(publicLearner) });
  });

  api.post("/learners", small, (req, res) => {
    try {
      const l = createLearner(req.device!.id, req.body ?? {});
      res.status(201).json({ learner: publicLearner(l) });
    } catch (err) {
      if (err instanceof LearnerError) return void res.status(400).json({ error: err.message });
      throw err;
    }
  });

  const ownLearner = (req: Request, res: Response) => {
    const l = learnerForDevice(req.params.id, req.device!.id);
    if (!l) res.status(404).json({ error: "That learner doesn't exist on this device." });
    return l;
  };

  api.patch("/learners/:id", small, (req, res) => {
    const l = ownLearner(req, res);
    if (!l) return;
    updateLearner(l, req.body ?? {});
    res.json({ learner: publicLearner(l) });
  });

  // ---------- phone revision (Phase 7): consent and settings, per learner ----------
  api.get("/learners/:id/phone", (req, res) => {
    const l = ownLearner(req, res);
    if (!l) return;
    res.json({ phone: publicPhone(l) });
  });
  api.put("/learners/:id/phone", small, (req, res) => {
    const l = ownLearner(req, res);
    if (!l) return;
    try {
      enrolPhone(l, req.body ?? {});
      res.json({ phone: publicPhone(l) });
    } catch (err) {
      if (err instanceof PhoneError) return void res.status(400).json({ error: err.message });
      throw err;
    }
  });
  api.post("/learners/:id/phone/opt-out", (req, res) => {
    const l = ownLearner(req, res);
    if (!l) return;
    optOut(l.id, "app");
    res.json({ phone: publicPhone(l) });
  });
  api.delete("/learners/:id/phone", (req, res) => {
    const l = ownLearner(req, res);
    if (!l) return;
    removePhone(l.id);
    res.json({ phone: publicPhone(l) });
  });

  api.delete("/learners/:id", (req, res) => {
    const l = ownLearner(req, res);
    if (!l) return;
    revokeAllFor(l.id);
    removePhone(l.id);
    deleteLearner(l, (sid) => {
      const s = getSession(sid);
      if (s && s.deviceId === req.device!.id) {
        s.learnerId = null;
        save(s);
      }
    });
    res.status(204).end();
  });

  /** Everything recorded about a learner, with the evidence behind it. */
  api.get("/learners/:id/memory", (req, res) => {
    const l = ownLearner(req, res);
    if (!l) return;
    const m = memoryOf(l, (id) => {
      const s = getSession(id);
      return s ? { id: s.id, topic: s.topic || s.label, lastActive: s.lastActive } : null;
    });
    res.json({ learner: publicLearner(l), memory: m });
  });

  api.post("/learners/:id/reset-memory", (req, res) => {
    const l = ownLearner(req, res);
    if (!l) return;
    resetLearnerMemory(l);
    res.json({ ok: true });
  });

  /** "That's not what I did": an inferred misconception is removed from this learner's record. */
  api.post("/learners/:id/misconceptions/:mid/reject", (req, res) => {
    const l = ownLearner(req, res);
    if (!l) return;
    const mid = String(req.params.mid);
    if (!MISCONCEPTIONS.some((m) => m.id === mid)) return void res.status(404).json({ error: "Unknown misconception" });
    if (!l.rejectedMisconceptions.some((r) => r.id === mid)) l.rejectedMisconceptions.push({ id: mid, at: Date.now() });
    saveLearner(l);
    res.json({ ok: true });
  });

  api.post("/learners/:id/misconceptions/:mid/restore", (req, res) => {
    const l = ownLearner(req, res);
    if (!l) return;
    l.rejectedMisconceptions = l.rejectedMisconceptions.filter((r) => r.id !== String(req.params.mid));
    saveLearner(l);
    res.json({ ok: true });
  });

  // ---------- sharing with a teacher ----------
  api.post("/learners/:id/shares", (req, res) => {
    const l = ownLearner(req, res);
    if (!l) return;
    const c = createShareCode(l);
    res.status(201).json({ code: c.code, expiresAt: c.expiresAt });
  });

  api.get("/learners/:id/shares", (req, res) => {
    const l = ownLearner(req, res);
    if (!l) return;
    res.json({ grants: grantsFor({ learnerId: l.id }).map((g) => ({ id: g.id, teacher: g.teacherLabel, createdAt: g.createdAt })) });
  });

  api.delete("/learners/:id/shares/:gid", (req, res) => {
    const l = ownLearner(req, res);
    if (!l) return;
    if (!revokeGrant(String(req.params.gid), req.device!.id)) return void res.status(404).json({ error: "No such share" });
    res.status(204).end();
  });

  api.post("/teacher/claim", small, rateLimit((req) => `claim:${req.device!.id}`, 5, 5), (req, res) => {
    try {
      const g = claimShareCode(String(req.body?.code ?? ""), req.device!.id, String(req.body?.label ?? "Teacher"));
      res.status(201).json({ ok: true, learnerId: g.learnerId });
    } catch (err) {
      if (err instanceof ShareError) return void res.status(400).json({ error: err.message });
      throw err;
    }
  });

  const sessionSummary = (id: string) => {
    const s = getSession(id);
    return s ? { id: s.id, topic: s.topic || s.label, lastActive: s.lastActive } : null;
  };

  /** Only learners explicitly shared with this device. */
  api.get("/teacher/learners", (req, res) => {
    const out = grantsFor({ teacherDeviceId: req.device!.id })
      .map((g) => {
        const l = getLearnerSafe(g.learnerId);
        if (!l) return null;
        const m = memoryOf(l, sessionSummary);
        return {
          learner: { id: l.id, name: l.name, grade: l.grade },
          sharedAt: g.createdAt,
          evidence: m.evidenceCount,
          lastAt: m.topics[0]?.lastAt ?? null,
          topics: m.topics.map((t) => t.name),
          skills: m.progress.map((p) => ({ name: p.name, status: p.status })),
          recurring: m.mistakes.filter((x) => !x.resolved && x.count >= 1).map((x) => ({ name: x.name, count: x.count, confidence: x.confidence })),
        };
      })
      .filter(Boolean);
    res.json({ learners: out });
  });

  api.get("/teacher/learners/:learnerId", (req, res) => {
    const g = teacherGrant(req.device!.id, String(req.params.learnerId));
    const l = g ? getLearnerSafe(g.learnerId) : null;
    if (!g || !l) return void res.status(404).json({ error: "This learner hasn't been shared with you." });
    const m = memoryOf(l, sessionSummary);
    const reports = l.sessions
      .map((sid) => getSession(sid))
      .filter((s): s is Session => Boolean(s))
      .sort((a, b) => b.lastActive - a.lastActive)
      .slice(0, 20)
      .map((s) => reportFor(s));
    res.json({ learner: { id: l.id, name: l.name, grade: l.grade }, memory: m, reports });
  });

  // ---------- pilot (facilitator's device only) ----------
  const pilotErr = (res: Response, err: unknown) => {
    if (err instanceof PilotError) return void res.status(400).json({ error: err.message });
    throw err;
  };
  const ownParticipant = (req: Request, res: Response) => {
    const p = participantFor(String(req.params.pid), req.device!.id);
    if (!p) res.status(404).json({ error: "No such participant on this device." });
    return p;
  };
  const isForm = (f: unknown): f is FormId => f === "A" || f === "B" || f === "C";

  api.get("/pilot", (req, res) => {
    res.json({
      summary: summary(req.device!.id),
      participants: listParticipants(req.device!.id).map((p) => ({ id: p.id, code: p.code, consent: p.consent, forms: p.forms, issues: p.technicalIssues.length, feedback: Boolean(p.feedback) })),
    });
  });
  api.post("/pilot/participants", small, (req, res) => {
    try {
      const p = createParticipant(req.device!.id, req.body ?? {});
      res.status(201).json({ id: p.id, code: p.code });
    } catch (err) {
      pilotErr(res, err);
    }
  });
  api.delete("/pilot/participants/:pid", (req, res) => {
    const p = ownParticipant(req, res);
    if (!p) return;
    deleteParticipant(p);
    res.status(204).end();
  });
  api.post("/pilot/participants/:pid/forms/:form", (req, res) => {
    const p = ownParticipant(req, res);
    if (!p) return;
    if (!isForm(req.params.form)) return void res.status(404).json({ error: "No such form" });
    res.json(startForm(p, req.params.form));
  });
  api.post("/pilot/participants/:pid/forms/:form/answers", small, (req, res) => {
    const p = ownParticipant(req, res);
    if (!p) return;
    if (!isForm(req.params.form)) return void res.status(404).json({ error: "No such form" });
    try {
      // No right/wrong is sent back: this is a quiz, not practice.
      res.json(answerItem(p, req.params.form, String(req.body?.item ?? ""), String(req.body?.answer ?? ""), Number(req.body?.ms ?? 0)));
    } catch (err) {
      pilotErr(res, err);
    }
  });
  api.post("/pilot/participants/:pid/issues", small, (req, res) => {
    const p = ownParticipant(req, res);
    if (!p) return;
    noteIssue(p, String(req.body?.note ?? ""));
    res.json({ ok: true });
  });
  api.post("/pilot/participants/:pid/feedback", small, (req, res) => {
    const p = ownParticipant(req, res);
    if (!p) return;
    saveFeedback(p, req.body ?? {});
    res.json({ ok: true });
  });
  api.get("/pilot/forms/:form", (req, res) => {
    if (!isForm(req.params.form)) return void res.status(404).json({ error: "No such form" });
    res.json(publicForm(req.params.form));
  });
  api.get("/pilot/export.csv", (req, res) => {
    res.type("text/csv").setHeader("Content-Disposition", 'attachment; filename="shikshak-pilot.csv"');
    res.send(exportCsv(req.device!.id));
  });

  // ---------- end-of-class report ----------
  api.get("/sessions/:id/report", (req, res) => {
    const s = ownSession(req, res);
    if (s) res.json({ report: reportFor(s) });
  });

  // ---------- the student's own controls in class (work without the voice tutor too) ----------
  api.post("/sessions/:id/hint", (req, res) => {
    const s = ownSession(req, res);
    if (s) res.json(giveHint(s));
  });

  api.post("/sessions/:id/solution", (req, res) => {
    const s = ownSession(req, res);
    if (s) res.json(showSolution(s, true));
  });

  api.post("/sessions/:id/practice", small, (req, res) => {
    const s = ownSession(req, res);
    if (!s) return;
    const kind = req.body?.kind === "transfer" ? "transfer" : "practice";
    // Practise where the quick check said to start; otherwise stay on the current skill.
    const skillWanted = (s.diagnostic?.status === "done" && s.diagnostic.startSkill) || (s.problem?.kind !== "diagnostic" ? s.problem?.skill : null) || null;
    const p =
      pickProblem({ chapter: chapterForTopic(`${s.topic} ${s.study?.plan.topic ?? ""}`), skill: skillWanted, kind, exclude: s.used }) ??
      pickProblem({ chapter: chapterForTopic(`${s.topic} ${s.study?.plan.topic ?? ""}`), kind, exclude: s.used }) ??
      pickProblem({ chapter: chapterForTopic(`${s.topic} ${s.study?.plan.topic ?? ""}`), exclude: s.used });
    if (!p) return void res.status(404).json({ error: "No more checked problems for this topic yet." });
    askQuestion(s, p, kind);
    res.json({ ok: true, problem: p.statement });
  });

  /** An answer typed by the student (e.g. in the quick check). */
  api.post("/sessions/:id/answer", small, (req, res) => {
    const s = ownSession(req, res);
    if (!s) return;
    const answer = String(req.body?.answer ?? "").trim().slice(0, 200);
    if (!answer) return void res.status(400).json({ error: "Type your answer first." });
    res.json(checkSpoken(s, answer));
  });

  api.post("/sessions/:id/diagnostic", small, (req, res) => {
    const s = ownSession(req, res);
    if (!s) return;
    const action = String(req.body?.action ?? "start");
    if (action === "skip") {
      if (s.diagnostic?.status === "running") s.diagnostic.status = "skipped";
      else if (!s.diagnostic) s.diagnostic = { chapter: chapterForTopic(s.topic) ?? "ap", items: [], status: "skipped", startSkill: null, startedAt: Date.now() };
      save(s);
      return void res.json({ ok: true, diagnostic: publicDiagnostic(s) });
    }
    if (action === "skip_question" && s.diagnostic?.status === "running" && s.problem) {
      recordAttempt(s, attemptFor(s, { key: `${s.problem.id}:unanswered`, source: "diagnostic", outcome: "unanswered", note: "Skipped in the quick check" }));
      noteDiagnostic(s, s.problem.id, "unanswered");
      return void res.json({ ...nextDiagnostic(s), diagnostic: publicDiagnostic(s) });
    }
    const out = action === "next" || (action === "start" && s.diagnostic?.status === "running") ? nextDiagnostic(s) : startDiagnostic(s, null);
    res.json({ ...out, diagnostic: publicDiagnostic(s) });
  });

  // ---------- voice ----------
  api.post("/sessions/:id/voice", small, async (req, res) => {
    const s = ownSession(req, res);
    if (!s) return;
    const speed: Speed = ["slower", "normal", "faster"].includes(req.body?.speed) ? req.body.speed : "normal";
    const r = await mintVoice(s, { speed, resuming: req.body?.resuming === true, memory: memoryForCall(s) });
    if (r.callId) res.setHeader("X-Shikshak-Call", r.callId);
    res.status(r.status).json(r.body);
  });

  api.post("/sessions/:id/voice/end", small, (req, res) => {
    const s = ownSession(req, res);
    if (!s) return;
    endVoice(s, String(req.body?.callId ?? ""));
    res.json({ ok: true });
  });

  // Dev only: save the current notebook as a test case for the checker (see scripts/eval-checker.ts).
  if (opts.devTools && !config.production()) {
    api.post("/dev/save-sample", small, (req, res) => {
      const s = sessionForDevice(req.body?.session_id, req.device!.id);
      const latest = s ? [...s.captures.values()].filter((c) => c.png).at(-1) : undefined;
      if (!s || !latest?.png) return void res.status(400).json({ error: "Write something on the board and press Done first." });
      const saved = saveSample({
        png: latest.png,
        lineCount: latest.lineCount,
        problem: s.problem?.text ?? null,
        answer: s.problem?.answer,
        language: s.language,
        expected_status: req.body?.expected_status,
        expected_line: req.body?.expected_line ?? null,
      });
      res.json({ ok: true, ...saved });
    });
  }

  app.use("/api", api);
  app.use("/api", (_req, res) => void res.status(404).json({ error: "Not found" }));

  // Any error inside a route: a clean JSON reply, never a crash or a stack trace.
  app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === "entity.too.large") return void res.status(413).json({ error: "That upload is too big." });
    if (err.type === "entity.parse.failed") return void res.status(400).json({ error: "The request couldn't be read." });
    console.error("[api] error", err.message);
    res.status(err.status && err.status < 500 ? err.status : 500).json({ error: "Something went wrong on the server." });
  });

  function attachWebSocket(server: Server) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: config.limits.maxWsMessageBytes() });

    const reject = (socket: Duplex, code: number, text: string) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };

    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws") return; // leave other upgrades (Vite HMR) alone
      if (!originAllowed(req)) return reject(socket, 403, "Forbidden");
      if (!allow(`wsup:${ipOf(req)}`, 60, 20)) return reject(socket, 429, "Too Many Requests");
      const ticket = redeemTicket(url.searchParams.get("ticket"));
      const s = ticket ? getSession(ticket.sessionId) : null;
      if (!ticket || !s || s.deviceId !== ticket.deviceId) return reject(socket, 401, "Unauthorized");
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, s));
    });
    return wss;
  }

  function onConnection(ws: WebSocket, s: Session) {
    s.sockets.add(ws);
    touch(s);
    ws.send(JSON.stringify(welcome(s)));
    const conn = Math.random().toString(36).slice(2);
    let strikes = 0;
    const fail = (message: string) => {
      strikes++;
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ kind: "error", message }));
      if (strikes >= 5) ws.close(1008, "too many invalid messages");
    };

    ws.on("message", (raw, isBinary) => {
      try {
        if (isBinary) return fail("text messages only");
        if (!allow(`ws:${conn}`, 120, 40)) return fail("too many messages");
        let data: unknown;
        try {
          data = JSON.parse(String(raw));
        } catch {
          return fail("invalid JSON");
        }
        const parsed = parseClientMessage(data);
        if (!parsed.ok) return fail(parsed.error);
        const msg = parsed.msg;
        touch(s);
        switch (msg.kind) {
          case "sync":
            ws.send(JSON.stringify(welcome(s)));
            return;
          case "hydrate":
            if (hydrate(s, msg.snapshot)) ws.send(JSON.stringify(welcome(s, true)));
            return;
          case "interrupt":
            noteInterrupt(s);
            return;
          case "capture": {
            if (msg.png && Buffer.byteLength(msg.png.slice(msg.png.indexOf(",") + 1), "base64") > config.limits.maxCaptureBytes()) return fail("capture too large");
            if (msg.reason === "done" && !allow(`done:${s.id}`, 20, 4)) return fail("too many submissions");
            const capture = {
              id: msg.id,
              reason: msg.reason,
              requestId: msg.requestId ?? null,
              questionId: msg.questionId,
              png: msg.png,
              lineCount: msg.lineCount,
              lines: msg.lines,
              at: Date.now(),
              hash: hashPng(msg.png),
            };
            storeCapture(s, capture);
            if (capture.reason === "done") {
              reviewSubmission(s, capture, (result) => afterReview(s, capture, result)).catch((err) => console.error("[ws] review crashed", (err as Error).message));
            }
            return;
          }
        }
      } catch (err) {
        console.error("[ws] message handler failed", (err as Error).message);
        fail("server error");
      }
    });
    ws.on("error", (err) => console.warn("[ws] socket error", err.message));
    ws.on("close", () => s.sockets.delete(ws));
  }

  return { app, attachWebSocket };
}

/** Browsers send Origin on WebSocket upgrades: allow this site (and configured extra origins) only. */
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return !config.production(); // non-browser clients (tests, tools) only outside production
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  if (host === req.headers.host) return true;
  return config.allowedOrigins().some((o) => {
    try {
      return new URL(o).host === host;
    } catch {
      return false;
    }
  });
}
