// Study groups, in the style of a music "jam": start a group, invite friends with a link, a QR
// code or a 6-letter code, and they see who's in it and join. Each of you studies with your own
// tutor; inside the group you can open a friend's notes (the boards of their classes), class
// reports and progress. Anyone can leave; the person who started it can end it.

import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { ArrowLeft, ChartLineUp, Copy, Export, FileText, Notebook, UserPlus, UsersThree, X } from "@phosphor-icons/react";
import { AddLearner, Avatar } from "./Home";
import { BlockBody } from "./Board";
import { toBlock } from "./Classroom";
import { endGroup, joinGroup, joinLink, leaveGroup, memberNotes, memberView, myGroups, previewGroup, startGroup, type MemberView, type StudyGroup } from "../lib/groups";
import { listLearners, selectedLearner, selectLearner, STATUS_LABEL, type Learner } from "../lib/learners";
import { isBlockEvent } from "../../../shared/boardState";
import type { BlockEvent } from "../../../shared/types";

const Stack = ({ group }: { group: StudyGroup }) => (
  <span className="group-stack" aria-label={group.members.map((m) => m.name).join(", ")}>
    {group.members.slice(0, 3).map((m, i) => (
      <Avatar key={m.learnerId} index={i} tiny />
    ))}
    {group.members.length > 3 && <span className="group-more">+{group.members.length - 3}</span>}
  </span>
);

const FINE_PRINT = "People in the group see your name, your class, the notes from your classes, your class reports and your progress. You can leave any time.";

