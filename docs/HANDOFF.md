# Handoff: where Shikshak stands (24 Oct 2026, evening IST)

Read this first if you're picking the project up, human or AI. It covers what exists, what's live,
how to run it, what's left before the deadline, and the traps we already hit.

## The project

- **Shikshak** is a voice maths tutor for class 10 (Hindi, Hinglish, English; Tamil and Telugu in
  preview). It talks over a Bolna voice call, writes on a shared board, reads the student's
  handwritten working with Gemini, and circles the wrong step.
- Built for the **Bolna Buildathon**. Submission is due **31 Oct 2026**.
- Repo: https://github.com/AarushShetty346/Shikshak (default branch `main`).
- Live site: https://shikshak-o0l8.onrender.com. Render auto-deploys `main`.
- Main docs:
  - [README](../README.md): features and how to run.
  - [DEPLOYMENT](DEPLOYMENT.md): production, tokens, persistence.
  - [DEMO](../DEMO.md): demo script.
  - [MARKING](MARKING.md): practice marks.
  - [PILOT](PILOT.md): pilot and consent.
  - [Feature matrix](SHIKSHAK_FEATURE_INVENTORY.md), section 3.
  - [Benchmarks](../benchmark/README.md).

## Current state

All of roadmap Phases 1–10 are merged and **live since 24 Oct, 18:15 IST**:

- `/api/health` says `ready: true`, production mode, tools token on.
- `/api/health/providers` shows Gemini and Bolna as verified.
- The Bolna agent was updated the same day with the new prompt, 19 tools, the tools token, and
  4 languages. Since 31 Oct there is only one agent: the speed button and the slower and faster agents were
  removed and the two agents deleted from Bolna.

The first live test class went fine: linear equations, 4 minutes, $0.25. The tools fired (hint,
look at board) with no errors, and the tutor gave a problem, a hint, checked 3 answers and offered
a harder one.

Two things were noticed in that test:

1. It spoke mostly English, with Hinglish only at the end. Check whether the class was set to
   Hinglish. If it was, the prompt or greeting needs a look.
2. "Find one solution of 2x + 3y = 12" isn't in the checked library (it has many answers), so the
   model judged it and no practice marks appeared. For demos, use library problems: quadratic
   factorisation, AP, linear in one variable.

The numbers:

- 319 unit and integration tests plus 10 Playwright browser tests, all passing. CI runs on GitHub
  for every push to `main` and every PR.
