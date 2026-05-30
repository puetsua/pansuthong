import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("returns the message of an Error instance", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns a string as-is (e.g. a serialized AppError)", () => {
    expect(errorMessage("invalid: tag not found")).toBe("invalid: tag not found");
  });

  it("unwraps an object's message field", () => {
    expect(errorMessage({ message: "nope" })).toBe("nope");
  });

  it("JSON-stringifies a plain object rather than rendering [object Object]", () => {
    expect(errorMessage({ NotFound: "k_1" })).toBe('{"NotFound":"k_1"}');
  });

  it("never produces [object Object] for an object rejection", () => {
    expect(errorMessage({ a: 1, b: 2 })).not.toBe("[object Object]");
  });

  it("handles null without throwing", () => {
    expect(errorMessage(null)).toBe("null");
  });
});
