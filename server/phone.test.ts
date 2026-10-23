import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./llm", () => ({ askJson: vi.fn(), hasModel: () => true, modelName: () => "test-model", dataUrlToAttachment: () => ({}) }));

const sessions = await import("./sessions");
const { store } = await import("./store");
const { resetLimits } = await import("./limits");
const { getLearner, learnerAttempts } = await import("./learners");
const phone = await import("./phone");
const kit = await import("./testkit");

// 18:00 in India (inside the default 17-19 window) and 08:30 (before 9:00, never allowed).
const EVENING = Date.UTC(2026, 9, 23, 12, 30);
const MORNING = Date.UTC(2026, 9, 23, 3, 0);
const NUMBER = "+919876543210";

const placed: { agentId: string; to: string; userData: Record<string, string> }[] = [];
const mock = {
  fail: false,
  async placeCall(req: { agentId: string; to: string; userData: Record<string, string> }) {
    if (this.fail) throw new Error("Bolna said 400: from_phone_number not purchased");
    placed.push(req);
    return { executionId: `exec-${placed.length}` };
  },
};

let srv: Awaited<ReturnType<typeof kit.startServer>>;
let token: string;
const tool = (name: string, body: Record<string, unknown>) => kit.tool(srv.base, name, body);

beforeAll(async () => {
  srv = await kit.startServer({ phoneProvider: mock });
});
afterAll(() => srv.close());
beforeEach(async () => {
  sessions.resetSessions();
  store.reset();
  resetLimits();
  placed.length = 0;
  mock.fail = false;
  token = await kit.newDevice(srv.base);
  vi.stubEnv("PHONE_CALLS_ENABLED", "1");
  vi.stubEnv("BOLNA_PHONE_AGENT_ID", "agent-phone");
  vi.stubEnv("PHONE_ALLOWLIST", `${NUMBER}, +911111111111`);
  vi.stubEnv("ADMIN_TOKEN", "operator-secret-for-tests");
});
afterEach(() => vi.unstubAllEnvs());

const consent = { number: "+91 98765 43210", guardianName: "Sunita", guardianConsent: true, studentAssent: true };

/** A learner with one recorded mistake on the nth term (so there's something to revise). */
async function learnerWithMistake() {
  const a = kit.api(srv.base, token);
  const l = await a.post("/learners", { name: "Asha", timezone: "Asia/Kolkata" });
  const id = (l.json.learner as { id: string }).id;
  const s = await kit.newSession(srv.base, token, { learnerId: id, topic: "Arithmetic progressions" });
  await tool("next_problem", { session_code: s, problem_id: "ap.nth.demo" });
  await tool("check_answer", { session_code: s, answer: "32" });
  return id;
}

describe("phone revision: consent and settings", () => {
  it("needs a valid number, a guardian's name and consent, and the student's agreement", async () => {
    const id = await learnerWithMistake();
    const a = kit.api(srv.base, token);
    expect((await a.put(`/learners/${id}/phone`, { ...consent, number: "98765" })).status).toBe(400);
    expect((await a.put(`/learners/${id}/phone`, { ...consent, guardianName: " " })).status).toBe(400);
    expect((await a.put(`/learners/${id}/phone`, { ...consent, guardianConsent: "yes" })).status).toBe(400);
    expect((await a.put(`/learners/${id}/phone`, { ...consent, studentAssent: false })).status).toBe(400);
    const ok = await a.put(`/learners/${id}/phone`, { ...consent, windowStart: 6, windowEnd: 23 });
    expect(ok.status).toBe(200);
    const p = ok.json.phone as Record<string, unknown>;
    // The number is never sent back in full; the window is clamped to 9:00-21:00.
    expect(p.number).toBe("+91••••••3210");
    expect(JSON.stringify(ok.json)).not.toContain("9876543210");
    expect(p.window).toEqual({ start: 9, end: 21 });
    expect(p.approved).toBe(true);
  });

  it("another device can't see or change a learner's phone settings", async () => {
    const id = await learnerWithMistake();
    const other = kit.api(srv.base, await kit.newDevice(srv.base));
    expect((await other.get(`/learners/${id}/phone`)).status).toBe(404);
    expect((await other.put(`/learners/${id}/phone`, consent)).status).toBe(404);
  });
});

