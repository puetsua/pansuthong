import { describe, it, expect } from "vitest";
import { clampWeight } from "./tags";

describe("clampWeight", () => {
  it("parses a plain integer", () => {
    expect(clampWeight("5")).toBe(5);
    expect(clampWeight("-3")).toBe(-3);
  });

  it("clamps above the max to 9999", () => {
    expect(clampWeight("10000")).toBe(9999);
  });

  it("clamps below the min to -9999", () => {
    expect(clampWeight("-10000")).toBe(-9999);
  });

  it("falls back to 0 for non-numeric input", () => {
    expect(clampWeight("abc")).toBe(0);
    expect(clampWeight("")).toBe(0);
  });
});
