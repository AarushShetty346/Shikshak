// Checked maths and teaching tools for the voice tutor (solve, hints, next step). Filled in by the
// teaching modules; registered on the tools router.

import type { Request, Router } from "express";
import type { Session } from "./sessions";

export interface ToolDeps {
  readParams: (req: Request) => Record<string, unknown>;
  resolve: (id: unknown) => Session | null;
  NO_SESSION: Record<string, unknown>;
}

export function teachingTools(_router: Router, _deps: ToolDeps) {
  // Registered in Phase 2.
}
