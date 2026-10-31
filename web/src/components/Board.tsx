// The shared blackboard: the whole screen, one long page that the tutor and the student both
// write on. The tutor's blocks (writing, diagrams, problems) are placed in free space below or
// beside what is already there, never over the student's ink, and are revealed piece by piece
// only while the tutor is actually speaking, so the board keeps pace with her voice. When the
// student interrupts, unfinished writing pauses and continues after the doubt is answered.
//
// Everything is laid out in board units. The page's unit width is fixed for the session (from the
// screen it started on) and scales to the screen, so writing lines up on a phone or a laptop.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { diagramPieces, type Diagram } from "../../../shared/diagram";
import { groupIntoLines, strokeBox } from "../../../shared/lines";
import type { Box, ClientMessage, FixQuestion, CorrectState, HighlightState, HintLevel, MarkState, PhotoBand, Place, Point, SectionInfo, Stroke, WriteStyle } from "../../../shared/types";
import { makePhotoSnapshot, makeSnapshot } from "../lib/snapshot";
import { getDoc } from "../lib/docStore";
import { renderPdfPage } from "../lib/files";
import { DiagramView, diagramHeight } from "./DiagramView";
import { MathText } from "./MathText";
import { TypePanel } from "./TypePanel";
import { EditableGraph } from "./EditableGraph";
import { ArrowCounterClockwise, ArrowDown, BookOpenText, Camera, Check, CheckCircle, Eraser, HandGrabbing, Lightbulb, MagicWand, PauseCircle, PencilSimple, SealCheck, TextT, Trash, ArrowUp, X } from "@phosphor-icons/react";

const PAD_L = 38; // room for the student's line numbers
const PAD_R = 22;
const GAP = 34;
const PAGE_GAP = 160;
/** Room at the top of the page, in screen pixels, for the menu, the class pill and the tutor. */
const TOP_PX = 92;
const INK = "#9fd3ff";
const PEN_WIDTH = 3.2;
const ERASER_RADIUS = 18;
/**
 * Seconds of the tutor's speech before the next line or diagram piece appears: about one short
 * spoken sentence per line, a little longer for a long line, so the board keeps pace with her
 * explanation instead of racing ahead of it.
 */
function speechFor(b: TutorBlock, piece: number): number {
  const text = b.kind === "write" ? b.lines[piece] : b.kind === "steps" ? b.steps[piece] : undefined;
  if (text === undefined) return 2.4;
  return Math.min(4.5, Math.max(2.2, 1.6 + text.length * 0.05));
}
/** When she has stopped talking but lines are still to come: wait this long, then show them at this pace. */
const QUIET_BEFORE_CATCH_UP = 3;
const CATCH_UP_PER_PIECE = 0.9;

export type TutorBlock =
  | { kind: "write"; id: string; label: string; style: WriteStyle; lines: string[]; place: Place; replaces: string | null; instant: boolean }
  | { kind: "draw"; id: string; label: string; diagram: Diagram; caption: string; place: Place; replaces: string | null; instant: boolean }
  | { kind: "steps"; id: string; label?: string; title: string; steps: string[]; section?: SectionInfo; checked?: boolean; instant: boolean }
  | { kind: "problem"; id: string; label?: string; problem: string; questionKind?: "practice" | "diagnostic" | "transfer"; instant: boolean }
  | { kind: "plan"; id: string; label?: string; title: string; items: string[]; instant: boolean }
  | { kind: "page"; id: string; instant: boolean }
  | { kind: "source"; id: string; label: string; docId: string; docName: string; page: number | null; caption: string; photo?: boolean; instant: boolean }
  | { kind: "fix"; id: string; label: string; photoLabel: string; docId: string; questions: FixQuestion[]; simulated?: boolean; instant: boolean }
  | { kind: "hint"; id: string; label: string; level: HintLevel; rung: number; of: number; text: string; instant: boolean };

/** Where the student's latest Done submission is. */
export interface Submission {
  captureId: string | null;
  state: "idle" | "submitting" | "reviewing" | "done" | "failed" | "stale";
  status?: string;
  summary?: string;
  /** Practice marks in CBSE style (checked problems only). */
  marks?: { got: number; of: number; provisional: boolean };
}

const halves = (n: number) => `${Math.floor(n) || (n % 1 ? "" : "0")}${n % 1 ? "½" : ""}`;

export type Highlight = HighlightState;

export type BoardStatus = "idle" | "checking" | "correct";

interface Props {
  sessionCode: string;
  blocks: TutorBlock[];
  highlights: Highlight[];
  erased: string[];
  currentSection: number | null;
  /** The red circle on the student's work, with where it is (so it survives a reload). */
  mark: MarkState | null;
  correct: CorrectState | null;
  /** The question on the board now; work is sent with it so it can't be graded against another. */
  questionId: string | null;
  status: BoardStatus;
  /** The server asked for the student's latest work (n changes on every request). */
  captureRequest: { id: string; n: number } | null;
  /** Voice state, to pace the writing with the tutor's speech. */
  callActive: boolean;
  teacherSpeaking: boolean;
  /** Increments when the student interrupts (pause unfinished writing) / the tutor resumes. */
  holdTick: number;
  /** Class paused: freeze half-written work until resumed. */
  paused: boolean;
  submission: Submission;
  resumeTick: number;
  send: (msg: ClientMessage) => void;
  /** Student pressed Done (with the id of the work just sent): tell the tutor to look. */
  onDone: (captureId: string) => void;
  /** The bottom bar: start/pause on the left, the + (paper, book) in the typing field, the mic on the right. */
  dockLeft?: ReactNode;
  dockAttach?: ReactNode;
  dockRight?: ReactNode;
  /** Increments to print the whole board (Save as PDF): the student's ink is drawn for every page first. */
  printTick?: number;
  /** "Fix it" on a photo: its label and stored file, and the photo with the student's ink on top. */
  onFix?: (label: string, docId: string, image: string | null) => void;
  /** The photo being fixed now, if any. */
  fixing?: string | null;
}

interface Saved {
  strokes: TimedStroke[];
  /** When each tutor block first appeared, to tell which writing came after a question. */
  arrivals?: Record<string, number>;
  /** Time of the last Done, for work written without a question on the board. */
  lastDoneAt?: number;
  /** For each tutor block: the lowest ink in its column when it arrived, so it goes below it. */
  floors: Record<string, number>;
  /** Page width in board units, fixed for the session. */
  w?: number;
}

let strokeCounter = 0;

/** A stroke plus when it was written (ms), so Done can send "what I wrote since the question". */
type TimedStroke = Stroke & { t?: number };
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `id${Date.now()}${Math.random()}`);

