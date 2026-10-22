import { useCallback, useEffect, useRef, useState } from "react";
import { greetingFor, LANGUAGE_NAMES, type BoardEvent } from "../../shared/types";
import { Board, type BoardStatus, type Highlight, type TutorBlock } from "./components/Board";
import { DevPanel } from "./components/DevPanel";
import { PhoneFallback } from "./components/PhoneFallback";
import { Setup, type StudentSetup } from "./components/Setup";
import { VoiceOrb, type VoiceState } from "./components/VoiceOrb";
import { getSessionCode, isDev } from "./lib/session";
import { useBoardSocket } from "./lib/useBoardSocket";
import { useMicLevel } from "./lib/useMicLevel";
import { useVoiceCall } from "./lib/useVoiceCall";

const sessionCode = getSessionCode();

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
    default:
      return null;
  }
}

/** Who has the floor, from the tutor's audio level and the student's mic level. */
function useFloor(callState: string, teacherLevel: number, micLevel: number, busy: boolean) {
  const [now, setNow] = useState(Date.now());
  const t = useRef({ teacherAt: 0, studentAt: 0, studentStart: 0, studentEnd: 0, overlap: false });
  const active = callState === "active";
  const time = Date.now();
  if (active && teacherLevel > 0.03) t.current.teacherAt = time;
  const teacherSpeaking = active && time - t.current.teacherAt < 350;
  const studentNow = active && micLevel > 0.18 && !teacherSpeaking;
  if (studentNow) {
    if (time - t.current.studentAt > 600) {
      t.current.studentStart = time;
      // Did they start while the tutor was still talking? That's talking over her.
      t.current.overlap = time - t.current.teacherAt < 700;
    }
    t.current.studentAt = time;
  } else if (t.current.studentAt && time - t.current.studentAt > 600 && t.current.studentEnd < t.current.studentAt) {
    t.current.studentEnd = t.current.studentAt;
  }
  const studentSpeaking = active && time - t.current.studentAt < 600;
  const thinking = active && !teacherSpeaking && !studentSpeaking && (busy || (t.current.studentEnd > 0 && time - t.current.studentEnd < 4000));

  // Keep re-evaluating while in a call (levels may stop changing during silence).
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);
  void now;

  const state: VoiceState =
    callState === "connecting" || callState === "ringing"
      ? "connecting"
      : !active
        ? "idle"
        : teacherSpeaking
          ? "teacher"
          : studentSpeaking
            ? "student"
            : thinking
              ? "thinking"
              : "listening";
  const talkOverFor = studentSpeaking && t.current.overlap ? time - t.current.studentStart : 0;
  return { state, teacherSpeaking, studentSpeaking, talkOverFor };
}

