// Shows who has the floor: the teacher speaking (pulses with her real audio level), the student
// speaking (reacts to their mic), the teacher thinking, listening, or idle. Small and out of the way.

export type VoiceState = "idle" | "listening" | "student" | "thinking" | "teacher" | "connecting" | "paused";

const LABEL: Record<VoiceState, string> = {
  idle: "",
  connecting: "Connecting…",
  listening: "Hold Talk to speak",
  student: "Recording…",
  paused: "Paused",
  thinking: "Thinking…",
  teacher: "Teacher",
};

export function VoiceOrb({ state, level }: { state: VoiceState; level: number }) {
  const lv = Math.min(1, Math.max(0, level));
  return (
    <div className="orb" data-state={state} style={{ ["--lv" as string]: lv.toFixed(3) }} role="status" aria-live="polite" aria-label={LABEL[state] || "Not in class"}>
      <div className="orb-core">
        <span className="orb-ring r1" />
        <span className="orb-ring r2" />
        <span className="orb-mark" aria-hidden="true">
          श
        </span>
      </div>
      {LABEL[state] && <span className="orb-label">{LABEL[state]}</span>}
    </div>
  );
}