function loadSaved(code: string): Saved {
  try {
    const raw = localStorage.getItem(`shikshak.board.${code}`);
    if (raw) return JSON.parse(raw) as Saved;
  } catch {
    // storage blocked or corrupt: start empty
  }
  return { strokes: [], floors: {} };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function writeBoard(code: string, saved: Saved) {
  try {
    localStorage.setItem(`shikshak.board.${code}`, JSON.stringify(saved));
  } catch {
    // storage full or blocked: the board still works, it just won't survive a reload
  }
}

function inkBottom(strokes: Stroke[], x0 = -Infinity, x1 = Infinity): number {
  let bottom = 0;
  for (const s of strokes) {
    const b = strokeBox(s);
    if (b.x + b.w < x0 || b.x > x1) continue;
    if (b.y + b.h > bottom) bottom = b.y + b.h;
  }
  return bottom;
}

/** How many pieces a block reveals one at a time. */
function piecesOf(b: TutorBlock): number {
  switch (b.kind) {
    case "write":
      return b.style === "heading" || b.style === "your_turn" ? 1 : b.lines.length;
    case "draw":
      return diagramPieces(b.diagram);
    case "steps":
      return b.steps.length;
    default:
      return 1;
  }
}

const blockLabel = (b: TutorBlock) => ("label" in b ? b.label : undefined);

export function Board(props: Props) {
  const { sessionCode, blocks, highlights, erased, currentSection, mark, correct, questionId, status, captureRequest, send, onDone } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const saved = useMemo(() => loadSaved(sessionCode), [sessionCode]);

  const [strokes, setStrokes] = useState<TimedStroke[]>(saved.strokes);
  const arrivals = useRef<Record<string, number>>(saved.arrivals ?? {});
  const lastDoneAt = useRef<number>(saved.lastDoneAt ?? 0);
  const floors = useRef<Record<string, number>>(saved.floors);
  const unitsW = useRef<number | undefined>(saved.w);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [view, setView] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<"pen" | "eraser" | "hand">("pen");
  const [typing, setTyping] = useState(false);
  // The drawing tools sit in a tray on the right; the pen button hides it to give the board the room.
  // On a phone (or a short screen) it starts closed, so it doesn't cover the board.
  const [trayOpen, setTrayOpen] = useState(() => window.innerWidth >= 700 && window.innerHeight >= 560);
  const [newBelow, setNewBelow] = useState(false);
  // The open question has scrolled out of view above: show it pinned at the top.
  const [questionAbove, setQuestionAbove] = useState(false);
  const [lastDone, setLastDone] = useState<string>("");
  const [revealed, setRevealed] = useState<Record<string, number>>({});
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [hlRects, setHlRects] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});

  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const drawing = useRef<TimedStroke | null>(null);
  const activePointer = useRef<number | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const panning = useRef<{ y: number } | null>(null);
  const lastPenAt = useRef(0);
  const lastDrawAt = useRef(0);
  const blockEls = useRef(new Map<string, HTMLElement>());
  const dragging = useRef<HTMLInputElement | null>(null);

  // ---------- size and scale ----------
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Measure now as well: the observer only reports once the page renders, which a background tab may not do.
    setView({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) });
    const ro = new ResizeObserver(([entry]) => setView({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!unitsW.current && view.w > 0) unitsW.current = Math.round(Math.min(1100, Math.max(560, view.w / 1.25)));
  const W = unitsW.current ?? 640;
  const scale = view.w > 0 ? view.w / W : 1;
  const px = (u: number) => u * scale;

  // Columns: on wide boards the tutor can put a diagram or note beside the explanation.
  const wide = W >= 900;
  const main = { x0: PAD_L, x1: wide ? Math.round(W * 0.6) : W - PAD_R };
  const side = { x0: Math.round(W * 0.63), x1: W - PAD_R };
  const columnOf = (b: TutorBlock): "main" | "side" => ("place" in b && b.place === "right" && wide ? "side" : "main");

  // ---------- layout ----------
  for (const b of blocks) {
    if (arrivals.current[b.id] === undefined) arrivals.current[b.id] = b.instant ? 0 : Date.now();
    if (floors.current[b.id] === undefined) {
      const col = columnOf(b) === "side" ? side : main;
      floors.current[b.id] = b.kind === "page" ? inkBottom(strokesRef.current) : inkBottom(strokesRef.current, col.x0, col.x1);
    }
  }
  const estimate = (b: TutorBlock, width: number) =>
    b.kind === "draw" ? diagramHeight(b.diagram, width) + 40 + (b.diagram.type === "graph" ? (b.diagram.params?.length ?? 0) * 52 : 0) : b.kind === "page" ? 40 : b.kind === "source" ? (b.photo ? width * 0.75 : width * 0.9) : b.kind === "fix" ? width * 0.75 + 90 + b.questions.reduce((n, q) => n + 60 + q.solution.length * 36, 0) : 60 + piecesOf(b) * 46;

  // A block that is still being written stays below any ink the student has added since it arrived,
  // so the tutor never writes over the student's work (the student can't see a block's space
  // before its lines appear). The floor only ever moves down, so a block never jumps back up.
  for (const b of blocks) {
    const total = piecesOf(b);
    const shown = revealed[b.id] ?? (b.instant ? total : 1);
    if (shown >= total && heights[b.id] !== undefined) continue;
    const col = columnOf(b) === "side" ? side : main;
    const since = arrivals.current[b.id] ?? 0;
    const fresh = strokes.filter((st) => (st.t ?? 0) > since);
    if (!fresh.length) continue;
    const below = b.kind === "page" ? inkBottom(fresh) : inkBottom(fresh, col.x0, col.x1);
    if (below > (floors.current[b.id] ?? 0)) floors.current[b.id] = below;
  }

  // The first block starts below the bar at the top of the screen, whatever the board's scale.
  const TOP = Math.max(70, Math.ceil(TOP_PX / scale));
  const layout = useMemo(() => {
    const pos: Record<string, { x: number; y: number; w: number }> = {};
    const byLabel: Record<string, { x: number; y: number; w: number; h: number }> = {};
    let mainBottom = 0;
    let sideBottom = 0;
    let lastMainTop = 0;
    for (const b of blocks) {
      const floor = floors.current[b.id] ?? 0;
      const col = columnOf(b);
      const box = col === "side" ? side : main;
      const w = b.kind === "page" ? W - PAD_L - PAD_R : box.x1 - box.x0;
      const h = heights[b.id] ?? estimate(b, w);
      // Write over a rubbed-out block's spot only if the new content fits there; otherwise go below.
      // Nothing is written over: everything from the start of the class stays on the board, and new
      // writing always goes below (the board scrolls). A "replacement" is just the next block.
      const reuse: { x: number; y: number; w: number } | undefined = undefined;
      let p: { x: number; y: number; w: number };
      if (reuse) p = reuse;
      else if (b.kind === "page") p = { x: PAD_L, y: Math.max(mainBottom, sideBottom, floor) + PAGE_GAP, w };
      else if (col === "side") p = { x: box.x0, y: Math.max(sideBottom ? sideBottom + GAP : TOP, lastMainTop, floor ? floor + GAP : TOP), w };
      else p = { x: box.x0, y: Math.max(mainBottom ? mainBottom + GAP : TOP, floor ? floor + GAP : TOP), w };
      pos[b.id] = p;
      const label = blockLabel(b);
      if (label) byLabel[label] = { ...p, h };
      const bottom = p.y + h;
      if (b.kind === "page") {
        mainBottom = sideBottom = bottom;
        lastMainTop = bottom;
      } else if (col === "side") sideBottom = Math.max(sideBottom, bottom);
      else {
        mainBottom = Math.max(mainBottom, bottom);
        if (!reuse) lastMainTop = p.y;
      }
    }
    return { pos, bottom: Math.max(mainBottom, sideBottom) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, heights, W, strokes, revealed, TOP]);

  const contentBottom = Math.max(layout.bottom, inkBottom(strokes));
  // The board never ends: scrolling near the bottom adds another screen of blank board to write on.
  const [extraScreens, setExtraScreens] = useState(0);
  const viewUnits = scale ? view.h / scale : 0;
  const pageHeightUnits = contentBottom + viewUnits * (1 + extraScreens) + 60;

  // The latest question (problem / "your turn") and where it ends, for the "write here" hint.
  const latestQuestion = [...blocks].reverse().find((b) => b.kind === "problem" || (b.kind === "write" && b.style === "your_turn"));
  // "Write here" sits below the question and below anything the tutor added after it (a hint that is
  // still to appear already has its space), so the student never starts writing where a block will show.
  const afterQuestion = latestQuestion ? blocks.slice(blocks.indexOf(latestQuestion)) : [];
  const regionTop = latestQuestion
    ? Math.max(
        ...afterQuestion.filter((b) => columnOf(b) === "main").map((b) => (layout.pos[b.id]?.y ?? 0) + (heights[b.id] ?? estimate(b, (layout.pos[b.id]?.w ?? 0)))),
      )
    : 0;

  // The student's answer: everything written since the latest question appeared (wherever it is on
  // the board), or since the last Done if there's no question. Earlier this used position ("below the
  // question"), which ignored work written beside or above it, so Done looked broken.
  const since = latestQuestion ? Math.max(arrivals.current[latestQuestion.id] ?? 0, 1) : lastDoneAt.current;
  const response = useMemo(() => strokes.filter((s) => (s.t ?? 0) > since || (!s.t && !latestQuestion && !since)), [strokes, since, latestQuestion]);
  const lines = useMemo(() => groupIntoLines(response), [response]);
  const responseKey = response.map((s) => s.id).join(",");

  // ---------- measuring tutor blocks ----------
  // Heights are re-measured whenever a block changes size (a book page finishing loading, a line
  // being revealed), so blocks below move down instead of overlapping it.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const observed = useRef(new Map<Element, string>());
  const sizeObserver = useMemo(
    () =>
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            setHeights((prev) => {
              let next = prev;
              for (const entry of entries) {
                const id = observed.current.get(entry.target);
                if (!id || !scaleRef.current) continue;
                const h = (entry.target as HTMLElement).offsetHeight / scaleRef.current;
                if (Math.abs((next[id] ?? 0) - h) < 1) continue;
                if (next === prev) next = { ...prev };
                next[id] = h;
              }
              return next;
            });
          }),
    [],
  );
  useEffect(() => () => sizeObserver?.disconnect(), [sizeObserver]);
  const measure = useCallback(
    (b: TutorBlock) => (el: HTMLElement | null) => {
      const label = blockLabel(b);
      if (label) {
        if (el) blockEls.current.set(label, el);
        else blockEls.current.delete(label);
      }
      if (!el) return;
      if (!observed.current.has(el)) {
        observed.current.set(el, b.id);
        sizeObserver?.observe(el);
      }
      if (!scale) return;
      const h = el.offsetHeight / scale;
      setHeights((prev) => (Math.abs((prev[b.id] ?? 0) - h) < 1 ? prev : { ...prev, [b.id]: h }));
    },
    [scale, sizeObserver],
  );

  // ---------- pacing the writing with the tutor's voice ----------
  // New blocks show their first piece at once (she starts talking about it); the rest appear one by
  // one while she is speaking. Replayed blocks (after a reload) show in full.
  useEffect(() => {
    setRevealed((prev) => {
      let next = prev;
      for (const b of blocks) {
        if (prev[b.id] !== undefined) continue;
        if (next === prev) next = { ...prev };
        next[b.id] = b.instant ? piecesOf(b) : 1;
      }
      return next;
    });
  }, [blocks]);

  const live = useRef({ callActive: props.callActive, teacherSpeaking: props.teacherSpeaking, paused: props.paused, blocks, revealed, held });
  live.current = { callActive: props.callActive, teacherSpeaking: props.teacherSpeaking, paused: props.paused, blocks, revealed, held };
  const speech = useRef({ talk: 0, quiet: 0, sinceHold: 0, blocksAtHold: 0 });

  useEffect(() => {
    const TICK = 0.2;
    const id = setInterval(() => {
      const { callActive, teacherSpeaking, paused, blocks: bs, revealed: rv, held: hd } = live.current;
      if (paused) return; // class paused: nothing moves until Resume
      const sp = speech.current;
      // A held lesson resumes by itself if the tutor simply carries on talking without new writing.
      if (hd.size) {
        sp.sinceHold = teacherSpeaking ? sp.sinceHold + TICK : sp.sinceHold;
        if (sp.sinceHold > 10 && bs.length === sp.blocksAtHold) setHeld(new Set());
      }
      const next = bs.find((b) => (rv[b.id] ?? 0) < piecesOf(b) && !hd.has(b.id));
      if (!next) {
        sp.talk = sp.quiet = 0;
        return;
      }
      let step = false;
      if (!callActive) {
        sp.talk += TICK;
        step = sp.talk >= 1.2; // no voice (simulator): steady pace
      } else if (teacherSpeaking) {
        sp.quiet = 0;
        sp.talk += TICK;
        step = sp.talk >= speechFor(next, rv[next.id] ?? 0);
      } else {
        sp.quiet += TICK;
        // She has finished talking (or wrote something without talking about it): show the rest
        // soon, so the student isn't left looking at a half-written block.
        if (sp.quiet > QUIET_BEFORE_CATCH_UP) {
          sp.talk += TICK;
          step = sp.talk >= CATCH_UP_PER_PIECE;
        }
      }
      if (step) {
        sp.talk = 0;
        setRevealed((prev) => ({ ...prev, [next.id]: (prev[next.id] ?? 0) + 1 }));
      }
    }, TICK * 1000);
    return () => clearInterval(id);
  }, []);

  // Interruption: pause whatever is half-written; resume when the tutor says so.
  useEffect(() => {
    if (!props.holdTick) return;
    const { blocks: bs, revealed: rv } = live.current;
    const pending = bs.filter((b) => (rv[b.id] ?? 0) < piecesOf(b)).map((b) => b.id);
    speech.current.sinceHold = 0;
    speech.current.blocksAtHold = bs.length;
    if (pending.length) setHeld(new Set(pending));
  }, [props.holdTick]);
  useEffect(() => {
    if (props.resumeTick) setHeld(new Set());
  }, [props.resumeTick]);

  // ---------- highlights: find the target block or line on screen ----------
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const pr = page.getBoundingClientRect();
    const rects: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const h of highlights) {
      const el = blockEls.current.get(h.target);
      // A line of a photo of paper working: that strip of the picture.
      const img = h.band ? (el?.querySelector("img") as HTMLElement | null) : null;
      if (h.band && img) {
        const r = img.getBoundingClientRect();
        rects[h.id] = { x: r.left - pr.left, y: r.top - pr.top + r.height * h.band.top, w: r.width, h: r.height * (h.band.bottom - h.band.top) };
        continue;
      }
      const target = (h.line ? (el?.querySelector(`[data-line="${h.line}"]`) as HTMLElement | null) : null) ?? el;
      if (!target) continue;
      const r = target.getBoundingClientRect();
      const inner = target.querySelector(".hl-text") as HTMLElement | null;
      const ir = inner?.getBoundingClientRect();
      const left = ir ? ir.left : r.left;
      const width = ir ? ir.width : r.width;
      rects[h.id] = { x: left - pr.left, y: r.top - pr.top, w: Math.max(30, width), h: r.height };
    }
    setHlRects(rects);
  }, [highlights, layout, heights, revealed, view, erased]);

  // ---------- persistence ----------
  // Always writes the latest strokes (from the ref, not a copy from when an effect ran), soon
  // after a change and immediately when the page is hidden or the class is left, so the last
  // stroke, undo or clear is never lost to a quick navigation.
  const saveNow = useCallback(() => {
    writeBoard(sessionCode, { strokes: strokesRef.current, floors: floors.current, w: unitsW.current, arrivals: arrivals.current, lastDoneAt: lastDoneAt.current });
  }, [sessionCode]);
  useEffect(() => {
    const t = setTimeout(saveNow, 250);
    return () => clearTimeout(t);
  }, [strokes, blocks, saveNow]);
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && saveNow();
    window.addEventListener("pagehide", saveNow);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", saveNow);
      document.removeEventListener("visibilitychange", onHide);
      saveNow();
    };
  }, [saveNow]);

  // ---------- drawing the visible ink ----------
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const scroller = scrollRef.current;
    if (!canvas || !scroller) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, -dpr * scroller.scrollTop);
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = PEN_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const top = scroller.scrollTop / scale - 20;
    const bottom = top + view.h / scale + 40;
    const all = drawing.current && drawing.current.id !== "eraser" ? [...strokesRef.current, drawing.current] : strokesRef.current;
    for (const s of all) {
      const b = strokeBox(s);
      if (b.y > bottom || b.y + b.h < top) continue;
      if (s.text) drawTyped(ctx, s);
      else drawStroke(ctx, s.points);
    }
  }, [scale, view.h]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view.w) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = view.w * dpr;
    canvas.height = view.h * dpr;
    redraw();
  }, [view, redraw]);
  useEffect(redraw, [strokes, redraw]);

  const questionPos = latestQuestion ? layout.pos[latestQuestion.id] : undefined;
  const questionBottom = questionPos && latestQuestion ? questionPos.y + (heights[latestQuestion.id] ?? 60) : 0;
  const checkQuestionAbove = () => {
    const s = scrollRef.current;
    // As soon as the top of the question is cut off (the top bar covers about 50 px of the board).
    setQuestionAbove(Boolean(s && questionPos && s.scrollTop + 50 > (questionPos.y + 10) * scale));
  };
  useEffect(checkQuestionAbove, [questionBottom, scale, layout]); // eslint-disable-line react-hooks/exhaustive-deps
  const questionText = !latestQuestion ? "" : latestQuestion.kind === "problem" ? latestQuestion.problem : latestQuestion.kind === "write" ? latestQuestion.lines.join(" ") : "";

  const frame = useRef(0);
  // ---------- scrolling the board from the ink layer (wheel, two fingers, the hand tool) ----------
  // The ink canvas sits over the page, so these scroll the page by hand. Each move redraws the ink
  // in the same frame (no ink trailing the page), and a mouse wheel's big notches glide instead of
  // jumping.
  const glide = useRef<{ target: number | null; raf: number }>({ target: null, raf: 0 });
  const scrollBoardTo = (y: number, animate: boolean) => {
    const s = scrollRef.current;
    if (!s) return;
    const to = Math.max(0, Math.min(s.scrollHeight - s.clientHeight, y));
    if (!animate) {
      cancelAnimationFrame(glide.current.raf);
      glide.current = { target: null, raf: 0 };
      s.scrollTop = to;
      redraw();
      return;
    }
    glide.current.target = to;
    if (glide.current.raf) return;
    const step = () => {
      const target = glide.current.target;
      if (target === null) return;
      const d = target - s.scrollTop;
      if (Math.abs(d) < 1) {
        s.scrollTop = target;
        glide.current = { target: null, raf: 0 };
      } else {
        s.scrollTop += Math.sign(d) * Math.max(1, Math.abs(d) * 0.22);
        glide.current.raf = requestAnimationFrame(step);
      }
      redraw();
    };
    glide.current.raf = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(glide.current.raf), []);

  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      redraw();
      const s = scrollRef.current;
      if (s && s.scrollTop + s.clientHeight >= (layout.bottom - 20) * scale) setNewBelow(false);
      if (s && s.clientHeight && s.scrollTop + s.clientHeight * 1.5 >= s.scrollHeight) setExtraScreens((n) => n + 1);
      checkQuestionAbove();
    });
  };

  // ---------- follow the writing ----------
  const followTo = useCallback(
    (unitsY: number, smooth = true) => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      if (Date.now() - lastDrawAt.current < 2500) {
        setNewBelow(true); // the student is writing: don't yank the page, show a pill instead
        return;
      }
      scroller.scrollTo({ top: Math.max(0, unitsY * scale), behavior: smooth ? "smooth" : "auto" });
    },
    [scale],
  );
  const lastBlock = blocks[blocks.length - 1];
  useEffect(() => {
    if (!lastBlock || lastBlock.instant) return;
    const p = layout.pos[lastBlock.id];
    if (!p) return;
    const scroller = scrollRef.current;
    const h = heights[lastBlock.id] ?? 0;
    const visibleTop = (scroller?.scrollTop ?? 0) / scale;
    const visibleBottom = visibleTop + view.h / scale;
    // Bring the block into view if it starts above the view or its revealed part runs past the fold:
    // scroll only as far as needed (keeping its top in view), and keep the open question and the
    // student's work under it on screen when they fit together with the new block.
    const shownBottom = p.y + (h * (revealed[lastBlock.id] ?? 1)) / piecesOf(lastBlock);
    if (p.y < visibleTop || shownBottom > visibleBottom - 80) {
      const roomBelow = 140; // the toolbar and hint pill cover the bottom of the board
      let target = p.y < visibleTop ? p.y - 40 : Math.min(p.y - 40, shownBottom + roomBelow - view.h / scale);
      const q = latestQuestion && latestQuestion.id !== lastBlock.id ? layout.pos[latestQuestion.id] : undefined;
      if (q && q.y < p.y && shownBottom + roomBelow - (q.y - 20) <= view.h / scale) target = Math.min(target, q.y - 20);
      followTo(Math.max(0, target));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBlock?.id, revealed[lastBlock?.id ?? ""]]);

  // On first load, jump to the end of the page.
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !view.h || !blocks.length) return;
    jumped.current = true;
    scrollRef.current?.scrollTo({ top: Math.max(0, (contentBottom - view.h / scale / 2) * scale) });
  }, [view.h, blocks.length, contentBottom, scale]);

  // ---------- notes as a PDF (print, "Save as PDF") ----------
  // The ink canvas only covers the screen, so for printing the student's ink is drawn for the whole
  // board as images laid over the page, then the browser prints the page (see @media print).
  const [printInk, setPrintInk] = useState<{ src: string; top: number; h: number }[]>([]);
  useEffect(() => {
    if (!props.printTick) return;
    const width = view.w;
    const bottom = (Math.max(inkBottom(strokesRef.current), layout.bottom) + 40) * scale;
    const TILE = 2400;
    const dpr = 1.5;
    const tiles: { src: string; top: number; h: number }[] = [];
    for (let top = 0; top < bottom && width > 0; top += TILE) {
      const h = Math.min(TILE, bottom - top);
      const c = document.createElement("canvas");
      c.width = Math.round(width * dpr);
      c.height = Math.round(h * dpr);
      const ctx = c.getContext("2d");
      if (!ctx) break;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, -dpr * top);
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
      ctx.lineWidth = PEN_WIDTH;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const st of strokesRef.current) {
        const b = strokeBox(st);
        if ((b.y + b.h) * scale < top || b.y * scale > top + h) continue;
        if (st.text) drawTyped(ctx, st);
        else drawStroke(ctx, st.points);
      }
      tiles.push({ src: c.toDataURL("image/png"), top, h });
    }
    const after = () => setPrintInk([]);
    window.addEventListener("afterprint", after, { once: true });
    // Print only once the ink images are decoded and on the page: printing earlier leaves them
    // blank in the PDF (the browser captures the page before the images have loaded).
    let cancelled = false;
    const decoded = (src: string) => {
      const img = new Image();
      img.src = src;
      return img.decode().catch(() => {});
    };
    void Promise.all(tiles.map((t) => decoded(t.src))).then(() => {
      if (cancelled) return;
      setPrintInk(tiles);
      requestAnimationFrame(() =>
        requestAnimationFrame(async () => {
          const shown = [...(pageRef.current?.querySelectorAll<HTMLImageElement>("img.print-ink") ?? [])];
          await Promise.all(shown.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => {}))));
          if (!cancelled) window.print();
        }),
      );
    });
    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", after);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.printTick]);

  // ---------- typed working (the Type tool) ----------
  // Typed lines go under the question (below anything already written there), one per line, as the
  // student's own strokes: Done reads them, the eraser and undo work on them, and they're saved.
  const addTyped = (texts: string[]) => {
    const x = (latestQuestion && layout.pos[latestQuestion.id]?.x) || PAD_L;
    const y0 = latestQuestion ? Math.max(regionTop + 24, inkBottom(response) + 18) : Math.max(layout.bottom, inkBottom(strokes)) + 28;
    const now = Date.now();
    const added = texts.map((text, i) => typedStroke(`t${now.toString(36)}${++strokeCounter}`, text, x, y0 + i * TYPED_LINE, Math.min(W - x - 20, measureTyped(text)), now + i));
    lastDrawAt.current = 0; // not handwriting in progress: let the page follow
    setStrokes((prev) => [...prev, ...added]);
    const s = scrollRef.current;
    if (s) scrollBoardTo((y0 + texts.length * TYPED_LINE) * scale - s.clientHeight * 0.6, true);
  };

  // ---------- "Fix it" on a photo ----------
  // Sends the photo as the student sees it: with any ink they drew over it on the board.
  const fixPhoto = (b: Extract<TutorBlock, { kind: "source" }>) => {
    const page = pageRef.current;
    const img = blockEls.current.get(b.label)?.querySelector("img");
    let image: string | null = null;
    if (page && img && scale) {
      const pr = page.getBoundingClientRect();
      const r = img.getBoundingClientRect();
      const box = { x: (r.left - pr.left) / scale, y: (r.top - pr.top) / scale, w: r.width / scale, h: r.height / scale };
      const onIt = strokes.filter((st) => {
        const sb = strokeBox(st);
        const cx = sb.x + sb.w / 2;
        const cy = sb.y + sb.h / 2;
        return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
      });
      image = onIt.length ? makePhotoSnapshot(img, box, onIt) : null;
    }
    props.onFix?.(b.label, b.docId, image);
  };

  /** The photo on the board that most of these lines are written on, with where it is (board units). */
  const photoUnder = (written: { box: Box }[]): { label: string; img: HTMLImageElement; box: Box } | null => {
    const page = pageRef.current;
    if (!page || !written.length || !scale) return null;
    const pr = page.getBoundingClientRect();
    let best: { label: string; img: HTMLImageElement; box: Box; n: number } | null = null;
    for (const b of blocks) {
      if (b.kind !== "source" || !b.photo) continue;
      const img = blockEls.current.get(b.label)?.querySelector("img");
      if (!img) continue;
      const r = img.getBoundingClientRect();
      const box = { x: (r.left - pr.left) / scale, y: (r.top - pr.top) / scale, w: r.width / scale, h: r.height / scale };
      const n = written.filter(({ box: l }) => {
        const cx = l.x + l.w / 2;
        const cy = l.y + l.h / 2;
        return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
      }).length;
      if (n > 0 && (!best || n > best.n)) best = { label: b.label, img, box, n };
    }
    return best && best.n * 2 >= written.length ? best : null;
  };

  // ---------- capture: the student's latest work as a numbered image ----------
  const capture = useCallback(
    (reason: "done" | "request", requestId: string | null = null) => {
      const id = newId();
      // Written over a photo pinned on the board (most lines sit on it): send the photo with the ink on
      // top, so the reader sees what the student marked, asked or added on their paper.
      const onPhoto = photoUnder(lines);
      if (onPhoto) {
        const png = makePhotoSnapshot(onPhoto.img, onPhoto.box, response);
        if (png) {
          send({ kind: "capture", id, reason, requestId, questionId, png, lineCount: 0, lines: [], photoLabel: onPhoto.label });
          return id;
        }
      }
      const boxes: Box[] = lines.map((l) => ({ x: round1(l.box.x), y: round1(l.box.y), w: round1(l.box.w), h: round1(l.box.h) }));
      send({ kind: "capture", id, reason, requestId, questionId, png: lines.length ? makeSnapshot(response, lines) : null, lineCount: lines.length, lines: boxes });
      return id;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, response, send, questionId, blocks, scale],
  );
  useEffect(() => {
    if (captureRequest) capture("request", captureRequest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureRequest?.n]);

  const done = () => {
    const id = capture("done");
    setLastDone(responseKey);
    if (!latestQuestion) lastDoneAt.current = Date.now();
    onDone(id);
  };

  // ---------- touch handling: block page scroll/zoom under the pen (iOS) ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const block = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    canvas.addEventListener("touchstart", block, { passive: false });
    canvas.addEventListener("touchmove", block, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", block);
      canvas.removeEventListener("touchmove", block);
    };
  }, []);

  const toBoard = (clientX: number, clientY: number): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scroller = scrollRef.current!;
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top + scroller.scrollTop) / scale;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };

  const eraseAt = (p: Point) => {
    setStrokes((prev) => {
      const next = prev.filter((s) => !s.points.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < ERASER_RADIUS));
      return next.length === prev.length ? prev : next;
    });
  };

  const finishStroke = (keep = true) => {
    const stroke = drawing.current;
    drawing.current = null;
    activePointer.current = null;
    if (!stroke || stroke.id === "eraser" || !keep) {
      redraw();
      return;
    }
    lastDrawAt.current = Date.now();
    stroke.t = Date.now();
    setStrokes((prev) => [...prev, stroke]);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    // A button on a board block (e.g. "Fix it" on a photo) is under the ink layer: press it instead of drawing.
    // (Board blocks don't take pointer events, so find it by where it is.)
    const action = [...(pageRef.current?.querySelectorAll<HTMLButtonElement>("button[data-board-action]") ?? [])].find((b) => {
      const r = b.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (action) {
      if (!action.disabled) action.click();
      return;
    }
    // A slider on a board block (an editable graph): drag it instead of drawing.
    const slider = [...(pageRef.current?.querySelectorAll<HTMLInputElement>("input[data-board-drag]") ?? [])].find((el) => {
      const r = el.getBoundingClientRect();
      return e.clientX >= r.left - 6 && e.clientX <= r.right + 6 && e.clientY >= r.top - 12 && e.clientY <= r.bottom + 12;
    });
    if (slider) {
      dragging.current = slider;
      activePointer.current = e.pointerId;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // dragging still works without capture
      }
      slideTo(slider, e.clientX);
      return;
    }
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size >= 2) {
        // Two fingers: scroll the page. Drop the half-drawn stroke the first finger started.
        finishStroke(false);
        panning.current = { y: avgY(touches.current) };
        return;
      }
    }
    if (e.pointerType === "pen") lastPenAt.current = Date.now();
    if (e.pointerType === "touch" && Date.now() - lastPenAt.current < 1500) return; // palm while using a stylus
    if (tool === "hand") {
      panning.current = { y: e.clientY };
      activePointer.current = e.pointerId;
      return;
    }
    // Phones sometimes never send "finger lifted"; a new touch always finishes the old stroke first.
    if (drawing.current) finishStroke();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // drawing still works without capture
    }
    activePointer.current = e.pointerId;
    const p = toBoard(e.clientX, e.clientY);
    if (tool === "eraser") {
      drawing.current = { id: "eraser", points: [p] };
      eraseAt(p);
      return;
    }
    drawing.current = { id: `s${Date.now().toString(36)}${++strokeCounter}`, points: [p] };
    lastDrawAt.current = Date.now();
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const scroller = scrollRef.current!;
    if (dragging.current && e.pointerId === activePointer.current) return slideTo(dragging.current, e.clientX);
    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (panning.current && (touches.current.size >= 2 || (tool === "hand" && e.pointerId === activePointer.current))) {
      const y = touches.current.size >= 2 ? avgY(touches.current) : e.clientY;
      scrollBoardTo(scroller.scrollTop - (y - panning.current.y), false);
      panning.current.y = y;
      return;
    }
    const stroke = drawing.current;
    if (!stroke || e.pointerId !== activePointer.current) return;
    if (e.pointerType === "pen") lastPenAt.current = Date.now();
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const p = toBoard(ev.clientX, ev.clientY);
      if (tool === "eraser") {
        eraseAt(p);
        continue;
      }
      const last = stroke.points[stroke.points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.8) continue;
      stroke.points.push(p);
    }
    lastDrawAt.current = Date.now();
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(redraw);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    touches.current.delete(e.pointerId);
    if (dragging.current && e.pointerId === activePointer.current) {
      dragging.current = null;
      activePointer.current = null;
      return;
    }
    if (panning.current) {
      if (tool === "hand") {
        if (e.pointerId === activePointer.current) {
          panning.current = null;
          activePointer.current = null;
        }
      } else if (touches.current.size < 2) panning.current = null;
      return;
    }
    if (e.pointerId !== activePointer.current) return;
    finishStroke();
  };

  const onWheel = (e: React.WheelEvent) => {
    const s = scrollRef.current;
    if (!s) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * s.clientHeight : e.deltaY;
    // A mouse wheel moves in big whole notches; a trackpad sends many small ones that already feel smooth.
    const notch = e.deltaMode !== 0 || (Math.abs(dy) >= 50 && Number.isInteger(dy));
    scrollBoardTo((notch ? (glide.current.target ?? s.scrollTop) : s.scrollTop) + dy, notch);
  };

  // ---------- marks on the student's work ----------
  // The circle's position comes with the mark itself, so it reappears after a reload. On a photo of
  // paper working it's a strip of the photo, measured where the photo is on screen now.
  const [bandBoxes, setBandBoxes] = useState<{ mark: Box | null; correct: Box | null }>({ mark: null, correct: null });
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page || (!mark?.on && !correct?.on)) return setBandBoxes((b) => (b.mark || b.correct ? { mark: null, correct: null } : b));
    const pr = page.getBoundingClientRect();
    const boxOf = (on: PhotoBand | null | undefined): Box | null => {
      const img = on ? (blockEls.current.get(on.label)?.querySelector("img") as HTMLElement | null) : null;
      if (!on || !img || !scale) return null;
      const r = img.getBoundingClientRect();
      return { x: (r.left - pr.left) / scale, y: (r.top - pr.top + r.height * on.top) / scale, w: r.width / scale, h: (r.height * (on.bottom - on.top)) / scale };
    };
    setBandBoxes({ mark: boxOf(mark?.on), correct: boxOf(correct?.on) });
  }, [mark, correct, layout, heights, view, scale]);
  const markedLine = mark?.box ? { box: mark.box, index: mark.line } : mark && bandBoxes.mark ? { box: bandBoxes.mark, index: mark.line } : undefined;
  // Fade the circle once the student starts fixing their work.
  const markBase = useRef({ key: "", count: 0 });
  const markKey = mark ? `${mark.captureId}:${mark.line}` : "";
  if (markBase.current.key !== markKey) markBase.current = { key: markKey, count: strokes.length };
  const drewSinceMark = strokes.length > markBase.current.count;
  const correctAt = correct?.box ?? bandBoxes.correct;

  const sub = props.submission;
  // The teacher's verdict card fades after a few seconds (the mark stays on the board, and she says it).
  const cardKey = `${sub.captureId}:${sub.state}`;
  const [cardGone, setCardGone] = useState<string | null>(null);
  useEffect(() => {
    if (sub.state !== "done" && sub.state !== "stale") return;
    const t = setTimeout(() => setCardGone(cardKey), 5000);
    return () => clearTimeout(t);
  }, [cardKey, sub.state]);
  const busy = sub.state === "submitting" || sub.state === "reviewing";
  const canDone = response.length > 0 && responseKey !== lastDone && !busy;
  const doneLabel =
    sub.state === "submitting" ? "Sending…" : sub.state === "reviewing" ? "Teacher reading…" : canDone ? "Done" : sub.state === "done" && responseKey === lastDone ? "Seen" : "Done";

  return (
    <div className="board" ref={wrapRef} data-tool={tool}>
      <div className="board-scroll" ref={scrollRef} onScroll={onScroll}>
        <div
          className="board-page"
          ref={pageRef}
          style={{
            // Printed notes stop at the last writing, not at the blank board scrolled past.
            height: px(printInk.length ? contentBottom + 60 : pageHeightUnits),
            ["--s" as string]: scale,
            // Printing: the page keeps its screen width and is shrunk to fit A4 (about 718px between margins).
            ...(printInk.length ? { ["--print-w" as string]: `${view.w}px`, ["--print-zoom" as string]: Math.min(1, 718 / Math.max(1, view.w)) } : {}),
          }}
        >
          {blocks.map((b) => {
            const p = layout.pos[b.id] ?? { x: PAD_L, y: 0, w: W - PAD_L - PAD_R };
            const label = blockLabel(b);
            return (
              <div
                key={b.id}
                ref={measure(b)}
                className={`tblock tblock-${b.kind}${b.kind === "write" ? ` tblock-${b.style}` : ""}`}
                data-held={held.has(b.id)}
                style={{ top: px(p.y), left: px(p.x), width: px(p.w) }}
              >
                <BlockBody
                  block={b}
                  shown={revealed[b.id] ?? (b.instant ? piecesOf(b) : 1)}
                  width={p.w}
                  currentSection={currentSection}
                  sessionCode={sessionCode}
                  onFix={props.onFix && b.kind === "source" && b.photo ? () => fixPhoto(b) : undefined}
                  fixing={props.fixing === label}
                />
              </div>
            );
          })}

          <svg className="hl-layer" aria-hidden="true">
            {highlights.map((h) => {
              const r = hlRects[h.id];
              if (!r) return null;
              return <HighlightMark key={h.id} h={h} r={r} />;
            })}
          </svg>
          {highlights.map((h) => {
            const r = hlRects[h.id];
            if (!r || !h.note) return null;
            return (
              <span key={h.id} className="hl-note" style={{ left: r.x + r.w + 12, top: r.y + r.h / 2 }}>
                {h.note}
              </span>
            );
          })}

          {printInk.map((t) => (
            <img key={t.top} className="print-ink" src={t.src} alt="" style={{ top: t.top, height: t.h, width: view.w }} />
          ))}
          {markedLine && <MarkCircle box={markedLine.box} index={markedLine.index} note={mark!.note} scale={scale} faded={drewSinceMark} />}
          {correctAt && status === "correct" && (
            <div className="stamp" style={{ top: px(correctAt.y + correctAt.h + 10), left: px(Math.min(correctAt.x + correctAt.w, W - 200)) }}>
              <Check weight="bold" /> Shabash!
            </div>
          )}
          {latestQuestion && response.length === 0 && (
            <div className="write-here" style={{ top: px(regionTop + 18), left: px(layout.pos[latestQuestion.id]?.x ?? PAD_L) }}>
              {latestQuestion.kind === "problem" && latestQuestion.questionKind === "diagnostic" ? "Rough work here; type your answer in the box below" : "Write here, one step per line"}
            </div>
          )}
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="board-ink"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={(e) => {
          if (e.pointerId === activePointer.current && drawing.current) finishStroke();
        }}
        onWheel={onWheel}
      />

      {status === "checking" && <div className="board-pill" role="status">Your teacher is looking at your work…</div>}
      {held.size > 0 && (
        <button className="board-pill board-pill-held" onClick={() => setHeld(new Set())}>
          <PauseCircle /> Board paused for your doubt. Continue
        </button>
      )}
      {questionAbove && questionText && (
        <button
          className="board-pill board-pill-question"
          title="Scroll up to the question"
          onClick={() => questionPos && scrollRef.current?.scrollTo({ top: Math.max(0, (questionPos.y - 20) * scale), behavior: "smooth" })}
        >
          <span className="board-pill-question-tag">Your turn</span>
          <MathText text={questionText} />
        </button>
      )}
      {newBelow && (
        <button
          className="board-pill board-pill-new"
          onClick={() => {
            setNewBelow(false);
            const p = lastBlock ? layout.pos[lastBlock.id] : undefined;
            if (p) scrollRef.current?.scrollTo({ top: Math.max(0, (p.y - 40) * scale), behavior: "smooth" });
          }}
        >
          New on the board <ArrowDown />
        </button>
      )}
      {sub.state !== "idle" && cardGone !== cardKey && <SubmissionCard sub={sub} onRetry={done} canRetry={response.length > 0} />}

      {typing && <TypePanel onAdd={addTyped} onClose={() => setTyping(false)} />}
      <div className="board-tray" data-open={trayOpen} role="toolbar" aria-label="Board tools">
        <button className={tool === "pen" ? "on" : ""} onClick={() => setTool("pen")} aria-label="Pen" title="Pen">
          <PencilSimple />
        </button>
        <button className={tool === "eraser" ? "on" : ""} onClick={() => setTool("eraser")} aria-label="Eraser" title="Eraser">
          <Eraser />
        </button>
        <button className={tool === "hand" ? "on" : ""} onClick={() => setTool("hand")} aria-label="Scroll" title="Scroll (or use two fingers)">
          <HandGrabbing />
        </button>
        <button onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length} aria-label="Undo" title="Undo">
          <ArrowCounterClockwise />
        </button>
        <button
          onClick={() => setStrokes((all) => all.filter((s) => !response.includes(s)))}
          disabled={!response.length}
          aria-label="Clear my answer"
          title="Clear what I wrote below the question"
        >
          <Trash />
        </button>
      </div>
      <button className="pen-fab" data-open={trayOpen} onClick={() => setTrayOpen((o) => !o)} aria-label={trayOpen ? "Hide the drawing tools" : "Show the drawing tools"} aria-expanded={trayOpen}>
        {trayOpen ? <X weight="bold" /> : <PencilSimple weight="bold" />}
      </button>
      <button className="btn-done" data-ready={canDone} data-state={sub.state} onClick={done} disabled={!canDone} title="Send what I wrote to the teacher">
        {sub.state === "submitting" || sub.state === "reviewing" ? <span className="spin" /> : <CheckCircle weight="fill" />}
        {doneLabel}
      </button>

      <div className="class-dock">
        {props.dockLeft}
        <DockInput attach={props.dockAttach} typing={typing} onToggleTyping={() => setTyping((t) => !t)} onAdd={(text) => addTyped([text])} />
        {props.dockRight}
      </div>
    </div>
  );
}

