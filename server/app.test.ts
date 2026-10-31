import { describe, expect, it } from "vitest";
import { toE164 } from "./app";

describe("toE164", () => {
  it("turns Indian mobile numbers into +91 numbers", () => {
    expect(toE164("98765 43210")).toBe("+919876543210");
    expect(toE164("919876543210")).toBe("+919876543210");
    expect(toE164("+91 98765-43210")).toBe("+919876543210");
  });
  it("keeps full international numbers", () => {
    expect(toE164("+1 415 555 0100")).toBe("+14155550100");
  });
  it("rejects things that aren't phone numbers", () => {
    expect(toE164("12345")).toBeNull();
    expect(toE164("0123456789")).toBeNull(); // Indian mobiles start with 6-9
    expect(toE164(undefined)).toBeNull();
  });
});