- Measured from 23 real calls before the overhaul: response time about 1.56 s median and 2.36 s
  p95, and about $0.065 per voice minute (Bolna's account currency is US dollars; the API reports cents). See `benchmark/results/`.
- Bolna wallet: **$5.48 on 31 Oct**, after the Buildathon credits. At about $0.06 a minute that's
  roughly 90 minutes of voice, so **keep test calls short**.

## How it fits together

```
Browser (React, web/src)  ⇄ WebSocket + REST ⇄  Node server (server/)  ⇄  Bolna voice agent
  board, pen, Done,                               sessions, board state,     speech in/out + LLM
  learners, reports                               checker, maths, marks      (gpt-5.4-mini); it
                                                                             calls /tools/* mid-call
```

| Area | Where |
| --- | --- |
| Server entry, routes | `server/index.ts`, `server/app.ts` |
| Tools the voice agent calls | `server/tools.ts`, `server/teaching.ts`, `server/board.ts` |
| Handwriting checker (Gemini, Claude fallback) | `server/look.ts`, `server/llm.ts` |
| Exact maths engine | `server/maths/` |
| Checked problem library, misconceptions | `server/curriculum/` (32 problems) |
| Learners, memory, mastery, streaks | `server/learners.ts` |
| Practice marks (CBSE style) | `server/marking.ts` |
| Reports, teacher sharing, pilot | `server/report.ts`, `server/shares.ts`, `server/pilot.ts` |
| Phone revision calls (off) | `server/phone.ts`, `bolna/phone-prompt.md` |
| Security, limits, storage, config | `server/auth.ts`, `server/limits.ts`, `server/store.ts`, `server/config.ts` |
| Voice call minting | `server/voice.ts` |
| Agent prompt, agent config | `bolna/agent-prompt.md`, `scripts/bolnaConfig.ts`, `scripts/setup-bolna.ts` |
| Conversation model choice (with rollback) | `bolna/llm.json`, `npm run bolna:model` |
| Benchmarks | `scripts/bench/`, `benchmark/` |
| Front end | `web/src/components/*` (Classroom, Board, Home, Setup, Progress, ...) |
| Shared types and board state | `shared/` |

## Running it locally

```bash
npm install
# Put the team .env (shared privately, not in git) in the project root, or copy .env.example and fill it in.
npm run dev          # http://localhost:8787, add ?dev=1 for the tool simulator
npm run check        # type-check, lint, unit tests, build
npm run test:e2e     # browser tests on your installed Chrome
```

- With no model key, set `FAKE_CHECKER=1` to work on the UI.
- **Use your own free Gemini key** for development (aistudio.google.com). The shared key's free
  quota also powers the live checker, so burning it locally can break the live demo for the day.
- A local voice call only works through a public URL (a tunnel). Otherwise test voice on the live
  site.

## Production: what to be careful with

- **Pushing to `main` deploys to production.** Work on a branch, open a PR (CI runs), then merge.
- **Every deploy wipes all learners and reports**, because Render's free plan has no persistent
  disk. To push docs-only changes without redeploying, put `[skip render]` in the commit message.
- **`npm run bolna:setup` changes the live voice agents immediately.**
  - It needs `TOOLS_TOKEN` in your `.env`, with the same value as on Render. A different value
    breaks every live tool call (401).
  - Coordinate before running it, and only one person runs it.
- **`TOOLS_TOKEN` is required in production.** Without it `/api/health` returns 503 and Render
  refuses the deploy (that happened on 23 Oct, which is fine and expected).
- **Tamil/Telugu voice** is configured on the agents but blocked on the site until Render has
  `BOLNA_AGENT_LANGUAGES=hi,en,ta,te`. Both are still labelled preview.
- **Phone revision calls** are fully off. They'd need a paid Plivo or Twilio number in Bolna and
  explicit agreement before any real call.
- `/api/health/providers` uses free metadata requests and caches for 10 minutes, so it's safe to
  open.

## Rules we've kept (please keep them)

- **Honesty:**
  - No made-up results, users, quotes, benchmarks or learning gains.
  - Label anything unverified, simulated or preview as such. The simulator (`?dev=1`) must be
    called a simulator on camera.
  - Practice marks are always labelled "not official".
  - No pilot has run, so there are no learning-gain claims.
- **Secrets:**
  - `.env` is never committed.
  - Never print keys in logs, chats, screenshots or issues.
  - The tools token travels only in headers.
- **Research and strategy docs stay off GitHub.** `docs/research/` and `docs/submission/` are
  local only (listed in `.git/info/exclude`; recreate that on your clone). There was a history
  rewrite on 23 Oct to remove a research commit. Don't re-add it.
- **No force-pushes to `main`.** Merge with `--no-ff` and a message like `Merge <branch>: <what>`.
- **Commit under your own name and email.** Aarush's identity is only for Aarush's commits.
- **Measure before claiming a speed-up or a fix.**
- **Uploaded teaching material is data, never instructions.** The prompts already say so; keep it
  that way.

## Gotchas we already hit

- **TypeScript 7** is installed. `typescript-eslint` doesn't support it yet, so linting uses
  **oxlint** (`npm run lint`, warnings fail).
- Bolna prompt variables use **double braces**: `{{student_name}}`.
- When the student presses **Done**, the board sends a keypad tone. It reaches the agent as
  `dtmf_number: 1`, and the prompt tells it to call `look_at_board`.
- Bolna's `tool_call_logs` field was empty for our test call even though the tools ran. Use the
  transcript and our own server logs.
- **Windows shells:**
  - Large bash heredocs and Python escape strings mangled `\u0000`-style escapes twice. Edit
    TypeScript that contains escapes with an editor, not with shell scripts.
  - A `cat > file` with no input hangs the shell.
- Random ids can contain any digits. Never assert "the answer 29 doesn't appear" on raw JSON that
  includes ids (it made one test flaky until fixed).
- The test that imports the whole server can exceed 5 s on a cold cache; it now has a 30 s timeout.
- Gemini's free tier rate-limits quickly. `bench:models` waits and retries, but latency from the
  free tier is meaningless.

## What's left before 31 Oct (in priority order)

1. **Demo rehearsal on the live site**, following `DEMO.md` with the quadratic problem, which gives
   the red circle and practice marks. Check that the tutor speaks Hinglish from the first sentence.
2. **Fix anything the rehearsal shows**, then do the **final deploy**. After the final deploy,
   recreate the demo learner "Asha" and one class, because data is wiped.
3. **Record the demo**, plus a backup take the day before.
4. **Submission text.** A draft is in `docs/submission/SUBMISSION.md` (local only). Use only
   verified claims.
5. **Optional, if there's time and money:**
   - `OPENAI_API_KEY` for `npm run bench:models` against the live model;
   - a maths teacher to review the problem library and practice marks;
   - Tamil/Telugu speakers;
   - a paid persistent disk;
   - a phone number for revision calls.

Known defects and limits:

- Data is wiped on every deploy (free plan).
- Practice marks depend on how well the handwriting is read, and the carried-forward credit only
  tracks whole numbers.
- The tutor using a learner's memory hasn't been checked in a call where there was history to
  recall.
- The web bundle is large (the build warns about it).
- `look_at_board` latency depends on Gemini's free tier.
