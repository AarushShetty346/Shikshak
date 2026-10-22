import express from "express";
import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { VOICE_LANGUAGE, type ClientMessage, type Language, type ServerMessage } from "../shared/types";
import { hasModel, modelName } from "./llm";
import { randomUUID } from "node:crypto";
import { lessonState, noteInterrupt } from "./board";
import { reviewSubmission } from "./look";
import { addDocs, docList } from "./material";
import { makePlan, outlineFor } from "./plan";
import { saveSample } from "./samples";
import { emit, getOrCreate, hashPng, hydrate, normalizeCode, resolve, touch } from "./sessions";
import type { StudyPlan } from "./plan";
import { toolsRouter } from "./tools";

/** "98765 43210" -> "+919876543210". Accepts full international numbers starting with +. */
export function toE164(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return null;
}

/** Starts the multilingual agent in the student's language: Hindi and Hinglish -> "hi", English -> "en". */
export function agentLanguage(userData: Record<string, unknown>): { agent_data?: { language: string } } {
  const lang = VOICE_LANGUAGE[userData.language as Language];
  return lang ? { agent_data: { language: lang } } : {};
}

/** Bolna can't change voice speed mid-call, so there's one agent per speed (set up by bolna:setup). */
export function agentForSpeed(speed: unknown): string | undefined {
  if (speed === "slower") return process.env.BOLNA_AGENT_ID_SLOW || undefined;
  if (speed === "faster") return process.env.BOLNA_AGENT_ID_FAST || undefined;
  return undefined;
}

