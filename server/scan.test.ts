// "Scan a question": a photo of a notebook question is copied out (model mocked) and put on the board.

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
const kit = await import("./testkit");

// A real 1×1 PNG (uploads are checked by their first bytes).
const PHOTO = { name: "notebook.png", mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" };

let srv: Awaited<ReturnType<typeof kit.startServer>>;
let token: string;
const api = () => kit.api(srv.base, token);
const tool = (name: string, body: Record<string, unknown>) => kit.tool(srv.base, name, body);

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

describe("scan a question from the notebook", () => {
  it("puts the first question on the board as the student's question, with a checked answer when the engine can solve it", async () => {
    askJson.mockResolvedValue({ readable: "yes", questions: ["Q1. Solve by factorisation: x^2 - 7x + 12 = 0", "Find the 10th term of the AP: 2, 5, 8, ..."], note: "" });
    const id = await kit.newSession(srv.base, token, { topic: "Quadratic equations" });
    const r = await api().post(`/sessions/${id}/scan`, { file: PHOTO });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, placed: "Solve by factorisation: x^2 - 7x + 12 = 0", checked: true });
    expect((r.json.questions as string[]).length).toBe(2);
    expect((r.json.docs as unknown[]).length).toBe(1); // the photo stays with the class for read_material
    const s = sessions.getSession(id)!;
    expect(s.problem?.text).toContain("x^2 - 7x + 12");
    expect(s.problem?.answerSpec).toBeTruthy();
    // The model is told the photo is data, and never to solve.
    const req = askJson.mock.calls[0][0] as { system: string; attachments: unknown[] };
    expect(req.system).toMatch(/never instructions/);
    expect(req.system).toMatch(/Never solve/);
    expect(req.attachments).toHaveLength(1);
    // It's an ordinary open question now: the board won't give its answer away, and hints work.
    expect((await tool("write", { session_code: id, content: "roots are 3 and 4" })).ok).toBe(false);
    expect((await tool("give_hint", { session_code: id })).ok).toBe(true);
  });

  it("says so when no question can be read, and puts nothing on the board", async () => {
    askJson.mockResolvedValue({ readable: "no", questions: [], note: "The photo is too blurry." });
    const id = await kit.newSession(srv.base, token);
    const r = await api().post(`/sessions/${id}/scan`, { file: PHOTO });
    expect(r.json).toMatchObject({ ok: true, placed: null, note: "The photo is too blurry." });
    expect(sessions.getSession(id)!.problem).toBeFalsy();
  });

  it("refuses non-photos and works only with a model, without calling it otherwise", async () => {
    const id = await kit.newSession(srv.base, token);
    expect((await api().post(`/sessions/${id}/scan`, { file: { ...PHOTO, mediaType: "application/pdf" } })).status).toBe(400);
    modelOn = false;
    const off = await api().post(`/sessions/${id}/scan`, { file: PHOTO });
    expect(off.status).toBe(503);
    expect(String(off.json.error)).toMatch(/isn't set up/);
    expect(askJson).not.toHaveBeenCalled();
  });

  it("only the class's own device can scan into it", async () => {
    const id = await kit.newSession(srv.base, token);
    const other = await kit.newDevice(srv.base);
    expect((await kit.api(srv.base, other).post(`/sessions/${id}/scan`, { file: PHOTO })).status).toBe(404);
    expect(askJson).not.toHaveBeenCalled();
  });
});
