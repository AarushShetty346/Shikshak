// Phase 1: who can touch what, malformed input, resource limits and the session lifecycle.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "../shared/types";

const askJson = vi.fn();
vi.mock("./llm", () => ({
  askJson: (...args: unknown[]) => askJson(...args),
  hasModel: () => true,
  modelName: () => "test-model",
  dataUrlToAttachment: (url: string) => ({ mediaType: "image/png", data: url.split(",")[1] }),
}));

const sessions = await import("./sessions");
const { store } = await import("./store");
const { resetLimits } = await import("./limits");
const { resetVoice, mintVoice } = await import("./voice");
const kit = await import("./testkit");
const { PNG } = kit;

let srv: Awaited<ReturnType<typeof kit.startServer>>;
let token: string;

beforeAll(async () => {
  srv = await kit.startServer();
});
afterAll(() => srv.close());
beforeEach(async () => {
  sessions.resetSessions();
  store.reset();
  resetLimits();
  resetVoice();
  askJson.mockReset();
  token = await kit.newDevice(srv.base);
});

const wsUrl = (q: string) => `${srv.base.replace("http", "ws")}/ws?${q}`;
const upgradeStatus = (url: string, headers: Record<string, string> = {}) =>
  new Promise<number>((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.on("open", () => {
      ws.close();
      resolve(101);
    });
    ws.on("error", () => resolve(-1));
  });

