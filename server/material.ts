// The student's uploaded material (a textbook chapter PDF, photos of notes or a worksheet), kept per
// session. The tutor can ask questions of it (answers come from the actual pages, with page
// numbers) and put a real page on the board with its source. Nothing is invented: if the material
// doesn't cover something, the tutor is told so.

import { randomUUID } from "node:crypto";
import { languageName } from "./claude";
import { askJson, hasModel } from "./llm";
import { boardMap, emit, nextLabel, recordBlock, type Session, type SessionDoc } from "./sessions";

const MAX_DOC_BYTES = 15 * 1024 * 1024;
const MAX_SESSION_DOCS = 6;

export interface UploadedFile {
  /** The browser's id for this file, so its board pages keep working after a server restart. */
  id?: string;
  name?: string;
  mediaType?: string;
  data?: string;
  pages?: number | null;
}

/** Adds uploaded files to this session. Returns what's stored, or a clear error. */
export function addDocs(s: Session, files: UploadedFile[]): { docs: Omit<SessionDoc, "data">[]; error?: string } {
  for (const f of files) {
    const mediaType = String(f.mediaType ?? "");
    if (mediaType !== "application/pdf" && !/^image\/(png|jpeg|webp)$/.test(mediaType)) return { docs: [], error: `${f.name ?? "File"}: only PDF, JPG, PNG or WebP` };
    const bytes = Math.floor((String(f.data ?? "").length * 3) / 4);
    if (bytes > MAX_DOC_BYTES) return { docs: [], error: `${f.name ?? "File"} is over 15 MB` };
    if (!f.data) return { docs: [], error: `${f.name ?? "File"} is empty` };
  }
  for (const f of files) {
    const id = /^[a-z0-9-]{4,40}$/i.test(String(f.id ?? "")) ? String(f.id) : randomUUID().slice(0, 8);
    if (s.docs.some((d) => d.id === id)) continue; // already here (re-sent after a restart)
    s.docs.push({
      id,
      name: String(f.name ?? "material").slice(0, 80),
      mediaType: String(f.mediaType),
      data: String(f.data),
      pages: f.pages ?? (String(f.mediaType).startsWith("image/") ? 1 : null),
      uploadedAt: Date.now(),
    });
  }
  if (s.docs.length > MAX_SESSION_DOCS) s.docs.splice(0, s.docs.length - MAX_SESSION_DOCS);
  return { docs: s.docs.map(({ data: _data, ...meta }) => meta) };
}

export function docList(s: Session): string {
  if (!s.docs.length) return "No material uploaded in this session.";
  return s.docs.map((d, i) => `${i + 1}. ${d.name} (${d.mediaType === "application/pdf" ? `PDF${d.pages ? `, ${d.pages} pages` : ""}` : "photo"})`).join("; ");
}

interface MaterialAnswer {
  found: boolean;
  answer: string;
  pages: number[];
  doc: number;
  figure_page: number | null;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "answer", "pages", "doc", "figure_page"],
  properties: {
    found: { type: "boolean" },
    answer: { type: "string" },
    pages: { type: "array", items: { type: "integer" } },
    doc: { type: "integer" },
    figure_page: { anyOf: [{ type: "integer" }, { type: "null" }] },
  },
};

const SYSTEM = `You answer a maths/science tutor's question using ONLY the attached student material (textbook pages, notes or worksheets). Files are numbered from 1 in the order given; pages within a PDF are numbered as printed in the PDF viewer (first page = 1).
- found: false if the material doesn't contain the answer. Never invent content, page numbers or figures.
- answer: under 90 words, in English, factual, keeping the material's own method and notation (plain-text maths, no LaTeX). If quoting a definition, quote it exactly.
- pages: the page numbers you used. doc: the file number (1-based).
- figure_page: if a figure/diagram is relevant (or was asked for), the page it is on; else null.`;

export async function readMaterial(s: Session, question: string) {
  if (!s.docs.length)
    return { ok: false, error: "The student hasn't uploaded any material in this session. If you need it, ask them to tap the Upload button on the board." };
  if (!hasModel()) return { ok: false, error: "The material reader isn't set up on the server." };
  try {
    const r = await askJson<MaterialAnswer>({
      system: SYSTEM,
      effort: "low",
      schema: SCHEMA,
      attachments: s.docs.map((d) => ({ mediaType: d.mediaType, data: d.data })),
      text: `Material: ${docList(s)}\nTutor's question: ${question || "What does this material cover? List its main topics and any figures with their pages."}\nThe tutor will explain in ${languageName(s.language)}.`,
    });
    const doc = s.docs[Math.max(0, Math.min(s.docs.length - 1, (r.doc || 1) - 1))];
    if (!r.found) return { ok: true, found: false, note: "This isn't in the uploaded material. Say so honestly; you may then explain it yourself, saying it's not from their book." };
    return {
      ok: true,
      found: true,
      answer: r.answer,
      source: `${doc.name}, page ${r.pages.join(", ") || "?"}`,
      figure_page: r.figure_page,
      note: r.figure_page
        ? `There's a relevant figure on page ${r.figure_page}. Use show_page to put it on the board before explaining it.`
        : "Mention the page when you explain ('aapki book ke page ... par').",
    };
  } catch (err) {
    console.error("[material] read failed", err);
    return { ok: false, error: "Couldn't read the material just now. Teach from your own knowledge and say it's not from their book." };
  }
}

/** Puts a real page of the uploaded material on the board, labelled with its source. */
export function showPage(s: Session, p: Record<string, unknown>) {
  if (!s.docs.length) return { ok: false, error: "No material uploaded in this session. Ask them to tap Upload." };
  const which = String(p.document ?? "").trim().toLowerCase();
  const byIndex = /^\d+$/.test(which) ? s.docs[Number(which) - 1] : undefined;
  const doc = byIndex ?? s.docs.find((d) => which && d.name.toLowerCase().includes(which)) ?? s.docs[s.docs.length - 1];
  const page = Math.max(1, parseInt(String(p.page ?? "1"), 10) || 1);
  if (doc.pages && page > doc.pages) return { ok: false, error: `${doc.name} has ${doc.pages} pages.` };
  const label = nextLabel(s);
  const caption = String(p.caption ?? "").slice(0, 80);
  recordBlock(s, { label, kind: "book page", summary: `${doc.name} page ${page}${caption ? `: ${caption}` : ""}`, lines: 1 });
  emit(s, { type: "source", id: randomUUID(), label, docId: doc.id, docName: doc.name, page: doc.mediaType === "application/pdf" ? page : null, caption });
  return { ok: true, label, note: `Page ${page} of ${doc.name} is on the board as ${label}. Use highlight on ${label} to point at it while you explain.`, board: boardMap(s) };
}
