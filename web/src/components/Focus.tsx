// Focus mode: the student picks how long (30 minutes or more), the class goes fullscreen, and for
// that time the teacher notices when they leave: another tab, another app, or out of fullscreen.
// When they come back she calls them back to the board (in her own recorded voice, if the clips
// are recorded), and at the end she says how it went.
// A web page can't stop anyone switching tabs; it can only notice and respond, as a teacher would.

import { useEffect, useRef, useState } from "react";
import { Eye, Timer, X } from "@phosphor-icons/react";
import { clipName, FOCUS_LINES } from "../lib/tourSteps";

const say = (i: number) => {
  const audio = new Audio(`/tour/${clipName(FOCUS_LINES[i])}`);
  audio.play().catch(() => {});
};

const fullscreen = () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
};

export const FOCUS_CHOICES = [30, 45, 60, 90, 120];
const LABEL: Record<number, string> = { 30: "30 min", 45: "45 min", 60: "1 hour", 90: "1½ hours", 120: "2 hours" };

export function FocusSetup({ onStart, onClose }: { onStart: (minutes: number) => void; onClose: () => void }) {
  const [minutes, setMinutes] = useState(30);
  return (
    <div className="gate-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gate-card focus-card" role="dialog" aria-modal="true" aria-labelledby="focus-title">
        <span className="gate-icon" aria-hidden="true">
          <Timer weight="bold" />
        </span>
        <h2 id="focus-title">Focus mode</h2>
        <p>Pick a time and stay on the board. If you leave, I'll call you back.</p>
        <div className="focus-choices" role="radiogroup" aria-label="How long">
          {FOCUS_CHOICES.map((m) => (
            <button key={m} role="radio" aria-checked={minutes === m} className={minutes === m ? "on" : ""} onClick={() => setMinutes(m)}>
              {LABEL[m]}
            </button>
          ))}
        </div>
        <div className="gate-actions">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              fullscreen();
              onStart(minutes);
            }}
          >
            Start focus
          </button>
        </div>
      </div>
    </div>
  );
}

export function FocusMode({ endsAt, onEnd }: { endsAt: number; onEnd: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [away, setAway] = useState(false);
  const [callBack, setCallBack] = useState(false);
  const [strays, setStrays] = useState(0);
  const [done, setDone] = useState(false);
  const leftAt = useRef<number | null>(null);
  const awayMs = useRef(0);
  const nextLine = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!done && now >= endsAt) {
      setDone(true);
      say(3);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
  }, [now, endsAt, done]);

  useEffect(() => {
    if (done) return;
    const leave = () => {
      if (leftAt.current !== null) return;
      leftAt.current = Date.now();
      setAway(true);
      setStrays((n) => n + 1);
    };
    const back = () => {
      if (leftAt.current === null) return;
      awayMs.current += Date.now() - leftAt.current;
      leftAt.current = null;
      setAway(false);
      setCallBack(true);
      say(nextLine.current++ % 3);
    };
    // A click that opens a file picker or the print screen also takes focus away: not leaving.
    let clickedAt = 0;
    const onPointer = () => (clickedAt = Date.now());
    const onBlur = () => {
      if (Date.now() - clickedAt > 1500) leave();
    };
    const onVisibility = () => (document.hidden ? leave() : back());
    const onFullscreen = () => {
      if (!document.fullscreenElement && !document.hidden) {
        leave();
        back();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", back);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", back);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [done]);

  const left = Math.max(0, endsAt - now);
  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);
  const line = FOCUS_LINES[(nextLine.current + 2) % 3];

  if (done)
    return (
      <div className="gate-backdrop">
        <div className="gate-card focus-card" role="dialog" aria-modal="true" aria-labelledby="focus-done">
          <span className="gate-icon" aria-hidden="true">
            <Timer weight="bold" />
          </span>
          <h2 id="focus-done">{FOCUS_LINES[3].title}</h2>
          <p>{FOCUS_LINES[3].text}</p>
          <p className="focus-stat">
            {strays === 0 ? "You never left the board. Shabash!" : `You left the board ${strays} time${strays > 1 ? "s" : ""}, for about ${Math.max(1, Math.round(awayMs.current / 60000))} min in all.`}
          </p>
          <div className="gate-actions">
            <button className="btn-primary" onClick={onEnd} autoFocus>
              Close
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <>
      <div className="focus-chip" role="timer" aria-label={`Focus mode: ${mm} minutes ${ss} seconds left`}>
        <Timer weight="bold" /> {mm}:{String(ss).padStart(2, "0")}
        {strays > 0 && <span className="focus-strays">· left {strays}×</span>}
        <button
          onClick={() => {
            if (window.confirm("Stop focus mode early?")) onEnd();
          }}
          aria-label="Stop focus mode"
          title="Stop focus mode"
        >
          <X weight="bold" />
        </button>
      </div>
      {(away || callBack) && (
        <div className="gate-backdrop focus-callback">
          <div className="gate-card focus-card" role="alertdialog" aria-modal="true" aria-labelledby="focus-back">
            <span className="gate-icon" aria-hidden="true">
              <Eye weight="bold" />
            </span>
            <h2 id="focus-back">{line.title}</h2>
            <p>{line.text}</p>
            <div className="gate-actions">
              <button
                className="btn-primary"
                autoFocus
                onClick={() => {
                  setCallBack(false);
                  fullscreen();
                }}
              >
                I'm back
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
