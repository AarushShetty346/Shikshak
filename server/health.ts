// "Configured" says a key is set; "verified" says the provider accepted it just now. This checks
// each provider with a free metadata request (no model calls, no voice minutes), caches the
// answer for 10 minutes, and never returns provider error bodies or keys.

import { GEMINI_MODEL } from "./llm";

export interface ProviderCheck {
  configured: boolean;
  verified: boolean;
  detail: string;
}

export interface ProviderReport {
  checkedAt: string;
  checker: { gemini: ProviderCheck; anthropic: ProviderCheck };
  voice: { bolna: ProviderCheck };
}

const CACHE_MS = 10 * 60_000;
let cache: { at: number; report: Promise<ProviderReport> } | null = null;

async function probe(configured: boolean, run: () => Promise<Response>, ok: string): Promise<ProviderCheck> {
  if (!configured) return { configured: false, verified: false, detail: "Not configured." };
  try {
    const r = await run();
    if (r.ok) return { configured: true, verified: true, detail: ok };
    return { configured: true, verified: false, detail: r.status === 401 || r.status === 403 ? `Key rejected (${r.status}).` : `Provider answered ${r.status}.` };
  } catch (err) {
    return { configured: true, verified: false, detail: (err as Error).name === "TimeoutError" ? "No answer within 8 s." : "Couldn't reach the provider." };
  }
}

export function checkProviders(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<ProviderReport> {
  if (cache && now - cache.at < CACHE_MS) return cache.report;
  const timeout = () => AbortSignal.timeout(8000);
  const env = process.env;
  const anthropicModel = env.CLAUDE_MODEL || "claude-opus-5-5";
  const report = (async (): Promise<ProviderReport> => {
    const [gemini, anthropic, bolna] = await Promise.all([
      probe(
        Boolean(env.GEMINI_API_KEY),
        () => fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY! }, signal: timeout() }),
        `Key accepted; ${GEMINI_MODEL} is available.`,
      ),
      probe(
        Boolean(env.ANTHROPIC_API_KEY),
        () =>
          fetchImpl(`https://api.anthropic.com/v1/models/${anthropicModel}`, {
            headers: { "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
            signal: timeout(),
          }),
        `Key accepted; ${anthropicModel} is available.`,
      ),
      probe(
        Boolean(env.BOLNA_API_KEY && env.BOLNA_AGENT_ID),
        () => fetchImpl(`https://api.bolna.ai/v2/agent/${env.BOLNA_AGENT_ID}`, { headers: { Authorization: `Bearer ${env.BOLNA_API_KEY}` }, signal: timeout() }),
        "Key accepted; the class agent exists.",
      ),
    ]);
    return { checkedAt: new Date(now).toISOString(), checker: { gemini, anthropic }, voice: { bolna } };
  })();
  cache = { at: now, report };
  return report;
}

export function resetProviderCache() {
  cache = null;
}
