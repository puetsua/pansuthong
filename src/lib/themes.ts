import type { Settings, ThemePreset } from "./tauri";

// Theme customization (#15). Presets and color resolution live entirely in the
// frontend — the Rust side only stores the active preset id and the user's custom
// presets as opaque strings (no theme logic, mobile-safe).

export type ThemeVariant = "light" | "dark";

/** A complete set of color tokens for one variant. Keys are full CSS custom
 *  property names (e.g. "--c-bg") so they can be applied with `setProperty`. */
export type ThemeTokens = Record<string, string>;

export type Preset = {
  id: string;
  /** i18n key for the display name, e.g. "settings.themePresetSlate". */
  nameKey: string;
  light: ThemeTokens;
  dark: ThemeTokens;
};

export const DEFAULT_PRESET_ID = "default";

/** Every editable color token, in UI display order (primaries first). Drives the
 *  editor's rows, the preview, and sanitization. */
export const TOKEN_ORDER = [
  "--c-accent", "--c-bg", "--c-surface", "--c-text",
  "--c-surface-2", "--c-border", "--c-text-muted", "--c-text-subtle",
  "--c-accent-bg", "--c-danger",
] as const;

/** Token -> i18n label key for the editor and previews. */
export const TOKEN_LABEL_KEY: Record<string, string> = {
  "--c-accent": "settings.themeColorAccent",
  "--c-bg": "settings.themeColorBackground",
  "--c-surface": "settings.themeColorSurface",
  "--c-text": "settings.themeColorText",
  "--c-surface-2": "settings.themeColorSurface2",
  "--c-border": "settings.themeColorBorder",
  "--c-text-muted": "settings.themeColorTextMuted",
  "--c-text-subtle": "settings.themeColorTextSubtle",
  "--c-accent-bg": "settings.themeColorAccentBg",
  "--c-danger": "settings.themeColorDanger",
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** Versioned envelope tag for import/export JSON. */
export const THEME_JSON_VERSION = 1;

export const THEME_PRESETS: Preset[] = [
  {
    id: "default",
    nameKey: "settings.themePresetDefault",
    // Mirrors src/styles/tokens.css exactly: "Default + no overrides" is a no-op.
    light: {
      "--c-bg": "#f9fafb", "--c-surface": "#ffffff", "--c-surface-2": "#f3f4f6",
      "--c-border": "#e5e7eb", "--c-text": "#1f2937", "--c-text-muted": "#6b7280",
      "--c-text-subtle": "#9ca3af", "--c-accent": "#4338ca", "--c-accent-bg": "#eef2ff",
      "--c-danger": "#dc2626",
    },
    dark: {
      "--c-bg": "#0f172a", "--c-surface": "#1e293b", "--c-surface-2": "#243044",
      "--c-border": "#334155", "--c-text": "#e2e8f0", "--c-text-muted": "#94a3b8",
      "--c-text-subtle": "#64748b", "--c-accent": "#818cf8", "--c-accent-bg": "#312e81",
      "--c-danger": "#fca5a5",
    },
  },
  {
    id: "slate",
    nameKey: "settings.themePresetSlate",
    light: {
      "--c-bg": "#f1f5f9", "--c-surface": "#ffffff", "--c-surface-2": "#e2e8f0",
      "--c-border": "#cbd5e1", "--c-text": "#0f172a", "--c-text-muted": "#475569",
      "--c-text-subtle": "#64748b", "--c-accent": "#0369a1", "--c-accent-bg": "#e0f2fe",
      "--c-danger": "#dc2626",
    },
    dark: {
      "--c-bg": "#0b1220", "--c-surface": "#131c2e", "--c-surface-2": "#1c2840",
      "--c-border": "#2b3a55", "--c-text": "#e5edf7", "--c-text-muted": "#9fb1c9",
      "--c-text-subtle": "#6b7e99", "--c-accent": "#38bdf8", "--c-accent-bg": "#0c2a40",
      "--c-danger": "#fca5a5",
    },
  },
  {
    id: "sepia",
    nameKey: "settings.themePresetSepia",
    light: {
      "--c-bg": "#f5efe3", "--c-surface": "#fffaf0", "--c-surface-2": "#efe6d4",
      "--c-border": "#ddcfb6", "--c-text": "#43381f", "--c-text-muted": "#6f6242",
      "--c-text-subtle": "#93855f", "--c-accent": "#9a6a2f", "--c-accent-bg": "#f3e6cf",
      "--c-danger": "#b4452b",
    },
    dark: {
      "--c-bg": "#211b12", "--c-surface": "#2c2419", "--c-surface-2": "#382e20",
      "--c-border": "#4d3f2c", "--c-text": "#ece2cf", "--c-text-muted": "#b8a888",
      "--c-text-subtle": "#8a7c5e", "--c-accent": "#d9a657", "--c-accent-bg": "#463318",
      "--c-danger": "#e08b6a",
    },
  },
  {
    id: "high_contrast",
    nameKey: "settings.themePresetHighContrast",
    light: {
      "--c-bg": "#ffffff", "--c-surface": "#ffffff", "--c-surface-2": "#f0f0f0",
      "--c-border": "#000000", "--c-text": "#000000", "--c-text-muted": "#1a1a1a",
      "--c-text-subtle": "#333333", "--c-accent": "#0000cc", "--c-accent-bg": "#e0e0ff",
      "--c-danger": "#b00000",
    },
    dark: {
      "--c-bg": "#000000", "--c-surface": "#0a0a0a", "--c-surface-2": "#1a1a1a",
      "--c-border": "#ffffff", "--c-text": "#ffffff", "--c-text-muted": "#e6e6e6",
      "--c-text-subtle": "#cccccc", "--c-accent": "#66b3ff", "--c-accent-bg": "#002b66",
      "--c-danger": "#ff6666",
    },
  },
  {
    id: "emerald",
    nameKey: "settings.themePresetEmerald",
    light: {
      "--c-bg": "#f6faf7", "--c-surface": "#ffffff", "--c-surface-2": "#e9f3ec",
      "--c-border": "#d3e3d8", "--c-text": "#11261a", "--c-text-muted": "#4b6357",
      "--c-text-subtle": "#6e857a", "--c-accent": "#047857", "--c-accent-bg": "#d1fae5",
      "--c-danger": "#dc2626",
    },
    dark: {
      "--c-bg": "#07120d", "--c-surface": "#0f1f17", "--c-surface-2": "#16291f",
      "--c-border": "#244536", "--c-text": "#d8f0e2", "--c-text-muted": "#93b8a4",
      "--c-text-subtle": "#6b8c7a", "--c-accent": "#34d399", "--c-accent-bg": "#064233",
      "--c-danger": "#fca5a5",
    },
  },
  {
    id: "rose",
    nameKey: "settings.themePresetRose",
    light: {
      "--c-bg": "#fdf6f8", "--c-surface": "#ffffff", "--c-surface-2": "#f8e8ee",
      "--c-border": "#efd2dc", "--c-text": "#2a1620", "--c-text-muted": "#6b4a57",
      "--c-text-subtle": "#8f6e7b", "--c-accent": "#be185d", "--c-accent-bg": "#fce7f0",
      "--c-danger": "#dc2626",
    },
    dark: {
      "--c-bg": "#140a0f", "--c-surface": "#20131a", "--c-surface-2": "#2c1b24",
      "--c-border": "#4a2a39", "--c-text": "#f1dde7", "--c-text-muted": "#c39bac",
      "--c-text-subtle": "#977182", "--c-accent": "#f472b6", "--c-accent-bg": "#4a1130",
      "--c-danger": "#fca5a5",
    },
  },
];

/** The built-in preset for `id`, falling back to the default for an unknown/absent
 *  id. Only consults built-ins — custom presets live in settings. */
export function getPreset(id: string | undefined): Preset {
  return THEME_PRESETS.find(p => p.id === id) ?? THEME_PRESETS[0];
}

/** The default built-in's variant map — the base custom presets layer over. */
function defaultBase(variant: ThemeVariant): ThemeTokens {
  return THEME_PRESETS[0][variant];
}

/** Fill a (possibly partial) custom token map up to a complete variant map by
 *  layering it over the default base. Used for previewing/editing custom presets. */
export function fullTokens(map: Record<string, string> | undefined, variant: ThemeVariant): ThemeTokens {
  return { ...defaultBase(variant), ...sanitizeTokens(map) };
}

/** The slice of the `updateSettings` patch the theme UI writes (#15). */
export type ThemeSettingsPatch = {
  theme?: "auto" | "light" | "dark";
  theme_preset?: string;
  custom_presets?: ThemePreset[];
};

/** Keep only known token keys carrying a valid hex value, so a malformed or hostile
 *  map can never set unexpected properties. */
export function sanitizeTokens(map: Record<string, string> | undefined): ThemeTokens {
  const out: ThemeTokens = {};
  if (!map) return out;
  for (const tok of TOKEN_ORDER) {
    const v = map[tok];
    if (typeof v === "string" && HEX.test(v)) out[tok] = v;
  }
  return out;
}

/** The custom preset with `id`, if any. */
export function findCustomPreset(settings: Settings, id: string | undefined): ThemePreset | undefined {
  return id ? settings.custom_presets?.find(p => p.id === id) : undefined;
}

/** The effective token map for one variant. A built-in id yields its complete map;
 *  a custom id layers its (sanitized) tokens over the default base so a partial or
 *  imported preset still renders fully; an unknown id falls back to the base. */
export function resolveThemeVars(settings: Settings, variant: ThemeVariant): ThemeTokens {
  const id = settings.theme_preset ?? DEFAULT_PRESET_ID;
  const builtin = THEME_PRESETS.find(p => p.id === id);
  if (builtin) return builtin[variant];
  const custom = findCustomPreset(settings, id);
  if (!custom) return defaultBase(variant);
  return { ...defaultBase(variant), ...sanitizeTokens(custom[variant]) };
}

/** Whether the active theme departs from the stock default built-in. When false the
 *  renderer leaves `tokens.css` untouched (today's behavior, byte-for-byte). */
export function isThemeCustomized(settings: Settings): boolean {
  return (settings.theme_preset ?? DEFAULT_PRESET_ID) !== DEFAULT_PRESET_ID;
}

/** Whether the OS currently prefers a dark color scheme (false outside a DOM, e.g.
 *  in tests). */
export function prefersDarkScheme(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
}

/** The variant to render: an explicit light/dark theme wins; `auto` follows the
 *  OS preference (`prefersDark`). */
export function activeVariant(theme: string, prefersDark: boolean): ThemeVariant {
  if (theme === "light") return "light";
  if (theme === "dark") return "dark";
  return prefersDark ? "dark" : "light";
}

/** Apply the active variant's effective tokens to `el` as inline custom properties,
 *  or clear them for the stock default so `tokens.css` stays authoritative. */
export function applyThemeToRoot(el: HTMLElement, settings: Settings, variant: ThemeVariant): void {
  if (isThemeCustomized(settings)) {
    const vars = resolveThemeVars(settings, variant);
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  } else {
    for (const k of TOKEN_ORDER) el.style.removeProperty(k);
  }
}

/** Serialize a theme to the shareable JSON envelope (copy/paste import-export). */
export function serializeThemeJson(name: string, light: ThemeTokens, dark: ThemeTokens): string {
  return JSON.stringify({ pansutong_theme: THEME_JSON_VERSION, name, light, dark }, null, 2);
}

/** Parse a pasted theme JSON envelope into a sanitized name + token maps. Throws an
 *  Error whose message is an i18n key on malformed input, so callers can localize. */
export function parseThemeJson(text: string): { name: string; light: ThemeTokens; dark: ThemeTokens } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("settings.themeImportInvalidJson");
  }
  if (!data || typeof data !== "object" || (data as { pansutong_theme?: unknown }).pansutong_theme !== THEME_JSON_VERSION) {
    throw new Error("settings.themeImportNotATheme");
  }
  const obj = data as { name?: unknown; light?: Record<string, string>; dark?: Record<string, string> };
  // No localized default here (this module has no i18n); an empty name lets the
  // editor's name-required flow prompt the user.
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  const light = sanitizeTokens(obj.light);
  const dark = sanitizeTokens(obj.dark);
  if (Object.keys(light).length === 0 && Object.keys(dark).length === 0) {
    throw new Error("settings.themeImportNoColors");
  }
  return { name, light, dark };
}
