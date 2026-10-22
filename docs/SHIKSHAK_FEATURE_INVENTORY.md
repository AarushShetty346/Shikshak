# Shikshak feature inventory and root-cause audit (V3 spec, 22 Oct 2026)

Audit of the repository against `Shikshak_V3_Unified_Master_Implementation_Prompt.pdf`, done before changing code,
then updated after the Gate 1 work in this branch. Status values: **VERIFIED** (seen working in the running app or
by automated test), **PARTIAL**, **BROKEN**, **NOT IMPLEMENTED**, **BLOCKED** (needs something outside our control),
**DEFERRED** (deliberately not in this round), **REJECTED** (the spec itself rejects it).

Architecture in one line: React board (`web/src`) ⇄ WebSocket ⇄ Node server (`server/`) ⇄ Bolna voice agent, which
calls our `/tools/*` endpoints mid-call. Bolna owns speech-to-text, the LLM turn loop and text-to-speech; the page
cannot inject text into a live call, only keypad tones (DTMF), which Bolna hands to the LLM as `dtmf_number: N`.

## 1. Root causes of the reported failures

| # | Symptom (reported) | Reproduction | Root cause | Where | Fix in this branch | Regression test |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Maths board carried over into a Physics lesson | Teach AP, go back to setup, start a new topic | There was no session concept. The board code lived in `sessionStorage` per browser tab, so a "new" lesson reused the same code: the server replayed the old board history and the tab restored old strokes. Also `resolve()` routed tool calls with an unknown code to "the latest connected tab", so late tool calls from an old call could land on a new lesson. Leaving a lesson never ended the Bolna call. | `web/src/lib/session.ts`, `server/sessions.ts` `resolve()`, `web/src/App.tsx` | Session manager with a home screen. Each session has its own id, board, strokes, plan and documents (persisted in the browser, re-hydrated to the server). Switching stops the call and closes the socket first. Unknown session codes are rejected (no fallback). The client drops events for any session but the open one. | `server/tools.test.ts` "never routes a tool call to another session"; `server/tools.test.ts` "sessions survive a server restart"; browser check: Physics session opens blank, a late maths tool call stays in maths |
| 2 | Tutor asks to upload, but there's no way to upload in a lesson; PDFs not used | Start a lesson, ask about the book | Notes were only read once at setup into a plan outline. No in-lesson upload, no document store, no tool to read or show pages. | `web/src/components/Setup.tsx`, `server/plan.ts` | Upload button in the lesson toolbar (and on the home screen). Documents are stored per session; the tutor gets `read_material` (answers from the actual pages with page numbers) and `show_page` (puts the real page on the board with a source label). | `server/tools.test.ts` "uploaded material"; browser check: PDF uploaded mid-lesson, `show_page` renders the real page on the board |
| 3 | Overlapping graphics | Draw, replace and highlight in quick succession | Likely causes (not all reproduced): a replacement block reused the old block's spot even when taller, running into the next block; block heights are estimated until measured. | `web/src/components/Board.tsx` layout | A replacement now only reuses the spot if it fits, otherwise it goes below. Layout re-runs on every measured height. | Manual browser check; needs a repro video from the team |
| 4 | Done button does nothing / tutor says "notebook empty" | Write next to or above the question, press Done | Done only sent strokes positioned *below* the latest question. Anything written beside it, above it, or with no question on the board was ignored, so Done stayed greyed out or sent an empty image. Feedback was a 3-second toast. | `Board.tsx` `regionTop` / `response` | Done sends what the student wrote *since the latest question* (by time, not position), or since the last Done when there's no question. Explicit states: Writing → Ready → Submitting → Teacher reviewing → Feedback ready / Retry. The server acknowledges receipt, reads it at once, and the board shows the result even before the tutor speaks. | `server/tools.test.ts` "Done protocol"; browser check: work written beside the question, Done → reviewing → seen, Gemini read it correctly |
| 5 | Room noise / other people trigger the tutor | Talk near the laptop during a call | The web call is full duplex and always listening; we had also set "interrupt after 1 word". | `useVoiceCall.ts`, `scripts/bolnaConfig.ts` | Push-to-talk by default: the mic is muted except while the Talk button (or Space) is held. Hands-free is an opt-in. Interruption threshold back to 2 words. | Not yet tested: needs a real call (the button only appears while a call is live) |
| 6 | Small numbers next to student strokes | Write on the board | Line numbers were drawn on screen for the checker's benefit. | `Board.tsx` `.line-number` | Numbers exist only in the image sent to the model. | Browser check |
| 7 | Start Class vs Call button confusing | — | Two call buttons with overlapping meaning. | `App.tsx` | One Start / Pause / Resume toggle. Pause ends the billed call but keeps the lesson; Resume starts a new call that continues from the saved checkpoint. End session is in a menu with confirmation. The phone-call button is removed. | Browser check |

## 2. Feature inventory

### V2 baseline

