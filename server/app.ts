import express from "express";
import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "../shared/types";
import { hasModel, modelName } from "./llm";
import { makePlan } from "./plan";
import { saveSample } from "./samples";
import { getOrCreate, normalizeCode, resolve, touch } from "./sessions";
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
    const userData = req.body?.user_data ?? {};
    if (userData.session_code) {
      const s = getOrCreate(userData.session_code);
      if (userData.language) s.language = String(userData.language);
    }
    try {
      const r = await fetch("https://api.bolna.ai/web-call/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId, user_data: userData }),
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
        body: JSON.stringify({ agent_id: agentId, recipient_phone_number: phone, user_data: userData, bypass_call_guardrails: true }),
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
      if (!s?.canvas?.png) {
        res.status(400).json({ error: "Write something in the notebook first." });
        return;
      }
      const saved = saveSample({
        png: s.canvas.png,
        lineCount: s.canvas.lineCount,
        problem: s.problem?.text ?? null,
        answer: s.problem?.answer,
        language: s.language,
        expected_status: req.body?.expected_status,
        expected_line: req.body?.expected_line ?? null,
      });
      res.json({ ok: true, ...saved });
    });
  }

  app.post("/api/plan", async (req, res) => {
    if (!hasModel()) {
      res.status(503).json({ error: "Planner is not set up (no GEMINI_API_KEY or ANTHROPIC_API_KEY)." });
      return;
    }
    try {
      res.json(await makePlan(req.body ?? {}));
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
        const welcome: ServerMessage = { kind: "welcome", sessionCode: s.code, replay: s.history };
        ws.send(JSON.stringify(welcome));

        ws.on("message", (raw) => {
          let msg: ClientMessage;
          try {
            msg = JSON.parse(String(raw));
          } catch {
            return;
          }
          if (msg.kind === "canvas") {
            s.canvas = { png: msg.png, lineCount: msg.lineCount, at: Date.now() };
            touch(s);
          }
        });
        ws.on("close", () => s.sockets.delete(ws));
      });
    });
    return wss;
  }

  return { app, attachWebSocket };
}
