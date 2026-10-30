// Measures the checker on saved handwriting samples (eval/cases.json): does it find the right
// line, and how long does it take? Needs GEMINI_API_KEY or ANTHROPIC_API_KEY (each sample is one
// model call). Usage: npm run eval:checker
//
// Two results per sample: the handwriting reader's own verdict, and the verdict the student actually
// sees after the maths engine has checked the reading (library problems only; see verifyReading).
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { lookAtWork, verifyReading } from "../server/look";
import { PROBLEMS } from "../server/curriculum/library";
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
const rows: { file: string; ok: boolean; shownOk: boolean; accused: boolean; expected: string; got: string; ms: number }[] = [];
/** A session-shaped object for verifyReading, when the sample's problem is in the checked library. */
const sessionFor = (problem: string | null) => {
  const p = PROBLEMS.find((x) => x.statement === problem);
  return p ? ({ problem: { id: "eval", text: p.statement, problemId: p.id, answerSpec: p.answer, kind: "practice", askedAt: 0, rung: 0 } } as never) : null;
};
const queue = [...cases];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const png = `data:image/png;base64,${readFileSync(path.join(SAMPLES_DIR, c.file)).toString("base64")}`;
      const t = Date.now();
      try {
        const r = await lookAtWork({ png, lineCount: c.lineCount, problem: c.problem, answer: c.answer, boardContext: [], language: c.language });
        const ms = Date.now() - t;
        const s = sessionFor(c.problem);
        const shown = s ? verifyReading(s, r, c.lineCount) : r;
        const right = (x: { status: string; line: number | null }) => x.status === c.expected_status && (c.expected_status !== "mistake" || x.line === c.expected_line);
        rows.push({
          file: c.file,
          ok: right(r),
          shownOk: right(shown),
          accused: c.expected_status === "correct" && shown.status === "mistake",
          expected: `${c.expected_status} ${c.expected_line ?? ""}`,
          got: `${r.status} ${r.line ?? ""}${shown !== r ? ` -> shown ${shown.status} ${shown.line ?? ""}${shown.line_source === "engine" ? " (engine)" : ""}` : ""} | ${r.what_went_wrong}`,
          ms,
        });
      } catch (err) {
        rows.push({ file: c.file, ok: false, shownOk: false, accused: false, expected: `${c.expected_status} ${c.expected_line ?? ""}`, got: `ERROR ${(err as Error).message}`, ms: Date.now() - t });
      }
    }
  }),
);

rows.sort((a, b) => a.file.localeCompare(b.file));
for (const r of rows) console.log(`${r.ok ? "✓" : "✗"} ${r.file}  expected: ${r.expected.padEnd(12)} got: ${r.got}  (${(r.ms / 1000).toFixed(1)}s)`);
const times = rows.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p: number) => (times[Math.min(times.length - 1, Math.floor(p * times.length))] / 1000).toFixed(1);
const right = rows.filter((r) => r.ok).length;
const shownRight = rows.filter((r) => r.shownOk).length;
const correctCases = cases.filter((c) => c.expected_status === "correct").length;
const accused = rows.filter((r) => r.accused).length;
console.log(`\nReader alone: ${right}/${rows.length} (${Math.round((100 * right) / rows.length)}%)`);
console.log(`What the student sees (after the maths engine): ${shownRight}/${rows.length} (${Math.round((100 * shownRight) / rows.length)}%)`);
console.log(`False accusations (correct work shown as a mistake): ${accused}/${correctCases}`);
console.log(`Time: median ${pct(0.5)}s, slowest 10% over ${pct(0.9)}s`);
