// A first-time guided tour, like a game's tutorial: the screen dims, one control is lit up at a
// time, and the teacher explains it in a speech bubble. It runs once per device for each screen and
// can be replayed. (No narration: the browser's voice didn't sound like the teacher, and Bolna's
// voice only exists inside a paid call.)

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";

export interface TourStep {
  /** CSS selector of the control to light up; none for a message in the middle of the screen. */
  target?: string;
  title: string;
  text: string;
}

const SEEN = (name: string) => `shikshak.tour.${name}.v1`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: the tour may show again next time, which is fine
  }
}

/** True if this tour hasn't been shown on this device yet. */
export const tourDue = (name: string) => read(SEEN(name)) !== "1";

export function Tour({ name, steps, onClose }: { name: string; steps: TourStep[]; onClose: () => void }) {
  // Only steps whose control is on screen right now (a Talk button only exists during a call, etc.).
  const [live] = useState(() => steps.filter((s) => !s.target || document.querySelector(s.target)));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = live[i];

  const close = useCallback(() => {
    write(SEEN(name), "1");
    onClose();
  }, [name, onClose]);

  // Where the lit-up control is, kept up to date while the page moves.
  useLayoutEffect(() => {
    const measure = () => {
      const el = step?.target ? document.querySelector(step.target) : null;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  useEffect(() => {
    if (step) nextRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setI((n) => Math.min(n + 1, live.length - 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, live.length]);

  if (!step) return null;
  const last = i === live.length - 1;
  const pad = 8;
  const spot = rect ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null;

  // The bubble goes below the control if there's room, else above; centred when there's no control.
  const W = Math.min(380, innerWidth - 24);
  const bubble: React.CSSProperties = spot
    ? {
        width: W,
        left: Math.max(12, Math.min(innerWidth - W - 12, spot.left + spot.width / 2 - W / 2)),
        ...(spot.top + spot.height + 230 < innerHeight ? { top: spot.top + spot.height + 14 } : { bottom: innerHeight - spot.top + 14 }),
      }
    : { width: W, left: (innerWidth - W) / 2, top: Math.max(24, innerHeight / 2 - 140) };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {spot ? <div className="tour-spot" style={spot} /> : <div className="tour-dim" />}
      <div className="tour-bubble" style={bubble}>
        <div className="tour-head">
          <span className="tour-teacher" aria-hidden="true">
            श
          </span>
          <h2 id="tour-title">{step.title}</h2>
        </div>
        <p className="tour-text" aria-live="polite">
          {step.text}
        </p>
        <div className="tour-foot">
          <span className="tour-dots" aria-label={`Step ${i + 1} of ${live.length}`}>
            {live.map((_, n) => (
              <span key={n} data-on={n === i} />
            ))}
          </span>
          {!last && (
            <button className="tour-skip" onClick={close}>
              Skip tour
            </button>
          )}
          {i > 0 && (
            <button className="btn-secondary btn-small" onClick={() => setI(i - 1)} aria-label="Back">
              <ArrowLeft />
            </button>
          )}
          <button ref={nextRef} className="btn-primary btn-small" onClick={() => (last ? close() : setI(i + 1))}>
            {last ? "Let's start" : "Next"} {!last && <ArrowRight />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The home screen, the first time. */
export const HOME_TOUR: TourStep[] = [
  { title: "Namaste! I'm your maths teacher", text: "Let me show you around. It takes one minute. You can press Next, or use the arrow keys." },
  { target: ".mode-toggle", title: "Student or Teacher", text: "Learning? Stay on Student. Teachers switch here to see the progress students share with them." },
  { target: ".home-head-actions .btn-primary", title: "Start a class", text: "Press New session to start a class. Make one class for each chapter, like a notebook for every topic." },
  { target: ".profile-button", title: "This is you", text: "Tap your picture to see your progress, switch to another learner, or add a brother or sister." },
  { target: ".session-list, .home-empty", title: "Your classes", text: "Your classes live here. Open one any time and the board is exactly as you left it." },
  { title: "That's it!", text: "Press New session, pick a topic, and I'll show you the board next." },
];

/** The classroom, the first time: what each control does, and how a class goes. */
export const CLASS_TOUR: TourStep[] = [
  { title: "This is our blackboard", text: "I teach on this board, and you write on it too. Let me show you the buttons." },
  { target: ".btn-start", title: "Start the class", text: "Press Start and I'll begin talking. Then just talk back to me, like a real class." },
  { target: ".btn-start", title: "How to talk to me", text: "Hold the Talk button, or hold Space or Caps Lock, while you speak. Let go when you're done. Need to stop me? Press Stop." },
  { target: '[aria-label="Pen"]', title: "Your pen", text: "Write your working with your finger, mouse or stylus. One step on each line." },
  { target: '[aria-label="Eraser"]', title: "Rub it out", text: "Made a mistake? Use the eraser, or undo your last line." },
  { target: "button.btn-done", title: "Press Done", text: "When you finish, press Done. I'll read your steps and circle the first one that went wrong." },
  { target: '[aria-label="From paper"]', title: "Working in your notebook?", text: "No stylus? Solve it on paper and send me a photo. It goes on the board and I check it right there." },
  { target: '[aria-label="Upload material"]', title: "Your book", text: "Upload your textbook or notes, and I'll teach from your own pages." },
  { target: ".btn-speed", title: "My speed", text: "Am I too fast or too slow? Change how fast I talk." },
  { target: '[aria-label="Session menu"]', title: "The menu", text: "Your class report, a practice question and more are in here." },
  {
    title: "How we'll learn",
    text: "First I explain on the board. Then it's your turn to try. Press Done, and I check it and circle any slip. Stuck? Ask me for a hint. Ready? Press Start!",
  },
];
