import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { BoardEvent, ServerMessage } from "../shared/types";

// Stand-in for the vision model and planner, so tests are free and deterministic.
const askJson = vi.fn();
let modelOn = true;
vi.mock("./llm", () => ({
  askJson: (...args: unknown[]) => askJson(...args),
  hasModel: () => modelOn,
  modelName: () => "test-model",
  dataUrlToAttachment: (url: string) => ({ mediaType: "image/png", data: url.split(",")[1] }),
}));

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
  askJson.mockReset();
  modelOn = true;
  delete process.env.TOOLS_TOKEN;
  delete process.env.FAKE_CHECKER;
});

const MISTAKE = { kind: "working", reading: "1) ...", status: "mistake", line: 2, what_went_wrong: "Sign error", say: "Step 2 mein sign dekho." };

/** Opens a "browser tab" for a session. It answers "checking" with the given drawing, like the real board. */
async function openTab(code: string, drawing: { png: string; lineCount: number } | null = null) {
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws?code=${code}`);
  const messages: ServerMessage[] = [];
  let captures = 0;
  ws.on("message", (d) => {
    const m = JSON.parse(String(d)) as ServerMessage;
    messages.push(m);
    if (m.kind === "board" && m.event.type === "checking" && drawing) {
      ws.send(JSON.stringify({ kind: "capture", id: `req${++captures}`, reason: "request", ...drawing }));
    }
  });
  await new Promise((r) => ws.on("open", r));
  await vi.waitFor(() => expect(messages[0]?.kind).toBe("welcome"));
  const events = () => messages.filter((m) => m.kind === "board").map((m) => (m as { event: BoardEvent }).event);
  const done = (id: string) => ws.send(JSON.stringify({ kind: "capture", id, reason: "done", ...drawing }));
  return { ws, messages, events, done };
}

const post = (tool: string, body: unknown) =>
  fetch(`${base}/tools/${tool}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) =>
    r.json(),
  );

