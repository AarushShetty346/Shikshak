// Home: who is learning on this device, and their classes (like chats). Start a new one (blank
// board) or reopen an old one exactly as it was. Rename, archive and delete (with confirmation)
// live in each row's menu. Several learners can share a device; each sees only their own classes.

import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArrowCounterClockwise, BookOpenText, ChartLineUp, DotsThree, PencilSimpleLine, Plus, Trash, UserPlus } from "@phosphor-icons/react";
import { emptySnapshot } from "../../../shared/boardState";
import { LANGUAGE_NAMES, LANGUAGE_STATUS, type Language } from "../../../shared/types";
import { apiFetch } from "../lib/api";
import { createLearner, listLearners, selectedLearner, selectLearner, type Learner } from "../lib/learners";
import { deleteSession, listSessions, loadData, newCode, saveData, saveSession, updateSession, type SessionMeta } from "../lib/session";
import { Setup } from "./Setup";

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** The first letter of the topic, in chalk, so sessions are easy to tell apart at a glance. */
function initial(s: SessionMeta): string {
  return (s.topic || s.name).trim().charAt(0).toUpperCase() || "श";
}

export function Home({ onOpen, onProgress }: { onOpen: (id: string) => void; onProgress: (learnerId: string) => void }) {
  const [creating, setCreating] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [learners, setLearners] = useState<Learner[] | null>(null);
  const [learnerError, setLearnerError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(selectedLearner());
  const [adding, setAdding] = useState(false);
  const [, refresh] = useState(0);

  const loadLearners = useCallback(() => {
    listLearners()
      .then((list) => {
        setLearners(list);
        setLearnerError(null);
        // Keep the selection valid: the remembered learner, else the only one, else none.
        setCurrent((cur) => {
          const ok = cur && list.some((l) => l.id === cur) ? cur : list.length === 1 ? list[0].id : null;
          selectLearner(ok);
          return ok;
        });
      })
      .catch((e: Error) => {
        setLearners([]);
        setLearnerError(e.message);
      });
  }, []);
  useEffect(loadLearners, [loadLearners]);

  const all = listSessions(true);
  const mine = (s: SessionMeta) => !learners?.length || (current ? s.learnerId === current : !s.learnerId);
  const sessions = all.filter((s) => (showArchived || !s.archived) && mine(s));
  const archivedCount = all.filter((s) => s.archived && mine(s)).length;
  const learner = learners?.find((l) => l.id === current) ?? null;
  // Classes made before learners existed: shown separately so they can be linked to someone.
  const unlinked = learner ? all.filter((s) => !s.learnerId && !s.archived) : [];

  // Close a row menu on outside click or Escape.
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuFor(null);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  if (creating) {
    return (
      <Setup
        sessionCode={creating}
        learner={learner ? { id: learner.id, name: learner.name, grade: learner.grade, language: learner.language } : null}
        onCancel={() => setCreating(null)}
        onStart={(s) => {
          const now = Date.now();
          const meta: SessionMeta = {
            id: creating,
            serverId: s.serverId,
            learnerId: learner?.id ?? null,
            name: s.plan?.title || s.topic || "New session",
            studentName: s.name,
            grade: s.grade,
            language: s.language,
            topic: s.topic || s.plan?.topic || "",
            createdAt: now,
            updatedAt: now,
            archived: false,
            started: false,
          };
          saveSession(meta);
          saveData(creating, { snapshot: emptySnapshot(), plan: s.plan, docs: s.docs, speed: "normal", handsFree: false });
          onOpen(creating);
        }}
      />
    );
  }

  const done = () => {
    setMenuFor(null);
    refresh((n) => n + 1);
  };

  return (
    <main className="home home-board">
      <ChalkFilter />
      <header className="home-head">
        <a className="wordmark" href="#/" aria-label="Shikshak home">
          <span className="wordmark-tile" aria-hidden="true">
            श
          </span>
          <span className="chalk">Shikshak</span>
        </a>
        <button className="btn-primary" onClick={() => setCreating(newCode())} disabled={Boolean(learners?.length) && !current}>
          <Plus weight="bold" /> New session
        </button>
      </header>

      <section className="learner-bar" aria-label="Who's learning">
        <span className="learner-bar-label">Who's learning?</span>
        <div className="learner-chips">
          {(learners ?? []).map((l) => (
            <button
              key={l.id}
              className="learner-chip"
              aria-pressed={l.id === current}
              onClick={() => {
                setCurrent(l.id);
                selectLearner(l.id);
              }}
            >
              {l.name}
              {l.streak.current >= 2 && (
                <span className="streak" title={`${l.streak.current} learning days in a row`}>
                  {l.streak.current}d
                </span>
              )}
            </button>
          ))}
          <button className="learner-chip learner-add" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            <UserPlus /> Add learner
          </button>
        </div>
        {learner && (
          <button className="link-button" onClick={() => onProgress(learner.id)}>
            <ChartLineUp /> {learner.name}'s progress
          </button>
        )}
        {learnerError && <p className="form-error">{learnerError}</p>}
        {adding && (
          <AddLearner
            onDone={(l) => {
              setAdding(false);
              if (l) {
                setCurrent(l.id);
                selectLearner(l.id);
                loadLearners();
              }
            }}
          />
        )}
      </section>

      <h1 className="home-title chalk">{learner ? `${learner.name}'s classes` : "Your classes"}</h1>

      {Boolean(learners?.length) && !current ? (
        <section className="home-empty">
          <div>
            <h2 className="chalk">Choose who's learning</h2>
            <p>Pick a name above (or add one) so classes and progress stay with the right person.</p>
          </div>
        </section>
      ) : sessions.length === 0 ? (
        <section className="home-empty">
          <div className="empty-board" aria-hidden="true">
            <span className="chalk">x² − 7x + 12 = 0</span>
            <span className="chalk empty-board-slip">
              x(x − 3) + 4(x − 3) = 0
              <svg className="chalk-circle" viewBox="0 0 200 60" preserveAspectRatio="none">
                <path d="M8 34 C 10 12, 70 4, 118 7 C 168 10, 196 20, 192 36 C 188 52, 120 58, 70 55 C 28 52, 4 46, 12 26" />
              </svg>
            </span>
            <span className="chalk empty-board-note">Step 2: −4, not +4</span>
          </div>
          <div>
            <h2 className="chalk">Learn maths out loud</h2>
            <p>
              Shikshak is a voice maths tutor for classes 8 to 12. It talks you through a topic in Hinglish, Hindi or English while writing on a shared
              chalkboard. You solve on the board, press Done, and it reads your handwritten steps and circles the one that went wrong.
            </p>
            <p>Start with one class per chapter. Each keeps its own board, notes and progress.</p>
            <button className="btn-primary" onClick={() => setCreating(newCode())}>
              <Plus weight="bold" /> New session
            </button>
          </div>
        </section>
      ) : (
        <ul className="session-list">
          {sessions.map((s, i) => {
            const docs = loadData(s.id).docs;
            const meta = [LANGUAGE_NAMES[s.language]?.split(" (")[0] ?? s.language, `Class ${s.grade}`].join(", ");
            return (
              <li key={s.id} className="session-row" data-archived={s.archived} style={{ ["--i" as string]: i }}>
                <button className="session-open" onClick={() => onOpen(s.id)}>
                  <span className="session-tile" aria-hidden="true">
                    {initial(s)}
                  </span>
                  <span className="session-text">
                    <span className="session-name chalk">{s.name}</span>
                    <span className="session-meta">
                      {meta}
                      {LANGUAGE_STATUS[s.language] === "preview" && <span className="preview-tag">preview language</span>}
                      {docs.length > 0 && (
                        <span className="session-files">
                          <BookOpenText /> {docs.length} file{docs.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="session-time">{s.archived ? "Archived" : s.started ? `Last class ${ago(s.updatedAt)}` : "Not started"}</span>
                </button>
                <div className="session-actions">
                  <button className={s.started ? "btn-primary btn-small" : "btn-secondary btn-small"} onClick={() => onOpen(s.id)}>
                    {s.started ? "Resume" : "Open"}
                  </button>
                  <div className="row-menu" ref={menuFor === s.id ? menuRef : undefined}>
                    <button className="btn-icon" aria-label={`More for ${s.name}`} aria-expanded={menuFor === s.id} onClick={() => setMenuFor((m) => (m === s.id ? null : s.id))}>
                      <DotsThree weight="bold" />
                    </button>
                    {menuFor === s.id && (
                      <div className="menu menu-light" role="menu">
                        <button
                          role="menuitem"
                          onClick={() => {
                            const name = window.prompt("Rename session", s.name)?.trim();
                            if (name) updateSession(s.id, { name, updatedAt: s.updatedAt });
                            done();
                          }}
                        >
                          <PencilSimpleLine /> Rename
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => {
                            updateSession(s.id, { archived: !s.archived, updatedAt: s.updatedAt });
                            done();
                          }}
                        >
                          {s.archived ? <ArrowCounterClockwise /> : <Archive />} {s.archived ? "Unarchive" : "Archive"}
                        </button>
                        <button
                          role="menuitem"
                          className="danger"
                          onClick={async () => {
                            if (!window.confirm(`Delete "${s.name}"? Its board, notes and files are removed from this device and the server. This can't be undone.`)) return;
                            try {
                              await deleteSession(s.id);
                            } catch (err) {
                              window.alert(`Couldn't delete it right now: ${(err as Error).message}`);
                            }
                            done();
                          }}
                        >
                          <Trash /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {archivedCount > 0 && (
        <button className="link-button" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
        </button>
      )}
      {learner && unlinked.length > 0 && (
        <section className="panel panel-quiet">
          <h2>Not linked to anyone yet</h2>
          <ul className="grant-list">
            {unlinked.map((s) => (
              <li key={s.id}>
                <span>{s.name}</span>
                <button
                  className="link-button"
                  onClick={async () => {
                    try {
                      if (s.serverId) await apiFetch(`/sessions/${s.serverId}`, { method: "PATCH", body: { learnerId: learner.id } });
                      updateSession(s.id, { learnerId: learner.id, updatedAt: s.updatedAt });
                      refresh((n) => n + 1);
                    } catch (err) {
                      window.alert((err as Error).message);
                    }
                  }}
                >
                  Link to {learner.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <footer className="home-foot">
        <span>For teachers:</span>
        <a href="#/teacher">Teacher view</a>
        <a href="#/pilot">Pilot tools</a>
      </footer>
    </main>
  );
}

function AddLearner({ onDone }: { onDone: (l: Learner | null) => void }) {
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("10");
  const [language, setLanguage] = useState<Language>("hinglish");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="add-learner"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
          onDone(await createLearner({ name: name.trim(), grade, language }));
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setSaving(false);
        }
      }}
    >
      <label className="field">
        <span>Name or nickname</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Asha" autoFocus required maxLength={40} />
      </label>
      <label className="field field-small">
        <span>Class</span>
        <select value={grade} onChange={(e) => setGrade(e.target.value)}>
          {["8", "9", "10", "11", "12"].map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </label>
      <label className="field field-small">
        <span>Language</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
          <option value="hinglish">Hinglish</option>
          <option value="hi">हिन्दी</option>
          <option value="en">English</option>
          <option value="ta">தமிழ் (preview)</option>
          <option value="te">తెలుగు (preview)</option>
        </select>
      </label>
      <div className="actions">
        <button type="button" className="btn-secondary btn-small" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button className="btn-primary btn-small" disabled={saving || !name.trim()}>
          {saving ? "Adding…" : "Add"}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}

/**
 * The chalk look for the home board's headings: a little displacement for rough edges and a grain
 * mask that leaves gaps, the way chalk skips over a board. Used by `.chalk` (see styles.css).
 */
function ChalkFilter() {
  return (
    <svg className="chalk-defs" aria-hidden="true" focusable="false">
      <filter id="chalk-text" x="-5%" y="-10%" width="110%" height="120%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.8" xChannelSelector="R" yChannelSelector="G" result="rough" />
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 4 -0.75" result="grain" />
        <feComposite in="rough" in2="grain" operator="in" />
      </filter>
    </svg>
  );
}
