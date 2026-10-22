import { useCallback, useEffect, useState } from "react";
import { LANGUAGE_NAMES, type BoardEvent } from "../../shared/types";
import { Chalkboard, type BoardBlock } from "./components/Chalkboard";
import { DevPanel } from "./components/DevPanel";
import { Notebook, type NotebookStatus } from "./components/Notebook";
import { PhoneFallback } from "./components/PhoneFallback";
import { Setup, type StudentSetup } from "./components/Setup";
import { TopBar } from "./components/TopBar";
import { getSessionCode, isDev } from "./lib/session";
import { useBoardSocket } from "./lib/useBoardSocket";
import { useVoiceCall } from "./lib/useVoiceCall";

const sessionCode = getSessionCode();

export function App() {
  const [student, setStudent] = useState<StudentSetup | null>(null);
  const [blocks, setBlocks] = useState<BoardBlock[]>([]);
  const [wipeKey, setWipeKey] = useState(0);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const [mark, setMark] = useState<{ line: number; note: string } | null>(null);
  const [status, setStatus] = useState<NotebookStatus>("idle");
  const [snapshotTick, setSnapshotTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const voice = useVoiceCall();

  const onEvent = useCallback((e: BoardEvent, replay: boolean) => {
    switch (e.type) {
      case "clear":
        setBlocks([]);
        if (!replay) setWipeKey((k) => k + 1);
        break;
      case "steps":
        setBlocks((b) => (b.some((x) => x.id === e.id) ? b : [...b, { id: e.id, title: e.title, steps: e.steps, instant: replay }]));
        break;
      case "problem":
        setProblem((p) => (p?.id === e.id ? p : { id: e.id, text: e.problem }));
        setMark(null);
        setStatus("idle");
        break;
      case "checking":
        setStatus("checking");
        setMark(null);
        setSnapshotTick((n) => n + 1);
        break;
      case "mark":
        setStatus("idle");
        setMark({ line: e.line, note: e.note });
        break;
      case "correct":
        setStatus("correct");
        break;
      case "unclear":
        setStatus("idle");
        if (!replay) {
          setToast(e.note);
          setTimeout(() => setToast(null), 4000);
        }
        break;
    }
  }, []);

  const { connected, send } = useBoardSocket(sessionCode, onEvent);

  // Render's free plan sleeps after ~15 idle minutes. While a class is open, ping the server
  // so it stays awake and the tutor's board actions don't hit a cold start mid-call.
  useEffect(() => {
    if (!student) return;
    const id = setInterval(() => void fetch("/api/health").catch(() => {}), 4 * 60 * 1000);
    return () => clearInterval(id);
  }, [student]);
  const onSnapshot = useCallback((png: string | null, lineCount: number) => send({ kind: "canvas", png, lineCount }), [send]);

  const buildUserData = (s: StudentSetup): Record<string, unknown> => {
    const plan = s.plan;
    return {
      session_code: sessionCode,
      student_name: s.name,
      grade: s.grade,
      language: s.language,
      language_name: LANGUAGE_NAMES[s.language],
      topic: s.topic || (plan?.title ?? "whatever the student wants help with"),
      lesson_plan: plan
        ? `${plan.title}. Goal: ${plan.goal}. Steps: ${plan.steps.map((x, i) => `${i + 1}) ${x.title}: ${x.idea}`).join(" ")}`
        : "No plan yet. Ask the student what they are stuck on, then make a short plan with them.",
      practice_problem: plan?.practice_problem ?? "",
      practice_answer: plan?.practice_answer ?? "",
    };
  };

  const startCall = (s: StudentSetup) => voice.start(buildUserData(s));

  if (!student) {
    return (
      <Setup
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
        <Chalkboard blocks={blocks} wipeKey={wipeKey} />
        <Notebook key={problem?.id ?? "free"} problem={problem?.text ?? null} mark={mark} status={status} snapshotTick={snapshotTick} onSnapshot={onSnapshot} />
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
      {isDev && <DevPanel sessionCode={sessionCode} />}
    </div>
  );
}
