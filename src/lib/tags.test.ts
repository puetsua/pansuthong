import { describe, it, expect } from "vitest";
import { clampWeight, readableTextColor } from "./tags";

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

describe("readableTextColor", () => {
  it("uses dark text on light fills", () => {
    expect(readableTextColor("#f59e0b")).toBe("#000000"); // amber
    expect(readableTextColor("#84cc16")).toBe("#000000"); // lime
    expect(readableTextColor("#ffffff")).toBe("#000000");
  });

  it("uses light text on dark fills", () => {
    expect(readableTextColor("#4338ca")).toBe("#ffffff"); // indigo
    expect(readableTextColor("#ef4444")).toBe("#ffffff"); // red
    expect(readableTextColor("#000000")).toBe("#ffffff");
  });

  it("accepts shorthand hex and is case-insensitive", () => {
    expect(readableTextColor("#FFF")).toBe("#000000");
    expect(readableTextColor("#FFFFFF")).toBe("#000000");
  });

  it("falls back to white for unparseable input", () => {
    expect(readableTextColor("rebeccapurple")).toBe("#ffffff");
    expect(readableTextColor("")).toBe("#ffffff");
  });
});
