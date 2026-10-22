import { useCallback, useEffect, useRef, useState } from "react";
import { BolnaWebCall } from "@bolna/web-call";

export type CallState = "idle" | "connecting" | "ringing" | "active" | "ended";

/** Wraps Bolna's Web Call SDK: start from a click, track state, expose the tutor's voice volume. */
export function useVoiceCall() {
  const callRef = useRef<BolnaWebCall | null>(null);
  const [state, setState] = useState<CallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);

  const start = useCallback(async (userData: Record<string, unknown>) => {
    setError(null);
    try {
      callRef.current?.stop();
      const call = new BolnaWebCall({ sessionUrl: "/api/bolna-session", userData });
      call.on("state-change", (s) => setState(s as CallState));
      call.on("volume-level", (v) => setVolume(v));
      call.on("call-end", () => setVolume(0));
      call.on("error", (e) => setError(friendlyError(e.code, e.message)));
      callRef.current = call;
      await call.start();
    } catch (err) {
      const e = err as { code?: string; message?: string };
      setError(friendlyError(e.code, e.message));
      setState("idle");
    }
  }, []);

  const stop = useCallback(() => {
    callRef.current?.stop();
  }, []);

  useEffect(() => () => void callRef.current?.stop(), []);

  return { state, error, volume, start, stop };
}

function friendlyError(code?: string, message?: string): string {
  switch (code) {
    case "microphone_denied":
      return "Microphone is blocked. Allow it in the address bar, then try again.";
    case "at_capacity":
      return "All lines are busy. Try again in a minute.";
    case "autoplay_blocked":
      return "The browser blocked audio. Click Start again.";
    case "mint_failed":
      return message?.includes("503") || message?.includes("not set up")
        ? "Voice isn't set up on the server yet (Bolna keys missing)."
        : "Couldn't start the call. Check the server's Bolna settings.";
    default:
      return message || "Something went wrong with the call.";
  }
}
