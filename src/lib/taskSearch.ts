import type { Tag, Task } from "./tauri";

/** Case-insensitive substring match on title, notes, or any resolvable tag name.
 *  Empty/whitespace query never matches. Unknown tag ids are ignored. */
export function taskMatchesQuery(
  task: Pick<Task, "title" | "notes" | "tag_ids">,
  query: string,
  tagsById?: Map<string, Pick<Tag, "name">>,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (task.title.toLowerCase().includes(q) || task.notes.toLowerCase().includes(q)) return true;
  if (!tagsById) return false;
  for (const id of task.tag_ids) {
    const name = tagsById.get(id)?.name;
    if (name && name.toLowerCase().includes(q)) return true;
  }
  return false;
}
