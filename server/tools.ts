// HTTP endpoints the Bolna agent calls mid-conversation (configured as custom functions).
// Each one updates the student's screen over WebSocket and returns a short JSON reply
// that the agent's LLM reads before it speaks.

import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { splitSteps } from "../shared/mathText";
import { checkWork, type CheckResult } from "./checkWork";
import { hasClaude } from "./claude";
import { emit, resolve, touch, type Session } from "./sessions";

type Params = Record<string, unknown>;

/** Bolna may send params as a query string, a JSON body, or a form body. Accept all of them. */
function readParams(req: Request): Params {
  const params: Params = { ...(req.query as Params) };
  const body = req.body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) Object.assign(params, body);
  else if (typeof body === "string" && body.trim()) {
    try {
      Object.assign(params, JSON.parse(body));
    } catch {
      Object.assign(params, Object.fromEntries(new URLSearchParams(body)));
    }
  }
  return params;
}

const NO_SESSION = {
  ok: false,
  error: "The student's screen is not connected. Ask them to keep the Kalam tab open, then try again.",
};

/** Waits briefly for the browser to upload a fresh notebook snapshot after we ask for one. */
async function freshCanvas(s: Session, since: number, timeoutMs = 1500) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (s.canvas && s.canvas.at >= since) return s.canvas;
    await new Promise((r) => setTimeout(r, 50));
  }
  return s.canvas;
}

/** FAKE_CHECKER=1: always flags line 2 (or says correct for one line). For UI work without a Claude key. */
function fakeCheck(lineCount: number): CheckResult {
  if (lineCount < 2) return { status: "correct", line: null, what_went_wrong: "Looks right.", say: "Bilkul sahi! Shabash." };
  return {
    status: "mistake",
    line: 2,
    what_went_wrong: "The -3 should become +3 when it moves to the other side.",
    say: "Step 2 mein negative sign chhoot gaya. Dobara dekho.",
  };
}

export function toolsRouter() {
  const router = express.Router();
  router.use(express.text({ type: () => true, limit: "1mb" }));

  router.use((req, res, next) => {
    const token = process.env.TOOLS_TOKEN;
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    next();
  });

  router.all("/show_steps", (req: Request, res: Response) => {
    const p = readParams(req);
    const s = resolve(p.session_code);
    if (!s) return void res.json(NO_SESSION);
    const steps = splitSteps(p.steps);
    if (steps.length === 0) return void res.json({ ok: false, error: "No steps given. Pass steps separated by ||." });
    emit(s, { type: "steps", id: randomUUID(), title: String(p.title ?? "").trim(), steps });
    res.json({ ok: true, shown: steps.length, note: "The steps are being written on the board now. Explain them one at a time." });
  });

  router.all("/give_problem", (req: Request, res: Response) => {
    const p = readParams(req);
    const s = resolve(p.session_code);
    if (!s) return void res.json(NO_SESSION);
    const problem = String(p.problem ?? "").trim();
    if (!problem) return void res.json({ ok: false, error: "No problem given." });
    const answer = String(p.answer ?? "").trim() || undefined;
    s.problem = { text: problem, answer };
    s.canvas = null;
    emit(s, { type: "problem", id: randomUUID(), problem });
    res.json({
      ok: true,
      note: "The problem is on the student's notebook. Ask them to solve it one step per line, and to say when they are done.",
    });
  });

  router.all("/clear_board", (req: Request, res: Response) => {
    const s = resolve(readParams(req).session_code);
    if (!s) return void res.json(NO_SESSION);
    emit(s, { type: "clear" });
    res.json({ ok: true });
  });

  router.all("/check_work", async (req: Request, res: Response) => {
    const p = readParams(req);
    const s = resolve(p.session_code);
    if (!s) return void res.json(NO_SESSION);
    touch(s);

    const asked = Date.now();
    emit(s, { type: "checking" }); // the browser replies with a fresh snapshot
    const canvas = await freshCanvas(s, asked);

    if (!canvas || !canvas.png || canvas.lineCount === 0) {
      const result: CheckResult = {
        status: "empty",
        line: null,
        what_went_wrong: "Nothing is written in the notebook yet.",
        say: "",
      };
      emit(s, { type: "unclear", note: "Notebook is empty" });
      return void res.json({ ...result, note: "The notebook is empty. Encourage the student to start writing." });
    }
    const fake = process.env.FAKE_CHECKER === "1";
    if (!hasClaude() && !fake) {
      emit(s, { type: "unclear", note: "Checker isn't set up on the server" });
      return void res.json({ ok: false, error: "The checker is not set up (no ANTHROPIC_API_KEY on the server)." });
    }

    try {
      const result = fake ? fakeCheck(canvas.lineCount) : await checkWork({
        png: canvas.png,
        lineCount: canvas.lineCount,
        problem: s.problem?.text ?? null,
        answer: s.problem?.answer,
        language: String(p.language ?? s.language),
      });
      if (result.status === "mistake" && result.line) emit(s, { type: "mark", line: result.line, note: result.what_went_wrong });
      else if (result.status === "unreadable" && result.line) emit(s, { type: "mark", line: result.line, note: "Can't read this line" });
      else if (result.status === "correct") emit(s, { type: "correct", note: result.what_went_wrong });
      else emit(s, { type: "unclear", note: result.what_went_wrong });
      console.log(`[check_work] ${s.code} ${result.status} line=${result.line} ${result.what_went_wrong}`);
      res.json(result);
    } catch (err) {
      console.error("[check_work] failed", err);
      emit(s, { type: "unclear", note: "Checker failed" });
      res.json({ ok: false, error: "Could not check the work right now. Ask the student to read their last step aloud instead." });
    }
  });

  return router;
}
