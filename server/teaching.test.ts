// Phases 2-4: checked solutions, the hint ladder, misconceptions, the diagnostic, mastery and memory.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const askJson = vi.fn();
let modelOn = true;
vi.mock("./llm", () => ({
  askJson: (...args: unknown[]) => askJson(...args),
  hasModel: () => modelOn,
  modelName: () => "test-model",
  dataUrlToAttachment: (url: string) => ({ mediaType: "image/png", data: url.split(",")[1] }),
}));

const sessions = await import("./sessions");
const { store } = await import("./store");
const { resetLimits } = await import("./limits");
const learners = await import("./learners");
const kit = await import("./testkit");
const { PNG } = kit;

let srv: Awaited<ReturnType<typeof kit.startServer>>;
let token: string;
const tool = (name: string, body: Record<string, unknown>) => kit.tool(srv.base, name, body);
const api = () => kit.api(srv.base, token);

beforeAll(async () => {
  srv = await kit.startServer();
});
afterAll(() => srv.close());
beforeEach(async () => {
  sessions.resetSessions();
  store.reset();
  resetLimits();
  askJson.mockReset();
  modelOn = true;
  token = await kit.newDevice(srv.base);
});

async function learnerSession(name = "Asha") {
  const l = await api().post("/learners", { name, grade: "10", language: "hinglish", timezone: "Asia/Kolkata" });
  expect(l.status).toBe(201);
  const learnerId = (l.json.learner as { id: string }).id;
  const id = await kit.newSession(srv.base, token, { learnerId, topic: "Arithmetic progressions" });
  return { learnerId, id };
}

describe("checked problems and solutions", () => {
  it("next_problem puts a library problem on the board without its answer", async () => {
    const { id } = await learnerSession();
    const t = await kit.openTab(srv.base, token, id);
    const r = await tool("next_problem", { session_code: id, problem_id: "ap.nth.demo" });
    expect(r).toMatchObject({ ok: true, problem: "Find the 10th term of the AP: 2, 5, 8, ..." });
    expect(JSON.stringify(r)).not.toContain("29");
    await vi.waitFor(() => expect(t.events().at(-1)).toMatchObject({ type: "problem", kind: "practice" }));
    expect(JSON.stringify(t.messages)).not.toContain("29");
    t.ws.close();
  });

  it("solve labels exactly how much was verified", async () => {
    const { id } = await learnerSession();
    const lib = await tool("solve", { session_code: id, problem_id: "quad.fact.01" });
    expect(lib).toMatchObject({ verified: "library", answer_for_you_only: "x = 3 or x = 4" });
    const exact = await tool("solve", { session_code: id, problem: "Solve: 5x - 7 = 3x + 9" });
    expect(exact).toMatchObject({ verified: "exact", answer_for_you_only: "x = 8" });
    askJson.mockResolvedValueOnce({ answer: "AB = 6 cm", steps: ["Use similar triangles"], hints: ["a", "b", "c"] });
    const model = await tool("solve", { session_code: id, problem: "In the figure, triangles ABC and DEF are similar; find AB" });
    expect(model.verified).toBe("unverified");
    expect(String(model.verification)).toContain("Not verified");
    askJson.mockResolvedValueOnce({ answer: "x = 2", steps: ["x^3 = 8 so x = 2"], hints: ["a", "b", "c"] });
    const cubic = await tool("solve", { session_code: id, problem: "Solve x^3 = 8" });
    expect(cubic.verified).toBe("unverified"); // the engine can't check cubics: never called checked
  });
});

