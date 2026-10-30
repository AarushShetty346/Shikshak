// Records the guided tour in the tutor's own voice, once, as static clips in web/public/tour/.
// The voice is the one the Bolna agent speaks with (Sarvam bulbul:v3, "suhani"; see
// scripts/bolnaConfig.ts), so the tour sounds like the teacher in class.
//
//   npm run tour:voice -- --dry-run   what would be recorded, and how many characters (no calls)
//   npm run tour:voice                record the missing clips (needs SARVAM_API_KEY; costs a little)
//   npm run tour:voice -- --prune     also delete clips no step uses any more
//
// Clips are named by a hash of the words, so only new or changed steps are recorded. Commit the
// clips; they're served as plain files and cost nothing to play.
// NOTE: the request shape follows Sarvam's text-to-speech API as we understand it; it hasn't been
// run from this repo yet. If Sarvam rejects it, the error is printed (without the key).

import "dotenv/config";
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ALL_TOURS, clipName, spoken } from "../web/src/lib/tourSteps";

const OUT = path.join(import.meta.dirname, "..", "web", "public", "tour");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

const VOICE = { model: "bulbul:v3", speaker: "suhani", target_language_code: "en-IN" } as const;

// Unique steps (the same words in two tours are one clip).
const steps = [...new Map(ALL_TOURS().map((s) => [clipName(s), s])).entries()];
mkdirSync(OUT, { recursive: true });
const missing = steps.filter(([file]) => args.has("--force") || !existsSync(path.join(OUT, file)));
const chars = missing.reduce((n, [, s]) => n + spoken(s).length, 0);

console.log(`${steps.length} tour steps; ${missing.length} to record (${chars} characters).`);
for (const [file, s] of missing) console.log(`  ${file}  "${spoken(s)}"`);

if (args.has("--prune")) {
  const keep = new Set(steps.map(([file]) => file));
  for (const f of readdirSync(OUT)) {
    if (f.startsWith("tour-") && !keep.has(f)) {
      console.log(`${dryRun ? "would delete" : "deleting"} ${f} (no step uses it)`);
      if (!dryRun) unlinkSync(path.join(OUT, f));
    }
  }
}

if (dryRun || missing.length === 0) process.exit(0);

const key = process.env.SARVAM_API_KEY;
if (!key) {
  console.error("SARVAM_API_KEY is not set (put it in .env). Nothing was recorded.");
  process.exit(1);
}

for (const [file, s] of missing) {
  const r = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-subscription-key": key },
    body: JSON.stringify({ text: spoken(s), ...VOICE, pace: 0.95, output_audio_codec: "mp3" }),
  });
  if (!r.ok) {
    console.error(`Sarvam refused "${s.title}": ${r.status} ${(await r.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const body = (await r.json()) as { audios?: string[] };
  const audio = body.audios?.[0];
  if (!audio) {
    console.error(`Sarvam returned no audio for "${s.title}": ${JSON.stringify(body).slice(0, 300)}`);
    process.exit(1);
  }
  const bytes = Buffer.from(audio, "base64");
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF") console.warn(`  note: ${file} came back as WAV, not MP3 (it still plays)`);
  writeFileSync(path.join(OUT, file), bytes);
  console.log(`recorded ${file} (${Math.round(bytes.length / 1024)} KB)  ${s.title}`);
}
console.log("Done. Commit web/public/tour/ to ship the clips.");
