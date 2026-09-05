import type { CSSProperties } from "react";
import type { ThemeVariant } from "./themes";

export type TagColorDisplay = { bg: string; fg: string; border: string };

const PAGE_LIGHT = "#f6f8fa";
const PAGE_DARK = "#0d1117";

const NEAR_WHITE: Record<ThemeVariant, TagColorDisplay> = {
  light: { bg: "#ffffff", fg: "#1f2328", border: "rgba(31,35,40,0.55)" },
  dark: { bg: "rgba(240,243,246,0.10)", fg: "#f0f3f6", border: "rgba(240,243,246,0.7)" },
};

const NEAR_BLACK: Record<ThemeVariant, TagColorDisplay> = {
  light: { bg: "rgba(31,35,40,0.08)", fg: "#1f2328", border: "rgba(31,35,40,0.55)" },
  dark: { bg: "rgba(110,118,129,0.10)", fg: "#8b949e", border: "rgba(110,118,129,0.35)" },
};

const HASH_NEAR_WHITE = { light: "#656d76", dark: "#f0f3f6" } as const;
const HASH_NEAR_BLACK = { light: "#1f2328", dark: "#6e7681" } as const;

const TARGET_CONTRAST = 4.5;
const BG_ALPHA = { light: 0.12, dark: 0.15 } as const;

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

function parseHex(hex: string): Rgb | null {
  const raw = hex.trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.replace(/./g, c => c + c) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const c = (n: number) => n.toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const n = c / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: Rgb | string, b: Rgb | string): number {
  const toRgb = (v: Rgb | string) => (typeof v === "string" ? parseHex(v) ?? { r: 0, g: 0, b: 0 } : v);
  const l1 = relativeLuminance(toRgb(a));
  const l2 = relativeLuminance(toRgb(b));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function isNearWhite(hsl: Hsl): boolean {
  return hsl.l > 0.92 && hsl.s < 0.12;
}

function isNearBlack(hsl: Hsl): boolean {
  return hsl.l < 0.08;
}

function isVividYellow(hsl: Hsl): boolean {
  return hsl.s >= 0.85 && hsl.h >= 0.11 && hsl.h <= 0.19;
}

function softBg(rgb: Rgb, theme: ThemeVariant): string {
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${BG_ALPHA[theme]})`;
}

function pageRgb(theme: ThemeVariant): Rgb {
  return parseHex(theme === "light" ? PAGE_LIGHT : PAGE_DARK)!;
}

function fgForContrast(hsl: Hsl, theme: ThemeVariant): string {
  const page = pageRgb(theme);
  const preserveSat = theme === "light" && isVividYellow(hsl);
  let s = hsl.s;
  if (preserveSat) s = Math.max(s, 0.95);

  const step = theme === "light" ? -0.01 : 0.01;
  const minL = 0.05;
  const maxL = 0.95;
  let l = hsl.l;

  if (theme === "light") {
    l = Math.min(l, 0.55);
    while (l >= minL) {
      const fg = rgbToHex(hslToRgb({ h: hsl.h, s, l }));
      if (contrastRatio(fg, page) >= TARGET_CONTRAST) return fg;
      l += step;
    }
  } else {
    l = Math.max(l, 0.45);
    while (l <= maxL) {
      const fg = rgbToHex(hslToRgb({ h: hsl.h, s, l }));
      if (contrastRatio(fg, page) >= TARGET_CONTRAST) return fg;
      l += step;
    }
  }

  return rgbToHex(hslToRgb({ h: hsl.h, s, l: theme === "light" ? minL : maxL }));
}

/** Normalize a stored tag hex into soft pill colors for the active theme. */
export function normalizeTagColor(hex: string, theme: ThemeVariant): TagColorDisplay {
  const rgb = parseHex(hex);
  if (!rgb) {
    const fallback = theme === "light" ? NEAR_BLACK.light : NEAR_BLACK.dark;
    return { ...fallback };
  }

  const hsl = rgbToHsl(rgb);
  if (isNearWhite(hsl)) return { ...NEAR_WHITE[theme] };
  if (isNearBlack(hsl)) return { ...NEAR_BLACK[theme] };

  const fg = fgForContrast(hsl, theme);
  return {
    bg: softBg(rgb, theme),
    fg,
    border: fg,
  };
}

/** Sidebar / heading `#` tint derived from the same rules as tag pills. */
export function normalizeTagHashColor(hex: string, theme: ThemeVariant): string {
  const rgb = parseHex(hex);
  if (!rgb) return HASH_NEAR_BLACK[theme];
  const hsl = rgbToHsl(rgb);
  if (isNearWhite(hsl)) return HASH_NEAR_WHITE[theme];
  if (isNearBlack(hsl)) return HASH_NEAR_BLACK[theme];
  return normalizeTagColor(hex, theme).fg;
}

/** Inline styles for a bordered soft tag pill. */
export function tagPillStyle(hex: string, theme: ThemeVariant): CSSProperties {
  const { bg, fg, border } = normalizeTagColor(hex, theme);
  return { background: bg, color: fg, border: `1px solid ${border}` };
}

/** Test helpers */
export const _tagColorDisplayTest = {
  parseHex,
  rgbToHsl,
  contrastRatio,
  isNearWhite,
  isNearBlack,
  PAGE_LIGHT,
  PAGE_DARK,
};
