import { Tag } from "../lib/tauri";
import { defaultTagColor } from "../lib/settings";

/**
 * Resolve parsed #tag names to tag IDs, creating any that don't exist yet.
 * Tag matching is case-insensitive; a newly created tag keeps the case the
 * user typed. New tags use `color` (the active theme background); pass
 * `api.addTag` so this stays unit-testable without the Tauri bridge.
 */
export async function resolveTagIds(
  tagNames: string[],
  tagsByName: Map<string, Tag>,
  addTag: (name: string, color: string) => Promise<Tag>,
  color: string = defaultTagColor(),
): Promise<string[]> {
  const ids: string[] = [];
  for (const name of tagNames) {
    const key = name.toLowerCase();
    const existing = tagsByName.get(key);
    if (existing) {
      ids.push(existing.id);
    } else {
      const created = await addTag(name, color);
      ids.push(created.id);
    }
  }
  return ids;
}
