// One open learning session: the full-screen board, the voice class (Start / Pause / Resume),
// push-to-talk, Done submissions, uploads and settings. Mounted fresh for each session (keyed by
// id), so nothing from another session can survive into it; leaving stops the call and closes the
// socket before anything else is shown.

import { useCallback, useEffect, useRef, useState } from "react";
import { greetingFor, LANGUAGE_NAMES, type BoardEvent, type DocMeta } from "../../../shared/types";
import { putDoc, sessionDocs } from "../lib/docStore";
import { prepareFile } from "../lib/files";
import { getSession, isDev, loadData, saveData, updateSession, type Speed } from "../lib/session";
import { useBoardSocket } from "../lib/useBoardSocket";
import { useMicLevel } from "../lib/useMicLevel";
import { useVoiceCall } from "../lib/useVoiceCall";
import { Board, type BoardStatus, type Highlight, type Submission, type TutorBlock } from "./Board";
import { DevPanel } from "./DevPanel";
import { VoiceOrb, type VoiceState } from "./VoiceOrb";

function toBlock(e: BoardEvent, instant: boolean): TutorBlock | null {
  switch (e.type) {
    case "write":
      return { kind: "write", id: e.id, label: e.label, style: e.style, lines: e.lines, place: e.place, replaces: e.replaces, instant };
    case "draw":
      return { kind: "draw", id: e.id, label: e.label, diagram: e.diagram, caption: e.caption, place: e.place, replaces: e.replaces, instant };
    case "steps":
      return { kind: "steps", id: e.id, label: e.label, title: e.title, steps: e.steps, section: e.section, instant };
    case "problem":
      return { kind: "problem", id: e.id, label: e.label, problem: e.problem, instant };
    case "plan":
      return { kind: "plan", id: e.id, label: e.label, title: e.title, items: e.items, instant };
    case "page":
      return { kind: "page", id: e.id, instant };
    case "source":
      return { kind: "source", id: e.id, label: e.label, docId: e.docId, docName: e.docName, page: e.page, caption: e.caption, instant };
    default:
      return null;
  }
}

const SPEEDS: Speed[] = ["slower", "normal", "faster"];
const SPEED_LABEL: Record<Speed, string> = { slower: "0.95×", normal: "1.1×", faster: "1.3×" };

