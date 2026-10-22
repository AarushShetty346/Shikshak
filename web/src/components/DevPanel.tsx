import { useEffect, useState } from "react";

// Fires the same tool calls the Bolna agent makes, so the board can be built and demoed without voice.

const SAMPLES: { label: string; tool: string; params: Record<string, string> }[] = [
  { label: "Heading", tool: "write", params: { kind: "heading", content: "Arithmetic Progression (AP)" } },
  { label: "Steps", tool: "write", params: { kind: "steps", content: "a, a + d, a + 2d, ... || a_n = a + (n - 1)d || a_4 = 2 + 3 * 3 = 11" } },
  { label: "Draw AP", tool: "draw", params: { diagram: "ap: 2, 5, 8, 11 | d = 3", caption: "Har baar +3", place: "right" } },
  { label: "Draw graph", tool: "draw", params: { diagram: "graph: y = x^2 - 4 | points: (2,0), (-2,0) | x: -4..4" } },
  { label: "Highlight B2", tool: "highlight", params: { target: "B2 line 2", style: "box", note: "formula" } },
  { label: "Erase B1", tool: "erase", params: { target: "B1" } },
  { label: "Give problem", tool: "give_problem", params: { problem: "Find a_10 of 2, 5, 8, ...", answer: "29" } },
  { label: "Look at board", tool: "look_at_board", params: { student_said: "" } },
  { label: "Continue", tool: "continue_lesson", params: {} },
  { label: "Next section", tool: "show_section", params: { section: "next" } },
];

export function DevPanel({ sessionCode }: { sessionCode: string }) {
  const [out, setOut] = useState("");
  const [open, setOpen] = useState(true);
  const [health, setHealth] = useState<Record<string, boolean | string> | null>(null);

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
  }, []);

  const fire = async (tool: string, params: Record<string, string>) => {
    setOut(`${tool}…`);
    const r = await fetch(`/tools/${tool}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_code: sessionCode, ...params }),
    });
    setOut(`${tool} → ${JSON.stringify(await r.json(), null, 1)}`);
  };

  // Saves the notebook as a checker test case. You say which line is wrong (0 = all correct).
  const saveSample = async () => {
    const answer = window.prompt("Which line has the first mistake? Enter 0 if the work is correct.", "0");
    if (answer === null) return;
    const line = Number(answer);
    const r = await fetch("/api/dev/save-sample", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_code: sessionCode, expected_line: line > 0 ? line : null }),
    });
    setOut(`save-sample → ${JSON.stringify(await r.json())}`);
  };

  if (!open) return <button className="dev-toggle" onClick={() => setOpen(true)}>Tools</button>;
  return (
    <aside className="dev-panel">
      <header>
        <span>Tool simulator</span>
        <button onClick={() => setOpen(false)} aria-label="Hide">×</button>
      </header>
      {health && (
        <p className="dev-health">
          Voice {health.bolna ? "✓" : "✗"} · Checker {health.checker ? `✓ ${health.model}` : health.fakeChecker ? "fake" : "✗"} · Public URL{" "}
          {health.publicUrl ? "✓" : "✗"}
        </p>
      )}
      <div className="dev-buttons">
        {SAMPLES.map((s) => (
          <button key={s.label} onClick={() => fire(s.tool, s.params)}>{s.label}</button>
        ))}
        <button className="dev-wide" onClick={saveSample}>Save sample for checker test</button>
      </div>
      {out && <pre>{out}</pre>}
    </aside>
  );
}
