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
import type { ClientMessage, MarkStyle, Place, Point, SectionInfo, Stroke, WriteStyle, WrittenLine } from "../../../shared/types";
import { makeSnapshot } from "../lib/snapshot";
import { DiagramView, diagramHeight } from "./DiagramView";
import { MathText } from "./MathText";

const PAD_L = 38; // room for the student's line numbers
const PAD_R = 22;
const GAP = 34;
const PAGE_GAP = 160;
const TOP = 70; // clear of the brand mark and voice indicator floating at the top
const INK = "#9fd3ff";
const PEN_WIDTH = 3.2;
const ERASER_RADIUS = 18;
/** Seconds of the tutor's speech per revealed line or diagram piece. */
const SPEECH_PER_PIECE = 1.4;

export type TutorBlock =
  | { kind: "write"; id: string; label: string; style: WriteStyle; lines: string[]; place: Place; replaces: string | null; instant: boolean }
  | { kind: "draw"; id: string; label: string; diagram: Diagram; caption: string; place: Place; replaces: string | null; instant: boolean }
  | { kind: "steps"; id: string; label?: string; title: string; steps: string[]; section?: SectionInfo; instant: boolean }
  | { kind: "problem"; id: string; label?: string; problem: string; instant: boolean }
  | { kind: "plan"; id: string; label?: string; title: string; items: string[]; instant: boolean }
  | { kind: "page"; id: string; instant: boolean };

export interface Highlight {
  id: string;
  target: string;
  line: number | null;
  style: MarkStyle;
  note: string;
}

export type BoardStatus = "idle" | "checking" | "correct";

interface Props {
  sessionCode: string;
  blocks: TutorBlock[];
  highlights: Highlight[];
  erased: string[];
  currentSection: number | null;
  mark: { captureId: string; line: number; note: string } | null;
  correctCapture: string | null;
  status: BoardStatus;
  /** Increments when the server asks for the student's latest work. */
  captureTick: number;
  /** Voice state, to pace the writing with the tutor's speech. */
  callActive: boolean;
  teacherSpeaking: boolean;
  /** Increments when the student interrupts (pause unfinished writing) / the tutor resumes. */
  holdTick: number;
  resumeTick: number;
  send: (msg: ClientMessage) => void;
  /** Student pressed Done: tell the tutor to look. */
  onDone: () => void;
  /** Extra toolbar buttons (start/end class, ask doubt). */
  toolbarExtra?: ReactNode;
}

interface Saved {
  strokes: Stroke[];
  /** For each tutor block: the lowest ink in its column when it arrived, so it goes below it. */
  floors: Record<string, number>;
  /** Page width in board units, fixed for the session. */
  w?: number;
}

let strokeCounter = 0;
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `id${Date.now()}${Math.random()}`);

