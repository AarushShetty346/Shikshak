import type Anthropic from "@anthropic-ai/sdk";
import { askJson, languageName } from "./claude";

export interface LessonPlan {
  title: string;
  goal: string;
  steps: { title: string; idea: string }[];
  practice_problem: string;
  practice_answer: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "goal", "steps", "practice_problem", "practice_answer"],
  properties: {
    title: { type: "string" },
    goal: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "idea"],
        properties: { title: { type: "string" }, idea: { type: "string" } },
      },
    },
    practice_problem: { type: "string" },
    practice_answer: { type: "string" },
  },
};

const SYSTEM = `You plan one short spoken tutoring session (about 10 minutes) for an Indian school student.
Write maths in plain text, never LaTeX: x^2, sqrt(x), (a+b)/c, theta.
Make 3 to 4 steps, each one idea the tutor can explain in under a minute with one worked line on the board.
End with one practice problem the student will solve by hand, sized so it takes 3 to 5 written lines, and its final answer.
Keep everything short: titles under 8 words, ideas under 30 words. Write titles and ideas in English; the tutor will speak in {LANGUAGE}.
If notes are attached, follow what they cover and the method they use.`;

export interface PlanRequest {
  topic: string;
  grade: string;
  language: string;
  notes?: { mediaType: string; data: string } | null;
}

export async function makePlan(req: PlanRequest): Promise<LessonPlan> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.notes) {
    if (req.notes.mediaType === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: req.notes.data } });
    } else {
      content.push({ type: "image", source: { type: "base64", media_type: req.notes.mediaType as "image/png", data: req.notes.data } });
    }
  }
  content.push({ type: "text", text: `Student is in class ${req.grade || "10"}. Topic: ${req.topic || "whatever the notes cover"}` });
  return askJson<LessonPlan>({
    system: SYSTEM.replace("{LANGUAGE}", languageName(req.language)),
    effort: "medium",
    schema: SCHEMA,
    content,
  });
}