function avgY(points: Map<number, { x: number; y: number }>): number {
  let sum = 0;
  for (const p of points.values()) sum += p.y;
  return sum / Math.max(1, points.size);
}

/** One revealable line: keeps its space while hidden, so nothing jumps when it appears. */
function RLine({ n, shown, children, as = "li" }: { n: number; shown: number; children: ReactNode; as?: "li" | "p" }) {
  const Tag = as;
  return (
    <Tag data-line={n} className={n <= shown ? "chalk-write" : "chalk-hidden"}>
      <span className="hl-text">{children}</span>
    </Tag>
  );
}

export function BlockBody({
  block,
  shown,
  width,
  currentSection,
  sessionCode,
  onFix,
  fixing,
}: {
  block: TutorBlock;
  shown: number;
  width: number;
  currentSection: number | null;
  sessionCode: string;
  onFix?: () => void;
  fixing?: boolean;
}) {
  switch (block.kind) {
    case "page":
      return <div className="page-rule" />;
    case "plan":
      return (
        <>
          <h3 className="chalk-title">{block.title || "Aaj ka plan"}</h3>
          <ol className="plan-list">
            {block.items.map((item, i) => (
              <li key={i} data-line={i + 1} data-state={currentSection === null ? "" : i + 1 < currentSection ? "done" : i + 1 === currentSection ? "now" : ""}>
                <span className="hl-text">{item}</span>
              </li>
            ))}
          </ol>
        </>
      );
    case "problem":
      return (
        <>
          <span className="problem-tag">{block.questionKind === "diagnostic" ? "Quick check" : block.questionKind === "transfer" ? "New one, on your own" : "Your turn"}</span>
          <p className="problem-line" data-line={1}>
            <span className="hl-text">
              <MathText text={block.problem} />
            </span>
          </p>
        </>
      );
    case "source":
      return <SourcePage block={block} sessionCode={sessionCode} onFix={onFix} fixing={fixing} />;
    case "fix":
      return <FixView block={block} sessionCode={sessionCode} />;
    case "hint":
      return (
        <div className="hint-card" data-level={block.level}>
          <span className="hint-tag">
            <Lightbulb weight="fill" /> {block.level === "nudge" ? "Nudge" : block.level === "hint" ? "Hint" : "One step"} {block.rung} of {block.of}
          </span>
          <p className="hint-text" data-line={1}>
            <span className="hl-text">
              <MathText text={block.text} />
            </span>
          </p>
        </div>
      );
    case "draw":
      return (
        <>
          {block.caption && <p className="diagram-caption">{block.caption}</p>}
          {block.diagram.type === "graph" && block.diagram.params?.length ? (
            <EditableGraph diagram={block.diagram} width={width} shown={shown} />
          ) : (
            <DiagramView diagram={block.diagram} width={width} shown={shown} />
          )}
        </>
      );
    case "write":
      if (block.style === "heading")
        return (
          <h3 className="chalk-title chalk-write" data-line={1}>
            <span className="hl-text">
              <MathText text={block.lines.join(" ")} />
            </span>
          </h3>
        );
      if (block.style === "your_turn")
        return (
          <>
            <span className="problem-tag">Your turn</span>
            {block.lines.map((l, i) => (
              <p key={i} className="problem-line" data-line={i + 1}>
                <span className="hl-text">
                  <MathText text={l} />
                </span>
              </p>
            ))}
          </>
        );
      return (
        <div className={`wlines wlines-${block.style}`}>
          {block.lines.map((l, i) => (
            <RLine key={i} n={i + 1} shown={shown} as="p">
              <MathText text={l} />
            </RLine>
          ))}
        </div>
      );
    default:
      return (
        <>
          {(block.title || block.section || block.checked) && (
            <h3 className="chalk-title">
              {block.checked && (
                <span className="checked-chip" title="Every step here was checked by the maths engine">
                  <SealCheck weight="fill" /> checked
                </span>
              )}
              {block.section && (
                <span className="section-chip">
                  {block.section.n}/{block.section.of}
                </span>
              )}
              {block.title}
            </h3>
          )}
          <ol className="chalk-steps">
            {block.steps.map((s, i) => (
              <RLine key={i} n={i + 1} shown={shown}>
                <MathText text={s} />
              </RLine>
            ))}
          </ol>
        </>
      );
  }
}

