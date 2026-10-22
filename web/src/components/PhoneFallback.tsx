import { useState } from "react";

/** "Call my phone instead": Bolna rings the student's phone while this screen keeps working as the board. */
export function PhoneFallback({ userData, initiallyOpen = false }: { userData: () => Record<string, unknown>; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"idle" | "calling" | "placed">("idle");
  const [error, setError] = useState<string | null>(null);

  const call = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("calling");
    setError(null);
    try {
      const r = await fetch("/api/phone-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, user_data: userData() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Couldn't place the call");
      setState("placed");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  };

  if (!open) {
    return (
      <button className="phone-link" onClick={() => setOpen(true)}>
        Use my phone instead
      </button>
    );
  }

  return (
    <form className="phone-pop" onSubmit={call}>
      {state === "placed" ? (
        <p className="phone-done">Your phone will ring in a few seconds. Keep this screen open: the board and notebook still work here.</p>
      ) : (
        <>
          <label htmlFor="phone">Your mobile number</label>
          <div className="phone-row">
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <button className="btn-primary" disabled={!phone.trim() || state === "calling"}>
              {state === "calling" ? "Calling…" : "Call me"}
            </button>
          </div>
          {error && <p className="phone-error">{error}</p>}
        </>
      )}
      <button type="button" className="phone-close" onClick={() => setOpen(false)} aria-label="Close">
        ×
      </button>
    </form>
  );
}
