// Who may touch a session. Each browser registers once and gets a device token (a 256-bit random
// secret, stored only as a SHA-256 hash on the server). Every API call sends it as a bearer token;
// a session, learner or report belongs to exactly one device. Session ids are long random values
// too, but they are references, not credentials: knowing one is never enough to read or change it.
//
// The WebSocket can't send headers from a browser, so the page first asks for a single-use,
// 60-second ticket over HTTPS (with its token) and opens the socket with that.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { store } from "./store";

export interface Device {
  id: string;
  createdAt: number;
  lastSeen: number;
  /** Ids of this device's sessions and learners (an index, so lookups don't scan every record). */
  sessions?: string[];
  learners?: string[];
}

export function getDevice(id: string): Device | undefined {
  return store.get<Device>("devices", id);
}

export function updateDevice(id: string, fn: (d: Device) => void) {
  const d = store.get<Device>("devices", id);
  if (!d) return;
  fn(d);
  store.put("devices", id, d);
}

interface TokenRecord {
  deviceId: string;
  createdAt: number;
}

export const randomId = (bytes = 16) => randomBytes(bytes).toString("base64url");
const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

export function registerDevice(): { device: Device; token: string } {
  const device: Device = { id: `d_${randomId(12)}`, createdAt: Date.now(), lastSeen: Date.now() };
  const token = randomId(32);
  store.put<Device>("devices", device.id, device, { immediate: true });
  store.put<TokenRecord>("tokens", hashToken(token), { deviceId: device.id, createdAt: Date.now() }, { immediate: true });
  return { device, token };
}

export function deviceForToken(token: string | undefined): Device | null {
  if (!token || token.length < 20 || token.length > 100) return null;
  const rec = store.get<TokenRecord>("tokens", hashToken(token));
  if (!rec) return null;
  const device = store.get<Device>("devices", rec.deviceId);
  if (!device) return null;
  if (Date.now() - device.lastSeen > 60_000) {
    device.lastSeen = Date.now();
    store.put("devices", device.id, device);
  }
  return device;
}

export function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  return h && h.startsWith("Bearer ") ? h.slice(7).trim() : undefined;
}

declare module "express-serve-static-core" {
  interface Request {
    device?: Device;
  }
}

/** Express middleware: 401 unless the request carries a valid device token. */
export function requireDevice(req: Request, res: Response, next: NextFunction) {
  const device = deviceForToken(bearer(req));
  if (!device) {
    res.status(401).json({ error: "This device isn't signed in to Shikshak. Reload the page." });
    return;
  }
  req.device = device;
  next();
}

/** Constant-time comparison for shared secrets. */
export function sameSecret(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- WebSocket tickets ----------

interface Ticket {
  deviceId: string;
  sessionId: string;
  expires: number;
}
const tickets = new Map<string, Ticket>();

export function issueTicket(deviceId: string, sessionId: string): string {
  const now = Date.now();
  for (const [k, t] of tickets) if (t.expires < now) tickets.delete(k);
  if (tickets.size > 5000) tickets.delete(tickets.keys().next().value!);
  const ticket = randomId(24);
  tickets.set(ticket, { deviceId, sessionId, expires: now + 60_000 });
  return ticket;
}

/** Single use: a ticket works once, within 60 seconds. */
export function redeemTicket(ticket: string | null): Ticket | null {
  if (!ticket) return null;
  const t = tickets.get(ticket);
  tickets.delete(ticket);
  return t && t.expires >= Date.now() ? t : null;
}

export function resetAuth() {
  tickets.clear();
}