/** The tutor pointing at something on the board: underline, circle, box, tick or arrow, in chalk. */
function HighlightMark({ h, r }: { h: Highlight; r: { x: number; y: number; w: number; h: number } }) {
  const pad = 6;
  switch (h.style) {
    case "circle": {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const rx = r.w / 2 + 16;
      const ry = r.h / 2 + 8;
      const pts: string[] = [];
      for (let a = -0.35, i = 0; a <= Math.PI * 2 + 0.25; a += 0.12, i++) {
        const wob = 1 + Math.sin(i * 1.7) * 0.025 + (a > Math.PI * 2 ? 0.06 : 0);
        pts.push(`${(cx + Math.cos(a) * rx * wob).toFixed(1)},${(cy + Math.sin(a) * ry * wob).toFixed(1)}`);
      }
      return <polyline points={pts.join(" ")} pathLength={1} className="hl-path" />;
    }
    case "box":
      return <rect x={r.x - pad} y={r.y - pad / 2} width={r.w + pad * 2} height={r.h + pad} rx={6} pathLength={1} className="hl-path" />;
    case "tick":
      return <path d={`M ${r.x + r.w + 10} ${r.y + r.h * 0.55} l 10 12 l 22 -28`} pathLength={1} className="hl-path" />;
    case "arrow":
      return <path d={`M ${r.x - 70} ${r.y + r.h / 2} L ${r.x - 14} ${r.y + r.h / 2} M ${r.x - 28} ${r.y + r.h / 2 - 12} L ${r.x - 14} ${r.y + r.h / 2} L ${r.x - 28} ${r.y + r.h / 2 + 12}`} pathLength={1} className="hl-path" />;
    default:
      return <path d={`M ${r.x} ${r.y + r.h - 2} q ${r.w / 2} 6 ${r.w} 0`} pathLength={1} className="hl-path" />;
  }
}

