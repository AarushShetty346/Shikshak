// Common class 10 mistakes the tutor watches for. Each one is detected deterministically where a
// wrong answer gives it away (a problem's "traps"), or proposed by the handwriting reader as
// supporting evidence with lower confidence. Unreadable work is never classed as a misconception.

import type { Misconception } from "./types";

export const MISCONCEPTIONS: Misconception[] = [
  {
    id: "ap.index_off_by_one",
    chapter: "ap",
    name: "Counts n jumps instead of n − 1",
    pattern: "Uses a + nd for the nth term (or solves a + nd = term), so the answer is one step too far.",
    remedy: "From the 1st term to the nth term there are n − 1 jumps of d. Count the jumps on a small example: a_3 = a + 2d.",
    example: "a_10 of 2, 5, 8: 2 + 10 × 3 = 32 (should be 2 + 9 × 3 = 29)",
  },
  {
    id: "ap.d_sign",
    chapter: "ap",
    name: "Common difference with the wrong sign",
    pattern: "Finds d as an earlier term minus a later one, so d has the wrong sign.",
    remedy: "d = later term − earlier term. Check: earlier term + d should give the next term.",
    example: "10, 7, 4: d = 10 − 7 = 3 (should be 7 − 10 = −3)",
  },
  {
    id: "ap.sum_half",
    chapter: "ap",
    name: "Forgets the n/2 in the sum formula",
    pattern: "Uses n[2a + (n − 1)d] for S_n, getting double the sum.",
    remedy: "S_n = n/2 [2a + (n − 1)d]: it's the number of terms times the average of first and last terms.",
    example: "Sum of first 10 terms of 2, 7, 12: 10 × 49 = 490 (should be 5 × 49 = 245)",
  },
  {
    id: "alg.sign_transfer",
    chapter: "algebra",
    name: "Moves a term across = without changing its sign",
    pattern: "Transposes +3 to the other side as +3 instead of −3.",
    remedy: "Do the same thing to both sides: subtract 3 from both sides, and write that step.",
    example: "2x + 3 = 11 → 2x = 14 (should be 2x = 8)",
  },
  {
    id: "alg.distribution",
    chapter: "algebra",
    name: "Multiplies only the first term in brackets",
    pattern: "Writes a(b + c) as ab + c.",
    remedy: "The number outside multiplies every term inside: 3(x − 2) = 3x − 6.",
    example: "3(x − 2) = 12 → 3x − 2 = 12",
  },
  {
    id: "quad.root_sign",
    chapter: "quadratic",
    name: "Takes the roots with the wrong sign from the factors",
    pattern: "From (x − 3)(x − 4) = 0 concludes x = −3 or x = −4.",
    remedy: "Set each factor to zero: x − 3 = 0 gives x = 3. Check by putting the root back in.",
    example: "(x − 3)(x − 4) = 0 → x = −3, −4 (should be 3, 4)",
  },
  {
    id: "quad.square_identity",
    chapter: "quadratic",
    name: "(a + b)² written as a² + b²",
    pattern: "Drops the middle term 2ab when squaring a sum.",
    remedy: "(a + b)² = (a + b)(a + b) = a² + 2ab + b². Multiply it out once to see the 2ab.",
    example: "(x + 3)² = x² + 9 (should be x² + 6x + 9)",
  },
  {
    id: "quad.discriminant_sign",
    chapter: "quadratic",
    name: "Discriminant as b² + 4ac",
    pattern: "Adds 4ac instead of subtracting it.",
    remedy: "D = b² − 4ac. Write a, b, c with their signs first, then substitute.",
    example: "x² − 5x + 3: D = 25 + 12 = 37 (should be 25 − 12 = 13)",
  },
  {
    id: "lin.elimination_sign",
    chapter: "linear",
    name: "Sign slip when subtracting one equation from another",
    pattern: "Subtracts one equation from the other but forgets to change every sign.",
    remedy: "Subtracting an equation means subtracting every term; or multiply by −1 and add instead.",
    example: "(2x + 3y = 12) − (x − y = 1) → x + 2y = 11 (should be x + 4y = 11)",
  },
  {
    id: "trig.ratio_swap",
    chapter: "trig",
    name: "Mixes up sin and cos (opposite vs adjacent)",
    pattern: "Uses the adjacent side for sin, or the opposite side for cos.",
    remedy: "Mark the angle first, then name the sides from it: opposite is across from the angle. sin = opposite/hypotenuse.",
    example: "Right angle at B, AB = 3, BC = 4: sin A = 3/5 (should be BC/AC = 4/5)",
  },
  {
    id: "trig.value_swap",
    chapter: "trig",
    name: "Swaps the values for 30° and 60°",
    pattern: "Uses sin 30° = √3/2 or cos 60° = √3/2.",
    remedy: "sin grows from 0 to 1 as the angle grows: sin 30° is the smaller value, 1/2.",
    example: "sin 30° + cos 60° = √3/2 + √3/2 = √3 (should be 1/2 + 1/2 = 1)",
  },
  {
    id: "trig.identity_squares",
    chapter: "trig",
    name: "Uses sin A + cos A = 1 (drops the squares)",
    pattern: "Finds cos A as 1 − sin A instead of √(1 − sin²A).",
    remedy: "The identity is sin²A + cos²A = 1: square, subtract, then take the square root.",
    example: "sin A = 3/5 → cos A = 2/5 (should be 4/5)",
  },
];

export function misconception(id: string) {
  return MISCONCEPTIONS.find((m) => m.id === id);
}
