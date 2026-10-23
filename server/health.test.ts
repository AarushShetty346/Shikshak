import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkProviders, resetProviderCache } from "./health";

describe("provider health", () => {
  beforeEach(() => resetProviderCache());
  afterEach(() => vi.unstubAllEnvs());

  it("says not configured without keys, and makes no requests", async () => {
    const f = vi.fn();
    const r = await checkProviders(f as unknown as typeof fetch);
    expect(r.checker.gemini).toMatchObject({ configured: false, verified: false });
    expect(r.voice.bolna).toMatchObject({ configured: false, verified: false });
    expect(f).not.toHaveBeenCalled();
  });

  it("separates a working key from a rejected one, caches, and never echoes keys or bodies", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g-secret");
    vi.stubEnv("BOLNA_API_KEY", "b-secret");
    vi.stubEnv("BOLNA_AGENT_ID", "agent-1");
    const f = vi.fn(async (url: string) => (String(url).includes("bolna") ? new Response("bad key b-secret", { status: 401 }) : new Response("{}", { status: 200 })));
    const r = await checkProviders(f as unknown as typeof fetch, 1000);
    expect(r.checker.gemini).toMatchObject({ configured: true, verified: true });
    expect(r.voice.bolna).toMatchObject({ configured: true, verified: false, detail: "Key rejected (401)." });
    expect(JSON.stringify(r)).not.toMatch(/secret/);
    // The key travels in a header, not the URL.
    for (const [url] of f.mock.calls) expect(String(url)).not.toMatch(/secret/);
    await checkProviders(f as unknown as typeof fetch, 2000);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("reports an unreachable provider without throwing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const r = await checkProviders(f as unknown as typeof fetch);
    expect(r.checker.gemini).toMatchObject({ configured: true, verified: false, detail: "Couldn't reach the provider." });
  });
});
