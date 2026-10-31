// One open learning session: the full-screen board, the voice class (Start / Pause / Resume),
// push-to-talk, Done submissions, uploads and settings. Mounted fresh for each session (keyed by
// id), so nothing from another session can survive into it; leaving stops the call and closes the
// socket before anything else is shown.
//
// The board is one snapshot (shared/boardState.ts). The server sends it whole on connect and then
// numbered events; this device keeps a copy, saved promptly and flushed whenever the page is
// hidden or the class is left, so a reload or a server restart restores exactly what was there.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applySeq } from "../../../shared/boardState";
import { LANGUAGE_STATUS, type BlockEvent, type BoardEvent, type BoardSnapshot, type DocMeta, type Signal } from "../../../shared/types";
import { apiFetch } from "../lib/api";
import { putDoc, sessionDocs } from "../lib/docStore";
import { prepareFile } from "../lib/files";
import { ensureServerSession, getSession, isDev, loadData, onStorageFailure, saveData, updateSession, type Speed } from "../lib/session";
import { useBoardSocket } from "../lib/useBoardSocket";
import { useMicLevel } from "../lib/useMicLevel";
import { useVoiceCall } from "../lib/useVoiceCall";
import { Board, type BoardStatus, type Submission, type TutorBlock } from "./Board";
import { DevPanel } from "./DevPanel";
import { talkKey, talkKeyHint } from "../lib/pushToTalk";
import { QuestionBar, QuickCheck } from "./ClassTools";
import { CLASS_TOUR, Tour, tourDue } from "./Tour";
import { ReportCard } from "./ReportCard";
import { VoiceOrb, type VoiceState } from "./VoiceOrb";
import { ArrowLeft, Camera, ChartBar, DownloadSimple, Notebook, Plus, FileText, Scan, Signpost, HandPalm, List, Microphone, MicrophoneSlash, Pause, PencilSimpleLine, Play, Question, SignOut, UploadSimple } from "@phosphor-icons/react";

function toBlock(e: BlockEvent & { erased?: boolean }, instant: boolean): TutorBlock {
  switch (e.type) {
    case "write":
      return { kind: "write", id: e.id, label: e.label, style: e.style, lines: e.lines, place: e.place, replaces: e.replaces, instant };
    case "draw":
      return { kind: "draw", id: e.id, label: e.label, diagram: e.diagram, caption: e.caption, place: e.place, replaces: e.replaces, instant };
    case "steps":
      return { kind: "steps", id: e.id, label: e.label, title: e.title, steps: e.steps, section: e.section, checked: e.checked, instant };
    case "problem":
      return { kind: "problem", id: e.id, label: e.label, problem: e.problem, questionKind: e.kind, instant };
    case "plan":
      return { kind: "plan", id: e.id, label: e.label, title: e.title, items: e.items, instant };
    case "page":
      return { kind: "page", id: e.id, instant };
    case "source":
      return { kind: "source", id: e.id, label: e.label, docId: e.docId, docName: e.docName, page: e.page, caption: e.caption, photo: e.photo, instant };
    case "hint":
      return { kind: "hint", id: e.id, label: e.label, level: e.level, rung: e.rung, of: e.of, text: e.text, instant };
    case "fix":
      return { kind: "fix", id: e.id, label: e.label, photoLabel: e.photoLabel, docId: e.docId, questions: e.questions, simulated: e.simulated, instant };
  }
}

const SPEEDS: Speed[] = ["slower", "normal", "faster"];
const SPEED_LABEL: Record<Speed, string> = { slower: "0.95×", normal: "1.1×", faster: "1.3×" };