describe("the hint ladder", () => {
  it("goes nudge -> hint -> one step, in order, and the full solution waits", async () => {
    const { id } = await learnerSession();
    const t = await kit.openTab(srv.base, token, id);
    await tool("next_problem", { session_code: id, problem_id: "ap.nth.demo" });
    expect((await tool("show_solution", { session_code: id })).ok).toBe(false); // no hints yet
    const h1 = await tool("give_hint", { session_code: id });
    const h2 = await tool("give_hint", { session_code: id });
    const h3 = await tool("give_hint", { session_code: id });
    expect([h1.level, h2.level, h3.level]).toEqual(["nudge", "hint", "step"]);
    expect((await tool("give_hint", { session_code: id })).done).toBe(true);
    for (const h of [h1, h2, h3]) expect(String(h.hint)).not.toMatch(/\b29\b/);
    const sol = await tool("show_solution", { session_code: id });
    expect(sol.ok).toBe(true);
    await vi.waitFor(() => expect(t.events().filter((e) => e.type === "hint")).toHaveLength(3));
    await vi.waitFor(() => expect(t.events().at(-1)).toMatchObject({ type: "steps", title: "Solution", checked: true }));
    t.ws.close();
  });

  it("the student can ask to see the solution early (intentional reveal)", async () => {
    const { id } = await learnerSession();
    await tool("next_problem", { session_code: id, problem_id: "ap.d.01" });
    expect((await tool("show_solution", { session_code: id, student_asked: "true" })).ok).toBe(true);
    expect(sessions.getSession(id)!.problem!.revealed).toBe(true);
  });

  it("refuses ordinary board writes that would give the answer away", async () => {
    const { id } = await learnerSession();
    await tool("next_problem", { session_code: id, problem_id: "ap.nth.demo" });
    const leak = await tool("write", { session_code: id, kind: "steps", content: "a = 2, d = 3 || a_10 = 2 + 27 = 29" });
    expect(leak.ok).toBe(false);
    expect(String(leak.error)).toContain("give away the answer");
    expect((await tool("show_steps", { session_code: id, steps: "a_10 = 29" })).ok).toBe(false);
    expect((await tool("write", { session_code: id, kind: "text", content: "a_n = a + (n - 1)d" })).ok).toBe(true); // the formula is fine
    const q = await tool("next_problem", { session_code: id, problem_id: "quad.fact.01" });
    expect(q.ok).toBe(true);
    expect((await tool("write", { session_code: id, kind: "text", content: "So x = 3 or x = 4" })).ok).toBe(false);
  });
});

