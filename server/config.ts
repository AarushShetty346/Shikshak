// All server settings in one place, read from the environment with safe defaults.
// Values are read on each call (not cached at import) so tests can change them.

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const flag = (name: string, fallback = false): boolean => {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
};

export const config = {
  /** Public deployment: tool auth required, dev endpoints off, strict origins. */
  production: () => process.env.NODE_ENV === "production" || process.argv.includes("--prod"),

  /** Where durable state lives. ":memory:" keeps everything in memory (tests). */
  dataDir: () => process.env.DATA_DIR || "data",

  /** Shared secret Bolna sends on every tool call. Required in production. */
  toolsToken: () => process.env.TOOLS_TOKEN || "",

  /** Extra allowed browser origins for the WebSocket, comma separated (same-origin is always allowed). */
  allowedOrigins: () =>
    (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean),

  limits: {
    /** Biggest single uploaded file, decoded. */
    maxDocBytes: () => num("MAX_DOC_BYTES", 10 * 1024 * 1024),
    /** All files in one session, decoded. */
    maxSessionDocBytes: () => num("MAX_SESSION_DOC_BYTES", 20 * 1024 * 1024),
    /** Files held in memory across all sessions; least recently used sessions' files are dropped first. */
    maxTotalDocBytes: () => num("MAX_TOTAL_DOC_BYTES", 200 * 1024 * 1024),
    maxDocsPerSession: () => num("MAX_DOCS_PER_SESSION", 6),
    /** A Done/requested capture image, decoded. */
    maxCaptureBytes: () => num("MAX_CAPTURE_BYTES", 2 * 1024 * 1024),
    /** Largest WebSocket message (hydration with a long lesson is the biggest). */
    maxWsMessageBytes: () => num("MAX_WS_MESSAGE_BYTES", 3 * 1024 * 1024),
    /** Tutor blocks kept on a board; whole old pages are dropped beyond this. */
    maxBoardBlocks: () => num("MAX_BOARD_BLOCKS", 400),
    maxSessionsPerOwner: () => num("MAX_SESSIONS_PER_OWNER", 60),
    maxLearnersPerOwner: () => num("MAX_LEARNERS_PER_OWNER", 8),
    /** Sessions held in memory; idle ones are saved and unloaded beyond this. */
    maxLoadedSessions: () => num("MAX_LOADED_SESSIONS", 500),
    /** Sessions unused for this long are deleted (days). */
    sessionTtlDays: () => num("SESSION_TTL_DAYS", 60),
    /** Idle sessions are unloaded from memory after this long (minutes). */
    idleUnloadMinutes: () => num("IDLE_UNLOAD_MINUTES", 45),
    /** Cached handwriting analyses per session. */
    maxAnalysesPerSession: () => num("MAX_ANALYSES_PER_SESSION", 30),
    /** Model calls (checker, planner, material) running at once across the server. */
    maxModelConcurrency: () => num("MAX_MODEL_CONCURRENCY", 4),
    /** Model calls per device per day. */
    modelCallsPerOwnerPerDay: () => num("MODEL_CALLS_PER_OWNER_PER_DAY", 400),
    /** Lesson plans per device per day (each reads up to six pages). */
    plansPerOwnerPerDay: () => num("PLANS_PER_OWNER_PER_DAY", 25),
  },

  voice: {
    /** Calls a device may have open at once. */
    maxConcurrentPerOwner: () => num("VOICE_MAX_CONCURRENT_PER_OWNER", 1),
    /** Calls the whole server may have open at once (Bolna accounts also have their own cap). */
    maxConcurrentGlobal: () => num("VOICE_MAX_CONCURRENT", 2),
    /** Estimated voice minutes a device may use per day. */
    minutesPerOwnerPerDay: () => num("VOICE_MINUTES_PER_OWNER_PER_DAY", 60),
    /** Estimated voice minutes the whole server may use per day (spending safeguard). */
    minutesGlobalPerDay: () => num("VOICE_MINUTES_PER_DAY", 240),
    /** Longest call Bolna allows (matches call_terminate on the agent), for estimates. */
    maxCallMinutes: () => num("VOICE_MAX_CALL_MINUTES", 20),
    /** Estimated cost per minute in rupees, for the cost report only (not a billed figure). */
    estimatedRupeesPerMinute: () => num("VOICE_EST_RUPEES_PER_MINUTE", 0),
  },

  phone: {
    /** The phone revision feature is off unless explicitly enabled. */
    enabled: () => flag("PHONE_CALLS_ENABLED"),
    /** Numbers (E.164) an operator has approved for calls, comma separated. */
    allowlist: () =>
      (process.env.PHONE_ALLOWLIST ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    /** Operator secret for phone administration endpoints. */
    adminToken: () => process.env.ADMIN_TOKEN || "",
    maxCallsPerNumberPerDay: () => num("PHONE_MAX_CALLS_PER_NUMBER_PER_DAY", 1),
    maxConcurrent: () => num("PHONE_MAX_CONCURRENT", 1),
    maxCallSeconds: () => num("PHONE_MAX_CALL_SECONDS", 300),
  },
};

export type Config = typeof config;
