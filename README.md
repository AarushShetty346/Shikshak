# Shikshak

A maths teacher that talks to you in your language, writes on a chalkboard while explaining, and checks your
handwritten work, circling the exact step that went wrong.

Built for the [Bolna Buildathon at Symphony 2026](https://www.bolna.ai/symphony/buildathon). Voice runs on
[Bolna](https://www.bolna.ai) (web call SDK + custom function calls). Claude reads the student's handwriting.

## How it works

```
Browser                               Server (Node, one process)                 Bolna voice agent
 ├─ Chalkboard   ◀── WebSocket ◀────── POST /tools/show_steps    ◀────────────── tool call
 ├─ Problem card ◀── WebSocket ◀────── POST /tools/give_problem  ◀────────────── tool call
 ├─ Pen notebook ── snapshot ────────▶ stored per session
 ├─ Red circle   ◀── WebSocket ◀────── POST /tools/check_work    ◀────────────── tool call
 │                                      └─ Claude reads the numbered lines, names the wrong one
 └─ Voice (Bolna Web Call SDK) ◀──────────────────────────────────────────────────▶ live audio
```

- The browser makes a 6-character **session code** and passes it to Bolna as `userData`. Bolna fills it into
  every tool call, so the server knows which screen to update.
- The student's strokes are grouped into **lines** in the browser. The snapshot sent to Claude has line numbers
  in the margin, so Claude only answers "line 2 is wrong". We draw the circle from our own stroke geometry.
- See [PLAN.md](PLAN.md) for the full plan, schedule, and risks.

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

1. **Keys.** Bolna API key from [platform.bolna.ai](https://platform.bolna.ai), Anthropic API key from
   [console.anthropic.com](https://console.anthropic.com). Ask in the Bolna Slack for **Web Call SDK access**
   (it's enabled per account).
2. **Deploy.** On [Render](https://render.com): New → Blueprint → this repo. It reads [render.yaml](render.yaml).
   Fill in `ANTHROPIC_API_KEY` and `BOLNA_API_KEY`, and set `PUBLIC_URL` to the `https://….onrender.com` address
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

1. Run locally with `ANTHROPIC_API_KEY` set and open `/?dev=1`.
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
| `ANTHROPIC_API_KEY` | Checking work and making lesson plans (model: `claude-opus-5-5`, override with `CLAUDE_MODEL`) |
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
