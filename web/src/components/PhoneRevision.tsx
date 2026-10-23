// Phone revision calls (for a basic phone): a guardian enrols the number with consent, picks a
// call window, and can stop the calls any time. The server decides whether a call can go out.

import { useCallback, useEffect, useState } from "react";
import { Phone } from "@phosphor-icons/react";
import { apiFetch } from "../lib/api";

interface PhoneStatus {
  enabledOnServer: boolean;
  enrolled: boolean;
  number: string | null;
  guardianName: string | null;
  window: { start: number; end: number } | null;
  optedOut: boolean;
  approved: boolean;
  readyNow: boolean;
  why: string | null;
  calls: { at: number; status: string; right: number; of: number }[];
}

const HOURS = Array.from({ length: 13 }, (_, i) => i + 9); // 9:00 to 21:00
const hour = (h: number) => `${h}:00`;

export function PhoneRevision({ learnerId, learnerName }: { learnerId: string; learnerName: string }) {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ number: "", guardianName: "", windowStart: 17, windowEnd: 19, guardianConsent: false, studentAssent: false });
  const load = useCallback(() => {
    apiFetch<{ phone: PhoneStatus }>(`/learners/${learnerId}/phone`)
      .then((r) => setStatus(r.phone))
      .catch((e: Error) => setError(e.message));
  }, [learnerId]);
  useEffect(load, [load]);

  if (!status) return error ? <p className="form-error">{error}</p> : null;

  const save = () => {
    setError(null);
    apiFetch<{ phone: PhoneStatus }>(`/learners/${learnerId}/phone`, { method: "PUT", body: form })
      .then((r) => {
        setStatus(r.phone);
        setEditing(false);
      })
      .catch((e: Error) => setError(e.message));
  };
  const act = (path: string, method: string) =>
    apiFetch<{ phone: PhoneStatus }>(`/learners/${learnerId}/phone${path}`, { method, body: method === "DELETE" ? undefined : {} })
      .then((r) => setStatus(r.phone))
      .catch((e: Error) => setError(e.message));

  return (
    <div className="phone-box">
      <p className="muted-line">
        For a basic phone: a short call (about 5 minutes, at most once a day) with up to three questions from {learnerName}'s own mistakes, answered on the keypad. Calls only happen in the time you choose, and saying "stop" or pressing 9 ends them for good.
      </p>
      {!status.enabledOnServer && <p className="note-line">Phone calls are switched off on this server. Saving a number here doesn't start any calls.</p>}

      {status.enrolled && !editing ? (
        <div className="phone-status">
          <p>
            <Phone /> <strong>{status.number}</strong>, between {hour(status.window!.start)} and {hour(status.window!.end)}. Agreed by {status.guardianName}.
          </p>
          <p className="muted-line">
            {status.optedOut
              ? "Calls are stopped."
              : !status.approved
                ? "Waiting for the Shikshak team to approve this number."
                : status.readyNow
                  ? "A revision call can go out now."
                  : `No call right now: ${status.why}`}
          </p>
          {status.calls.length > 0 && (
            <ul className="grant-list">
              {status.calls.map((c) => (
                <li key={c.at}>
                  <span>
                    {new Date(c.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}:{" "}
                    {c.status === "failed" ? "couldn't connect" : `${c.right} of ${c.of} right first time`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="actions actions-left">
            {!status.optedOut && (
              <button className="btn-secondary btn-small" onClick={() => void act("/opt-out", "POST")}>
                Stop calls
              </button>
            )}
            <button
              className="btn-secondary btn-small"
              onClick={() => {
                // The number is only ever shown masked, so it has to be typed again; consent is asked again too.
                setForm({ ...form, guardianName: status.guardianName ?? "", windowStart: status.window!.start, windowEnd: status.window!.end, guardianConsent: false, studentAssent: false });
                setEditing(true);
              }}
            >
              {status.optedOut ? "Start again" : "Change"}
            </button>
            <button
              className="btn-secondary btn-small danger"
              onClick={() => {
                if (window.confirm("Remove the number, the consent and the call history?")) void act("", "DELETE");
              }}
            >
              Remove number
            </button>
          </div>
        </div>
      ) : status.enrolled || editing ? (
        <form
          className="phone-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="field">
            <span>Phone number (with country code)</span>
            <input inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
          </label>
          <label className="field">
            <span>Parent or guardian's name</span>
            <input value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} />
          </label>
          <div className="phone-window">
            <label className="field">
              <span>From</span>
              <select value={form.windowStart} onChange={(e) => setForm({ ...form, windowStart: Number(e.target.value) })}>
                {HOURS.slice(0, -1).map((h) => (
                  <option key={h} value={h}>
                    {hour(h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>To</span>
              <select value={form.windowEnd} onChange={(e) => setForm({ ...form, windowEnd: Number(e.target.value) })}>
                {HOURS.slice(1).map((h) => (
                  <option key={h} value={h}>
                    {hour(h)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={form.guardianConsent} onChange={(e) => setForm({ ...form, guardianConsent: e.target.checked })} />
            I'm {learnerName}'s parent or guardian and I agree to these calls on this number.
          </label>
          <label className="check-row">
            <input type="checkbox" checked={form.studentAssent} onChange={(e) => setForm({ ...form, studentAssent: e.target.checked })} />
            {learnerName} knows about the calls and is happy to get them.
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="actions actions-left">
            <button className="btn-primary btn-small" type="submit">
              Save
            </button>
            <button className="btn-secondary btn-small" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="btn-secondary btn-small" onClick={() => setEditing(true)}>
          <Phone /> Set up phone revision
        </button>
      )}
      {error && !editing && <p className="form-error">{error}</p>}
    </div>
  );
}
