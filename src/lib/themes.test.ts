import { describe, it, expect } from "vitest";
import {
  THEME_PRESETS, TOKEN_ORDER, TOKEN_LABEL_KEY,
  getPreset, resolveThemeVars, activeVariant, applyThemeToRoot,
  isThemeCustomized, sanitizeTokens, serializeThemeJson, parseThemeJson,
} from "./themes";
import type { Settings, ThemePreset } from "./tauri";

function settings(over: Partial<Settings> = {}): Settings {
  return { theme: "auto", sort_order: "priority", ...over };
}

const customSlateLike: ThemePreset = {
  id: "custom_1", name: "Mine",
  light: { "--c-accent": "#ff0000" },
  dark: { "--c-accent": "#00ff00" },
};

describe("built-in presets", () => {
  it("ships six built-ins, each with full light and dark token maps", () => {
    expect(THEME_PRESETS).toHaveLength(6);
    for (const p of THEME_PRESETS) {
      for (const tok of TOKEN_ORDER) {
        expect(p.light[tok], `${p.id} light ${tok}`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(p.dark[tok], `${p.id} dark ${tok}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("default reproduces the current tokens.css palette", () => {
    const d = getPreset("default");
    expect(d.light["--c-accent"]).toBe("#4338ca");
    expect(d.dark["--c-bg"]).toBe("#0f172a");
  });
});

describe("TOKEN_ORDER", () => {
  it("covers all 11 tokens and each has a label key", () => {
    expect(TOKEN_ORDER).toHaveLength(11);
    for (const tok of TOKEN_ORDER) expect(typeof TOKEN_LABEL_KEY[tok]).toBe("string");
  });
});

describe("resolveThemeVars", () => {
  it("returns a built-in preset's variant map", () => {
    expect(resolveThemeVars(settings({ theme_preset: "slate" }), "dark"))
      .toEqual(getPreset("slate").dark);
  });

  it("resolves a custom preset, layering its tokens over the default base", () => {
    const s = settings({ theme_preset: "custom_1", custom_presets: [customSlateLike] });
    const out = resolveThemeVars(s, "light");
    expect(out["--c-accent"]).toBe("#ff0000"); // from the custom preset
    expect(out["--c-bg"]).toBe(getPreset("default").light["--c-bg"]); // filled from base
  });

  it("falls back to the default base for an unknown preset id", () => {
    expect(resolveThemeVars(settings({ theme_preset: "ghost" }), "light"))
      .toEqual(getPreset("default").light);
  });
});

describe("isThemeCustomized", () => {
  it("is false only for the built-in default", () => {
    expect(isThemeCustomized(settings())).toBe(false);
    expect(isThemeCustomized(settings({ theme_preset: "default" }))).toBe(false);
    expect(isThemeCustomized(settings({ theme_preset: "slate" }))).toBe(true);
    expect(isThemeCustomized(settings({ theme_preset: "custom_1" }))).toBe(true);
  });
});

describe("activeVariant", () => {
  it("honors explicit themes and follows the OS for auto", () => {
    expect(activeVariant("light", true)).toBe("light");
    expect(activeVariant("dark", false)).toBe("dark");
    expect(activeVariant("auto", true)).toBe("dark");
    expect(activeVariant("auto", false)).toBe("light");
  });
});

describe("applyThemeToRoot", () => {
  it("applies resolved tokens when customized", () => {
    const el = document.createElement("div");
    applyThemeToRoot(el, settings({ theme_preset: "slate" }), "light");
    expect(el.style.getPropertyValue("--c-accent")).toBe(getPreset("slate").light["--c-accent"]);
  });

  it("clears inline tokens for the stock default", () => {
    const el = document.createElement("div");
    el.style.setProperty("--c-accent", "#123456");
    applyThemeToRoot(el, settings({ theme_preset: "default" }), "light");
    expect(el.style.getPropertyValue("--c-accent")).toBe("");
  });
});

describe("sanitizeTokens", () => {
  it("keeps only known token keys with valid hex values", () => {
    const out = sanitizeTokens({ "--c-accent": "#abc", "--c-evil": "#000000", "--c-bg": "red" });
    expect(out).toEqual({ "--c-accent": "#abc" });
  });
});

describe("theme JSON import/export", () => {
  it("round-trips a theme through serialize/parse", () => {
    const json = serializeThemeJson("My Theme", { "--c-accent": "#ff0000" }, { "--c-accent": "#00ff00" });
    const parsed = parseThemeJson(json);
    expect(parsed.name).toBe("My Theme");
    expect(parsed.light["--c-accent"]).toBe("#ff0000");
    expect(parsed.dark["--c-accent"]).toBe("#00ff00");
  });

  it("rejects non-JSON", () => {
    expect(() => parseThemeJson("not json")).toThrow();
  });

  it("rejects JSON that isn't a pansutong theme", () => {
    expect(() => parseThemeJson(JSON.stringify({ hello: 1 }))).toThrow();
  });

  it("rejects a theme with no usable colors", () => {
    expect(() => parseThemeJson(JSON.stringify({ pansutong_theme: 1, name: "x", light: {}, dark: {} }))).toThrow();
  });

  it("drops unknown keys and bad values on import", () => {
    const json = JSON.stringify({ pansutong_theme: 1, name: "x", light: { "--c-accent": "#fff", "--c-evil": "#000" }, dark: {} });
    const parsed = parseThemeJson(json);
    expect(parsed.light).toEqual({ "--c-accent": "#fff" });
  });
});