function drawStroke(ctx: CanvasRenderingContext2D, pts: Point[]) {
  if (pts.length === 0) return;
  ctx.beginPath();
  if (pts.length === 1) {
    ctx.arc(pts[0][0], pts[0][1], PEN_WIDTH / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(pts[0][0], pts[0][1]);
  // Smooth with midpoints so fast handwriting doesn't look jagged.
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
  ctx.stroke();
}

/** A hand-drawn red circle around one line of the student's work, like a teacher's pen. */
function MarkCircle({ box, index, note, scale, faded }: { box: Box; index: number; note: string; scale: number; faded: boolean }) {
  const cx = (box.x + box.w / 2) * scale;
  const cy = (box.y + box.h / 2) * scale;
  const rx = (box.w / 2 + 22) * scale;
  const ry = Math.max(box.h / 2 + 14, 22) * scale;
  const pts: string[] = [];
  for (let a = -0.35, i = 0; a <= Math.PI * 2 + 0.25; a += 0.12, i++) {
    const wobble = 1 + Math.sin(i * 1.7) * 0.025 + (a > Math.PI * 2 ? 0.06 : 0);
    pts.push(`${(cx + Math.cos(a) * rx * wobble).toFixed(1)},${(cy + Math.sin(a) * ry * wobble).toFixed(1)}`);
  }
  return (
    <>
      <svg className="mark-svg" data-faded={faded} aria-hidden="true">
        <polyline points={pts.join(" ")} pathLength={1} className="mark-path" />
      </svg>
      <div className="mark-note" data-faded={faded} style={{ left: Math.max(8, box.x * scale - 8), top: cy + ry + 6 }} role="status">
        <strong>Step {index}</strong> {note}
      </div>
    </>
  );
}

/** A real page of the student's uploaded material on the board, with its source. */
/** The picture of an uploaded page or photo, from this device's store. */
function usePageSrc(sessionCode: string, docId: string, page: number | null) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const doc = await getDoc(sessionCode, docId).catch(() => undefined);
      if (!doc) throw new Error("This file isn't on this device.");
      const url = doc.mediaType === "application/pdf" ? await renderPdfPage(doc.data, page ?? 1) : `data:${doc.mediaType};base64,${doc.data}`;
      if (!cancelled) setSrc(url);
    })().catch((err) => !cancelled && setError((err as Error).message || "Couldn't open this page."));
    return () => {
      cancelled = true;
    };
  }, [sessionCode, docId, page]);
  return { src, error };
}

