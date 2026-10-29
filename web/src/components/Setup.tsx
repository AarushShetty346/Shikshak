import { useRef, useState } from "react";
import type { DocMeta, Language } from "../../../shared/types";
import { apiFetch } from "../lib/api";
import { putDoc } from "../lib/docStore";
import { prepareFile, type PreparedFile } from "../lib/files";
import type { PublicPlan } from "../lib/session";
import { ArrowLeft, Sparkle, UploadSimple } from "@phosphor-icons/react";
import { MathText } from "./MathText";

/** What the new class needs from setup. The plan's answers stay on the server. */
export interface StudentSetup {
  serverId: string;
  name: string;
  grade: string;
  language: Language;
  topic: string;
  plan: PublicPlan | null;
  docs: DocMeta[];
}

const LANGS: { id: Language; label: string; preview?: boolean }[] = [
  { id: "hinglish", label: "Hinglish" },
  { id: "hi", label: "हिन्दी" },
  { id: "en", label: "English" },
  { id: "ta", label: "தமிழ்", preview: true },
  { id: "te", label: "తెలుగు", preview: true },
];

const TOPICS = ["Quadratic equations", "Linear equations in two variables", "Arithmetic progressions", "Trigonometric ratios"];
const MAX_PHOTOS = 6;

type Prepared = PreparedFile & { id: string };

/**
 * Setting up a new class. Everything here is a draft until "Create session": the plan is made as a
 * draft on the server, and any change to the topic, class, language or notes throws it away (it
 * would no longer match). A plan reply that arrives after such a change is ignored.
 */
export function Setup({
  sessionCode,
  onStart,
  onCancel,
  learner,
}: {
  sessionCode: string;
  onStart: (s: StudentSetup) => void;
  onCancel?: () => void;
  learner?: { id: string; name: string; grade: string; language: Language } | null;
}) {
  const [name, setName] = useState(learner?.name ?? "");
  const [grade, setGrade] = useState(learner?.grade ?? "10");
  const [language, setLanguage] = useState<Language>(learner?.language ?? "hinglish");
  const [topic, setTopic] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [plan, setPlan] = useState<{ draftId: string; plan: PublicPlan } | null>(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prepared = useRef<{ files: File[]; out: Prepared[] } | null>(null);
  const [saving, setSaving] = useState(false);
  /** Bumped on every change that invalidates a plan; replies for an older value are dropped. */
  const version = useRef(0);

  /** Shrinks photos / counts PDF pages once per set of files, and gives each file an id that stays with it. */
  const prepare = async (): Promise<Prepared[]> => {
    if (prepared.current && prepared.current.files === files) return prepared.current.out;
    const list = files;
    const out = await Promise.all(list.map(async (f) => ({ ...(await prepareFile(f)), id: crypto.randomUUID().slice(0, 8) })));
    prepared.current = { files: list, out };
    return out;
  };

  const invalidate = () => {
    version.current++;
    setPlan(null);
    setPlanning(false);
    setError(null);
  };

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      const list = await prepare();
      const r = await apiFetch<{ session: { id: string } }>("/sessions", {
        body: { draftId: plan?.draftId, label: plan?.plan.title || topic.trim() || undefined, language, grade, topic: topic.trim(), studentName: name.trim(), learnerId: learner?.id ?? null },
      });
      const serverId = r.session.id;
      let docs: DocMeta[] = [];
      if (list.length) {
        const up = await apiFetch<{ docs: DocMeta[] }>(`/sessions/${serverId}/documents`, { body: { files: list, replace: true } });
        docs = up.docs;
        for (const f of list) await putDoc({ sessionId: sessionCode, docId: f.id, name: f.name, mediaType: f.mediaType, data: f.data, pages: f.pages });
      }
      onStart({ serverId, name: name.trim() || "student", grade, language, topic: topic.trim(), plan: plan?.plan ?? null, docs });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const makePlan = async () => {
    const mine = ++version.current;
    setPlanning(true);
    setError(null);
    try {
      const attachments = await prepare();
      const data = await apiFetch<{ draftId: string; plan: PublicPlan }>("/plans", { body: { topic, grade, language, files: attachments } });
      if (mine !== version.current) return; // something changed while planning: this plan is stale
      setPlan(data);
    } catch (e) {
      if (mine === version.current) setError((e as Error).message);
    } finally {
      if (mine === version.current) setPlanning(false);
    }
  };

  const pickFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    const pdf = picked.find((f) => f.type === "application/pdf");
    setFiles(pdf ? [pdf] : picked.filter((f) => f.type.startsWith("image/")).slice(0, MAX_PHOTOS));
    prepared.current = null;
    invalidate();
  };

  const canPlan = (topic.trim() || files.length > 0) && !planning;

  return (
    <main className="setup">
      <div className="setup-intro">
        {onCancel && (
          <button type="button" className="back-link" onClick={onCancel}>
            <ArrowLeft /> Your classes
          </button>
        )}
        <h1>
          Learn it out loud.
          <span className="hand">Get stuck? I'll show you where.</span>
        </h1>
        <p className="lede">A teacher who explains in your language on a shared board, then circles the exact step you got wrong.</p>
        <BoardPreview />
      </div>

      <form className="setup-card" onSubmit={(e) => e.preventDefault()}>
        <div className="row">
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Asha" autoComplete="given-name" />
          </label>
          <label className="field field-small">
            <span>Class</span>
            <select value={grade} onChange={(e) => {
                setGrade(e.target.value);
                invalidate(); // the plan is pitched at the class
              }}>
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
                  invalidate(); // the plan is written in the chosen language
                }}
                title={l.preview ? "Preview: not yet checked by a fluent speaker" : undefined}
              >
                {l.label}
                {l.preview && <small className="preview-mark"> preview</small>}
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
              invalidate();
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
                invalidate();
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <label className="upload">
          <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => pickFiles(e.target.files)} />
          <span className="upload-icon" aria-hidden="true">
            <UploadSimple />
          </span>
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
              {planning ? <span className="spin" /> : <Sparkle />}
              {planning ? (files.length ? "Reading your notes…" : "Making your plan…") : "Make a plan"}
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={planning || saving || !(topic.trim() || files.length > 0)}
            title={topic.trim() || files.length > 0 ? undefined : "Pick or type what you're studying first"}
            onClick={create}
          >
            {saving ? "Saving…" : "Create session"}
          </button>
        </div>
      </form>
    </main>
  );
}

/** A small, real piece of the class board: the teacher's working, the student's line, the red circle. */
function BoardPreview() {
  return (
    <figure className="board-preview" aria-label="Example: the teacher circles the step that went wrong">
      <p className="bp-title">
        <MathText text="x^2 - 5x + 6 = 0" />
      </p>
      <p>
        <MathText text="(x - 2)(x - 3) = 0" />
      </p>
      <p className="bp-student">
        <span className="bp-circled">
          <MathText text="x = -2 or x = 3" />
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
            <ellipse cx="50" cy="20" rx="48" ry="17" />
          </svg>
        </span>
      </p>
      <figcaption>Step 3: if x - 2 = 0, then x = 2, not -2.</figcaption>
    </figure>
  );
}
