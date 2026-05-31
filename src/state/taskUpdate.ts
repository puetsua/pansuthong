import { TaskUpdate } from "../lib/tauri";

export type EditorForm = {
  title: string;
  scheduled_date: string;   // "" = none
  due_date: string;         // "" = none
  notes: string;
  tag_ids: string[];
  // Names typed into the tag input that don't exist yet. Held here (not created
  // immediately) so they're only persisted as real tags when the user clicks
  // Save, and discarded on Cancel. Stored lowercased and deduped.
  new_tag_names?: string[];
};

/** Map editor form state to an update_task payload. Empty date => null (clear). */
export function buildTaskUpdate(id: string, form: EditorForm): TaskUpdate {
  return {
    id,
    title: form.title.trim(),
    scheduled_date: form.scheduled_date || null,
    due_date: form.due_date || null,
    notes: form.notes,
    tag_ids: form.tag_ids,
  };
}

/** Order-insensitive equality of two tag-id lists (treated as sets). */
export function sameTagSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/**
 * Whether the editor form differs from its initial snapshot. Tag ids are compared
 * as sets so re-adding a removed tag (which reorders `tag_ids`) is not a false
 * "unsaved change" that triggers a spurious discard prompt (#51).
 */
export function isEditorDirty(form: EditorForm, initial: EditorForm): boolean {
  return form.title !== initial.title
    || form.scheduled_date !== initial.scheduled_date
    || form.due_date !== initial.due_date
    || form.notes !== initial.notes
    || !sameTagSet(form.tag_ids, initial.tag_ids)
    || (form.new_tag_names?.length ?? 0) > 0;
}

/** True when both dates are set and the due date precedes the scheduled date (#51). */
export function dueBeforeScheduled(form: Pick<EditorForm, "scheduled_date" | "due_date">): boolean {
  return !!form.scheduled_date && !!form.due_date && form.due_date < form.scheduled_date;
}