function SourcePage({ block, sessionCode, onFix, fixing }: { block: Extract<TutorBlock, { kind: "source" }>; sessionCode: string; onFix?: () => void; fixing?: boolean }) {
  const { src, error } = usePageSrc(sessionCode, block.docId, block.page);
  if (block.photo)
    return (
      <figure className="photo-page" data-line={1}>
        {src ? <img className="hl-text" src={src} alt={block.docName} /> : <div className="source-wait">{error ?? "Opening the photo…"}</div>}
        <figcaption>
          <Camera weight="bold" /> {block.docName}
          {onFix && src && (
            <button className="fix-button" data-board-action onClick={onFix} disabled={fixing} title="Mark the slips on this photo and write each question out as an exam answer">
              {fixing ? <span className="spin" /> : <MagicWand weight="bold" />} {fixing ? "Fixing…" : "Fix it"}
            </button>
          )}
        </figcaption>
      </figure>
    );
  return (
    <figure className="source-page" data-line={1}>
      {src ? <img className="hl-text" src={src} alt={`${block.docName}${block.page ? `, page ${block.page}` : ""}`} /> : <div className="source-wait">{error ?? "Opening the page…"}</div>}
      <figcaption>
        <BookOpenText /> {block.docName}
        {block.page ? ` · page ${block.page}` : ""}
        {block.caption ? ` · ${block.caption}` : ""}
      </figcaption>
    </figure>
  );
}

