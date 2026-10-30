// Student / Teacher mode: a chalk switch in the top-left corner, and the board duster that rubs
// the board clean when the mode changes.

import { useEffect, useRef } from "react";
import { ChalkboardTeacher, Student } from "@phosphor-icons/react";

export type Mode = "student" | "teacher";

export function ModeToggle({ mode, onSwitch }: { mode: Mode; onSwitch: (to: Mode) => void }) {
  const teacher = mode === "teacher";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={teacher}
      aria-label="Teacher mode"
      className="mode-toggle"
      data-mode={mode}
      onClick={() => onSwitch(teacher ? "student" : "teacher")}
    >
      <span className="mode-knob" aria-hidden="true" />
      <span className="mode-option" data-on={!teacher}>
        <Student weight="bold" /> Student
      </span>
      <span className="mode-option" data-on={teacher}>
        <ChalkboardTeacher weight="bold" /> Teacher
      </span>
    </button>
  );
}

const BANDS = 5;
const STROKE_MS = 240;

/**
 * Covers the screen with a clean board, one duster stroke at a time (left to right, then back),
 * calls onCovered when the board is clean (switch the page then, underneath), and fades away.
 * With reduced motion it skips straight to the end.
 */
export function DusterWipe({ onCovered, onDone }: { onCovered: () => void; onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const duster = useRef<HTMLDivElement>(null);
  const done = useRef({ onCovered, onDone });

  useEffect(() => {
    const el = root.current;
    const d = duster.current;
    if (!el || !d) return;
    const finish = () => {
      done.current.onCovered();
      const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: "ease-out", fill: "forwards" });
      fade.onfinish = () => done.current.onDone();
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      done.current.onCovered();
      done.current.onDone();
      return;
    }
    const bands = Array.from(el.querySelectorAll<HTMLElement>(".wipe-band"));
    const w = el.clientWidth;
    const h = el.clientHeight / BANDS;
    const anims: Animation[] = [];
    bands.forEach((band, i) => {
      const rightward = i % 2 === 0;
      const delay = i * STROKE_MS;
      band.style.transformOrigin = rightward ? "left center" : "right center";
      anims.push(band.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: STROKE_MS, delay, easing: "cubic-bezier(.45,.05,.55,.95)", fill: "both" }));
      const y = h * i + h / 2 - 34;
      const from = rightward ? -160 : w + 20;
      const to = rightward ? w + 20 : -160;
      anims.push(
        d.animate(
          [
            { transform: `translate(${from}px, ${y}px) rotate(${rightward ? -8 : 8}deg)` },
            { transform: `translate(${to}px, ${y + 10}px) rotate(${rightward ? 6 : -6}deg)` },
          ],
          { duration: STROKE_MS, delay, easing: "cubic-bezier(.45,.05,.55,.95)", fill: i === bands.length - 1 ? "forwards" : "none" },
        ),
      );
    });
    const last = anims[anims.length - 1];
    last.onfinish = finish;
    return () => anims.forEach((a) => a.cancel());
  }, []);

  return (
    <div className="duster-wipe" ref={root} aria-hidden="true">
      {Array.from({ length: BANDS }, (_, i) => (
        <div key={i} className="wipe-band" style={{ top: `${(100 / BANDS) * i}%`, height: `${100 / BANDS + 0.5}%` }} />
      ))}
      <div className="duster" ref={duster}>
        <span className="duster-dust" />
      </div>
    </div>
  );
}
