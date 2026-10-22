// Creates the Shikshak agent in your Bolna account (or updates it if BOLNA_AGENT_ID is set),
// with the prompt, welcome message, voices, call limits and the four board tools.
//
//   npm run bolna:setup             create or update
//   npm run bolna:setup -- --dry    print the request body only
import "dotenv/config";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { buildAgentPayload } from "./bolnaConfig";

const dry = process.argv.includes("--dry");
const key = process.env.BOLNA_API_KEY;
const publicUrl = process.env.PUBLIC_URL;
const agentId = process.env.BOLNA_AGENT_ID;

if (!publicUrl || publicUrl.includes("example.com")) {
  console.error("Set PUBLIC_URL in .env to your server's public HTTPS address first (deploy or tunnel).");
  if (!dry) process.exit(1);
}

const body = buildAgentPayload({ publicUrl: publicUrl || "https://YOUR-SERVER.example.com", toolsToken: process.env.TOOLS_TOKEN });

if (dry) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}
if (!key) {
  console.error("Set BOLNA_API_KEY in .env (platform.bolna.ai → Developers → API keys).");
  process.exit(1);
}

const url = agentId ? `https://api.bolna.ai/v2/agent/${agentId}` : "https://api.bolna.ai/v2/agent";
const res = await fetch(url, {
  method: agentId ? "PUT" : "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = await res.text();
if (!res.ok) {
  console.error(`Bolna said ${res.status}: ${text}`);
  console.error("\nIf it rejected a voice or model, change DEFAULT_VOICE in scripts/bolnaConfig.ts.");
  console.error("If it rejected api_tools, create the agent without them in the dashboard and add the tools from `npm run bolna:tools`.");
  process.exit(1);
}

if (agentId) {
  console.log(`Updated agent ${agentId}.`);
} else {
  const created = JSON.parse(text) as { agent_id: string };
  console.log(`Created agent ${created.agent_id}.`);
  const envFile = ".env";
  const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  if (/^BOLNA_AGENT_ID=\S+/m.test(current)) {
    console.log(`Put BOLNA_AGENT_ID=${created.agent_id} in .env (it already has a different value, so I didn't change it).`);
  } else {
    appendFileSync(envFile, `${current.endsWith("\n") || !current ? "" : "\n"}BOLNA_AGENT_ID=${created.agent_id}\n`);
    console.log("Saved BOLNA_AGENT_ID to .env. Restart the server to use it.");
  }
}
console.log("Next: open the agent at platform.bolna.ai, listen to the voice, and tweak it there if you like.");