/** Tells the student exactly where their Done submission is. */
function SubmissionCard({ sub, onRetry, canRetry }: { sub: Submission; onRetry: () => void; canRetry: boolean }) {
  const title =
    sub.state === "submitting"
      ? "Sending your work…"
      : sub.state === "reviewing"
        ? "Your teacher has it and is reading it…"
        : sub.state === "failed"
          ? "Didn't reach your teacher"
          : sub.state === "stale"
            ? "Not marked: there's something newer"
          : sub.status === "correct"
            ? "Your teacher checked it"
            : "Your teacher has read it";
  return (
    <div className="submission" data-state={sub.state} data-status={sub.status ?? ""} role="status" aria-live="polite">
      <strong>{title}</strong>
      {sub.summary && <span>{sub.summary}</span>}
      {sub.state === "done" && sub.marks && (
        <span className="submission-marks" title="Practice marks in the style of a CBSE marking scheme. Not an official mark.">
          Practice marks: <b>{halves(sub.marks.got)} / {halves(sub.marks.of)}</b>
          {sub.marks.provisional ? " (provisional: a line couldn't be read)" : " · CBSE-style, not official"}
        </span>
      )}
      {sub.state === "failed" && canRetry && (
        <button onClick={onRetry} className="submission-retry">
          Try again
        </button>
      )}
    </div>
  );
}

