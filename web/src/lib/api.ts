// Talking to the Shikshak server. This browser registers once and keeps its device token in
// localStorage; every API call sends it. If the server has forgotten the device (a restart on a
// host without a disk), the browser registers again and the caller retries.

const TOKEN_KEY = "shikshak.device";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let memoryToken: string | null = null;

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken; // storage blocked: this tab still works, it just won't remember the device
  }
}

function writeToken(t: string | null) {
  memoryToken = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

let registering: Promise<string> | null = null;

async function register(): Promise<string> {
  registering ??= (async () => {
    const r = await fetch("/api/devices", { method: "POST" });
    if (!r.ok) throw new ApiError(r.status, r.status === 429 ? "Too many sign-ins from this network. Wait a minute." : "Couldn't reach Shikshak. Check your connection.");
    const { token } = (await r.json()) as { token: string };
    writeToken(token);
    return token;
  })().finally(() => (registering = null));
  return registering;
}

export async function deviceToken(): Promise<string> {
  return readToken() ?? register();
}

/** True when the device was (re)registered during this page's life: old server sessions are gone. */
export let freshDevice = false;

/**
 * Calls the API with this device's token. On 401 it registers again once and retries.
 * Throws ApiError with a message that can be shown to the student.
 */
export async function apiFetch<T = unknown>(path: string, init: { method?: string; body?: unknown; keepalive?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await deviceToken();
    let r: Response;
    try {
      r = await fetch(`/api${path}`, {
        method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
        headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        keepalive: init.keepalive,
        signal: init.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      throw new ApiError(0, "Couldn't reach Shikshak. Check your connection.");
    }
    if (r.status === 401 && attempt === 0) {
      writeToken(null);
      freshDevice = true;
      continue;
    }
    if (r.status === 204) return undefined as T;
    const data = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new ApiError(r.status, data.error || `Request failed (${r.status})`);
    return data as T;
  }
  throw new ApiError(401, "This device couldn't sign in to Shikshak.");
}

/** For tests. */
export function resetApi() {
  memoryToken = null;
  registering = null;
  freshDevice = false;
}
