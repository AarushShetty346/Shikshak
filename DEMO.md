# Demo script (about 2 minutes)

The pitch says "open with the demo". This is the demo, step by step, so it goes the same way every time.

## Before you record

- [ ] Server is deployed and warm: open the site once a minute before (Render's free plan sleeps).
- [ ] `/?dev=1` status line shows **Voice ✓ · Checker ✓ · Public URL ✓**. Then open the plain URL for recording.
- [ ] Tablet with a stylus, or a laptop with a pen tablet. Writing with a mouse looks bad on video.
- [ ] Headphones on the demo device (stops the tutor hearing itself).
- [ ] Quiet room. Phone on silent.
- [ ] You have run the exact problem below at least 3 times today and the checker caught the mistake each time.

## The flow

| # | You do / say | What happens on screen |
| --- | --- | --- |
| 1 | Setup: name "Asha", class 10, **Hinglish**, topic **Quadratic equations**. Press **Make a plan**, then **Start class**. | Plan appears; call connects; tutor greets Asha in Hinglish. |
| 2 | "Mujhe factorisation samajh nahi aata." | Tutor explains splitting the middle term while the board writes `x^2 - 5x + 6 = 0 → … → x = 2 or x = 3`. |
| 3 | Interrupt mid-explanation: "Ruko, -5x ko -2x aur -3x kaise kiya?" | Tutor stops, answers the doubt (shows that interruption works). |
| 4 | "Samajh gaya. Ek sawaal do." | Problem card: `Solve: x^2 - 7x + 12 = 0`. |
| 5 | Write it with **one deliberate sign slip on line 2**: | |
| | line 1: `x^2 - 3x - 4x + 12 = 0` | |
| | line 2: `x(x - 3) + 4(x - 3) = 0` ← should be **- 4** | |
| | line 3: `(x - 3)(x + 4) = 0` | |
| | line 4: `x = 3 or x = -4` | |
| 6 | "Ho gaya, check karo." | "Checking your work…", then a **red circle on line 2**. Tutor: "Step 2 mein sign galat ho gaya…" |
| 7 | Fix line 2 to `x(x - 3) - 4(x - 3) = 0`, fix the rest. "Ab check karo." | Green **Shabash!** stamp, tutor praises. |
| 8 | End the call. Cut to the pitch. | |

## If something breaks live

- **Voice won't connect:** use "Use my phone instead" under the Start button; the board still works on screen.
- **Checker misreads:** say "Line 2 dobara dekho" and rewrite the line more clearly. Practise writing big, one step per line, on the ruled lines.
- **Everything is down:** open `/?dev=1` and drive the board with the tool simulator while you narrate. With `FAKE_CHECKER=1`
  the check always circles line 2, which matches this script.

## Video shots

1. 0:00–0:10 Hook: the 10pm story, over a shot of a notebook.
2. 0:10–1:30 The flow above, screen recording with audio.
3. 1:30–1:50 Close-up replay of the red circle moment.
4. 1:50–2:00 Last line of the pitch.
