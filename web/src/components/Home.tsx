// Home: the student's learning sessions, like chats. Start a new one (blank board) or reopen an old
// one exactly as it was. Rename, archive and delete (with confirmation) live in each row's menu.

import { useEffect, useRef, useState } from "react";
import { Archive, ArrowCounterClockwise, BookOpenText, DotsThree, PencilSimpleLine, Plus, Trash } from "@phosphor-icons/react";
import { emptySnapshot } from "../../../shared/boardState";
import { LANGUAGE_NAMES } from "../../../shared/types";
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

export function Home({ onOpen }: { onOpen: (id: string) => void }) {
  const [creating, setCreating] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [, refresh] = useState(0);
  const all = listSessions(true);
  const sessions = all.filter((s) => showArchived || !s.archived);
  const archivedCount = all.filter((s) => s.archived).length;

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
        onCancel={() => setCreating(null)}
        onStart={(s) => {
          const now = Date.now();
          const meta: SessionMeta = {
            id: creating,
            serverId: s.serverId,
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
    <main className="home">
      <header className="home-head">
        <a className="wordmark" href="#/" aria-label="Shikshak home">
          <span className="wordmark-tile" aria-hidden="true">
            श
          </span>
          Shikshak
        </a>
        <button className="btn-primary" onClick={() => setCreating(newCode())}>
          <Plus weight="bold" /> New session
        </button>
      </header>

      <h1 className="home-title">Your classes</h1>

      {sessions.length === 0 ? (
        <section className="home-empty">
          <div className="empty-board" aria-hidden="true">
            <span>Maths: AP</span>
            <span>Physics: Electricity</span>
          </div>
          <div>
            <h2>Start your first class</h2>
            <p>Make one session per chapter. Each keeps its own board, notes and progress, so you can pick up where you stopped.</p>
            <button className="btn-primary" onClick={() => setCreating(newCode())}>
              <Plus weight="bold" /> New session
            </button>
          </div>
        </section>
      ) : (
        <ul className="session-list">
          {sessions.map((s, i) => {
            const docs = loadData(s.id).docs;
            const meta = [LANGUAGE_NAMES[s.language].split(" (")[0], `Class ${s.grade}`].join(", ");
            return (
              <li key={s.id} className="session-row" data-archived={s.archived} style={{ ["--i" as string]: i }}>
                <button className="session-open" onClick={() => onOpen(s.id)}>
                  <span className="session-tile" aria-hidden="true">
                    {initial(s)}
                  </span>
                  <span className="session-text">
                    <span className="session-name">{s.name}</span>
                    <span className="session-meta">
                      {meta}
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
                    <button
                      className="btn-icon"
                      aria-label={`More for ${s.name}`}
                      aria-expanded={menuFor === s.id}
                      onClick={() => setMenuFor((m) => (m === s.id ? null : s.id))}
                    >
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
    </main>
  );
}
