// Sharing a learner's progress with a teacher, explicitly. The learner's device makes a one-time
// code (single use, 24 hours, ~50 bits, claims rate limited); the teacher's device redeems it.
// A teacher only ever sees learners shared with them this way. The learner's device can list and
// revoke grants at any time.

import { randomBytes } from "node:crypto";
import { getLearner, type Learner } from "./learners";
import { store } from "./store";

export interface ShareCode {
  code: string;
  learnerId: string;
  deviceId: string;
  createdAt: number;
  expiresAt: number;
}

export interface Grant {
  id: string;
  learnerId: string;
  /** The learner's device (the owner of the data). */
  ownerDeviceId: string;
  /** The teacher's device. */
  teacherDeviceId: string;
  teacherLabel: string;
  createdAt: number;
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const codes = new Map<string, ShareCode>(); // short-lived: memory is enough

function code(): string {
  let out = "";
  for (const b of randomBytes(10)) out += ALPHABET[b % ALPHABET.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function createShareCode(l: Learner): ShareCode {
  const now = Date.now();
  for (const [k, c] of codes) if (c.expiresAt < now) codes.delete(k);
  // At most 3 live codes per learner.
  const live = [...codes.values()].filter((c) => c.learnerId === l.id).sort((a, b) => a.createdAt - b.createdAt);
  while (live.length >= 3) codes.delete(live.shift()!.code);
  const c: ShareCode = { code: code(), learnerId: l.id, deviceId: l.deviceId, createdAt: now, expiresAt: now + 24 * 3600_000 };
  codes.set(c.code, c);
  return c;
}

export class ShareError extends Error {
  override name = "ShareError";
}

/** A teacher's device redeems a code. Single use. */
export function claimShareCode(raw: string, teacherDeviceId: string, teacherLabel: string): Grant {
  const key = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const formatted = key.length === 10 ? `${key.slice(0, 5)}-${key.slice(5)}` : "";
  const c = codes.get(formatted);
  codes.delete(formatted);
  if (!c || c.expiresAt < Date.now()) throw new ShareError("That code doesn't work. Codes are single use and expire after 24 hours.");
  if (c.deviceId === teacherDeviceId) throw new ShareError("Use this code on the teacher's own device, not this one.");
  const learner = getLearner(c.learnerId);
  if (!learner) throw new ShareError("That learner no longer exists.");
  const existing = grantsFor({ learnerId: learner.id }).find((g) => g.teacherDeviceId === teacherDeviceId);
  if (existing) return existing;
  const g: Grant = {
    id: `g_${randomBytes(12).toString("base64url")}`,
    learnerId: learner.id,
    ownerDeviceId: learner.deviceId,
    teacherDeviceId,
    teacherLabel: String(teacherLabel || "Teacher").slice(0, 40),
    createdAt: Date.now(),
  };
  store.put("shares", g.id, g, { immediate: true });
  return g;
}

export function grantsFor(filter: { learnerId?: string; teacherDeviceId?: string }): Grant[] {
  return store
    .ids("shares")
    .map((id) => store.get<Grant>("shares", id))
    .filter((g): g is Grant => Boolean(g))
    .filter((g) => (!filter.learnerId || g.learnerId === filter.learnerId) && (!filter.teacherDeviceId || g.teacherDeviceId === filter.teacherDeviceId));
}

/** The grant that lets this teacher see this learner, if any. */
export function teacherGrant(teacherDeviceId: string, learnerId: string): Grant | null {
  return grantsFor({ learnerId, teacherDeviceId })[0] ?? null;
}

export function revokeGrant(grantId: string, ownerDeviceId: string): boolean {
  const g = store.get<Grant>("shares", grantId);
  if (!g || g.ownerDeviceId !== ownerDeviceId) return false;
  store.delete("shares", grantId);
  return true;
}

/** When a learner is deleted, every grant for them goes too. */
export function revokeAllFor(learnerId: string) {
  for (const g of grantsFor({ learnerId })) store.delete("shares", g.id);
}

export function resetShares() {
  codes.clear();
}
