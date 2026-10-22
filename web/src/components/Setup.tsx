import { useState } from "react";
import type { Language } from "../../../shared/types";
import { MathText } from "./MathText";

export interface LessonPlan {
  title: string;
  goal: string;
  steps: { title: string; idea: string }[];
  practice_problem: string;
  practice_answer: string;
}

export interface StudentSetup {
  name: string;
  grade: string;
  language: Language;
  topic: string;
  plan: LessonPlan | null;
}

const LANGS: { id: Language; label: string }[] = [
  { id: "hinglish", label: "Hinglish" },
  { id: "hi", label: "हिन्दी" },
  { id: "ta", label: "தமிழ்" },
  { id: "en", label: "English" },
];

const TOPICS = ["Quadratic equations", "Linear equations in two variables", "Arithmetic progressions", "Trigonometric ratios"];

export function Setup({ onStart }: { onStart: (s: StudentSetup) => void }) {
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("10");
  const [language, setLanguage] = useState<Language>("hinglish");
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState<File | null>(null);
  const [plan, setPlan] = useState<LessonPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const makePlan = async () => {
    setPlanning(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { topic, grade, language };
      if (notes) body.notes = { mediaType: notes.type, data: await toBase64(notes) };
      const r = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not make a plan");
      setPlan(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPlanning(false);
    }
  };

  const canPlan = (topic.trim() || notes) && !planning;

  return (
    <main className="setup">
      <div className="setup-intro">
        <p className="eyebrow">Your maths teacher, any time</p>
        <h1>
          Learn it out loud.
          <br />
          <span className="hand">Get stuck? I'll show you where.</span>
        </h1>
        <p className="lede">
          Shikshak talks you through a topic in your language, writes it on the board, then watches you solve a
          problem and points to the exact step that went wrong.
        </p>
      </div>

      <form className="setup-card" onSubmit={(e) => e.preventDefault()}>
        <div className="row">
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Asha" autoComplete="given-name" />
          </label>
          <label className="field field-small">
            <span>Class</span>
            <select value={grade} onChange={(e) => setGrade(e.target.value)}>
              {["8", "9", "10", "11", "12"].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="field">
          <legend>Teach me in</legend>
          <div className="segmented">
            {LANGS.map((l) => (
              <button type="button" key={l.id} className={language === l.id ? "on" : ""} onClick={() => setLanguage(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>What are you studying?</span>
          <input value={topic} onChange={(e) => { setTopic(e.target.value); setPlan(null); }} placeholder="e.g. Quadratic equations" />
        </label>
        <div className="chips">
          {TOPICS.map((t) => (
            <button type="button" key={t} className="chip" onClick={() => { setTopic(t); setPlan(null); }}>
              {t}
            </button>
          ))}
        </div>

        <label className="upload">
          <input type="file" accept="image/*,application/pdf" onChange={(e) => { setNotes(e.target.files?.[0] ?? null); setPlan(null); }} />
          <span className="upload-icon" aria-hidden="true">＋</span>
          <span>{notes ? notes.name : "Add a photo or PDF of your notes (optional)"}</span>
        </label>

        {plan && (
          <div className="plan">
            <p className="plan-title">{plan.title}</p>
            <ol>
              {plan.steps.map((s, i) => (
                <li key={i}>
                  <strong>{s.title}</strong> <span>{s.idea}</span>
                </li>
              ))}
            </ol>
            <p className="plan-practice">
              Practice: <MathText text={plan.practice_problem} />
            </p>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}

        <div className="actions">
          {!plan && (
            <button type="button" className="btn-secondary" disabled={!canPlan} onClick={makePlan}>
              {planning ? "Making your plan…" : "Make a plan"}
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={() => onStart({ name: name.trim() || "student", grade, language, topic: topic.trim(), plan })}
          >
            Start class
          </button>
        </div>
      </form>
    </main>
  );
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
