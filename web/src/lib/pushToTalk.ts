// Which key presses open and close the mic in push-to-talk.
//
// Space, or Caps Lock like a dictation app: hold it to talk, let go to stop. On a Mac the browser
// only reports Caps Lock turning on (keydown) and off (keyup), not the key being held, so there it
// works as press once to talk, press again to stop. Keys typed into a text field never count.

export type TalkKey = "down" | "up" | null;

const isTalkKey = (e: Pick<KeyboardEvent, "code" | "key">) => e.code === "Space" || e.code === "CapsLock" || e.key === "CapsLock";

export function talkKey(type: "keydown" | "keyup", e: Pick<KeyboardEvent, "code" | "key" | "repeat">, typing: boolean): TalkKey {
  if (typing || !isTalkKey(e)) return null;
  if (type === "keydown") return e.repeat ? null : "down";
  return "up";
}

/** What to tell the student, by platform. */
export function talkKeyHint(platform = typeof navigator === "undefined" ? "" : navigator.platform): string {
  return /Mac|iPhone|iPad/i.test(platform) ? "hold Space, or press Caps Lock to talk and again to stop" : "hold Space or Caps Lock";
}
