// The start screen: Shikshak in chalk in the middle of the board, and one button to begin.
// Shown once per visit (each new tab), before the rest of the app.

import { ArrowRight } from "@phosphor-icons/react";

const SEEN = "shikshak.splashSeen";

export function splashDue(): boolean {
  try {
    return sessionStorage.getItem(SEEN) !== "1";
  } catch {
    return false;
  }
}

export function Splash({ onStart }: { onStart: () => void }) {
  const start = () => {
    try {
      sessionStorage.setItem(SEEN, "1");
    } catch {
      // private mode: the start screen may show again next time
    }
    onStart();
  };
  return (
    <main className="home home-board splash">
      <div className="splash-centre">
        <span className="splash-tile" aria-hidden="true">
          श
        </span>
        <h1 className="splash-title chalk">Shikshak</h1>
        <p className="splash-line chalk">I am Shikshak, your tutor.</p>
        <button className="btn-primary splash-start" onClick={start} autoFocus>
          Start Shiksha <ArrowRight weight="bold" />
        </button>
      </div>
    </main>
  );
}
