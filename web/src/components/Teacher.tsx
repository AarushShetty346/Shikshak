// Teacher view: only learners whose device explicitly shared a one-time code with this device.
// ShareWithTeacher is the learner side (make a code, see and revoke who has access).

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, Trash } from "@phosphor-icons/react";
import { apiFetch } from "../lib/api";
import { ModeToggle, type Mode } from "./ModeToggle";
import { STATUS_LABEL, type Memory, type Report } from "../lib/learners";

interface TeacherLearner {
  learner: { id: string; name: string; grade: string };
  sharedAt: number;
  evidence: number;
  lastAt: number | null;
  topics: string[];
  skills: { name: string; status: keyof typeof STATUS_LABEL }[];
  recurring: { name: string; count: number; confidence: string }[];
}

const when = (t: number | null) => (t ? new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "never");

export function ShareWithTeacher({ learnerId, learnerName }: { learnerId: string; learnerName: string }) {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [grants, setGrants] = useState<{ id: string; teacher: string; createdAt: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch<{ grants: typeof grants }>(`/learners/${learnerId}/shares`)
      .then((r) => setGrants(r.grants))
      .catch((e: Error) => setError(e.message));
  }, [learnerId]);
  useEffect(load, [load]);
  return (
    <div className="share-box">
      <p className="muted-line">
        A teacher can see {learnerName}'s progress, mistakes and class reports only after you give them a one-time code. Codes work once and expire in 24 hours. You can remove access any time.
      </p>
      {code ? (
        <div className="share-code">
          <span className="code">{code.code}</span>
          <button className="btn-icon" aria-label="Copy code" onClick={() => void navigator.clipboard?.writeText(code.code)}>
            <Copy />
          </button>
          <span className="muted-line">
            Ask the teacher to open <strong>{`${location.origin}/#/teacher`}</strong> and enter it.
          </span>
        </div>
      ) : (
        <button
          className="btn-primary btn-small"
          onClick={() =>
            apiFetch<{ code: string; expiresAt: number }>(`/learners/${learnerId}/shares`, { method: "POST", body: {} })
              .then(setCode)
              .catch((e: Error) => setError(e.message))
          }
        >
          Make a share code
        </button>
      )}
      {grants.length > 0 && (
        <ul className="grant-list">
          {grants.map((g) => (
            <li key={g.id}>
              <span>
                {g.teacher}, since {when(g.createdAt)}
              </span>
              <button
                className="link-button danger"
                onClick={async () => {
                  if (!window.confirm(`Stop sharing ${learnerName}'s progress with ${g.teacher}?`)) return;
                  await apiFetch(`/learners/${learnerId}/shares/${g.id}`, { method: "DELETE" }).catch((e: Error) => setError(e.message));
                  load();
                }}
              >
                <Trash /> Remove access
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

export function TeacherView({ onSwitchMode }: { onBack: () => void; onSwitchMode: (to: Mode) => void }) {
  const [list, setList] = useState<TeacherLearner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [filter, setFilter] = useState<"all" | "needs-help" | "recent">("all");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<{ learners: TeacherLearner[] }>("/teacher/learners")
      .then((r) => {
        setList(r.learners);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const l = list ?? [];
    if (filter === "needs-help") return l.filter((x) => x.recurring.length > 0 || x.skills.some((s) => s.status === "learning"));
    if (filter === "recent") return l.filter((x) => x.lastAt && Date.now() - x.lastAt < 7 * 86_400_000);
    return l;
  }, [list, filter]);

  if (open) return <TeacherLearnerDetail learnerId={open} onBack={() => setOpen(null)} />;

  return (
    <main className="home home-board teacher-board">
      <header className="home-head">
        <div className="home-head-left">
          <span className="wordmark">
            <span className="wordmark-tile" aria-hidden="true">
              श
            </span>
            <span className="chalk">Shikshak</span>
          </span>
          <ModeToggle mode="teacher" onSwitch={onSwitchMode} />
        </div>
      </header>
      <div className="home-title-row">
        <h1 className="home-title chalk">Teacher view</h1>
      </div>
      <form
        className="panel claim"
        onSubmit={async (e) => {
          e.preventDefault();
          setClaiming(true);
          setError(null);
          try {
            await apiFetch("/teacher/claim", { body: { code, label: label || "Teacher" } });
            setCode("");
            load();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setClaiming(false);
          }
        }}
      >
        <label className="field">
          <span>Share code from a student's device</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCDE-FGHJK" maxLength={14} autoComplete="off" />
        </label>
        <label className="field">
          <span>Your name (shown to the student's family)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ms. Iyer" maxLength={40} />
        </label>
        <button className="btn-primary btn-small" disabled={claiming || code.replace(/[^A-Za-z0-9]/g, "").length !== 10}>
          {claiming ? "Adding…" : "Add student"}
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}

      <div className="filter-row" role="tablist" aria-label="Filter students">
        {(["all", "needs-help", "recent"] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className="learner-chip" onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "needs-help" ? "Needs help" : "Active this week"}
          </button>
        ))}
      </div>

      {list === null ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : shown.length === 0 ? (
        <section className="home-empty">
          <div>
            <h2>{list.length ? "No students match this filter" : "No students shared with you yet"}</h2>
            <p>{list.length ? "Try another filter." : "A student (or their family) makes a share code on their Progress page. Enter it above. You'll only ever see students shared with you."}</p>
          </div>
        </section>
      ) : (
        <ul className="session-list">
          {shown.map((x) => (
            <li key={x.learner.id} className="session-row">
              <button className="session-open" onClick={() => setOpen(x.learner.id)}>
                <span className="session-tile" aria-hidden="true">
                  {x.learner.name.charAt(0).toUpperCase()}
                </span>
                <span className="session-text">
                  <span className="session-name">
                    {x.learner.name} · class {x.learner.grade}
                  </span>
                  <span className="session-meta">
                    {x.evidence} answers · {x.topics.join(", ") || "no topics yet"}
                    {x.recurring.length > 0 && <span className="preview-tag">{x.recurring.map((r) => r.name).join("; ")}</span>}
                  </span>
                </span>
                <span className="session-time">Last active {when(x.lastAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function TeacherLearnerDetail({ learnerId, onBack }: { learnerId: string; onBack: () => void }) {
  const [data, setData] = useState<{ learner: { name: string; grade: string }; memory: Memory; reports: Report[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<typeof data>(`/teacher/learners/${learnerId}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [learnerId]);
  return (
    <main className="home home-board progress">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft /> Students
      </button>
      {error && <p className="form-error">{error}</p>}
      {!data && !error && <div className="skeleton" style={{ height: 160 }} />}
      {data && (
        <>
          <h1 className="home-title">
            {data.learner.name} · class {data.learner.grade}
          </h1>
          <section className="panel">
            <h2>Skills</h2>
            <ul className="skill-list">
              {data.memory.progress.map((p) => (
                <li key={p.skill}>
                  <div className="skill-head">
                    <span className="skill-name">{p.name}</span>
                    <span className="status-chip" data-status={p.status}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </div>
                  <p className="muted-line">{p.because}</p>
                </li>
              ))}
              {!data.memory.progress.length && <li className="muted-line">No recorded answers yet.</li>}
            </ul>
          </section>
          <section className="panel">
            <h2>Recurring mistakes</h2>
            {data.memory.mistakes.length ? (
              <ul className="mistake-list">
                {data.memory.mistakes.map((m) => (
                  <li key={m.id}>
                    <strong>{m.name}</strong> ({m.count}×{m.resolved ? ", fixed since" : ""}) <span className="muted-line">e.g. "{m.examples[0]}"</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-line">None recorded.</p>
            )}
          </section>
          <section className="panel">
            <h2>Class reports</h2>
            {data.reports.length ? (
              <ul className="report-list">
                {data.reports.map((r) => (
                  <li key={r.version}>
                    <strong>{r.topic}</strong> · {when(r.date)} · {r.sparse ? "no checked answers" : `${r.counts.solvedAlone} solved alone, ${r.counts.solvedWithHelp} with help, ${r.counts.notSolved} not yet`}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-line">No classes yet.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
