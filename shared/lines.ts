import type { Box, Stroke, WrittenLine } from "./types";

// Thin strokes (a minus sign, a dot) have almost no height. Treat them as at least this tall.
const MIN_STROKE_HEIGHT = 10;
// Two vertical ranges belong to the same line when they overlap by this share of the shorter one.
const SAME_LINE_OVERLAP = 0.4;

export function strokeBox(stroke: Stroke): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of stroke.points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function band(box: Box): [number, number] {
  const h = Math.max(box.h, MIN_STROKE_HEIGHT);
  const mid = box.y + box.h / 2;
  return [mid - h / 2, mid + h / 2];
}

function overlapShare(a: [number, number], b: [number, number]): number {
  const overlap = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
  if (overlap <= 0) return 0;
  return overlap / Math.min(a[1] - a[0], b[1] - b[0]);
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * Groups pen strokes into handwritten lines, numbered 1..n from top to bottom.
 * Students write one step per line, so a "line" here is one step of their working.
 */
export function groupIntoLines(strokes: Stroke[]): WrittenLine[] {
  const items = strokes
    .filter((s) => s.points.length > 0)
    .map((s) => ({ id: s.id, box: strokeBox(s) }))
    .sort((a, b) => a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2));

  let lines: { box: Box; ids: string[] }[] = [];
  for (const item of items) {
    const target = lines.find((l) => overlapShare(band(l.box), band(item.box)) >= SAME_LINE_OVERLAP);
    if (target) {
      target.box = union(target.box, item.box);
      target.ids.push(item.id);
    } else {
      lines.push({ box: item.box, ids: [item.id] });
    }
  }

  // Growing a line can make it swallow its neighbour; merge until stable.
  let merged = true;
  while (merged) {
    merged = false;
    lines.sort((a, b) => a.box.y - b.box.y);
    for (let i = 0; i < lines.length - 1; i++) {
      if (overlapShare(band(lines[i].box), band(lines[i + 1].box)) >= SAME_LINE_OVERLAP) {
        lines[i] = { box: union(lines[i].box, lines[i + 1].box), ids: [...lines[i].ids, ...lines[i + 1].ids] };
        lines.splice(i + 1, 1);
        merged = true;
        break;
      }
    }
  }

  lines = lines.sort((a, b) => a.box.y - b.box.y);
  return lines.map((l, i) => ({ index: i + 1, box: l.box, strokeIds: l.ids }));
}
