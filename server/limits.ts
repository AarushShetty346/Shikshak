// Rate limits, daily quotas and concurrency caps. In memory (one server process); daily counters
// are also saved so a restart doesn't reset a day's spending.

import { config } from "./config";
import { store } from "./store";

// ---------- token buckets (requests per window) ----------

interface Bucket {
  tokens: number;
  at: number;
}
const buckets = new Map<string, Bucket>();

/** True if the action is allowed now. `perMinute` refills continuously, `burst` is the bucket size. */
export function allow(key: string, perMinute: number, burst = perMinute): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size > 20000) buckets.clear(); // memory guard against key floods
    b = { tokens: burst, at: now };
    buckets.set(key, b);
  }
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 60000) * perMinute);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// ---------- daily quotas ----------

interface Usage {
  day: string;
  counts: Record<string, number>;
}

const today = () => new Date().toISOString().slice(0, 10);

function usageFor(key: string): Usage {
  const id = key.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  const u = store.get<Usage>("usage", id);
  if (u && u.day === today()) return u;
  return { day: today(), counts: {} };
}

function saveUsage(key: string, u: Usage) {
  store.put("usage", key.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80), u);
}

export function usedToday(key: string, what: string): number {
  return usageFor(key).counts[what] ?? 0;
}

/** Adds `amount` to today's counter if it stays within `limit`. Returns false (and adds nothing) otherwise. */
export function spend(key: string, what: string, amount: number, limit: number): boolean {
  const u = usageFor(key);
  const now = u.counts[what] ?? 0;
  if (now + amount > limit) return false;
  u.counts[what] = now + amount;
  saveUsage(key, u);
  return true;
}

export function addUsage(key: string, what: string, amount: number) {
  const u = usageFor(key);
  u.counts[what] = (u.counts[what] ?? 0) + amount;
  saveUsage(key, u);
}

// ---------- concurrency (model calls) ----------

let running = 0;
const waiting: (() => void)[] = [];

/** Runs `fn` when a model slot is free. Rejects quickly if the queue is already long. */
export async function withModelSlot<T>(fn: () => Promise<T>): Promise<T> {
  const max = Math.max(1, config.limits.maxModelConcurrency());
  if (running >= max) {
    if (waiting.length >= max * 8) throw new BusyError("The server is busy reading other students' work. Try again in a moment.");
    await new Promise<void>((r) => waiting.push(r));
  }
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

export class BusyError extends Error {
  override name = "BusyError";
}
export class QuotaError extends Error {
  override name = "QuotaError";
}

/** Checks and counts one model call for a device. Throws QuotaError over the daily limit. */
export function chargeModelCall(deviceId: string | null, kind: "check" | "plan" | "material" | "solve") {
  if (!deviceId) return;
  const limit = kind === "plan" ? config.limits.plansPerOwnerPerDay() : config.limits.modelCallsPerOwnerPerDay();
  if (!spend(`device_${deviceId}`, `model_${kind === "plan" ? "plan" : "call"}`, 1, limit))
    throw new QuotaError(kind === "plan" ? "Today's limit for new lesson plans is reached on this device." : "Today's limit for checking work is reached on this device.");
}

export function resetLimits() {
  buckets.clear();
  running = 0;
  waiting.length = 0;
}
