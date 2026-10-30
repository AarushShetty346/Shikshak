import { describe, expect, it } from "vitest";
import { talkKey, talkKeyHint } from "./pushToTalk";

const key = (code: string, k = code, repeat = false) => ({ code, key: k, repeat });

describe("push-to-talk keys", () => {
  it("Caps Lock and Space open the mic on keydown and close it on keyup", () => {
    expect(talkKey("keydown", key("CapsLock"), false)).toBe("down");
    expect(talkKey("keyup", key("CapsLock"), false)).toBe("up");
    expect(talkKey("keydown", key("Space", " "), false)).toBe("down");
    expect(talkKey("keyup", key("Space", " "), false)).toBe("up");
  });

  it("ignores key repeat while held, other keys, and typing in a field", () => {
    expect(talkKey("keydown", key("CapsLock", "CapsLock", true), false)).toBeNull();
    expect(talkKey("keydown", key("KeyA", "a"), false)).toBeNull();
    expect(talkKey("keydown", key("CapsLock"), true)).toBeNull();
  });

  it("explains the Mac difference", () => {
    expect(talkKeyHint("MacIntel")).toMatch(/press Caps Lock to talk and again to stop/);
    expect(talkKeyHint("Win32")).toBe("hold Space or Caps Lock");
  });
});