export function Classroom({ sessionId, onHome }: { sessionId: string; onHome: () => void }) {
  const meta = getSession(sessionId)!;
  const initial = useRef(loadData(sessionId)).current;

  const [blocks, setBlocks] = useState<TutorBlock[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [erased, setErased] = useState<string[]>([]);
  const [currentSection, setCurrentSection] = useState<number | null>(null);
  const [mark, setMark] = useState<{ captureId: string; line: number; note: string } | null>(null);
  const [correctCapture, setCorrectCapture] = useState<string | null>(null);
  const [status, setStatus] = useState<BoardStatus>("idle");
  const [captureTick, setCaptureTick] = useState(0);
  const [holdTick, setHoldTick] = useState(0);
  const [resumeTick, setResumeTick] = useState(0);
  const [submission, setSubmission] = useState<Submission>({ captureId: null, state: "idle" });
  const [toast, setToast] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocMeta[]>(initial.docs);
  const [speed, setSpeed] = useState<Speed>(initial.speed);
  const [handsFree, setHandsFree] = useState(initial.handsFree);
  const [menuOpen, setMenuOpen] = useState(false);
  const [started, setStarted] = useState(meta.started);
  const [uploading, setUploading] = useState(false);
  const events = useRef<BoardEvent[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const voice = useVoiceCall();
  const active = voice.state === "active";
  const live = voice.state === "connecting" || voice.state === "ringing" || active;
  const paused = started && !live;
  const mic = useMicLevel(active && (voice.talking || handsFree));

  const showToast = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 4500);
  }, []);
  useEffect(() => {
    if (voice.error) showToast(voice.error);
  }, [voice.error, showToast]);

  // ---------- board events for THIS session ----------
  const persist = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const remember = (e: BoardEvent) => {
    if (e.type === "checking" || e.type === "unclear" || e.type === "review") return;
    events.current.push(e);
    clearTimeout(persist.current);
    persist.current = setTimeout(() => {
      saveData(sessionId, { events: events.current.slice(-150) });
      updateSession(sessionId, {});
    }, 500);
  };

  const onEvent = useCallback(
    (e: BoardEvent, replay: boolean) => {
      remember(e);
      const block = toBlock(e, replay);
      if (block) {
        setBlocks((b) => (b.some((x) => x.id === block.id) ? b : [...b, block]));
        if (e.type === "steps" && e.section) setCurrentSection(e.section.n);
        if (e.type === "problem" || (e.type === "write" && e.style === "your_turn")) {
          setMark(null);
          setStatus("idle");
        }
        return;
      }
      switch (e.type) {
        case "highlight":
          setHighlights((h) => [...h.filter((x) => x.id !== e.id), { id: e.id, target: e.target, line: e.line, style: e.style, note: e.note }].slice(-6));
          break;
        case "erase":
          setErased((x) => [...x, e.target]);
          setHighlights((h) => h.filter((x) => x.target !== e.target));
          break;
        case "resume":
          setResumeTick((n) => n + 1);
          break;
        case "checking":
          setStatus("checking");
          setCaptureTick((n) => n + 1);
          break;
        case "mark":
          setStatus("idle");
          setMark({ captureId: e.captureId, line: e.line, note: e.note });
          break;
        case "correct":
          setStatus("correct");
          setMark(null);
          setCorrectCapture(e.captureId);
          break;
        case "unclear":
          setStatus("idle");
          if (!replay) showToast(e.note);
          break;
        case "review":
          setSubmission((cur) =>
            cur.captureId !== e.captureId
              ? cur
              : e.state === "received"
                ? { ...cur, state: "reviewing" }
                : e.state === "done"
                  ? { ...cur, state: "done", status: e.status, summary: e.summary }
                  : { ...cur, state: "failed", summary: e.summary },
          );
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast],
  );

  const onReset = useCallback(() => {
    events.current = [];
    setBlocks([]);
    setHighlights([]);
    setErased([]);
    setCurrentSection(null);
  }, []);

  // After a server restart the server has no files for this session: send back the ones kept here.
  const onDocs = useCallback(
    async (serverDocs: DocMeta[]) => {
      if (serverDocs.length) return setDocs(serverDocs);
      const local = await sessionDocs(sessionId).catch(() => []);
      if (!local.length) return;
      await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_code: sessionId, files: local.map((d) => ({ id: d.docId, name: d.name, mediaType: d.mediaType, data: d.data, pages: d.pages })) }),
      }).catch(() => {});
    },
    [sessionId],
  );

  const { connected, send } = useBoardSocket(sessionId, {
    onEvent,
    onReset,
    onDocs,
    saved: () => ({ events: initial.events, study: initial.plan?.plan ?? null }),
  });

  // Leaving this session: stop the call first.
  useEffect(() => () => void voice.stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // A call that ends on its own (silence timeout, network) leaves the class paused, not lost.
  useEffect(() => {
    if (voice.state === "ended") setHoldTick((n) => n + 1);
  }, [voice.state]);

  // Render's free plan sleeps after ~15 idle minutes; keep it awake while a lesson is open.
  useEffect(() => {
    const id = setInterval(() => void fetch("/api/health").catch(() => {}), 4 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // ---------- class controls ----------
  const userData = (resuming: boolean): Record<string, unknown> => {
    const plan = initial.plan;
    const topic = meta.topic || plan?.plan.topic || "maths";
    return {
      session_code: sessionId,
      greeting: greetingFor(meta.language, meta.studentName, plan?.plan.title || topic, resuming),
      student_name: meta.studentName,
      grade: meta.grade,
      language: meta.language,
      language_name: LANGUAGE_NAMES[meta.language],
      topic,
      speed,
      lesson_plan: plan ? plan.outline : "No prepared plan. Ask the student what they are stuck on, then teach it on the board with write and draw.",
    };
  };

  const startOrResume = () => {
    const resuming = started;
    setStarted(true);
    updateSession(sessionId, { started: true });
    setResumeTick((n) => n + 1);
    void voice.start(userData(resuming), { handsFree });
  };

  const pause = () => {
    setHoldTick((n) => n + 1);
    void voice.stop();
  };

  const stopTeacher = () => {
    setHoldTick((n) => n + 1);
    send({ kind: "interrupt", reason: "doubt" });
    voice.askDoubt();
  };

  // Push-to-talk: hold the Talk button or the Space bar.
  const talkDown = useCallback(() => {
    if (!active || handsFree) return;
    if (voice.volume > 0.03) {
      setHoldTick((n) => n + 1); // interrupting her: pause the half-written board
      send({ kind: "interrupt", reason: "speech" });
    }
    voice.talk(true);
  }, [active, handsFree, voice, send]);
  const talkUp = useCallback(() => voice.talking && voice.talk(false), [voice]);
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !typing(e.target)) {
        e.preventDefault();
        talkDown();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && !typing(e.target)) talkUp();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [talkDown, talkUp]);

  const toggleHandsFree = () => {
    const next = !handsFree;
    setHandsFree(next);
    saveData(sessionId, { handsFree: next });
    voice.setHandsFree(next);
    setMenuOpen(false);
    showToast(next ? "Hands-free on: the teacher hears everything, including room noise." : "Push-to-talk on: hold Talk (or Space) to speak.");
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    saveData(sessionId, { speed: next });
    showToast(live ? `Speed ${SPEED_LABEL[next]} applies when you Pause and Resume.` : `Teacher speed ${SPEED_LABEL[next]}`);
  };

  // ---------- Done ----------
  const submitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onDone = (captureId: string) => {
    setSubmission({ captureId, state: "submitting" });
    clearTimeout(submitTimer.current);
    submitTimer.current = setTimeout(() => {
      setSubmission((cur) => (cur.captureId === captureId && cur.state === "submitting" ? { ...cur, state: "failed", summary: "No answer from the server. Check your connection." } : cur));
    }, 6000);
    if (!connected) {
      setSubmission({ captureId, state: "failed", summary: "Not connected. Try again in a moment." });
      return;
    }
    if (active) voice.sendDone(); // the tutor looks as soon as it's read
  };

  // ---------- upload in the lesson ----------
  const upload = async (list: FileList | null) => {
    const files = Array.from(list ?? []).slice(0, 6);
    if (!files.length) return;
    setUploading(true);
    try {
      const prepared = await Promise.all(files.map(async (f) => ({ ...(await prepareFile(f)), id: crypto.randomUUID().slice(0, 8) })));
      const r = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_code: sessionId, files: prepared }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Upload failed");
      for (const f of prepared) await putDoc({ sessionId, docId: f.id, name: f.name, mediaType: f.mediaType, data: f.data, pages: f.pages });
      setDocs(data.docs);
      saveData(sessionId, { docs: data.docs });
      // Tell the tutor (keypad 4) so she can look at it; without a call it's ready for next time.
      if (active) voice.sendTones("4#");
      showToast(`Uploaded ${files.map((f) => f.name).join(", ")}. ${active ? "Your teacher can read it now." : "Your teacher will have it when the class starts."}`);
    } catch (e) {
      showToast(`Upload failed: ${(e as Error).message}. Try again.`);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  // ---------- who has the floor ----------
  const teacherSpeaking = active && voice.volume > 0.03;
  const [thinkingUntil, setThinkingUntil] = useState(0);
  useEffect(() => {
    if (!voice.talking && active) setThinkingUntil(Date.now() + 3500);
  }, [voice.talking, active]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => tick((n) => n + 1), 300);
    return () => clearInterval(id);
  }, [active]);
  const orb: VoiceState =
    voice.state === "connecting" || voice.state === "ringing"
      ? "connecting"
      : !active
        ? paused
          ? "paused"
          : "idle"
        : teacherSpeaking
          ? "teacher"
          : voice.talking || (handsFree && mic > 0.18)
            ? "student"
            : Date.now() < thinkingUntil || status === "checking" || submission.state === "reviewing"
              ? "thinking"
              : "listening";

  const classControls = (
    <>
      {active && !handsFree && (
        <button
          className="btn-talk"
          data-on={voice.talking}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            talkDown();
          }}
          onPointerUp={talkUp}
          onPointerCancel={talkUp}
          onContextMenu={(e) => e.preventDefault()}
          title="Hold to talk (or hold Space)"
        >
          🎙 {voice.talking ? "Listening…" : "Hold to talk"}
        </button>
      )}
      {active && teacherSpeaking && (
        <button className="btn-stop" onClick={stopTeacher} title="Stop the teacher and ask">
          ✋ Stop
        </button>
      )}
      <button onClick={() => fileInput.current?.click()} disabled={uploading} aria-label="Upload material" title="Upload a PDF or photos of your book or notes">
        {uploading ? <span className="spin" /> : <UploadIcon />}
      </button>
      <button className="btn-speed" onClick={cycleSpeed} title="Teacher's speaking speed">
        {SPEED_LABEL[speed]}
      </button>
      {live ? (
        <button className="btn-pause" onClick={pause} title="Pause the class (the board stays as it is)">
          {voice.state === "active" ? "⏸ Pause" : "Connecting…"}
        </button>
      ) : (
        <button className="btn-start" onClick={startOrResume} title={started ? "Resume the class" : "Start the class"}>
          ▶ {started ? "Resume" : "Start"}
        </button>
      )}
    </>
  );

  return (
    <div className="classroom">
      <Board
        sessionCode={sessionId}
        blocks={blocks}
        highlights={highlights}
        erased={erased}
        currentSection={currentSection}
        mark={mark}
        correctCapture={correctCapture}
        status={status}
        captureTick={captureTick}
        callActive={active}
        teacherSpeaking={teacherSpeaking}
        holdTick={holdTick}
        resumeTick={resumeTick}
        paused={paused}
        submission={submission}
        send={send}
        onDone={onDone}
        toolbarExtra={classControls}
      />

      <div className="session-menu">
        <button className="menu-button" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label="Session menu">
          <span className="dot" data-on={connected} /> {meta.name}
        </button>
        {menuOpen && (
          <div className="menu" role="menu">
            <button role="menuitem" onClick={onHome}>
              ← All sessions
            </button>
            <button
              role="menuitem"
              onClick={() => {
                const name = window.prompt("Rename this session", meta.name)?.trim();
                if (name) updateSession(sessionId, { name });
                setMenuOpen(false);
              }}
            >
              Rename
            </button>
            <button role="menuitem" onClick={toggleHandsFree}>
              {handsFree ? "Use push-to-talk" : "Hands-free (always listening)"}
            </button>
            <div className="menu-docs">
              {docs.length ? `Material: ${docs.map((d) => d.name).join(", ")}` : "No material uploaded yet"}
            </div>
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                if (window.confirm("End this class? The board is saved and you can resume it from All sessions.")) {
                  void voice.stop();
                  onHome();
                }
              }}
            >
              End session
            </button>
          </div>
        )}
      </div>
      <VoiceOrb state={orb} level={orb === "teacher" ? Math.min(1, voice.volume * 3) : orb === "student" ? mic : 0} />

      <input ref={fileInput} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => void upload(e.target.files)} />
      {toast && <div className="toast" role="status">{toast}</div>}
      {isDev && <DevPanel sessionCode={sessionId} />}
    </div>
  );
}

const UploadIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 16V4" />
    <path d="m6 10 6-6 6 6" />
    <path d="M4 20h16" />
  </svg>
);
