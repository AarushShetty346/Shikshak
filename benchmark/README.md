# Benchmarks

Two separate measurements. Keep them apart: model speed on its own is not what a student hears.

## 1. Real calls: `npm run bench:calls`

Reads the call records Bolna already keeps for the agent (no calls are placed). For every
turn it takes speech-to-text latency, LLM time to first and last token, and voice time to first
audio, plus interruptions and the itemised charge per call.

"Estimated response time" = final transcript latency + LLM first token + first audio. It is built
from Bolna's component timings, so it leaves out turn detection and the network to the browser.

Latest: [`results/calls-2026-10-23T16-04-08.md`](results/calls-2026-10-23T16-04-08.md), 23 calls and 201 turns:

| Measure | Median | p95 |
| --- | --- | --- |
| Speech-to-text | 599 ms | 1243 ms |
| LLM first token | 901 ms | 1296 ms |
| Voice first audio | 151 ms | 158 ms |
| Estimated response | 1561 ms | 2364 ms |

Cost: 6.51 per minute (account currency). Platform and voice are the largest parts; the LLM is
about a sixth of it.

## 2. Model only: `npm run bench:models`

Sends the same 8 scripted classroom moments (`scripts/bench/scenarios.ts`) to each candidate. Every
candidate gets the real agent prompt and all 19 tool definitions. Scoring is automatic
(`scripts/bench/scoring.ts`):

- right tool;
- valid arguments: the session code, plus allowed values such as `kind`;
- no answer given away;
- a rough script-ratio language check.

It also writes a rating sheet (CSV) with the candidates hidden as M1, M2, ..., so a person can
score clarity, warmth and how natural the Hinglish sounds.

```bash
npm run bench:models -- --models gemini:gemini-3-flash-preview,openai:gpt-5.4-mini,anthropic:claude-haiku-5-5 --repeat 3 --gap 15000
```

Candidates without an API key are reported as "not run", never skipped silently.

Latest: [`results/models-2026-10-23T16-25-12.md`](results/models-2026-10-23T16-25-12.md). This is a smoke run on Gemini's free tier only:

- 5 of 8 scenarios completed; the free daily quota ran out on the other 3.
- Time to first token: median 1446 ms over the 5.
- Every argument was valid and no answer was given away.
- In "stuck" it wrote the formula on the board instead of calling `give_hint`.

This is not enough to choose a model.

### What a real comparison needs

- `OPENAI_API_KEY`: the live model (`gpt-5.4-mini`) can't be measured outside Bolna without it.
- `ANTHROPIC_API_KEY`, for Claude candidates.
- A paid Gemini key, or a quiet day on the free one. Free-tier throttling makes latency numbers
  meaningless: an earlier run waited up to 104 s per request.
- One or two people to fill in the rating sheet.

Rough size: 8 scenarios x 3 runs x 3 models is 72 requests of about 9k input tokens each.

## Changing the live model

`bolna/llm.json` holds the conversation model for the agent, plus the previous one.

```bash
npm run bolna:model -- --set openai:gpt-5.4 --evidence benchmark/results/models-<stamp>.md
npm run bolna:model -- --rollback
npm run bolna:setup          # applies it to the agent
```

Don't switch on a smoke run alone.
