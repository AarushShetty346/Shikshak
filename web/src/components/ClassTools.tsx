// The student's own controls for the question on the board (they work with or without the voice
// tutor): ask for the next hint, see the answer on purpose, skip; and the quick check that starts
// a new topic, with typed answers checked exactly on the server.

import { useEffect, useState } from "react";
import { Lightbulb, Eye, SkipForward, Check, X } from "@phosphor-icons/react";
import type { BoardSnapshot } from "../../../shared/types";
import { apiFetch } from "../lib/api";

/** Seconds a student gets with a new question before the hint and answer buttons appear. */
const THINK_SECONDS = 15;

export function QuestionBar({ serverId, snapshot, onToast }: { serverId: string; snapshot: BoardSnapshot; onToast: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  const q = snapshot.question;
  // Let them think first: help appears after a short while, not the moment the question does.
  const [readyFor, setReadyFor] = useState<string | null>(null);
  useEffect(() => {
    if (!q) return;
    const t = setTimeout(() => setReadyFor(q.id), THINK_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [q?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = q ? snapshot.blocks.find((b) => b.type === "problem" && b.questionId === q.id) : undefined;
  if (!q || (current && current.type === "problem" && current.kind === "diagnostic")) return null;
  const hints = snapshot.blocks.filter((b) => b.type === "hint" && b.questionId === q.id).length;
  const solved = snapshot.correct?.questionId === q.id;
  const shown = snapshot.blocks.some((b) => b.type === "steps" && b.title === "Solution" && snapshot.blocks.indexOf(b) > snapshot.blocks.findIndex((x) => "questionId" in x && x.questionId === q.id));
  if (solved || shown || (readyFor !== q.id && hints === 0)) return null;
  const run = async (path: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ ok: boolean; error?: string; note?: string; done?: boolean }>(`/sessions/${serverId}/${path}`, { method: "POST", body: {} });
      if (!r.ok && r.error) onToast(r.error);
      else if (r.done) onToast("That was the last hint. Try once more, or see the answer.");
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="question-bar" role="group" aria-label="Help with this question">
      <button onClick={() => run("hint")} disabled={busy || hints >= 3} title="One small step of help at a time">
        <Lightbulb /> {hints >= 3 ? "No more hints" : `Hint ${hints + 1} of 3`}
      </button>
      <button onClick={() => run("solution", hints < 3 ? "See the full answer now? It's fine to; this question just won't count as solved on your own." : undefined)} disabled={busy}>
        <Eye /> Show answer
      </button>
    </div>
  );
}

interface DiagResult {
  ok: boolean;
  error?: string;
  done?: boolean;
  question?: number;
  of?: number;
  right?: number;
  start_with?: string;
  unanswered?: number;
}

/** The quick check: typed answers, checked exactly. Unanswered isn't counted as wrong. */
export function QuickCheck({ serverId, snapshot, onToast }: { serverId: string; snapshot: BoardSnapshot; onToast: (t: string) => void }) {
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; tone: "good" | "bad" | "neutral" } | null>(null);
  const [summary, setSummary] = useState<DiagResult | null>(null);
  const [busy, setBusy] = useState(false);
  const q = snapshot.question;
  const block = q ? snapshot.blocks.find((b) => b.type === "problem" && b.questionId === q.id) : undefined;
  const active = Boolean(block && block.type === "problem" && block.kind === "diagnostic");
  // An example in the shape this question expects, so nobody types "29" for an expansion.
  const text = block && block.type === "problem" ? block.problem : "";
  const example = /^\s*expand/i.test(text)
    ? "x^2 + 2x + 1"
    : /\by\b/.test(text) && /\bx\b/.test(text)
      ? "x = 1, y = 2"
      : /^\s*solve/i.test(text)
        ? "x = 2 or x = 5"
        : "29";

  const step = async (action: "next" | "skip_question" | "skip") => {
    setBusy(true);
    try {
      const r = await apiFetch<DiagResult>(`/sessions/${serverId}/diagnostic`, { body: { action } });
      setFeedback(null);
      setAnswer("");
      if (r.done || action === "skip") setSummary(action === "skip" ? { ok: true, done: true } : r);
      else if (!r.ok && r.error) onToast(r.error);
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (summary) {
    return (
      <div className="quick-card" role="status">
        <strong>Quick check done</strong>
        <span>
          {summary.right !== undefined
            ? `${summary.right} of ${summary.of ?? summary.question ?? "?"} right${summary.unanswered ? ` (${summary.unanswered} skipped)` : ""}. We'll start with: ${summary.start_with}.`
            : "Skipped. We'll start from the beginning of the topic."}
        </span>
        <button className="btn-icon" onClick={() => setSummary(null)} aria-label="Close">
          <X />
        </button>
      </div>
    );
  }
  if (!active) return null;

  return (
    <form
      className="quick-card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!answer.trim()) return;
        setBusy(true);
        try {
          const r = await apiFetch<{ ok: boolean; verdict: string; detail?: string; error?: string }>(`/sessions/${serverId}/answer`, { body: { answer } });
          if (!r.ok) {
            onToast(r.error ?? "Couldn't check that.");
            return;
          }
          setFeedback(
            r.verdict === "correct"
              ? { text: "Right.", tone: "good" }
              : r.verdict === "unreadable"
                ? { text: "Couldn't read that as an answer. Try writing it like 29 or x = 3 or 4.", tone: "neutral" }
                : r.verdict === "approximate"
                  ? { text: "Close, but give the exact value.", tone: "neutral" }
                  : /not expanded/i.test(r.detail ?? "")
                    ? { text: "Not quite: that's equal, but not expanded yet.", tone: "bad" }
                    : { text: "Not quite. That's fine, it tells us where to start.", tone: "bad" },
          );
        } catch (err) {
          onToast((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <strong>Quick check</strong>
      <span className="muted-line">Answer on your own (no hints). It just tells your teacher where to start.</span>
      {feedback ? (
        <>
          <span className={`verdict verdict-${feedback.tone}`}>{feedback.text}</span>
          <button type="button" className="btn-primary btn-small" onClick={() => step("next")} disabled={busy}>
            Next
          </button>
        </>
      ) : (
        <div className="quick-row">
          <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={`Your answer, e.g. ${example}`} aria-label="Your answer" maxLength={120} />
          <button className="btn-primary btn-small" disabled={busy || !answer.trim()}>
            <Check /> Check
          </button>
        </div>
      )}
      <div className="quick-links">
        {!feedback && (
          <button type="button" className="link-button" onClick={() => step("skip_question")} disabled={busy}>
            <SkipForward /> I don't know this one
          </button>
        )}
        <button type="button" className="link-button" onClick={() => step("skip")} disabled={busy}>
          Stop the quick check
        </button>
      </div>
    </form>
  );
}
