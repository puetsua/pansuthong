/** The inclusive range a tag's priority weight may take. */
export const WEIGHT_MIN = -9999;
export const WEIGHT_MAX = 9999;

/** Parse a free-typed weight to an integer clamped to the allowed range. */
export function clampWeight(raw: string): number {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, n));
}
