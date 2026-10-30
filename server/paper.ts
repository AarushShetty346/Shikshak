// Paper mode, for students without a stylus: photos from their notebook go on the board.
// - A photo of their working is pinned on the board as a whole page, read by the checker like a
//   Done (it finds the lines itself), and marked on the photo: the wrong line is circled on the
//   picture, and the tutor can point at its lines ("B5 line 2").
// - A photo of a question is pinned too (scan.ts copies the question out of it).

import { randomUUID } from "node:crypto";
import { config } from "./config";
import { reviewSubmission } from "./look";
import { addDocs, removeDoc, type UploadedFile } from "./material";
import { emit, hashPng, nextLabel, recordBlock, storeCapture, type Capture, type Session } from "./sessions";
import { afterReview } from "./teaching";

/** Photos from paper carry ids starting with this, so they can make room for each other. */
export const PAPER_PREFIX = "paper-";

export function isPhoto(file: UploadedFile): boolean {
  return typeof file?.mediaType === "string" && /^image\/(png|jpeg|webp)$/.test(file.mediaType) && typeof file.data === "string";
}

/** Keeps the photo with the class (for read_material), dropping the oldest paper photo if the class is full. */
export function keepPhoto(s: Session, file: UploadedFile, name: string): { docId: string; error?: string } {
  const id = typeof file.id === "string" && file.id.startsWith(PAPER_PREFIX) ? file.id : `${PAPER_PREFIX}${randomUUID().slice(0, 8)}`;
  if (s.docs.length >= config.limits.maxDocsPerSession()) {
    const oldest = s.docs.find((d) => d.id.startsWith(PAPER_PREFIX));
    if (oldest) removeDoc(s, oldest.id);
  }
  const r = addDocs(s, [{ ...file, id, name }]);
  return r.error ? { docId: id, error: r.error } : { docId: id };
}

/** Pins a photo on the board as a block the tutor can point at. Returns its label (e.g. "B5"). */
export function pinPhoto(s: Session, docId: string, name: string, caption: string): string {
  const label = nextLabel(s);
  recordBlock(s, { label, kind: "photo", summary: caption.slice(0, 120), lines: 1 });
  emit(s, { type: "source", id: randomUUID(), label, docId, docName: name, page: null, caption, photo: true });
  return label;
}

/**
 * The student sends a photo of their working: pinned on the board, then checked like a Done on the
 * current question. The result reaches the board (and the student's feedback card) as it does for
 * board work; a live tutor is told by the browser (keypad 1) and her look_at_board uses this photo.
 */
export function submitPaperWork(s: Session, file: UploadedFile, captureId: unknown): { ok: true; label: string; captureId: string } | { ok: false; status: number; error: string } {
  if (!isPhoto(file)) return { ok: false, status: 400, error: "Take a photo (JPG, PNG or WebP) of your working." };
  const png = `data:${file.mediaType};base64,${file.data}`;
  if (Buffer.byteLength(String(file.data), "base64") > config.limits.maxCaptureBytes()) return { ok: false, status: 413, error: "That photo is too big. Try again a little further away." };
  const name = "Your working";
  const kept = keepPhoto(s, file, name);
  if (kept.error) return { ok: false, status: 400, error: kept.error };
  const label = pinPhoto(s, kept.docId, name, s.problem ? "your working, from paper" : "from your notebook");
  const capture: Capture = {
    id: typeof captureId === "string" && /^[\w-]{6,64}$/.test(captureId) ? captureId : randomUUID(),
    reason: "done",
    requestId: null,
    questionId: s.problem?.id ?? null,
    png,
    lineCount: 0,
    lines: [],
    at: Date.now(),
    hash: hashPng(png),
    photo: { label },
  };
  storeCapture(s, capture);
  reviewSubmission(s, capture, (result) => afterReview(s, capture, result)).catch((err) => console.error("[paper] review crashed", (err as Error).message));
  return { ok: true, label, captureId: capture.id };
}
