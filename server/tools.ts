// HTTP endpoints the Bolna agent calls mid-conversation (configured as custom functions).
// Each one updates the shared board over WebSocket and returns a short JSON reply that the
// agent's LLM reads before it speaks.
//
// Security: in production every call must carry the shared TOOLS_TOKEN (set on the agent's tool
// config, never in the browser). The session a call names must exist exactly; there is no
// fallback to another session. Calls are rate limited per session.

import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { splitSteps } from "../shared/mathText";
import { randomId, sameSecret } from "./auth";
import { continueLesson, draw, erase, highlight, newQuestionId, write } from "./board";
import { config } from "./config";
import { allow } from "./limits";
import { analyze, canLook, EMPTY_LOOK, isCurrent, publishResult } from "./look";
import { readMaterial, showPage } from "./material";
import { awaitCapture, boardMap, emit, nextLabel, recordBlock, resolve, signal, touch, type Session } from "./sessions";
import { teachingTools } from "./teaching";

type Params = Record<string, unknown>;

/** Bolna may send params as a query string, a JSON body, or a form body. Accept all of them. */
export function readParams(req: Request): Params {
  const params: Params = {};
  for (const [k, v] of Object.entries(req.query)) if (typeof v === "string") params[k] = v.slice(0, 4000);
  const body = req.body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body) && !Array.isArray(body)) Object.assign(params, body);
  else if (typeof body === "string" && body.trim()) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) Object.assign(params, parsed);
    } catch {
      Object.assign(params, Object.fromEntries(new URLSearchParams(body)));
    }
  }
  return params;
}

const NO_SESSION = {
  ok: false,
  error: "The student's screen is not connected. Ask them to keep the Shikshak tab open, then try again.",
};

