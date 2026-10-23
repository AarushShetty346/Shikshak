// Running a small pilot (facilitator's device): pseudonymous participants with recorded consent,
// before/after quizzes (one question at a time, timed, no right/wrong shown), technical-problem
// notes, feedback, and an anonymised CSV export. See docs/PILOT.md for the consent templates.

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, DownloadSimple, Trash, Warning } from "@phosphor-icons/react";
import { apiFetch, deviceToken } from "../lib/api";

interface PilotState {
  summary: { participants: number; forms: { form: string; completed: number; meanScore: number | null; outOf: number }[]; caution: string };
  participants: { id: string; code: string; consent: { recordingAllowed: boolean }; forms: { form: string; finishedAt: number | null }[]; issues: number; feedback: boolean }[];
}

type Form = { form: string; title: string; items: { id: string; prompt: string }[] };

export function Pilot({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<PilotState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<{ pid: string; code: string; form: Form } | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<{ pid: string; code: string } | null>(null);

  const load = useCallback(() => {
    apiFetch<PilotState>("/pilot")
      .then((s) => {
        setState(s);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (running)
    return (
      <QuizRunner
        {...running}
        onDone={() => {
          setRunning(null);
          load();
        }}
      />
    );
  if (feedbackFor)
    return (
      <FeedbackForm
        {...feedbackFor}
        onDone={() => {
          setFeedbackFor(null);
          load();
        }}
      />
    );

  return (
    <main className="home">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft /> Classes
      </button>
      <h1 className="home-title">Pilot</h1>
      <p className="muted-line">For the person running a small trial. Use codes like P01, never names. Keep signed consent forms on paper (templates in docs/PILOT.md).</p>
      {error && <p className="form-error">{error}</p>}
      {state && (
        <>
          <section className="panel">
            <h2>Summary</h2>
            <ul className="report-list">
              {state.summary.forms.map((f) => (
                <li key={f.form}>
                  Form {f.form}: {f.completed} completed{f.meanScore !== null ? `, average ${f.meanScore} of ${f.outOf}` : ""}
                </li>
              ))}
            </ul>
            <p className="rules">
              <Warning /> {state.summary.caution}
            </p>
            <button
              className="btn-secondary btn-small"
              onClick={async () => {
                const r = await fetch("/api/pilot/export.csv", { headers: { Authorization: `Bearer ${await deviceToken()}` } });
                const url = URL.createObjectURL(await r.blob());
                const a = document.createElement("a");
                a.href = url;
                a.download = "shikshak-pilot.csv";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 2000);
              }}
            >
              <DownloadSimple /> Export (anonymised CSV)
            </button>
          </section>

          <AddParticipant onAdded={load} />

          <section className="panel">
            <h2>Participants</h2>
            {state.participants.length === 0 ? (
              <p className="muted-line">No participants yet.</p>
            ) : (
              <ul className="skill-list">
                {state.participants.map((p) => (
                  <li key={p.id}>
                    <div className="skill-head">
                      <span className="skill-name">{p.code}</span>
                      <span className="muted-line">
                        {p.forms.filter((f) => f.finishedAt).map((f) => f.form).join(", ") || "no forms done"} · {p.issues} issue note{p.issues === 1 ? "" : "s"}
                        {p.feedback ? " · feedback given" : ""}
                      </span>
                    </div>
                    <div className="actions actions-left">
                      {(["A", "B", "C"] as const).map((f) => (
                        <button
                          key={f}
                          className="btn-secondary btn-small"
                          disabled={p.forms.some((x) => x.form === f && x.finishedAt)}
                          onClick={async () => {
                            const form = await apiFetch<Form>(`/pilot/participants/${p.id}/forms/${f}`, { method: "POST", body: {} });
                            setRunning({ pid: p.id, code: p.code, form });
                          }}
                        >
                          {f === "A" ? "Before quiz" : f === "B" ? "After quiz" : "Week-later check"}
                        </button>
                      ))}
                      <button className="btn-secondary btn-small" onClick={() => setFeedbackFor({ pid: p.id, code: p.code })}>
                        Feedback
                      </button>
                      <button
                        className="btn-secondary btn-small"
                        onClick={async () => {
                          const note = window.prompt(`Technical problem for ${p.code} (what happened?)`)?.trim();
                          if (note) await apiFetch(`/pilot/participants/${p.id}/issues`, { body: { note } });
                          load();
                        }}
                      >
                        Note a problem
                      </button>
                      <button
                        className="btn-secondary btn-small danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete ${p.code} and all their pilot records?`)) return;
                          await apiFetch(`/pilot/participants/${p.id}`, { method: "DELETE" });
                          load();
                        }}
                      >
                        <Trash />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function AddParticipant({ onAdded }: { onAdded: () => void }) {
  const [code, setCode] = useState("");
  const [guardian, setGuardian] = useState(false);
  const [assent, setAssent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await apiFetch("/pilot/participants", { body: { code, guardianConsent: guardian, studentAssent: assent, recordingAllowed: recording } });
          setCode("");
          setGuardian(false);
          setAssent(false);
          setRecording(false);
          onAdded();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <h2>Add a participant</h2>
      <label className="field">
        <span>Code (not a name)</span>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="P01" maxLength={8} />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={guardian} onChange={(e) => setGuardian(e.target.checked)} /> A parent or guardian signed the consent form
      </label>
      <label className="check-row">
        <input type="checkbox" checked={assent} onChange={(e) => setAssent(e.target.checked)} /> The student agreed to take part
      </label>
      <label className="check-row">
        <input type="checkbox" checked={recording} onChange={(e) => setRecording(e.target.checked)} /> Screen or audio recording allowed (optional)
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn-primary btn-small" disabled={!code.trim() || !guardian || !assent}>
        Add
      </button>
    </form>
  );
}

function QuizRunner({ pid, code, form, onDone }: { pid: string; code: string; form: Form; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState("");
  const started = useRef(Date.now());
  const [error, setError] = useState<string | null>(null);
  const item = form.items[i];
  const submit = async (value: string) => {
    try {
      await apiFetch(`/pilot/participants/${pid}/forms/${form.form}/answers`, { body: { item: item.id, answer: value, ms: Date.now() - started.current } });
      setAnswer("");
      started.current = Date.now();
      if (i + 1 >= form.items.length) onDone();
      else setI(i + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <main className="home quiz">
      <p className="muted-line">
        {code} · {form.title} · question {i + 1} of {form.items.length}
      </p>
      <h1 className="quiz-q">{item.prompt}</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(answer);
        }}
      >
        <label className="field">
          <span>Your answer</span>
          <input value={answer} onChange={(e) => setAnswer(e.target.value)} autoFocus maxLength={120} />
        </label>
        <div className="actions actions-left">
          <button className="btn-primary" disabled={!answer.trim()}>
            Next
          </button>
          <button type="button" className="btn-secondary" onClick={() => void submit("")}>
            I don't know
          </button>
        </div>
      </form>
      {error && <p className="form-error">{error}</p>}
      <p className="muted-line">No marks are shown during the quiz. That's on purpose.</p>
    </main>
  );
}

function FeedbackForm({ pid, code, onDone }: { pid: string; code: string; onDone: () => void }) {
  const [v, setV] = useState({ easy: 3, helpful: 3, wouldUse: 3, comment: "" });
  const scale = (key: "easy" | "helpful" | "wouldUse", label: string) => (
    <label className="field">
      <span>
        {label}: {v[key]} of 5
      </span>
      <input type="range" min={1} max={5} value={v[key]} onChange={(e) => setV({ ...v, [key]: Number(e.target.value) })} />
    </label>
  );
  return (
    <main className="home">
      <h1 className="home-title">Feedback from {code}</h1>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          await apiFetch(`/pilot/participants/${pid}/feedback`, { body: v });
          onDone();
        }}
      >
        {scale("easy", "It was easy to use")}
        {scale("helpful", "It helped me understand")}
        {scale("wouldUse", "I would use it again")}
        <label className="field">
          <span>Anything else? (no names, please)</span>
          <textarea value={v.comment} onChange={(e) => setV({ ...v, comment: e.target.value })} maxLength={600} rows={3} />
        </label>
        <div className="actions actions-left">
          <button className="btn-primary">Save</button>
          <button type="button" className="btn-secondary" onClick={onDone}>
            Cancel
          </button>
        </div>
      </form>
    </main>
  );
}
