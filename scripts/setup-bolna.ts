// Creates the Shikshak agents in your Bolna account (or updates them if their ids are in .env):
// one per voice speed, each with the prompt, welcome message, voices, call limits and board tools.
//
//   npm run bolna:setup             create or update
//   npm run bolna:setup -- --dry    print the request body only
import "dotenv/config";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { buildAgentPayload, type SpeedName } from "./bolnaConfig";

const dry = process.argv.includes("--dry");
const key = process.env.BOLNA_API_KEY;
const publicUrl = process.env.PUBLIC_URL;

if (!publicUrl || publicUrl.includes("example.com")) {
  console.error("Set PUBLIC_URL in .env to your server's public HTTPS address first (deploy or tunnel).");
  if (!dry) process.exit(1);
}

const ENV_KEYS: Record<SpeedName, string> = { normal: "BOLNA_AGENT_ID", slower: "BOLNA_AGENT_ID_SLOW", faster: "BOLNA_AGENT_ID_FAST" };

function saveEnv(key: string, value: string) {
  const envFile = ".env";
  const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const line = new RegExp(`^${key}=.*$`, "m");
  if (line.test(current)) writeFileSync(envFile, current.replace(line, `${key}=${value}`));
  else appendFileSync(envFile, `${current.endsWith("\n") || !current ? "" : "\n"}${key}=${value}\n`);
}

// One agent per voice speed (Bolna can't change speed mid-call). The normal one is the main agent.
const speeds = (process.argv.includes("--normal-only") ? ["normal"] : ["normal", "slower", "faster"]) as SpeedName[];
for (const speed of speeds) {
  const body = buildAgentPayload({ publicUrl: publicUrl || "https://YOUR-SERVER.example.com", toolsToken: process.env.TOOLS_TOKEN, speed });
  if (dry) {
    if (speed === "normal") console.log(JSON.stringify(body, null, 2));
    continue;
  }
  if (!key) {
    console.error("Set BOLNA_API_KEY in .env (platform.bolna.ai → Developers → API keys).");
    process.exit(1);
  }
  const existing = (process.env[ENV_KEYS[speed]] || "").trim();
  const url = existing ? `https://api.bolna.ai/v2/agent/${existing}` : "https://api.bolna.ai/v2/agent";
  const res = await fetch(url, {
    method: existing ? "PUT" : "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Bolna said ${res.status} for the ${speed} agent: ${text}`);
    console.error("\nIf it rejected a voice or model, change DEFAULT_VOICE in scripts/bolnaConfig.ts (voices) or roll the model back with npm run bolna:model -- --rollback.");
    process.exit(1);
  }
  if (existing) console.log(`Updated ${speed} agent ${existing}.`);
  else {
    const created = JSON.parse(text) as { agent_id: string };
    saveEnv(ENV_KEYS[speed], created.agent_id);
    console.log(`Created ${speed} agent ${created.agent_id} and saved ${ENV_KEYS[speed]} to .env.`);
  }
}
if (dry) process.exit(0);
console.log("Done. New agent ids also need to go into Render's environment (render.yaml).");
