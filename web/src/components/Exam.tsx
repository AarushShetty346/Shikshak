// Exam mode: set up a practice exam, read and download the paper (a board-style paper, as a page
// and as a PDF), sit it with an invigilator in Exam mode (camera, whole-screen sharing,
// fullscreen; what it notices goes in an integrity report), upload the answer sheets, and get them
// marked like a board evaluator would. Then a class with the tutor on the weakest question.

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, CheckCircle, DownloadSimple, Exam as ExamIcon, House, Monitor, Timer, UploadSimple, Warning } from "@phosphor-icons/react";
import { createExam, DURATIONS, EVENT_LABEL, getExam, listExams, logExamEvents, QUESTION_COUNTS, reviewExam, startExam, submitExam, type Exam, type ExamMode } from "../lib/exams";
import { cachedLearners, listLearners, selectedLearner, type Learner } from "../lib/learners";
import { clipName, INVIGILATOR_LINES } from "../lib/tourSteps";
import { prepareFile } from "../lib/files";
import { apiFetch } from "../lib/api";
import { newCode, saveData, saveSession } from "../lib/session";
import { emptySnapshot } from "../../../shared/boardState";

const CHAPTERS: Record<string, string[]> = {
  "9": ["Number systems", "Polynomials", "Coordinate geometry", "Linear equations in two variables", "Lines and angles", "Triangles", "Quadrilaterals", "Circles", "Heron's formula", "Surface areas and volumes", "Statistics"],
  "10": [
    "Real numbers",
    "Polynomials",
    "Pair of linear equations",
    "Quadratic equations",
    "Arithmetic progressions",
    "Triangles",
    "Coordinate geometry",
    "Trigonometry",
    "Circles",
    "Areas related to circles",
    "Surface areas and volumes",
    "Statistics",
    "Probability",
  ],
};
const minutesLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} hour${m > 60 ? "s" : ""}`);
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function useLearner(): Learner | null {
  const [learner, setLearner] = useState<Learner | null>(() => cachedLearners()?.find((l) => l.id === selectedLearner()) ?? null);
  useEffect(() => {
    listLearners()
      .then((list) => setLearner(list.find((l) => l.id === selectedLearner()) ?? list[0] ?? null))
      .catch(() => {});
  }, []);
  return learner;
}

function Page({ children, onBack, back = "Back" }: { children: React.ReactNode; onBack: () => void; back?: string }) {
  return (
    <main className="home home-board exam-page">
      <header className="group-head exam-head">
        <button className="link-button group-back" onClick={onBack}>
          <ArrowLeft weight="bold" /> {back}
        </button>
        <button className="btn-secondary btn-small group-home" onClick={() => (location.hash = "#/")}>
          <House weight="bold" /> My classes
        </button>
      </header>
      {children}
    </main>
  );
}

/** #/exam: set up a new exam, and the exams already taken. */
export function ExamHome({ onOpen }: { onOpen: (id: string) => void }) {
  const learner = useLearner();
  const grade = learner?.grade ?? "10";
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState<"standard" | "basic">("standard");
  const [questions, setQuestions] = useState<number>(10);
  const [minutes, setMinutes] = useState<number>(60);
  const [mode, setMode] = useState<ExamMode>("mock");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [past, setPast] = useState<Exam[] | null>(null);
  useEffect(() => {
    if (learner) listExams(learner.id).then(setPast, () => setPast([]));
  }, [learner]);

  const make = async () => {
    if (!learner) return setError("Make your account first (on the home screen).");
    if (!topic.trim()) return setError("Say which chapter or topic the paper is on.");
    setBusy(true);
    setError(null);
    try {
      const e = await createExam({ learnerId: learner.id, topic: topic.trim(), questions, minutes, mode, ...(grade === "10" ? { level } : {}) });
      onOpen(e.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Page onBack={() => (location.hash = "#/")}>
      <h1 className="chalk group-title">Exams</h1>
      <p className="group-note">A practice paper in the board pattern, for class {grade}. Sit it, upload your answer sheets, and get them marked like a board exam.</p>
      <section className="exam-setup" aria-label="New exam">
        <label className="field">
          <span>Chapter or topic</span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Quadratic equations" maxLength={120} />
        </label>
        {CHAPTERS[grade] && (
          <div className="exam-chips" role="group" aria-label="Chapters">
            {[...CHAPTERS[grade], "Full syllabus"].map((c) => (
              <button key={c} type="button" className={topic === c ? "on" : ""} onClick={() => setTopic(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
        {grade === "10" && (
          <div className="exam-row">
            <span className="exam-label">Paper</span>
            <div className="exam-pills" role="radiogroup" aria-label="Paper">
              {(["standard", "basic"] as const).map((l) => (
                <button key={l} role="radio" aria-checked={level === l} className={level === l ? "on" : ""} onClick={() => setLevel(l)}>
                  {l === "standard" ? "Maths Standard" : "Maths Basic"}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="exam-row">
          <span className="exam-label">Questions</span>
          <div className="exam-pills" role="radiogroup" aria-label="Questions">
            {QUESTION_COUNTS.map((n) => (
              <button key={n} role="radio" aria-checked={questions === n} className={questions === n ? "on" : ""} onClick={() => setQuestions(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="exam-row">
          <span className="exam-label">Time</span>
          <div className="exam-pills" role="radiogroup" aria-label="Time">
            {DURATIONS.map((m) => (
              <button key={m} role="radio" aria-checked={minutes === m} className={minutes === m ? "on" : ""} onClick={() => setMinutes(m)}>
                {minutesLabel(m)}
              </button>
            ))}
          </div>
        </div>
        <div className="exam-modes" role="radiogroup" aria-label="Mode">
          <button role="radio" aria-checked={mode === "mock"} className={mode === "mock" ? "on" : ""} onClick={() => setMode("mock")}>
            <strong>Mock exam</strong>
            <span>Just the paper: read it, download it, practise on your own. No invigilator.</span>
          </button>
          <button role="radio" aria-checked={mode === "exam"} className={mode === "exam" ? "on" : ""} onClick={() => setMode("exam")}>
            <strong>Exam</strong>
            <span>With an invigilator: your camera on, your whole screen shared, fullscreen. What it notices goes in a report.</span>
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="btn-primary group-cta" onClick={() => void make()} disabled={busy}>
          {busy ? <span className="spin" /> : <ExamIcon weight="bold" />} {busy ? "Writing your paper…" : "Make my paper"}
        </button>
      </section>
      {past && past.length > 0 && (
        <section className="group-list" aria-label="Your exams">
          <h2 className="chalk">Your exams</h2>
          {past.map((e) => (
            <button key={e.id} className="group-row" onClick={() => onOpen(e.id)}>
              <span className="group-row-name">{e.paper.title}</span>
              <span className="group-row-count">
                {day(e.createdAt)} · {e.mode === "exam" ? "Exam" : "Mock"}
                {e.evaluation ? ` · ${e.evaluation.total}/${e.evaluation.max}` : ""}
              </span>
            </button>
          ))}
        </section>
      )}
    </Page>
  );
}

/** The paper as a board paper: header, general instructions, sections, questions with marks. */
function PaperSheet({ exam, sealed = false }: { exam: Exam; sealed?: boolean }) {
  const p = exam.paper;
  return (
    <article className="exam-paper" aria-label="Question paper">
      {p.simulated && <p className="exam-sim">Simulated paper (no paper writer on this server)</p>}
      <header className="exam-paper-head">
        <p className="exam-brand">Shikshak Practice Paper</p>
        <h2>{p.title}</h2>
        <p>
          Class {p.grade} · {p.subject}
        </p>
        <div className="exam-meta">
          <span>Time allowed: {minutesLabel(p.minutes)}</span>
          <span>Maximum Marks: {p.maxMarks}</span>
        </div>
      </header>
      <section className="exam-instructions">
        <h3>General Instructions:</h3>
        <ol type="i">
          {p.instructions.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ol>
      </section>
      {sealed && <p className="exam-sealed">The questions appear when you start the exam.</p>}
      {!sealed &&
        p.sections.map((s) => (
        <section key={s.id} className="exam-section">
          <h3>{s.title.toUpperCase()}</h3>
          <p className="exam-section-note">{s.instructions}</p>
          {s.questions.map((q) => (
            <div key={q.n} className="exam-q-row">
              <span className="exam-qn">{q.n}.</span>
              <div className="exam-qbody">
                <p className="exam-qtext">{q.or ? <span className="exam-choice">(a) </span> : null}{q.text}</p>
                {q.options && (
                  <ol className="exam-options">
                    {q.options.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ol>
                )}
                {q.or && (
                  <>
                    <p className="exam-or">OR</p>
                    <p className="exam-qtext">
                      <span className="exam-choice">(b) </span>
                      {q.or}
                    </p>
                  </>
                )}
              </div>
              <span className="exam-marks">{q.marks}</span>
            </div>
          ))}
        </section>
      ))}
      {!sealed && <p className="exam-end">*** End of the paper ***</p>}
    </article>
  );
}

const printPaper = (title: string) => {
  const before = document.title;
  document.title = `${title} - Shikshak`; // the PDF's file name
  document.body.classList.add("printing-paper");
  window.addEventListener(
    "afterprint",
    () => {
      document.title = before;
      document.body.classList.remove("printing-paper");
    },
    { once: true },
  );
  window.print();
};

/** #/exam/<id>: the paper, sitting it, the answer sheets and the marks. */
export function ExamView({ id, onBack }: { id: string; onBack: () => void }) {
  const [exam, setExam] = useState<Exam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"paper" | "checks" | "sitting" | "answers">("paper");
  useEffect(() => {
    getExam(id).then(
      (e) => {
        setExam(e);
        if (e.evaluation) setStage("paper");
        else if (e.endedAt || (e.endsAt && Date.now() > e.endsAt)) setStage("answers");
      },
      (e) => setError((e as Error).message),
    );
  }, [id]);

  if (error)
    return (
      <Page onBack={onBack} back="Exams">
        <p className="form-error">{error}</p>
      </Page>
    );
  if (!exam) return <main className="home home-board exam-page" aria-busy="true" />;
  if (exam.evaluation) return <Marks exam={exam} onBack={onBack} />;
  if (stage === "checks") return <Invigilator exam={exam} onReady={(e) => (setExam(e), setStage("sitting"))} onCancel={() => setStage("paper")} />;
  if (stage === "sitting") return <Sitting exam={exam} onEnd={() => setStage("answers")} />;
  if (stage === "answers") return <Answers exam={exam} onMarked={setExam} onBack={onBack} />;

  return (
    <Page onBack={onBack} back="Exams">
      <div className="exam-actions">
        {exam.mode === "mock" && (
          <button className="btn-secondary" onClick={() => printPaper(exam.paper.title)}>
            <DownloadSimple weight="bold" /> Download PDF
          </button>
        )}
        {exam.mode === "exam" ? (
          <button className="btn-primary" onClick={() => setStage("checks")}>
            <Timer weight="bold" /> Start exam
          </button>
        ) : (
          <button className="btn-primary" onClick={() => setStage("answers")}>
            <UploadSimple weight="bold" /> Upload my answers to be marked
          </button>
        )}
      </div>
      {exam.mode === "exam" && <p className="group-note">In an Exam the questions stay hidden until you start, and the clock and the invigilator start with them. You can download the paper after you finish.</p>}
      <PaperSheet exam={exam} sealed={exam.mode === "exam" && !exam.startedAt} />
    </Page>
  );
}

// ---------- the invigilator ----------

// The streams live outside React so the exam screen can keep them while it changes stage.
const media: { camera: MediaStream | null; screen: MediaStream | null } = { camera: null, screen: null };
const stopAll = () => {
  for (const s of [media.camera, media.screen]) s?.getTracks().forEach((t) => t.stop());
  media.camera = media.screen = null;
};

/**
 * The front camera. iPad and iPhone Safari can reject the "facingMode" hint or ask slowly, so it
 * retries without it, and gives a reason the student can act on instead of failing silently.
 */
async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use the camera here. Open the site in Safari or Chrome (not inside another app).");
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
  } catch (e) {
    const name = (e as DOMException).name;
    if (name === "NotAllowedError" || name === "SecurityError")
      throw new Error("The camera is blocked. Allow it for this site (on iPad: Settings › Safari › Camera › Allow, or the \"aA\" menu › Website Settings), then try again.");
    if (name === "NotReadableError") throw new Error("Another app is using the camera. Close it, then try again.");
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

/** Safari may not start a camera preview by itself: start it explicitly. */
function showStream(el: HTMLVideoElement | null, stream: MediaStream | null) {
  if (!el || !stream) return;
  if (el.srcObject !== stream) el.srcObject = stream;
  void el.play().catch(() => {});
}

function Invigilator({ exam, onReady, onCancel }: { exam: Exam; onReady: (e: Exam) => void; onCancel: () => void }) {
  const [camera, setCamera] = useState(Boolean(media.camera));
  const [screen, setScreen] = useState(Boolean(media.screen));
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    showStream(preview.current, media.camera);
  }, [camera]);

  const turnOnCamera = async () => {
    setError(null);
    setAsking(true);
    try {
      media.camera = await openCamera();
      setCamera(true);
    } catch (e) {
      const m = (e as Error).message;
      setError(m && !/^(Permission|NotAllowed|The request)/.test(m) ? m : "The camera is needed for an exam. Allow it in the browser, then try again.");
    } finally {
      setAsking(false);
    }
  };
  const shareScreen = async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "monitor" } as MediaTrackConstraints, audio: false });
      const surface = s.getVideoTracks()[0]?.getSettings().displaySurface;
      if (surface && surface !== "monitor") {
        s.getTracks().forEach((t) => t.stop());
        return setError("Share your entire screen, not a window or a tab.");
      }
      media.screen = s;
      setScreen(true);
    } catch {
      setError("Screen sharing is needed for an exam. Choose \"Entire screen\" when the browser asks.");
    }
  };
  const begin = async () => {
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // phones may not allow fullscreen; the rest of the invigilator still works
    }
    onReady(await startExam(exam.id));
  };
  const supported = Boolean(navigator.mediaDevices?.getDisplayMedia);

  return (
    <Page
      onBack={() => {
        stopAll();
        onCancel();
      }}
      back="Paper"
    >
      <h1 className="chalk group-title">Before you start</h1>
      <p className="group-note">
        {exam.paper.title} · {minutesLabel(exam.paper.minutes)} · {exam.paper.maxMarks} marks. The invigilator needs these, like a real exam hall. Nothing is recorded or uploaded:
        it only notes when something changes (leaving the tab, stopping the camera...) in a report you'll see at the end.
      </p>
      <ol className="exam-checks">
        <li data-ok={camera}>
          <Camera weight="bold" />
          <div>
            <strong>Camera on</strong>
            <span>So the invigilator can see you, as in an exam hall.</span>
          </div>
          {camera ? <video ref={preview} className="exam-cam-preview" autoPlay muted playsInline /> : <button className="btn-secondary btn-small" onClick={() => void turnOnCamera()} disabled={asking}>{asking ? "Allow the camera…" : "Turn on camera"}</button>}
        </li>
        <li data-ok={screen}>
          <Monitor weight="bold" />
          <div>
            <strong>Share your entire screen</strong>
            <span>{supported ? "Choose \"Entire screen\" when the browser asks." : "This browser can't share the screen (most phones can't): use a computer for an Exam, or take a Mock exam."}</span>
          </div>
          {screen ? <CheckCircle weight="fill" className="exam-ok" /> : <button className="btn-secondary btn-small" onClick={() => void shareScreen()} disabled={!supported}>Share screen</button>}
        </li>
        <li data-ok={false}>
          <Timer weight="bold" />
          <div>
            <strong>Fullscreen, and the clock starts</strong>
            <span>Stay on this page until you finish. Leaving it is noted in the report.</span>
          </div>
        </li>
      </ol>
      {error && <p className="form-error">{error}</p>}
      <button className="btn-primary group-cta" disabled={!camera || !screen} onClick={() => void begin()}>
        Start the exam
      </button>
    </Page>
  );
}

type CallOut = "left" | "window" | "fullscreen" | "share" | "camera";

function Sitting({ exam, onEnd }: { exam: Exam; onEnd: () => void }) {
  const [now, setNow] = useState(Date.now());
  // The invigilator calls the student out, out loud and on screen, every time they leave the paper.
  const [callOut, setCallOut] = useState<{ kind: CallOut; count: number } | null>(null);
  const [away, setAway] = useState(false);
  const count = useRef(0);
  const voice = useRef<HTMLAudioElement | null>(null);
  const cam = useRef<HTMLVideoElement>(null);
  const ended = useRef(false);
  const say = (kind: CallOut, n: number) => {
    voice.current?.pause();
    const line = n >= 3 && (kind === "left" || kind === "window" || kind === "fullscreen") ? INVIGILATOR_LINES.again : INVIGILATOR_LINES[kind];
    voice.current = new Audio(`/tour/${clipName(line)}`);
    voice.current.play().catch(() => {});
  };
  const callOutFor = useCallback(
    (kind: CallOut, logKind: string) => {
      if (ended.current) return;
      void logExamEvents(exam.id, [{ kind: logKind }]);
      count.current += 1;
      say(kind, count.current);
      setCallOut({ kind, count: count.current });
    },
    [exam.id],
  );
  const finish = useCallback(
    (kind: "ended" | "time-up") => {
      if (ended.current) return;
      ended.current = true;
      voice.current?.pause();
      void logExamEvents(exam.id, [{ kind }]);
      stopAll();
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      onEnd();
    },
    [exam.id, onEnd],
  );
  // Keep the camera and screen tracks watched, including after they're turned on again.
  const watchTracks = useCallback(() => {
    const cameraTrack = media.camera?.getVideoTracks()[0];
    const screenTrack = media.screen?.getVideoTracks()[0];
    if (screenTrack) screenTrack.onended = () => callOutFor("share", "screen-share-ended");
    if (cameraTrack) cameraTrack.onended = () => callOutFor("camera", "camera-off");
    showStream(cam.current, media.camera);
  }, [callOutFor]);

  useEffect(() => {
    watchTracks();
    const t = setInterval(() => setNow(Date.now()), 1000);
    const onVis = () => {
      if (document.hidden) {
        setAway(true);
        callOutFor("left", "tab-hidden"); // she says it even while they're on the other screen
      } else {
        setAway(false);
        void logExamEvents(exam.id, [{ kind: "returned" }]);
      }
    };
    let clickedAt = 0;
    const onDown = () => (clickedAt = Date.now());
    const onBlur = () => Date.now() - clickedAt > 1500 && !document.hidden && callOutFor("window", "window-left");
    const onFull = () => !document.fullscreenElement && callOutFor("fullscreen", "fullscreen-exit");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFull);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFull);
    };
  }, [callOutFor, watchTracks, exam.id]);

  const left = Math.max(0, (exam.endsAt ?? now) - now);
  useEffect(() => {
    if (exam.endsAt && left <= 0) finish("time-up");
  }, [left, exam.endsAt, finish]);
  const hh = Math.floor(left / 3_600_000);
  const mm = Math.floor((left % 3_600_000) / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);

  // Putting things right from the warning itself.
  const [fixError, setFixError] = useState<string | null>(null);
  const backToPaper = async () => {
    setFixError(null);
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    } catch {
      // phones may not allow fullscreen
    }
    voice.current?.pause();
    setCallOut(null);
  };
  const shareAgain = async () => {
    setFixError(null);
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "monitor" } as MediaTrackConstraints, audio: false });
      const surface = s.getVideoTracks()[0]?.getSettings().displaySurface;
      if (surface && surface !== "monitor") {
        s.getTracks().forEach((t) => t.stop());
        return setFixError("Share your entire screen, not a window or a tab.");
      }
      media.screen?.getTracks().forEach((t) => t.stop());
      media.screen = s;
      watchTracks();
      await backToPaper();
    } catch {
      setFixError("Choose \"Entire screen\" when the browser asks.");
    }
  };
  const cameraAgain = async () => {
    setFixError(null);
    try {
      media.camera = await openCamera();
      watchTracks();
      await backToPaper();
    } catch (e) {
      setFixError((e as Error).message || "Allow the camera in the browser, then try again.");
    }
  };
  const line = callOut ? (callOut.count >= 3 && ["left", "window", "fullscreen"].includes(callOut.kind) ? INVIGILATOR_LINES.again : INVIGILATOR_LINES[callOut.kind]) : null;

  return (
    <main className="home home-board exam-page exam-sitting">
      <div className="exam-bar" role="status">
        <video ref={cam} className="exam-cam" autoPlay muted playsInline aria-label="Your camera" />
        <span className="exam-clock" role="timer" aria-label="Time left">
          <Timer weight="bold" /> {hh ? `${hh}:` : ""}
          {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
        </span>
        <span className="exam-live">{count.current ? `Invigilator on · ${count.current} warning${count.current > 1 ? "s" : ""}` : "Invigilator on"}</span>
        <button
          className="btn-primary btn-small"
          onClick={() => {
            if (window.confirm("Finish the exam now? You'll upload your answer sheets next.")) finish("ended");
          }}
        >
          I've finished
        </button>
      </div>
      <PaperSheet exam={exam} />
      {callOut && line && !away && (
        <div className="gate-backdrop exam-callout">
          <div className="gate-card exam-callout-card" role="alertdialog" aria-modal="true" aria-labelledby="callout-title">
            <span className="gate-icon" aria-hidden="true">
              <Warning weight="bold" />
            </span>
            <p className="exam-callout-count">Warning {callOut.count}</p>
            <h2 id="callout-title">{line.title}</h2>
            <p>{line.text}</p>
            {fixError && <p className="gate-error">{fixError}</p>}
            <div className="gate-actions">
              {callOut.kind === "share" ? (
                <button className="btn-primary" onClick={() => void shareAgain()}>
                  <Monitor weight="bold" /> Share screen again
                </button>
              ) : callOut.kind === "camera" ? (
                <button className="btn-primary" onClick={() => void cameraAgain()}>
                  <Camera weight="bold" /> Turn camera on
                </button>
              ) : (
                <button className="btn-primary" autoFocus onClick={() => void backToPaper()}>
                  {callOut.kind === "fullscreen" ? "Back to fullscreen" : "Back to my paper"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ---------- answer sheets and marks ----------

function Answers({ exam, onMarked, onBack }: { exam: Exam; onMarked: (e: Exam) => void; onBack: () => void }) {
  const [files, setFiles] = useState<{ name: string; mediaType: string; data: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const add = async (list: FileList | null) => {
    setError(null);
    try {
      const prepared = await Promise.all([...(list ?? [])].slice(0, 10).map((f) => prepareFile(f)));
      setFiles((now) => [...now, ...prepared.filter((p) => p.mediaType.startsWith("image/")).map((p) => ({ name: p.name, mediaType: p.mediaType, data: p.data }))].slice(0, 10));
    } catch (e) {
      setError((e as Error).message);
    }
    if (input.current) input.current.value = "";
  };
  const mark = async () => {
    setBusy(true);
    setError(null);
    try {
      onMarked(await submitExam(exam.id, files.map(({ mediaType, data }) => ({ mediaType, data }))));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Page onBack={onBack} back="Exams">
      <h1 className="chalk group-title">Your answer sheets</h1>
      <p className="group-note">Take a clear photo of each page, in order (up to 10). They're marked like a board exam: step marks for every question, and your presentation.</p>
      <div className="exam-actions">
        <button className="btn-secondary" onClick={() => input.current?.click()} disabled={busy}>
          <Camera weight="bold" /> Add photos
        </button>
        <button className="btn-primary" onClick={() => void mark()} disabled={busy || !files.length}>
          {busy ? <span className="spin" /> : <CheckCircle weight="bold" />} {busy ? "Marking…" : `Mark my ${files.length || ""} page${files.length === 1 ? "" : "s"}`}
        </button>
      </div>
      <input ref={input} type="file" accept="image/*" multiple className="file-picker" tabIndex={-1} aria-hidden="true" data-exam="answers" onChange={(e) => void add(e.target.files)} />
      {files.length > 0 && (
        <ol className="exam-thumbs">
          {files.map((f, i) => (
            <li key={i}>
              <img src={`data:${f.mediaType};base64,${f.data}`} alt={`Page ${i + 1}`} />
              <span>Page {i + 1}</span>
            </li>
          ))}
        </ol>
      )}
      {error && <p className="form-error">{error}</p>}
    </Page>
  );
}

const PRESENTATION: [keyof NonNullable<Exam["evaluation"]>["presentation"], string][] = [
  ["neatness", "Neatness"],
  ["handwriting", "Handwriting"],
  ["steps", "Step by step"],
  ["finalAnswers", "Final answers"],
];

function Marks({ exam, onBack }: { exam: Exam; onBack: () => void }) {
  const ev = exam.evaluation!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const questions = exam.paper.sections.flatMap((s) => s.questions);
  const pct = ev.max ? Math.round((ev.total / ev.max) * 100) : 0;

  // A class with the tutor, starting from the weakest question.
  const learn = async () => {
    setBusy(true);
    setError(null);
    try {
      const learnerId = selectedLearner();
      const l = cachedLearners()?.find((x) => x.id === learnerId);
      const topic = `Exam review: ${exam.topic}`;
      const r = await apiFetch<{ session: { id: string } }>("/sessions", { body: { label: topic, language: l?.language ?? "hinglish", grade: exam.paper.grade, topic, studentName: l?.name ?? "", learnerId } });
      await reviewExam(exam.id, r.session.id);
      const code = newCode();
      const now = Date.now();
      saveSession({ id: code, serverId: r.session.id, learnerId, name: topic, studentName: l?.name ?? "", grade: exam.paper.grade, language: l?.language ?? "hinglish", topic, createdAt: now, updatedAt: now, archived: false, started: false });
      saveData(code, { snapshot: emptySnapshot(), plan: null, docs: [], speed: "normal", handsFree: true });
      location.hash = `#/s/${code}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Page onBack={onBack} back="Exams">
      <h1 className="chalk group-title">Your marks</h1>
      {ev.simulated && <p className="exam-sim">Simulated marking (no handwriting reader on this server)</p>}
      <section className="exam-score">
        <p className="exam-total">
          <strong>{ev.total}</strong> / {ev.max}
          <span>{pct}%</span>
        </p>
        <p className="exam-summary">{ev.summary}</p>
        <p className="exam-practice">Practice marks from Shikshak, not official marks.</p>
      </section>
      <section className="exam-panel">
        <h2 className="chalk">Presentation</h2>
        <ul className="exam-bars">
          {PRESENTATION.map(([k, label]) => (
            <li key={k}>
              <span className="exam-bar-label">{label}</span>
              <span className="exam-bar-track">
                <span className="exam-bar-fill" style={{ width: `${(ev.presentation[k].score / 5) * 100}%` }} />
              </span>
              <span className="exam-bar-score">{ev.presentation[k].score}/5</span>
              <span className="exam-bar-comment">{ev.presentation[k].comment}</span>
            </li>
          ))}
        </ul>
      </section>
      <div className="exam-two">
        <section className="exam-panel">
          <h2 className="chalk">What went well</h2>
          <ul>
            {ev.strengths.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </section>
        <section className="exam-panel">
          <h2 className="chalk">Where to improve</h2>
          <ol>
            {ev.improve.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </section>
      </div>
      <section className="exam-panel">
        <h2 className="chalk">Question by question</h2>
        <ul className="exam-qmarks">
          {ev.questions.map((q) => (
            <li key={q.n} data-full={q.awarded === q.max} data-zero={q.awarded === 0}>
              <p className="exam-qmarks-head">
                <strong>Q{q.n}.</strong> <span className="exam-qmarks-text">{questions.find((x) => x.n === q.n)?.text}</span>
                <span className="exam-qmarks-score">
                  {q.awarded}/{q.max}
                </span>
              </p>
              {q.steps.length > 0 && (
                <ul className="exam-steps">
                  {q.steps.map((st, i) => (
                    <li key={i}>
                      <span>{st.text}</span>
                      <span>
                        {st.awarded}/{st.max}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="exam-feedback">{q.feedback}</p>
            </li>
          ))}
        </ul>
      </section>
      {exam.mode === "exam" && (
        <section className="exam-panel">
          <h2 className="chalk">Invigilator's report</h2>
          {exam.events.filter((e) => !["started", "ended", "returned"].includes(e.kind)).length === 0 ? (
            <p>Nothing unusual noted.</p>
          ) : (
            <ul className="exam-events">
              {exam.events.map((e, i) => (
                <li key={i}>
                  <span>{new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span> {EVENT_LABEL[e.kind] ?? e.kind}
                </li>
              ))}
            </ul>
          )}
          <p className="exam-practice">A record of what happened during the exam, not a judgement about cheating.</p>
        </section>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="exam-actions">
        <button className="btn-primary" onClick={() => void learn()} disabled={busy}>
          {busy ? <span className="spin" /> : null} Learn from this with the tutor
        </button>
        <button className="btn-secondary" onClick={() => printPaper(exam.paper.title)}>
          <DownloadSimple weight="bold" /> Download the paper
        </button>
      </div>
      <PaperSheet exam={exam} />
    </Page>
  );
}
