import type { Settings } from "./tauri";

// Theme customization (#15). Presets and color resolution live entirely in the
// frontend — the Rust side only stores the selected preset id and the per-variant
// color overrides as opaque strings (no theme logic, mobile-safe).

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

/** The subset of tokens the customization UI exposes (per variant). Override maps
 *  for any other token are ignored — those always come from the preset base. */
export const EDITABLE_TOKENS = ["--c-accent", "--c-bg", "--c-surface", "--c-text"] as const;

export const THEME_PRESETS: Preset[] = [
  {
    id: "default",
    nameKey: "settings.themePresetDefault",
    // Mirrors src/styles/tokens.css exactly: "Default + no overrides" is a no-op.
    light: {
      "--c-bg": "#f9fafb", "--c-surface": "#ffffff", "--c-surface-2": "#f3f4f6",
      "--c-border": "#e5e7eb", "--c-text": "#1f2937", "--c-text-muted": "#6b7280",
      "--c-text-subtle": "#9ca3af", "--c-accent": "#4338ca", "--c-accent-bg": "#eef2ff",
      "--c-danger": "#dc2626", "--c-success": "#047857",
    },
    dark: {
      "--c-bg": "#0f172a", "--c-surface": "#1e293b", "--c-surface-2": "#243044",
      "--c-border": "#334155", "--c-text": "#e2e8f0", "--c-text-muted": "#94a3b8",
      "--c-text-subtle": "#64748b", "--c-accent": "#818cf8", "--c-accent-bg": "#312e81",
      "--c-danger": "#fca5a5", "--c-success": "#6ee7b7",
    },
  },
  {
    id: "slate",
    nameKey: "settings.themePresetSlate",
    light: {
      "--c-bg": "#f1f5f9", "--c-surface": "#ffffff", "--c-surface-2": "#e2e8f0",
      "--c-border": "#cbd5e1", "--c-text": "#0f172a", "--c-text-muted": "#475569",
      "--c-text-subtle": "#64748b", "--c-accent": "#0369a1", "--c-accent-bg": "#e0f2fe",
      "--c-danger": "#dc2626", "--c-success": "#047857",
    },
    dark: {
      "--c-bg": "#0b1220", "--c-surface": "#131c2e", "--c-surface-2": "#1c2840",
      "--c-border": "#2b3a55", "--c-text": "#e5edf7", "--c-text-muted": "#9fb1c9",
      "--c-text-subtle": "#6b7e99", "--c-accent": "#38bdf8", "--c-accent-bg": "#0c2a40",
      "--c-danger": "#fca5a5", "--c-success": "#6ee7b7",
    },
  },
  {
    id: "sepia",
    nameKey: "settings.themePresetSepia",
    light: {
      "--c-bg": "#f5efe3", "--c-surface": "#fffaf0", "--c-surface-2": "#efe6d4",
      "--c-border": "#ddcfb6", "--c-text": "#43381f", "--c-text-muted": "#6f6242",
      "--c-text-subtle": "#93855f", "--c-accent": "#9a6a2f", "--c-accent-bg": "#f3e6cf",
      "--c-danger": "#b4452b", "--c-success": "#5d7a32",
    },
    dark: {
      "--c-bg": "#211b12", "--c-surface": "#2c2419", "--c-surface-2": "#382e20",
      "--c-border": "#4d3f2c", "--c-text": "#ece2cf", "--c-text-muted": "#b8a888",
      "--c-text-subtle": "#8a7c5e", "--c-accent": "#d9a657", "--c-accent-bg": "#463318",
      "--c-danger": "#e08b6a", "--c-success": "#a7c06b",
    },
  },
  {
    id: "high_contrast",
    nameKey: "settings.themePresetHighContrast",
    light: {
      "--c-bg": "#ffffff", "--c-surface": "#ffffff", "--c-surface-2": "#f0f0f0",
      "--c-border": "#000000", "--c-text": "#000000", "--c-text-muted": "#1a1a1a",
      "--c-text-subtle": "#333333", "--c-accent": "#0000cc", "--c-accent-bg": "#e0e0ff",
      "--c-danger": "#b00000", "--c-success": "#006600",
    },
    dark: {
      "--c-bg": "#000000", "--c-surface": "#0a0a0a", "--c-surface-2": "#1a1a1a",
      "--c-border": "#ffffff", "--c-text": "#ffffff", "--c-text-muted": "#e6e6e6",
      "--c-text-subtle": "#cccccc", "--c-accent": "#66b3ff", "--c-accent-bg": "#002b66",
      "--c-danger": "#ff6666", "--c-success": "#66ff99",
    },
  },
  {
    id: "emerald",
    nameKey: "settings.themePresetEmerald",
    light: {
      "--c-bg": "#f6faf7", "--c-surface": "#ffffff", "--c-surface-2": "#e9f3ec",
      "--c-border": "#d3e3d8", "--c-text": "#11261a", "--c-text-muted": "#4b6357",
      "--c-text-subtle": "#6e857a", "--c-accent": "#047857", "--c-accent-bg": "#d1fae5",
      "--c-danger": "#dc2626", "--c-success": "#047857",
    },
    dark: {
      "--c-bg": "#07120d", "--c-surface": "#0f1f17", "--c-surface-2": "#16291f",
      "--c-border": "#244536", "--c-text": "#d8f0e2", "--c-text-muted": "#93b8a4",
      "--c-text-subtle": "#6b8c7a", "--c-accent": "#34d399", "--c-accent-bg": "#064233",
      "--c-danger": "#fca5a5", "--c-success": "#34d399",
    },
  },
  {
    id: "rose",
    nameKey: "settings.themePresetRose",
    light: {
      "--c-bg": "#fdf6f8", "--c-surface": "#ffffff", "--c-surface-2": "#f8e8ee",
      "--c-border": "#efd2dc", "--c-text": "#2a1620", "--c-text-muted": "#6b4a57",
      "--c-text-subtle": "#8f6e7b", "--c-accent": "#be185d", "--c-accent-bg": "#fce7f0",
      "--c-danger": "#dc2626", "--c-success": "#047857",
    },
    dark: {
      "--c-bg": "#140a0f", "--c-surface": "#20131a", "--c-surface-2": "#2c1b24",
      "--c-border": "#4a2a39", "--c-text": "#f1dde7", "--c-text-muted": "#c39bac",
      "--c-text-subtle": "#977182", "--c-accent": "#f472b6", "--c-accent-bg": "#4a1130",
      "--c-danger": "#fca5a5", "--c-success": "#6ee7b7",
    },
  },
];

