// Study groups: friends see each other's notes, reports and progress, and nobody else does.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const sessions = await import("./sessions");
const { store } = await import("./store");
const { resetLimits } = await import("./limits");
const kit = await import("./testkit");

let srv: Awaited<ReturnType<typeof kit.startServer>>;
beforeAll(async () => {
  srv = await kit.startServer();
});
afterAll(() => srv.close());
beforeEach(() => {
  sessions.resetSessions();
  store.reset();
  resetLimits();
});

async function person(name: string) {
  const token = await kit.newDevice(srv.base);
  const api = kit.api(srv.base, token);
  const l = (await api.post("/learners", { name, grade: "10", language: "en" })).json.learner as { id: string };
  return { token, api, learnerId: l.id };
}

describe("study groups", () => {
  it("someone starts one, a friend joins with the code, and each sees the other's classes, notes and progress", async () => {
    const asha = await person("Asha");
    const ravi = await person("Ravi");
    const sid = await kit.newSession(srv.base, asha.token, { topic: "Quadratic equations", learnerId: asha.learnerId });
    await kit.tool(srv.base, "write", { session_code: sid, style: "heading", lines: ["Quadratic equations"] });

    const g = (await asha.api.post("/groups", { learnerId: asha.learnerId })).json.group as { id: string; code: string; name: string; mine: boolean };
    expect(g).toMatchObject({ name: "Asha's study group", mine: true });
    expect(g.code).toMatch(/^[A-Z2-9]{6}$/);

    // The join screen shows who's in it, then joining.
    const preview = await ravi.api.get(`/groups/join/${g.code.toLowerCase()}`);
    expect(preview.json.group).toMatchObject({ owner: "Asha", members: [{ name: "Asha" }] });
    expect(JSON.stringify(preview.json)).not.toMatch(/deviceId/);
    const joined = await ravi.api.post(`/groups/join/${g.code}`, { learnerId: ravi.learnerId });
    expect(joined.status).toBe(200);
    expect((joined.json.group as { members: unknown[] }).members).toHaveLength(2);

    // Ravi opens Asha's classes, a report, and the board of one class.
    const seen = await ravi.api.get(`/groups/${g.id}/members/${asha.learnerId}`);
    expect(seen.status).toBe(200);
    expect(seen.json.sessions).toMatchObject([{ id: sid, topic: "Quadratic equations" }]);
    expect(seen.json.memory).toBeDefined();
    const notes = await ravi.api.get(`/groups/${g.id}/members/${asha.learnerId}/sessions/${sid}`);
    expect(notes.status).toBe(200);
    expect(JSON.stringify(notes.json.board)).toContain("Quadratic equations");
    // And the other way round.
    expect((await asha.api.get(`/groups/${g.id}/members/${ravi.learnerId}`)).status).toBe(200);
    expect(((await ravi.api.get("/groups")).json.groups as unknown[]).length).toBe(1);
  });

  it("nobody outside the group sees anything, and leaving or ending stops access at once", async () => {
    const asha = await person("Asha");
    const ravi = await person("Ravi");
    const stranger = await person("Stranger");
    const sid = await kit.newSession(srv.base, asha.token, { learnerId: asha.learnerId });
    const g = (await asha.api.post("/groups", { learnerId: asha.learnerId })).json.group as { id: string; code: string };
    await ravi.api.post(`/groups/join/${g.code}`, { learnerId: ravi.learnerId });

    expect((await stranger.api.get(`/groups/${g.id}/members/${asha.learnerId}`)).status).toBe(404);
    expect((await stranger.api.get(`/groups/${g.id}/members/${asha.learnerId}/sessions/${sid}`)).status).toBe(404);
    // A member can't use the group to read someone who isn't in it.
    expect((await ravi.api.get(`/groups/${g.id}/members/${stranger.learnerId}`)).status).toBe(404);
    // Joining needs your own learner.
    expect((await stranger.api.post(`/groups/join/${g.code}`, { learnerId: asha.learnerId })).status).toBe(400);

    expect((await ravi.api.post(`/groups/${g.id}/leave`, { learnerId: ravi.learnerId })).status).toBe(200);
    expect((await ravi.api.get(`/groups/${g.id}/members/${asha.learnerId}`)).status).toBe(404);

    await ravi.api.post(`/groups/join/${g.code}`, { learnerId: ravi.learnerId });
    expect((await ravi.api.post(`/groups/${g.id}/end`)).status).toBe(404); // only the one who started it
    expect((await asha.api.post(`/groups/${g.id}/end`)).status).toBe(200);
    expect((await ravi.api.get(`/groups/${g.id}/members/${asha.learnerId}`)).status).toBe(404);
    expect((await stranger.api.get(`/groups/join/${g.code}`)).status).toBe(404);
  });

  it("a deleted learner leaves every group", async () => {
    const asha = await person("Asha");
    const ravi = await person("Ravi");
    const g = (await asha.api.post("/groups", { learnerId: asha.learnerId })).json.group as { id: string; code: string };
    await ravi.api.post(`/groups/join/${g.code}`, { learnerId: ravi.learnerId });
    await ravi.api.del(`/learners/${ravi.learnerId}`);
    const members = ((await asha.api.get("/groups")).json.groups as { members: unknown[] }[])[0].members;
    expect(members).toHaveLength(1);
  });
});
