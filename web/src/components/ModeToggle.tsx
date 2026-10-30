// Student / Teacher mode: a chalk switch in the top-left corner, and the board duster that rubs
// the board clean when the mode changes.

import { useEffect, useRef, useState } from "react";
import { ChalkboardTeacher, LockKey, Student } from "@phosphor-icons/react";

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

const UNLOCKED = "shikshak.teacherUnlocked";

/** True once the teacher code was entered in this tab. */
export function teacherUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCKED) === "1";
  } catch {
    return false;
  }
}

/**
 * Asks for the teacher access code before teacher mode opens. The server checks the code; the tab
 * remembers it until it is closed. This keeps students out of the teacher screens by accident; the
 * learners' data is still protected by their own share codes.
 */
export function TeacherGate({ onUnlock, onCancel }: { onUnlock: () => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !code) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/teacher/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      if (r.ok) {
        try {
          sessionStorage.setItem(UNLOCKED, "1");
        } catch {
          // private mode: we'll ask again next time
        }
        onUnlock();
        return;
      }
      setError(r.status === 429 ? "Too many tries. Wait a minute and try again." : "That code isn't right.");
      setCode("");
      input.current?.focus();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="gate-card" role="dialog" aria-modal="true" aria-labelledby="gate-title" onSubmit={submit}>
        <span className="gate-icon" aria-hidden="true">
          <LockKey weight="bold" />
        </span>
        <h2 id="gate-title" className="chalk">
          Teacher mode
        </h2>
        <p>Enter the teacher access code to continue.</p>
        <input
          ref={input}
          className="gate-input"
          inputMode="numeric"
          autoComplete="off"
          maxLength={12}
          aria-label="Access code"
          placeholder="••••••"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "gate-error" : undefined}
        />
        {error && (
          <p id="gate-error" className="gate-error" role="alert">
            {error}
          </p>
        )}
        <div className="gate-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !code}>
            {busy ? "Checking…" : "Unlock"}
          </button>
        </div>
      </form>
    </div>
  );
}