export function App() {
  const [student, setStudent] = useState<StudentSetup | null>(null);
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
  const [toast, setToast] = useState<string | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [busyUntil, setBusyUntil] = useState(0);
  const voice = useVoiceCall();
  const mic = useMicLevel(voice.state === "active");

  const showToast = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 4500);
  }, []);
  useEffect(() => {
    if (voice.error) showToast(voice.error);
  }, [voice.error, showToast]);

  const onEvent = useCallback((e: BoardEvent, replay: boolean) => {
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
    }
  }, [showToast]);

  const onReset = useCallback(() => {
    setBlocks([]);
    setHighlights([]);
    setErased([]);
    setCurrentSection(null);
  }, []);

  const { connected, send } = useBoardSocket(sessionCode, onEvent, onReset);
  const floor = useFloor(voice.state, voice.volume, mic, status === "checking" || Date.now() < busyUntil);

  // Talking over the tutor for a moment counts as an interruption: pause the half-written board.
  const interrupted = useRef(false);
  useEffect(() => {
    if (floor.talkOverFor > 1000 && !interrupted.current) {
      interrupted.current = true;
      setHoldTick((n) => n + 1);
      send({ kind: "interrupt", reason: "speech" });
    }
    if (!floor.studentSpeaking) interrupted.current = false;
  }, [floor.talkOverFor, floor.studentSpeaking, send]);

  // Render's free plan sleeps after ~15 idle minutes. While a class is open, ping the server
  // so it stays awake and the tutor's board actions don't hit a cold start mid-call.
  useEffect(() => {
    if (!student) return;
    const id = setInterval(() => void fetch("/api/health").catch(() => {}), 4 * 60 * 1000);
    return () => clearInterval(id);
  }, [student]);

  const buildUserData = (s: StudentSetup): Record<string, unknown> => {
    const topic = s.topic || s.plan?.plan.topic || "maths";
    return {
      session_code: sessionCode,
      greeting: greetingFor(s.language, s.name, s.plan?.plan.title || topic),
      student_name: s.name,
      grade: s.grade,
      language: s.language,
      language_name: LANGUAGE_NAMES[s.language],
      topic,
      lesson_plan: s.plan
        ? s.plan.outline
        : "No prepared plan. Ask the student what they are stuck on, then teach it on the board with write and draw.",
    };
  };

  const startCall = (s: StudentSetup) => voice.start(buildUserData(s));

  const onDone = () => {
    setBusyUntil(Date.now() + 4000);
    if (voice.state !== "active") return;
    // The tutor gets a keypad signal and looks at the board. If the tones can't be sent, the
    // student can still just say it.
    if (!voice.sendDone()) showToast("Tell your teacher “maine likh liya, dekho”.");
  };

  const askDoubt = () => {
    setHoldTick((n) => n + 1);
    send({ kind: "interrupt", reason: "doubt" });
    if (!voice.askDoubt()) showToast("Go ahead and ask: your teacher will stop and listen.");
  };

  if (!student) {
    return (
      <Setup
        sessionCode={sessionCode}
        onStart={(s) => {
          setStudent(s);
          startCall(s); // same click, so the browser allows audio
        }}
      />
    );
  }

  const live = voice.state === "connecting" || voice.state === "ringing" || voice.state === "active";
  const callControls = live ? (
    <>
      {voice.state === "active" && (
        <button className="btn-doubt" onClick={askDoubt} title="Stop the teacher and ask your doubt">
          ✋ Ask doubt
        </button>
      )}
      <button className="btn-end" onClick={voice.stop} title="End the class">
        {voice.state === "active" ? "End" : "Connecting…"}
      </button>
    </>
  ) : (
    <>
      <button className="btn-start" onClick={() => startCall(student)} title="Start the class">
        ▶ Start class
      </button>
      <button className={phoneOpen ? "on" : ""} onClick={() => setPhoneOpen((o) => !o)} aria-label="Call my phone instead" title="Call my phone instead">
        <PhoneIcon />
      </button>
    </>
  );

  return (
    <div className="classroom">
      <Board
        sessionCode={sessionCode}
        blocks={blocks}
        highlights={highlights}
        erased={erased}
        currentSection={currentSection}
        mark={mark}
        correctCapture={correctCapture}
        status={status}
        captureTick={captureTick}
        callActive={voice.state === "active"}
        teacherSpeaking={floor.teacherSpeaking}
        holdTick={holdTick}
        resumeTick={resumeTick}
        send={send}
        onDone={onDone}
        toolbarExtra={callControls}
      />

      <div className="brand-chip" title={`Session ${sessionCode}`}>
        <span className="dot" data-on={connected} />
        Shikshak
      </div>
      <VoiceOrb state={floor.state} level={floor.state === "teacher" ? Math.min(1, voice.volume * 3) : floor.state === "student" ? mic : 0} />

      {phoneOpen && !live && (
        <div className="phone-dock">
          <PhoneFallback userData={() => buildUserData(student)} initiallyOpen />
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
      {isDev && <DevPanel sessionCode={sessionCode} />}
    </div>
  );
}

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
  </svg>
);
