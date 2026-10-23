// The end-of-class report: shown in the app, downloadable as an image, shareable (only when the
// user presses Share). Built from recorded work only (server/report.ts). The parent view changes
// the wording, not the facts, and doesn't pretend to know who the parent is.

import { useEffect, useState } from "react";
import { DownloadSimple, ShareNetwork, X } from "@phosphor-icons/react";
import { sessionReport, type Report } from "../lib/learners";

type View = "student" | "parent";

export function ReportCard({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("student");
  const [showName, setShowName] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    sessionReport(serverId)
      .then(setReport)
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fileName = `shikshak-report-${new Date(report?.date ?? Date.now()).toISOString().slice(0, 10)}.png`;

  const makeImage = async (): Promise<Blob> => {
    const canvas = drawReport(report!, { view, showName });
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the image"))), "image/png"));
  };

  const download = async () => {
    setBusy(true);
    try {
      const blob = await makeImage();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    setBusy(true);
    try {
      const file = new File([await makeImage()], fileName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Shikshak class report" });
      } else {
        await download(); // no native sharing here: save it, then send it yourself
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="report-backdrop" role="dialog" aria-modal="true" aria-label="Class report">
      <div className="report-card">
        <header className="report-head">
          <h2>Today's class</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close report">
            <X />
          </button>
        </header>
        {error && (
          <p className="form-error">
            {error}{" "}
            <button className="link-button" onClick={load}>
              Try again
            </button>
          </p>
        )}
        {!report && !error && (
          <div>
            <div className="skeleton" style={{ height: 24, width: "60%" }} />
            <div className="skeleton" style={{ height: 120, marginTop: 12 }} />
          </div>
        )}
        {report && (
          <>
            <div className="segmented report-view" role="tablist">
              <button role="tab" aria-selected={view === "student"} className={view === "student" ? "on" : ""} onClick={() => setView("student")}>
                For me
              </button>
              <button role="tab" aria-selected={view === "parent"} className={view === "parent" ? "on" : ""} onClick={() => setView("parent")}>
                For a parent
              </button>
            </div>
            <ReportBody report={report} view={view} />
            <label className="check-row">
              <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} /> Put the name on the image
            </label>
            <div className="actions">
              <button className="btn-secondary btn-small" onClick={download} disabled={busy}>
                <DownloadSimple /> Save image
              </button>
              <button className="btn-primary btn-small" onClick={share} disabled={busy}>
                <ShareNetwork /> Share
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function lines(r: Report, view: View): { heading: string; items: string[] }[] {
  const who = view === "parent" ? "Your child" : "You";
  if (r.sparse) return [{ heading: "Summary", items: [r.note] }];
  const out: { heading: string; items: string[] }[] = [];
  if (r.covered.length) out.push({ heading: "Covered", items: r.covered });
  out.push({
    heading: "Problems",
    items: [
      `${r.counts.attempted} tried: ${r.counts.solvedAlone} solved alone, ${r.counts.solvedWithHelp} with help, ${r.counts.notSolved} not yet.`,
      ...(r.counts.hints ? [`${r.counts.hints} hint${r.counts.hints === 1 ? "" : "s"} used.`] : []),
    ],
  });
  if (r.mistakesCorrected.length) out.push({ heading: "Mistakes corrected", items: r.mistakesCorrected.map((m) => `${m.mistake} (in "${m.question}")`) });
  if (r.needsPractice.length) out.push({ heading: `${who} could practise`, items: r.needsPractice });
  out.push({ heading: "Next", items: [r.next] });
  return out;
}

function ReportBody({ report, view }: { report: Report; view: View }) {
  return (
    <div className="report-body">
      <p className="report-meta">
        {report.topic} · {new Date(report.date).toLocaleDateString(undefined, { day: "numeric", month: "long" })}
        {report.minutes ? ` · ${report.minutes} min` : ""}
      </p>
      {lines(report, view).map((sec) => (
        <section key={sec.heading}>
          <h3>{sec.heading}</h3>
          <ul>
            {sec.items.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>
      ))}
      <p className="report-note">{report.note}</p>
    </div>
  );
}

/** Draws the report as a 1080 × 1350 image (fits phone screens and chat apps). */
export function drawReport(r: Report, opts: { view: View; showName: boolean }): HTMLCanvasElement {
  const W = 1080;
  const H = 1350;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#23392f";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#f6d77a";
  ctx.font = "700 64px Kalam, cursive";
  ctx.fillText("Shikshak", 72, 120);
  ctx.fillStyle = "#f4f1e8";
  ctx.font = "600 44px Mukta, sans-serif";
  const title = `${opts.showName && r.learnerName ? `${r.learnerName}: ` : ""}${r.topic}`;
  ctx.fillText(title.slice(0, 40), 72, 200);
  ctx.font = "400 30px Mukta, sans-serif";
  ctx.fillStyle = "rgba(244,241,232,0.7)";
  ctx.fillText(new Date(r.date).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }), 72, 250);

  let y = 330;
  const wrap = (text: string, x: number, maxW: number, lh: number) => {
    const words = text.split(" ");
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, y);
        y += lh;
        line = w;
      } else line = test;
    }
    if (line) {
      ctx.fillText(line, x, y);
      y += lh;
    }
  };
  for (const sec of lines(r, opts.view)) {
    if (y > H - 200) break;
    ctx.fillStyle = "#f6d77a";
    ctx.font = "700 34px Mukta, sans-serif";
    ctx.fillText(sec.heading, 72, y);
    y += 50;
    ctx.fillStyle = "#f4f1e8";
    ctx.font = "400 32px Mukta, sans-serif";
    for (const item of sec.items) {
      if (y > H - 200) break;
      wrap(`• ${item}`, 92, W - 180, 44);
    }
    y += 24;
  }
  ctx.fillStyle = "rgba(244,241,232,0.6)";
  ctx.font = "400 26px Mukta, sans-serif";
  y = H - 110;
  wrap(r.note, 72, W - 144, 36);
  return c;
}