describe("phone revision: when a call may go out", () => {
  async function enrolled() {
    const id = await learnerWithMistake();
    expect((await kit.api(srv.base, token).put(`/learners/${id}/phone`, consent)).status).toBe(200);
    return getLearner(id)!;
  }

  it("is off unless enabled, set up and approved", async () => {
    const l = await enrolled();
    expect(phone.eligibility(l, EVENING).ok).toBe(true);
    vi.stubEnv("PHONE_CALLS_ENABLED", "");
    expect(phone.eligibility(l, EVENING)).toMatchObject({ ok: false, reason: expect.stringMatching(/turned off/) });
    vi.stubEnv("PHONE_CALLS_ENABLED", "1");
    vi.stubEnv("BOLNA_PHONE_AGENT_ID", "");
    expect(phone.eligibility(l, EVENING)).toMatchObject({ ok: false, reason: expect.stringMatching(/phone agent/) });
    vi.stubEnv("BOLNA_PHONE_AGENT_ID", "agent-phone");
    vi.stubEnv("PHONE_ALLOWLIST", "+911111111111");
    expect(phone.eligibility(l, EVENING)).toMatchObject({ ok: false, reason: expect.stringMatching(/approved list/) });
  });

  it("respects the learner's time zone and window", async () => {
    const l = await enrolled();
    expect(phone.eligibility(l, MORNING)).toMatchObject({ ok: false, reason: expect.stringMatching(/Outside the call window/) });
    // 18:00 in India is 12:30 UTC; for a learner in London it's outside the window.
    l.timezone = "Europe/London";
    expect(phone.eligibility(l, EVENING).ok).toBe(false);
  });

  it("needs something to revise", async () => {
    const a = kit.api(srv.base, token);
    const l = await a.post("/learners", { name: "New" });
    const id = (l.json.learner as { id: string }).id;
    await a.put(`/learners/${id}/phone`, consent);
    expect(phone.eligibility(getLearner(id)!, EVENING)).toMatchObject({ ok: false, reason: expect.stringMatching(/Nothing to revise/) });
  });

  it("places one call a day, never two at once, and only keypad-friendly questions from the learner's mistakes", async () => {
    const l = await enrolled();
    const r = await phone.placeRevisionCall(l, mock, EVENING);
    expect(r.ok).toBe(true);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ agentId: "agent-phone", to: NUMBER });
    expect(placed[0].userData).toMatchObject({ student_name: "Asha", call_code: expect.any(String) });
    // No phone number or answers leak into what the agent is told.
    expect(JSON.stringify(placed[0].userData)).not.toMatch(/9876543210|answer/i);
    const items = phone.getEnrolment(l.id)!.calls[0].items;
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(it.problemId).toMatch(/^ap\.nth\./);
    // Not the question they already got wrong in class: a fresh one on the same skill.
    expect(items[0].problemId).not.toBe("ap.nth.demo");

    const again = await phone.placeRevisionCall(l, mock, EVENING + 60_000);
    expect(again).toMatchObject({ ok: false, reason: expect.stringMatching(/in progress/) });
    const later = await phone.placeRevisionCall(l, mock, EVENING + 30 * 60_000);
    expect(later).toMatchObject({ ok: false, reason: expect.stringMatching(/today's call/) });
    expect(placed).toHaveLength(1);
  });

  it("caps simultaneous calls across the server", async () => {
    const l1 = await enrolled();
    const a = kit.api(srv.base, token);
    const l2 = await a.post("/learners", { name: "Ravi", timezone: "Asia/Kolkata" });
    const id2 = (l2.json.learner as { id: string }).id;
    const s = await kit.newSession(srv.base, token, { learnerId: id2, topic: "AP" });
    await tool("next_problem", { session_code: s, problem_id: "ap.nth.demo" });
    await tool("check_answer", { session_code: s, answer: "32" });
    await a.put(`/learners/${id2}/phone`, { ...consent, number: "+911111111111" });
    expect((await phone.placeRevisionCall(l1, mock, EVENING)).ok).toBe(true);
    expect(await phone.placeRevisionCall(getLearner(id2)!, mock, EVENING)).toMatchObject({ ok: false, reason: expect.stringMatching(/simultaneous/) });
  });

  it("a provider failure is recorded, doesn't use up the day, and isn't reported as a call", async () => {
    const l = await enrolled();
    mock.fail = true;
    const r = await phone.placeRevisionCall(l, mock, EVENING);
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/couldn't be placed.*not purchased/) });
    expect(phone.getEnrolment(l.id)!.calls[0].status).toBe("failed");
    mock.fail = false;
    expect((await phone.placeRevisionCall(l, mock, EVENING + 60_000)).ok).toBe(true);
  });

  it("stops for good after an opt-out, from the app or during a call", async () => {
    const l = await enrolled();
    const r = await phone.placeRevisionCall(l, mock, EVENING);
    if (!r.ok) throw new Error(r.reason);
    const out = await tool("phone_opt_out", { call_code: r.call.id, how: "keypad" });
    expect(out.ok).toBe(true);
    expect(phone.eligibility(l, EVENING + 86_400_000)).toMatchObject({ ok: false, reason: expect.stringMatching(/opted out/) });
    expect((await tool("phone_question", { call_code: r.call.id, number: 1 })).ok).toBe(false);

    const l2 = await enrolled();
    await kit.api(srv.base, token).post(`/learners/${l2.id}/phone/opt-out`);
    expect(phone.eligibility(getLearner(l2.id)!, EVENING).ok).toBe(false);
  });
});

describe("phone revision: during the call", () => {
  it("reads questions, checks keypad answers exactly, gives a hint once and never the answer", async () => {
    const id = await learnerWithMistake();
    await kit.api(srv.base, token).put(`/learners/${id}/phone`, consent);
    const l = getLearner(id)!;
    const r = await phone.placeRevisionCall(l, mock, EVENING);
    if (!r.ok) throw new Error(r.reason);
    const code = r.call.id;
    const { problem } = await import("./curriculum/library");
    const p = problem(r.call.items[0].problemId)!;
    const right = (p.answer as { value: string }).value;

    const q = await tool("phone_question", { call_code: code, number: 1 });
    expect(q).toMatchObject({ ok: true, question: 1, text: p.statement });
    expect(JSON.stringify(q)).not.toContain(`"${right}"`);

    const wrong = await tool("phone_answer", { call_code: code, number: 1, digits: "dtmf_number: 1" });
    expect(wrong).toMatchObject({ ok: true, correct: false, hint: p.hints[0] });
    expect(JSON.stringify(wrong)).not.toContain(right);
    const fixed = await tool("phone_answer", { call_code: code, number: 1, digits: right });
    expect(fixed).toMatchObject({ ok: true, correct: true });

    // Only the first try is evidence; it's recorded once, as a phone attempt on the learner.
    const phoneAttempts = learnerAttempts(getLearner(id)!).filter((a) => a.source === "phone");
    expect(phoneAttempts).toHaveLength(1);
    expect(phoneAttempts[0]).toMatchObject({ outcome: "incorrect", answer: "1", problemId: p.id, hints: 0 });

    const end = await tool("phone_end", { call_code: code });
    expect(end.ok).toBe(true);
    expect(phone.getEnrolment(id)!.calls[0].status).toBe("ended");
  });

  it("rejects unknown or malformed call codes", async () => {
    for (const code of ["", "x", "../../etc", "a".repeat(80), "doesnotexist1234"]) {
      expect((await tool("phone_question", { call_code: code, number: 1 })).ok).toBe(false);
      expect((await tool("phone_answer", { call_code: code, number: 1, digits: "5" })).ok).toBe(false);
    }
  });
});

describe("phone revision: operator endpoints", () => {
  const admin = (path: string, init: RequestInit = {}, secret = "operator-secret-for-tests") =>
    fetch(`${srv.base}/api/admin${path}`, { ...init, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });

  it("are closed without ADMIN_TOKEN, and need the right secret", async () => {
    expect((await admin("/phone", {}, "wrong")).status).toBe(401);
    vi.stubEnv("ADMIN_TOKEN", "");
    expect((await admin("/phone")).status).toBe(503);
  });

  it("list masked enrolments and place a call only with explicit confirmation", async () => {
    const id = await learnerWithMistake();
    await kit.api(srv.base, token).put(`/learners/${id}/phone`, consent);
    const list = await (await admin("/phone")).json();
    expect(list.enrolments).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("9876543210");
    expect((await admin(`/phone/${id}/call`, { method: "POST", body: "{}" })).status).toBe(400);
    expect(placed).toHaveLength(0);
    // The real clock decides the window here, so the result is either a placed call or a reason.
    const r = await admin(`/phone/${id}/call`, { method: "POST", body: JSON.stringify({ confirm: true }) });
    expect([202, 409]).toContain(r.status);
    expect(placed).toHaveLength(r.status === 202 ? 1 : 0);
  });
});

describe("phone revision: deleting", () => {
  it("removing the number or the learner deletes consent and call records", async () => {
    const id = await learnerWithMistake();
    const a = kit.api(srv.base, token);
    await a.put(`/learners/${id}/phone`, consent);
    const r = await phone.placeRevisionCall(getLearner(id)!, mock, EVENING);
    if (!r.ok) throw new Error(r.reason);
    await a.del(`/learners/${id}/phone`);
    expect(phone.getEnrolment(id)).toBeNull();
    expect(store.ids("phone")).toEqual([]);

    await a.put(`/learners/${id}/phone`, consent);
    expect((await a.del(`/learners/${id}`)).status).toBe(204);
    expect(store.ids("phone")).toEqual([]);
  });
});
