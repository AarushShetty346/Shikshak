# Shikshak

A maths teacher that talks to you in your language, writes on a chalkboard while explaining, and checks your
handwritten work, circling the exact step that went wrong.

Built for the [Bolna Buildathon at Symphony 2026](https://www.bolna.ai/symphony/buildathon). Voice runs on
[Bolna](https://www.bolna.ai) (web call SDK + custom function calls). Gemini (free tier) or Claude reads the
student's handwriting.

## How it works

```
Browser                                Server (Node, one process)                Bolna voice agent
 ├─ One shared, scrollable blackboard
 │   ├─ tutor blocks  ◀── WebSocket ◀── /tools/show_steps, show_section,   ◀──── tool calls
 │   │                                    give_problem, give_practice
 │   ├─ student ink (finger / stylus / mouse; two fingers scroll)
 │   └─ Done button ── capture ──────▶ starts reading the work at once (Gemini)
 │        └─ keypad tone "1#" over the call ─────────────────────────────▶ "dtmf_number: 1"
 │                                     /tools/look_at_board  ◀────────────── tutor looks
 ├─ red circle / Shabash  ◀── WebSocket ◀── result (usually instant, already read)
 └─ Voice (Bolna Web Call SDK, Soniox speech-to-text, Sarvam voice) ◀─────▶ live audio
```

- **Sessions.** The home screen lists the student's classes, like chats (for example "Maths: AP" and
  "Physics: Electricity"). Each has its own board, handwriting, plan and files, kept in the browser and re-sent to
  the server after a restart. Opening another session stops the call and closes the old board first; the server
  never routes a tool call to a session other than the one named in it.
- **Start / Pause / Resume.** One button. Pause ends the (billed) call but keeps the board; Resume starts a new call
  that's told where the lesson stopped.
- **Push-to-talk.** The mic is muted except while **Hold to talk** (or Space) is held, so room noise doesn't
  interrupt. **Stop teacher** cuts the tutor off to ask something. Hands-free is in the session menu.
- **Books and notes.** Upload a PDF or photos before or during a class. The tutor gets `read_material` (answers only
  from the pages, with page numbers) and `show_page` (puts the real page on the board, labelled with its source).
- **Speed.** Slower / normal / faster voice (0.95×, 1.1×, 1.3×). Bolna can't change speed mid-call, so each is its
  own agent and the choice applies from the next Start or Resume.
- **One board for both.** The page width is fixed per session in board units and scales to the screen, so the tutor's writing
  and the student's ink line up the same on a phone and a laptop. Tutor blocks stack below whatever is
  already written; only the visible part of the ink is drawn.
- **Done.** Sends what the student wrote since the latest question (wherever they wrote it) as a line-numbered
  image (the numbers are only in the image), shows Sending → Teacher reading → Seen, and starts the
  model reading it right away. It also sends a keypad tone through the call; with `dtmf_enabled`, Bolna hands
  it to the tutor as `dtmf_number: 1`, and the prompt tells the tutor to call `look_at_board`. Saying "dekho"
  works too.
- **Session code.** The server creates each class (an unguessable `s_…` id) and passes it to Bolna as `userData`
  when it starts the call. Bolna fills it into every tool call, so the server knows which board to update. A device
  token protects the class's own API; a shared `TOOLS_TOKEN` protects the tool endpoints.
- **Notes.** Photos (up to 6) or a PDF become a study plan in the chosen language: sections the tutor writes
  on the board one at a time (`show_section`) and practice problems whose answers stay on the server
  (`give_practice`, checked by `look_at_board`).
- **Turn-taking.** Soniox detects when the student has finished a thought instead of a fixed silence timer;
  in hands-free mode the tutor stops after two words from the student.
- See [PLAN.md](PLAN.md) for the plan, schedule, and risks.

## Teaching features

- **Learners and memory.** Several learners can share a device. Everything Shikshak "remembers" comes from
  recorded attempts: progress per skill ("secure" needs two different problems solved alone, including a fresh
  one), mistakes it has seen (with the questions they came from), and a suggested next exercise. The tutor is told
  only what's on record. A learner can say a mistake was wrongly inferred, clear their progress, or be deleted.
- **Checked maths.** A library of class 10 problems (AP, linear, quadratic, trigonometry). Every answer, worked
  step, wrong-answer "trap" and hint is recomputed by an exact maths engine in the tests. `solve` says how much was
  verified (library, exact, substituted, or unverified), and the board refuses tutor writes that give the answer away.
- **Hints, not answers.** A three-step hint ladder (nudge, method, one worked step). The full solution needs an
  explicit ask, and is recorded as such.
- **Quick check.** An adaptive 4-question check for a new topic (harder after a right answer, easier after a wrong
  one, "don't know" is fine) that says where to start.
- **Practice marks.** After Done on a checked problem, CBSE-style practice marks (½ per key step, 1 for the answer,
  an error penalised once). Labelled as not official. See [docs/MARKING.md](docs/MARKING.md).
- **Reports and sharing.** An end-of-class report card (shareable image), a progress page, and teacher access
  through a one-time code that the family can revoke.
- **Phone revision (off by default).** Short keypad revision calls for basic phones, with guardian consent, an
  operator allowlist, call windows and opt-out. Tested only against a mock; no real calls have been placed.
- **Languages.** Hindi, Hinglish and English. Tamil and Telugu are in preview: the providers support them, but no
  fluent speaker has reviewed the experience yet.
- **Pilot tools.** Pseudonymous participants, consent, equivalent quiz forms and an anonymised export
  ([docs/PILOT.md](docs/PILOT.md)). No pilot has been run yet.

## Measured

From 23 real calls (201 turns): estimated response time 1.56 s median, 2.36 s p95; about 6.5 per voice minute in
account currency. Model-only comparisons need more API keys. See [benchmark/README.md](benchmark/README.md).

## Run it locally

```bash
npm install
cp .env.example .env    # then fill in the keys
npm run dev             # http://localhost:8787  (add ?dev=1 for the tool simulator)
npm run check           # type-check, lint, tests, build
npm run test:e2e        # browser tests (uses your installed Chrome)
```

No keys yet? Put `FAKE_CHECKER=1` in `.env` and open `http://localhost:8787/?dev=1`. The tool simulator fires the
same calls the voice agent makes, and the fake checker always flags line 2.

## Go live (about an hour once you have the keys)

1. **Keys.** Bolna API key from [platform.bolna.ai](https://platform.bolna.ai) (Developers → API Keys), and a free
   Gemini API key from [aistudio.google.com](https://aistudio.google.com) (Get API key). Ask in the Bolna Slack for **Web Call SDK access**
   (it's enabled per account).
2. **Deploy.** On [Render](https://render.com): New → Blueprint → this repo. It reads [render.yaml](render.yaml).
   Fill in `GEMINI_API_KEY` and `BOLNA_API_KEY`, and set `PUBLIC_URL` to the `https://….onrender.com` address
   Render gives you.
3. **Create the voice agent.** Locally, with the same keys and `PUBLIC_URL` in `.env`:
   ```bash
   npm run bolna:setup
   ```
   This creates three agents (normal, slower, faster voice) with the prompt, welcome message, voices (Sarvam), the
   board and book tools, and call limits suited to a class (20-minute calls, 2.5 minutes of silence allowed while
   the student writes). It saves `BOLNA_AGENT_ID`, `BOLNA_AGENT_ID_SLOW` and `BOLNA_AGENT_ID_FAST` to `.env`; copy
   them into Render's settings too (render.yaml has ours). Run it again any time to push prompt changes.
   `npm run bolna:setup -- --dry` shows what it would send.
4. **Try it.** Open `/api/health/providers` on the Render URL: Gemini and Bolna should say `verified: true`. Before
   the first production deploy, follow the token steps in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
5. **Measure the checker** before trusting it in a demo (below).

To set the agent up by hand instead: paste [bolna/agent-prompt.md](bolna/agent-prompt.md) into the dashboard and
add each tool printed by `npm run bolna:tools`. Raise the call limit and the silence timeout, or Bolna hangs up
after 90 seconds.

## Measure the checker

1. Run locally with `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`) set and open `/?dev=1`.
2. Press **Give problem**, write a solution by hand (best on a tablet), sometimes with a deliberate mistake.
3. Press **Save sample for checker test** and say which line is wrong (0 if none). It's saved to `eval/`.
4. After 15 to 20 samples:
   ```bash
   npm run eval:checker
   ```
   It prints, for each sample, what the checker said, plus overall accuracy and how long checks take.

## Demo

[DEMO.md](DEMO.md) has the exact demo flow, the problem and mistake to use, a pre-recording checklist, and what to do
if something breaks live.

## Environment

| Variable | What it's for |
| --- | --- |
| `GEMINI_API_KEY` | Checking work and making lesson plans. Free tier. Model `gemini-3-flash-preview`, with automatic fallback to other Flash models when Google says it's busy; override with `GEMINI_MODEL` |
| `ANTHROPIC_API_KEY` | Paid alternative, used only when `GEMINI_API_KEY` is empty (`claude-opus-5-5`, override with `CLAUDE_MODEL`) |
| `BOLNA_API_KEY`, `BOLNA_AGENT_ID` | Starting web calls |
| `BOLNA_AGENT_ID_SLOW`, `BOLNA_AGENT_ID_FAST` | Optional. The slower and faster voice; without them every speed uses the normal agent |
| `PUBLIC_URL` | Public HTTPS URL of the server; the agent's tools call it |
| `TOOLS_TOKEN` | **Required in production.** Tool calls must send `Authorization: Bearer <token>`; set the same value before `bolna:setup` |
| `DATA_DIR` | Where learners, classes and records are stored (default `data/`). Needs a persistent disk to survive deploys |
| `ADMIN_TOKEN` | Operator endpoints (phone revision). Off when empty |
| `BOLNA_AGENT_LANGUAGES` | Languages the agents were set up with (default `hi,en`) |
| `PHONE_*` | Phone revision calls, off by default |
| `FAKE_CHECKER` | `1` to fake the checker for UI work |

All variables, with defaults: [.env.example](.env.example). Deploying, persistence and the order of steps for
the token: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Health: `/api/health` (what's configured) and
`/api/health/providers` (whether each provider accepted its key just now).

## Deploy elsewhere

Any host that runs a long-lived Node process with WebSockets (Railway, Fly) works: build with `npm run build`,
start with `npm start`. Serverless hosts (Vercel) won't work as-is: tool calls and the browser socket must reach
the same process.

## Author

[Aarush Shetty](https://github.com/AarushShetty346)
