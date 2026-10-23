// Pure helpers for the benchmark scripts (tested in bench.test.ts).

export interface Turn {
  stt: number | null;
  llmFirst: number | null;
  llmLast: number | null;
  ttsFirst: number | null;
  response: number | null;
}

export interface CallRecord {
  id: string;
  agent?: string;
  at: string | null;
  seconds: number;
  status: string;
  config: string;
  turns: Turn[];
  interruptions: number;
  cost: { total: number; llm: number; tts: number; stt: number; platform: number };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Bolna execution JSON -> per-turn timings and itemised cost. Tolerates missing fields. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function turnsFromExecution(e: Record<string, any>): CallRecord {
  const ld = e.latency_data ?? {};
  const sttTurns: { turn: number; turn_latency?: { audio_to_text_latency?: number }[] }[] = ld.transcriber?.turns ?? [];
  const llmTurns: { turn: number; time_to_first_token?: number; time_to_last_token?: number }[] = ld.llm?.turns ?? [];
  const ttsTurns: { turn: number; time_to_first_token?: number }[] = ld.synthesizer?.turns ?? [];
  const turnIds = [...new Set([...llmTurns.map((t) => t.turn), ...sttTurns.map((t) => t.turn)])].sort((a, b) => a - b);
  const turns: Turn[] = turnIds.map((id) => {
    const stt = sttTurns.find((t) => t.turn === id);
    const lastStt = num(stt?.turn_latency?.at(-1)?.audio_to_text_latency);
    const llm = llmTurns.find((t) => t.turn === id);
    const tts = ttsTurns.find((t) => t.turn === id);
    const llmFirst = num(llm?.time_to_first_token);
    const ttsFirst = num(tts?.time_to_first_token);
    return {
      stt: lastStt,
      llmFirst,
      llmLast: num(llm?.time_to_last_token),
      ttsFirst,
      response: lastStt !== null && llmFirst !== null && ttsFirst !== null ? lastStt + llmFirst + ttsFirst : null,
    };
  });
  const u = e.usage_breakdown ?? {};
  const c = e.cost_breakdown ?? {};
  return {
    id: String(e.id ?? ""),
    at: e.created_at ?? e.initiated_at ?? null,
    seconds: num(e.conversation_duration) ?? 0,
    status: String(e.status ?? "unknown"),
    config: [u.llm_usage_breakdown?.conversation?.model, u.transcriber_model, u.synthesizer_model, u.voice_id].filter(Boolean).join(" / "),
    turns,
    interruptions: num(ld.interruption_stats?.total_interruptions) ?? 0,
    cost: {
      total: num(e.total_cost) ?? 0,
      llm: num(c.llm) ?? 0,
      tts: num(c.synthesizer) ?? 0,
      stt: num(c.transcriber) ?? 0,
      platform: num(c.platform) ?? 0,
    },
  };
}

export function percentile(values: number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[idx];
}

const stat = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return { median: percentile(v, 50), p95: percentile(v, 95), n: v.length };
};

export function summarise(records: CallRecord[]) {
  const turns = records.flatMap((r) => r.turns);
  const lessons = records.filter((r) => r.seconds >= 300).map((r) => r.cost.total);
  const sum = (f: (r: CallRecord) => number) => records.reduce((a, r) => a + f(r), 0);
  return {
    calls: records.length,
    callsWithTurns: records.filter((r) => r.turns.length).length,
    turns: turns.length,
    configs: new Set(records.map((r) => r.config).filter(Boolean)),
    stt: stat(turns.map((t) => t.stt)),
    llmFirst: stat(turns.map((t) => t.llmFirst)),
    llmLast: stat(turns.map((t) => t.llmLast)),
    ttsFirst: stat(turns.map((t) => t.ttsFirst)),
    response: stat(turns.map((t) => t.response)),
    interruptions: sum((r) => r.interruptions),
    failed: records.filter((r) => /error|failed/i.test(r.status)).length,
    minutes: sum((r) => r.seconds) / 60,
    cost: {
      total: sum((r) => r.cost.total),
      llm: sum((r) => r.cost.llm),
      tts: sum((r) => r.cost.tts),
      stt: sum((r) => r.cost.stt),
      platform: sum((r) => r.cost.platform),
      perCallMedian: percentile(records.map((r) => r.cost.total), 50) ?? 0,
    },
    lessons: { count: lessons.length, median: percentile(lessons, 50) },
  };
}
