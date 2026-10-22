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

- **One board for both.** The page is 640 board units wide and scales to the screen, so the tutor's writing
  and the student's ink line up the same on a phone and a laptop. Tutor blocks stack below whatever is
  already written; only the visible part of the ink is drawn.
- **Done.** Sends the student's work below the latest question as a line-numbered image, and starts the
  model reading it right away. It also sends a keypad tone through the call; with `dtmf_enabled`, Bolna hands
  it to the tutor as `dtmf_number: 1`, and the prompt tells the tutor to call `look_at_board`. Saying "dekho"
  works too.
- **Session code.** The browser makes a 6-character code and passes it to Bolna as `userData`. Bolna fills it
  into every tool call, so the server knows which board to update.
- **Notes.** Photos (up to 6) or a PDF become a study plan in the chosen language: sections the tutor writes
  on the board one at a time (`show_section`) and practice problems whose answers stay on the server
  (`give_practice`, checked by `look_at_board`).
- **Turn-taking.** Soniox detects when the student has finished a thought instead of a fixed silence timer;
  the tutor stops after one word from the student.
- See [PLAN.md](PLAN.md) for the plan, schedule, and risks.

## Run it locally

```bash
npm install
cp .env.example .env    # then fill in the keys
npm run dev             # http://localhost:8787  (add ?dev=1 for the tool simulator)
npm test
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
   This creates the agent with the prompt, welcome message, voices (Sarvam, Hindi), the four board tools, and call
   limits suited to a class (20-minute calls, 2 minutes of silence allowed while the student writes). It saves
   `BOLNA_AGENT_ID` to `.env`; copy it into Render's settings too. Run it again any time to push prompt changes.
   `npm run bolna:setup -- --dry` shows what it would send.
4. **Try it.** Open the Render URL with `?dev=1`. The status line should read Voice ✓, Checker ✓, Public URL ✓.
5. **Measure the checker** before trusting it in a demo (below).

If the web call isn't enabled yet, the **Use my phone instead** link under Start has Bolna ring the student's phone
(your Bolna account needs a phone number); the board keeps working in the browser.

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
| `BOLNA_API_KEY`, `BOLNA_AGENT_ID` | Starting web calls and phone calls |
| `PUBLIC_URL` | Public HTTPS URL of the server; the agent's tools call it |
| `TOOLS_TOKEN` | Optional. If set, tool calls must send `Authorization: Bearer <token>` (set before `bolna:setup`) |
| `FAKE_CHECKER` | `1` to fake the checker for UI work |

## Deploy elsewhere

Any host that runs a long-lived Node process with WebSockets (Railway, Fly) works: build with `npm run build`,
start with `npm start`. Serverless hosts (Vercel) won't work as-is: tool calls and the browser socket must reach
the same process.

## Author

[Aarush Shetty](https://github.com/AarushShetty346)
