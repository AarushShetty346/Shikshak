// Runtime validation for everything a browser sends over the WebSocket. Anything that doesn't
// match exactly (unknown kinds, wrong types, oversized arrays or strings) is rejected before the
// server looks at it.

import { z } from "zod";
import type { BoardSnapshot, ClientMessage } from "./types";

const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9_:.-]+$/);
const label = z.string().regex(/^B\d{1,4}$/);
const text = (max: number) => z.string().max(max);
const finite = z.number().finite();

export const BoxSchema = z.object({ x: finite, y: finite, w: finite.min(0), h: finite.min(0) }).strict();

const MAX_LINES = 60;

const CaptureSchema = z
  .object({
    kind: z.literal("capture"),
    id,
    reason: z.enum(["done", "request"]),
    requestId: id.nullish(),
    questionId: id.nullable(),
    png: z
      .string()
      .max(3_000_000)
      .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/)
      .nullable(),
    lineCount: z.number().int().min(0).max(MAX_LINES),
    lines: z.array(BoxSchema).max(MAX_LINES),
    /** The student wrote over a photo on the board: the image is that photo with their ink on top. */
    photoLabel: z.string().regex(/^[A-Z]\d{1,4}$/).nullish(),
  })
  .strict()
  .refine((c) => c.lines.length === c.lineCount, { message: "lines must match lineCount" })
  .refine((c) => (c.lineCount === 0 && !c.photoLabel) === (c.png === null), { message: "png must be present exactly when there is work" })
  .refine((c) => !c.photoLabel || c.lineCount === 0, { message: "a photo capture has no board lines" });

const InterruptSchema = z.object({ kind: z.literal("interrupt"), reason: z.enum(["doubt", "speech"]) }).strict();
const SyncSchema = z.object({ kind: z.literal("sync") }).strict();

// ---------- board snapshot (hydration after a server restart) ----------

const DiagramSchema = z.union([
  z.object({ type: z.literal("ap"), terms: z.array(text(40)).max(7), d: text(40).nullable() }).strict(),
  z
    .object({
      type: z.literal("numberline"),
      from: finite,
      to: finite,
      points: z.array(z.object({ x: finite, label: text(20) }).strict()).max(8),
    })
    .strict(),
  z
    .object({
      type: z.literal("graph"),
      exprs: z.array(text(80)).max(3),
      points: z.array(z.object({ x: finite, y: finite, label: text(20) }).strict()).max(6),
      xmin: finite,
      xmax: finite,
      params: z
        .array(z.object({ name: z.string().regex(/^[a-wyz]$/), value: finite, min: finite, max: finite }).strict())
        .max(4)
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("triangle"),
      labels: z.tuple([text(4), text(4), text(4)]),
      sides: z.object({ AB: text(20).optional(), BC: text(20).optional(), CA: text(20).optional() }).strict(),
      angle: z.object({ at: text(4), label: text(20) }).strict().nullable(),
      right: z.boolean(),
      rightAt: text(4).optional(),
    })
    .strict(),
  z.object({ type: z.literal("table"), header: z.array(text(40)).max(8), rows: z.array(z.array(text(40)).max(8)).max(8) }).strict(),
]);

const lines = z.array(text(300)).max(12);
const erased = { erased: z.boolean().optional() };

const BlockSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("write"),
      id,
      label,
      style: z.enum(["heading", "text", "equation", "steps", "your_turn"]),
      lines,
      place: z.enum(["next", "right"]),
      replaces: label.nullable(),
      questionId: id.nullish(),
      ...erased,
    })
    .strict(),
  z.object({ type: z.literal("draw"), id, label, diagram: DiagramSchema, caption: text(120), place: z.enum(["next", "right"]), replaces: label.nullable(), ...erased }).strict(),
  z
    .object({
      type: z.literal("steps"),
      id,
      label: label.optional(),
      title: text(200),
      steps: lines,
      section: z.object({ n: z.number().int().min(1).max(50), of: z.number().int().min(1).max(50) }).strict().optional(),
      checked: z.boolean().optional(),
      ...erased,
    })
    .strict(),
  z
    .object({
      type: z.literal("problem"),
      id,
      label: label.optional(),
      problem: text(600),
      questionId: id.nullish(),
      kind: z.enum(["practice", "diagnostic", "transfer"]).optional(),
      ...erased,
    })
    .strict(),
  z.object({ type: z.literal("plan"), id, label: label.optional(), title: text(200), items: z.array(text(200)).max(12), ...erased }).strict(),
  z.object({ type: z.literal("page"), id, ...erased }).strict(),
  z
    .object({ type: z.literal("source"), id, label, docId: id, docName: text(120), page: z.number().int().min(1).max(5000).nullable(), caption: text(120), photo: z.boolean().optional(), ...erased })
    .strict(),
  z
    .object({
      type: z.literal("fix"),
      id,
      label,
      photoLabel: label,
      docId: id,
      questions: z
        .array(
          z
            .object({
              question: text(600),
              status: z.enum(["correct", "mistake", "incomplete", "unreadable"]),
              marks: z.array(z.object({ top: z.number().min(0).max(1), bottom: z.number().min(0).max(1), fix: text(200) }).strict()).max(12),
              solution: z.array(text(200)).max(30),
            })
            .strict(),
        )
        .max(6),
      simulated: z.boolean().optional(),
      ...erased,
    })
    .strict(),
  z
    .object({
      type: z.literal("hint"),
      id,
      label,
      questionId: id,
      level: z.enum(["nudge", "hint", "step"]),
      rung: z.number().int().min(1).max(10),
      of: z.number().int().min(1).max(10),
      text: text(400),
      ...erased,
    })
    .strict(),
]);

const fraction = z.number().min(0).max(1);
const BandSchema = z.object({ label, top: fraction, bottom: fraction }).strict();

const SnapshotSchema = z
  .object({
    v: z.literal(1),
    seq: z.number().int().min(0).max(10_000_000),
    blocks: z.array(BlockSchema).max(400),
    highlights: z
      .array(
        z
          .object({
            id,
            target: label,
            line: z.number().int().min(1).max(50).nullable(),
            style: z.enum(["underline", "circle", "box", "tick", "arrow"]),
            note: text(80),
            band: z.object({ top: fraction, bottom: fraction }).strict().nullish(),
          })
          .strict(),
      )
      .max(6),
    section: z.number().int().min(1).max(50).nullable(),
    question: z.object({ id, text: text(600) }).strict().nullable(),
    mark: z.object({ captureId: id, questionId: id.nullable(), line: z.number().int().min(1).max(MAX_LINES), note: text(300), box: BoxSchema.nullable(), on: BandSchema.nullish() }).strict().nullable(),
    correct: z.object({ captureId: id.nullable(), questionId: id.nullable(), note: text(300), box: BoxSchema.nullable(), on: BandSchema.nullish() }).strict().nullable(),
  })
  .strict();

const HydrateSchema = z.object({ kind: z.literal("hydrate"), snapshot: SnapshotSchema }).strict();

export function parseClientMessage(raw: unknown): { ok: true; msg: ClientMessage } | { ok: false; error: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "message must be an object" };
  const kind = (raw as { kind?: unknown }).kind;
  const schema = kind === "capture" ? CaptureSchema : kind === "interrupt" ? InterruptSchema : kind === "hydrate" ? HydrateSchema : kind === "sync" ? SyncSchema : null;
  if (!schema) return { ok: false, error: "unknown message kind" };
  const r = schema.safeParse(raw);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "invalid message" };
  return { ok: true, msg: r.data as ClientMessage };
}

export function parseSnapshot(raw: unknown): BoardSnapshot | null {
  const r = SnapshotSchema.safeParse(raw);
  return r.success ? (r.data as BoardSnapshot) : null;
}