/** The preset for `id`, falling back to the default preset for an unknown/absent id. */
export function getPreset(id: string | undefined): Preset {
  return THEME_PRESETS.find(p => p.id === id) ?? THEME_PRESETS[0];
}

/** The effective token map for one variant: the preset's base layered with the
 *  user's per-variant overrides for the editable tokens. Non-editable and unknown
 *  override keys are ignored, so a malformed map can't change unexpected tokens. */
export function resolveThemeVars(settings: Settings, variant: ThemeVariant): ThemeTokens {
  const base = getPreset(settings.theme_preset)[variant];
  const overrides = (variant === "light" ? settings.theme_colors_light : settings.theme_colors_dark) ?? {};
  const out: ThemeTokens = { ...base };
  for (const tok of EDITABLE_TOKENS) {
    const v = overrides[tok];
    if (typeof v === "string") out[tok] = v;
  }
  return out;
}

/** Whether a variant departs from the stock default (non-default preset or any
 *  override). When false the renderer leaves `tokens.css` untouched. */
export function isVariantCustomized(settings: Settings, variant: ThemeVariant): boolean {
  if ((settings.theme_preset ?? DEFAULT_PRESET_ID) !== DEFAULT_PRESET_ID) return true;
  const overrides = variant === "light" ? settings.theme_colors_light : settings.theme_colors_dark;
  return !!overrides && EDITABLE_TOKENS.some(tok => typeof overrides[tok] === "string");
}

/** Every token name a preset defines — used to clear inline overrides when a
 *  variant reverts to the stock default. */
const ALL_TOKENS = Object.keys(THEME_PRESETS[0].light);

/** The variant to render: an explicit light/dark theme wins; `auto` follows the
 *  OS preference (`prefersDark`). */
export function activeVariant(theme: string, prefersDark: boolean): ThemeVariant {
  if (theme === "light") return "light";
  if (theme === "dark") return "dark";
  return prefersDark ? "dark" : "light";
}

/** Apply the active variant's effective tokens to `el` as inline custom properties,
 *  or clear them when the variant is the stock default (so `tokens.css` stays
 *  authoritative — today's behavior, byte-for-byte). */
export function applyThemeToRoot(el: HTMLElement, settings: Settings, variant: ThemeVariant): void {
  if (isVariantCustomized(settings, variant)) {
    const vars = resolveThemeVars(settings, variant);
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  } else {
    for (const k of ALL_TOKENS) el.style.removeProperty(k);
  }
}
