// Every test starts from a clean, offline environment: no real provider keys inherited from the
// developer's shell or .env, state in memory only, development mode.
for (const key of [
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "BOLNA_API_KEY",
  "BOLNA_AGENT_ID",
  "TOOLS_TOKEN",
  "FAKE_CHECKER",
  "PUBLIC_URL",
  "ADMIN_TOKEN",
  "PHONE_CALLS_ENABLED",
  "PHONE_ALLOWLIST",
  "ALLOWED_ORIGINS",
]) {
  delete process.env[key];
}
process.env.DATA_DIR = ":memory:";
process.env.NODE_ENV = "test";
