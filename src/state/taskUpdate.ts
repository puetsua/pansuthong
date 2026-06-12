import { Recurrence, TaskUpdate, TemplateUpdate, YearlyDate } from "../lib/tauri";
import i18n from "../i18n";

export type EditorForm = {
  title: string;
  start_date: string;   // "" = none
  start_time: string;   // "HH:MM"; "" = all-day (only meaningful with start_date) (#93)
  due_date: string;         // "" = none
  due_time: string;         // "HH:MM"; "" = all-day (#93)
  notes: string;
  tag_ids: string[];
  estimated_seconds: string; // duration text; "" = no estimate
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
  // others hold that mode's inputs. ISO weekdays 1=Mon..7=Sun. Monthly takes a
  // comma-separated list of days-of-month; yearly takes a list of month+day pairs.
  repeat: "none" | "weekly" | "monthly" | "daily" | "yearly";
  repeat_weekdays: number[];
  repeat_days: string;        // monthly: comma/space-separated days-of-month, e.g. "1, 15"
  repeat_dates: YearlyDate[]; // yearly: month+day pairs (UI rows)
  recurrence_tag_id: string; // "" = none; the chosen recurrence tag id (#9)
};

/** "" => null (no offset); otherwise the parsed integer, NaN guarded to null. */
function offsetOrNull(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

export function startOffsetDisabled(form: Pick<EditorForm, "repeat" | "recurrence_tag_id">): boolean {
  return form.repeat !== "none" && form.recurrence_tag_id.trim() !== "";
}

export const ESTIMATED_SECONDS_MAX = 100_000 * 60;

function parseIsoDurationSeconds(raw: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(raw);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  if (days == null && hours == null && minutes == null && seconds == null) return null;
  return (Number(days ?? 0) * 86_400)
    + (Number(hours ?? 0) * 3_600)
    + (Number(minutes ?? 0) * 60)
    + Number(seconds ?? 0);
}

function parseUnitDurationSeconds(raw: string): number | null {
  let total = 0;
  let lastIndex = 0;
  const re = /(\d+)\s*([dhms])/gi;
  for (const match of raw.matchAll(re)) {
    const gap = raw.slice(lastIndex, match.index).trim();
    if (gap !== "") return null;
    const n = Number(match[1]);
    const unit = match[2].toLowerCase();
    total += unit === "d" ? n * 86_400
      : unit === "h" ? n * 3_600
      : unit === "m" ? n * 60
      : n;
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  if (lastIndex === 0 || raw.slice(lastIndex).trim() !== "") return null;
  return total;
}

export function parseEstimatedSeconds(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  if (/^\d+$/.test(t)) return Number(t) * 60; // bare numbers preserve the old minutes input.
  if (/^P/i.test(t)) return parseIsoDurationSeconds(t);
  return parseUnitDurationSeconds(t);
}

export function formatEstimatedSecondsInput(seconds: number | undefined): string {
  if (seconds == null) return "";
  const units = [
    ["d", 86_400],
    ["h", 3_600],
    ["m", 60],
    ["s", 1],
  ] as const;
  let remaining = seconds;
  const parts: string[] = [];
  for (const [suffix, size] of units) {
    const n = Math.floor(remaining / size);
    if (n > 0) {
      parts.push(`${n}${suffix}`);
      remaining -= n * size;
    }
  }
  return parts.join(" ");
}

/** "" => null (no estimate); otherwise the parsed duration in seconds. */
function estimatedSecondsOrNull(s: string): number | null {
  return parseEstimatedSeconds(s);
}

/** "" => undefined for create payloads; otherwise the parsed integer. */
export function estimatedSecondsOrUndefined(s: string): number | undefined {
  return estimatedSecondsOrNull(s) ?? undefined;
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
    estimated_seconds: estimatedSecondsOrNull(form.estimated_seconds),
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
    start_offset_days: startOffsetDisabled(form) ? null : offsetOrNull(form.start_offset_days),
    due_offset_days:       offsetOrNull(form.due_offset_days),
    estimated_seconds: estimatedSecondsOrNull(form.estimated_seconds),
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
    || form.estimated_seconds !== initial.estimated_seconds
    || !sameTagSet(form.tag_ids, initial.tag_ids)
    || form.is_template !== initial.is_template
    || form.due_offset_days !== initial.due_offset_days
    || form.start_offset_days !== initial.start_offset_days
    || form.repeat !== initial.repeat
    || form.repeat_days !== initial.repeat_days
    || datesKey(form.repeat_dates) !== datesKey(initial.repeat_dates)
    || form.repeat_weekdays.join(",") !== initial.repeat_weekdays.join(",")
    || form.recurrence_tag_id !== initial.recurrence_tag_id
    || (form.new_tag_names?.length ?? 0) > 0;
}

export function estimatedSecondsFormError(
  form: Pick<EditorForm, "estimated_seconds">,
): string | null {
  const raw = form.estimated_seconds.trim();
  if (raw === "") return null;
  const n = parseEstimatedSeconds(raw);
  if (n == null || !Number.isInteger(n) || n < 1 || n > ESTIMATED_SECONDS_MAX) {
    return i18n.t("taskUpdate.estimatedSecondsRange", { max: "100000m" });
  }
  return null;
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
  form: Pick<EditorForm, "due_offset_days" | "start_offset_days"> & Partial<Pick<EditorForm, "repeat" | "recurrence_tag_id">>,
): string | null {
  const startLocked = form.repeat != null && form.recurrence_tag_id != null
    ? startOffsetDisabled(form as Pick<EditorForm, "repeat" | "recurrence_tag_id">)
    : false;
  for (const [labelKey, raw] of [["taskUpdate.offsetStartLabel", startLocked ? "" : form.start_offset_days], ["taskUpdate.offsetDueLabel", form.due_offset_days]] as const) {
    const t = raw.trim();
    if (t === "") continue;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0 || n > OFFSET_DAYS_MAX) {
      return i18n.t("taskUpdate.offsetRange", { label: i18n.t(labelKey), max: OFFSET_DAYS_MAX });
    }
  }
  const s = startLocked ? "" : form.start_offset_days.trim();
  const d = form.due_offset_days.trim();
  if (s !== "" && d !== "" && Number(d) < Number(s)) {
    return i18n.t("taskUpdate.dueOffsetBeforeStart");
  }
  return null;
}

/** Highest valid day-of-month for a 1-based month; February allows 29 so a yearly
 * Feb-29 date (fires only in leap years) can be entered. */
export function maxDayForMonth(month: number): number {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
}

/** Stable key for a list of month+day pairs, for dirty-checking. */
function datesKey(dates: YearlyDate[]): string {
  return dates.map(d => `${d.month}/${d.day}`).join(",");
}

/** Parse the monthly "days" input into a sorted, de-duplicated day list. Returns
 * null when any token is non-numeric or out of 1..=31 (so an empty/garbage input
 * is treated as invalid rather than silently dropping days). */
function parseMonthlyDays(raw: string): number[] | null {
  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const days = new Set<number>();
  for (const tok of tokens) {
    const n = Number(tok);
    if (!Number.isInteger(n) || n < 1 || n > 31) return null;
    days.add(n);
  }
  return [...days].sort((a, b) => a - b);
}

/** A yearly date is valid when its month is 1..=12 and its day fits that month. */
function validYearlyDate(d: YearlyDate): boolean {
  return Number.isInteger(d.month) && d.month >= 1 && d.month <= 12
    && Number.isInteger(d.day) && d.day >= 1 && d.day <= maxDayForMonth(d.month);
}

/** Build a Recurrence from the editor form, or null when repeat is off/invalid. */
export function recurrenceFromForm(form: EditorForm): Recurrence | null {
  if (form.repeat === "daily") return { kind: "daily" };
  if (form.repeat === "weekly") {
    return form.repeat_weekdays.length ? { kind: "weekly", weekdays: [...form.repeat_weekdays].sort((a, b) => a - b) } : null;
  }
  if (form.repeat === "monthly") {
    const days = parseMonthlyDays(form.repeat_days);
    return days ? { kind: "monthly", days } : null;
  }
  if (form.repeat === "yearly") {
    const dates = form.repeat_dates.filter(validYearlyDate);
    return dates.length && dates.length === form.repeat_dates.length ? { kind: "yearly", dates } : null;
  }
  return null;
}

/** Validation message for the recurrence inputs, or null when valid (#9). */
export function recurrenceFormError(form: EditorForm): string | null {
  if (form.repeat === "none") return null;
  if (form.repeat === "weekly" && form.repeat_weekdays.length === 0) {
    return i18n.t("taskUpdate.pickWeekday");
  }
  if (form.repeat === "monthly") {
    if (parseMonthlyDays(form.repeat_days) === null) {
      return i18n.t("taskUpdate.enterMonthDays");
    }
  }
  if (form.repeat === "yearly") {
    if (form.repeat_dates.length === 0) return i18n.t("taskUpdate.addYearlyDate");
    if (!form.repeat_dates.every(validYearlyDate)) {
      return i18n.t("taskUpdate.yearlyDateNeedsMonthDay");
    }
  }
  if (form.tag_ids.length === 0) {
    return i18n.t("taskUpdate.addTagForRecurrence");
  }
  if (!form.recurrence_tag_id || !form.tag_ids.includes(form.recurrence_tag_id)) {
    return i18n.t("taskUpdate.chooseRecurrenceTag");
  }
  return null;
}
