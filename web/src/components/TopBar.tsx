import type { CallState } from "../lib/useVoiceCall";

interface Props {
  callState: CallState;
  volume: number;
  error: string | null;
  connected: boolean;
  sessionCode: string;
  onStart: () => void;
  onStop: () => void;
}

const STATUS: Record<CallState, string> = {
  idle: "Not in class",
  connecting: "Connecting…",
  ringing: "Calling your teacher…",
  active: "In class",
  ended: "Class ended",
};

export function TopBar({ callState, volume, error, connected, sessionCode, onStart, onStop }: Props) {
  const live = callState === "connecting" || callState === "ringing" || callState === "active";
  const speaking = callState === "active" && volume > 0.04;
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">श</span>
        <span className="brand-name">Shikshak</span>
      </div>

      <div className="call">
        <div className="tutor" data-speaking={speaking} data-live={callState === "active"} style={{ ["--vol" as string]: Math.min(1, volume * 3) }}>
          <span aria-hidden="true">श</span>
        </div>
        <div className="call-text">
          <span className="call-status">{speaking ? "Teacher is speaking" : STATUS[callState]}</span>
          {error ? <span className="call-error">{error}</span> : <span className="call-sub">{live ? "Interrupt any time. Say “check karo” when you're done." : "Press Start to begin"}</span>}
        </div>
        {live ? (
          <button className="btn-end" onClick={onStop}>End</button>
        ) : (
          <button className="btn-primary btn-call" onClick={onStart}>Start</button>
        )}
      </div>

      <div className="session" title="Links this screen to the voice call">
        <span className="dot" data-on={connected} />
        <span className="session-code">{sessionCode}</span>
      </div>
    </header>
  );
}