function loadSaved(code: string): Saved {
  try {
    const raw = sessionStorage.getItem(`shikshak.board.${code}`);
    if (raw) return JSON.parse(raw) as Saved;
  } catch {
    // storage blocked or corrupt: start empty
  }
  return { strokes: [], floors: {} };
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
  const { sessionCode, blocks, highlights, erased, currentSection, mark, correctCapture, status, captureTick, send, onDone, toolbarExtra } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const saved = useMemo(() => loadSaved(sessionCode), [sessionCode]);

  const [strokes, setStrokes] = useState<Stroke[]>(saved.strokes);
  const floors = useRef<Record<string, number>>(saved.floors);
  const unitsW = useRef<number | undefined>(saved.w);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [view, setView] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<"pen" | "eraser" | "hand">("pen");
  const [newBelow, setNewBelow] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<string>("");
  const [revealed, setRevealed] = useState<Record<string, number>>({});
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [hlRects, setHlRects] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});

  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const drawing = useRef<Stroke | null>(null);
  const activePointer = useRef<number | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const panning = useRef<{ y: number } | null>(null);
  const lastPenAt = useRef(0);
  const lastDrawAt = useRef(0);
  const captures = useRef(new Map<string, WrittenLine[]>());
  const blockEls = useRef(new Map<string, HTMLElement>());

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
    if (floors.current[b.id] === undefined) {
      const col = columnOf(b) === "side" ? side : main;
      floors.current[b.id] = b.kind === "page" ? inkBottom(strokesRef.current) : inkBottom(strokesRef.current, col.x0, col.x1);
    }
  }
  const estimate = (b: TutorBlock, width: number) =>
    b.kind === "draw" ? diagramHeight(b.diagram, width) + 40 : b.kind === "page" ? 40 : 60 + piecesOf(b) * 46;

  const layout = useMemo(() => {
    const pos: Record<string, { x: number; y: number; w: number }> = {};
    const byLabel: Record<string, { x: number; y: number; w: number }> = {};
    let mainBottom = 0;
    let sideBottom = 0;
    let lastMainTop = 0;
    for (const b of blocks) {
      const floor = floors.current[b.id] ?? 0;
      const col = columnOf(b);
      const box = col === "side" ? side : main;
      const w = b.kind === "page" ? W - PAD_L - PAD_R : box.x1 - box.x0;
      const h = heights[b.id] ?? estimate(b, w);
      const reuse = "replaces" in b && b.replaces ? byLabel[b.replaces] : undefined;
      let p: { x: number; y: number; w: number };
      if (reuse) p = reuse;
      else if (b.kind === "page") p = { x: PAD_L, y: Math.max(mainBottom, sideBottom, floor) + PAGE_GAP, w };
      else if (col === "side") p = { x: box.x0, y: Math.max(sideBottom ? sideBottom + GAP : TOP, lastMainTop, floor ? floor + GAP : TOP), w };
      else p = { x: box.x0, y: Math.max(mainBottom ? mainBottom + GAP : TOP, floor ? floor + GAP : TOP), w };
      pos[b.id] = p;
      const label = blockLabel(b);
      if (label) byLabel[label] = p;
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
  }, [blocks, heights, W]);

  const contentBottom = Math.max(layout.bottom, inkBottom(strokes));
  const pageHeightUnits = contentBottom + (view.h / scale) * 0.85 + 60;

  // The student's current answer area: below the latest problem / "your turn" (or the latest block).
  const regionTop = useMemo(() => {
    let top = 0;
    let lastBottom = 0;
    for (const b of blocks) {
      const p = layout.pos[b.id];
      if (!p) continue;
      const bottom = p.y + (heights[b.id] ?? 0);
      if (b.kind === "page" || b.kind === "problem" || (b.kind === "write" && b.style === "your_turn")) top = bottom;
      lastBottom = Math.max(lastBottom, bottom);
    }
    return top || lastBottom;
  }, [blocks, layout, heights]);

  const response = useMemo(() => strokes.filter((s) => strokeBox(s).y >= regionTop - 12), [strokes, regionTop]);
  const lines = useMemo(() => groupIntoLines(response), [response]);
  const responseKey = response.map((s) => s.id).join(",");

  // ---------- measuring tutor blocks ----------
  const measure = useCallback(
    (b: TutorBlock) => (el: HTMLElement | null) => {
      const label = blockLabel(b);
      if (label) {
        if (el) blockEls.current.set(label, el);
        else blockEls.current.delete(label);
      }
      if (!el || !scale) return;
      const h = el.offsetHeight / scale;
      setHeights((prev) => (Math.abs((prev[b.id] ?? 0) - h) < 1 ? prev : { ...prev, [b.id]: h }));
    },
    [scale],
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

  const live = useRef({ callActive: props.callActive, teacherSpeaking: props.teacherSpeaking, blocks, revealed, held });
  live.current = { callActive: props.callActive, teacherSpeaking: props.teacherSpeaking, blocks, revealed, held };
  const speech = useRef({ talk: 0, quiet: 0, sinceHold: 0, blocksAtHold: 0 });

  useEffect(() => {
    const TICK = 0.2;
    const id = setInterval(() => {
      const { callActive, teacherSpeaking, blocks: bs, revealed: rv, held: hd } = live.current;
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
        step = sp.talk >= SPEECH_PER_PIECE;
      } else {
        sp.quiet += TICK;
        // If she wrote something but isn't talking about it, don't leave it half-written forever.
        if (sp.quiet > 5) {
          sp.talk += TICK;
          step = sp.talk >= 1.8;
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
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(`shikshak.board.${sessionCode}`, JSON.stringify({ strokes, floors: floors.current, w: unitsW.current }));
      } catch {
        // storage full or blocked: the board still works, it just won't survive a reload
      }
    }, 400);
    return () => clearTimeout(t);
  }, [strokes, blocks, sessionCode]);

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
      drawStroke(ctx, s.points);
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

  const frame = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      redraw();
      const s = scrollRef.current;
      if (s && s.scrollTop + s.clientHeight >= (layout.bottom - 20) * scale) setNewBelow(false);
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
    // Bring the block into view if it starts below the fold or its revealed part runs past it.
    const shownBottom = p.y + (h * (revealed[lastBlock.id] ?? 1)) / piecesOf(lastBlock);
    if (p.y < visibleTop || shownBottom > visibleBottom - 80) followTo(Math.max(p.y - 40, shownBottom - (view.h / scale) * 0.75));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBlock?.id, revealed[lastBlock?.id ?? ""]]);

  // On first load, jump to the end of the page.
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !view.h || !blocks.length) return;
    jumped.current = true;
    scrollRef.current?.scrollTo({ top: Math.max(0, (contentBottom - view.h / scale / 2) * scale) });
  }, [view.h, blocks.length, contentBottom, scale]);

  // ---------- capture: the student's latest work as a numbered image ----------
  const capture = useCallback(
    (reason: "done" | "request") => {
      const id = newId();
      captures.current.set(id, lines);
      if (captures.current.size > 20) captures.current.delete(captures.current.keys().next().value!);
      send({ kind: "capture", id, reason, png: makeSnapshot(response, lines), lineCount: lines.length });
    },
    [lines, response, send],
  );
  useEffect(() => {
    if (captureTick > 0) capture("request");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureTick]);

  const done = () => {
    capture("done");
    setLastDone(responseKey);
    onDone();
    setToast("Sent to your teacher. Keep talking if you want to explain.");
    setTimeout(() => setToast(null), 3500);
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
    setStrokes((prev) => [...prev, stroke]);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
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
    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (panning.current && (touches.current.size >= 2 || (tool === "hand" && e.pointerId === activePointer.current))) {
      const y = touches.current.size >= 2 ? avgY(touches.current) : e.clientY;
      scroller.scrollTop -= y - panning.current.y;
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
    scrollRef.current?.scrollBy({ top: e.deltaY });
  };

  // ---------- marks on the student's work ----------
  const markLines = mark ? captures.current.get(mark.captureId) : undefined;
  const markedLine = markLines?.find((l) => l.index === mark!.line);
  // Fade the circle once the student starts fixing their work.
  const markBase = useRef({ key: "", count: 0 });
  const markKey = mark ? `${mark.captureId}:${mark.line}` : "";
  if (markBase.current.key !== markKey) markBase.current = { key: markKey, count: strokes.length };
  const drewSinceMark = strokes.length > markBase.current.count;
  const correctLines = correctCapture ? captures.current.get(correctCapture) : undefined;
  const correctAt = correctLines?.length ? correctLines[correctLines.length - 1].box : null;

  const erasedSet = useMemo(() => {
    const set = new Set(erased);
    for (const b of blocks) if ("replaces" in b && b.replaces) set.add(b.replaces);
    return set;
  }, [erased, blocks]);

  const canDone = response.length > 0 && responseKey !== lastDone;
  const latestQuestion = [...blocks].reverse().find((b) => b.kind === "problem" || (b.kind === "write" && b.style === "your_turn"));

  return (
    <div className="board" ref={wrapRef} data-tool={tool}>
      <div className="board-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="board-page" ref={pageRef} style={{ height: px(pageHeightUnits), ["--s" as string]: scale }}>
          {blocks.map((b) => {
            const p = layout.pos[b.id] ?? { x: PAD_L, y: 0, w: W - PAD_L - PAD_R };
            const label = blockLabel(b);
            return (
              <div
                key={b.id}
                ref={measure(b)}
                className={`tblock tblock-${b.kind}${b.kind === "write" ? ` tblock-${b.style}` : ""}`}
                data-erased={label ? erasedSet.has(label) : false}
                data-held={held.has(b.id)}
                style={{ top: px(p.y), left: px(p.x), width: px(p.w) }}
              >
                <BlockBody block={b} shown={revealed[b.id] ?? (b.instant ? piecesOf(b) : 1)} width={p.w} currentSection={currentSection} />
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

          {lines.map((l) => (
            <span
              key={l.index}
              className="line-number"
              data-marked={mark?.line === l.index && !!markedLine}
              style={{ top: px(l.box.y + l.box.h / 2), left: px(Math.max(0, l.box.x - PAD_L)), width: px(PAD_L - 6) }}
            >
              {l.index}
            </span>
          ))}

          {markedLine && <MarkCircle box={markedLine.box} index={markedLine.index} note={mark!.note} scale={scale} faded={drewSinceMark} />}
          {correctAt && status === "correct" && (
            <div className="stamp" style={{ top: px(correctAt.y + correctAt.h + 10), left: px(Math.min(correctAt.x + correctAt.w, W - 200)) }}>
              <span>✓</span> Shabash!
            </div>
          )}
          {latestQuestion && response.length === 0 && (
            <div className="write-here" style={{ top: px(regionTop + 18), left: px(layout.pos[latestQuestion.id]?.x ?? PAD_L) }}>
              Write here, one step per line
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
          ⏸ Board paused for your doubt · continue
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
          New on the board ↓
        </button>
      )}
      {toast && <div className="board-toast" role="status">{toast}</div>}

      <div className="board-tools" role="toolbar" aria-label="Board tools">
        <button className={tool === "pen" ? "on" : ""} onClick={() => setTool("pen")} aria-label="Pen" title="Pen">
          <PenIcon />
        </button>
        <button className={tool === "eraser" ? "on" : ""} onClick={() => setTool("eraser")} aria-label="Eraser" title="Eraser">
          <EraserIcon />
        </button>
        <button className={tool === "hand" ? "on" : ""} onClick={() => setTool("hand")} aria-label="Scroll" title="Scroll (or use two fingers)">
          <HandIcon />
        </button>
        <button onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length} aria-label="Undo" title="Undo">
          <UndoIcon />
        </button>
        <button
          onClick={() => setStrokes((all) => all.filter((s) => !response.includes(s)))}
          disabled={!response.length}
          aria-label="Clear my answer"
          title="Clear what I wrote below the question"
        >
          <TrashIcon />
        </button>
        <button className="btn-done" onClick={done} disabled={!canDone} title="Send my work to the teacher">
          ✓ Done
        </button>
        {toolbarExtra && <span className="tools-sep" aria-hidden="true" />}
        {toolbarExtra}
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

function BlockBody({ block, shown, width, currentSection }: { block: TutorBlock; shown: number; width: number; currentSection: number | null }) {
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
          <span className="problem-tag">Your turn</span>
          <p className="problem-line" data-line={1}>
            <span className="hl-text">
              <MathText text={block.problem} />
            </span>
          </p>
        </>
      );
    case "draw":
      return (
        <>
          {block.caption && <p className="diagram-caption">{block.caption}</p>}
          <DiagramView diagram={block.diagram} width={width} shown={shown} />
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
          {(block.title || block.section) && (
            <h3 className="chalk-title">
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
function MarkCircle({ box, index, note, scale, faded }: { box: WrittenLine["box"]; index: number; note: string; scale: number; faded: boolean }) {
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

const PenIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const EraserIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </svg>
);
const HandIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 11V6a2 2 0 0 0-4 0v5" />
    <path d="M14 10V4a2 2 0 0 0-4 0v6" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </svg>
);
const UndoIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="m19 6-1 14H6L5 6" />
  </svg>
);
