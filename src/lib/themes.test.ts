import { describe, it, expect } from "vitest";
import {
  THEME_PRESETS, DEFAULT_PRESET_ID, EDITABLE_TOKENS,
  getPreset, resolveThemeVars, activeVariant, applyThemeToRoot,
} from "./themes";
import type { Settings } from "./tauri";

function settings(over: Partial<Settings> = {}): Settings {
  return { theme: "auto", sort_order: "priority", ...over };
}

describe("THEME_PRESETS", () => {
  it("includes the default preset whose id matches DEFAULT_PRESET_ID", () => {
    expect(getPreset(DEFAULT_PRESET_ID).id).toBe(DEFAULT_PRESET_ID);
  });

  it("ships six presets, each with full light and dark token maps", () => {
    expect(THEME_PRESETS).toHaveLength(6);
    for (const p of THEME_PRESETS) {
      for (const tok of ["--c-bg", "--c-surface", "--c-text", "--c-accent", "--c-border",
        "--c-surface-2", "--c-text-muted", "--c-text-subtle", "--c-accent-bg",
        "--c-danger", "--c-success"]) {
        expect(p.light[tok], `${p.id} light ${tok}`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(p.dark[tok], `${p.id} dark ${tok}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("the default preset reproduces the current tokens.css palette exactly", () => {
    const d = getPreset("default");
    expect(d.light["--c-bg"]).toBe("#f9fafb");
    expect(d.light["--c-surface"]).toBe("#ffffff");
    expect(d.light["--c-text"]).toBe("#1f2937");
    expect(d.light["--c-accent"]).toBe("#4338ca");
    expect(d.dark["--c-bg"]).toBe("#0f172a");
    expect(d.dark["--c-surface"]).toBe("#1e293b");
    expect(d.dark["--c-text"]).toBe("#e2e8f0");
    expect(d.dark["--c-accent"]).toBe("#818cf8");
  });
});

describe("EDITABLE_TOKENS", () => {
  it("is the curated four: accent, bg, surface, text", () => {
    expect(EDITABLE_TOKENS).toEqual(["--c-accent", "--c-bg", "--c-surface", "--c-text"]);
  });
});

describe("getPreset", () => {
  it("falls back to the default preset for an unknown id", () => {
    expect(getPreset("nope").id).toBe(DEFAULT_PRESET_ID);
    expect(getPreset(undefined).id).toBe(DEFAULT_PRESET_ID);
  });
});

describe("resolveThemeVars", () => {
  it("returns the chosen preset's variant map when there are no overrides", () => {
    expect(resolveThemeVars(settings({ theme_preset: "default" }), "light"))
      .toEqual(getPreset("default").light);
    expect(resolveThemeVars(settings({ theme_preset: "slate" }), "dark"))
      .toEqual(getPreset("slate").dark);
  });

  it("layers a variant override over the preset value", () => {
    const s = settings({ theme_preset: "default", theme_colors_light: { "--c-accent": "#ff0000" } });
    const out = resolveThemeVars(s, "light");
    expect(out["--c-accent"]).toBe("#ff0000");
    expect(out["--c-bg"]).toBe(getPreset("default").light["--c-bg"]); // untouched
  });

  it("ignores override keys outside the editable set", () => {
    const s = settings({ theme_colors_light: { "--c-border": "#abcabc", "--c-evil": "#000000" } });
    const out = resolveThemeVars(s, "light");
    expect(out["--c-border"]).toBe(getPreset("default").light["--c-border"]); // not editable -> preset wins
    expect(out["--c-evil"]).toBeUndefined();
  });

  it("applies overrides only to the matching variant", () => {
    const s = settings({ theme_colors_light: { "--c-accent": "#ff0000" } });
    expect(resolveThemeVars(s, "dark")["--c-accent"]).toBe(getPreset("default").dark["--c-accent"]);
  });

  it("falls back to default preset tokens for an unknown preset id", () => {
    expect(resolveThemeVars(settings({ theme_preset: "ghost" }), "light"))
      .toEqual(getPreset("default").light);
  });
});

describe("activeVariant", () => {
  it("honors an explicit light/dark theme regardless of OS preference", () => {
    expect(activeVariant("light", true)).toBe("light");
    expect(activeVariant("dark", false)).toBe("dark");
  });

  it("follows the OS preference when theme is auto", () => {
    expect(activeVariant("auto", true)).toBe("dark");
    expect(activeVariant("auto", false)).toBe("light");
  });
});

describe("applyThemeToRoot", () => {
  it("applies the resolved tokens as inline custom properties when customized", () => {
    const el = document.createElement("div");
    applyThemeToRoot(el, settings({ theme_preset: "slate" }), "light");
    expect(el.style.getPropertyValue("--c-accent")).toBe(getPreset("slate").light["--c-accent"]);
    expect(el.style.getPropertyValue("--c-bg")).toBe(getPreset("slate").light["--c-bg"]);
  });

  it("applies a per-variant override on top of the preset", () => {
    const el = document.createElement("div");
    applyThemeToRoot(el, settings({ theme_colors_light: { "--c-accent": "#ff0000" } }), "light");
    expect(el.style.getPropertyValue("--c-accent")).toBe("#ff0000");
  });

  it("clears any inline tokens for the stock default theme (no-op path)", () => {
    const el = document.createElement("div");
    el.style.setProperty("--c-accent", "#123456"); // stale inline value from a prior theme
    applyThemeToRoot(el, settings({ theme_preset: "default" }), "light");
    expect(el.style.getPropertyValue("--c-accent")).toBe("");
  });
});
