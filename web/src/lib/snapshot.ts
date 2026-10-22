import type { Stroke, WrittenLine } from "../../../shared/types";

const MARGIN = 80; // room for the line numbers
const PAD = 24;
const MAX_SIDE = 1400;

/**
 * Renders the student's strokes to a clean PNG for the checker: black ink on white,
 * cropped to the writing, with each line's number in the left margin. The checker only
 * has to say "line 2 is wrong"; we already know where line 2 is.
 */
export function makeSnapshot(strokes: Stroke[], lines: WrittenLine[]): string | null {
  if (lines.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of lines) {
    minX = Math.min(minX, l.box.x);
    minY = Math.min(minY, l.box.y);
    maxX = Math.max(maxX, l.box.x + l.box.w);
    maxY = Math.max(maxY, l.box.y + l.box.h);
  }
  const contentW = maxX - minX + PAD * 2;
  const contentH = maxY - minY + PAD * 2;
  // Scale up small writing so it is easy to read; cap the size so the upload stays small.
  const scale = Math.min(2, MAX_SIDE / (contentW + MARGIN), MAX_SIDE / contentH);
  const width = Math.round((contentW + MARGIN) * scale);
  const height = Math.round(contentH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const tx = (x: number) => (x - minX + PAD + MARGIN) * scale;
  const ty = (y: number) => (y - minY + PAD) * scale;

  // Margin rule
  ctx.strokeStyle = "#dddddd";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN * scale - 8, 0);
  ctx.lineTo(MARGIN * scale - 8, height);
  ctx.stroke();

  // Ink
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = Math.max(2.5, 2.5 * scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    if (s.points.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(tx(s.points[0][0]), ty(s.points[0][1]));
    if (s.points.length === 1) ctx.lineTo(tx(s.points[0][0]) + 0.1, ty(s.points[0][1]));
    for (const [x, y] of s.points.slice(1)) ctx.lineTo(tx(x), ty(y));
    ctx.stroke();
  }

  // Line numbers
  ctx.fillStyle = "#888888";
  ctx.font = `${Math.round(26 * Math.max(1, scale * 0.8))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const l of lines) {
    ctx.fillText(String(l.index), (MARGIN / 2) * scale, ty(l.box.y + l.box.h / 2));
  }

  return canvas.toDataURL("image/png");
}
