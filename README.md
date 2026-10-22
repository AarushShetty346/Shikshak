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

## Set up the Bolna agent

1. Create an agent at [platform.bolna.ai](https://platform.bolna.ai). Ask for Web Call SDK access in the Bolna
   Slack (it's enabled per account).
2. Paste the prompt and welcome message from [bolna/agent-prompt.md](bolna/agent-prompt.md).
3. Expose your server over HTTPS (deploy, or a tunnel like `cloudflared tunnel --url http://localhost:8787`) and
   put that URL in `PUBLIC_URL`.
4. `npm run bolna:tools` prints the four custom functions. Add each one in the agent's Tools tab.
5. Put `BOLNA_API_KEY` and `BOLNA_AGENT_ID` in `.env` and restart.

## Environment

| Variable | What it's for |
| --- | --- |
| `ANTHROPIC_API_KEY` | Checking work and making lesson plans (model: `claude-opus-5-5`, override with `CLAUDE_MODEL`) |
| `BOLNA_API_KEY`, `BOLNA_AGENT_ID` | Minting web-call sessions |
| `PUBLIC_URL` | Public HTTPS URL, used by `npm run bolna:tools` |
| `TOOLS_TOKEN` | Optional. If set, tool calls must send `Authorization: Bearer <token>` |
| `FAKE_CHECKER` | `1` to fake the checker for UI work |

## Deploy

Any host that runs a long-lived Node process with WebSockets (Render, Railway, Fly). Build with `npm run build`,
start with `npm start`. Serverless hosts (Vercel) won't work as-is: tool calls and the browser socket must reach
the same process.

## Author

[Aarush Shetty](https://github.com/AarushShetty346)