describe("ownership of sessions (HTTP)", () => {
  it("rejects requests without a device token", async () => {
    const r = await kit.api(srv.base, null).get("/sessions");
    expect(r.status).toBe(401);
    expect((await kit.api(srv.base, "made-up-token-made-up-token").get("/sessions")).status).toBe(401);
  });

  it("never shows, changes or deletes another device's session", async () => {
    const mine = await kit.newSession(srv.base, token);
    const other = await kit.newDevice(srv.base);
    const o = kit.api(srv.base, other);
    expect((await o.get(`/sessions/${mine}`)).status).toBe(404);
    expect((await o.patch(`/sessions/${mine}`, { label: "x" })).status).toBe(404);
    expect((await o.del(`/sessions/${mine}`)).status).toBe(404);
    expect((await o.post(`/sessions/${mine}/ws-ticket`)).status).toBe(404);
    expect((await o.post(`/sessions/${mine}/documents`, { files: [{ name: "a.pdf", mediaType: "application/pdf", data: "JVBERi0xLjQK" }] })).status).toBe(404);
    expect((await o.post(`/sessions/${mine}/voice`, {})).status).toBe(404);
    expect((await o.get("/sessions")).json.sessions).toEqual([]);
    expect((await kit.api(srv.base, token).get(`/sessions/${mine}`)).status).toBe(200);
  });

  it("uses long random session ids, separate from the short label shown to students", async () => {
    const r = await kit.api(srv.base, token).post("/sessions", { topic: "AP" });
    const s = r.json.session as { id: string; label: string };
    expect(s.id).toMatch(/^s_[A-Za-z0-9_-]{24}$/);
    expect(s.label).toMatch(/^[A-Z2-9]{6}$/);
  });

  it("limits sessions per device", async () => {
    process.env.MAX_SESSIONS_PER_OWNER = "2";
    try {
      await kit.newSession(srv.base, token);
      await kit.newSession(srv.base, token);
      const third = await kit.api(srv.base, token).post("/sessions", {});
      expect(third.status).toBe(409);
    } finally {
      delete process.env.MAX_SESSIONS_PER_OWNER;
    }
  });

  it("the old phone endpoint is gone", async () => {
    const r = await fetch(`${srv.base}/api/phone-call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect([401, 404]).toContain(r.status);
  });
});

describe("WebSocket access", () => {
  it("needs a valid, unused ticket for a session this device owns", async () => {
    const id = await kit.newSession(srv.base, token);
    expect(await upgradeStatus(wsUrl("ticket=nope"))).toBe(401);
    expect(await upgradeStatus(wsUrl(`code=${id}`))).toBe(401); // the old ?code= form no longer works
    const t = (await kit.api(srv.base, token).post(`/sessions/${id}/ws-ticket`)).json.ticket as string;
    expect(await upgradeStatus(wsUrl(`ticket=${t}`))).toBe(101);
    expect(await upgradeStatus(wsUrl(`ticket=${t}`))).toBe(401); // single use
  });

  it("refuses browsers from other sites", async () => {
    const id = await kit.newSession(srv.base, token);
    const t = (await kit.api(srv.base, token).post(`/sessions/${id}/ws-ticket`)).json.ticket as string;
    expect(await upgradeStatus(wsUrl(`ticket=${t}`), { Origin: "https://evil.example" })).toBe(403);
    const t2 = (await kit.api(srv.base, token).post(`/sessions/${id}/ws-ticket`)).json.ticket as string;
    const host = new URL(srv.base).host;
    expect(await upgradeStatus(wsUrl(`ticket=${t2}`), { Origin: `http://${host}` })).toBe(101);
  });
});

describe("malformed WebSocket messages never crash the server", () => {
  it("answers bad input with an error and keeps working", async () => {
    const id = await kit.newSession(srv.base, token);
    const tab = await kit.openTab(srv.base, token, id);
    const bad = [
      "not json",
      "null",
      "42",
      '"text"',
      "[]",
      JSON.stringify({ kind: "explode" }),
      JSON.stringify({ kind: "capture", id: "x", reason: "done", questionId: null, png: "data:image/png;base64,AAAA", lineCount: 2, lines: [] }),
    ];
    for (const m of bad.slice(0, 4)) tab.send(m);
    await vi.waitFor(() => expect(tab.errors()).toHaveLength(4));
    // Still alive and serving: a valid sync gets a fresh welcome.
    tab.send({ kind: "sync" });
    await vi.waitFor(() => expect(tab.messages.filter((m) => m.kind === "welcome")).toHaveLength(2));
    const health = await fetch(`${srv.base}/api/health`).then((r) => r.json());
    expect(health.ok).toBe(true);
    tab.ws.close();

    // A fresh connection: five bad messages in a row close it (policy violation).
    const t2 = await kit.openTab(srv.base, token, id);
    for (const m of bad.slice(2)) t2.send(m);
    expect(await t2.closed()).toBe(1008);
  });

  it("rejects malformed captures and hydration payloads", async () => {
    const id = await kit.newSession(srv.base, token);
    const tab = await kit.openTab(srv.base, token, id);
    tab.send({ kind: "capture", id: "c1", reason: "done", questionId: null, png: "data:image/svg+xml;base64,PHN2Zz4=", lineCount: 1, lines: [{ x: 0, y: 0, w: 1, h: 1 }] });
    tab.send({ kind: "capture", id: "c2", reason: "done", questionId: null, png: null, lineCount: 1, lines: [{ x: 0, y: 0, w: 1, h: 1 }] });
    tab.send({ kind: "hydrate", snapshot: { v: 1, seq: 1, blocks: [{ type: "write", id: "w", label: "B1", style: "evil", lines: [], place: "next", replaces: null }], highlights: [], section: null, question: null, mark: null, correct: null } });
    tab.send({ kind: "hydrate", snapshot: { v: 1, seq: 1, blocks: Array.from({ length: 401 }, (_, i) => ({ type: "page", id: `p${i}` })), highlights: [], section: null, question: null, mark: null, correct: null } });
    await vi.waitFor(() => expect(tab.errors()).toHaveLength(4));
    expect(askJson).not.toHaveBeenCalled();
    tab.ws.close();
  });

  it("closes the connection for an oversized message", async () => {
    process.env.MAX_WS_MESSAGE_BYTES = "50000";
    const local = await kit.startServer(); // maxPayload is read when the socket server starts
    try {
      const tok = await kit.newDevice(local.base);
      const id = await kit.newSession(local.base, tok);
      const tab = await kit.openTab(local.base, tok, id);
      tab.send({ kind: "sync", pad: "x".repeat(60_000) });
      expect(await tab.closed()).toBe(1009);
    } finally {
      delete process.env.MAX_WS_MESSAGE_BYTES;
      await local.close();
    }
  });

  it("limits how fast a client can submit work", async () => {
    const id = await kit.newSession(srv.base, token);
    askJson.mockResolvedValue({ kind: "answer", reading: "", status: "correct", line: null, what_went_wrong: "", say: "" });
    const tab = await kit.openTab(srv.base, token, id, { png: PNG("r"), lineCount: 1 });
    for (let i = 0; i < 8; i++) tab.done(`d${i}`, { png: PNG(`r${i}`), lineCount: 1 });
    await vi.waitFor(() => expect(tab.errors().some((e) => (e as { message: string }).message === "too many submissions")).toBe(true));
    tab.ws.close();
  });
});

describe("uploads", () => {
  const PDF = "JVBERi0xLjQK";
  const up = (id: string, files: unknown[]) => kit.api(srv.base, token).post(`/sessions/${id}/documents`, { files });

  it("checks the real file type, not just the claimed one", async () => {
    const id = await kit.newSession(srv.base, token);
    expect((await up(id, [{ name: "fake.pdf", mediaType: "application/pdf", data: "QUJDREVGRw==" }])).status).toBe(400);
    expect((await up(id, [{ name: "virus.exe", mediaType: "application/x-msdownload", data: "TVqQAAMAAAAEAAAA" }])).status).toBe(400);
    expect((await up(id, [{ name: "bad.pdf", mediaType: "application/pdf", data: "%%%not base64%%%" }])).status).toBe(400);
    expect((await up(id, [{ name: "ok.pdf", mediaType: "application/pdf", data: PDF }])).status).toBe(200);
  });

  it("enforces decoded size, file count and per-class totals", async () => {
    process.env.MAX_DOC_BYTES = "100";
    process.env.MAX_SESSION_DOC_BYTES = "150";
    process.env.MAX_DOCS_PER_SESSION = "2";
    try {
      const id = await kit.newSession(srv.base, token);
      const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(120)]).toString("base64");
      const r1 = await up(id, [{ name: "big.pdf", mediaType: "application/pdf", data: big }]);
      expect(r1.status).toBe(400);
      expect(String(r1.json.error)).toContain("over");
      const eighty = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(75)]).toString("base64");
      expect((await up(id, [{ id: "aaaa", name: "a.pdf", mediaType: "application/pdf", data: eighty }])).status).toBe(200);
      const total = await up(id, [{ id: "bbbb", name: "b.pdf", mediaType: "application/pdf", data: eighty }]);
      expect(total.status).toBe(400); // 160 bytes > 150 for the class
      expect((await up(id, [{ id: "cccc", name: "c.pdf", mediaType: "application/pdf", data: PDF }])).status).toBe(200);
      expect((await up(id, [{ id: "dddd", name: "d.pdf", mediaType: "application/pdf", data: PDF }])).status).toBe(400); // third file
    } finally {
      delete process.env.MAX_DOC_BYTES;
      delete process.env.MAX_SESSION_DOC_BYTES;
      delete process.env.MAX_DOCS_PER_SESSION;
    }
  });

  it("rejects an oversized request body cleanly", async () => {
    const id = await kit.newSession(srv.base, token);
    const r = await kit.api(srv.base, token).patch(`/sessions/${id}`, { label: "x".repeat(400_000) });
    expect(r.status).toBe(413);
  });
});

