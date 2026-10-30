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
- **Follow-through in equations:** for "solve" problems the engine checks each written equation
  against the question. The first one that isn't equivalent (up to a constant factor) is the slip.
  A later line that is equivalent to the student's own previous line, and written in the form of a
  worked step, earns that step's ½ as follow-through. Roots that correctly solve the student's own
  equation earn the answer mark. The demo slip `x(x - 3) + 4(x - 3) = 0` followed by
  `(x - 3)(x + 4) = 0` and `x = 3 or x = -4` gets 2 / 2½: only the slip loses its ½.
- **The circled line:** when every line was read and the reading has as many lines as were written,
  the line the engine finds first wrong is circled, even if the handwriting reader pointed elsewhere.
  Otherwise the reader's line is used.
- **Other correct methods:** splitting the middle term the other way round (−4x − 3x instead of
  −3x − 4x) is listed as an alternate scheme for the factorisation problems, so it earns full marks.
- **"Expand" answers** must be multiplied out with like terms collected: `(x + 3)(x + 3)` is equal to
  `(x + 3)^2` but isn't an expansion.

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
- Arithmetic follow-through tracks whole-number slips carried into later lines; slips in fractions
  or surds aren't followed. Equation follow-through works for any polynomial equation in the
  question's unknown, but only credits lines written in the form of a worked step.
- Factorising straight to `(x - 3)(x - 4) = 0` without the splitting line earns 1½ / 2½: the
  splitting and grouping steps weren't written. A teacher might accept it; this needs review.
- Nobody has reviewed these schemes against real examiner marking yet. That needs a maths teacher.