describe("board tools", () => {
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

  it("clear_board opens a new page instead of wiping (GET query string works too)", async () => {
    const tab = await openTab("QRY111");
    const r = await fetch(`${base}/tools/clear_board?session_code=QRY111`).then((x) => x.json());
    expect(r.ok).toBe(true);
    await vi.waitFor(() => expect(tab.events()[0]).toMatchObject({ type: "page" }));
    tab.ws.close();
  });

  it("look_at_board asks for the latest work, reads it, and circles the wrong line of that capture", async () => {
    const tab = await openTab("CHK222", { png: "data:image/png;base64,AAAA", lineCount: 3 });
    await post("give_problem", { session_code: "CHK222", problem: "Solve: x^2 - 7x + 12 = 0", answer: "x = 3 or x = 4" });
    askJson.mockResolvedValue(MISTAKE);

    const res = await post("look_at_board", { session_code: "CHK222", student_said: "is this right?" });
    expect(res).toMatchObject({ status: "mistake", line: 2, say: "Step 2 mein sign dekho." });
    const req = askJson.mock.calls[0][0] as { text: string };
    expect(req.text).toContain("Solve: x^2 - 7x + 12 = 0");
    expect(req.text).toContain("is this right?");
    await vi.waitFor(() => expect(tab.events().map((e) => e.type)).toEqual(["problem", "checking", "mark"]));
    expect(tab.events()[2]).toMatchObject({ type: "mark", captureId: "req1", line: 2 });
    tab.ws.close();
  });

  it("pressing Done starts reading right away, so the tutor's look reuses it", async () => {
    const tab = await openTab("DONE01", { png: "data:image/png;base64,BBBB", lineCount: 2 });
    let finish: (v: unknown) => void = () => {};
    askJson.mockReturnValue(new Promise((r) => (finish = r)));
    tab.done("done1");
    await vi.waitFor(() => expect(askJson).toHaveBeenCalledTimes(1)); // started before the tutor asked
    finish(MISTAKE);
    const res = await post("look_at_board", { session_code: "DONE01" });
    expect(res.status).toBe("mistake");
    expect(askJson).toHaveBeenCalledTimes(1); // same drawing, same analysis
    tab.ws.close();
  });

  it("an empty board says so without calling the model", async () => {
    const tab = await openTab("EMP333", { png: "", lineCount: 0 });
    const res = await post("look_at_board", { session_code: "EMP333" });
    expect(res.status).toBe("empty");
    expect(askJson).not.toHaveBeenCalled();
    tab.ws.close();
  });

  it("check_work still works for older agents", async () => {
    const tab = await openTab("OLD444", { png: "data:image/png;base64,CCCC", lineCount: 2 });
    askJson.mockResolvedValue({ ...MISTAKE, status: "correct", line: null });
    const res = await post("check_work", { session_code: "OLD444" });
    expect(res.status).toBe("correct");
    await vi.waitFor(() => expect(tab.events().at(-1)).toMatchObject({ type: "correct", captureId: "req1" }));
    tab.ws.close();
  });

  it("without a model it clears the checking state and says so", async () => {
    modelOn = false;
    const tab = await openTab("NOK555", { png: "data:image/png;base64,DDDD", lineCount: 2 });
    const res = await post("look_at_board", { session_code: "NOK555" });
    expect(res.ok).toBe(false);
    await vi.waitFor(() => expect(tab.events().map((e) => e.type)).toEqual(["checking", "unclear"]));
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

describe("study plan", () => {
  const PLAN = {
    readable: "yes",
    readable_note: "",
    topic: "Quadratic equations",
    title: "Quadratic ko factorise karna",
    goal: "Solve by splitting the middle term",
    notes_method: "splitting the middle term",
    sections: [
      { title: "Standard form", board: ["ax^2 + bx + c = 0"], say: "Yeh standard form hai.", ask: "a kya hai?", from_notes: true },
      { title: "Middle term", board: ["x^2 - 5x + 6 = 0", "(x - 2)(x - 3) = 0"], say: "Beech wala term todo.", ask: "6 ke factors?", from_notes: true },
    ],
    practice: [{ problem: "Solve: x^2 - 7x + 12 = 0", answer: "x = 3 or x = 4", hint: "12 ke factors socho" }],
  };

  async function makePlanFor(code: string) {
    askJson.mockResolvedValueOnce(PLAN);
    const r = await fetch(`${base}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_code: code, topic: "Quadratic equations", language: "hinglish", files: [{ mediaType: "image/jpeg", data: "QUJD" }] }),
    });
    return r.json();
  }

  it("makes a plan from notes, keeps the answers on the server, and puts the plan on the board", async () => {
    const data = await makePlanFor("PLN001");
    expect(data.outline).toContain("1 Standard form | 2 Middle term");
    expect(data.outline).not.toContain("x = 3 or x = 4");
    const req = askJson.mock.calls[0][0] as { attachments: unknown[] };
    expect(req.attachments).toHaveLength(1);
    const tab = await openTab("PLN001");
    const welcome = tab.messages[0] as Extract<ServerMessage, { kind: "welcome" }>;
    expect(welcome.replay[0]).toMatchObject({ type: "plan", items: ["Standard form", "Middle term"] });
    tab.ws.close();
  });

  it("show_section writes sections in order and doesn't skip on a double call", async () => {
    await makePlanFor("PLN002");
    const tab = await openTab("PLN002");
    const a = await post("show_section", { session_code: "PLN002", section: "next" });
    const twice = await post("show_section", { session_code: "PLN002", section: "next" });
    expect(a).toMatchObject({ section: 1, of: 2, say: "Yeh standard form hai." });
    expect(twice.section).toBe(1);
    const jump = await post("show_section", { session_code: "PLN002", section: "२" });
    expect(jump).toMatchObject({ section: 2, ask: "6 ke factors?" });
    await vi.waitFor(() => expect(tab.events().filter((e) => e.type === "steps")).toHaveLength(2));
    const end = await post("show_section", { session_code: "PLN002", section: "3" });
    expect(end.done).toBe(true);
    tab.ws.close();
  });

  it("give_practice puts the problem on the board and keeps its answer for checking", async () => {
    await makePlanFor("PLN003");
    const tab = await openTab("PLN003", { png: "data:image/png;base64,EEEE", lineCount: 3 });
    const res = await post("give_practice", { session_code: "PLN003", number: "next" });
    expect(res).toMatchObject({ practice: 1, of: 1, problem: "Solve: x^2 - 7x + 12 = 0" });
    expect(JSON.stringify(res)).not.toContain("x = 3 or x = 4");
    askJson.mockResolvedValueOnce(MISTAKE);
    await post("look_at_board", { session_code: "PLN003" });
    const req = askJson.mock.calls.at(-1)![0] as { text: string };
    expect(req.text).toContain("Expected final answer: x = 3 or x = 4");
    tab.ws.close();
  });

  it("refuses unreadable notes with a clear message", async () => {
    askJson.mockResolvedValueOnce({ ...PLAN, readable: "no", readable_note: "blurry photo" });
    const r = await fetch(`${base}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_code: "PLN004", files: [{ mediaType: "image/jpeg", data: "QUJD" }] }),
    });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toContain("blurry photo");
  });

  it("tools explain when there is no plan", async () => {
    const tab = await openTab("PLN005");
    const res = await post("show_section", { session_code: "PLN005", section: "next" });
    expect(res.ok).toBe(false);
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