/** #/group and #/group/<id>: start a group, or see yours. */
export function StudyGroups({ groupId, onBack, onOpenGroup }: { groupId: string | null; onBack: () => void; onOpenGroup: (id: string | null) => void }) {
  const [groups, setGroups] = useState<StudyGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needAccount, setNeedAccount] = useState(false);
  const learnerId = selectedLearner();
  const reload = () =>
    myGroups()
      .then(setGroups)
      .catch((e) => setError((e as Error).message));
  useEffect(() => void reload(), [groupId]);

  const group = groupId ? groups?.find((g) => g.id === groupId) : null;
  // Opening a group: nothing until it has loaded (not a moment of the "Study together" page).
  if (groupId && groups === null) return <main className="home home-board group-page" aria-busy="true" />;
  if (groupId && groups && !group) return <Shell onBack={() => onOpenGroup(null)} title="Study group"><p className="group-note">You're not in this group any more.</p></Shell>;
  if (group) return <GroupPage group={group} learnerId={learnerId} onBack={() => onOpenGroup(null)} onChanged={reload} onGone={() => onOpenGroup(null)} />;

  const start = async (who: string | null = learnerId) => {
    setError(null);
    if (!who) {
      // Nobody picked on this device: use the only profile, or make the account here.
      const list = await listLearners().catch(() => [] as Learner[]);
      if (list.length === 1) who = list[0].id;
      else if (list.length === 0) return setNeedAccount(true);
      else return setError("Pick who you are on the home screen first, then start a group.");
      selectLearner(who);
    }
    setBusy(true);
    try {
      const g = await startGroup(who);
      onOpenGroup(g.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell onBack={onBack} title="">
      <section className="group-hero">
        <div className="group-art" aria-hidden="true">
          <span className="group-dot" />
          <span className="group-dot group-dot-main">
            <UsersThree weight="bold" />
          </span>
          <span className="group-dot" />
          <span className="group-dot" />
          <span className="group-dot group-dot-face">
            <Avatar index={1} />
          </span>
          <span className="group-dot" />
        </div>
        <h1 className="chalk">Study together</h1>
        <p className="group-sub">Because maths is easier with friends.</p>
        <p className="group-blurb">Each of you learns with your own tutor. Friends in your group can open your notes, class reports and progress, and you can open theirs.</p>
        {needAccount ? (
          <div className="join-account">
            <p>Make your account first. It stays on this device.</p>
            <AddLearner
              submitLabel="Create account and start"
              required
              onDone={(l) => {
                if (!l) return;
                selectLearner(l.id);
                void start(l.id);
              }}
            />
          </div>
        ) : (
          <button className="btn-primary group-cta" onClick={() => void start()} disabled={busy}>
            <UserPlus weight="bold" /> Start a group
          </button>
        )}
        <JoinByCode />
        {error && <p className="form-error">{error}</p>}
        <p className="group-fine">{FINE_PRINT}</p>
      </section>
      {groups && groups.length > 0 && (
        <section className="group-list" aria-label="Your groups">
          <h2 className="chalk">Your groups</h2>
          {groups.map((g) => (
            <button key={g.id} className="group-row" onClick={() => onOpenGroup(g.id)}>
              <Stack group={g} />
              <span className="group-row-name">{g.name}</span>
              <span className="group-row-count">{g.members.length} in it</span>
            </button>
          ))}
        </section>
      )}
    </Shell>
  );
}

function JoinByCode() {
  const [code, setCode] = useState("");
  return (
    <form
      className="group-code-form"
      onSubmit={(e) => {
        e.preventDefault();
        const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (c.length === 6) location.hash = `#/join/${c}`;
      }}
    >
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Have a code?" aria-label="Group code" maxLength={8} autoCapitalize="characters" />
      <button className="btn-secondary btn-small" disabled={code.replace(/[^A-Z0-9]/gi, "").length !== 6}>
        Join
      </button>
    </form>
  );
}

function Shell({ title, onBack, children, actions }: { title: string; onBack: () => void; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <main className="home home-board group-page">
      <header className="group-head">
        <button className="link-button group-back" onClick={onBack}>
          <ArrowLeft weight="bold" /> Back
        </button>
        {actions}
      </header>
      {title && <h1 className="chalk group-title">{title}</h1>}
      {children}
    </main>
  );
}

function GroupPage({ group, learnerId, onBack, onChanged, onGone }: { group: StudyGroup; learnerId: string | null; onBack: () => void; onChanged: () => void; onGone: () => void }) {
  const [inviting, setInviting] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const me = group.members.find((m) => m.me);
  if (viewing) return <MemberPage group={group} learnerId={viewing} onBack={() => setViewing(null)} />;
  const leave = async () => {
    if (!window.confirm(group.mine ? "End this study group for everyone?" : "Leave this study group? They won't see your notes any more.")) return;
    if (group.mine) await endGroup(group.id);
    else if (me) await leaveGroup(group.id, me.learnerId === learnerId || !learnerId ? me.learnerId : learnerId);
    onGone();
  };
  return (
    <Shell onBack={onBack} title={group.name}>
      <div className="group-pills">
        <Stack group={group} />
        <button className="group-pill" onClick={() => setInviting(true)}>
          Invite
        </button>
        <button className="group-pill" onClick={() => void leave().then(onChanged)}>
          {group.mine ? "End" : "Leave"}
        </button>
      </div>
      <section aria-label="In this group">
        <h2 className="group-section">In this group</h2>
        <ul className="group-members">
          {group.members.map((m, i) => (
            <li key={m.learnerId}>
              <button className="group-member" onClick={() => setViewing(m.learnerId)} disabled={!m.live}>
                <Avatar index={i} small />
                <span className="group-member-name">
                  {m.name} {m.me && <span className="group-you">you</span>}
                </span>
                <span className="group-member-sub">Class {m.grade}</span>
                <span className="group-member-go">Notes, reports, progress</span>
              </button>
            </li>
          ))}
        </ul>
        {group.members.length < 2 && <p className="group-note">Invite a friend: you'll see each other here.</p>}
      </section>
      {inviting && <InviteSheet group={group} onClose={() => setInviting(false)} />}
    </Shell>
  );
}

function Qr({ text }: { text: string }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const out: string[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) out.push(`M${c} ${r}h1v1h-1z`);
    return { n, d: out.join("") };
  }, [text]);
  return (
    <svg className="group-qr" viewBox={`-2 -2 ${cells.n + 4} ${cells.n + 4}`} role="img" aria-label="QR code to join">
      <rect x={-2} y={-2} width={cells.n + 4} height={cells.n + 4} fill="#fff" />
      <path d={cells.d} fill="#111" />
    </svg>
  );
}

