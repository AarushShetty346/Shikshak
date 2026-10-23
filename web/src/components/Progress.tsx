// A learner's progress, with the evidence behind every line: skills (with the rule that decided
// their status), mistakes we've seen (and a way to say "that's not what happened"), what to
// practise next. Everything here comes from recorded attempts; nothing is guessed.

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle, Trash, ArrowCounterClockwise, ShareNetwork } from "@phosphor-icons/react";
import { deleteLearner, learnerMemory, rejectMisconception, resetMemory, STATUS_LABEL, type Learner, type Memory } from "../lib/learners";
import { selectLearner } from "../lib/learners";
import { ShareWithTeacher } from "./Teacher";
import { PhoneRevision } from "./PhoneRevision";

const when = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function Progress({ learnerId, onBack }: { learnerId: string; onBack: () => void }) {
  const [data, setData] = useState<{ learner: Learner; memory: Memory } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(() => {
    learnerMemory(learnerId)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [learnerId]);
  useEffect(load, [load]);

  if (error) {
    return (
      <main className="home">
        <button className="back-link" onClick={onBack}>
          <ArrowLeft /> Back
        </button>
        <p className="form-error">{error}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="home">
        <div className="skeleton" style={{ height: 40, width: 220 }} />
        <div className="skeleton" style={{ height: 160, marginTop: 20 }} />
      </main>
    );
  }
  const { learner, memory: m } = data;

  return (
    <main className="home progress">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft /> Classes
      </button>
      <h1 className="home-title">{learner.name}'s progress</h1>
      <p className="muted-line">
        Class {learner.grade} · {m.evidenceCount ? `Based on ${m.evidenceCount} recorded answer${m.evidenceCount === 1 ? "" : "s"}` : "No recorded answers yet"}
        {learner.streak.current >= 2 ? ` · ${learner.streak.current} learning days in a row` : ""}
      </p>

      {!m.evidenceCount ? (
        <section className="home-empty">
          <div>
            <h2>Nothing recorded yet</h2>
            <p>Progress appears once {learner.name} answers questions in a class (on the board with Done, or out loud). Until then, the tutor won't claim to remember anything.</p>
          </div>
        </section>
      ) : (
        <>
          {m.next && (
            <section className="panel panel-accent">
              <h2>Next up</h2>
              <p className="next-q">{m.next.statement}</p>
              <p className="muted-line">{m.next.why}</p>
            </section>
          )}

          <section className="panel">
            <h2>Skills</h2>
            <ul className="skill-list">
              {m.progress.map((p) => (
                <li key={p.skill}>
                  <div className="skill-head">
                    <span className="skill-name">{p.name}</span>
                    <span className="status-chip" data-status={p.status}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </div>
                  <p className="muted-line">
                    {p.because} Solved alone: {p.independentCorrect}
                    {p.correctWithHelp ? `, with help: ${p.correctWithHelp}` : ""}
                    {p.mistakes ? `, mistakes: ${p.mistakes}` : ""}.
                  </p>
                </li>
              ))}
            </ul>
            <p className="rules">
              <strong>How this is decided:</strong> "Secure" needs two different problems solved alone (no hints, no solution shown), including a fresh one, and a correct latest
              try. A new mistake means one more independent answer is needed.
            </p>
          </section>

          <section className="panel">
            <h2>Mistakes we've seen</h2>
            {m.mistakes.length === 0 ? (
              <p className="muted-line">None recorded.</p>
            ) : (
              <ul className="mistake-list">
                {m.mistakes.map((x) => (
                  <li key={x.id} data-resolved={x.resolved}>
                    <div className="skill-head">
                      <span className="skill-name">{x.name}</span>
                      <span className="status-chip" data-status={x.resolved ? "secure" : "learning"}>
                        {x.resolved ? (
                          <>
                            <CheckCircle /> fixed since
                          </>
                        ) : (
                          `seen ${x.count}×`
                        )}
                      </span>
                    </div>
                    <p className="muted-line">
                      {x.confidence === "high" ? "Sure: the answer was exactly what this mistake gives." : "Possible: suggested by the handwriting reader."} Last seen {when(x.lastAt)}, e.g. "{x.examples[0]}".
                    </p>
                    <p className="remedy">{x.remedy}</p>
                    <button
                      className="link-button"
                      onClick={async () => {
                        if (!window.confirm(`Remove "${x.name}" from ${learner.name}'s record? Use this if it's not what happened.`)) return;
                        await rejectMisconception(learner.id, x.id).catch(() => {});
                        load();
                      }}
                    >
                      That's not what happened
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="panel panel-quiet">
        <h2>Phone revision</h2>
        <PhoneRevision learnerId={learner.id} learnerName={learner.name} />
      </section>

      <section className="panel panel-quiet">
        <h2>Privacy and sharing</h2>
        <div className="actions actions-left">
          <button className="btn-secondary btn-small" onClick={() => setSharing((s) => !s)}>
            <ShareNetwork /> Share with a teacher
          </button>
          <button
            className="btn-secondary btn-small"
            onClick={async () => {
              if (!window.confirm(`Clear everything recorded about ${learner.name} (answers, mistakes, progress)? Classes stay. This can't be undone.`)) return;
              await resetMemory(learner.id).catch((e: Error) => window.alert(e.message));
              load();
            }}
          >
            <ArrowCounterClockwise /> Clear progress
          </button>
          <button
            className="btn-secondary btn-small danger"
            onClick={async () => {
              if (!window.confirm(`Delete ${learner.name} and everything recorded about them? Their classes stay on this device but are no longer linked. This can't be undone.`)) return;
              await deleteLearner(learner.id).catch((e: Error) => window.alert(e.message));
              selectLearner(null);
              onBack();
            }}
          >
            <Trash /> Delete learner
          </button>
        </div>
        {sharing && <ShareWithTeacher learnerId={learner.id} learnerName={learner.name} />}
      </section>
    </main>
  );
}
