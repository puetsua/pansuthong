import { Recurrence, TaskUpdate, TemplateUpdate } from "../lib/tauri";

export type EditorForm = {
  title: string;
  start_date: string;   // "" = none
  start_time: string;   // "HH:MM"; "" = all-day (only meaningful with start_date) (#93)
  due_date: string;         // "" = none
  due_time: string;         // "HH:MM"; "" = all-day (#93)
  notes: string;
  tag_ids: string[];
  // Names typed into the tag input that don't exist yet. Held here (not created
  // immediately) so they're only persisted as real tags when the user clicks
  // Save, and discarded on Cancel. Kept in the typed case and deduped
  // case-insensitively (matching never spawns a case-variant duplicate).
  new_tag_names?: string[];
  // Template fields (#71). When the editor is in template mode it shows
  // relative-offset inputs ("in N days") instead of absolute date pickers; the
  // absolute date fields are then unused (and vice-versa). "" = no offset.
  is_template: boolean;
  due_offset_days: string;
  start_offset_days: string;
  // Recurrence UI state (#9), template mode only. `repeat` picks the mode; the
  // others hold that mode's inputs. ISO weekdays 1=Mon..7=Sun. `repeat_day` is the
  // day-of-month for both monthly and yearly; `repeat_month` is the yearly month.
  repeat: "none" | "weekly" | "monthly" | "daily" | "yearly";
  repeat_weekdays: number[];
  repeat_day: string;   // "" or "1".."31" (monthly + yearly)
  repeat_month: string; // "" or "1".."12" (yearly)
  recurrence_tag_id: string; // "" = none; the chosen recurrence tag id (#9)
};