function InviteSheet({ group, onClose }: { group: StudyGroup; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = joinLink(group.code ?? "");
  const share = async () => {
    const data = { title: "Study with me on Shikshak", text: `Join ${group.name} on Shikshak (code ${group.code})`, url: link };
    try {
      if (navigator.share) return await navigator.share(data);
    } catch {
      return; // closed the share sheet
    }
    await navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
  };
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="invite-title">
        <span className="sheet-grip" aria-hidden="true" />
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <X weight="bold" />
        </button>
        <h2 id="invite-title">Invite friends to your group</h2>
        <button className="btn-primary sheet-cta" onClick={() => void share()}>
          <Export weight="bold" /> {copied ? "Link copied" : "Share link"}
        </button>
        <hr />
        <div className="sheet-row">
          <div>
            <h3>Scan the QR code</h3>
            <p>Friends scan it with their phone camera to join.</p>
          </div>
          <Qr text={link} />
        </div>
        <hr />
        <div className="sheet-row">
          <div>
            <h3>Or type the code</h3>
            <p>On the Study group page, under "Have a code?".</p>
          </div>
          <button className="group-code" onClick={() => void navigator.clipboard?.writeText(group.code ?? "").catch(() => {})} title="Copy the code">
            {group.code} <Copy />
          </button>
        </div>
      </div>
    </div>
  );
}

