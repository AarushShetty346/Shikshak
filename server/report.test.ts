import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./llm", () => ({ askJson: vi.fn(), hasModel: () => true, modelName: () => "test-model", dataUrlToAttachment: () => ({}) }));

const sessions = await import("./sessions");
const { store } = await import("./store");
const { resetLimits } = await import("./limits");
const kit = await import("./testkit");

let srv: Awaited<ReturnType<typeof kit.startServer>>;
let token: string;
const tool = (name: string, body: Record<string, unknown>) => kit.tool(srv.base, name, body);

beforeAll(async () => {
  srv = await kit.startServer();
});
afterAll(() => srv.close());
beforeEach(async () => {
  sessions.resetSessions();
  store.reset();
  resetLimits();
  token = await kit.newDevice(srv.base);
});

async function report(id: string) {
  const r = await kit.api(srv.base, token).get(`/sessions/${id}/report`);
  expect(r.status).toBe(200);
  return r.json.report as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe("end-of-class report", () => {
  it("says honestly when there's nothing to report", async () => {
    const id = await kit.newSession(srv.base, token, { topic: "AP" });
    const r = await report(id);
    expect(r.sparse).toBe(true);
    expect(r.note).toContain("nothing to report");
    expect(r.counts.solvedAlone).toBe(0);
    expect(JSON.stringify(r)).not.toMatch(/great|excellent|well done|mastered/i);
  });

  it("counts what was solved alone, with hints, and the mistakes corrected", async () => {
    const id = await kit.newSession(srv.base, token, { topic: "Arithmetic progressions" });
    await tool("write", { session_code: id, kind: "heading", content: "Arithmetic Progression" });
    await tool("next_problem", { session_code: id, problem_id: "ap.nth.demo" });
    await tool("check_answer", { session_code: id, answer: "32" });
    await tool("give_hint", { session_code: id });
    await tool("check_answer", { session_code: id, answer: "29" });
    await tool("next_problem", { session_code: id, problem_id: "ap.d.01" });
    await tool("check_answer", { session_code: id, answer: "4" });
    await tool("next_problem", { session_code: id, problem_id: "ap.sum.01" });
    await tool("skip_question", { session_code: id });
    const r = await report(id);
    expect(r.sparse).toBe(false);
    expect(r.covered).toContain("Arithmetic Progression");
    expect(r.counts).toMatchObject({ attempted: 2, solvedAlone: 1, solvedWithHelp: 1, hints: 1 });
    expect(r.problems.map((p: { result: string }) => p.result)).toEqual(["solved with hints", "solved alone", "skipped"]);
    expect(r.mistakesCorrected).toEqual([{ mistake: "Counts n jumps instead of n − 1", question: "Find the 10th term of the AP: 2, 5, 8, ..." }]);
    expect(r.note).toContain("not an exam result");
  });

  it("is the same report until the evidence changes", async () => {
    const id = await kit.newSession(srv.base, token, { topic: "AP" });
    await tool("next_problem", { session_code: id, problem_id: "ap.d.01" });
    await tool("check_answer", { session_code: id, answer: "4" });
    const a = await report(id);
    const b = await report(id);
    expect(b.version).toBe(a.version);
    expect(b.generatedAt).toBe(a.generatedAt); // served from the saved copy
    await tool("next_problem", { session_code: id, problem_id: "ap.d.02" });
    await tool("check_answer", { session_code: id, answer: "3" });
    const c = await report(id);
    expect(c.version).not.toBe(a.version);
  });

  it("only the owning device can read a report", async () => {
    const id = await kit.newSession(srv.base, token, { topic: "AP" });
    const other = await kit.newDevice(srv.base);
    expect((await kit.api(srv.base, other).get(`/sessions/${id}/report`)).status).toBe(404);
  });
});