/** "next", "agla", "3", "३" -> a number (1-based) or "next". */
export function parsePick(raw: unknown): number | "next" | null {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text || /^(next|agla|अगला|aage)$/.test(text)) return "next";
  const digits = text.replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)));
  const n = parseInt(digits.replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function noPlan(res: Response) {
  res.json({ ok: false, error: "There is no prepared plan. Teach with show_steps and make up problems with give_problem." });
}

async function lookAtBoard(req: Request, res: Response) {
  const p = readParams(req);
  const s = resolve(p.session_code);
  if (!s) return void res.json(NO_SESSION);
  touch(s);

  if (!s.sockets.size) {
    return void res.json({ ...EMPTY_LOOK, ok: false, note: "The student's board isn't open right now, so you can't see their work. Ask them to read it aloud." });
  }
  // Ask the browser for the student's latest work, and wait for that exact reply. Older work is never graded instead.
  const requestId = `r_${randomId(9)}`;
  signal(s, { type: "checking", requestId });
  const capture = await awaitCapture(s, requestId);

  if (!capture) {
    signal(s, { type: "unclear", note: "Couldn't get your latest work" });
    return void res.json({ ...EMPTY_LOOK, ok: false, note: "The student's screen didn't send their work in time. Ask them to press Done, or to read it aloud." });
  }
  if (!capture.png || capture.lineCount === 0) {
    signal(s, { type: "unclear", note: "Nothing new written yet" });
    return void res.json({
      ...EMPTY_LOOK,
      note: "Nothing new is written on the board for the current question. Ask if they are able to write; if not, tell them to tap the bin icon and try again.",
    });
  }
  if (!isCurrent(s, capture)) {
    signal(s, { type: "unclear", note: "Your screen hasn't caught up with the new question yet" });
    return void res.json({ ...EMPTY_LOOK, ok: false, note: "The student's screen is still on an older question. Wait a moment and ask them to write their answer under the new one." });
  }
  if (!canLook()) {
    signal(s, { type: "unclear", note: "Checker isn't set up on the server" });
    return void res.json({ ok: false, error: "The board reader is not set up (no model key on the server)." });
  }

  try {
    const studentSaid = String(p.student_said ?? p.question ?? "").trim().slice(0, 500) || undefined;
    const result = await analyze(s, capture, studentSaid);
    const published = publishResult(s, capture, result);
    if (result.status === "empty") signal(s, { type: "unclear", note: "Nothing new written yet" });
    console.log(`[look] ${s.label} ${result.kind}/${result.status} line=${result.line}${published ? "" : " (stale, not shown)"}`);
    res.json(published ? result : { ...result, note: "A newer question or newer work arrived while reading; this result wasn't shown on the board." });
  } catch (err) {
    const e = err as Error;
    console.error("[look] failed", e.message);
    signal(s, { type: "unclear", note: "Couldn't read the board" });
    res.json({ ok: false, error: e.name === "QuotaError" || e.name === "BusyError" ? e.message : "Could not read the board right now. Ask the student to read their work aloud instead." });
  }
}

function showSection(s: Session, pick: number | "next") {
  const study = s.study!;
  const total = study.plan.sections.length;
  let n: number;
  if (pick === "next") {
    // The LLM sometimes fires the same call twice; don't skip a section.
    const repeat = Date.now() - study.lastSectionAt < 4000 && study.section > 0;
    n = repeat ? study.section : study.section + 1;
  } else n = pick;
  if (n > total) return { ok: true, done: true, note: `All ${total} sections are done. Give practice with give_practice, or ask what to revise.` };
  if (n < 1) return { ok: false, error: `The plan has sections 1 to ${total}.` };

  const sec = study.plan.sections[n - 1];
  const already = n === study.section && Date.now() - study.lastSectionAt < 4000;
  study.section = n;
  study.lastSectionAt = Date.now();
  let label = study.lastLabel;
  if (!already) {
    label = nextLabel(s);
    recordBlock(s, { label, kind: `plan section ${n}`, summary: `${sec.title}: ${sec.board.join(" / ")}`.slice(0, 120), lines: sec.board.length });
    study.lastLabel = label;
    emit(s, { type: "steps", id: randomUUID(), label, title: sec.title, steps: sec.board, section: { n, of: total } });
  }
  return {
    ok: true,
    section: n,
    of: total,
    label,
    written: sec.board.join(" | "),
    say: sec.say,
    ask: sec.ask,
    next: n < total ? `${n + 1}: ${study.plan.sections[n].title}` : "practice",
    note: "The lines appear one by one while you speak. Give the idea in your own words, line by line, ask the question, then stop and wait.",
  };
}

/** Production requires the shared tool token; in development it's optional (but checked if set). */
export function toolAuth(req: Request, res: Response, next: NextFunction) {
  const token = config.toolsToken();
  if (!token) {
    if (config.production()) {
      res.status(503).json({ ok: false, error: "Tools are disabled: TOOLS_TOKEN is not configured on the server." });
      return;
    }
    return next();
  }
  const h = req.headers.authorization ?? "";
  if (!sameSecret(h.startsWith("Bearer ") ? h.slice(7) : undefined, token)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  next();
}

export function toolsRouter() {
  const router = express.Router();
  router.use(toolAuth);
  router.use(express.text({ type: () => true, limit: "64kb" }));

  // Per-session rate limit: a confused LLM in a loop can't flood a board or burn model calls.
  router.use((req, res, next) => {
    const p = readParams(req);
    const key = `tool:${String(p.session_code ?? "none").slice(0, 60)}`;
    if (!allow(key, 90, 30)) {
      res.status(429).json({ ok: false, error: "Too many board actions in a short time. Slow down and explain before writing more." });
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
    const label = nextLabel(s);
    const title = String(p.title ?? "").trim().slice(0, 200);
    recordBlock(s, { label, kind: "steps", summary: `${title ? title + ": " : ""}${steps.join(" / ")}`.slice(0, 120), lines: steps.length });
    emit(s, { type: "steps", id: randomUUID(), label, title, steps: steps.slice(0, 12) });
    res.json({ ok: true, label, note: "The lines appear one by one while you speak. Explain them in order.", board: boardMap(s) });
  });

  router.all("/give_problem", (req: Request, res: Response) => {
    const p = readParams(req);
    const s = resolve(p.session_code);
    if (!s) return void res.json(NO_SESSION);
    const problem = String(p.problem ?? "").trim().slice(0, 600);
    if (!problem) return void res.json({ ok: false, error: "No problem given." });
    const answer = String(p.answer ?? "").trim().slice(0, 200) || undefined;
    const questionId = newQuestionId();
    s.problem = { id: questionId, text: problem, answer, kind: "tutor", askedAt: Date.now(), rung: 0 };
    const label = nextLabel(s);
    recordBlock(s, { label, kind: "problem", summary: problem.slice(0, 120), lines: 1 });
    emit(s, { type: "problem", id: randomUUID(), label, problem, questionId, kind: "practice" });
    res.json({
      ok: true,
      question_id: questionId,
      note: "The problem is on the board. Ask them to solve it below it, one step per line, and to press Done or say when they finish.",
    });
  });

  router.all("/show_section", (req: Request, res: Response) => {
    const p = readParams(req);
    const s = resolve(p.session_code);
    if (!s) return void res.json(NO_SESSION);
    if (!s.study) return void noPlan(res);
    const pick = parsePick(p.section);
    if (pick === null) return void res.json({ ok: false, error: `Pass 'next' or a section number 1 to ${s.study.plan.sections.length}.` });
    res.json(showSection(s, pick));
  });

  router.all("/give_practice", (req: Request, res: Response) => {
    const p = readParams(req);
    const s = resolve(p.session_code);
    if (!s) return void res.json(NO_SESSION);
    if (!s.study || s.study.plan.practice.length === 0) return void noPlan(res);
    const list = s.study.plan.practice;
    const pick = parsePick(p.number);
    const n = pick === "next" || pick === null ? s.study.practice + 1 : pick;
    if (n > list.length) return void res.json({ ok: true, done: true, note: "All prepared practice is done. Use next_problem for a checked problem, or give_problem." });
    const item = list[n - 1];
    s.study.practice = n;
    const questionId = newQuestionId();
    s.problem = { id: questionId, text: item.problem, answer: item.answer, hint: item.hint, kind: "practice", askedAt: Date.now(), rung: 0 };
    const label = nextLabel(s);
    recordBlock(s, { label, kind: "problem", summary: item.problem.slice(0, 120), lines: 1 });
    emit(s, { type: "problem", id: randomUUID(), label, problem: item.problem, questionId, kind: "practice" });
    res.json({
      ok: true,
      practice: n,
      of: list.length,
      problem: item.problem,
      question_id: questionId,
      note: "The problem is on the board. Ask them to solve it below it, one step per line, and press Done when finished. If they're stuck, use give_hint. You don't know the answer; look_at_board checks it.",
    });
  });

  router.all("/clear_board", (req: Request, res: Response) => {
    const s = resolve(readParams(req).session_code);
    if (!s) return void res.json(NO_SESSION);
    res.json(erase(s, { target: "all" }));
  });

  // The teacher's board actions. Each takes session_code plus its own params.
  const boardAction = (fn: (s: Session, p: Params) => Record<string, unknown>) => (req: Request, res: Response) => {
    const p = readParams(req);
    const s = resolve(p.session_code);
    if (!s) return void res.json(NO_SESSION);
    res.json(fn(s, p));
  };
  router.all("/write", boardAction(write));
  router.all("/draw", boardAction(draw));
  router.all("/highlight", boardAction(highlight));
  router.all("/erase", boardAction(erase));
  router.all("/continue_lesson", boardAction((s) => continueLesson(s)));

  router.all("/read_material", async (req: Request, res: Response) => {
    const p = readParams(req);
    const s = resolve(p.session_code);
    if (!s) return void res.json(NO_SESSION);
    res.json(await readMaterial(s, String(p.question ?? "")));
  });
  router.all("/show_page", boardAction(showPage));

  router.all("/look_at_board", lookAtBoard);
  // Older agents call it check_work.
  router.all("/check_work", lookAtBoard);

  // Checked maths, hint ladder, diagnostic and next-step planning (server/teaching.ts).
  teachingTools(router, { readParams, resolve, NO_SESSION });

  return router;
}