/** #/join/<code>: "Join Asha's study group?" */
export function JoinGroup({ code, onJoined, onNotNow }: { code: string; onJoined: (id: string) => void; onNotNow: () => void }) {
  const [group, setGroup] = useState<StudyGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Who is joining: the profile picked on this device; a new device makes its account right here.
  const [learnerId, setLearnerId] = useState(selectedLearner);
  const [profiles, setProfiles] = useState<Learner[] | null>(null);
  useEffect(() => {
    previewGroup(code)
      .then(setGroup)
      .catch((e) => setError((e as Error).message));
    listLearners()
      .then((list) => {
        setProfiles(list);
        if (list.length === 1 && !list.some((l) => l.id === learnerId)) {
          selectLearner(list[0].id);
          setLearnerId(list[0].id);
        }
      })
      .catch(() => setProfiles([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);
  const known = Boolean(learnerId && profiles?.some((l) => l.id === learnerId));
  const join = async (id = learnerId) => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const g = await joinGroup(code, id);
      onJoined(g.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="home home-board group-page">
      <div className="sheet-backdrop sheet-static">
        <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="join-title">
          <span className="sheet-grip" aria-hidden="true" />
          {group ? (
            <>
              <Stack group={group} />
              <h2 id="join-title">Join {group.owner ? `${group.owner}'s` : "this"} study group?</h2>
              <p className="sheet-green">
                <UsersThree weight="bold" /> {group.members.length} {group.members.length === 1 ? "person" : "people"} studying together
              </p>
              {group.members.some((m) => m.me) ? (
                <button className="btn-primary sheet-cta" onClick={() => onJoined(group.id)}>
                  Open the group
                </button>
              ) : profiles === null ? null : known ? (
                <button className="btn-primary sheet-cta" onClick={() => void join()} disabled={busy}>
                  Join as {profiles.find((l) => l.id === learnerId)?.name}
                </button>
              ) : profiles.length > 0 ? (
                <div className="join-pick" role="group" aria-label="Who is joining?">
                  <p>Who is joining?</p>
                  {profiles.map((l) => (
                    <button
                      key={l.id}
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => {
                        selectLearner(l.id);
                        setLearnerId(l.id);
                        void join(l.id);
                      }}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="join-account">
                  <p>Make your account to join. It stays on this device.</p>
                  <AddLearner
                    submitLabel="Create account and join"
                    required
                    onDone={(l) => {
                      if (!l) return;
                      selectLearner(l.id);
                      setLearnerId(l.id);
                      setProfiles([l]);
                      void join(l.id);
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <h2 id="join-title">{error ? "Can't join" : "Looking for the group…"}</h2>
          )}
          {error && <p className="form-error">{error}</p>}
          <button className="link-button" onClick={onNotNow}>
            Not now
          </button>
          <p className="group-fine">{FINE_PRINT}</p>
        </div>
      </div>
    </main>
  );
}

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function MemberPage({ group, learnerId, onBack }: { group: StudyGroup; learnerId: string; onBack: () => void }) {
  const [data, setData] = useState<MemberView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"notes" | "reports" | "progress">("notes");
  const [notesOf, setNotesOf] = useState<string | null>(null);
  useEffect(() => {
    memberView(group.id, learnerId)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [group.id, learnerId]);
  if (notesOf && data) return <NotesPage group={group} learnerId={learnerId} sessionId={notesOf} name={data.learner.name} onBack={() => setNotesOf(null)} />;
  const name = data?.learner.name ?? group.members.find((m) => m.learnerId === learnerId)?.name ?? "";
  return (
    <Shell onBack={onBack} title={name ? `${name}'s study` : "Study"}>
      {error && <p className="form-error">{error}</p>}
      {data && (
        <>
          <div className="segmented group-tabs" role="tablist">
            {(
              [
                ["notes", "Notes", <Notebook key="n" />],
                ["reports", "Reports", <FileText key="r" />],
                ["progress", "Progress", <ChartLineUp key="p" />],
              ] as const
            ).map(([k, label, icon]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                {icon} {label}
              </button>
            ))}
          </div>
          {tab === "notes" &&
            (data.sessions.length ? (
              <ul className="group-cards">
                {data.sessions.map((s) => (
                  <li key={s.id}>
                    <button className="group-card" onClick={() => setNotesOf(s.id)}>
                      <strong>{s.topic || "A class"}</strong>
                      <span>
                        {day(s.lastActive)} · {s.blocks} thing{s.blocks === 1 ? "" : "s"} on the board
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="group-note">{name} hasn't had a class yet.</p>
            ))}
          {tab === "reports" &&
            (data.reports.length ? (
              <ul className="group-cards">
                {data.reports.map((r, i) => (
                  <li key={i} className="group-card group-report">
                    <strong>
                      {r.topic} · {day(r.date)}
                    </strong>
                    {r.sparse ? (
                      <span>{r.note}</span>
                    ) : (
                      <>
                        <span>
                          {r.counts.attempted} question{r.counts.attempted === 1 ? "" : "s"}: {r.counts.solvedAlone} alone, {r.counts.solvedWithHelp} with help, {r.counts.notSolved} not yet
                        </span>
                        {r.covered.length > 0 && <span>Covered: {r.covered.join(", ")}</span>}
                        {r.needsPractice.length > 0 && <span>Practise: {r.needsPractice.join(", ")}</span>}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="group-note">No class reports yet.</p>
            ))}
          {tab === "progress" &&
            (data.memory.evidenceCount ? (
              <ul className="group-cards">
                {data.memory.progress.map((p) => (
                  <li key={p.skill} className="group-card">
                    <strong>{p.name}</strong>
                    <span>{STATUS_LABEL[p.status]}</span>
                  </li>
                ))}
                {data.memory.mistakes
                  .filter((m) => !m.resolved)
                  .map((m) => (
                    <li key={m.id} className="group-card group-mistake">
                      <strong>Working on: {m.name}</strong>
                      <span>Seen {m.count} time{m.count === 1 ? "" : "s"}</span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="group-note">Nothing recorded yet: progress appears once {name} answers questions in a class.</p>
            ))}
        </>
      )}
    </Shell>
  );
}

function NotesPage({ group, learnerId, sessionId, name, onBack }: { group: StudyGroup; learnerId: string; sessionId: string; name: string; onBack: () => void }) {
  const [notes, setNotes] = useState<Awaited<ReturnType<typeof memberNotes>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    memberNotes(group.id, learnerId, sessionId)
      .then(setNotes)
      .catch((e) => setError((e as Error).message));
  }, [group.id, learnerId, sessionId]);
  const blocks = (notes?.board.blocks ?? []).filter((b) => isBlockEvent(b as BlockEvent) && !(b as { erased?: boolean }).erased).map((b) => toBlock(b as BlockEvent, true));
  return (
    <Shell onBack={onBack} title={notes ? notes.topic : "Notes"}>
      {notes && (
        <p className="group-note">
          {name}'s board · {day(notes.lastActive)} · what the tutor wrote. Their own handwriting and photos stay on their device.
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="group-notes" style={{ ["--s" as string]: 1 }}>
        {blocks.map((b) => (
          <div key={b.id} className={`tblock tblock-${b.kind}${b.kind === "write" ? ` tblock-${b.style}` : ""} group-note-block`}>
            <BlockBody block={b} shown={99} width={620} currentSection={null} sessionCode={`group-${sessionId}`} />
          </div>
        ))}
        {notes && !blocks.length && <p className="group-note">Nothing on this board yet.</p>}
      </div>
      <button className="link-button" onClick={onBack}>
        <ArrowLeft /> Back to {name}
      </button>
    </Shell>
  );
}
