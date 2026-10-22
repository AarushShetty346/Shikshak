import { useState } from "react";
import type { Language } from "../../../shared/types";
import { MathText } from "./MathText";

/** What /api/plan returns: the study plan (shown on the board section by section) and a short outline for the tutor. */
export interface PlanResult {
  plan: {
    readable: "yes" | "partly" | "no" | "no_notes";
    readable_note: string;
    topic: string;
    title: string;
    goal: string;
    sections: { title: string; board: string[]; from_notes: boolean }[];
    practice: { problem: string }[];
  };
  outline: string;
}

export interface StudentSetup {
  name: string;
  grade: string;
  language: Language;
  topic: string;
  plan: PlanResult | null;
}

const LANGS: { id: Language; label: string }[] = [
  { id: "hinglish", label: "Hinglish" },
  { id: "hi", label: "हिन्दी" },
  { id: "en", label: "English" },
];

const TOPICS = ["Quadratic equations", "Linear equations in two variables", "Arithmetic progressions", "Trigonometric ratios"];
const MAX_PHOTOS = 6;

export function Setup({ sessionCode, onStart }: { sessionCode: string; onStart: (s: StudentSetup) => void }) {
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("10");
  const [language, setLanguage] = useState<Language>("hinglish");
  const [topic, setTopic] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPlan(null);
    setError(null);
  };

  const makePlan = async () => {
    setPlanning(true);
    setError(null);
    try {
      const attachments = await Promise.all(files.map(prepareFile));
      const r = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_code: sessionCode, topic, grade, language, files: attachments }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not make a plan");
      setPlan(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPlanning(false);
    }
  };

  const pickFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    const pdf = picked.find((f) => f.type === "application/pdf");
    setFiles(pdf ? [pdf] : picked.filter((f) => f.type.startsWith("image/")).slice(0, MAX_PHOTOS));
    reset();
  };

  const canPlan = (topic.trim() || files.length > 0) && !planning;

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
          Shikshak talks you through a topic in your language on a shared blackboard. Write your working or draw your
          doubt, press Done, and it points to the exact step that went wrong.
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
              <button
                type="button"
                key={l.id}
                className={language === l.id ? "on" : ""}
                onClick={() => {
                  setLanguage(l.id);
                  reset(); // the plan is written in the chosen language
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>What are you studying?</span>
          <input
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value);
              reset();
            }}
            placeholder="e.g. Quadratic equations"
          />
        </label>
        <div className="chips">
          {TOPICS.map((t) => (
            <button
              type="button"
              key={t}
              className="chip"
              onClick={() => {
                setTopic(t);
                reset();
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <label className="upload">
          <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => pickFiles(e.target.files)} />
          <span className="upload-icon" aria-hidden="true">＋</span>
          <span>
            {files.length === 0
              ? `Add photos (up to ${MAX_PHOTOS}) or a PDF of your notes (optional)`
              : files.length === 1
                ? files[0].name
                : `${files.length} photos of your notes`}
          </span>
        </label>

        {plan && (
          <div className="plan">
            {plan.plan.readable === "partly" && <p className="plan-warn">Some of your notes were hard to read: {plan.plan.readable_note}</p>}
            <p className="plan-title">{plan.plan.title}</p>
            <ol>
              {plan.plan.sections.map((s, i) => (
                <li key={i}>
                  <strong>{s.title}</strong> {s.from_notes && <span className="from-notes">from your notes</span>}
                </li>
              ))}
            </ol>
            {plan.plan.practice[0] && (
              <p className="plan-practice">
                Practice: <MathText text={plan.plan.practice[0].problem} />
              </p>
            )}
          </div>
        )}
        {error && <p className="form-error">{error}</p>}

        <div className="actions">
          {!plan && (
            <button type="button" className="btn-secondary" disabled={!canPlan} onClick={makePlan}>
              {planning ? (files.length ? "Reading your notes…" : "Making your plan…") : "Make a plan"}
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={planning}
            onClick={() => onStart({ name: name.trim() || "student", grade, language, topic: topic.trim(), plan })}
          >
            Start class
          </button>
        </div>
      </form>
    </main>
  );
}

/** Photos are shrunk to 1600 px on the long side (JPEG) so uploads stay small; PDFs go as they are. */
async function prepareFile(file: File): Promise<{ mediaType: string; data: string }> {
  if (!file.type.startsWith("image/")) return { mediaType: file.type, data: await toBase64(file) };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { mediaType: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "" };
  } catch {
    return { mediaType: file.type, data: await toBase64(file) };
  }
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
