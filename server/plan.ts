import { languageName } from "./claude";
import { askJson } from "./llm";

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
  return askJson<LessonPlan>({
    system: SYSTEM.replace("{LANGUAGE}", languageName(req.language)),
    effort: "medium",
    schema: SCHEMA,
    attachments: req.notes ? [{ mediaType: req.notes.mediaType, data: req.notes.data }] : [],
    text: `Student is in class ${req.grade || "10"}. Topic: ${req.topic || "whatever the notes cover"}`,
  });
}
