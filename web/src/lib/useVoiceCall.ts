import { useCallback, useEffect, useRef, useState } from "react";
import { BolnaWebCall } from "@bolna/web-call";

export type CallState = "idle" | "connecting" | "ringing" | "active" | "ended";

/** The bits of SIP.js's session we use for keypad tones. */
interface SipSession {
  sessionDescriptionHandler?: { sendDtmf?: (tones: string) => boolean };
  info?: (options: unknown) => Promise<unknown>;
}

/** Wraps Bolna's Web Call SDK: start from a click, track state, expose the tutor's voice volume. */
export function useVoiceCall() {
  const callRef = useRef<BolnaWebCall | null>(null);
  const [state, setState] = useState<CallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);
  // Our own audio element for the tutor's voice, so "Ask doubt" can silence her instantly.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ducked = useRef(false);
  const quietSince = useRef(0);

  const start = useCallback(async (userData: Record<string, unknown>) => {
    setError(null);
    try {
      callRef.current?.stop();
      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.autoplay = true;
      }
      audioRef.current.volume = 1;
      ducked.current = false;
      const call = new BolnaWebCall({ sessionUrl: "/api/bolna-session", userData, audioElement: audioRef.current });
      call.on("state-change", (s) => setState(s as CallState));
      call.on("volume-level", (v) => {
        setVolume(v);
        // After "Ask doubt", stay silent until the tutor's current sentence has finished, then
        // bring her voice back for her reply.
        if (!ducked.current) return;
        if (v > 0.02) quietSince.current = 0;
        else if (!quietSince.current) quietSince.current = Date.now();
        else if (Date.now() - quietSince.current > 700 && audioRef.current) {
          ducked.current = false;
          audioRef.current.volume = 1;
        }
      });
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

  /**
   * Sends keypad tones (DTMF) on the call. Bolna hands keypad digits to the tutor's LLM as
   * "dtmf_number: <digits>" when the agent has dtmf_enabled. The SDK keeps its SIP.js session
   * private, so we reach in carefully. Returns false if no call is live or tones couldn't be sent.
   */
  const sendTones = useCallback((tones: string): boolean => {
    const inviter = (callRef.current as unknown as { inviter?: SipSession } | null)?.inviter;
    if (!inviter) return false;
    try {
      if (inviter.sessionDescriptionHandler?.sendDtmf?.(tones)) return true;
    } catch {
      // fall through to SIP INFO
    }
    try {
      for (const tone of tones.split("")) {
        void inviter.info?.({
          requestOptions: {
            body: { contentDisposition: "render", contentType: "application/dtmf-relay", content: `Signal=${tone}\r\nDuration=160` },
          },
        });
      }
      return Boolean(inviter.info);
    } catch {
      return false;
    }
  }, []);

  /** Student pressed Done: "dtmf_number: 1" reaches the tutor. */
  const sendDone = useCallback(() => sendTones("1#"), [sendTones]);

  /**
   * Student pressed "Ask doubt": the tutor goes quiet at once on this screen, and
   * "dtmf_number: 2" tells her to stop and listen.
   */
  const askDoubt = useCallback((): boolean => {
    if (audioRef.current) {
      audioRef.current.volume = 0;
      ducked.current = true;
      quietSince.current = 0;
    }
    return sendTones("2#");
  }, [sendTones]);

  const stop = useCallback(() => {
    callRef.current?.stop();
  }, []);

  useEffect(() => () => void callRef.current?.stop(), []);

  return { state, error, volume, start, stop, sendDone, askDoubt };
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
