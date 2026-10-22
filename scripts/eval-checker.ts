// Measures the checker on saved handwriting samples (eval/cases.json): does it find the right
// line, and how long does it take? Needs ANTHROPIC_API_KEY. Usage: npm run eval:checker
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkWork } from "../server/checkWork";
import { hasModel, modelName } from "../server/llm";
import { loadCases, SAMPLES_DIR } from "../server/samples";

if (!hasModel()) {
  console.error("Set GEMINI_API_KEY (free) or ANTHROPIC_API_KEY in .env first.");
  process.exit(1);
}
const cases = loadCases();
if (cases.length === 0) {
  console.error("No samples yet. Open the app with ?dev=1, write in the notebook, and press 'Save sample'.");
  process.exit(1);
}

console.log(`Checking ${cases.length} samples with ${modelName()}…\n`);
const rows: { file: string; ok: boolean; expected: string; got: string; ms: number }[] = [];
const queue = [...cases];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const png = `data:image/png;base64,${readFileSync(path.join(SAMPLES_DIR, c.file)).toString("base64")}`;
      const t = Date.now();
      try {
        const r = await checkWork({ png, lineCount: c.lineCount, problem: c.problem, answer: c.answer, language: c.language });
        const ok = r.status === c.expected_status && (c.expected_status !== "mistake" || r.line === c.expected_line);
        rows.push({ file: c.file, ok, expected: `${c.expected_status} ${c.expected_line ?? ""}`, got: `${r.status} ${r.line ?? ""} | ${r.what_went_wrong}`, ms: Date.now() - t });
      } catch (err) {
        rows.push({ file: c.file, ok: false, expected: `${c.expected_status} ${c.expected_line ?? ""}`, got: `ERROR ${(err as Error).message}`, ms: Date.now() - t });
      }
    }
  }),
);

rows.sort((a, b) => a.file.localeCompare(b.file));
for (const r of rows) console.log(`${r.ok ? "✓" : "✗"} ${r.file}  expected: ${r.expected.padEnd(12)} got: ${r.got}  (${(r.ms / 1000).toFixed(1)}s)`);
const times = rows.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p: number) => (times[Math.min(times.length - 1, Math.floor(p * times.length))] / 1000).toFixed(1);
const right = rows.filter((r) => r.ok).length;
console.log(`\nCorrect: ${right}/${rows.length} (${Math.round((100 * right) / rows.length)}%)   Time: median ${pct(0.5)}s, slowest 10% over ${pct(0.9)}s`);