describe("session lifecycle", () => {
  it("deleting a session closes its tabs and removes everything", async () => {
    const id = await kit.newSession(srv.base, token);
    await kit.api(srv.base, token).post(`/sessions/${id}/documents`, { files: [{ name: "a.pdf", mediaType: "application/pdf", data: "JVBERi0xLjQK" }] });
    const tab = await kit.openTab(srv.base, token, id);
    const closed = tab.closed();
    expect((await kit.api(srv.base, token).del(`/sessions/${id}`)).status).toBe(204);
    expect(await closed).toBe(4004);
    expect((await kit.api(srv.base, token).get(`/sessions/${id}`)).status).toBe(404);
    expect(sessions.getSession(id)).toBeNull();
    expect(store.get("sessions", id)).toBeUndefined();
    expect((await kit.tool(srv.base, "show_steps", { session_code: id, steps: "a" })).ok).toBe(false);
  });

  it("expires sessions that haven't been used for the retention period", async () => {
    const id = await kit.newSession(srv.base, token);
    const s = sessions.getSession(id)!;
    s.lastActive = Date.now() - 61 * 86_400_000;
    sessions.save(s);
    sessions.sweep();
    expect(sessions.getSession(id)).toBeNull();
  });
});

describe("restart recovery", () => {
  it("with a disk, a session and its teacher-only state survive a restart", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "shk-"));
    process.env.DATA_DIR = dir;
    try {
      const tok = await kit.newDevice(srv.base);
      const id = await kit.newSession(srv.base, tok);
      await kit.tool(srv.base, "give_problem", { session_code: id, problem: "Solve 2x = 6", answer: "x = 3" });
      store.flush();
      // Restart: forget everything in memory, keep the disk.
      sessions.resetSessions();
      (store as unknown as { mem: Map<string, unknown> }).mem.clear();
      const back = sessions.getSession(id)!;
      expect(back.problem).toMatchObject({ text: "Solve 2x = 6", answer: "x = 3" });
      expect(back.board.blocks.map((b) => b.type)).toEqual(["problem"]);
      expect((await kit.api(srv.base, tok).get(`/sessions/${id}`)).status).toBe(200); // the device token survived too
    } finally {
      process.env.DATA_DIR = ":memory:";
      store.reset();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("without a disk, the device restores its board, but never over a live one", async () => {
    const id = await kit.newSession(srv.base, token);
    const tab = await kit.openTab(srv.base, token, id);
    const snapshot = {
      v: 1,
      seq: 2,
      blocks: [
        { type: "write", id: "w1", label: "B1", style: "heading", lines: ["AP"], place: "next", replaces: null },
        { type: "problem", id: "p1", label: "B2", problem: "Find a_10 of 2, 5, 8", questionId: "q_1" },
      ],
      highlights: [],
      section: null,
      question: { id: "q_1", text: "Find a_10 of 2, 5, 8" },
      mark: null,
      correct: null,
    };
    tab.send({ kind: "hydrate", snapshot });
    await vi.waitFor(() => expect(tab.messages.filter((m) => m.kind === "welcome")).toHaveLength(2));
    expect((await kit.tool(srv.base, "highlight", { session_code: id, target: "B2" })).ok).toBe(true); // the restored board map knows B2
    const next = await kit.tool(srv.base, "write", { session_code: id, kind: "text", content: "next" });
    expect(next.label).toBe("B3"); // labels continue after the restored ones
    tab.send({ kind: "hydrate", snapshot: { ...snapshot, blocks: [{ type: "page", id: "x" }] } });
    await new Promise((r) => setTimeout(r, 100));
    const again = await kit.openTab(srv.base, token, id);
    const w = again.messages[0] as Extract<ServerMessage, { kind: "welcome" }>;
    expect(w.snapshot.blocks.map((b) => b.type)).toEqual(["write", "problem", "write"]);
    expect(w.snapshot.seq).toBe(4);
    tab.ws.close();
    again.ws.close();
  });
});