/** "" => null (no offset); otherwise the parsed integer, NaN guarded to null. */
function offsetOrNull(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Map editor form state to an update_task payload (a normal task: absolute dates,
 * no offsets). Empty date => null (clear). Templates use buildTemplateUpdate.
 */
export function buildTaskUpdate(id: string, form: EditorForm): TaskUpdate {
  return {
    id,
    title: form.title.trim(),
    notes: form.notes,
    tag_ids: form.tag_ids,
    start_date: form.start_date || null,
    // A time is only meaningful with its date; no date => clear the time too (#93).
    start_time: form.start_date && form.start_time ? form.start_time : null,
    due_date:       form.due_date || null,
    due_time:       form.due_date && form.due_time ? form.due_time : null,
  };
}

/**
 * Map editor form state to an update_template payload (relative offsets, no
 * absolute dates and no completion). Empty offset => null (clear).
 */
export function buildTemplateUpdate(id: string, form: EditorForm): TemplateUpdate {
  return {
    id,
    title: form.title.trim(),
    notes: form.notes,
    tag_ids: form.tag_ids,
    start_offset_days: offsetOrNull(form.start_offset_days),
    due_offset_days:       offsetOrNull(form.due_offset_days),
    recurrence: recurrenceFromForm(form),
    recurrence_tag_id: form.repeat !== "none" ? (form.recurrence_tag_id || null) : null,
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
    || form.start_date !== initial.start_date
    || form.start_time !== initial.start_time
    || form.due_date !== initial.due_date
    || form.due_time !== initial.due_time
    || form.notes !== initial.notes
    || !sameTagSet(form.tag_ids, initial.tag_ids)
    || form.is_template !== initial.is_template
    || form.due_offset_days !== initial.due_offset_days
    || form.start_offset_days !== initial.start_offset_days
    || form.repeat !== initial.repeat
    || form.repeat_day !== initial.repeat_day
    || form.repeat_month !== initial.repeat_month
    || form.repeat_weekdays.join(",") !== initial.repeat_weekdays.join(",")
    || form.recurrence_tag_id !== initial.recurrence_tag_id
    || (form.new_tag_names?.length ?? 0) > 0;
}

/** A comparable "date[Ttime]" moment; a missing time counts as start-of-day (#93). */
function moment(date: string, time: string): string {
  return `${date}T${time || "00:00"}`;
}

/**
 * True when both dates are set and the due moment precedes the start moment
 * (#51). Compares to the minute when times are present, and stays equivalent to
 * the old day-only check when both times are empty (#93).
 */
export function dueBeforeStart(
  form: Pick<EditorForm, "start_date" | "start_time" | "due_date" | "due_time">,
): boolean {
  if (!form.start_date || !form.due_date) return false;
  return moment(form.due_date, form.due_time) < moment(form.start_date, form.start_time);
}

/** Upper bound for a template's relative date offset; mirrors the Rust
 * OFFSET_DAYS_MAX in commands.rs (#71). */
export const OFFSET_DAYS_MAX = 3650;

/**
 * Validation message for a template's offset inputs, or null when valid. Bounds each
 * offset to 0..=OFFSET_DAYS_MAX and mirrors the #51 due-before-start guard for
 * relative offsets, so a template can't silently spawn out-of-range or
 * due-before-start tasks. Empty inputs are "no offset" and always valid.
 */
export function offsetFormError(
  form: Pick<EditorForm, "due_offset_days" | "start_offset_days">,
): string | null {
  for (const [label, raw] of [["Start", form.start_offset_days], ["Due", form.due_offset_days]] as const) {
    const t = raw.trim();
    if (t === "") continue;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0 || n > OFFSET_DAYS_MAX) {
      return `${label} offset must be a whole number of days between 0 and ${OFFSET_DAYS_MAX}.`;
    }
  }
  const s = form.start_offset_days.trim();
  const d = form.due_offset_days.trim();
  if (s !== "" && d !== "" && Number(d) < Number(s)) {
    return "Due offset can't be before the start offset.";
  }
  return null;
}

/** Highest valid day-of-month for a 1-based month; February allows 29 so a yearly
 * Feb-29 rule (fires only in leap years) can be entered. */
export function maxDayForMonth(month: number): number {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
}

/** Build a Recurrence from the editor form, or null when repeat is off/invalid. */
export function recurrenceFromForm(form: EditorForm): Recurrence | null {
  if (form.repeat === "daily") return { kind: "daily" };
  if (form.repeat === "weekly") {
    return form.repeat_weekdays.length ? { kind: "weekly", weekdays: [...form.repeat_weekdays].sort((a, b) => a - b) } : null;
  }
  if (form.repeat === "monthly") {
    const day = parseInt(form.repeat_day.trim(), 10);
    return Number.isInteger(day) && day >= 1 && day <= 31 ? { kind: "monthly", day } : null;
  }
  if (form.repeat === "yearly") {
    const month = parseInt(form.repeat_month.trim(), 10);
    const day = parseInt(form.repeat_day.trim(), 10);
    const ok = Number.isInteger(month) && month >= 1 && month <= 12
      && Number.isInteger(day) && day >= 1 && day <= maxDayForMonth(month);
    return ok ? { kind: "yearly", month, day } : null;
  }
  return null;
}

/** Validation message for the recurrence inputs, or null when valid (#9). */
export function recurrenceFormError(form: EditorForm): string | null {
  if (form.repeat === "none") return null;
  if (form.repeat === "weekly" && form.repeat_weekdays.length === 0) {
    return "Pick at least one weekday to repeat on.";
  }
  if (form.repeat === "monthly") {
    const day = parseInt(form.repeat_day.trim(), 10);
    if (!Number.isInteger(day) || day < 1 || day > 31) return "Day of month must be 1-31.";
  }
  if (form.repeat === "yearly") {
    const month = parseInt(form.repeat_month.trim(), 10);
    if (!Number.isInteger(month) || month < 1 || month > 12) return "Pick a month to repeat on.";
    const day = parseInt(form.repeat_day.trim(), 10);
    if (!Number.isInteger(day) || day < 1 || day > maxDayForMonth(month)) {
      return `Day must be 1-${maxDayForMonth(month)} for the chosen month.`;
    }
  }
  if (form.tag_ids.length === 0) {
    return "Add a tag in the Tags field below, then choose it as the recurrence tag.";
  }
  if (!form.recurrence_tag_id || !form.tag_ids.includes(form.recurrence_tag_id)) {
    return "Choose which tag this recurs under.";
  }
  return null;
}
