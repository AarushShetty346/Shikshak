// Paper mode: a photo of the student's working is pinned on the board, checked, and marked on the photo.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const askJson = vi.fn();
let modelOn = true;
vi.mock("./llm", () => ({
  askJson: (...args: unknown[]) => askJson(...args),
  hasModel: () => modelOn,
  modelName: () => "test-model",
  dataUrlToAttachment: (url: string) => ({ mediaType: url.slice(5, url.indexOf(";")), data: url.split(",")[1] }),
}));

const sessions = await import("./sessions");
const { store } = await import("./store");
const { resetLimits } = await import("./limits");
const kit = await import("./testkit");

const PHOTO = { id: "paper-abc123", name: "work.jpg", mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" };
const READ_SLIP = {
  kind: "working",
  reading: "1) x^2 - 3x - 4x + 12 = 0\n2) x(x - 3) + 4(x - 3) = 0\n3) (x - 3)(x + 4) = 0\n4) x = 3 or x = -4",
  status: "mistake",
  line: 3, // the reader points at the wrong line; the maths engine knows it's line 2
  what_went_wrong: "sign",
  say: "",
  final_answer: "x = 3 or x = -4",
  misconception_id: "none",
  line_boxes: [
    [0.1, 0.2],
    [0.3, 0.42],
    [0.5, 0.6],
    [0.7, 0.8],
  ],
};

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

describe("paper mode: a photo of the working", () => {
  it("is pinned on the board, read as a photo, and the first wrong line is circled on the photo", async () => {
    askJson.mockResolvedValue(READ_SLIP);
    const id = await kit.newSession(srv.base, token, { topic: "Quadratic equations" });
    const tab = await kit.openTab(srv.base, token, id);
    await tool("next_problem", { session_code: id, problem_id: "quad.fact.01" });
    const r = await api().post(`/sessions/${id}/paper`, { file: PHOTO, captureId: "cap-paper-1" });
    expect(r.status).toBe(200);
    const label = r.json.label as string;
    await vi.waitFor(() => expect(tab.events().some((e) => e.type === "mark")).toBe(true));
    const pinned = tab.events().find((e) => e.type === "source");
    expect(pinned).toMatchObject({ label, photo: true, docId: "paper-abc123" });
    const mark = tab.events().find((e) => e.type === "mark");
    expect(mark).toMatchObject({ captureId: "cap-paper-1", line: 2, box: null, on: { label, top: 0.3, bottom: 0.42 } });
    // The reader was told it's a photo and asked for line positions.
    const req = askJson.mock.calls[0][0] as { system: string; schema: { required: string[] } };
    expect(req.system).toMatch(/PHOTO of the student's working on paper/);
    expect(req.schema.required).toContain("line_boxes");
    // The student's feedback card gets the result like a Done.
    await vi.waitFor(() => expect(tab.signals().some((x) => x.type === "review" && x.state === "done" && x.captureId === "cap-paper-1")).toBe(true));
    // The tutor can point at a line of the photo.
    const hl = await tool("highlight", { session_code: id, target: `${label} line 3`, style: "circle" });
    expect(hl.ok).toBe(true);
    expect(tab.events().at(-1)).toMatchObject({ type: "highlight", target: label, line: 3, band: { top: 0.5, bottom: 0.6 } });
    tab.ws.close();
  });

  it("is what the tutor sees when she looks at the board, not the empty board", async () => {
    askJson.mockResolvedValue(READ_SLIP);
    const id = await kit.newSession(srv.base, token, { topic: "Quadratic equations" });
    const tab = await kit.openTab(srv.base, token, id, null); // nothing drawn on the board
    tab.draw({ lineCount: 0, png: kit.PNG("empty") });
    await tool("next_problem", { session_code: id, problem_id: "quad.fact.01" });
    await api().post(`/sessions/${id}/paper`, { file: PHOTO, captureId: "cap-paper-2" });
    await vi.waitFor(() => expect(tab.events().some((e) => e.type === "mark")).toBe(true));
    const look = await tool("look_at_board", { session_code: id });
    expect(look).toMatchObject({ status: "mistake", line: 2 });
    tab.ws.close();
  });

  it("refuses non-photos, and only the class's own device can send one", async () => {
    const id = await kit.newSession(srv.base, token);
    expect((await api().post(`/sessions/${id}/paper`, { file: { ...PHOTO, mediaType: "application/pdf" } })).status).toBe(400);
    const other = await kit.newDevice(srv.base);
    expect((await kit.api(srv.base, other).post(`/sessions/${id}/paper`, { file: PHOTO })).status).toBe(404);
    expect(askJson).not.toHaveBeenCalled();
  });

  it("works with the simulated checker and says so", async () => {
    modelOn = false;
    const prev = process.env.FAKE_CHECKER;
    process.env.FAKE_CHECKER = "1";
    try {
      const id = await kit.newSession(srv.base, token);
      const tab = await kit.openTab(srv.base, token, id);
      const r = await api().post(`/sessions/${id}/paper`, { file: PHOTO });
      await vi.waitFor(() => expect(tab.events().some((e) => e.type === "mark")).toBe(true));
      expect(tab.events().find((e) => e.type === "mark")).toMatchObject({ line: 2, on: { label: r.json.label } });
      expect(JSON.stringify(tab.events())).toContain("Simulated check");
      tab.ws.close();
    } finally {
      process.env.FAKE_CHECKER = prev;
    }
  });
});
