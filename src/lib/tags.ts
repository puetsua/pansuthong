/** The inclusive range a tag's priority weight may take. */
export const WEIGHT_MIN = -9999;
export const WEIGHT_MAX = 9999;

/** Parse a free-typed weight to an integer clamped to the allowed range. */
export function clampWeight(raw: string): number {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, n));
}

/**
 * Pick black or white text for legibility on a solid `bg` fill, so a chip
 * stays readable whatever the tag color is. Accepts `#rgb`/`#rrggbb` (the only
 * shapes the color picker produces); anything unparseable falls back to white.
 */
export function readableTextColor(bg: string): "#000000" | "#ffffff" {
  const hex = bg.trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.replace(/./g, c => c + c) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Perceived brightness (YIQ); >=140 reads as a light fill that needs dark text.
  return (r * 299 + g * 587 + b * 114) / 1000 >= 140 ? "#000000" : "#ffffff";
}
