import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../shared/types";

// Stand-in for the vision model and planner, so tests are free and deterministic.
const askJson = vi.fn();
let modelOn = true;
vi.mock("./llm", () => ({
  askJson: (...args: unknown[]) => askJson(...args),
  hasModel: () => modelOn,
  modelName: () => "test-model",
  dataUrlToAttachment: (url: string) => ({ mediaType: "image/png", data: url.split(",")[1] }),
}));

const { resetSessions } = await import("./sessions");
const { store } = await import("./store");
const { resetLimits } = await import("./limits");
const kit = await import("./testkit");
const { PNG } = kit;

let srv: Awaited<ReturnType<typeof kit.startServer>>;
let token: string;
const post = (name: string, body: Record<string, unknown>) => kit.tool(srv.base, name, body);
const tab = (id: string, d: Parameters<typeof kit.openTab>[3] = null) => kit.openTab(srv.base, token, id, d);
const session = (body: Record<string, unknown> = {}) => kit.newSession(srv.base, token, body);

beforeAll(async () => {
  srv = await kit.startServer();
});
afterAll(() => srv.close());
beforeEach(async () => {
  resetSessions();
  store.reset();
  resetLimits();
  askJson.mockReset();
  modelOn = true;
  delete process.env.TOOLS_TOKEN;
  delete process.env.FAKE_CHECKER;
  token = await kit.newDevice(srv.base);
});

const MISTAKE = { kind: "working", reading: "1) ...", status: "mistake", line: 2, what_went_wrong: "Sign error", say: "Step 2 mein sign dekho." };
const CORRECT = { ...MISTAKE, status: "correct", line: null, what_went_wrong: "" };

