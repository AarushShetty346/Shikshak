// Learner profiles, memory and mastery (Phase 4). These hooks are called from the class flow.

import type { LookResult } from "./look";
import type { Capture, Session } from "./sessions";

/** Short memory for the next call, from saved evidence only. Empty until learner memory exists. */
export function memoryForCall(_s: Session): string {
  return "";
}

/** Records the outcome of a reviewed submission against the learner. */
export function recordReview(_s: Session, _capture: Capture, _result: LookResult) {}
