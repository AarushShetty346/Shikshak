import { useCallback, useEffect, useRef, useState } from "react";
import { BolnaWebCall, type Session as BolnaSession } from "@bolna/web-call";
import { deviceToken } from "./api";
import { CallController, type CallState } from "./callController";

export type { CallState };

/** The bits of SIP.js's session we use for keypad tones. */
interface SipSession {
  sessionDescriptionHandler?: { sendDtmf?: (tones: string) => boolean };
  info?: (options: unknown) => Promise<unknown>;
}

export interface StartOptions {
  resuming: boolean;
  handsFree: boolean;
}

/**
 * React wrapper around CallController (callController.ts has the lifecycle rules): Bolna's web-call
 * SDK with our authenticated minting, the tutor's volume for pacing, and the "Stop" duck.
 */
export function useVoiceCall(serverId: string | null) {
  const [state, setState] = useState<CallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);
  const [talking, setTalking] = useState(false);
  // Our own audio element for the tutor's voice, so "Stop" can silence her instantly.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ducked = useRef(false);
  const quietSince = useRef(0);

  const ctrlRef = useRef<CallController | null>(null);
  if (!ctrlRef.current && serverId) {
    const id = serverId;
    ctrlRef.current = new CallController({
      createCall: (mint) => {
        if (!audioRef.current) {
          audioRef.current = new Audio();
          audioRef.current.autoplay = true;
        }
        audioRef.current.volume = 1;
        ducked.current = false;
        return new BolnaWebCall({ getSession: async () => (await mint()).session as BolnaSession, audioElement: audioRef.current });
      },
      mint: async ({ resuming }) => {
        const r = await fetch(`/api/sessions/${id}/voice`, {
          method: "POST",
          headers: { Authorization: `Bearer ${await deviceToken()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ resuming }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((data as { error?: string }).error || "Couldn't start the class. Try again in a moment.");
        return { session: data, callId: r.headers.get("X-Shikshak-Call") };
      },
      reportEnd: (callId) => {
        void deviceToken()
          .then((token) =>
            fetch(`/api/sessions/${id}/voice/end`, {
              method: "POST",
              keepalive: true,
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ callId }),
            }),
          )
          .catch(() => {});
      },
      onState: setState,
      onVolume: (v) => {
        setVolume(v);
        // After "Stop", stay silent until the tutor's current sentence has finished, then bring her back.
        if (!ducked.current) return;
        if (v > 0.02) quietSince.current = 0;
        else if (!quietSince.current) quietSince.current = Date.now();
        else if (Date.now() - quietSince.current > 700 && audioRef.current) {
          ducked.current = false;
          audioRef.current.volume = 1;
        }
      },
      onTalking: setTalking,
      onError: (m) => setError(friendlyError(m)),
    });
  }

  useEffect(() => () => ctrlRef.current?.dispose(), []);

  /** Silence the tutor on this screen now; her voice returns once her current sentence has ended. */
  const duck = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.volume = 0;
      ducked.current = true;
      quietSince.current = 0;
    }
  }, []);

  const start = useCallback(async (opts: StartOptions) => {
    setError(null);
    await ctrlRef.current?.start(opts);
  }, []);

  const stop = useCallback(() => ctrlRef.current?.stop(), []);

  /**
   * Sends keypad tones (DTMF) on the call. Bolna hands keypad digits to the tutor's LLM as
   * "dtmf_number: <digits>" when the agent has dtmf_enabled. The SDK keeps its SIP.js session
   * private, so we reach in carefully. Returns false if no call is live or tones couldn't be sent.
   */
  const sendTones = useCallback((tones: string): boolean => {
    const inviter = (ctrlRef.current?.current as unknown as { inviter?: SipSession } | null)?.inviter;
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

  /** Stop the teacher: she goes quiet at once on this screen, and "dtmf_number: 2" tells her to stop and listen. */
  const askDoubt = useCallback((): boolean => {
    duck();
    return sendTones("2#");
  }, [duck, sendTones]);

  /** Push-to-talk: open the mic while held (and silence the tutor), close it shortly after release. */
  const talk = useCallback(
    (on: boolean) => {
      if (on) duck();
      ctrlRef.current?.talk(on);
    },
    [duck],
  );

  const setHandsFree = useCallback((on: boolean) => ctrlRef.current?.setHandsFree(on), []);
  const isTalking = useCallback(() => Boolean(ctrlRef.current?.isTalking()), []);

  return { state, error, volume, talking, start, stop, sendDone, askDoubt, talk, setHandsFree, sendTones, isTalking };
}

function friendlyError(message: string): string {
  if (/microphone|NotAllowed|Permission/i.test(message)) return "Microphone is blocked. Allow it in the address bar, then try again.";
  if (/at_capacity|busy/i.test(message)) return "All lines are busy. Try again in a minute.";
  if (/autoplay/i.test(message)) return "The browser blocked audio. Click Start again.";
  return message || "Something went wrong with the call.";
}
