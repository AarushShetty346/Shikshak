# Shikshak: build plan (Bolna Buildathon, submit by Oct 31, 2026)

The product name is Shikshak ("teacher" in Hindi). The board font is also called Kalam; that is just the font.

## What we're building (demo scope)

A voice maths tutor in the browser for class 10, speaking Hindi or Hinglish, that:

1. Takes a topic (and optionally a photo or PDF of notes) and makes a short lesson plan.
2. Teaches out loud through a Bolna voice agent and writes the steps on a board while talking.
3. Gives a problem, lets the student solve it with a pen on a canvas, and when they say "check karo",
   finds the wrong step, says what went wrong in Hindi, and circles that line in red.

Everything else is cut until the demo works end to end.

## How it fits together

```
Browser (React + Vite)                Server (Node + Express + WebSocket)       Bolna
 ├─ Setup screen (topic, language, notes) ─▶ POST /api/plan  (LLM makes plan)
 ├─ "Start class" ── POST /api/bolna-session ─▶ mints web-call session ───────▶ voice call
 ├─ Tutor board  ◀── WebSocket "board" events ◀── POST /tools/show_steps   ◀── agent tool call
 ├─ Problem card ◀── WebSocket ◀────────────────── POST /tools/give_problem ◀── agent tool call
 ├─ Student pen canvas ── strokes + PNG ──▶ stored per session
 └─ Red circle   ◀── WebSocket ◀────────────────── POST /tools/check_work   ◀── agent tool call
                                                   └─ vision model reads the numbered lines,
                                                      returns the wrong line + what to say
```

### Key design choices

- **One long-running Node process** serves the web app, the WebSocket and the tool endpoints. Bolna's tool
  calls and the student's browser have to meet in the same memory, which serverless (Vercel) can't do
  without extra setup. Deploy on Render or Railway. For local dev, expose the server with a tunnel
  (cloudflared or ngrok) so Bolna can reach the tool endpoints.
- **Linking a call to a browser tab:** the browser makes a short session code (6 characters), passes it
  in `userData`, the agent prompt has `{{session_code}}`, and every tool takes `session_code`. If the
  code doesn't match (LLM typo), the server falls back to the most recently active session, so a single-user
  demo can't break on this.
- **Finding the wrong step precisely:** vision models are bad at pixel coordinates. So we don't ask for
  them. We already know every pen stroke, so the server groups strokes into lines (by vertical position),
  draws line numbers in the margin of the image, and asks the model only "which line number is wrong and
  why". We circle that line using our own stroke geometry. Accurate every time.
- **The page can't message the agent mid-call** (Web Call SDK only takes `userData` at start). So the student
  triggers checks by voice ("ho gaya", "check karo"); the agent then calls `check_work`. The latest canvas
  is always already on the server.
- **Tool calls return fast.** Board tools return "ok" immediately and the board animates step by step on its
  own, so the agent never waits on drawing.
- **Dev simulator:** a hidden panel (`?dev=1`) fires the same tool calls as Bolna would. We can build and
  demo the board without waiting for Bolna access.

## Agent tools (configured in the Bolna dashboard; JSON in `bolna/tools.json`)

| Tool | What it does | Returns to the agent |
| --- | --- | --- |
| `show_steps(session_code, title, steps[])` | Writes worked steps on the tutor board, one by one | "shown" |
| `give_problem(session_code, problem, answer?)` | Shows a problem card and clears the student's canvas | "given" |
| `check_work(session_code)` | Reads the student's canvas, finds the first wrong line, circles it | correct/incorrect, which line, what to say |
| `clear_board(session_code)` | Clears the tutor board | "cleared" |

## Voice stack (in Bolna)

- Speech to text: Sarvam (Indian languages) or Deepgram multilingual. Pick by testing Hinglish.
- Text to speech: Sarvam Bulbul or Kalpa Labs (built for Hindi-English mix). Both are sponsors.
- LLM: a fast GPT model with function calling, reasoning effort none/low (per Bolna docs, for latency).

## Schedule (estimates; expect a day of slip)

| Date | Work |
| --- | --- |
| Thu Oct 22 | Register. Ask for Web Call SDK access in Bolna Slack. Repo + scaffold, board, canvas, dev simulator. |
| Fri Oct 23 | Bolna agent in dashboard: Hindi voice talking in the browser tab. Deploy server; tool calls reach it. |
| Sat–Sun Oct 24–25 | `check_work` end to end with the red circle. Tune the prompt on 5–10 real handwritten attempts. |
| Mon Oct 26 | Lesson plan from topic and notes upload. Language switch (Hindi / Hinglish / Tamil if time). |
| Tue Oct 27 | Polish: board animation, tutor voice pacing, loading states, error recovery. |
| Wed Oct 28 | Lock the demo problem. Record the demo video. Write README with architecture diagram. |
| Thu Oct 29 | Buffer for whatever broke. |
| Fri Oct 30 | Submit (one day early). |

## Biggest risks, and what we do about them

1. **Web Call SDK is beta, enabled on request.** Ask in Slack today. Fallback: Bolna phone call to the
   student's phone while the board runs in the browser (tools work the same way).
2. **Tool-call pauses feel robotic.** Keep `pre_call_message` empty for board tools; test early.
3. **Handwriting misread.** Demo on a tablet or with a stylus, write clearly, and rehearse one problem.
   Prompt the model to say "I can't read line N" instead of guessing.
4. **Submission requirements unknown.** Ask in Slack whether they want a repo, a video, or both. Plan for both.

## Split for a team of three

- **Person A (voice):** Bolna agent, prompt, voices, languages, web call, deploy.
- **Person B (board):** tutor board animation, pen canvas, circle overlay, mobile/tablet feel.
- **Person C (brains + story):** `check_work` prompt quality, lesson plan from notes, demo script, video, README.
