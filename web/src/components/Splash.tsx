// The start screen: Shikshak in chalk in the middle of the board, and one button to begin.
// Shown every time the site is opened or reloaded on the home page; going back to home from inside
// the app doesn't show it again.

import { ArrowRight } from "@phosphor-icons/react";

/** Set by the browser tests to skip the start screen. */
const SKIP = "shikshak.test.skipSplash";

export function splashDue(): boolean {
  try {
    return sessionStorage.getItem(SKIP) !== "1";
  } catch {
    return true;
  }
}

export function Splash({ onStart }: { onStart: () => void }) {
  const start = () => onStart();
  return (
    <main className="home home-board splash">
      <div className="splash-centre">
        <span className="splash-tile" aria-hidden="true">
          श
        </span>
        <h1 className="splash-title chalk">Shikshak</h1>
        <p className="splash-line chalk">Shikshak, your own tutor</p>
        <button className="btn-primary splash-start" onClick={start} autoFocus>
          Start Shiksha <ArrowRight weight="bold" />
        </button>
      </div>
    </main>
  );
}
