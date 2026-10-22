// Prints the four custom-function definitions to paste into the Bolna dashboard (Tools tab),
// with your server's public URL filled in. Usage: npm run bolna:tools
import "dotenv/config";

const base = (process.env.PUBLIC_URL || "https://YOUR-SERVER.example.com").replace(/\/$/, "");
const token = process.env.TOOLS_TOKEN ? `Bearer ${process.env.TOOLS_TOKEN}` : null;

const session = {
  session_code: { type: "string", description: "The session code from the prompt. Always pass it exactly." },
};

function tool(opts: {
  name: string;
  description: string;
  pre_call_message: string;
  properties: Record<string, { type: string; description: string }>;
  required: string[];
}) {
  const all = { ...session, ...opts.properties };
  return {
    name: opts.name,
    description: opts.description,
    pre_call_message: opts.pre_call_message,
    parameters: { type: "object", properties: all, required: ["session_code", ...opts.required] },
    key: "custom_task",
    value: {
      method: "POST",
      param: Object.fromEntries(Object.keys(all).map((k) => [k, `%(${k})s`])),
      url: `${base}/tools/${opts.name}`,
      api_token: token,
      headers: { "Content-Type": "application/json" },
    },
  };
}

const tools = [
  tool({
    name: "show_steps",
    description:
      "Write worked steps on the student's chalkboard. Use whenever you explain a method, solve an example, or answer a doubt that needs maths written down. Call it, then talk through the lines as they appear.",
    pre_call_message: "",
    properties: {
      title: { type: "string", description: "Short heading for this block, e.g. 'Factorisation'." },
      steps: {
        type: "string",
        description: "The lines to write, separated by ' || '. Plain text maths, no LaTeX. Example: 2x + 3 = 7 || 2x = 4 || x = 2",
      },
    },
    required: ["steps"],
  }),
  tool({
    name: "give_problem",
    description:
      "Put a practice problem in the student's notebook and clear their page. Use when it is the student's turn to solve something.",
    pre_call_message: "",
    properties: {
      problem: { type: "string", description: "The problem as plain text, e.g. 'Solve: x^2 - 7x + 12 = 0'." },
      answer: { type: "string", description: "The correct final answer, for checking. Never read it aloud." },
    },
    required: ["problem", "answer"],
  }),
  tool({
    name: "check_work",
    description:
      "Look at what the student has written in their notebook and find the first wrong step. Use when the student says they are done, says 'check karo', 'ho gaya', 'dekho', asks if they are right, or seems stuck.",
    pre_call_message: "Ek second, dekhti hoon.",
    properties: {},
    required: [],
  }),
  tool({
    name: "clear_board",
    description: "Wipe the chalkboard. Only use when moving to a completely new topic.",
    pre_call_message: "",
    properties: {},
    required: [],
  }),
];

for (const t of tools) {
  console.log(`\n// ----- ${t.name} -----`);
  console.log(JSON.stringify(t, null, 2));
}
