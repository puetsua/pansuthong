import { Tag } from "../lib/tauri";

/**
 * Built-in palette for auto-created tags. Every color is dark enough that the
 * chip's auto-contrast text resolves to white (see readableTextColor), so an
 * auto-created tag's chip is legible from the start.
 */
export const TAG_PALETTE = [
  "#4338ca", "#059669", "#b45309", "#dc2626",
  "#0891b2", "#9333ea", "#db2777", "#4d7c0f",
];

/** Deterministic palette color from a seed string (stable per tag name). */
export function pickPaletteColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}

/**
 * Resolve parsed #tag names to tag IDs, creating any that don't exist yet.
 * Tag matching is case-insensitive; a newly created tag keeps the case the
 * user typed (its palette color is seeded from the lowercased name so case
 * variants would map to the same color). `addTag` is injected (pass
 * `api.addTag`) so this stays unit-testable without the Tauri bridge.
 */
export async function resolveTagIds(
  tagNames: string[],
  tagsByName: Map<string, Tag>,
  addTag: (name: string, color: string) => Promise<Tag>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const name of tagNames) {
    const key = name.toLowerCase();
    const existing = tagsByName.get(key);
    if (existing) {
      ids.push(existing.id);
    } else {
      const created = await addTag(name, pickPaletteColor(key));
      ids.push(created.id);
    }
  }
  return ids;
}
