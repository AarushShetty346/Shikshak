// Exam mode: papers in the board pattern, the scheme kept on the server, the invigilator's log,
// marking that never exceeds a question's marks, and a review class from the weakest question.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./llm", () => ({
  askJson: vi.fn(),
  hasModel: () => false,
  modelName: () => "none",
  dataUrlToAttachment: (url: string) => ({ mediaType: url.slice(5, url.indexOf(";")), data: url.split(",")[1] }),
}));

const sessions = await import("./sessions");
const { store } = await import("./store");
const { resetLimits } = await import("./limits");
const kit = await import("./testkit");

const PHOTO = { mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" };

let srv: Awaited<ReturnType<typeof kit.startServer>>;
beforeAll(async () => {
  process.env.FAKE_CHECKER = "1";
  srv = await kit.startServer();
});
afterAll(() => srv.close());
beforeEach(() => {
  sessions.resetSessions();
  store.reset();
  resetLimits();
});

async function student(grade = "10") {
  const token = await kit.newDevice(srv.base);
  const api = kit.api(srv.base, token);
  const l = (await api.post("/learners", { name: "Harsh", grade, language: "en" })).json.learner as { id: string };
  return { token, api, learnerId: l.id };
}

describe("exam papers", () => {
  it("are in the board pattern for the chosen count, with no marking scheme sent to the browser", async () => {
    const me = await student();
    const r = await me.api.post("/exams", { learnerId: me.learnerId, topic: "Quadratic equations", questions: 10, minutes: 60, mode: "mock", level: "basic" });
    expect(r.status).toBe(201);
    const exam = r.json.exam as { id: string; paper: { sections: { id: string; questions: { n: number; marks: number }[]; instructions: string }[]; maxMarks: number; minutes: number; subject: string; instructions: string[] } };
    const counts = Object.fromEntries(exam.paper.sections.map((s) => [s.id, s.questions.length]));
    expect(counts).toEqual({ A: 2, B: 2, C: 3, D: 2, E: 1 });
    expect(exam.paper.maxMarks).toBe(2 * 1 + 2 * 2 + 3 * 3 + 2 * 5 + 1 * 4);
    expect(exam.paper.subject).toBe("Mathematics Basic");
    expect(exam.paper.sections.flatMap((s) => s.questions.map((q) => q.n))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(exam.paper.sections[1].instructions).toBe("This section has 2 Very Short Answer (VSA) type questions carrying 2 marks each. 2×2=4");
    expect(exam.paper.instructions.join(" ")).toMatch(/π = 22\/7/);
    expect(JSON.stringify(r.json)).not.toMatch(/scheme|deviceId/);
    // Listed for that learner; nobody else's device can open it.
    expect(((await me.api.get(`/exams?learnerId=${me.learnerId}`)).json.exams as unknown[]).length).toBe(1);
    const other = await student();
    expect((await other.api.get(`/exams/${exam.id}`)).status).toBe(404);
  });

  it("refuses counts and durations that aren't offered, and needs an account", async () => {
    const me = await student();
    expect((await me.api.post("/exams", { learnerId: me.learnerId, topic: "AP", questions: 7, minutes: 60 })).status).toBe(400);
    expect((await me.api.post("/exams", { learnerId: me.learnerId, topic: "AP", questions: 10, minutes: 17 })).status).toBe(400);
    expect((await me.api.post("/exams", { learnerId: me.learnerId, topic: "", questions: 10, minutes: 60 })).status).toBe(400);
    expect((await me.api.post("/exams", { topic: "AP", questions: 10, minutes: 60 })).status).toBe(400);
    for (const n of [5, 15, 20, 30]) expect((await me.api.post("/exams", { learnerId: me.learnerId, topic: "AP", questions: n, minutes: 30 })).status).toBe(201);
  });
});

describe("sitting an exam", () => {
  it("starts the clock, and keeps the invigilator's log only for an invigilated exam", async () => {
    const me = await student();
    const ex = (await me.api.post("/exams", { learnerId: me.learnerId, topic: "Triangles", questions: 5, minutes: 30, mode: "exam" })).json.exam as { id: string; paper: { sections: { questions: { text: string }[] }[] } };
    // The questions aren't sent until the exam starts.
    expect(ex.paper.sections.flatMap((s) => s.questions.map((q) => q.text)).every((t) => t === "")).toBe(true);
    const started = (await me.api.post(`/exams/${ex.id}/start`)).json.exam as { startedAt: number; endsAt: number };
    expect(started.endsAt - started.startedAt).toBe(30 * 60_000);
    const open = (await me.api.get(`/exams/${ex.id}`)).json.exam as { paper: { sections: { questions: { text: string }[] }[] } };
    expect(open.paper.sections[0].questions[0].text).not.toBe("");
    await me.api.post(`/exams/${ex.id}/events`, { events: [{ kind: "tab-hidden" }, { kind: "made-up" }, { kind: "screen-share-ended" }] });
    const log = ((await me.api.get(`/exams/${ex.id}`)).json.exam as { events: { kind: string }[] }).events.map((e) => e.kind);
    expect(log).toEqual(["started", "tab-hidden", "screen-share-ended"]);

    const mock = (await me.api.post("/exams", { learnerId: me.learnerId, topic: "Triangles", questions: 5, minutes: 30, mode: "mock" })).json.exam as { id: string };
    await me.api.post(`/exams/${mock.id}/start`);
    await me.api.post(`/exams/${mock.id}/events`, { events: [{ kind: "tab-hidden" }] });
    expect(((await me.api.get(`/exams/${mock.id}`)).json.exam as { events: unknown[] }).events).toEqual([]);
  });

  it("marks the answer sheets question by question, never above the marks, and sets up a review class", async () => {
    const me = await student();
    const ex = (await me.api.post("/exams", { learnerId: me.learnerId, topic: "Polynomials", questions: 5, minutes: 30, mode: "mock" })).json.exam as { id: string; paper: { maxMarks: number } };
    expect((await me.api.post(`/exams/${ex.id}/submit`, { photos: [] })).status).toBe(400);
    const marked = (await me.api.post(`/exams/${ex.id}/submit`, { photos: [PHOTO, PHOTO] })).json.exam as {
      evaluation: { total: number; max: number; questions: { awarded: number; max: number }[]; presentation: Record<string, { score: number }>; improve: string[]; simulated: boolean };
    };
    const ev = marked.evaluation;
    expect(ev.simulated).toBe(true);
    expect(ev.max).toBe(ex.paper.maxMarks);
    expect(ev.questions).toHaveLength(5);
    for (const q of ev.questions) expect(q.awarded).toBeLessThanOrEqual(q.max);
    expect(ev.total).toBe(ev.questions.reduce((t, q) => t + q.awarded, 0));
    expect(Object.keys(ev.presentation).sort()).toEqual(["finalAnswers", "handwriting", "neatness", "steps"]);
    expect(ev.improve.length).toBeGreaterThan(0);

    // Learn from it: the weakest question goes on a class's board.
    const sid = await kit.newSession(srv.base, me.token, { learnerId: me.learnerId, topic: "Exam review" });
    const tab = await kit.openTab(srv.base, me.token, sid);
    const r = await me.api.post(`/exams/${ex.id}/review`, { sessionId: sid });
    expect(r.status).toBe(200);
    await vi.waitFor(() => expect(tab.events().some((e) => e.type === "problem")).toBe(true));
    tab.ws.close();
  });
});
