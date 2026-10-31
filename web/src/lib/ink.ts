// Helpers for the student's ink on the board.

/**
 * Where the student's last drawing starts: the last run of strokes made without a pause of more
 * than 4 seconds. Strokes without a time count as one stroke each.
 */
export function lastBurstStart(strokes: { t?: number }[], gapMs = 4000): number {
  let i = strokes.length - 1;
  if (i < 0) return 0;
  while (i > 0) {
    const cur = strokes[i].t;
    const prev = strokes[i - 1].t;
    if (cur === undefined || prev === undefined || cur - prev > gapMs) break;
    i--;
  }
  return i;
}
