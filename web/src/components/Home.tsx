// Home: the student's learning sessions, like chats. Start a new one (blank board) or reopen an old
// one exactly as it was. Rename, archive and delete (with confirmation) live here.

import { useState } from "react";
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

export function Home({ onOpen }: { onOpen: (id: string) => void }) {
  const [creating, setCreating] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [, refresh] = useState(0);
  const sessions = listSessions(true).filter((s) => showArchived || !s.archived);
  const archivedCount = listSessions(true).filter((s) => s.archived).length;

  if (creating) {
    return (
      <Setup
        sessionCode={creating}
        onCancel={() => setCreating(null)}
        onStart={(s) => {
          const now = Date.now();
          const meta: SessionMeta = {
            id: creating,
            name: s.plan?.plan.title || s.topic || "New session",
            studentName: s.name,
            grade: s.grade,
            language: s.language,
            topic: s.topic || s.plan?.plan.topic || "",
            createdAt: now,
            updatedAt: now,
            archived: false,
            started: false,
          };
          saveSession(meta);
          saveData(creating, { events: [], plan: s.plan, docs: s.docs, speed: "normal", handsFree: false });
          onOpen(creating);
        }}
      />
    );
  }

  return (
    <main className="home">
      <header className="home-head">
        <div>
          <p className="eyebrow">Shikshak</p>
          <h1>Your classes</h1>
        </div>
        <button className="btn-primary" onClick={() => setCreating(newCode())}>
          + New session
        </button>
      </header>

      {sessions.length === 0 ? (
        <div className="home-empty">
          <p>No sessions yet.</p>
          <p className="muted">Start one for each subject or chapter, for example "Maths: AP" or "Physics: Current Electricity". Each keeps its own board, notes and progress.</p>
          <button className="btn-primary" onClick={() => setCreating(newCode())}>
            + New session
          </button>
        </div>
      ) : (
        <ul className="session-list">
          {sessions.map((s) => {
            const docs = loadData(s.id).docs;
            return (
              <li key={s.id} className="session-card" data-archived={s.archived}>
                <button className="session-open" onClick={() => onOpen(s.id)}>
                  <span className="session-name">{s.name}</span>
                  <span className="session-meta">
                    {[s.topic, LANGUAGE_NAMES[s.language].split(" (")[0], `class ${s.grade}`, docs.length ? `${docs.length} file${docs.length > 1 ? "s" : ""}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="session-time">{s.started ? `Last class ${ago(s.updatedAt)}` : "Not started yet"}</span>
                </button>
                <div className="session-actions">
                  <button className="btn-primary" onClick={() => onOpen(s.id)}>
                    {s.started ? "Resume" : "Open"}
                  </button>
                  <button
                    onClick={() => {
                      const name = window.prompt("Rename session", s.name)?.trim();
                      if (name) updateSession(s.id, { name, updatedAt: s.updatedAt });
                      refresh((n) => n + 1);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => {
                      updateSession(s.id, { archived: !s.archived, updatedAt: s.updatedAt });
                      refresh((n) => n + 1);
                    }}
                  >
                    {s.archived ? "Unarchive" : "Archive"}
                  </button>
                  <button
                    className="danger"
                    onClick={async () => {
                      if (!window.confirm(`Delete "${s.name}"? Its board, notes and files on this device are removed. This can't be undone.`)) return;
                      await deleteSession(s.id);
                      refresh((n) => n + 1);
                    }}
                  >
                    Delete
                  </button>
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
