// Home: who is learning on this device, and their classes (like chats). Learners are profiles, picked
// on a "Who's learning?" screen when the app opens (like a streaming app's profiles). Start a new one (blank
// board) or reopen an old one exactly as it was. Rename, archive and delete (with confirmation)
// live in each row's menu. Several learners can share a device; each sees only their own classes.

import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArrowCounterClockwise, ArrowsLeftRight, BookOpenText, ChartLineUp, DotsThree, PencilSimpleLine, Plus, Signpost, Trash, UserPlus, UsersThree } from "@phosphor-icons/react";
import { emptySnapshot } from "../../../shared/boardState";
import { LANGUAGE_NAMES, LANGUAGE_STATUS, type Language } from "../../../shared/types";
import { createLearner, listLearners, selectedLearner, selectLearner, type Learner } from "../lib/learners";
import { deleteSession, listSessions, loadData, newCode, saveData, saveSession, updateSession, type SessionMeta } from "../lib/session";
import { HOME_TOUR, Tour, tourDue } from "./Tour";
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

export function Home({
  onOpen,
  onProgress,
}: {
  /** fresh: a session just made here (the board is wiped clean before it opens). */
  onOpen: (id: string, fresh?: boolean) => void;
  onProgress: (learnerId: string) => void;
}) {
  const [creating, setCreating] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [learners, setLearners] = useState<Learner[] | null>(null);
  const [learnerError, setLearnerError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(selectedLearner());
  const [adding, setAdding] = useState(false);
  // Ask "Who's learning?" once per visit (per tab); coming back from a class doesn't ask again.
  const [picking, setPicking] = useState(() => !readFlag(PICKED));
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const [, refresh] = useState(0);

  // Only a list that really came from the server may be used to clear away other classes.
  const [learnersLoaded, setLearnersLoaded] = useState(false);
  const loadLearners = useCallback(() => {
    listLearners()
      .then((list) => {
        setLearners(list);
        setLearnersLoaded(true);
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
  // Classes belong to an account: only the current account's are shown.
  const mine = (s: SessionMeta) => Boolean(current) && s.learnerId === current;
  const sessions = all.filter((s) => (showArchived || !s.archived) && mine(s));
  const archivedCount = all.filter((s) => s.archived && mine(s)).length;
  const learner = learners?.find((l) => l.id === current) ?? null;
  // Classes that belong to no account on this device (made before an account existed, or whose
  // account is gone) aren't kept: they're deleted here and on the server. Only after the account
  // list has really loaded, so a network error can never clear anything.
  const strayKey = learnersLoaded && learners ? all.filter((s) => !s.learnerId || !learners.some((l) => l.id === s.learnerId)).map((s) => s.id).join(",") : "";
  useEffect(() => {
    if (!strayKey) return;
    void Promise.all(strayKey.split(",").map((id) => deleteSession(id).catch(() => {}))).then(() => refresh((n) => n + 1));
  }, [strayKey]);

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
  useEffect(() => {
    if (!profileOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!profileRef.current?.contains(e.target as Node)) setProfileOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setProfileOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [profileOpen]);

  // The first time the home screen shows (not the profile picker), a short guided tour.
  const pickerShown = learners !== null && (adding || (learners.length > 0 && (picking || !current)));
  // Only when coming from the start screen: otherwise the picker just adds a learner.
  // No account on this device: making one comes first, always.
  const newAccount = learners !== null && learnersLoaded && learners.length === 0;
  useEffect(() => {
    if (newAccount) setAdding(true);
  }, [newAccount]);
  const [touring, setTouring] = useState(false);
  useEffect(() => {
    if (learners === null || pickerShown || creating || !tourDue("home")) return;
    const t = setTimeout(() => setTouring(true), 700);
    return () => clearTimeout(t);
  }, [learners, pickerShown, creating]);

  const choose = (id: string) => {
    setCurrent(id);
    selectLearner(id);
    setPicking(false);
    setAdding(false);
    setProfileOpen(false);
    writeFlag(PICKED);
  };
  const indexOf = (id: string) => Math.max(0, learners?.findIndex((l) => l.id === id) ?? 0);

  // Until the profiles have loaded, just the board: otherwise "Your classes" (nobody picked) shows for a moment
  // before switching to this learner's classes.
  if (learners === null) return <main className="home home-board" aria-busy="true" />;

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
          saveData(creating, { snapshot: emptySnapshot(), plan: s.plan, docs: s.docs, speed: "normal", handsFree: true });
          onOpen(creating, true);
        }}
      />
    );
  }

  const done = () => {
    setMenuFor(null);
    refresh((n) => n + 1);
  };

  const addForm = adding && (
    <AddLearner
      submitLabel={newAccount ? "Create account" : "Add"}
      required={newAccount}
      onDone={(l) => {
        setAdding(false);
        if (l) {
          choose(l.id);
          loadLearners();
        }
      }}
    />
  );

  // "Who's learning?": one chalk profile per learner, and one to add a learner.
  if (pickerShown) {
    return (
      <main className="home home-board profile-picker">
          <header className="home-head">
          <span className="wordmark">
            <span className="wordmark-tile" aria-hidden="true">
              श
            </span>
            <span className="chalk">Shikshak</span>
          </span>
        </header>
        <section className="picker" aria-labelledby="picker-title">
          <h1 id="picker-title" className="picker-title chalk">
            {newAccount ? "Create your account" : "Who's learning?"}
          </h1>
          {newAccount && <p className="picker-lede">Tell me your name, your class and how you like to learn. It stays on this device.</p>}
          <ul className="profiles">
            {learners.map((l, i) => (
              <li key={l.id}>
                <button className="profile" onClick={() => choose(l.id)} aria-current={l.id === current ? "true" : undefined}>
                  <Avatar index={i} />
                  <span className="profile-name chalk">{l.name}</span>
                  {l.streak.current >= 2 && (
                    <span className="streak" title={`${l.streak.current} learning days in a row`}>
                      {l.streak.current}d
                    </span>
                  )}
                </button>
              </li>
            ))}
            <li>
              <button className="profile profile-add" onClick={() => setAdding(true)} aria-expanded={adding}>
                <span className="avatar avatar-add" aria-hidden="true">
                  <Plus weight="bold" />
                </span>
                <span className="profile-name">Add learner</span>
              </button>
            </li>
          </ul>
          {addForm}
          {learnerError && <p className="form-error">{learnerError}</p>}
          {adding && learners.length > 0 && (
            <button className="link-button" onClick={() => setAdding(false)}>
              Back
            </button>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="home home-board">
      <header className="home-head">
        <div className="home-head-left">
          <a className="wordmark" href="#/" aria-label="Shikshak home">
            <span className="wordmark-tile" aria-hidden="true">
              श
            </span>
            <span className="chalk">Shikshak</span>
          </a>
        </div>
        <div className="home-head-actions">
          <button className="btn-primary" onClick={() => setCreating(newCode())} disabled={Boolean(learners?.length) && !current}>
            <Plus weight="bold" /> New session
          </button>
          <button className="btn-secondary group-entry" onClick={() => (location.hash = "#/group")} title="Study with friends">
            <UsersThree weight="bold" /> <span className="group-entry-label">Study group</span>
          </button>
          {learner ? (
            <div className="profile-menu" ref={profileRef}>
              <button
                className="profile-button"
                aria-label={`Profile: ${learner.name}`}
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((o) => !o)}
              >
                <Avatar index={indexOf(learner.id)} small />
              </button>
              {profileOpen && (
                <div className="menu menu-light profile-dropdown" role="menu">
                  <p className="profile-dropdown-name chalk">{learner.name}</p>
                  {(learners ?? [])
                    .filter((l) => l.id !== learner.id)
                    .map((l) => (
                      <button key={l.id} role="menuitem" onClick={() => choose(l.id)}>
                        <Avatar index={indexOf(l.id)} tiny /> {l.name}
                      </button>
                    ))}
                  <button role="menuitem" onClick={() => onProgress(learner.id)}>
                    <ChartLineUp /> My progress
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setProfileOpen(false);
                      setPicking(true);
                    }}
                  >
                    <ArrowsLeftRight /> Switch profile
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setProfileOpen(false);
                      setAdding(true);
                    }}
                  >
                    <UserPlus /> Add learner
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setProfileOpen(false);
                      setTouring(true);
                    }}
                  >
                    <Signpost /> Show me around
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="profile-button" aria-label="Add learner" title="Add learner" onClick={() => setAdding(true)}>
              <span className="avatar avatar-add avatar-small" aria-hidden="true">
                <Plus weight="bold" />
              </span>
            </button>
          )}
        </div>
      </header>

      {learnerError && <p className="form-error">{learnerError}</p>}

      <div className="home-title-row">
        <h1 className="home-title chalk">{learner ? `${learner.name}'s classes` : "Your classes"}</h1>
        {learner && (
          <button className="btn-secondary progress-button" onClick={() => onProgress(learner.id)}>
            <ChartLineUp weight="bold" /> My progress
          </button>
        )}
      </div>

      {sessions.length === 0 ? (
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
              I am Shikshak, your tutor for maths in classes 8 to 12. I talk you through a topic in Hinglish, Hindi or English while writing on a shared
              chalkboard. You solve on the board, press Done, and I read your handwritten steps and circle the one that went wrong.
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
      {touring && <Tour name="home" steps={HOME_TOUR} onClose={() => setTouring(false)} />}
    </main>
  );
}

export function AddLearner({ onDone, submitLabel = "Add", required = false }: { onDone: (l: Learner | null) => void; submitLabel?: string; required?: boolean }) {
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
          <option value="ta">தமிழ்</option>
          <option value="te">తెలుగు</option>
        </select>
      </label>
      <div className="actions">
        {!required && (
          <button type="button" className="btn-secondary btn-small" onClick={() => onDone(null)}>
            Cancel
          </button>
        )}
        <button className="btn-primary btn-small" disabled={saving || !name.trim()}>
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}


const PICKED = "shikshak.profilePicked";
function readFlag(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeFlag(key: string) {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // private mode: the picker just shows again next time
  }
}

/** Chalk colours for profiles, in order of when the learner was added. */
const AVATAR_COLOURS = ["#6fa8dc", "#e07a68", "#e3bb55", "#6dbb8e", "#cf86b3", "#9c8fdb"];

/** A learner's profile picture: a coloured chalk square with a chalk face (a few different faces). */
export function Avatar({ index, small, tiny }: { index: number; small?: boolean; tiny?: boolean }) {
  const face = index % 3;
  return (
    <span className={`avatar${small ? " avatar-small" : ""}${tiny ? " avatar-tiny" : ""}`} style={{ ["--avatar" as string]: AVATAR_COLOURS[index % AVATAR_COLOURS.length] }} aria-hidden="true">
      <svg viewBox="0 0 40 40" className="avatar-face">
        {face === 1 ? <path d="M11.5 15.5 h5" /> : <circle cx="14" cy="15.5" r="2.1" />}
        <circle cx="26" cy="15.5" r="2.1" />
        {face === 2 ? <path d="M12 23.5 Q20 33 28 23.5 Z" className="filled" /> : <path d="M11.5 24 Q20 31 28.5 24" />}
      </svg>
    </span>
  );
}
