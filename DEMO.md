# Demo script (about 3 minutes)

The same flow every time. Every step below is something the app has been seen doing in testing;
don't add claims on the day.

## Before you record

- [ ] Deployed and warm: open the site a minute before (Render's free plan sleeps).
- [ ] `/api/health/providers` shows Gemini and Bolna as `verified: true`.
- [ ] Gemini's free tier has quota left today. Running benchmarks uses the same quota; don't run
      them on demo day.
- [ ] Tablet with a stylus, or a laptop with a pen tablet. Mouse writing looks bad on video.
- [ ] Headphones on the demo device, so the tutor doesn't hear itself. Quiet room, phone on silent.
- [ ] A learner "Asha" exists, with at least one earlier class, so the progress page and memory
      have real evidence. The free Render plan wipes data on each deploy: recreate it after the
      last deploy.
- [ ] You have run the exact problem below at least 3 times today, and the checker caught the slip
      each time.

## The flow

| # | You do / say | What happens on screen |
| --- | --- | --- |
| 1 | Home: pick **Asha**, press **New session**. Class 10, **Hinglish**, topic **Quadratic equations**. **Create session**, then **Start**. | Call connects. The tutor greets Asha in Hinglish and, if it's on record, mentions what she worked on last time. |
| 2 | "Mujhe factorisation samajh nahi aata." | The tutor explains splitting the middle term while the board fills line by line. |
| 3 | Interrupt mid-sentence: "Ruko, -7x ko -3x aur -4x kaise kiya?" | The tutor stops, answers the doubt, then picks the lesson back up where it was. |
| 4 | "Samajh gaya. Ek sawaal do." | A checked problem appears: `Solve by factorisation: x^2 - 7x + 12 = 0`. |
| 5 | "Hint do." Then once more. | The hint ladder: a nudge first, then the method. Never the answer. |
| 6 | Write it with **one deliberate sign slip on line 2**: | |
| | line 1: `x^2 - 3x - 4x + 12 = 0` | |
| | line 2: `x(x - 3) + 4(x - 3) = 0` (should be **- 4**) | |
| | line 3: `(x - 3)(x + 4) = 0` | |
| | line 4: `x = 3 or x = -4` | |
| 7 | Press **Done**. | "Your teacher has it…", then a **red circle on line 2**, and the card shows practice marks of 2 / 2½ (CBSE-style, not official): the slip loses its ½, and lines 3 and 4, which follow correctly from it, keep theirs. The tutor names the slip without giving the answer. |
| 8 | Fix line 2 to `x(x - 3) - 4(x - 3)`, fix the rest, press **Done**. | Green **Shabash!**, practice marks of 2½ / 2½. |
| 9 | Menu: **Report**. | The class report card (solved alone or with hints, the mistake that was fixed) with Share or Download. |
| 10 | Open **Asha's progress**. | Skills with the evidence behind each status, the observed mistake with the questions it came from, and phone revision (off on this server). |

## If something breaks live

- **Voice won't connect:** keep going on the board. Ask for hints with the menu, use the Done
  button, and narrate.
- **The checker misreads:** rewrite the line bigger, one step per line, on the ruled lines, then
  press Done again.
- **Everything is down:** open the class with `?dev=1` in the URL. The panel is a **simulator**
  that sends the same tool calls the voice agent would. Say so on camera; don't present it as the
  live tutor. With no model key and `FAKE_CHECKER=1`, the check always circles line 2, which
  matches this script. The card says "Simulated check" so it can't be mistaken for a real one.

## Backup recording

Record one clean take of steps 1 to 8 the day before and keep it on the laptop. If the live take
fails, use it and say it's a recording.

## Video shots

1. 0:00 to 0:10: the problem (a student stuck at night, no one to check their working).
2. 0:10 to 2:20: the flow above, screen recording with audio.
3. 2:20 to 2:40: close-up replay of the red circle and the practice marks.
4. 2:40 to 3:00: progress page and report (what a parent or teacher sees).
