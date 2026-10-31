// Creates the Shikshak agent in your Bolna account (or updates it if its id is in .env), with the
// prompt, welcome message, voices, call limits and board tools.
//
//   npm run bolna:setup             create or update
//   npm run bolna:setup -- --dry    print the request body only
//   npm run bolna:setup -- --phone  create or update only the phone revision agent (no calls are placed)
import "dotenv/config";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { buildAgentPayload, buildPhoneAgentPayload } from "./bolnaConfig";

const dry = process.argv.includes("--dry");
const key = process.env.BOLNA_API_KEY;
const publicUrl = process.env.PUBLIC_URL;

if (!publicUrl || publicUrl.includes("example.com")) {
  console.error("Set PUBLIC_URL in .env to your server's public HTTPS address first (deploy or tunnel).");
  if (!dry) process.exit(1);
}

type AgentName = "normal" | "phone";
const ENV_KEYS: Record<AgentName, string> = { normal: "BOLNA_AGENT_ID", phone: "BOLNA_PHONE_AGENT_ID" };

function saveEnv(key: string, value: string) {
  const envFile = ".env";
  const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const line = new RegExp(`^${key}=.*$`, "m");
  if (line.test(current)) writeFileSync(envFile, current.replace(line, `${key}=${value}`));
  else appendFileSync(envFile, `${current.endsWith("\n") || !current ? "" : "\n"}${key}=${value}\n`);
}

// The class tutor (one agent, one voice agent), or with --phone only the phone revision agent.
const agents: AgentName[] = process.argv.includes("--phone") ? ["phone"] : ["normal"];
for (const agent of agents) {
  const url0 = publicUrl || "https://YOUR-SERVER.example.com";
  const body =
    agent === "phone"
      ? buildPhoneAgentPayload({ publicUrl: url0, toolsToken: process.env.TOOLS_TOKEN, maxCallSeconds: Number(process.env.PHONE_MAX_CALL_SECONDS) || 300 })
      : buildAgentPayload({ publicUrl: url0, toolsToken: process.env.TOOLS_TOKEN });
  if (dry) {
    console.log(JSON.stringify(body, null, 2));
    continue;
  }
  if (!key) {
    console.error("Set BOLNA_API_KEY in .env (platform.bolna.ai → Developers → API keys).");
    process.exit(1);
  }
  const existing = (process.env[ENV_KEYS[agent]] || "").trim();
  const url = existing ? `https://api.bolna.ai/v2/agent/${existing}` : "https://api.bolna.ai/v2/agent";
  const res = await fetch(url, {
    method: existing ? "PUT" : "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Bolna said ${res.status} for the ${agent} agent: ${text}`);
    console.error("\nIf it rejected a voice or model, change DEFAULT_VOICE in scripts/bolnaConfig.ts (voices) or roll the model back with npm run bolna:model -- --rollback.");
    process.exit(1);
  }
  if (existing) console.log(`Updated ${agent} agent ${existing}.`);
  else {
    const created = JSON.parse(text) as { agent_id: string };
    saveEnv(ENV_KEYS[agent], created.agent_id);
    console.log(`Created ${agent} agent ${created.agent_id} and saved ${ENV_KEYS[agent]} to .env.`);
  }
}
if (dry) process.exit(0);
console.log("Done. New agent ids also need to go into Render's environment (render.yaml).");
