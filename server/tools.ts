// HTTP endpoints the Bolna agent calls mid-conversation (configured as custom functions).
// Each one updates the shared board over WebSocket and returns a short JSON reply that the
// agent's LLM reads before it speaks.

import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { splitSteps } from "../shared/mathText";
import { continueLesson, draw, erase, highlight, write } from "./board";
import { analyze, canLook, EMPTY_LOOK } from "./look";
import { boardMap, emit, freshCapture, nextLabel, recordBlock, resolve, touch, type Session } from "./sessions";

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

  const asked = Date.now();
  emit(s, { type: "checking" }); // the browser replies with a capture of the student's latest work
  const capture = await freshCapture(s, asked);

  if (!capture || !capture.png || capture.lineCount === 0) {
    emit(s, { type: "unclear", note: "Nothing new written yet" });
    return void res.json({
      ...EMPTY_LOOK,
      note: "Nothing new is written on the board below the latest question. Ask if they are able to write; if not, tell them to tap the bin icon and try again.",
    });
  }
  if (!canLook()) {
    emit(s, { type: "unclear", note: "Checker isn't set up on the server" });
    return void res.json({ ok: false, error: "The board reader is not set up (no GEMINI_API_KEY on the server)." });
  }

  try {
    const studentSaid = String(p.student_said ?? p.question ?? "").trim() || undefined;
    const result = await analyze(s, capture, studentSaid);
    if ((result.status === "mistake" || result.status === "unreadable") && result.line) {
      emit(s, {
        type: "mark",
        captureId: capture.id,
        line: result.line,
        note: result.status === "unreadable" ? "Can't read this line" : result.what_went_wrong,
      });
    } else if (result.status === "correct") emit(s, { type: "correct", captureId: capture.id, note: result.what_went_wrong });
    else if (result.status === "empty") emit(s, { type: "unclear", note: "Nothing new written yet" });
    console.log(`[look] ${s.code} ${result.kind}/${result.status} line=${result.line} ${result.what_went_wrong}`);
    res.json(result);
  } catch (err) {
    console.error("[look] failed", err);
    emit(s, { type: "unclear", note: "Couldn't read the board" });
    res.json({ ok: false, error: "Could not read the board right now. Ask the student to read their work aloud instead." });
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
    const label = nextLabel(s);
    const title = String(p.title ?? "").trim();
    recordBlock(s, { label, kind: "steps", summary: `${title ? title + ": " : ""}${steps.join(" / ")}`.slice(0, 120), lines: steps.length });
    emit(s, { type: "steps", id: randomUUID(), label, title, steps });
    res.json({ ok: true, label, note: "The lines appear one by one while you speak. Explain them in order.", board: boardMap(s) });
  });

  router.all("/give_problem", (req: Request, res: Response) => {
    const p = readParams(req);
    const s = resolve(p.session_code);
    if (!s) return void res.json(NO_SESSION);
    const problem = String(p.problem ?? "").trim();
    if (!problem) return void res.json({ ok: false, error: "No problem given." });
    const answer = String(p.answer ?? "").trim() || undefined;
    s.problem = { text: problem, answer };
    const label = nextLabel(s);
    recordBlock(s, { label, kind: "problem", summary: problem.slice(0, 120), lines: 1 });
    emit(s, { type: "problem", id: randomUUID(), label, problem });
    res.json({
      ok: true,
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
    if (n > list.length) return void res.json({ ok: true, done: true, note: "All prepared practice is done. Make up a harder one with give_problem." });
    const item = list[n - 1];
    s.study.practice = n;
    s.problem = { text: item.problem, answer: item.answer, hint: item.hint };
    const label = nextLabel(s);
    recordBlock(s, { label, kind: "problem", summary: item.problem.slice(0, 120), lines: 1 });
    emit(s, { type: "problem", id: randomUUID(), label, problem: item.problem });
    res.json({
      ok: true,
      practice: n,
      of: list.length,
      problem: item.problem,
      hint: item.hint,
      note: "The problem is on the board. Ask them to solve it below it, one step per line, and press Done when finished. Give the hint only if asked. You don't know the answer; look_at_board checks it.",
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

  router.all("/look_at_board", lookAtBoard);
  // Older agents call it check_work.
  router.all("/check_work", lookAtBoard);

  return router;
}
