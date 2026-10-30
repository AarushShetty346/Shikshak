import { describe, expect, it } from "vitest";
import { ALL_TOURS, clipName, spoken } from "./tourSteps";

describe("tour clips", () => {
  it("say the title then the text, without doubling punctuation", () => {
    expect(spoken({ title: "Your pen", text: "Write here." })).toBe("Your pen. Write here.");
    expect(spoken({ title: "That's it!", text: "Go." })).toBe("That's it! Go.");
  });

  it("are named by the words, so changed words need a new recording", () => {
    const a = clipName({ title: "Your pen", text: "Write here." });
    expect(a).toMatch(/^tour-[0-9a-f]{8}\.mp3$/);
    expect(clipName({ title: "Your pen", text: "Write here." })).toBe(a);
    expect(clipName({ title: "Your pen", text: "Write here!" })).not.toBe(a);
    // The target doesn't change what is said.
    expect(clipName({ target: ".x", title: "Your pen", text: "Write here." })).toBe(a);
  });

  it("give every step of both tours its own clip", () => {
    const names = ALL_TOURS().map(clipName);
    expect(new Set(names).size).toBe(names.length);
  });
});
