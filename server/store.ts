// Durable state: one JSON file per record under DATA_DIR/<collection>/<id>.json.
// Writes are atomic (temp file + rename) and debounced per record; flush() writes everything
// pending (called on shutdown). DATA_DIR=":memory:" keeps state in memory only (tests, or a host
// without a disk; then state lasts only as long as the process).
//
// This is deliberately small: one server process, no external database. It survives restarts on
// any host with a persistent disk. On hosts whose disk is wiped on restart (Render's free plan),
// sessions are rebuilt from the student's device and teacher-only state is lost; see
// docs/DEPLOYMENT.md.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config";

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export type Collection = "devices" | "tokens" | "learners" | "sessions" | "attempts" | "reports" | "phone" | "shares" | "pilot" | "usage" | "groups";

class Store {
  private mem = new Map<string, Map<string, unknown>>();
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private dir: string | null = null;
  private dirFor = "";

  private root(): string | null {
    const d = config.dataDir();
    if (d === ":memory:") return null;
    if (this.dirFor !== d) {
      this.dirFor = d;
      this.dir = path.resolve(d);
      mkdirSync(this.dir, { recursive: true });
    }
    return this.dir;
  }

  private col(c: Collection): Map<string, unknown> {
    let m = this.mem.get(c);
    if (!m) this.mem.set(c, (m = new Map()));
    return m;
  }

  private file(c: Collection, id: string): string | null {
    const r = this.root();
    return r ? path.join(r, c, `${id}.json`) : null;
  }

  get<T>(c: Collection, id: string): T | undefined {
    if (!SAFE_ID.test(id)) return undefined;
    const m = this.col(c);
    if (m.has(id)) return m.get(id) as T;
    const f = this.file(c, id);
    if (!f || !existsSync(f)) return undefined;
    try {
      const value = JSON.parse(readFileSync(f, "utf8")) as T;
      m.set(id, value);
      return value;
    } catch (err) {
      console.error(`[store] unreadable ${c}/${id}; ignoring it`, (err as Error).message);
      return undefined;
    }
  }

  put<T>(c: Collection, id: string, value: T, opts: { immediate?: boolean } = {}) {
    if (!SAFE_ID.test(id)) throw new Error(`unsafe id for ${c}`);
    this.col(c).set(id, value);
    const key = `${c}/${id}`;
    clearTimeout(this.pending.get(key));
    if (opts.immediate) {
      this.pending.delete(key);
      this.write(c, id);
      return;
    }
    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key);
        this.write(c, id);
      }, 250),
    );
  }

  private write(c: Collection, id: string) {
    const f = this.file(c, id);
    if (!f) return;
    const value = this.col(c).get(id);
    if (value === undefined) return;
    try {
      mkdirSync(path.dirname(f), { recursive: true });
      const tmp = `${f}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(value));
      renameSync(tmp, f);
    } catch (err) {
      console.error(`[store] couldn't save ${c}/${id}`, (err as Error).message);
    }
  }

  delete(c: Collection, id: string) {
    if (!SAFE_ID.test(id)) return;
    this.col(c).delete(id);
    const key = `${c}/${id}`;
    clearTimeout(this.pending.get(key));
    this.pending.delete(key);
    const f = this.file(c, id);
    if (f) rmSync(f, { force: true });
  }

  /** Every id in a collection (memory and disk). */
  ids(c: Collection): string[] {
    const out = new Set(this.col(c).keys());
    const r = this.root();
    if (r && existsSync(path.join(r, c))) {
      for (const name of readdirSync(path.join(r, c))) if (name.endsWith(".json")) out.add(name.slice(0, -5));
    }
    return [...out].filter((id) => SAFE_ID.test(id));
  }

  /** Drop a record from memory only (it stays on disk and loads again on demand). */
  unload(c: Collection, id: string) {
    const key = `${c}/${id}`;
    if (this.pending.has(key)) {
      clearTimeout(this.pending.get(key));
      this.pending.delete(key);
      this.write(c, id);
    }
    if (this.root()) this.col(c).delete(id);
  }

  flush() {
    for (const [key, t] of this.pending) {
      clearTimeout(t);
      const [c, id] = key.split("/") as [Collection, string];
      this.write(c, id);
    }
    this.pending.clear();
  }

  /** Tests: forget everything (memory, pending writes, and the on-disk data if any). */
  reset() {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
    this.mem.clear();
    const r = this.root();
    if (r && config.dataDir() !== ":memory:" && process.env.VITEST) rmSync(r, { recursive: true, force: true });
    this.dirFor = "";
  }
}

export const store = new Store();
