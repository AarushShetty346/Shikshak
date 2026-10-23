// Helpers for server tests: a real HTTP + WebSocket server on a random port, devices, sessions and
// "browser tabs" that behave like the real board (they answer "checking" with a capture).

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, vi } from "vitest";
import WebSocket from "ws";
import type { BoardEvent, Box, ServerMessage, Signal } from "../shared/types";
import { createApp } from "./app";

export interface TestServer {
  server: Server;
  base: string;
  close: () => Promise<void>;
}

export async function startServer(opts: Parameters<typeof createApp>[0] = {}): Promise<TestServer> {
  const { app, attachWebSocket } = createApp(opts);
  const server = createServer(app);
  attachWebSocket(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export async function newDevice(base: string): Promise<string> {
  const r = await fetch(`${base}/api/devices`, { method: "POST" });
  expect(r.status).toBe(201);
  return ((await r.json()) as { token: string }).token;
}

export function api(base: string, token: string | null) {
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    return { status: r.status, json, headers: r.headers };
  };
  return {
    get: (p: string) => call("GET", p),
    post: (p: string, b?: unknown) => call("POST", p, b ?? {}),
    patch: (p: string, b?: unknown) => call("PATCH", p, b ?? {}),
    put: (p: string, b?: unknown) => call("PUT", p, b ?? {}),
    del: (p: string) => call("DELETE", p),
  };
}

export async function newSession(base: string, token: string, body: Record<string, unknown> = {}): Promise<string> {
  const r = await api(base, token).post("/sessions", { language: "hinglish", grade: "10", topic: "AP", ...body });
  expect(r.status).toBe(201);
  return (r.json.session as { id: string }).id;
}

export type Drawing = { png: string; lineCount: number; lines?: Box[] };
export const PNG = (seed: string) => `data:image/png;base64,${Buffer.from(`png-${seed}`).toString("base64")}`;
const boxes = (n: number): Box[] => Array.from({ length: n }, (_, i) => ({ x: 40, y: 200 + i * 50, w: 300, h: 40 }));

/** Opens a "browser tab" on a session. It answers "checking" with its current drawing, like the real board. */
export async function openTab(base: string, token: string, sessionId: string, initial: Drawing | null = null) {
  const t = await api(base, token).post(`/sessions/${sessionId}/ws-ticket`);
  expect(t.status).toBe(200);
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws?ticket=${t.json.ticket}`);
  const messages: ServerMessage[] = [];
  let drawing = initial;
  let questionId: string | null = null;
  let n = 0;
  ws.on("message", (d) => {
    const m = JSON.parse(String(d)) as ServerMessage;
    messages.push(m);
    if (m.kind === "welcome") questionId = m.snapshot.question?.id ?? null;
    if (m.kind === "event" && (m.event.type === "problem" || (m.event.type === "write" && m.event.style === "your_turn"))) questionId = m.event.questionId ?? m.event.id;
    if (m.kind === "signal" && m.signal.type === "checking" && drawing) {
      ws.send(JSON.stringify(capture(`req${++n}`, "request", drawing, questionId, m.signal.requestId)));
    }
  });
  await new Promise((r, j) => {
    ws.on("open", r);
    ws.on("error", j);
  });
  await vi.waitFor(() => expect(messages[0]?.kind).toBe("welcome"));
  const events = () => messages.filter((m) => m.kind === "event").map((m) => (m as { event: BoardEvent }).event);
  const signals = () => messages.filter((m) => m.kind === "signal").map((m) => (m as { signal: Signal }).signal);
  const errors = () => messages.filter((m) => m.kind === "error");
  return {
    ws,
    messages,
    events,
    signals,
    errors,
    question: () => questionId,
    draw: (d: Drawing | null) => (drawing = d),
    done: (id: string, d: Drawing | null = drawing, q: string | null = questionId) => ws.send(JSON.stringify(capture(id, "done", d, q))),
    send: (m: unknown) => ws.send(typeof m === "string" ? m : JSON.stringify(m)),
    closed: () => new Promise<number>((r) => (ws.readyState === ws.CLOSED ? r(-1) : ws.on("close", (code) => r(code)))),
  };
}

function capture(id: string, reason: "done" | "request", d: Drawing | null, questionId: string | null, requestId?: string) {
  const lineCount = d?.lineCount ?? 0;
  return {
    kind: "capture",
    id,
    reason,
    requestId: requestId ?? null,
    questionId,
    png: lineCount ? d!.png : null,
    lineCount,
    lines: lineCount ? (d!.lines ?? boxes(lineCount)) : [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tool(base: string, name: string, body: Record<string, unknown>, token?: string): Promise<{ status: number } & Record<string, any>> {
  return fetch(`${base}/tools/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, ...((await r.json()) as Record<string, unknown>) }));
}
