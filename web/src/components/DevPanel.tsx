import { useState } from "react";

// Fires the same tool calls the Bolna agent makes, so the board can be built and demoed without voice.

const SAMPLES: { label: string; tool: string; params: Record<string, string> }[] = [
  {
    label: "Teach",
    tool: "show_steps",
    params: {
      title: "Solving by factorisation",
      steps: "x^2 - 5x + 6 = 0 || x^2 - 2x - 3x + 6 = 0 || x(x - 2) - 3(x - 2) = 0 || (x - 2)(x - 3) = 0 || x = 2 or x = 3",
    },
  },
  { label: "Give problem", tool: "give_problem", params: { problem: "Solve: x^2 - 7x + 12 = 0", answer: "x = 3 or x = 4" } },
  { label: "Check work", tool: "check_work", params: {} },
  { label: "Clear board", tool: "clear_board", params: {} },
];

export function DevPanel({ sessionCode }: { sessionCode: string }) {
  const [out, setOut] = useState("");
  const [open, setOpen] = useState(true);

  const fire = async (tool: string, params: Record<string, string>) => {
    setOut(`${tool}…`);
    const r = await fetch(`/tools/${tool}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_code: sessionCode, ...params }),
    });
    setOut(`${tool} → ${JSON.stringify(await r.json(), null, 1)}`);
  };

  if (!open) return <button className="dev-toggle" onClick={() => setOpen(true)}>Tools</button>;
  return (
    <aside className="dev-panel">
      <header>
        <span>Tool simulator</span>
        <button onClick={() => setOpen(false)} aria-label="Hide">×</button>
      </header>
      <div className="dev-buttons">
        {SAMPLES.map((s) => (
          <button key={s.tool} onClick={() => fire(s.tool, s.params)}>{s.label}</button>
        ))}
      </div>
      {out && <pre>{out}</pre>}
    </aside>
  );
}