describe("answers, attempts and misconceptions", () => {
  it("check_answer compares by value and names a trap misconception", async () => {
    const { id } = await learnerSession();
    await tool("next_problem", { session_code: id, problem_id: "ap.nth.demo" });
    const wrong = await tool("check_answer", { session_code: id, answer: "thirty two... I mean 32" });
    expect(wrong.verdict).toBe("unreadable"); // can't read that as a single value: never guessed
    const trap = await tool("check_answer", { session_code: id, answer: "32" });
    expect(trap).toMatchObject({ verdict: "incorrect", misconception: { id: "ap.index_off_by_one" } });
    const right = await tool("check_answer", { session_code: id, answer: "a_10 = 29" });
    expect(right.verdict).toBe("correct");
    const atts = learners.sessionAttempts(id);
    expect(atts.map((a) => a.outcome)).toEqual(["unreadable", "incorrect", "correct"]);
    expect(atts[0].misconceptions).toEqual([]); // unreadable is never a misconception
    expect(atts[1].misconceptions[0]).toMatchObject({ id: "ap.index_off_by_one", confidence: "high" });
  });

  it("records the same attempt only once (idempotent)", async () => {
    const { id } = await learnerSession();
    await tool("next_problem", { session_code: id, problem_id: "ap.d.01" });
    await tool("check_answer", { session_code: id, answer: "4" });
    await tool("check_answer", { session_code: id, answer: "4" });
    expect(learners.sessionAttempts(id)).toHaveLength(1);
  });

  it("a Done reading is double-checked by the maths engine, which wins on the final answer", async () => {
    const { id } = await learnerSession();
    const t = await kit.openTab(srv.base, token, id, { png: PNG("w"), lineCount: 2 });
    await tool("next_problem", { session_code: id, problem_id: "ap.nth.demo" });
    await vi.waitFor(() => expect(t.question()).not.toBeNull());
    // The model wrongly says "correct" for a final answer of 32.
    askJson.mockResolvedValueOnce({ kind: "working", reading: "1) a=2,d=3\n2) a_10 = 2 + 10x3 = 32", status: "correct", line: null, what_went_wrong: "", say: "Sahi!", final_answer: "32", misconception_id: "none" });
    t.done("d1");
    await vi.waitFor(() => expect(t.signals().some((s) => s.type === "review" && s.state === "done")).toBe(true));
    const done = t.signals().find((s) => s.type === "review" && s.state === "done") as { status: string };
    expect(done.status).toBe("mistake");
    const att = learners.sessionAttempts(id).at(-1)!;
    expect(att).toMatchObject({ outcome: "incorrect", answer: "32" });
    expect(att.misconceptions[0]).toMatchObject({ id: "ap.index_off_by_one", confidence: "high" });
    t.ws.close();
  });

  it("unreadable work is never classed as a misconception, even if the model suggests one", async () => {
    const { id } = await learnerSession();
    const t = await kit.openTab(srv.base, token, id, { png: PNG("u"), lineCount: 2 });
    await tool("next_problem", { session_code: id, problem_id: "ap.nth.demo" });
    await vi.waitFor(() => expect(t.question()).not.toBeNull());
    askJson.mockResolvedValueOnce({ kind: "working", reading: "?", status: "unreadable", line: 2, what_went_wrong: "can't read line 2", say: "", final_answer: "", misconception_id: "ap.index_off_by_one" });
    t.done("d2");
    await vi.waitFor(() => expect(learners.sessionAttempts(id)).toHaveLength(1));
    expect(learners.sessionAttempts(id)[0]).toMatchObject({ outcome: "unreadable", misconceptions: [] });
    t.ws.close();
  });

  it("a wrongly inferred misconception can be removed by the learner", async () => {
    const { id, learnerId } = await learnerSession();
    await tool("next_problem", { session_code: id, problem_id: "ap.nth.demo" });
    await tool("check_answer", { session_code: id, answer: "32" });
    const before = await api().get(`/learners/${learnerId}/memory`);
    expect((before.json.memory as { mistakes: { id: string }[] }).mistakes.map((m) => m.id)).toEqual(["ap.index_off_by_one"]);
    await api().post(`/learners/${learnerId}/misconceptions/ap.index_off_by_one/reject`);
    const after = await api().get(`/learners/${learnerId}/memory`);
    expect((after.json.memory as { mistakes: unknown[] }).mistakes).toEqual([]);
  });
});

describe("plan_next", () => {
  it("moves through nudge, hints, a targeted example and a transfer question", async () => {
    const { id } = await learnerSession();
    await tool("next_problem", { session_code: id, problem_id: "ap.nth.demo" });
    expect((await tool("plan_next", { session_code: id })).action).toBe("nudge");
    await tool("check_answer", { session_code: id, answer: "30" });
    expect((await tool("plan_next", { session_code: id })).action).toBe("nudge");
    await tool("give_hint", { session_code: id });
    await tool("check_answer", { session_code: id, answer: "31" });
    expect((await tool("plan_next", { session_code: id })).action).toBe("next_hint");
    await tool("check_answer", { session_code: id, answer: "32" });
    const targeted = await tool("plan_next", { session_code: id });
    expect(targeted).toMatchObject({ action: "equivalent_example" });
    expect(String(targeted.say_hint)).toContain("n − 1 jumps");
    await tool("check_answer", { session_code: id, answer: "29" });
    expect(await tool("plan_next", { session_code: id })).toMatchObject({ action: "equivalent_example", tool: "next_problem" }); // solved with help
    await tool("next_problem", { session_code: id, problem_id: "ap.nth.02" });
    await tool("check_answer", { session_code: id, answer: "33" });
    expect(await tool("plan_next", { session_code: id })).toMatchObject({ action: "transfer_question", args: { kind: "transfer" } }); // solved alone
  });
});