export function createApp(opts: { devTools?: boolean } = {}) {
  const app = express();

  app.use("/tools", toolsRouter());
  app.use("/api", express.json({ limit: "20mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      checker: hasModel(),
      model: modelName(),
      bolna: Boolean(process.env.BOLNA_API_KEY && process.env.BOLNA_AGENT_ID),
      fakeChecker: !hasModel() && process.env.FAKE_CHECKER === "1",
      publicUrl: Boolean(process.env.PUBLIC_URL && !process.env.PUBLIC_URL.includes("example.com")),
    });
  });

  // Thin proxy that mints a short-lived Bolna web-call session. The API key never reaches the browser.
  app.post("/api/bolna-session", async (req, res) => {
    const key = process.env.BOLNA_API_KEY;
    const agentId = process.env.BOLNA_AGENT_ID;
    if (!key || !agentId) {
      res.status(503).json({ error: "Voice is not set up yet: add BOLNA_API_KEY and BOLNA_AGENT_ID to .env" });
      return;
    }
    const userData = { ...(req.body?.user_data ?? {}) };
    if (userData.session_code) {
      const s = getOrCreate(userData.session_code);
      if (userData.language) s.language = String(userData.language);
      // Resuming after Pause: tell the tutor what's on the board and where the lesson was.
      userData.lesson_state = lessonState(s) || "New class: nothing has been taught yet.";
      userData.material = docList(s);
    }
    try {
      const r = await fetch("https://api.bolna.ai/web-call/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentForSpeed(userData.speed) ?? agentId, user_data: userData, ...agentLanguage(userData) }),
      });
      const text = await r.text();
      res.status(r.status).type("application/json").send(text);
    } catch (err) {
      console.error("[bolna-session] failed", err);
      res.status(502).json({ error: "Could not reach Bolna" });
    }
  });

  // Fallback when browser calls aren't available: Bolna phones the student, and the board in this tab
  // still updates, because the call carries the same session code.
  app.post("/api/phone-call", async (req, res) => {
    const key = process.env.BOLNA_API_KEY;
    const agentId = process.env.BOLNA_AGENT_ID;
    if (!key || !agentId) {
      res.status(503).json({ error: "Voice isn't set up yet: add BOLNA_API_KEY and BOLNA_AGENT_ID to .env" });
      return;
    }
    const phone = toE164(req.body?.phone);
    if (!phone) {
      res.status(400).json({ error: "Enter a 10-digit Indian mobile number, or a full number starting with +" });
      return;
    }
    const userData = req.body?.user_data ?? {};
    if (userData.session_code) getOrCreate(userData.session_code);
    try {
      const r = await fetch("https://api.bolna.ai/call", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          recipient_phone_number: phone,
          user_data: userData,
          bypass_call_guardrails: true,
          ...agentLanguage(userData),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error("[phone-call] Bolna error", r.status, data);
        res.status(502).json({ error: "Bolna couldn't place the call. Check that your account has a phone number." });
        return;
      }
      res.json({ ok: true, execution_id: data.execution_id });
    } catch (err) {
      console.error("[phone-call] failed", err);
      res.status(502).json({ error: "Could not reach Bolna" });
    }
  });

  // Dev only: save the current notebook as a test case for the checker (see scripts/eval-checker.ts).
  if (opts.devTools) {
    app.post("/api/dev/save-sample", (req, res) => {
      const s = resolve(req.body?.session_code);
      if (!s?.capture?.png) {
        res.status(400).json({ error: "Write something on the board and press Done first." });
        return;
      }
      const saved = saveSample({
        png: s.capture.png,
        lineCount: s.capture.lineCount,
        problem: s.problem?.text ?? null,
        answer: s.problem?.answer,
        language: s.language,
        expected_status: req.body?.expected_status,
        expected_line: req.body?.expected_line ?? null,
      });
      res.json({ ok: true, ...saved });
    });
  }

  // Upload material into a session (home screen or mid-lesson). Kept in memory for that session only.
  app.post("/api/documents", (req, res) => {
    const code = normalizeCode(req.body?.session_code);
    if (!code) {
      res.status(400).json({ error: "Missing session" });
      return;
    }
    const s = getOrCreate(code);
    const result = addDocs(s, Array.isArray(req.body?.files) ? req.body.files : []);
    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }
    touch(s);
    res.json({ ok: true, docs: result.docs });
  });

  app.post("/api/plan", async (req, res) => {
    if (!hasModel()) {
      res.status(503).json({ error: "Planner is not set up (no GEMINI_API_KEY or ANTHROPIC_API_KEY)." });
      return;
    }
    try {
      const plan = await makePlan(req.body ?? {});
      if (plan.readable === "no") {
        res.status(422).json({ error: `Couldn't read these notes: ${plan.readable_note || "try a flat, bright photo"}` });
        return;
      }
      const code = normalizeCode(req.body?.session_code);
      if (code) {
        const s = getOrCreate(code);
        if (Array.isArray(req.body?.files) && req.body.files.length && !s.docs.length) addDocs(s, req.body.files);
        s.study = { plan, section: 0, practice: 0, lastSectionAt: 0 };
        if (req.body?.language) s.language = String(req.body.language);
        // The plan opens the board. A new plan (e.g. after changing language) replaces the old one.
        s.history = s.history.filter((e) => e.type !== "plan");
        emit(s, { type: "plan", id: randomUUID(), title: plan.title, items: plan.sections.map((x) => x.title) });
      }
      res.json({ plan, outline: outlineFor(plan) });
    } catch (err) {
      console.error("[plan] failed", err);
      res.status(500).json({ error: "Could not make a plan. Try again or start without one." });
    }
  });

  function attachWebSocket(server: Server) {
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws") return; // leave other upgrades (Vite HMR) alone
      wss.handleUpgrade(req, socket, head, (ws) => {
        const code = normalizeCode(url.searchParams.get("code"));
        if (!code) return ws.close(1008, "missing code");
        const s = getOrCreate(code);
        s.sockets.add(ws);
        touch(s);
        const welcome: ServerMessage = { kind: "welcome", sessionCode: s.code, replay: s.history, docs: s.docs.map(({ data: _d, ...meta }) => meta) };
        ws.send(JSON.stringify(welcome));

        ws.on("message", (raw) => {
          let msg: ClientMessage;
          try {
            msg = JSON.parse(String(raw));
          } catch {
            return;
          }
          if (msg.kind === "hydrate") {
            if (Array.isArray(msg.events)) hydrate(s, msg.events, (msg.study as StudyPlan | null) ?? null);
            return;
          }
          if (msg.kind === "interrupt") {
            noteInterrupt(s);
            touch(s);
            return;
          }
          if (msg.kind === "capture") {
            const capture = {
              id: String(msg.id || randomUUID()),
              reason: msg.reason === "done" ? ("done" as const) : ("request" as const),
              png: msg.png,
              lineCount: Number(msg.lineCount) || 0,
              at: Date.now(),
              hash: hashPng(msg.png),
            };
            s.capture = capture;
            touch(s);
            // Done: acknowledge, read it at once, and show the result (so the tutor's look is instant too).
            if (capture.reason === "done") void reviewSubmission(s, capture);
          }
        });
        ws.on("close", () => s.sockets.delete(ws));
      });
    });
    return wss;
  }

  return { app, attachWebSocket };
}
