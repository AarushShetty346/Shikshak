// The shared blackboard: one long, scrollable page that the tutor and the student both write on,
// like a notes app. The tutor's blocks (steps, problems, plan sections) stack one after another
// below whatever is already on the page; the student writes anywhere with a finger, stylus or mouse.
//
// Everything is laid out in board units: the page is BOARD_W units wide and scales to the screen,
// so writing lines up the same on a phone and a laptop. Only the visible part of the ink is drawn.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { groupIntoLines, strokeBox } from "../../../shared/lines";
import type { ClientMessage, Point, SectionInfo, Stroke, WrittenLine } from "../../../shared/types";
import { makeSnapshot } from "../lib/snapshot";
import { MathText } from "./MathText";

export const BOARD_W = 640;
const MAX_PAGE_PX = 860; // on big screens the page stops growing and sits in the middle
const MARGIN = 46; // left margin for line numbers
const GAP = 34;
const PAGE_GAP = 140;
const INK = "#9fd3ff";
const PEN_WIDTH = 3.2;
const ERASER_RADIUS = 18;

export type TutorBlock =
  | { kind: "steps"; id: string; title: string; steps: string[]; section?: SectionInfo; instant: boolean }
  | { kind: "problem"; id: string; problem: string; instant: boolean }
  | { kind: "plan"; id: string; title: string; items: string[]; instant: boolean }
  | { kind: "page"; id: string; instant: boolean };

export type BoardStatus = "idle" | "checking" | "correct";

interface Props {
  sessionCode: string;
  blocks: TutorBlock[];
  /** Section of the plan the tutor is on, to highlight it in the plan block. */
  currentSection: number | null;
  mark: { captureId: string; line: number; note: string } | null;
  correctCapture: string | null;
  status: BoardStatus;
  /** Increments when the server asks for the student's latest work. */
  captureTick: number;
  send: (msg: ClientMessage) => void;
  /** Student pressed Done: tell the tutor to look. */
  onDone: () => void;
}

