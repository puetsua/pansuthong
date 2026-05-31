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
  // Template fields (#71). When is_template, the editor shows relative-offset
  // inputs ("in N days") instead of absolute date pickers; "" = no offset.
  is_template: boolean;
  due_offset_days: string;
  scheduled_offset_days: string;
};

/** "" => null (no offset); otherwise the parsed integer, NaN guarded to null. */
function offsetOrNull(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Map editor form state to an update_task payload. A template carries relative
 * offsets and no absolute dates; a normal task is the reverse. Whichever kind the
 * form isn't gets cleared (null) so toggling template ↔ task never leaves stale
 * values of the other kind behind. Empty date/offset => null (clear).
 */
export function buildTaskUpdate(id: string, form: EditorForm): TaskUpdate {
  return {
    id,
    title: form.title.trim(),
    notes: form.notes,
    tag_ids: form.tag_ids,
    is_template: form.is_template,
    scheduled_date: form.is_template ? null : (form.scheduled_date || null),
    due_date:       form.is_template ? null : (form.due_date || null),
    scheduled_offset_days: form.is_template ? offsetOrNull(form.scheduled_offset_days) : null,
    due_offset_days:       form.is_template ? offsetOrNull(form.due_offset_days) : null,
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
    || form.is_template !== initial.is_template
    || form.due_offset_days !== initial.due_offset_days
    || form.scheduled_offset_days !== initial.scheduled_offset_days
    || (form.new_tag_names?.length ?? 0) > 0;
}

/** True when both dates are set and the due date precedes the scheduled date (#51). */
export function dueBeforeScheduled(form: Pick<EditorForm, "scheduled_date" | "due_date">): boolean {
  return !!form.scheduled_date && !!form.due_date && form.due_date < form.scheduled_date;
}

/** Upper bound for a template's relative date offset; mirrors the Rust
 * OFFSET_DAYS_MAX in commands.rs (#71). */
export const OFFSET_DAYS_MAX = 3650;

/**
 * Validation message for a template's offset inputs, or null when valid. Bounds each
 * offset to 0..=OFFSET_DAYS_MAX and mirrors the #51 due-before-scheduled guard for
 * relative offsets, so a template can't silently spawn out-of-range or
 * due-before-scheduled tasks. Empty inputs are "no offset" and always valid.
 */
export function offsetFormError(
  form: Pick<EditorForm, "due_offset_days" | "scheduled_offset_days">,
): string | null {
  for (const [label, raw] of [["Scheduled", form.scheduled_offset_days], ["Due", form.due_offset_days]] as const) {
    const t = raw.trim();
    if (t === "") continue;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0 || n > OFFSET_DAYS_MAX) {
      return `${label} offset must be a whole number of days between 0 and ${OFFSET_DAYS_MAX}.`;
    }
  }
  const s = form.scheduled_offset_days.trim();
  const d = form.due_offset_days.trim();
  if (s !== "" && d !== "" && Number(d) < Number(s)) {
    return "Due offset can't be before the scheduled offset.";
  }
  return null;
}