export function Classroom({ sessionId, onHome }: { sessionId: string; onHome: () => void }) {
  const meta = getSession(sessionId)!;
  const initial = useRef(loadData(sessionId)).current;

  const [serverId, setServerId] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<BoardSnapshot>(initial.snapshot);
  const snapRef = useRef(snapshot);
  const liveIds = useRef(new Set<string>());
  const [status, setStatus] = useState<BoardStatus>("idle");
  const [captureRequest, setCaptureRequest] = useState<{ id: string; n: number } | null>(null);
  const [holdTick, setHoldTick] = useState(0);
  const [resumeTick, setResumeTick] = useState(0);
  const [submission, setSubmission] = useState<Submission>({ captureId: null, state: "idle" });
  const [toast, setToast] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocMeta[]>(initial.docs);
  const [speed, setSpeed] = useState<Speed>(initial.speed);
  const [handsFree, setHandsFree] = useState(initial.handsFree);
  const [menuOpen, setMenuOpen] = useState(false);
  // The first class on this device starts with a guided tour of the board.
  const [touring, setTouring] = useState(false);
  useEffect(() => {
    if (!serverId || !tourDue("class")) return;
    const t = setTimeout(() => setTouring(true), 900);
    return () => clearTimeout(t);
  }, [serverId]);
  /** The student stopped the teacher to ask something; over when she carries on (continue_lesson). */
  const [doubt, setDoubt] = useState(false);
  const [started, setStarted] = useState(meta.started);
  const [uploading, setUploading] = useState(false);
  const [showReport, setShowReport] = useState<"view" | "end" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const voice = useVoiceCall(serverId);
  const active = voice.state === "active";
  const live = voice.state === "connecting" || voice.state === "ringing" || active;
  const paused = started && !live;
  const mic = useMicLevel(active && (voice.talking || handsFree));

  const showToast = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), 4500);
  }, []);
  useEffect(() => {
    if (voice.error) showToast(voice.error);
  }, [voice.error, showToast]);
  useEffect(() => onStorageFailure(() => showToast("This device can't save the board (storage is full or blocked). The class still works, but won't be kept after you leave.")), [showToast]);

  // ---------- the session on the server ----------
  useEffect(() => {
    let cancelled = false;
    ensureServerSession(meta)
      .then((r) => {
        if (cancelled) return;
        setServerId(r.serverId);
        if (r.plan) saveData(sessionId, { plan: r.plan });
      })
      .catch((err) => !cancelled && setSetupError((err as Error).message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ---------- saving the board on this device ----------
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  const flush = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (!dirty.current) return;
    dirty.current = false;
    saveData(sessionId, { snapshot: snapRef.current });
    updateSession(sessionId, {});
  }, [sessionId]);
  const setBoard = useCallback(
    (next: BoardSnapshot) => {
      snapRef.current = next;
      setSnapshot(next);
      dirty.current = true;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, 300);
    },
    [flush],
  );
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      flush(); // leaving the class
    };
  }, [flush]);

  // ---------- board messages for THIS session ----------
  const onSnapshot = useCallback(
    (snap: BoardSnapshot) => {
      setBoard(snap);
      setStatus(snap.correct ? "correct" : "idle");
    },
    [setBoard],
  );

  const onEvent = useCallback(
    (seq: number, e: BoardEvent): "ok" | "dup" | "gap" => {
      const next = applySeq(snapRef.current, seq, e);
      if (next === "dup" || next === "gap") return next;
      if ("id" in e && (e.type === "write" || e.type === "draw" || e.type === "steps" || e.type === "problem" || e.type === "plan" || e.type === "page" || e.type === "source" || e.type === "hint" || e.type === "fix")) liveIds.current.add(e.id);
      if (e.type === "problem" || (e.type === "write" && e.style === "your_turn")) setStatus("idle");
      if (e.type === "mark") setStatus("idle");
      if (e.type === "correct") setStatus("correct");
      if (e.type === "resume") {
        setResumeTick((n) => n + 1);
        setDoubt(false);
      }
      // A new question: the last one's feedback card is done with.
      if (e.type === "problem" || (e.type === "write" && e.style === "your_turn")) setSubmission((cur) => (cur.state === "done" || cur.state === "stale" || cur.state === "failed" ? { captureId: null, state: "idle" } : cur));
      setBoard(next);
      return "ok";
    },
    [setBoard],
  );

  const onSignal = useCallback(
    (sig: Signal) => {
      switch (sig.type) {
        case "checking":
          setStatus("checking");
          setCaptureRequest((r) => ({ id: sig.requestId, n: (r?.n ?? 0) + 1 }));
          break;
        case "unclear":
          setStatus("idle");
          showToast(sig.note);
          break;
        case "review":
          setSubmission((cur) =>
            cur.captureId !== sig.captureId
              ? cur
              : sig.state === "received"
                ? { ...cur, state: "reviewing" }
                : sig.state === "done"
                  ? { ...cur, state: "done", status: sig.status, summary: sig.summary, marks: sig.marks }
                  : sig.state === "stale"
                    ? { ...cur, state: "stale", summary: sig.summary }
                    : { ...cur, state: "failed", summary: sig.summary },
          );
          if (sig.state === "done" || sig.state === "failed" || sig.state === "stale") setStatus((st) => (st === "checking" ? "idle" : st));
          break;
      }
    },
    [showToast],
  );

  // After a server restart the server has no files for this session: send back the ones kept here.
  const onDocs = useCallback(
    async (serverDocs: DocMeta[]) => {
      if (serverDocs.length) return setDocs(serverDocs);
      if (!serverId) return;
      const local = await sessionDocs(sessionId).catch(() => []);
      if (!local.length) return;
      await apiFetch(`/sessions/${serverId}/documents`, {
        body: { files: local.map((d) => ({ id: d.docId, name: d.name, mediaType: d.mediaType, data: d.data, pages: d.pages })) },
      }).catch(() => {});
    },
    [sessionId, serverId],
  );

  const { connected, send } = useBoardSocket(serverId, {
    snapshot: () => snapRef.current,
    onSnapshot,
    onEvent,
    onSignal,
    onDocs,
    onGone: () => setSetupError("This class was deleted on the server."),
  });

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
  const startOrResume = () => {
    if (!serverId) return;
    setResumeTick((n) => n + 1);
    void voice.start({ speed, resuming: started, handsFree });
  };

  // The class counts as started once a call is actually connected ("connecting" can still fail). If Start fails (voice not set up, no
  // network), the button stays "Start" instead of claiming a paused class that never began.
  useEffect(() => {
    if (!active || started) return;
    setStarted(true);
    updateSession(sessionId, { started: true });
  }, [active, started, sessionId]);

  const pause = () => {
    setHoldTick((n) => n + 1);
    voice.stop();
  };

  const stopTeacher = () => {
    setHoldTick((n) => n + 1);
    setDoubt(true);
    send({ kind: "interrupt", reason: "doubt" });
    voice.askDoubt();
  };

  // Push-to-talk: hold the Talk button, Space or Caps Lock (see pushToTalk.ts). Released on key up, pointer up/cancel,
  // and whenever the window loses focus or the page is hidden (no stuck open mic).
  const talkDown = useCallback(() => {
    if (!active || handsFree) return;
    if (voice.volume > 0.03) {
      setHoldTick((n) => n + 1); // interrupting her: pause the half-written board
      setDoubt(true);
      send({ kind: "interrupt", reason: "speech" });
    }
    voice.talk(true);
  }, [active, handsFree, voice, send]);
  const talkUp = useCallback(() => voice.isTalking() && voice.talk(false), [voice]);
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (talkKey("keydown", e, typing(e.target)) !== "down") return;
      if (e.code === "Space") e.preventDefault();
      talkDown();
    };
    const up = (e: KeyboardEvent) => {
      if (talkKey("keyup", e, typing(e.target)) === "up") talkUp();
    };
    const lost = () => talkUp();
    const hidden = () => document.visibilityState === "hidden" && talkUp();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", lost);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", lost);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [talkDown, talkUp]);
  // Leaving a live call (Pause, call end) always closes the mic.
  useEffect(() => {
    if (!active) {
      talkUp();
      setDoubt(false);
    }
  }, [active, talkUp]);

  const toggleHandsFree = () => {
    const next = !handsFree;
    setHandsFree(next);
    saveData(sessionId, { handsFree: next });
    voice.setHandsFree(next);
    setMenuOpen(false);
    showToast(next ? "Hands-free on: the teacher hears everything, including room noise." : `Push-to-talk on: hold Talk, or ${talkKeyHint()}.`);
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    saveData(sessionId, { speed: next });
    showToast(live ? `Speed ${SPEED_LABEL[next]} applies when you Pause and Resume.` : `Teacher speed ${SPEED_LABEL[next]}`);
  };

  // ---------- Done ----------
  const submitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(submitTimer.current), []);
  const onDone = (captureId: string) => {
    clearTimeout(submitTimer.current);
    if (!connected) {
      setSubmission({ captureId, state: "failed", summary: "Not connected. Try again in a moment." });
      return;
    }
    setSubmission({ captureId, state: "submitting" });
    submitTimer.current = setTimeout(() => {
      setSubmission((cur) => (cur.captureId === captureId && cur.state === "submitting" ? { ...cur, state: "failed", summary: "No answer from the server. Check your connection." } : cur));
    }, 8000);
    if (active) voice.sendDone(); // the tutor looks as soon as it's read
  };

  // ---------- upload in the lesson ----------
  const upload = async (list: FileList | null) => {
    const files = Array.from(list ?? []).slice(0, 6);
    if (!files.length || !serverId) return;
    setUploading(true);
    try {
      const prepared = await Promise.all(files.map(async (f) => ({ ...(await prepareFile(f)), id: crypto.randomUUID().slice(0, 8) })));
      const data = await apiFetch<{ docs: DocMeta[] }>(`/sessions/${serverId}/documents`, { body: { files: prepared } });
      for (const f of prepared) await putDoc({ sessionId, docId: f.id, name: f.name, mediaType: f.mediaType, data: f.data, pages: f.pages });
      setDocs(data.docs);
      saveData(sessionId, { docs: data.docs });
      // Tell the tutor (keypad 4) so she can look at it; without a call it's ready for next time.
      if (active) voice.sendTones("4#");
      showToast(`Uploaded ${files.map((f) => f.name).join(", ")}. ${active ? "Your teacher can read it now." : "Your teacher will have it when the class starts."}`);
    } catch (e) {
      showToast(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  // ---------- paper mode: photos from the notebook ----------
  // For students without a stylus: send a photo of your working (pinned on the board and checked like
  // Done), or of a question (copied out and put on the board).
  const workInput = useRef<HTMLInputElement>(null);
  const [paperOpen, setPaperOpen] = useState(false);
  useEffect(() => {
    if (!paperOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element | null)?.closest(".dock-attach, .paper-pop")) setPaperOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [paperOpen]);
  const sendWork = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file || !serverId) return;
    const captureId = crypto.randomUUID();
    clearTimeout(submitTimer.current);
    setSubmission({ captureId, state: "submitting" });
    try {
      const prepared = { ...(await prepareFile(file)), id: `paper-${crypto.randomUUID().slice(0, 8)}` };
      // Saved on this device first, so the photo shows on the board as soon as the server pins it.
      await putDoc({ sessionId, docId: prepared.id, name: "Your working", mediaType: prepared.mediaType, data: prepared.data, pages: prepared.pages });
      const r = await apiFetch<{ docs: DocMeta[] }>(`/sessions/${serverId}/paper`, { body: { file: prepared, captureId } });
      setDocs(r.docs);
      saveData(sessionId, { docs: r.docs });
      if (active) voice.sendDone(); // the tutor looks at it, as after Done
    } catch (e) {
      setSubmission((cur) => (cur.captureId === captureId ? { ...cur, state: "failed", summary: (e as Error).message } : cur));
    } finally {
      if (workInput.current) workInput.current.value = "";
    }
  };

  const scanInput = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const scan = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file || !serverId) return;
    setScanning(true);
    try {
      const prepared = { ...(await prepareFile(file)), id: `paper-${crypto.randomUUID().slice(0, 8)}` };
      await putDoc({ sessionId, docId: prepared.id, name: "Question from your notebook", mediaType: prepared.mediaType, data: prepared.data, pages: prepared.pages });
      const r = await apiFetch<{ questions: string[]; placed: string | null; note: string; checked: boolean; docs: DocMeta[] }>(`/sessions/${serverId}/scan`, { body: { file: prepared } });
      setDocs(r.docs);
      saveData(sessionId, { docs: r.docs });
      // Tell the tutor (keypad 4, as for any upload): she reads the photo and can help with it.
      if (active) voice.sendTones("4#");
      if (!r.placed) showToast(r.note || "Couldn't find a question in that photo. Try a closer, brighter photo.");
      else
        showToast(
          `${r.questions.length > 1 ? `Found ${r.questions.length} questions; the first is` : "Your question is"} on the board.${r.checked ? "" : " (Not one the maths engine can check.)"}${active ? " Your teacher can see it." : ""}`,
        );
    } catch (e) {
      showToast(`Couldn't scan it: ${(e as Error).message}`);
    } finally {
      setScanning(false);
      if (scanInput.current) scanInput.current.value = "";
    }
  };

  // ---------- "Fix it" on a photo ----------
  const [fixing, setFixing] = useState<string | null>(null);
  const fixPhoto = async (label: string, docId: string, image: string | null) => {
    if (!serverId || fixing) return;
    setFixing(label);
    try {
      const r = await apiFetch<{ note: string; questions: { status: string }[] }>(`/sessions/${serverId}/fix`, { body: { label, docId, image } });
      const wrong = r.questions.filter((q) => q.status === "mistake").length;
      showToast(r.note || (wrong ? "I marked the slips on your photo and wrote out the answer below it." : "Your working looks right. The full answer is below it."));
    } catch (e) {
      showToast(`Couldn't fix it: ${(e as Error).message}`);
    } finally {
      setFixing(null);
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
  // Which moment of the class this is, so the student always knows what's happening.
  const questionOpen = Boolean(snapshot.question && snapshot.correct?.questionId !== snapshot.question.id);
  const moment =
    status === "checking" || submission.state === "submitting" || submission.state === "reviewing"
      ? { key: "checking", label: "Checking your work" }
      : doubt && active
        ? { key: "doubt", label: "Your doubt" }
        : questionOpen
          ? { key: "turn", label: "Your turn" }
          : active
            ? { key: "teaching", label: "Teaching" }
            : null;
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

  // ---------- what the board shows ----------
  const blocks = useMemo(() => snapshot.blocks.map((b) => toBlock(b, !liveIds.current.has(b.id))), [snapshot.blocks]);
  const erased = useMemo(() => snapshot.blocks.filter((b) => b.erased && "label" in b && b.label).map((b) => (b as { label: string }).label), [snapshot.blocks]);

  // ---------- the bottom bar ----------
  const dockLeft = live ? (
    <button className="btn-pause dock-round" onClick={pause} aria-label={voice.state === "active" ? "Pause the class" : "Connecting"} title="Pause the class (the board stays as it is)">
      {voice.state === "active" ? <Pause weight="fill" /> : <span className="spin" />}
    </button>
  ) : (
    <button className="btn-start dock-round" onClick={startOrResume} disabled={!serverId} aria-label={started ? "Resume" : "Start"} title={started ? "Resume the class" : "Start the class"}>
      <Play weight="fill" />
    </button>
  );
  const dockAttach = (
    <button
      type="button"
      className="dock-attach"
      onClick={() => setPaperOpen((o) => !o)}
      disabled={scanning || uploading || !serverId}
      aria-label="Add from paper or a book"
      aria-haspopup="menu"
      aria-expanded={paperOpen}
      title="A photo of your working or a question, or your book"
    >
      {scanning || uploading ? <span className="spin" /> : <Plus weight="bold" />}
    </button>
  );
  const dockRight = (
    <>
      {active && teacherSpeaking && (
        <button className="btn-stop" onClick={stopTeacher} title="Stop the teacher and ask">
          <HandPalm /> Stop
        </button>
      )}
      {active && !handsFree ? (
        <button
          className="btn-talk dock-round"
          data-on={voice.talking}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            talkDown();
          }}
          onPointerUp={talkUp}
          onPointerCancel={talkUp}
          onLostPointerCapture={talkUp}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={voice.talking ? "Listening" : "Hold to talk"}
          title={`Hold to talk (or ${talkKeyHint()})`}
        >
          <Microphone weight={voice.talking ? "fill" : "bold"} />
        </button>
      ) : (
        <button
          className="btn-mic dock-round"
          data-live={active}
          onClick={active ? undefined : startOrResume}
          disabled={!serverId || (live && !active)}
          aria-label={active ? "Listening all the time" : "Start talking"}
          title={active ? "Hands-free: I'm always listening" : "Start the class and talk"}
        >
          {active ? <Microphone weight="fill" /> : <MicrophoneSlash weight="bold" />}
        </button>
      )}
    </>
  );

  // ---------- notes as a PDF ----------
  const [printTick, setPrintTick] = useState(0);
  const downloadNotes = () => {
    const title = document.title;
    const day = new Date().toISOString().slice(0, 10);
    document.title = `Shikshak notes - ${meta.name} - ${day}`; // the PDF's file name
    window.addEventListener("afterprint", () => (document.title = title), { once: true });
    setPrintTick((n) => n + 1);
  };

  return (
    <div className="classroom">
      <Board
        sessionCode={sessionId}
        blocks={blocks}
        highlights={snapshot.highlights}
        erased={erased}
        currentSection={snapshot.section}
        mark={snapshot.mark}
        correct={snapshot.correct}
        questionId={snapshot.question?.id ?? null}
        status={status}
        captureRequest={captureRequest}
        callActive={active}
        teacherSpeaking={teacherSpeaking}
        holdTick={holdTick}
        resumeTick={resumeTick}
        paused={paused}
        submission={submission}
        send={send}
        onDone={onDone}
        dockLeft={dockLeft}
        dockAttach={dockAttach}
        dockRight={dockRight}
        printTick={printTick}
        onFix={fixPhoto}
        fixing={fixing}
      />

      <div className="session-menu">
        {moment && (
          <span className="moment-chip" data-moment={moment.key} role="status" aria-live="polite">
            {moment.label}
          </span>
        )}
        <button className="menu-button" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label="Session menu">
          <List className="menu-icon" />
          <span className="menu-name">{meta.name}</span>
          {serverId && !connected && <span className="offline">offline</span>}
          {LANGUAGE_STATUS[meta.language] === "preview" && <span className="offline">preview language</span>}
        </button>
        {menuOpen && (
          <div className="menu" role="menu">
            <button role="menuitem" onClick={onHome}>
              <ArrowLeft /> All sessions
            </button>
            <button
              role="menuitem"
              onClick={() => {
                const name = window.prompt("Rename this session", meta.name)?.trim();
                if (name) {
                  updateSession(sessionId, { name });
                  if (serverId) void apiFetch(`/sessions/${serverId}`, { method: "PATCH", body: { label: name } }).catch(() => {});
                }
                setMenuOpen(false);
              }}
            >
              <PencilSimpleLine /> Rename
            </button>
            <button role="menuitem" onClick={toggleHandsFree}>
              {handsFree ? <MicrophoneSlash /> : <Microphone />} {handsFree ? "Use push-to-talk" : "Hands-free (always listening)"}
            </button>
            <button
              role="menuitem"
              disabled={!serverId}
              onClick={async () => {
                setMenuOpen(false);
                try {
                  await apiFetch(`/sessions/${serverId}/practice`, { body: {} });
                } catch (e) {
                  showToast((e as Error).message);
                }
              }}
            >
              <Question /> Give me a practice question
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setTouring(true);
              }}
            >
              <Signpost /> Show me around
            </button>
            <button
              role="menuitem"
              disabled={!serverId}
              onClick={() => {
                setMenuOpen(false);
                setShowReport("view");
              }}
            >
              <ChartBar /> Class report
            </button>
            <div className="menu-docs">
              <FileText />
              <span>{docs.length ? docs.map((d) => d.name).join(", ") : "No books or notes yet"}</span>
            </div>
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                if (window.confirm("End this class? The board is saved and you can resume it from All sessions.")) {
                  voice.stop();
                  setMenuOpen(false);
                  if (serverId) setShowReport("end");
                  else onHome();
                }
              }}
            >
              <SignOut /> End session
            </button>
          </div>
        )}
      </div>
      <div className="class-pill" role="toolbar" aria-label="Class">
        <button onClick={() => setShowReport("view")} disabled={!serverId} aria-label="Class report" title="Class report">
          <Notebook weight="bold" />
        </button>
        <button className="btn-speed" onClick={cycleSpeed} title="Teacher's speaking speed" aria-label={`Speaking speed ${SPEED_LABEL[speed]}`}>
          {SPEED_LABEL[speed]}
        </button>
        <span className="class-pill-sep" aria-hidden="true" />
        <button onClick={downloadNotes} aria-label="Download notes as PDF" title="Download this whole class as PDF notes">
          <DownloadSimple weight="bold" />
        </button>
      </div>
      <VoiceOrb state={orb} level={orb === "teacher" ? Math.min(1, voice.volume * 3) : orb === "student" ? mic : 0} />

      <input ref={fileInput} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => void upload(e.target.files)} />
      <input ref={scanInput} type="file" accept="image/*" capture="environment" hidden data-paper="question" onChange={(e) => void scan(e.target.files)} />
      <input ref={workInput} type="file" accept="image/*" capture="environment" hidden data-paper="work" onChange={(e) => void sendWork(e.target.files)} />
    {paperOpen && (
      <div className="menu paper-pop" role="menu">
        <p className="paper-pop-title">Add to the class</p>
        <button
          role="menuitem"
          onClick={() => {
            setPaperOpen(false);
            workInput.current?.click();
          }}
        >
          <Camera /> <span><strong>Send my working</strong><small>A photo of your steps. Your teacher checks it like Done.</small></span>
        </button>
        <button
          role="menuitem"
          onClick={() => {
            setPaperOpen(false);
            scanInput.current?.click();
          }}
        >
          <Scan /> <span><strong>Add a question</strong><small>A photo of a question from your book or notebook.</small></span>
        </button>
        <button
          role="menuitem"
          onClick={() => {
            setPaperOpen(false);
            fileInput.current?.click();
          }}
        >
          <UploadSimple /> <span><strong>Upload my book or notes</strong><small>A PDF or photos. I teach from your own pages.</small></span>
        </button>
      </div>
    )}
      {setupError && (
        <div className="toast" role="alert">
          {setupError}
        </div>
      )}
      {toast && !setupError && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {serverId && <QuestionBar serverId={serverId} snapshot={snapshot} onToast={showToast} />}
      {touring && <Tour name="class" steps={CLASS_TOUR} onClose={() => setTouring(false)} />}
      {serverId && <QuickCheck serverId={serverId} snapshot={snapshot} onToast={showToast} />}
      {showReport && serverId && (
        <ReportCard
          serverId={serverId}
          onClose={() => {
            const ending = showReport === "end";
            setShowReport(null);
            if (ending) onHome();
          }}
        />
      )}
      {isDev && serverId && <DevPanel sessionId={serverId} />}
    </div>
  );
}

