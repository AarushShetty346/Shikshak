import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "../shared/types";

// Stand-in for the Claude call so tests are free and deterministic.
const checkWorkMock = vi.fn();
vi.mock("./checkWork", () => ({ checkWork: (...args: unknown[]) => checkWorkMock(...args) }));

const { createApp } = await import("./app");
const { resetSessions } = await import("./sessions");

let server: Server;
let base: string;

beforeAll(async () => {
  const { app, attachWebSocket } = createApp();
  server = createServer(app);
  attachWebSocket(server);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  resetSessions();
  checkWorkMock.mockReset();
  delete process.env.TOOLS_TOKEN;
});

/** Opens a "browser tab" for a session and collects the messages it receives. */
async function openTab(code: string) {
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws?code=${code}`);
  const messages: ServerMessage[] = [];
  ws.on("message", (d) => messages.push(JSON.parse(String(d))));
  await new Promise((r) => ws.on("open", r));
  await vi.waitFor(() => expect(messages[0]?.kind).toBe("welcome"));
  const events = () => messages.filter((m) => m.kind === "board").map((m) => (m as { event: { type: string } }).event);
  return { ws, messages, events };
}

const post = (tool: string, body: unknown) =>
  fetch(`${base}/tools/${tool}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) =>
    r.json(),
  );

describe("tool endpoints", () => {
  it("show_steps writes steps to the right tab", async () => {
    const tab = await openTab("ABC123");
    const res = await post("show_steps", { session_code: "abc123", title: "Factorise", steps: "x^2 - 5x + 6 = 0 || (x-2)(x-3) = 0" });
    expect(res.ok).toBe(true);
    await vi.waitFor(() => expect(tab.events()).toHaveLength(1));
    expect(tab.events()[0]).toMatchObject({ type: "steps", title: "Factorise", steps: ["x^2 - 5x + 6 = 0", "(x-2)(x-3) = 0"] });
    tab.ws.close();
  });

  it("falls back to the latest connected tab when the code is mangled", async () => {
    const tab = await openTab("XYZ789");
    const res = await post("give_problem", { session_code: "XYZ78", problem: "Solve: 2x + 3 = 7" });
    expect(res.ok).toBe(true);
    await vi.waitFor(() => expect(tab.events()[0]).toMatchObject({ type: "problem", problem: "Solve: 2x + 3 = 7" }));
    tab.ws.close();
  });

  it("accepts params as a GET query string", async () => {
    const tab = await openTab("QRY111");
    const r = await fetch(`${base}/tools/clear_board?session_code=QRY111`).then((x) => x.json());
    expect(r.ok).toBe(true);
    await vi.waitFor(() => expect(tab.events()[0]).toMatchObject({ type: "clear" }));
    tab.ws.close();
  });

  it("check_work asks the tab for a fresh snapshot, then circles the wrong line", async () => {
    const tab = await openTab("CHK222");
    await post("give_problem", { session_code: "CHK222", problem: "Solve: x^2 - 7x + 12 = 0", answer: "x = 3 or x = 4" });
    // The tab answers a "checking" event with its notebook, like the real browser does.
    tab.ws.on("message", (d) => {
      const m = JSON.parse(String(d)) as ServerMessage;
      if (m.kind === "board" && m.event.type === "checking") {
        tab.ws.send(JSON.stringify({ kind: "canvas", png: "data:image/png;base64,AAAA", lineCount: 3 }));
      }
    });
    process.env.ANTHROPIC_API_KEY ||= "test-key";
    checkWorkMock.mockResolvedValue({ status: "mistake", line: 2, what_went_wrong: "Sign error", say: "Step 2 mein sign dekho." });

    const res = await post("check_work", { session_code: "CHK222" });
    expect(res).toMatchObject({ status: "mistake", line: 2, say: "Step 2 mein sign dekho." });
    expect(checkWorkMock).toHaveBeenCalledWith(
      expect.objectContaining({ lineCount: 3, problem: "Solve: x^2 - 7x + 12 = 0", answer: "x = 3 or x = 4" }),
    );
    await vi.waitFor(() => expect(tab.events().map((e) => e.type)).toEqual(["problem", "checking", "mark"]));
    tab.ws.close();
  });

  it("check_work on an empty notebook says so without calling the checker", async () => {
    const tab = await openTab("EMP333");
    const res = await post("check_work", { session_code: "EMP333" });
    expect(res.status).toBe("empty");
    expect(checkWorkMock).not.toHaveBeenCalled();
    tab.ws.close();
  });

  it("reports a missing screen instead of failing", async () => {
    const res = await post("show_steps", { session_code: "NOPE", steps: "a" });
    expect(res.ok).toBe(false);
  });

  it("rejects calls without the token when TOOLS_TOKEN is set", async () => {
    process.env.TOOLS_TOKEN = "secret";
    const r = await fetch(`${base}/tools/clear_board`, { method: "POST" });
    expect(r.status).toBe(401);
    const ok = await fetch(`${base}/tools/clear_board`, { method: "POST", headers: { Authorization: "Bearer secret" } });
    expect(ok.status).toBe(200);
  });

  it("replays the board to a tab that reconnects", async () => {
    const first = await openTab("RPL444");
    await post("show_steps", { session_code: "RPL444", steps: "a || b" });
    first.ws.close();
    const again = await openTab("RPL444");
    const welcome = again.messages[0] as Extract<ServerMessage, { kind: "welcome" }>;
    expect(welcome.replay.map((e) => e.type)).toEqual(["steps"]);
    again.ws.close();
  });
});

describe("check_work without a checker", () => {
  it("clears the checking state on screen", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const tab = await openTab("NOK555");
    tab.ws.on("message", (d) => {
      const m = JSON.parse(String(d)) as ServerMessage;
      if (m.kind === "board" && m.event.type === "checking") tab.ws.send(JSON.stringify({ kind: "canvas", png: "data:image/png;base64,AAAA", lineCount: 2 }));
    });
    const res = await post("check_work", { session_code: "NOK555" });
    expect(res.ok).toBe(false);
    await vi.waitFor(() => expect(tab.events().map((e) => e.type)).toEqual(["checking", "unclear"]));
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
    tab.ws.close();
  });
});

describe("phone call fallback", () => {
  it("explains what's missing when Bolna isn't configured", async () => {
    const saved = { k: process.env.BOLNA_API_KEY, a: process.env.BOLNA_AGENT_ID };
    delete process.env.BOLNA_API_KEY;
    delete process.env.BOLNA_AGENT_ID;
    const r = await fetch(`${base}/api/phone-call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "9876543210" }) });
    expect(r.status).toBe(503);
    if (saved.k) process.env.BOLNA_API_KEY = saved.k;
    if (saved.a) process.env.BOLNA_AGENT_ID = saved.a;
  });

  it("rejects a bad number before calling Bolna", async () => {
    process.env.BOLNA_API_KEY ||= "test";
    process.env.BOLNA_AGENT_ID ||= "test";
    const r = await fetch(`${base}/api/phone-call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "123" }) });
    expect(r.status).toBe(400);
  });
});
