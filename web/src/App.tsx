import { useCallback, useEffect, useState } from "react";
import { greetingFor, LANGUAGE_NAMES, type BoardEvent } from "../../shared/types";
import { Board, type BoardStatus, type TutorBlock } from "./components/Board";
import { DevPanel } from "./components/DevPanel";
import { PhoneFallback } from "./components/PhoneFallback";
import { Setup, type StudentSetup } from "./components/Setup";
import { TopBar } from "./components/TopBar";
import { getSessionCode, isDev } from "./lib/session";
import { useBoardSocket } from "./lib/useBoardSocket";
import { useVoiceCall } from "./lib/useVoiceCall";

const sessionCode = getSessionCode();

function toBlock(e: BoardEvent, instant: boolean): TutorBlock | null {
  switch (e.type) {
    case "steps":
      return { kind: "steps", id: e.id, title: e.title, steps: e.steps, section: e.section, instant };
    case "problem":
      return { kind: "problem", id: e.id, problem: e.problem, instant };
    case "plan":
      return { kind: "plan", id: e.id, title: e.title, items: e.items, instant };
    case "page":
      return { kind: "page", id: e.id, instant };
    default:
      return null;
  }
}

export function App() {
  const [student, setStudent] = useState<StudentSetup | null>(null);
  const [blocks, setBlocks] = useState<TutorBlock[]>([]);
  const [currentSection, setCurrentSection] = useState<number | null>(null);
  const [mark, setMark] = useState<{ captureId: string; line: number; note: string } | null>(null);
  const [correctCapture, setCorrectCapture] = useState<string | null>(null);
  const [status, setStatus] = useState<BoardStatus>("idle");
  const [captureTick, setCaptureTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const voice = useVoiceCall();

  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 4000);
  };

  const onEvent = useCallback((e: BoardEvent, replay: boolean) => {
    const block = toBlock(e, replay);
    if (block) {
      setBlocks((b) => (b.some((x) => x.id === block.id) ? b : [...b, block]));
      if (e.type === "steps" && e.section) setCurrentSection(e.section.n);
      if (e.type === "problem") {
        setMark(null);
        setStatus("idle");
      }
      return;
    }
    switch (e.type) {
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
  }, []);

  const onReset = useCallback(() => {
    setBlocks([]);
    setCurrentSection(null);
  }, []);

  const { connected, send } = useBoardSocket(sessionCode, onEvent, onReset);

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
        : "No prepared plan. Ask the student what they are stuck on, then teach it with show_steps and give_problem.",
    };
  };

  const startCall = (s: StudentSetup) => voice.start(buildUserData(s));

  const onDone = () => {
    if (voice.state !== "active") return;
    // The tutor gets a keypad signal and looks at the board. If the tones can't be sent, the
    // student can still just say it.
    if (!voice.sendDone()) showToast("Tell your teacher “maine likh liya, dekho”.");
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

  return (
    <div className="classroom">
      <TopBar
        callState={voice.state}
        volume={voice.volume}
        error={voice.error}
        connected={connected}
        sessionCode={sessionCode}
        onStart={() => startCall(student)}
        onStop={voice.stop}
        phoneFallback={<PhoneFallback userData={() => buildUserData(student)} />}
      />
      <main className="desk">
        <Board
          sessionCode={sessionCode}
          blocks={blocks}
          currentSection={currentSection}
          mark={mark}
          correctCapture={correctCapture}
          status={status}
          captureTick={captureTick}
          send={send}
          onDone={onDone}
        />
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
      {isDev && <DevPanel sessionCode={sessionCode} />}
    </div>
  );
}