describe("board tools", () => {
  it("show_steps writes steps to the right tab", async () => {
    const id = await session();
    const t = await tab(id);
    const res = await post("show_steps", { session_code: id, title: "Factorise", steps: "x^2 - 5x + 6 = 0 || (x-2)(x-3) = 0" });
    expect(res.ok).toBe(true);
    await vi.waitFor(() => expect(t.events()).toHaveLength(1));
    expect(t.events()[0]).toMatchObject({ type: "steps", title: "Factorise", steps: ["x^2 - 5x + 6 = 0", "(x-2)(x-3) = 0"] });
    t.ws.close();
  });

  it("never routes a tool call to another session (no fallback for a wrong id)", async () => {
    const maths = await session();
    const t = await tab(maths);
    const res = await post("give_problem", { session_code: "s_doesnotexist0000000000", problem: "Solve: 2x + 3 = 7" });
    expect(res.ok).toBe(false);
    const short = await post("give_problem", { session_code: maths.slice(0, 8), problem: "x" });
    expect(short.ok).toBe(false);
    await new Promise((r) => setTimeout(r, 100));
    expect(t.events()).toHaveLength(0);
    t.ws.close();
  });

  it("tags every board message with its session and a sequence number", async () => {
    const id = await session();
    const t = await tab(id);
    await post("write", { session_code: id, kind: "text", content: "hi" });
    await post("write", { session_code: id, kind: "text", content: "there" });
    await vi.waitFor(() => expect(t.events()).toHaveLength(2));
    const evs = t.messages.filter((m) => m.kind === "event") as Extract<ServerMessage, { kind: "event" }>[];
    expect(evs.every((m) => m.sessionId === id)).toBe(true);
    expect(evs.map((m) => m.seq)).toEqual([1, 2]);
    t.ws.close();
  });

  it("clear_board opens a new page instead of wiping (GET query string works too)", async () => {
    const id = await session();
    const t = await tab(id);
    const r = await fetch(`${srv.base}/tools/clear_board?session_code=${id}`).then((x) => x.json());
    expect(r.ok).toBe(true);
    await vi.waitFor(() => expect(t.events()[0]).toMatchObject({ type: "page" }));
    t.ws.close();
  });

  it("look_at_board asks for the latest work, reads it, and circles the wrong line with its position", async () => {
    const id = await session();
    const t = await tab(id, { png: PNG("a"), lineCount: 3 });
    await post("give_problem", { session_code: id, problem: "Solve: x^2 - 7x + 12 = 0", answer: "x = 3 or x = 4" });
    await vi.waitFor(() => expect(t.question()).not.toBeNull());
    askJson.mockResolvedValue(MISTAKE);
    const res = await post("look_at_board", { session_code: id, student_said: "is this right?" });
    expect(res).toMatchObject({ status: "mistake", line: 2, say: "Step 2 mein sign dekho." });
    const req = askJson.mock.calls[0][0] as { text: string };
    expect(req.text).toContain("Solve: x^2 - 7x + 12 = 0");
    expect(req.text).toContain("Expected final answer: x = 3 or x = 4");
    expect(req.text).toContain("is this right?");
    await vi.waitFor(() => expect(t.events().map((e) => e.type)).toEqual(["problem", "mark"]));
    expect(t.events()[1]).toMatchObject({ type: "mark", captureId: "req1", line: 2, questionId: t.question(), box: { x: 40, y: 250, w: 300, h: 40 } });
    expect(t.signals().map((s) => s.type)).toContain("checking");
    t.ws.close();
  });

  it("pressing Done starts reading right away, so the tutor's look reuses it", async () => {
    const id = await session();
    const t = await tab(id, { png: PNG("b"), lineCount: 2 });
    let finish: (v: unknown) => void = () => {};
    askJson.mockReturnValue(new Promise((r) => (finish = r)));
    t.done("done1");
    await vi.waitFor(() => expect(askJson).toHaveBeenCalledTimes(1)); // started before the tutor asked
    finish(MISTAKE);
    const res = await post("look_at_board", { session_code: id });
    expect(res.status).toBe("mistake");
    expect(askJson).toHaveBeenCalledTimes(1); // same drawing, same context, same analysis
    t.ws.close();
  });

  it("with no question up, the tutor sees the work just handed in with Done (the board has started a fresh page)", async () => {
    const id = await session();
    const t = await tab(id, { png: "", lineCount: 0 });
    askJson.mockResolvedValue(MISTAKE);
    t.done("done1", { png: PNG("d"), lineCount: 2 });
    await vi.waitFor(() => expect(askJson).toHaveBeenCalledTimes(1));
    const res = await post("look_at_board", { session_code: id });
    expect(res).toMatchObject({ status: "mistake", line: 2 });
    expect(askJson).toHaveBeenCalledTimes(1);
    t.ws.close();
  });

  it("Done and 'ho gaya' together: the second look at the same work says it was already told", async () => {
    const id = await session();
    const t = await tab(id, { png: PNG("twice"), lineCount: 2 });
    askJson.mockResolvedValue(MISTAKE);
    const first = await post("look_at_board", { session_code: id });
    expect(first.already_told).toBeUndefined();
    const second = await post("look_at_board", { session_code: id });
    expect(second).toMatchObject({ status: "mistake", already_told: true });
    const asked = await post("look_at_board", { session_code: id, student_said: "why is step 2 wrong?" });
    expect(asked.already_told).toBeUndefined(); // a real question gets a real answer
    t.draw({ png: PNG("changed"), lineCount: 3 });
    const changed = await post("look_at_board", { session_code: id });
    expect(changed.already_told).toBeUndefined();
    t.ws.close();
  });

  it("an empty board says so without calling the model", async () => {
    const id = await session();
    const t = await tab(id, { png: "", lineCount: 0 });
    const res = await post("look_at_board", { session_code: id });
    expect(res.status).toBe("empty");
    expect(askJson).not.toHaveBeenCalled();
    t.ws.close();
  });

  it("check_work still works for older agents", async () => {
    const id = await session();
    const t = await tab(id, { png: PNG("c"), lineCount: 2 });
    askJson.mockResolvedValue(CORRECT);
    const res = await post("check_work", { session_code: id });
    expect(res.status).toBe("correct");
    await vi.waitFor(() => expect(t.events().at(-1)).toMatchObject({ type: "correct", captureId: "req1", box: { y: 250 } }));
    t.ws.close();
  });

  it("without a model it says so and shows nothing on the board", async () => {
    modelOn = false;
    const id = await session();
    const t = await tab(id, { png: PNG("d"), lineCount: 2 });
    const res = await post("look_at_board", { session_code: id });
    expect(res.ok).toBe(false);
    await vi.waitFor(() => expect(t.signals().map((s) => s.type)).toEqual(["checking", "unclear"]));
    expect(t.events()).toHaveLength(0);
    t.ws.close();
  });

  it("reports a missing screen instead of failing", async () => {
    const res = await post("show_steps", { session_code: "NOPE", steps: "a" });
    expect(res.ok).toBe(false);
  });

  it("rejects calls without the token when TOOLS_TOKEN is set (constant-time check)", async () => {
    process.env.TOOLS_TOKEN = "secret-token";
    expect((await fetch(`${srv.base}/tools/clear_board`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${srv.base}/tools/clear_board`, { method: "POST", headers: { Authorization: "Bearer secret-tokeX" } })).status).toBe(401);
    const ok = await fetch(`${srv.base}/tools/clear_board`, { method: "POST", headers: { Authorization: "Bearer secret-token" } });
    expect(ok.status).toBe(200);
  });

  it("refuses all tool calls in production when no TOOLS_TOKEN is configured", async () => {
    process.env.NODE_ENV = "production";
    try {
      const r = await fetch(`${srv.base}/tools/clear_board`, { method: "POST" });
      expect(r.status).toBe(503);
    } finally {
      process.env.NODE_ENV = "test";
    }
  });

  it("gives a reconnecting tab the whole board as one snapshot", async () => {
    const id = await session();
    const first = await tab(id);
    await post("show_steps", { session_code: id, steps: "a || b" });
    await post("highlight", { session_code: id, target: "B1 line 2", style: "circle" });
    first.ws.close();
    const again = await tab(id);
    const welcome = again.messages[0] as Extract<ServerMessage, { kind: "welcome" }>;
    expect(welcome.snapshot.seq).toBe(2);
    expect(welcome.snapshot.blocks.map((b) => b.type)).toEqual(["steps"]);
    expect(welcome.snapshot.highlights).toHaveLength(1);
    again.ws.close();
  });
});

describe("grading the right work", () => {
  it("a new your_turn question replaces the old problem and its answer key", async () => {
    const id = await session();
    const t = await tab(id, { png: PNG("e"), lineCount: 2 });
    await post("give_problem", { session_code: id, problem: "Solve 2x = 6", answer: "x = 3" });
    await post("write", { session_code: id, kind: "your_turn", content: "Find a_10 of 2, 5, 8" });
    await vi.waitFor(() => expect(t.events()).toHaveLength(2));
    askJson.mockResolvedValue(MISTAKE);
    await post("look_at_board", { session_code: id });
    const req = askJson.mock.calls[0][0] as { text: string };
    expect(req.text).toContain("Current problem: Find a_10 of 2, 5, 8");
    expect(req.text).not.toContain("x = 3");
    t.ws.close();
  });

  it("caches a reading only for the same image AND the same question context", async () => {
    const id = await session();
    const t = await tab(id, { png: PNG("same"), lineCount: 2 });
    await post("give_problem", { session_code: id, problem: "Q1", answer: "1" });
    await vi.waitFor(() => expect(t.question()).not.toBeNull());
    askJson.mockResolvedValue(MISTAKE);
    await post("look_at_board", { session_code: id });
    await post("look_at_board", { session_code: id });
    expect(askJson).toHaveBeenCalledTimes(1);
    await post("give_problem", { session_code: id, problem: "Q2", answer: "2" });
    await vi.waitFor(() => expect(t.events().filter((e) => e.type === "problem")).toHaveLength(2));
    await post("look_at_board", { session_code: id });
    expect(askJson).toHaveBeenCalledTimes(2); // same picture, different question: read again
    await post("look_at_board", { session_code: id, student_said: "why is step 2 wrong?" });
    expect(askJson).toHaveBeenCalledTimes(3); // different spoken context
    t.ws.close();
  });

  it("never grades old work when the screen doesn't answer in time", async () => {
    const id = await session();
    const t = await tab(id, { png: PNG("old"), lineCount: 2 });
    askJson.mockResolvedValue(CORRECT);
    t.done("old-done");
    await vi.waitFor(() => expect(t.signals().some((s) => s.type === "review" && s.state === "done")).toBe(true));
    t.draw(null); // the tab stops answering "checking"
    const silent = t.ws;
    silent.removeAllListeners("message");
    askJson.mockClear();
    const res = await post("look_at_board", { session_code: id });
    expect(res.ok).toBe(false);
    expect(String(res.note)).toContain("didn't send their work in time");
    expect(askJson).not.toHaveBeenCalled();
    t.ws.close();
  }, 10_000);

  it("drops a late result for work that has been replaced, and says so", async () => {
    const id = await session();
    const t = await tab(id, { png: PNG("v1"), lineCount: 2 });
    let finishFirst: (v: unknown) => void = () => {};
    askJson.mockReturnValueOnce(new Promise((r) => (finishFirst = r))).mockResolvedValueOnce(CORRECT);
    t.done("first");
    await vi.waitFor(() => expect(askJson).toHaveBeenCalledTimes(1));
    t.done("second", { png: PNG("v2"), lineCount: 3 });
    await vi.waitFor(() => expect(t.events().some((e) => e.type === "correct" && e.captureId === "second")).toBe(true));
    finishFirst(MISTAKE); // the first, older reading finishes last
    await vi.waitFor(() => expect(t.signals().some((s) => s.type === "review" && s.captureId === "first" && s.state === "stale")).toBe(true));
    expect(t.events().some((e) => e.type === "mark")).toBe(false);
    t.ws.close();
  });

  it("drops a Done result if a new question arrived while it was being read", async () => {
    const id = await session();
    const t = await tab(id, { png: PNG("q"), lineCount: 2 });
    let finish: (v: unknown) => void = () => {};
    askJson.mockReturnValueOnce(new Promise((r) => (finish = r)));
    t.done("w1");
    await vi.waitFor(() => expect(askJson).toHaveBeenCalledTimes(1));
    await post("give_problem", { session_code: id, problem: "New question" });
    finish(MISTAKE);
    await vi.waitFor(() => expect(t.signals().some((s) => s.type === "review" && s.state === "stale")).toBe(true));
    expect(t.events().map((e) => e.type)).toEqual(["problem"]);
    t.ws.close();
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
  const JPEG = "/9j/4AAQSkZJRg==";

  async function sessionWithPlan() {
    askJson.mockResolvedValueOnce(PLAN);
    const draft = await kit.api(srv.base, token).post("/plans", { topic: "Quadratic equations", language: "hinglish", files: [{ mediaType: "image/jpeg", data: JPEG }] });
    expect(draft.status).toBe(200);
    expect(JSON.stringify(draft.json)).not.toContain("x = 3 or x = 4"); // answers stay on the server
    expect(JSON.stringify(draft.json)).not.toContain("12 ke factors");
    return session({ draftId: draft.json.draftId, topic: "Quadratic equations" });
  }

  it("makes a plan draft from notes and attaches it when the class is created", async () => {
    const id = await sessionWithPlan();
    const req = askJson.mock.calls[0][0] as { attachments: unknown[] };
    expect(req.attachments).toHaveLength(1);
    const s = await kit.api(srv.base, token).get(`/sessions/${id}`);
    expect(s.json.session).toMatchObject({ plan: { title: "Quadratic ko factorise karna", sections: [{ title: "Standard form" }, { title: "Middle term" }] } });
  });

  it("refuses a plan draft made for another language or another device", async () => {
    askJson.mockResolvedValueOnce(PLAN);
    const draft = await kit.api(srv.base, token).post("/plans", { topic: "x", language: "hinglish" });
    const wrongLang = await kit.api(srv.base, token).post("/sessions", { draftId: draft.json.draftId, language: "en" });
    expect(wrongLang.status).toBe(409);
    const other = await kit.newDevice(srv.base);
    const stolen = await kit.api(srv.base, other).post("/sessions", { draftId: draft.json.draftId, language: "hinglish" });
    expect(stolen.status).toBe(409);
  });

  it("show_section writes sections in order and doesn't skip on a double call", async () => {
    const id = await sessionWithPlan();
    const t = await tab(id);
    const a = await post("show_section", { session_code: id, section: "next" });
    const twice = await post("show_section", { session_code: id, section: "next" });
    expect(a).toMatchObject({ section: 1, of: 2, say: "Yeh standard form hai." });
    expect(twice.section).toBe(1);
    const jump = await post("show_section", { session_code: id, section: "२" });
    expect(jump).toMatchObject({ section: 2, ask: "6 ke factors?" });
    await vi.waitFor(() => expect(t.events().filter((e) => e.type === "steps")).toHaveLength(2));
    expect((await post("show_section", { session_code: id, section: "3" })).done).toBe(true);
    t.ws.close();
  });

  it("give_practice puts the problem on the board and keeps its answer for checking", async () => {
    const id = await sessionWithPlan();
    const t = await tab(id, { png: PNG("p"), lineCount: 3 });
    const res = await post("give_practice", { session_code: id, number: "next" });
    expect(res).toMatchObject({ practice: 1, of: 1, problem: "Solve: x^2 - 7x + 12 = 0" });
    expect(JSON.stringify(res)).not.toContain("x = 3 or x = 4");
    await vi.waitFor(() => expect(t.question()).not.toBeNull());
    askJson.mockResolvedValueOnce(MISTAKE);
    await post("look_at_board", { session_code: id });
    const req = askJson.mock.calls.at(-1)![0] as { text: string };
    expect(req.text).toContain("Expected final answer: x = 3 or x = 4");
    t.ws.close();
  });

  it("refuses unreadable notes with a clear message", async () => {
    askJson.mockResolvedValueOnce({ ...PLAN, readable: "no", readable_note: "blurry photo" });
    const r = await kit.api(srv.base, token).post("/plans", { files: [{ mediaType: "image/jpeg", data: JPEG }] });
    expect(r.status).toBe(422);
    expect(String(r.json.error)).toContain("blurry photo");
  });

  it("tools explain when there is no plan", async () => {
    const id = await session();
    const res = await post("show_section", { session_code: id, section: "next" });
    expect(res.ok).toBe(false);
  });
});

describe("Done protocol", () => {
  it("acknowledges at once, reads the work, circles the line and reports back", async () => {
    const id = await session();
    const t = await tab(id, { png: PNG("s"), lineCount: 2 });
    askJson.mockResolvedValue(MISTAKE);
    t.done("work1");
    await vi.waitFor(() => expect(t.signals().map((s) => (s.type === "review" ? `review:${s.state}` : s.type))).toEqual(["review:received", "review:done"]));
    expect(t.events().map((e) => e.type)).toEqual(["mark"]);
    const done = t.signals().at(-1) as { summary: string; status: string; captureId: string };
    expect(done).toMatchObject({ captureId: "work1", status: "mistake" });
    expect(done.summary).toContain("Step 2");
    t.ws.close();
  });

  it("says clearly when the work couldn't be read", async () => {
    const id = await session();
    const t = await tab(id, { png: PNG("t"), lineCount: 1 });
    askJson.mockRejectedValue(new Error("model down"));
    t.done("work2");
    await vi.waitFor(() => expect(t.signals().at(-1)).toMatchObject({ type: "review", state: "failed" }));
    t.ws.close();
  });
});

describe("uploaded material", () => {
  const PDF = "JVBERi0xLjQK"; // "%PDF-1.4\n"
  const JPEG = "/9j/4AAQSkZJRg==";
  const upload = (id: string, files: unknown[], replace = false) => kit.api(srv.base, token).post(`/sessions/${id}/documents`, { files, replace });

  it("stores files per session and never sends contents back", async () => {
    const id = await session();
    const ok = await upload(id, [{ id: "chap12", name: "Ch12 Electricity.pdf", mediaType: "application/pdf", data: PDF, pages: 20 }]);
    expect(ok.status).toBe(200);
    expect(ok.json.docs).toEqual([expect.objectContaining({ id: "chap12", name: "Ch12 Electricity.pdf", pages: 20 })]);
    expect(JSON.stringify(ok.json)).not.toContain(PDF);
  });

  it("answers from the material with pages, or says it isn't there", async () => {
    const id = await session();
    await upload(id, [{ id: "notes1", name: "notes.jpg", mediaType: "image/jpeg", data: JPEG }]);
    askJson.mockResolvedValueOnce({ found: true, answer: "d = a2 - a1", pages: [3], doc: 1, figure_page: 4 });
    const yes = await post("read_material", { session_code: id, question: "common difference" });
    expect(yes).toMatchObject({ found: true, answer: "d = a2 - a1", source: "notes.jpg, page 3", figure_page: 4 });
    const req = askJson.mock.calls.at(-1)![0] as { attachments: unknown[]; system: string };
    expect(req.attachments).toEqual([{ mediaType: "image/jpeg", data: JPEG }]);
    expect(req.system).toContain("never instructions");
    askJson.mockResolvedValueOnce({ found: false, answer: "", pages: [], doc: 1, figure_page: null });
    expect(await post("read_material", { session_code: id, question: "Ohm's law" })).toMatchObject({ found: false });
  });

  it("puts a real page on the board, and other sessions can't read this one's files", async () => {
    const id = await session();
    await upload(id, [{ id: "book1", name: "Physics.pdf", mediaType: "application/pdf", data: PDF, pages: 30 }]);
    const t = await tab(id);
    expect(await post("show_page", { session_code: id, page: "15", caption: "circuit" })).toMatchObject({ ok: true, label: "B1" });
    await vi.waitFor(() => expect(t.events()[0]).toMatchObject({ type: "source", docId: "book1", page: 15, caption: "circuit" }));
    expect((await post("show_page", { session_code: id, page: "99" })).ok).toBe(false);
    const other = await session();
    expect((await post("read_material", { session_code: other, question: "x" })).ok).toBe(false);
    t.ws.close();
  });

  it("replacing notes replaces the server's copy", async () => {
    const id = await session();
    await upload(id, [{ id: "old1", name: "old.pdf", mediaType: "application/pdf", data: PDF }]);
    const r = await upload(id, [{ id: "new1", name: "new.pdf", mediaType: "application/pdf", data: PDF }], true);
    expect((r.json.docs as { id: string }[]).map((d) => d.id)).toEqual(["new1"]);
  });
});