describe("the quick check (diagnostic)", () => {
  it("adapts to answers, separates wrong / unanswered, and sets the starting point", async () => {
    const { id } = await learnerSession();
    const start = await api().post(`/sessions/${id}/diagnostic`, { action: "start" });
    expect(start.json).toMatchObject({ ok: true, question: 1 });
    const first = sessions.getSession(id)!.problem!;
    expect(first.kind).toBe("diagnostic");
    // Right answer -> a harder one next.
    const firstAnswer = { "ap.d.01": "4", "ap.nth.02": "33" } as Record<string, string>;
    await api().post(`/sessions/${id}/answer`, { answer: firstAnswer[first.problemId!] ?? "4" });
    const second = await api().post(`/sessions/${id}/diagnostic`, { action: "next" });
    expect(second.json.question).toBe(2);
    const q2 = sessions.getSession(id)!.problem!;
    // Skip one (unanswered, not wrong), answer the next wrongly.
    const skipped = await api().post(`/sessions/${id}/diagnostic`, { action: "skip_question" });
    expect(skipped.json.question).toBe(3);
    await api().post(`/sessions/${id}/answer`, { answer: "12345" });
    const last = await api().post(`/sessions/${id}/diagnostic`, { action: "next" });
    expect(last.json.question).toBe(4);
    await api().post(`/sessions/${id}/answer`, { answer: "1" });
    const done = await api().post(`/sessions/${id}/diagnostic`, { action: "next" });
    expect(done.json).toMatchObject({ done: true, unanswered: 1 });
    expect(done.json.right).toBeGreaterThanOrEqual(1);
    const d = sessions.getSession(id)!.diagnostic!;
    expect(d.items.map((i) => i.outcome)).toContain("unanswered");
    expect(d.startSkill).not.toBeNull();
    expect(q2.problemId).not.toBe(first.problemId);
  });

  it("can be skipped, and resumes where it stopped after a reconnect", async () => {
    const { id } = await learnerSession();
    await api().post(`/sessions/${id}/diagnostic`, { action: "start" });
    store.flush();
    sessions.resetSessions(); // the server forgets memory; the store still has it
    const resumed = await api().post(`/sessions/${id}/diagnostic`, { action: "start" });
    expect(resumed.json.ok).toBe(false); // the pending question must be answered first, not restarted
    expect(String(resumed.json.error)).toContain("hasn't been answered");
    const other = (await learnerSession("Ravi")).id;
    const skip = await api().post(`/sessions/${other}/diagnostic`, { action: "skip" });
    expect(skip.json.diagnostic).toMatchObject({ status: "skipped" });
  });
});