describe("voice limits", () => {
  const okFetch = vi.fn(async () => new Response(JSON.stringify({ run_id: "r1", sip_username: "u" }), { status: 200 }));

  beforeEach(() => {
    process.env.BOLNA_API_KEY = "test-key";
    process.env.BOLNA_AGENT_ID = "agent";
    okFetch.mockClear();
  });

  it("builds the call's lesson context on the server and caps concurrent calls", async () => {
    const id = await kit.newSession(srv.base, token, { studentName: "Asha", topic: "AP" });
    const s = sessions.getSession(id)!;
    const first = await mintVoice(s, { speed: "normal", resuming: false }, okFetch as unknown as typeof fetch);
    expect(first.status).toBe(200);
    const body = JSON.parse((okFetch.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.user_data).toMatchObject({ session_code: id, student_name: "Asha", topic: "AP" });
    const second = await mintVoice(s, { speed: "normal", resuming: false }, okFetch as unknown as typeof fetch);
    expect(second.status).toBe(409); // one class at a time per device
  });

  it("refuses a Tamil or Telugu voice class until the agents have that language", async () => {
    const id = await kit.newSession(srv.base, token, { language: "ta" });
    const r = await mintVoice(sessions.getSession(id)!, { speed: "normal", resuming: false }, okFetch as unknown as typeof fetch);
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toMatch(/Tamil voice isn't switched on/);
    expect(okFetch).not.toHaveBeenCalled();
    process.env.BOLNA_AGENT_LANGUAGES = "hi,en,ta,te";
    try {
      const ok = await mintVoice(sessions.getSession(id)!, { speed: "normal", resuming: false }, okFetch as unknown as typeof fetch);
      expect(ok.status).toBe(200);
      const body = JSON.parse((okFetch.mock.calls[0] as unknown as [string, { body: string }])[1].body);
      expect(body.agent_data).toEqual({ language: "ta" });
    } finally {
      delete process.env.BOLNA_AGENT_LANGUAGES;
    }
  });

  it("stops minting when the day's voice minutes are used up", async () => {
    process.env.VOICE_MINUTES_PER_OWNER_PER_DAY = "0";
    try {
      const id = await kit.newSession(srv.base, token);
      const r = await mintVoice(sessions.getSession(id)!, { speed: "normal", resuming: false }, okFetch as unknown as typeof fetch);
      expect(r.status).toBe(429);
      expect(okFetch).not.toHaveBeenCalled();
    } finally {
      delete process.env.VOICE_MINUTES_PER_OWNER_PER_DAY;
    }
  });
});
