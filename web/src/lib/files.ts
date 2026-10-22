// Reading uploaded files: photos are shrunk to keep uploads small, PDFs are counted and can render
// a single page to an image for the board (pdf.js, loaded only when needed).

export interface PreparedFile {
  name: string;
  mediaType: string;
  data: string; // base64
  pages: number | null;
}

export async function prepareFile(file: File): Promise<PreparedFile> {
  if (file.type === "application/pdf") {
    const data = await toBase64(file);
    return { name: file.name, mediaType: file.type, data, pages: await pdfPageCount(data).catch(() => null) };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { name: file.name, mediaType: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "", pages: 1 };
  } catch {
    return { name: file.name, mediaType: file.type, data: await toBase64(file), pages: 1 };
  }
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function bytesOf(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pdfjs() {
  const lib = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  return lib;
}

export async function pdfPageCount(base64: string): Promise<number> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytesOf(base64) }).promise;
  const n = doc.numPages;
  await doc.destroy();
  return n;
}

/** Renders one PDF page to a JPEG data URL, about `width` pixels wide. */
export async function renderPdfPage(base64: string, page: number, width = 1100): Promise<string> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytesOf(base64) }).promise;
  try {
    const p = await doc.getPage(Math.min(page, doc.numPages));
    const base = p.getViewport({ scale: 1 });
    const viewport = p.getViewport({ scale: width / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    // "print" renders in one go; the default "display" waits on animation frames, which never come
    // while the tab is in the background, so the page would stay on "Opening the page…".
    await p.render({ canvasContext: canvas.getContext("2d")!, viewport, intent: "print" }).promise;
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    await doc.destroy();
  }
}
