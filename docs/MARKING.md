# Practice marks (CBSE style)

When a student presses Done on a checked library problem, Shikshak gives **practice marks**, for
example "1½ / 2". The point is to show where marks come from in a board exam: the steps carry
marks, not just the answer. These marks are labelled as practice feedback everywhere. They are
**not** an official CBSE mark and nobody should treat them as one.

Code: [`server/marking.ts`](../server/marking.ts). Tests: [`server/marking.test.ts`](../server/marking.test.ts).

## The scheme for a problem

The scheme is built from the problem's checked worked solution (`server/curriculum/`), with no
model involved:

| Value point | Marks |
| --- | --- |
| Each checked step whose written line shows the calculation | ½ |
| The correct final answer | 1 |

A step that is only a "Check:" note isn't a value point. Each other correct method listed in a
problem's `alternates` is a scheme of its own, and the student gets the best one.

## Marking the student's lines

The lines are the ones the handwriting reader returns. A step earns its ½ mark when:

- **Arithmetic:** a line whose calculation holds reaches that step's value. For example
  `d = 5 - 2 = 3` earns the "d" step.
- **Algebra:** a line writes that step's form. Terms and bracketed factors may come in any order,
  so `(x - 4)(x - 3)` counts for `(x - 3)(x - 4)`. Only the step actually written earns marks: writing
  the factors doesn't earn the earlier splitting steps.
- **Follow-through:** a line correctly carries an earlier slip forward. The error is penalised
  once. If `d = 5 - 2 = 4` is wrong but `a_10 = 2 + 9 × 4 = 38` is right for d = 4, the second
  step and the answer 38 keep their marks: 1½ / 2.

Some cases earn less:

- A final answer with no working gets the answer mark only, plus a nudge to show the steps.
- Unreadable lines earn nothing. The result is then marked **provisional** and names the line.
- A wrong method gets no follow-through. For example, using n instead of n − 1 gives 32: that step
  and the answer lose their marks.

## What it's based on

- CBSE's published sample-paper marking schemes. For example, Mathematics Standard (041) Class X
  2025-26 on cbseacademic.nic.in splits answers into ½- and 1-mark value points.
- The board examiners' general instructions, paraphrased:
  - The value points are guidelines, and correct answers expressed differently get due marks.
  - An error is penalised only once, with no deductions for its knock-on effect.
  - A wholly wrong answer gets 0.

Real board schemes are written per question by examiners. Shikshak's are derived automatically, so
the exact split can differ.

## Limits (known)

- Only library problems are marked. A problem the tutor makes up with `give_problem` gets no marks.
- Marks depend on the reader's transcription. A misread line can lose or gain a ½ mark, which is
  one more reason they're practice marks only.
- Follow-through tracks whole-number slips that are carried into later lines. Slips in fractions or
  surds aren't followed, so the later steps simply show as missing.
- Nobody has reviewed these schemes against real examiner marking yet. That needs a maths teacher.