interface Saved {
  strokes: Stroke[];
  /** For each tutor block: the lowest point of the ink when it arrived, so it is placed below it. */
  floors: Record<string, number>;
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

function inkBottom(strokes: Stroke[]): number {
  let bottom = 0;
  for (const s of strokes) for (const [, y] of s.points) if (y > bottom) bottom = y;
  return bottom;
}

export function Board({ sessionCode, blocks, currentSection, mark, correctCapture, status, captureTick, send, onDone }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const saved = useMemo(() => loadSaved(sessionCode), [sessionCode]);

  const [strokes, setStrokes] = useState<Stroke[]>(saved.strokes);
  const floors = useRef<Record<string, number>>(saved.floors);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [view, setView] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<"pen" | "eraser" | "hand">("pen");
  const [newBelow, setNewBelow] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<string>("");

  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const drawing = useRef<Stroke | null>(null);
  const activePointer = useRef<number | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const panning = useRef<{ y: number } | null>(null);
  const lastPenAt = useRef(0);
  const lastDrawAt = useRef(0);
  const captures = useRef(new Map<string, WrittenLine[]>());

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
  const pageW = Math.min(view.w, MAX_PAGE_PX);
  const scale = pageW > 0 ? pageW / BOARD_W : 1;
  const pageLeft = Math.max(0, (view.w - pageW) / 2);

  // ---------- layout of tutor blocks ----------
  // Record where the ink ended when each block first arrived (persisted, so a reload keeps the layout).
  for (const b of blocks) {
    if (floors.current[b.id] === undefined) floors.current[b.id] = inkBottom(strokesRef.current);
  }
  const layout = useMemo(() => {
    const pos: Record<string, number> = {};
    let bottom = 0;
    for (const b of blocks) {
      const floor = floors.current[b.id] ?? 0;
      const gap = b.kind === "page" ? PAGE_GAP : GAP;
      const y = Math.max(bottom + (bottom ? gap : 16), floor ? floor + gap : 16);
      pos[b.id] = y;
      bottom = y + (heights[b.id] ?? (b.kind === "page" ? 40 : 120));
    }
    return { pos, bottom };
  }, [blocks, heights]);

  const contentBottom = Math.max(layout.bottom, inkBottom(strokes));
  const pageHeightUnits = contentBottom + (view.h / scale) * 0.85 + 60;

  // The student's current answer area: everything written below the latest problem on this page
  // (or below the latest tutor block if there is no problem).
  const regionTop = useMemo(() => {
    let top = 0;
    let lastBlockBottom = 0;
    for (const b of blocks) {
      const y = layout.pos[b.id];
      const bottom = y + (heights[b.id] ?? 0);
      if (b.kind === "page") top = bottom;
      if (b.kind === "problem") top = bottom;
      lastBlockBottom = bottom;
    }
    return top || lastBlockBottom;
  }, [blocks, layout, heights]);

  const response = useMemo(() => strokes.filter((s) => strokeBox(s).y >= regionTop - 12), [strokes, regionTop]);
  const lines = useMemo(() => groupIntoLines(response), [response]);
  const responseKey = response.map((s) => s.id).join(",");

  // ---------- measuring tutor blocks ----------
  const measure = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (!el || !scale) return;
      const h = el.offsetHeight / scale;
      setHeights((prev) => (Math.abs((prev[id] ?? 0) - h) < 1 ? prev : { ...prev, [id]: h }));
    },
    [scale],
  );

  // ---------- persistence ----------
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(`shikshak.board.${sessionCode}`, JSON.stringify({ strokes, floors: floors.current }));
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
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * pageLeft, -dpr * scroller.scrollTop);
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
  }, [scale, pageLeft, view.h]);

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

  // ---------- follow new tutor writing ----------
  const lastBlockId = blocks.length ? blocks[blocks.length - 1].id : "";
  useEffect(() => {
    if (!lastBlockId) return;
    const last = blocks[blocks.length - 1];
    if (last.instant) return;
    const scroller = scrollRef.current;
    const y = layout.pos[lastBlockId];
    if (!scroller || y === undefined) return;
    if (Date.now() - lastDrawAt.current < 2500) {
      setNewBelow(true); // the student is writing: don't yank the page, show a pill instead
      return;
    }
    const t = setTimeout(() => scroller.scrollTo({ top: Math.max(0, (y - 30) * scale), behavior: "smooth" }), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBlockId]);

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
    const x = (clientX - rect.left - pageLeft) / scale;
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

  // ---------- marks ----------
  const markLines = mark ? captures.current.get(mark.captureId) : undefined;
  const markedLine = markLines?.find((l) => l.index === mark!.line);
  // Fade the circle once the student starts fixing their work.
  const markBase = useRef({ key: "", count: 0 });
  const markKey = mark ? `${mark.captureId}:${mark.line}` : "";
  if (markBase.current.key !== markKey) markBase.current = { key: markKey, count: strokes.length };
  const drewSinceMark = strokes.length > markBase.current.count;
  const correctLines = correctCapture ? captures.current.get(correctCapture) : undefined;
  const correctAt = correctLines?.length ? correctLines[correctLines.length - 1].box : null;

  const canDone = response.length > 0 && responseKey !== lastDone;
  const px = (u: number) => u * scale;

  return (
    <div className="board" ref={wrapRef} data-tool={tool}>
      <div className="board-scroll" ref={scrollRef} onScroll={onScroll}>
        <div
          className="board-page"
          style={{
            height: px(pageHeightUnits),
            width: pageW,
            marginLeft: pageLeft,
            backgroundSize: `100% ${px(52)}px`,
            ["--s" as string]: scale,
          }}
        >
          {blocks.map((b) => (
            <div
              key={b.id}
              ref={measure(b.id)}
              className={`tblock tblock-${b.kind}`}
              style={{ top: px(layout.pos[b.id] ?? 0), left: px(MARGIN), width: px(BOARD_W - MARGIN - 18) }}
            >
              <BlockBody block={b} currentSection={currentSection} />
            </div>
          ))}

          {lines.map((l) => (
            <span
              key={l.index}
              className="line-number"
              data-marked={mark?.line === l.index && !!markedLine}
              style={{ top: px(l.box.y + l.box.h / 2), width: px(MARGIN - 6) }}
            >
              {l.index}
            </span>
          ))}

          {markedLine && <MarkCircle box={markedLine.box} index={markedLine.index} note={mark!.note} scale={scale} faded={drewSinceMark} />}
          {correctAt && status === "correct" && (
            <div className="stamp" style={{ top: px(correctAt.y + correctAt.h + 10), left: px(Math.min(correctAt.x + correctAt.w, BOARD_W - 200)) }}>
              <span>✓</span> Shabash!
            </div>
          )}
          {regionTop > 0 && response.length === 0 && blocks.some((b) => b.kind === "problem") && (
            <div className="write-here" style={{ top: px(regionTop + 18), left: px(MARGIN) }}>
              Write your working here, one step per line
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
      {newBelow && (
        <button
          className="board-pill board-pill-new"
          onClick={() => {
            setNewBelow(false);
            const y = layout.pos[lastBlockId];
            scrollRef.current?.scrollTo({ top: Math.max(0, (y - 30) * scale), behavior: "smooth" });
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
        <button className="btn-done" onClick={done} disabled={!canDone}>
          ✓ Done
        </button>
      </div>
    </div>
  );
}

function avgY(points: Map<number, { x: number; y: number }>): number {
  let sum = 0;
  for (const p of points.values()) sum += p.y;
  return sum / Math.max(1, points.size);
}

function BlockBody({ block, currentSection }: { block: TutorBlock; currentSection: number | null }) {
  switch (block.kind) {
    case "page":
      return <div className="page-rule">New page</div>;
    case "plan":
      return (
        <>
          <h3 className="chalk-title">{block.title || "Aaj ka plan"}</h3>
          <ol className="plan-list">
            {block.items.map((item, i) => (
              <li key={i} data-state={currentSection === null ? "" : i + 1 < currentSection ? "done" : i + 1 === currentSection ? "now" : ""}>
                {item}
              </li>
            ))}
          </ol>
        </>
      );
    case "problem":
      return (
        <>
          <span className="problem-tag">Your turn</span>
          <p className="problem-line">
            <MathText text={block.problem} />
          </p>
        </>
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
              <li key={i} className={block.instant ? "" : "chalk-write"} style={block.instant ? undefined : { animationDelay: `${0.25 + i * 1.3}s` }}>
                <MathText text={s} />
              </li>
            ))}
          </ol>
        </>
      );
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

/** A hand-drawn red circle around one line, like a teacher's pen. */
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
