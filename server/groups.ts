// Study groups: friends study together, each with their own tutor, and can open each other's
// notes (the boards of their classes), class reports and progress.
// Someone starts a group and shares its link, QR code or 6-letter code; others see who is in it
// and join with one of their learner profiles. Joining is the consent: the join screen says what
// the group will see. Anyone can leave at any time, the person who started it can end it, and
// access stops the moment they do. Nothing is visible to people outside the group.

import { randomBytes } from "node:crypto";
import { getLearner, type Learner } from "./learners";
import { store } from "./store";

export interface GroupMember {
  learnerId: string;
  deviceId: string;
  name: string;
  grade: string;
  joinedAt: number;
}

export interface Group {
  id: string;
  /** What friends type or scan to join, e.g. "K7MPQ2". */
  code: string;
  name: string;
  ownerDeviceId: string;
  ownerLearnerId: string;
  createdAt: number;
  endedAt: number | null;
  members: GroupMember[];
}

export class GroupError extends Error {
  override name = "GroupError";
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MAX_MEMBERS = 8;
const MAX_GROUPS_PER_DEVICE = 5;

function newCode(): string {
  for (;;) {
    let out = "";
    for (const b of randomBytes(6)) out += ALPHABET[b % ALPHABET.length];
    if (!groupByCode(out)) return out;
  }
}

function all(): Group[] {
  return store
    .ids("groups")
    .map((id) => store.get<Group>("groups", id))
    .filter((g): g is Group => Boolean(g));
}

const save = (g: Group) => store.put("groups", g.id, g, { immediate: true });
const member = (l: Learner): GroupMember => ({ learnerId: l.id, deviceId: l.deviceId, name: l.name, grade: l.grade, joinedAt: Date.now() });

export function groupByCode(raw: unknown): Group | null {
  const code = String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (code.length !== 6) return null;
  return all().find((g) => g.code === code && !g.endedAt) ?? null;
}

export function getGroup(id: unknown): Group | null {
  const key = String(id ?? "");
  if (!/^grp_[A-Za-z0-9_-]{10,30}$/.test(key)) return null;
  return store.get<Group>("groups", key) ?? null;
}

/** The live groups a device is in (through any of its learners). */
export function groupsForDevice(deviceId: string): Group[] {
  return all()
    .filter((g) => !g.endedAt && g.members.some((m) => m.deviceId === deviceId))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function createGroup(l: Learner, name?: unknown): Group {
  if (groupsForDevice(l.deviceId).filter((g) => g.ownerDeviceId === l.deviceId).length >= MAX_GROUPS_PER_DEVICE)
    throw new GroupError(`You can run up to ${MAX_GROUPS_PER_DEVICE} study groups at once. End one first.`);
  const g: Group = {
    id: `grp_${randomBytes(12).toString("base64url")}`,
    code: newCode(),
    name: String(name ?? "").trim().slice(0, 40) || `${l.name}'s study group`,
    ownerDeviceId: l.deviceId,
    ownerLearnerId: l.id,
    createdAt: Date.now(),
    endedAt: null,
    members: [member(l)],
  };
  save(g);
  return g;
}

export function joinGroup(g: Group, l: Learner): Group {
  if (g.endedAt) throw new GroupError("This study group has ended.");
  if (g.members.some((m) => m.learnerId === l.id)) return g;
  if (g.members.length >= MAX_MEMBERS) throw new GroupError(`This group is full (${MAX_MEMBERS} people).`);
  g.members.push(member(l));
  save(g);
  return g;
}

/** A learner leaves. If nobody is left, the group ends. */
export function leaveGroup(g: Group, deviceId: string, learnerId: string): boolean {
  const before = g.members.length;
  g.members = g.members.filter((m) => !(m.learnerId === learnerId && m.deviceId === deviceId));
  if (g.members.length === before) return false;
  if (!g.members.length) g.endedAt = Date.now();
  save(g);
  return true;
}

export function endGroup(g: Group, deviceId: string): boolean {
  if (g.ownerDeviceId !== deviceId || g.endedAt) return false;
  g.endedAt = Date.now();
  save(g);
  return true;
}

/**
 * Whether this device may see this learner's notes, reports and progress through this group:
 * both must be in the same live group.
 */
export function canSee(g: Group | null, deviceId: string, learnerId: string): boolean {
  return Boolean(g && !g.endedAt && g.members.some((m) => m.deviceId === deviceId) && g.members.some((m) => m.learnerId === learnerId));
}

/** What the browser gets: no device ids. */
export function publicGroup(g: Group, deviceId: string) {
  return {
    id: g.id,
    code: g.code,
    name: g.name,
    createdAt: g.createdAt,
    ended: Boolean(g.endedAt),
    mine: g.ownerDeviceId === deviceId,
    owner: g.members.find((m) => m.learnerId === g.ownerLearnerId)?.name ?? null,
    members: g.members.map((m) => ({ learnerId: m.learnerId, name: m.name, grade: m.grade, me: m.deviceId === deviceId, live: Boolean(getLearner(m.learnerId)) })),
  };
}

/** When a learner is deleted, they leave every group. */
export function leaveAllFor(learnerId: string) {
  for (const g of all()) if (g.members.some((m) => m.learnerId === learnerId)) leaveGroup(g, g.members.find((m) => m.learnerId === learnerId)!.deviceId, learnerId);
}
