// The tutor's board actions: write, draw, highlight, erase, and resuming after a doubt.
// Each reply tells the tutor's LLM what is now on the board (it can't see the screen), so it can
// point back at earlier blocks by label ("B3") like a teacher pointing at the board.

import { randomUUID } from "node:crypto";
import { DIAGRAM_EXAMPLES, parseDiagram } from "../shared/diagram";
import { splitSteps } from "../shared/mathText";
import type { MarkStyle, Place, WriteStyle } from "../shared/types";
import { boardMap, emit, findBlock, nextLabel, recordBlock, type Session } from "./sessions";

type Params = Record<string, unknown>;
type Reply = Record<string, unknown>;

const STYLES: WriteStyle[] = ["heading", "text", "equation", "steps", "your_turn"];
const MARKS: MarkStyle[] = ["underline", "circle", "box", "tick", "arrow"];

const str = (v: unknown) => String(v ?? "").trim();

function place(v: unknown): Place {
  return /right|side|beside/i.test(str(v)) ? "right" : "next";
}

/** "B3", "b3", "B3 line 2", "B3:2" -> { label, line } */
export function parseTarget(raw: unknown): { label: string; line: number | null } | null {
  const m = /^\s*(B\d+)\s*(?:[:#,]?\s*(?:line|step|row)?\s*(\d+))?\s*$/i.exec(str(raw));
  if (!m) return null;
  return { label: m[1].toUpperCase(), line: m[2] ? Number(m[2]) : null };
}

function replaced(s: Session, raw: unknown): { label: string | null; error?: string } {
  const r = str(raw);
  if (!r) return { label: null };
  const block = findBlock(s, r);
  if (!block) return { label: null, error: `There is no ${r.toUpperCase()} on the board. ${boardMap(s)}` };
  block.erased = true; // its space is reused by the new block
  return { label: block.label };
}

export function write(s: Session, p: Params): Reply {
  const style = (STYLES.includes(str(p.kind) as WriteStyle) ? str(p.kind) : "text") as WriteStyle;
  const lines = splitSteps(p.content ?? p.text ?? p.lines);
  if (!lines.length) return { ok: false, error: "Nothing to write. Pass content, with lines separated by ||." };
  const rep = replaced(s, p.replace);
  if (rep.error) return { ok: false, error: rep.error };
  const label = nextLabel(s);
  recordBlock(s, { label, kind: style, summary: lines.join(" / ").slice(0, 120), lines: lines.length });
  emit(s, { type: "write", id: randomUUID(), label, style, lines: lines.slice(0, 8), place: place(p.place), replaces: rep.label });
  if (style === "your_turn") s.problem = s.problem ?? { text: lines.join(" ") };
  return {
    ok: true,
    label,
    note:
      style === "your_turn"
        ? "A space is left on the board for the student. Ask them to write there and press Done."
        : lines.length > 1
          ? "The lines appear one by one while you speak. Explain them in the same order, one sentence per line."
          : "It appears as you start speaking.",
    board: boardMap(s),
  };
}

export function draw(s: Session, p: Params): Reply {
  let diagram;
  try {
    diagram = parseDiagram(str(p.diagram));
  } catch (err) {
    return { ok: false, error: `${(err as Error).message}. Examples: ${DIAGRAM_EXAMPLES.join("  /  ")}` };
  }
  const rep = replaced(s, p.replace);
  if (rep.error) return { ok: false, error: rep.error };
  const label = nextLabel(s);
  const caption = str(p.caption).slice(0, 80);
  recordBlock(s, { label, kind: `diagram ${diagram.type}`, summary: `${caption ? caption + ": " : ""}${str(p.diagram).slice(0, 100)}`, lines: 1 });
  emit(s, { type: "draw", id: randomUUID(), label, diagram, caption, place: place(p.place), replaces: rep.label });
  return { ok: true, label, note: "The diagram draws itself piece by piece while you talk about it, in order.", board: boardMap(s) };
}

export function highlight(s: Session, p: Params): Reply {
  const target = parseTarget(p.target);
  const block = target && findBlock(s, target.label);
  if (!target || !block || block.erased) return { ok: false, error: `Name a block on the board, like "B2" or "B2 line 3". ${boardMap(s)}` };
  const line = target.line && target.line <= block.lines ? target.line : null;
  const style = (MARKS.includes(str(p.style) as MarkStyle) ? str(p.style) : "underline") as MarkStyle;
  emit(s, { type: "highlight", id: randomUUID(), target: block.label, line, style, note: str(p.note).slice(0, 60) });
  return { ok: true, note: `Marked ${block.label}${line ? ` line ${line}` : ""}. Refer to it as you speak ("yeh dekho...").` };
}

export function erase(s: Session, p: Params): Reply {
  const raw = str(p.target);
  if (/^(all|everything|board|sab)$/i.test(raw)) {
    for (const b of s.blocks) b.erased = true;
    emit(s, { type: "page", id: randomUUID() });
    s.recentBoard = [];
    s.problem = null;
    return { ok: true, note: "A fresh page is open. The old one is still above if the student scrolls up." };
  }
  const block = findBlock(s, raw);
  if (!block || block.erased) return { ok: false, error: `Name a block to rub out, like "B2", or "all". ${boardMap(s)}` };
  block.erased = true;
  emit(s, { type: "erase", target: block.label });
  return { ok: true, note: `${block.label} is rubbed out; its space can be reused with replace.`, board: boardMap(s) };
}

/** After answering a doubt: unpause the board and remind the tutor exactly where the lesson was. */
export function continueLesson(s: Session): Reply {
  emit(s, { type: "resume" });
  const at = s.interrupt;
  s.interrupt = null;
  const section = s.study && s.study.section > 0 ? s.study.plan.sections[s.study.section - 1] : null;
  const where = at?.label
    ? `When the student interrupted you were explaining ${at.label}: ${at.summary}.`
    : `The last thing on the board: ${s.blocks.filter((b) => !b.erased).at(-1)?.summary ?? "nothing yet"}.`;
  return {
    ok: true,
    resume: [
      where,
      section ? `Plan section ${s.study!.section} of ${s.study!.plan.sections.length}: "${section.title}".` : "",
      "Continue from exactly there with a short bridge, e.g. 'Achha, wapas aate hain, hum dekh rahe the...'. Don't repeat what was already explained.",
    ]
      .filter(Boolean)
      .join(" "),
    board: boardMap(s),
  };
}

/** Called from the WebSocket when the student presses Ask Doubt or talks over the tutor. */
export function noteInterrupt(s: Session) {
  const last = s.blocks.filter((b) => !b.erased).at(-1);
  // Keep the first interruption point if several come close together: that's where the lesson was.
  if (s.interrupt && Date.now() - s.interrupt.at < 60_000) return;
  s.interrupt = {
    at: Date.now(),
    label: last?.label ?? null,
    summary: last?.summary ?? "",
    section: s.study?.section ?? null,
  };
}
