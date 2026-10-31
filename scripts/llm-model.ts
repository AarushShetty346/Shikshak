// Choose the conversation model for the Bolna agent, with rollback. This only edits
// bolna/llm.json; nothing changes on Bolna until you run npm run bolna:setup.
//
//   npm run bolna:model                                         show current and previous
//   npm run bolna:model -- --set openai:gpt-5.4 --evidence benchmark/results/models-<stamp>.md
//   npm run bolna:model -- --rollback
import { existsSync, writeFileSync } from "node:fs";
import { LLM_FILE, readLlmConfig, rollbackLlm, switchLlm } from "./bolnaConfig";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const today = new Date().toISOString().slice(0, 10);
let cfg = readLlmConfig();
const set = arg("--set");
if (set) {
  const evidence = arg("--evidence") ?? "";
  if (!evidence || !existsSync(evidence)) {
    console.error("Pass --evidence <benchmark result file> that supports the switch (run npm run bench:models first).");
    process.exit(1);
  }
  const [provider, ...rest] = set.split(":");
  cfg = switchLlm(cfg, { provider, model: rest.join(":") }, evidence, today);
} else if (process.argv.includes("--rollback")) {
  cfg = rollbackLlm(cfg, today);
}
if (set || process.argv.includes("--rollback")) {
  writeFileSync(LLM_FILE, JSON.stringify(cfg, null, 2) + "\n");
  console.log("Saved bolna/llm.json. Run npm run bolna:setup to apply it to the agent.");
}
const show = (c: typeof cfg.current | null) => (c ? `${c.provider}:${c.model} (since ${c.since}; ${c.evidence})` : "none");
console.log(`Current:  ${show(cfg.current)}\nPrevious: ${show(cfg.previous)}`);
