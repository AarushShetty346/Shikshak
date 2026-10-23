# Deploying Shikshak

The live site is https://shikshak-o0l8.onrender.com, deployed by Render from `main` with
[`render.yaml`](../render.yaml). Every variable is described in [`.env.example`](../.env.example).

## Before merging the roadmap work (`v4-roadmap`) into `main`

In production the server now **requires** `TOOLS_TOKEN`. Without it, two things break:

- `/api/health` returns 503, which fails Render's health check.
- The board tools refuse every call, so a voice class can talk but can't write on the board.

The live Bolna agents (checked 2026-10-24) still have the 11 old tools and send no token. Do these
steps in this order:

1. **Make a token** (keep it secret; don't paste it into chat or commit it):

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

2. **On Render:** Dashboard, then shikshak, then Environment.
   - Set `TOOLS_TOKEN` to that value.
   - Optionally set `ADMIN_TOKEN` (a different random value) to enable the operator endpoints.
   - Don't redeploy yet.
3. **Locally:** put the same `TOOLS_TOKEN` in `.env`, then run:

   ```bash
   npm run bolna:setup
   ```

   This updates all three agents (normal, slower, faster):
   - the new prompt, with learner memory, hints, checked answers and practice marks;
   - the 19 tools, each sending the token;
   - Tamil and Telugu voices.

   It doesn't place any calls.
4. **Merge** `v4-roadmap` into `main`. Render deploys it.
5. **Check the deploy:**
   - Open `/api/health`: `ready` should be `true` and `configured.toolsAuth` should be `true`.
   - Open `/api/health/providers`: Gemini and Bolna should show `verified: true`.
   - Start a short class and press Done once.
6. **Only after step 3:** set `BOLNA_AGENT_LANGUAGES=hi,en,ta,te` on Render so Tamil and Telugu
   classes can start voice. They stay labelled "preview" until a fluent speaker has reviewed them.

**Rollback:** redeploy the previous commit from Render's dashboard. The agents keep working
with either server version as long as `TOOLS_TOKEN` matches.

## Data and persistence

Learners, classes, attempts, reports and phone consent are JSON files under `DATA_DIR` (default
`data/`). Writes are atomic.

**Render's free plan has no persistent disk**, so everything is wiped on every deploy and restart.
The board snapshot also lives in the browser, and the app re-sends it after a server restart, so
an open class survives. Learner history and reports don't. For a pilot, use one of these:

- a paid Render instance with a persistent disk mounted at, say, `/var/data`, and
  `DATA_DIR=/var/data`;
- any host with a disk (a VM, Railway with a volume, Fly with a volume).

Old classes are swept after `SESSION_TTL_DAYS` (default 60) without use.

## Health checks

| Endpoint | Says | Cost |
| --- | --- | --- |
| `/api/health` | What is **configured** (keys present, tools token, disk or memory). 503 in production without `TOOLS_TOKEN`. | none |
| `/api/health/providers` | Whether each provider **accepted** its key just now (Gemini, Anthropic, Bolna). Cached 10 minutes, rate limited. Never returns keys or provider error text. | free metadata requests |

## Limits that protect the bill

The defaults are in `.env.example`. Per device:

- 1 voice class at a time;
- 60 voice minutes a day;
- 400 checker calls a day;
- 25 plans a day.

Server-wide:

- 2 simultaneous voice classes and 240 voice minutes a day;
- calls longer than 20 minutes are ended.

Measured cost so far is about 6.5 (account currency) per voice minute. See
[`benchmark/README.md`](../benchmark/README.md).

## Phone revision calls (off by default)

Nothing calls anyone until all of the following are true:

1. `npm run bolna:setup -- --phone` has created the phone agent, and `BOLNA_PHONE_AGENT_ID` is set.
2. The Bolna account has a phone number that supports keypad input (Plivo or Twilio). It costs
   money, so buy it only with authorization.
3. `PHONE_CALLS_ENABLED=1`, `ADMIN_TOKEN` and `PHONE_ALLOWLIST` (approved E.164 numbers) are set.
4. A guardian has enrolled the number on the learner's page, with consent and the student's agreement.
5. An operator places each call:

   ```bash
   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"confirm":true}' https://<host>/api/admin/phone/<learnerId>/call
   ```

   There is deliberately no automatic schedule.

The server also enforces these on every call:

- the call window, in the learner's time zone, never outside 9:00 to 21:00;
- one call per number per day;
- no overlapping calls;
- the server-wide cap;
- opt-out ("stop", pressing 9, or the app).

Use `GET /api/admin/phone` to see who could be called now, and why not.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push to `main` and on pull
requests:

- type-check, lint (oxlint), unit and integration tests, build;
- browser tests (Playwright on the runner's Chrome, desktop and phone sizes).

It uses no secrets. To run the same checks locally:

```bash
npm run check
npm run test:e2e
```
