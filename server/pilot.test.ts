import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./llm", () => ({ askJson: vi.fn(), hasModel: () => false, modelName: () => "none", dataUrlToAttachment: () => ({}) }));

const { store } = await import("./store");
const { resetLimits } = await import("./limits");
const kit = await import("./testkit");
const { QUIZ_FORMS } = await import("./pilot");
const { value } = await import("./maths/algebra");

let srv: Awaited<ReturnType<typeof kit.startServer>>;
let token: string;
const api = () => kit.api(srv.base, token);

beforeAll(async () => {
  srv = await kit.startServer();
});
afterAll(() => srv.close());
beforeEach(async () => {
  store.reset();
  resetLimits();
  token = await kit.newDevice(srv.base);
});

/** Independent recomputation of every quiz answer from its AP data. */
const AP = (a: number, d: number) => ({ term: (n: number) => a + (n - 1) * d, sum: (n: number) => (n / 2) * (2 * a + (n - 1) * d), which: (t: number) => (t - a) / d + 1 });
const EXPECTED: Record<string, number> = {
  A1: 13 - 6,
  A2: AP(4, 3).term(12),
  A3: AP(30, -4).term(10),
  A4: AP(5, 4).which(65),
  A5: AP(3, 4).sum(10),
  B1: 17 - 8,
  B2: AP(5, 4).term(12),
  B3: AP(40, -5).term(10),
  B4: AP(2, 6).which(92),
  B5: AP(2, 4).sum(10),
  C1: AP(12, 3).term(9),
  C2: AP(15, 2).which(45),
  C3: AP(10, 5).sum(8),
};

describe("pilot quizzes", () => {
  it("every quiz answer is what an independent computation gives", () => {
    for (const f of Object.values(QUIZ_FORMS))
      for (const i of f.items) {
        expect(i.answer.type).toBe("value");
        expect(value((i.answer as { value: string }).value).toNumber(), i.id).toBe(EXPECTED[i.id]);
      }
  });

  it("before and after forms test the same skills, item by item", () => {
    expect(QUIZ_FORMS.A.items.map((i) => i.skill)).toEqual(QUIZ_FORMS.B.items.map((i) => i.skill));
  });

  it("needs consent and a pseudonymous code; never returns answer keys or right/wrong", async () => {
    expect((await api().post("/pilot/participants", { code: "Asha Rao", guardianConsent: true, studentAssent: true })).status).toBe(400);
    expect((await api().post("/pilot/participants", { code: "P01", guardianConsent: true, studentAssent: false })).status).toBe(400);
    const p = await api().post("/pilot/participants", { code: "P01", guardianConsent: true, studentAssent: true });
    expect(p.status).toBe(201);
    const pid = p.json.id as string;
    const form = await api().post(`/pilot/participants/${pid}/forms/A`);
    expect(JSON.stringify(form.json)).not.toContain('"value"');
    const r = await api().post(`/pilot/participants/${pid}/forms/A/answers`, { item: "A2", answer: "37", ms: 4200 });
    expect(r.json).toEqual({ recorded: true });
    expect((await api().post(`/pilot/participants/${pid}/forms/A/answers`, { item: "A2", answer: "40" })).json).toEqual({ recorded: false });
  });

  it("exports anonymised results with the right scores and a caution", async () => {
    const pid = (await api().post("/pilot/participants", { code: "P02", guardianConsent: true, studentAssent: true })).json.id as string;
    await api().post(`/pilot/participants/${pid}/forms/A`);
    for (const [item, ans] of [
      ["A1", "7"],
      ["A2", "40"],
      ["A3", "-6"],
      ["A4", ""],
      ["A5", "210"],
    ])
      await api().post(`/pilot/participants/${pid}/forms/A/answers`, { item, answer: ans, ms: 1000 });
    await api().post(`/pilot/participants/${pid}/issues`, { note: "audio dropped once" });
    await api().post(`/pilot/participants/${pid}/feedback`, { easy: 4, helpful: 5, wouldUse: 4, comment: "liked the hints" });
    const csv = await fetch(`${srv.base}/api/pilot/export.csv`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.text());
    expect(csv.split("\n")[0]).toContain("can't show cause and effect");
    expect(csv).toContain("P02,A,A4,ap.find_n,0,unanswered");
    expect(csv).toMatch(/P02,A,[^,]+,[^,]+,3,5/);
    expect(csv).toContain("audio dropped once");
    const other = await kit.newDevice(srv.base);
    expect((await kit.api(srv.base, other).get("/pilot")).json.participants).toEqual([]);
  });
});
