import express from "express";
import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "../shared/types";
import { hasClaude } from "./claude";
import { makePlan } from "./plan";
import { getOrCreate, normalizeCode, touch } from "./sessions";
import { toolsRouter } from "./tools";

export function createApp() {
  const app = express();

  app.use("/tools", toolsRouter());
  app.use("/api", express.json({ limit: "20mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      claude: hasClaude(),
      bolna: Boolean(process.env.BOLNA_API_KEY && process.env.BOLNA_AGENT_ID),
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

  app.post("/api/plan", async (req, res) => {
    if (!hasClaude()) {
      res.status(503).json({ error: "Planner is not set up (no ANTHROPIC_API_KEY)." });
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
