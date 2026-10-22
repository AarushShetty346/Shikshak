// Saved notebook snapshots with the answer a teacher would give, for measuring the checker.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SAMPLES_DIR = path.join(root, "eval", "samples");
export const CASES_FILE = path.join(root, "eval", "cases.json");

export interface Case {
  file: string;
  problem: string | null;
  answer?: string;
  language: string;
  lineCount: number;
  expected_status: "correct" | "mistake" | "incomplete" | "unreadable" | "empty";
  /** First wrong line, 1-based; null when the work is correct. */
  expected_line: number | null;
}

export function loadCases(): Case[] {
  return existsSync(CASES_FILE) ? (JSON.parse(readFileSync(CASES_FILE, "utf8")) as Case[]) : [];
}

export function saveSample(input: Omit<Case, "file" | "expected_status"> & { png: string; expected_status?: Case["expected_status"] }) {
  mkdirSync(SAMPLES_DIR, { recursive: true });
  const cases = loadCases();
  const file = `sample-${String(cases.length + 1).padStart(3, "0")}.png`;
  writeFileSync(path.join(SAMPLES_DIR, file), Buffer.from(input.png.split(",")[1] ?? "", "base64"));
  const expected_line = input.expected_line ? Number(input.expected_line) : null;
  const c: Case = {
    file,
    problem: input.problem,
    answer: input.answer,
    language: input.language,
    lineCount: input.lineCount,
    expected_status: input.expected_status ?? (expected_line ? "mistake" : "correct"),
    expected_line,
  };
  cases.push(c);
  writeFileSync(CASES_FILE, JSON.stringify(cases, null, 2) + "\n");
  return { file, total: cases.length };
}
