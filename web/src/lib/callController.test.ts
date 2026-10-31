import { describe, expect, it, vi } from "vitest";
import { CallController, openMicMeter, type CallLike, type ControllerDeps } from "./callController";

/** A fake SDK call whose start() resolves only when the test says so. */
class FakeCall implements CallLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handlers = new Map<string, ((...a: any[]) => void)[]>();
  muted: boolean | null = null;
  stopped = 0;
  started = false;
  private resolveStart: () => void = () => {};
  private rejectStart: (e: Error) => void = () => {};
  constructor(public mint: () => Promise<{ session: unknown; callId: string | null }>) {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, fn: (...a: any[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    for (const fn of this.handlers.get(event) ?? []) fn(...args);
  }
  async start() {
    await this.mint();
    this.started = true;
    return new Promise<void>((res, rej) => {
      this.resolveStart = res;
      this.rejectStart = rej;
    });
  }
  connect() {
    this.emit("state-change", "active");
    this.emit("call-start");
    this.resolveStart();
  }
  fail(msg: string) {
    this.rejectStart(new Error(msg));
  }
  async stop() {
    this.stopped++;
  }
  setMuted(m: boolean) {
    this.muted = m;
  }
}

function setup() {
  const calls: FakeCall[] = [];
  const states: string[] = [];
  const ended: string[] = [];
  const errors: string[] = [];
  const talking: boolean[] = [];
  let n = 0;
  const deps: ControllerDeps = {
    createCall: (mint) => {
      const c = new FakeCall(mint);
      calls.push(c);
      return c;
    },
    mint: async () => ({ session: {}, callId: `call${++n}` }),
    reportEnd: (id) => ended.push(id),
    onState: (s) => states.push(s),
    onVolume: () => {},
    onTalking: (on) => talking.push(on),
    onError: (m) => errors.push(m),
  };
  return { ctrl: new CallController(deps), calls, states, ended, errors, talking };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const opts = { resuming: false, handsFree: false };

describe("call lifecycle", () => {
  it("starts muted for push-to-talk once connected", async () => {
    const t = setup();
    const p = t.ctrl.start(opts);
    await tick();
    t.calls[0].connect();
    await p;
    expect(t.calls[0].muted).toBe(true);
    expect(t.states).toEqual(["connecting", "active"]);
  });

  it("Pause while connecting: the call is hung up when it connects and never becomes active", async () => {
    const t = setup();
    const p = t.ctrl.start(opts);
    await tick();
    t.ctrl.stop(); // Pause pressed while the browser was still connecting
    t.calls[0].connect();
    await p;
    expect(t.calls[0].stopped).toBeGreaterThan(0);
    expect(t.states).not.toContain("active");
    expect(t.ended).toEqual(["call1"]); // the minted call is reported ended (no leaked minutes)
  });

  it("leaving the class during connection: nothing comes back to life", async () => {
    const t = setup();
    const p = t.ctrl.start(opts);
    await tick();
    t.ctrl.dispose();
    t.calls[0].connect();
    await p;
    expect(t.calls[0].stopped).toBeGreaterThan(0);
    expect(t.states).not.toContain("active");
    await t.ctrl.start(opts); // a disposed controller can't start again
    expect(t.calls).toHaveLength(1);
  });

  it("repeated Resume: only the newest call survives, older ones are stopped and reported once", async () => {
    const t = setup();
    const a = t.ctrl.start(opts);
    await tick();
    const b = t.ctrl.start({ ...opts, resuming: true });
    await tick();
    t.calls[0].connect();
    t.calls[1].connect();
    await Promise.all([a, b]);
    expect(t.calls[0].stopped).toBeGreaterThan(0);
    expect(t.calls[1].stopped).toBe(0);
    expect(t.ctrl.current).toBe(t.calls[1]);
    expect(t.ended).toEqual(["call1"]);
    t.ctrl.stop();
    expect(t.ended).toEqual(["call1", "call2"]);
    t.ctrl.stop();
    expect(t.ended).toEqual(["call1", "call2"]); // reported once
  });

  it("ignores events from a call that has been replaced", async () => {
    const t = setup();
    const a = t.ctrl.start(opts);
    await tick();
    const b = t.ctrl.start(opts);
    await tick();
    t.calls[1].connect();
    await b;
    t.states.length = 0;
    t.calls[0].emit("state-change", "ended");
    t.calls[0].emit("error", { message: "old call failed" });
    expect(t.states).toEqual([]);
    expect(t.errors).toEqual([]);
    t.calls[0].connect();
    await a;
  });

  it("push-to-talk is released and the mic muted when the class pauses mid-sentence", async () => {
    const t = setup();
    const p = t.ctrl.start(opts);
    await tick();
    t.calls[0].connect();
    await p;
    t.ctrl.talk(true);
    expect(t.calls[0].muted).toBe(false);
    expect(t.ctrl.isTalking()).toBe(true);
    t.ctrl.stop();
    expect(t.ctrl.isTalking()).toBe(false);
    expect(t.calls[0].muted).toBe(true);
    expect(t.talking).toEqual([true, false]);
  });

  it("a remote hang-up releases push-to-talk and reports the end", async () => {
    const t = setup();
    const p = t.ctrl.start(opts);
    await tick();
    t.calls[0].connect();
    await p;
    t.ctrl.talk(true);
    t.calls[0].emit("call-end");
    expect(t.ctrl.isTalking()).toBe(false);
    expect(t.ended).toEqual(["call1"]);
  });

  it("a failed start shows the error and leaves the class idle", async () => {
    const t = setup();
    const p = t.ctrl.start(opts);
    await tick();
    t.calls[0].fail("Microphone permission denied");
    await p;
    expect(t.errors).toEqual(["Microphone permission denied"]);
    expect(t.states.at(-1)).toBe("idle");
  });
});

describe("microphone meter", () => {
  const track = () => ({ stop: vi.fn() });

  it("stops the tracks if permission arrives after the class paused", async () => {
    const tracks = [track(), track()];
    let grant: (s: MediaStream) => void = () => {};
    const createAnalyser = vi.fn();
    const cleanup = openMicMeter({
      getUserMedia: () => new Promise((r) => (grant = r)),
      createAnalyser,
      onLevel: () => {},
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id),
    });
    cleanup(); // paused while the browser was still asking for permission
    grant({ getTracks: () => tracks } as unknown as MediaStream);
    await tick();
    for (const t of tracks) expect(t.stop).toHaveBeenCalled();
    expect(createAnalyser).not.toHaveBeenCalled();
  });

  it("cleans up the analyser, timer and tracks on stop", async () => {
    const tracks = [track()];
    const close = vi.fn();
    const cleared = vi.fn();
    const cleanup = openMicMeter({
      getUserMedia: async () => ({ getTracks: () => tracks }) as unknown as MediaStream,
      createAnalyser: () => ({ read: () => 0.05, close }),
      onLevel: () => {},
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => {
        cleared();
        clearInterval(id);
      },
    });
    await tick();
    cleanup();
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(cleared).toHaveBeenCalled();
  });
});
