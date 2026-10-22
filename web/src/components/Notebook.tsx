import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { groupIntoLines } from "../../../shared/lines";
import type { Point, Stroke, WrittenLine } from "../../../shared/types";
import { makeSnapshot } from "../lib/snapshot";
import { MathText } from "./MathText";

export type NotebookStatus = "idle" | "checking" | "correct";

interface Props {
  problem: string | null;
  mark: { line: number; note: string } | null;
  status: NotebookStatus;
  /** Increments when the server asks for a fresh snapshot (a check is starting). */
  snapshotTick: number;
  onSnapshot: (png: string | null, lineCount: number) => void;
}

const INK = "#1f3a93"; // blue ballpoint
const PEN_WIDTH = 3;
const ERASER_RADIUS = 16;

let strokeCounter = 0;

export function Notebook({ problem, mark, status, snapshotTick, onSnapshot }: Props) {
  const paperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drewSinceMark, setDrewSinceMark] = useState(false);
  const drawing = useRef<Stroke | null>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  const lines = useMemo(() => groupIntoLines(strokes), [strokes]);
  const linesRef = useRef<WrittenLine[]>(lines);
  linesRef.current = lines;

  // Keep the canvas sharp at any size and pixel density.
  useLayoutEffect(() => {
    const el = paperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = INK;
    ctx.lineWidth = PEN_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokesRef.current) drawStroke(ctx, s.points);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    redraw();
  }, [size, redraw]);

  useEffect(redraw, [strokes, redraw]);

  // Send the notebook to the server shortly after the student stops writing...
  useEffect(() => {
    const t = setTimeout(() => onSnapshot(makeSnapshot(strokes, lines), lines.length), 400);
    return () => clearTimeout(t);
  }, [strokes, lines, onSnapshot]);

  // ...and immediately when a check starts.
  useEffect(() => {
    if (snapshotTick > 0) onSnapshot(makeSnapshot(strokesRef.current, linesRef.current), linesRef.current.length);
  }, [snapshotTick, onSnapshot]);

  useEffect(() => setDrewSinceMark(false), [mark]);

  const pointFrom = (e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [Math.round((e.clientX - rect.left) * 10) / 10, Math.round((e.clientY - rect.top) * 10) / 10];
  };

  const eraseAt = (p: Point) => {
    setStrokes((prev) => {
      const next = prev.filter((s) => !s.points.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < ERASER_RADIUS));
      return next.length === prev.length ? prev : next;
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointFrom(e);
    if (tool === "eraser") {
      drawing.current = { id: "eraser", points: [p] };
      eraseAt(p);
      return;
    }
    drawing.current = { id: `s${++strokeCounter}`, points: [p] };
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.arc(p[0], p[1], PEN_WIDTH / 2, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = drawing.current;
    if (!stroke) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const rect = canvasRef.current!.getBoundingClientRect();
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const p: Point = [ev.clientX - rect.left, ev.clientY - rect.top];
      if (tool === "eraser") {
        eraseAt(p);
        continue;
      }
      const last = stroke.points[stroke.points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.2) continue;
      stroke.points.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
      const ctx = canvasRef.current!.getContext("2d")!;
      ctx.strokeStyle = INK;
      ctx.lineWidth = PEN_WIDTH;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
  };

  const onPointerUp = () => {
    const stroke = drawing.current;
    drawing.current = null;
    if (!stroke || stroke.id === "eraser") return;
    setStrokes((prev) => [...prev, stroke]);
    setDrewSinceMark(true);
  };

  const markedLine = mark ? lines.find((l) => l.index === mark.line) : undefined;

  return (
    <div className="notebook">
      <div className="problem-card" data-empty={!problem}>
        <span className="problem-label">{problem ? "Your turn" : "Notebook"}</span>
        <p className="problem-text">
          {problem ? <MathText text={problem} /> : "Your teacher will give you a problem here. Write one step per line."}
        </p>
      </div>

      <div className="paper" ref={paperRef} data-tool={tool}>
        <div className="paper-margin" aria-hidden="true" />
        {lines.map((l) => (
          <span
            key={l.index}
            className="line-number"
            data-marked={mark?.line === l.index}
            style={{ top: l.box.y + l.box.h / 2 }}
          >
            {l.index}
          </span>
        ))}
        <canvas
          ref={canvasRef}
          className="ink"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {markedLine && <MarkCircle line={markedLine} note={mark!.note} faded={drewSinceMark} />}
        {status === "checking" && (
          <div className="checking" role="status">
            <div className="scan" />
            <span className="checking-pill">Checking your work…</span>
          </div>
        )}
        {status === "correct" && (
          <div className="stamp" role="status">
            <span>✓</span> Shabash!
          </div>
        )}

        <div className="tools" role="toolbar" aria-label="Notebook tools">
          <button className={tool === "pen" ? "on" : ""} onClick={() => setTool("pen")} aria-label="Pen" title="Pen">
            <PenIcon />
          </button>
          <button className={tool === "eraser" ? "on" : ""} onClick={() => setTool("eraser")} aria-label="Eraser" title="Eraser">
            <EraserIcon />
          </button>
          <button onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length} aria-label="Undo" title="Undo">
            <UndoIcon />
          </button>
          <button onClick={() => setStrokes([])} disabled={!strokes.length} aria-label="Clear page" title="Clear page">
            <TrashIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function drawStroke(ctx: CanvasRenderingContext2D, pts: Point[]) {
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 1) {
    ctx.arc(pts[0][0], pts[0][1], PEN_WIDTH / 2, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
    return;
  }
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
function MarkCircle({ line, note, faded }: { line: WrittenLine; note: string; faded: boolean }) {
  const cx = line.box.x + line.box.w / 2;
  const cy = line.box.y + line.box.h / 2;
  const rx = line.box.w / 2 + 26;
  const ry = Math.max(line.box.h / 2 + 16, 26);
  // Slightly wobbly ellipse that overshoots its start, so it reads as drawn by hand.
  const pts: string[] = [];
  const start = -0.35;
  const end = Math.PI * 2 + 0.25;
  for (let a = start, i = 0; a <= end; a += 0.12, i++) {
    const wobble = 1 + Math.sin(i * 1.7) * 0.025 + (a > Math.PI * 2 ? 0.06 : 0);
    pts.push(`${(cx + Math.cos(a) * rx * wobble).toFixed(1)},${(cy + Math.sin(a) * ry * wobble).toFixed(1)}`);
  }
  return (
    <>
      <svg className="mark-svg" data-faded={faded} aria-hidden="true">
        <polyline points={pts.join(" ")} pathLength={1} className="mark-path" />
      </svg>
      <div
        className="mark-note"
        data-faded={faded}
        style={{ left: Math.max(8, line.box.x - 8), top: cy + ry + 6 }}
        role="status"
      >
        <strong>Step {line.index}</strong> {note}
      </div>
    </>
  );
}

const PenIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const EraserIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19" /><path d="M22 21H7" /><path d="m5 11 9 9" />
  </svg>
);
const UndoIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" />
  </svg>
);
