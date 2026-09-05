import { describe, it, expect } from "vitest";
import {
  normalizeTagColor,
  normalizeTagHashColor,
  _tagColorDisplayTest,
} from "./tagColorDisplay";

const { contrastRatio, PAGE_LIGHT, PAGE_DARK, rgbToHsl, parseHex } = _tagColorDisplayTest;

describe("normalizeTagColor near-white", () => {
  const cases = ["#ffffff", "#fefefe"] as const;

  for (const hex of cases) {
    it(`light theme pill for ${hex}`, () => {
      expect(normalizeTagColor(hex, "light")).toEqual({
        bg: "#ffffff",
        fg: "#1f2328",
        border: "rgba(31,35,40,0.55)",
      });
    });

    it(`dark theme pill for ${hex}`, () => {
      expect(normalizeTagColor(hex, "dark")).toEqual({
        bg: "rgba(240,243,246,0.10)",
        fg: "#f0f3f6",
        border: "rgba(240,243,246,0.7)",
      });
    });
  }
});

describe("normalizeTagColor near-black", () => {
  const cases = ["#000000", "#010101"] as const;

  for (const hex of cases) {
    it(`light theme pill for ${hex} stays soft (not solid black + white text)`, () => {
      const pill = normalizeTagColor(hex, "light");
      expect(pill).toEqual({
        bg: "rgba(31,35,40,0.08)",
        fg: "#1f2328",
        border: "rgba(31,35,40,0.55)",
      });
      expect(pill.fg).not.toBe("#ffffff");
      expect(pill.bg).not.toBe("#000000");
    });

    it(`dark theme pill for ${hex}`, () => {
      expect(normalizeTagColor(hex, "dark")).toEqual({
        bg: "rgba(110,118,129,0.10)",
        fg: "#8b949e",
        border: "rgba(110,118,129,0.35)",
      });
    });
  }
});

describe("normalizeTagColor chromatic", () => {
  it("red pills are bordered with hue-preserving fg", () => {
    for (const theme of ["light", "dark"] as const) {
      const pill = normalizeTagColor("#ff0000", theme);
      expect(pill.border).toBe(pill.fg);
      expect(pill.bg).toMatch(/^rgba\(255,0,0,/);
      const page = theme === "light" ? PAGE_LIGHT : PAGE_DARK;
      expect(contrastRatio(pill.fg, page)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gray mid keeps a gray hue on both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const pill = normalizeTagColor("#888888", theme);
      expect(pill.border).toBe(pill.fg);
      expect(pill.bg).toMatch(/^rgba\(136,136,136,/);
      const page = theme === "light" ? PAGE_LIGHT : PAGE_DARK;
      expect(contrastRatio(pill.fg, page)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("pure yellow on light stays yellower than amber", () => {
    const yellow = normalizeTagColor("#ffff00", "light");
    const amber = normalizeTagColor("#fbbf24", "light");
    const yellowH = rgbToHsl(parseHex(yellow.fg)!).h;
    const amberH = rgbToHsl(parseHex(amber.fg)!).h;
    expect(yellowH).toBeGreaterThan(amberH);
    expect(contrastRatio(yellow.fg, PAGE_LIGHT)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("normalizeTagHashColor", () => {
  it("near-white hash colors", () => {
    expect(normalizeTagHashColor("#ffffff", "light")).toBe("#656d76");
    expect(normalizeTagHashColor("#fefefe", "light")).toBe("#656d76");
    expect(normalizeTagHashColor("#ffffff", "dark")).toBe("#f0f3f6");
  });

  it("near-black hash colors", () => {
    expect(normalizeTagHashColor("#000000", "light")).toBe("#1f2328");
    expect(normalizeTagHashColor("#010101", "light")).toBe("#1f2328");
    expect(normalizeTagHashColor("#000000", "dark")).toBe("#6e7681");
  });

  it("chromatic hash matches pill fg", () => {
    const hex = "#ff0000";
    expect(normalizeTagHashColor(hex, "light")).toBe(normalizeTagColor(hex, "light").fg);
    expect(normalizeTagHashColor(hex, "dark")).toBe(normalizeTagColor(hex, "dark").fg);
  });
});
