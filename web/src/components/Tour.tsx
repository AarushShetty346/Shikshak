// A first-time guided tour, like a game's tutorial: the screen dims, one control is lit up at a
// time, and the teacher explains it in a speech bubble. It runs once per device for each screen and
// can be replayed. Each step is read aloud in the tutor's own voice from clips recorded once with
// scripts/tour-voice.ts (web/public/tour/). A step without a clip is simply silent.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { clipName, type TourStep } from "../lib/tourSteps";

export { CLASS_TOUR, HOME_TOUR, type TourStep } from "../lib/tourSteps";

const SEEN = (name: string) => `shikshak.tour.${name}.v1`;
const MUTED = "shikshak.tour.muted";

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
  const [muted, setMuted] = useState(() => read(MUTED) === "1");
  const step = live[i];

  // The teacher reads the step out. Browsers may block sound before the first click; then the
  // first step stays silent and the voice starts at Next.
  useEffect(() => {
    if (!step || muted) return;
    const audio = new Audio(`/tour/${clipName(step)}`);
    audio.play().catch(() => {});
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [step, muted]);

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
          <button
            className="tour-mute"
            onClick={() => {
              write(MUTED, muted ? "0" : "1");
              setMuted(!muted);
            }}
            aria-label={muted ? "Turn the teacher's voice on" : "Mute the teacher's voice"}
            aria-pressed={muted}
            title={muted ? "Voice off" : "Voice on"}
          >
            {muted ? <SpeakerSlash weight="bold" /> : <SpeakerHigh weight="bold" />}
          </button>
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