describe("mastery and memory", () => {
  it("one right answer, or answers with hints, are never 'secure'", async () => {
    const { id, learnerId } = await learnerSession();
    await tool("next_problem", { session_code: id, problem_id: "ap.nth.demo" });
    await tool("give_hint", { session_code: id });
    await tool("check_answer", { session_code: id, answer: "29" });
    let m = (await api().get(`/learners/${learnerId}/memory`)).json.memory as { progress: { skill: string; status: string; because: string }[] };
    expect(m.progress.find((p) => p.skill === "ap.nth_term")).toMatchObject({ status: "learning" });
    await tool("next_problem", { session_code: id, problem_id: "ap.nth.02" });
    await tool("check_answer", { session_code: id, answer: "33" });
    m = (await api().get(`/learners/${learnerId}/memory`)).json.memory as typeof m;
    expect(m.progress.find((p) => p.skill === "ap.nth_term")).toMatchObject({ status: "practising" });
    await tool("next_problem", { session_code: id, problem_id: "ap.nth.04", kind: "transfer" });
    await tool("check_answer", { session_code: id, answer: "38" });
    m = (await api().get(`/learners/${learnerId}/memory`)).json.memory as typeof m;
    expect(m.progress.find((p) => p.skill === "ap.nth_term")).toMatchObject({ status: "secure" });
  });

  it("a mistake after progress needs a follow-up check before it's secure again", async () => {
    const { id, learnerId } = await learnerSession();
    for (const [pid, ans, kind] of [
      ["ap.nth.02", "33", "practice"],
      ["ap.nth.04", "38", "transfer"],
      ["ap.nth.03", "-50", "practice"],
    ] as const) {
      await tool("next_problem", { session_code: id, problem_id: pid, kind });
      await tool("check_answer", { session_code: id, answer: ans });
    }
    const m = (await api().get(`/learners/${learnerId}/memory`)).json.memory as { progress: { skill: string; status: string; followUpDue: boolean }[]; next: { problemId: string; why: string } };
    expect(m.progress.find((p) => p.skill === "ap.nth_term")).toMatchObject({ status: "practising", followUpDue: true });
    expect(m.next.why).toContain("follow-up check");
    expect(await tool("plan_next", { session_code: (await learnerSession("x")).id })).toMatchObject({ action: "continue_lesson" });
  });

  it("the next call's memory says only what was recorded", async () => {
    const { id, learnerId } = await learnerSession();
    const s = sessions.getSession(id)!;
    expect(learners.memoryForCall(s)).toContain("no recorded work yet");
    await tool("next_problem", { session_code: id, problem_id: "ap.nth.demo" });
    await tool("check_answer", { session_code: id, answer: "32" });
    const second = await kit.newSession(srv.base, token, { learnerId, topic: "AP" });
    const note = learners.memoryForCall(sessions.getSession(second)!);
    expect(note).toContain("Counts n jumps instead of n − 1");
    expect(note).toContain("Find the 10th term of the AP: 2, 5, 8");
    expect(note).not.toContain("Strength"); // nothing was solved alone yet
  });

  it("learners on one device never see each other's records; other devices can't see them at all", async () => {
    const a = await learnerSession("Asha");
    const b = await learnerSession("Ravi");
    await tool("next_problem", { session_code: a.id, problem_id: "ap.nth.demo" });
    await tool("check_answer", { session_code: a.id, answer: "32" });
    const mb = (await api().get(`/learners/${b.learnerId}/memory`)).json.memory as { evidenceCount: number };
    expect(mb.evidenceCount).toBe(0);
    const other = await kit.newDevice(srv.base);
    expect((await kit.api(srv.base, other).get(`/learners/${a.learnerId}/memory`)).status).toBe(404);
    expect((await kit.api(srv.base, other).post("/sessions", { learnerId: a.learnerId })).status).toBe(404);
    // Two learners with the same name stay separate.
    const twin = await api().post("/learners", { name: "Asha" });
    expect((twin.json.learner as { id: string }).id).not.toBe(a.learnerId);
  });

  it("reset clears the evidence; delete removes the learner", async () => {
    const { id, learnerId } = await learnerSession();
    await tool("next_problem", { session_code: id, problem_id: "ap.d.01" });
    await tool("check_answer", { session_code: id, answer: "4" });
    await api().post(`/learners/${learnerId}/reset-memory`);
    expect(((await api().get(`/learners/${learnerId}/memory`)).json.memory as { evidenceCount: number }).evidenceCount).toBe(0);
    expect((await api().del(`/learners/${learnerId}`)).status).toBe(204);
    expect((await api().get(`/learners/${learnerId}/memory`)).status).toBe(404);
    expect(sessions.getSession(id)!.learnerId).toBeNull();
  });
});

describe("streaks", () => {
  it("count learning days in the learner's own time zone, once per day", () => {
    const l = { id: "l_test", deviceId: "d", name: "A", grade: "10", language: "en", timezone: "Asia/Kolkata", createdAt: 0, updatedAt: 0, sessions: [], rejectedMisconceptions: [], activeDays: ["2026-10-20", "2026-10-21", "2026-10-22"] } as never;
    // 23:30 UTC on Oct 22 is already Oct 23 in India.
    const late = Date.UTC(2026, 9, 22, 23, 30);
    expect(learners.localDay(late, "Asia/Kolkata")).toBe("2026-10-23");
    expect(learners.localDay(late, "UTC")).toBe("2026-10-22");
    expect(learners.streakOf(l, late)).toMatchObject({ current: 3, best: 3, today: false });
    // A missed day restarts the count quietly.
    const later = Date.UTC(2026, 9, 25, 6, 0);
    expect(learners.streakOf(l, later)).toMatchObject({ current: 0, best: 3 });
  });
});
