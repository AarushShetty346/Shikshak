// Times the board reader on one image. Usage: npx tsx scripts/time-look.ts <png> [runs]
import "dotenv/config";
import { readFileSync } from "node:fs";
import { lookAtWork } from "../server/look";

const [file, runsArg] = process.argv.slice(2);
const png = `data:image/png;base64,${readFileSync(file).toString("base64")}`;
for (let i = 1; i <= Number(runsArg || 3); i++) {
  const t = Date.now();
  const r = await lookAtWork({ png, lineCount: 4, problem: "Solve: x^2 - 7x + 12 = 0", answer: "x = 3 or x = 4", boardContext: [], language: "hinglish" });
  console.log(`run ${i}: ${((Date.now() - t) / 1000).toFixed(1)}s ${r.kind}/${r.status} line=${r.line}`);
}
