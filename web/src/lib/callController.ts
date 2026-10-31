// The voice call's lifecycle, without React, so it can be tested. One controller per open class.
//
// Rules it guarantees:
//  - Every start() gets a token. stop() (Pause), dispose() (leaving the class) or a newer start()
//    invalidates it; a call that finishes connecting with an old token is hung up at once.
//  - Only the current call can change state; events from an old call are ignored.
//  - Push-to-talk is released (and the mic muted) when the call stops, ends or is replaced.
//  - The server is told when a call ends (once), for voice-time limits.

export type CallState = "idle" | "connecting" | "ringing" | "active" | "ended";

/** The parts of Bolna's web-call SDK we use (so tests can pass a fake). */
export interface CallLike {
  on(event: "state-change", fn: (s: string) => void): unknown;
  on(event: "volume-level", fn: (v: number) => void): unknown;
  on(event: "call-end", fn: () => void): unknown;
  on(event: "error", fn: (e: { code?: string; message?: string }) => void): unknown;
  on(event: "call-start", fn: () => void): unknown;
  start(): Promise<void>;
  stop(): Promise<void>;
  setMuted(muted: boolean): void;
}

export interface ControllerDeps {
  /** Creates the SDK call object; `mint` fetches the session from our server. */
  createCall: (mint: () => Promise<{ session: unknown; callId: string | null }>) => CallLike;
  /** POST /api/sessions/:id/voice. Throws an Error with a readable message on failure. */
  mint: (opts: { resuming: boolean }) => Promise<{ session: unknown; callId: string | null }>;
  /** Tells the server the call ended. */
  reportEnd: (callId: string) => void;
  onState: (s: CallState) => void;
  onVolume: (v: number) => void;
  onTalking: (on: boolean) => void;
  onError: (message: string) => void;
}

export class CallController {
  private call: CallLike | null = null;
  private token = 0;
  private callId: string | null = null;
  private talking = false;
  private handsFree = false;
  private releaseTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private deps: ControllerDeps) {}

  get current(): CallLike | null {
    return this.call;
  }

  isTalking() {
    return this.talking;
  }

  async start(opts: { resuming: boolean; handsFree: boolean }) {
    if (this.disposed) return;
    const token = ++this.token;
    this.teardown();
    this.handsFree = opts.handsFree;
    this.deps.onState("connecting");
    const mint = async () => {
      const r = await this.deps.mint({ resuming: opts.resuming });
      if (token === this.token) this.callId = r.callId;
      else if (r.callId) this.deps.reportEnd(r.callId); // minted for a start that was cancelled
      return r;
    };
    const call = this.deps.createCall(mint);
    const alive = () => token === this.token && this.call === call && !this.disposed;
    call.on("state-change", (s) => alive() && this.deps.onState(s as CallState));
    call.on("volume-level", (v) => alive() && this.deps.onVolume(v));
    call.on("call-end", () => {
      if (!alive()) return;
      this.deps.onVolume(0);
      this.setTalking(false);
      this.report();
    });
    call.on("error", (e) => alive() && this.deps.onError(e.message || "Something went wrong with the call."));
    call.on("call-start", () => {
      if (alive() && !this.handsFree) call.setMuted(true);
    });
    this.call = call;
    try {
      await call.start();
    } catch (err) {
      if (token !== this.token || this.disposed) return;
      this.deps.onError((err as Error).message || "Couldn't start the class.");
      this.teardown();
      this.deps.onState("idle");
      return;
    }
    if (!alive()) {
      // Paused, left, or restarted while connecting: this call must not come back to life.
      void call.stop();
      return;
    }
    if (!this.handsFree) call.setMuted(true);
  }

  /** Pause: cancels a start in progress and hangs up. */
  stop() {
    this.token++;
    this.teardown();
    this.deps.onState("ended");
  }

  /** Leaving the class: like stop, and the controller can't start again. */
  dispose() {
    this.disposed = true;
    this.token++;
    this.teardown();
  }

  talk(on: boolean) {
    const call = this.call;
    clearTimeout(this.releaseTimer);
    if (!call) return this.setTalking(false);
    if (on) {
      call.setMuted(false);
      this.setTalking(true);
      return;
    }
    if (!this.talking) return;
    this.setTalking(false);
    // Keep the mic open a moment so the last word isn't cut off.
    this.releaseTimer = setTimeout(() => {
      if (!this.handsFree && this.call === call) call.setMuted(true);
    }, 350);
  }

  setHandsFree(on: boolean) {
    this.handsFree = on;
    this.call?.setMuted(!on);
  }

  private setTalking(on: boolean) {
    if (this.talking === on) return;
    this.talking = on;
    this.deps.onTalking(on);
  }

  private report() {
    const id = this.callId;
    this.callId = null;
    if (id) this.deps.reportEnd(id);
  }

  private teardown() {
    clearTimeout(this.releaseTimer);
    const call = this.call;
    this.call = null;
    this.setTalking(false);
    this.deps.onVolume(0);
    if (call) {
      try {
        call.setMuted(true);
      } catch {
        // not connected yet
      }
      void call.stop();
    }
    this.report();
  }
}

// ---------- the local microphone meter ----------

export interface MicDeps {
  getUserMedia: () => Promise<MediaStream>;
  createAnalyser: (stream: MediaStream) => { read: () => number; close: () => void };
  onLevel: (level: number) => void;
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (id: ReturnType<typeof setInterval>) => void;
}

/**
 * Opens a local-only reading of the mic for the speaking indicator. Returns a cleanup function that
 * stops everything. If permission arrives after cleanup (the class paused while the browser was
 * asking), the tracks are stopped at once instead of leaking an open mic.
 */
export function openMicMeter(deps: MicDeps): () => void {
  let stopped = false;
  let stream: MediaStream | null = null;
  let analyser: { read: () => number; close: () => void } | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  void deps
    .getUserMedia()
    .then((got) => {
      if (stopped) {
        got.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = got;
      analyser = deps.createAnalyser(got);
      let smooth = 0;
      timer = deps.setInterval(() => {
        const rms = analyser!.read();
        // Map speech (~0.01-0.15 RMS) to 0..1 and smooth it so the indicator doesn't flicker.
        const target = Math.min(1, Math.max(0, (rms - 0.008) * 9));
        smooth = smooth * 0.6 + target * 0.4;
        deps.onLevel(Number(smooth.toFixed(3)));
      }, 80);
    })
    .catch(() => {
      // No mic access for the meter: the indicator just won't show the student's level.
    });
  return () => {
    stopped = true;
    if (timer !== undefined) deps.clearInterval(timer);
    (stream as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    (analyser as { close: () => void } | null)?.close();
    deps.onLevel(0);
  };
}