| Feature | Status | Evidence / where | Notes |
| --- | --- | --- | --- |
| Voice tutor in browser (Bolna web call) | VERIFIED | `useVoiceCall.ts`; 12 real calls in Bolna history | |
| Hindi / Hinglish / English | VERIFIED | Multilingual agent hi+en; greeting per language | Tamil dropped on purpose |
| Full-screen blackboard, no lines/frame | VERIFIED | `styles.css` `.classroom`, screenshots | |
| Tutor writes, draws, highlights, erases with labels B1… | VERIFIED (tool level) | `server/board.ts`, `server/board.test.ts`, browser screenshots | Not yet watched in a long real lesson |
| Writing paced to the tutor's voice | PARTIAL | `Board.tsx` reveal controller | Paced by voice *activity*, not word timestamps (Bolna doesn't expose them) |
| Done → keypad signal → tutor looks | VERIFIED | Bolna transcript shows `dtmf_number: 1` then look | |
| Ask Doubt / Stop → keypad 2 | VERIFIED | Bolna transcript shows `dtmf_number: 2` | |
| Doubt checkpoint + continue_lesson | PARTIAL | `server/board.ts` | Server remembers the block/section; resuming depends on the LLM following the prompt |
| Handwriting check (Gemini) | VERIFIED (font samples) | `server/look.ts`, 5/5 test cases | Not yet measured on real handwriting |
| Notes → study plan | VERIFIED (mocked model in tests) | `server/plan.ts` | |
| Voice activity orb | VERIFIED | `VoiceOrb.tsx` | |

### V3 items

| § | Feature | Status after this branch | Notes |
| --- | --- | --- | --- |
| 1 | Forensic audit + root-cause table | VERIFIED | This file |
| 2 | Home screen, separate sessions, rename/archive/delete, restore | VERIFIED (browser) | Stored in the browser (localStorage) and re-hydrated to the server, so sessions survive server restarts but not a different device |
| 2 | Atomic stop on switch; stale events rejected | VERIFIED (test) | Call stopped, socket closed, session-checked events |
| 3 | Clean board, no banner, Start/Pause/Resume, no Call, no stroke numbers | VERIFIED (browser) for layout; Pause/Resume needs a real call | Phone width (375 px): toolbar wraps to two rows, no sideways scroll |
| 3 | Move/select objects, zoom, redo | NOT IMPLEMENTED | Undo exists; pan via two fingers / hand tool |
| 4 | Push-to-talk default, hold + Space, hands-free option, Stop | PARTIAL (built, not yet tested in a real call) | Uses the SDK's mic mute; Bolna still decides end of turn after release. No tap-to-toggle mode |
| 4 | Typed-text fallback | BLOCKED | Bolna web calls have no way to inject text mid-call |
| 5 | Model benchmark and routing | DEFERRED | Tutor LLM is chosen in Bolna (gpt-5.4-mini); checker is Gemini. A benchmark needs a test set and budget |
| 6 | NCERT Class 9/10 library | DEFERRED | NCERT forbids redistribution; a compliant version links to official sources. Not built this round |
| 7 | Uploads in a lesson; document-aware answers with page refs | PARTIAL (upload and page display seen in browser; answers tested with a mocked model) | Upload, per-session storage, `read_material` with page numbers, `show_page`. No OCR pipeline, figure index or vector search: the model reads the pages directly (fine for a chapter, not a whole book) |
| 8 | Book Mode (annotate over the page) | PARTIAL | The tutor can put a real page on the board and highlight it as a block. Annotating inside the page, page navigation viewer and selection are not built |
| 9 | Validated diagrams | PARTIAL | AP, number line, graph, triangle, table, deterministic SVG. No circuits/optics yet. No image generation (spec rejects it for precise diagrams) |
| 10 | Animated split panel | DEFERRED | |
| 11 | Board awareness and conversational edits | PARTIAL | Board map with labels, highlight, erase, replace. No move/resize, no render verification |
| 12 | Speech-board timeline | PARTIAL | Voice-activity pacing, pause on interrupt. True playback-cursor sync is BLOCKED (Bolna doesn't expose word timing) |
| 13 | Speech speed selector | PARTIAL | Three Bolna agents at 0.95×, 1.1× (default) and 1.3×, read back from Bolna. Applies from the next Start/Resume (Bolna can't change speed mid-call). Not yet heard in a real call |
| 14 | Interruptions, doubts, orb | VERIFIED / PARTIAL | See V2 rows |
| 15 | Done protocol with states and ack | VERIFIED (test + browser) | |
| 16 | Source labels, privacy | PARTIAL | Pages shown with source + page label; documents kept in server memory per session and in the browser (IndexedDB), never sent to other sessions. No accounts/auth |
| 17 | Architecture boundaries | PARTIAL | Session manager, board engine, tools, look/plan services are separate modules |
| 18 | E2E test matrix (Playwright) | PARTIAL | 56 unit/integration tests; browser checks done by hand, not Playwright |
| 20 | Micro-quizzes with grading | DEFERRED | `your_turn` + Done + checker covers the basic loop |
| 21 | Style switches (simple, cricket, exam) | DEFERRED | |
| 22 | Textbook-to-board drag | DEFERRED | |
| 23 | Concept map | DEFERRED | |
| 24 | Interactive simulations | DEFERRED | |
| 25 | Your turn / My turn | PARTIAL | `your_turn` blocks + Done + feedback; no region lock |
| 26 | Language control, no emotion inference | VERIFIED | No emotion inference anywhere |
| 27 | Rewards / confetti | DEFERRED (off) | Only a small "Shabash" stamp after a validated correct answer |
| 28 | Raw `[DRAW]` tags rejected; typed events | VERIFIED | All board actions are typed JSON events from validated tool calls |
| 29 | Pedagogy engine, video ingestion | DEFERRED / BLOCKED | Needs rights-cleared media |
| 30 | This inventory | VERIFIED | |