// ---------- typed lines ----------
const TYPED_SIZE = 26;
const TYPED_LINE = 46;
const TYPED_FONT = `${TYPED_SIZE}px Kalam, "Comic Sans MS", cursive`;
let measureCtx: CanvasRenderingContext2D | null = null;

function measureTyped(text: string): number {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * TYPED_SIZE * 0.5;
  measureCtx.font = TYPED_FONT;
  return measureCtx.measureText(text).width;
}

/** A typed line as a stroke: points[0] is its top-left, and points along its middle let the eraser find it. */
function typedStroke(id: string, text: string, x: number, y: number, w: number, t: number): TimedStroke {
  const h = TYPED_SIZE * 1.15;
  const points: Point[] = [
    [x, y],
    [x + w, y + h],
  ];
  for (let px = x + 12; px < x + w; px += 14) points.push([px, y + h / 2]);
  return { id, points, text, size: TYPED_SIZE, t };
}

function drawTyped(ctx: CanvasRenderingContext2D, s: Stroke) {
  const size = s.size ?? TYPED_SIZE;
  ctx.save();
  ctx.font = `${size}px Kalam, "Comic Sans MS", cursive`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(s.text ?? "", s.points[0][0], s.points[0][1] + size * 0.85);
  ctx.restore();
}

// ---------- "Fix it": the student's photo, corrected, and the exam answer ----------
function FixView({ block, sessionCode }: { block: Extract<TutorBlock, { kind: "fix" }>; sessionCode: string }) {
  const { src, error } = usePageSrc(sessionCode, block.docId, null);
  const marks = block.questions.flatMap((q) => q.marks);
  const allRight = block.questions.every((q) => q.status === "correct");
  return (
    <div className="fix-block">
      <p className="fix-head">
        <MagicWand weight="bold" /> {allRight ? "Checked: your working is right" : "Fixed: your working"}
        {block.simulated && <span className="fix-sim"> (simulated)</span>}
      </p>
      <figure className="fix-photo" data-line={1}>
        <div className="fix-photo-inner">
          {src ? <img className="hl-text" src={src} alt="Your working, with corrections" /> : <div className="source-wait">{error ?? "Opening the photo…"}</div>}
          {src &&
            marks.map((m, i) => (
              <div key={i} className="fix-band" style={{ top: `${m.top * 100}%`, height: `${(m.bottom - m.top) * 100}%` }}>
                {m.fix && <span className="fix-note">{m.fix}</span>}
              </div>
            ))}
        </div>
      </figure>
      {block.questions.map((q, i) => (
        <section key={i} className="exam-answer" aria-label={`Answer ${i + 1}`}>
          <p className="exam-q">
            <b>{block.questions.length > 1 ? `Q${i + 1}.` : "Q."}</b> {q.question}
          </p>
          {q.status === "unreadable" ? (
            <p className="exam-line">I couldn't read this one clearly. Try a closer photo.</p>
          ) : (
            <>
              <p className="exam-sol">Solution:</p>
              {q.solution.map((l, j) => (
                <p key={j} className={`exam-line${l.startsWith("∴") && j === q.solution.length - 1 ? " exam-final" : ""}`}>
                  {l}
                </p>
              ))}
            </>
          )}
        </section>
      ))}
      <p className="fix-foot">Written by your tutor from your photo. Not checked by the maths engine, so read each step.</p>
    </div>
  );
}

/** Moves a range input to the pointer's x, the way a real drag would (React sees an input event). */
function slideTo(input: HTMLInputElement, clientX: number) {
  const r = input.getBoundingClientRect();
  const min = Number(input.min);
  const max = Number(input.max);
  const step = Number(input.step) || 1;
  const t = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
  const v = Math.round((min + t * (max - min)) / step) * step;
  const next = String(Math.min(max, Math.max(min, Number(v.toFixed(4)))));
  if (input.value === next) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The typing field in the bottom bar. Its own state, so typing doesn't re-render the board. */
function DockInput({ attach, typing, onToggleTyping, onAdd }: { attach: ReactNode; typing: boolean; onToggleTyping: () => void; onAdd: (text: string) => void }) {
  const [line, setLine] = useState("");
  return (
    <form
      className="dock-input"
      onSubmit={(e) => {
        e.preventDefault();
        if (!line.trim()) return;
        onAdd(line.trim().slice(0, 120));
        setLine("");
      }}
    >
      {attach}
      <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="Type a step…" aria-label="Type a step" maxLength={120} enterKeyHint="send" />
      <button type="button" className={typing ? "on" : ""} onClick={onToggleTyping} aria-label="Type" aria-expanded={typing} title="Type several steps, with maths symbols">
        <TextT />
      </button>
      {/* The send arrow appears once there's something to send, so the field keeps its room. */}
      {line.trim() && (
        <button type="submit" className="dock-send" aria-label="Add this step to the board" title="Add this step to the board">
          <ArrowUp weight="bold" />
        </button>
      )}
    </form>
  );
}
