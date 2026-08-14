import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { DateFormat, DateTimeFormat, TimeFormat } from "./dates";
import { isAndroid } from "./platform";

export type { DateFormat, DateTimeFormat, TimeFormat };

export type SortOrder = "priority" | "date";

export type Settings = {
  theme: "auto" | "light" | "dark";
  sort_order: SortOrder;
  upcoming_days?: number; // how many days ahead Upcoming looks; 1..365, default 14
  day_start_hour?: number; // hour the logical day rolls over; 0..23, default 0 (midnight)
  default_tag_color?: string;    // color pre-filled for a new tag; hex, default "#10b981" (#79)
  default_tag_priority?: number; // weight pre-filled for a new tag; -9999..9999, default 0 (#79)
  language?: "auto" | "en" | "zh-TW"; // UI language; "auto" follows the OS locale, default (#26)
  sound_on_complete?: boolean; // play a sound when a task is marked done; default true (#80)
  reminder_interval_minutes?: number; // re-notify cadence for tasks past their estimate; 1..1440, default 1
  max_attachment_mb?: number; // largest attachment in MiB; 1..10240, default 1024 (1 GiB) (#113)
  date_time_format?: DateTimeFormat; // legacy date-time display preset; default "locale"
  recurrence_heatmap_days?: number; // Dashboard/Tag heatmap range (days back); 7..365, default 90; key kept for BC
  first_day_of_week?: number; // heatmap week-start weekday; 0=Sun..6=Sat, default 1 (Monday)
  date_format?: DateFormat; // date display preset; default "locale"
  time_format?: TimeFormat; // time display preset; default "locale"
  // Theme customization (#15). The frontend owns preset/token semantics; Rust stores
  // these opaquely. Absent = built-in default preset, no customs.
  theme_preset?: string; // active preset id (built-in or custom); default "default"
  custom_presets?: ThemePreset[]; // user-defined, device-local named themes
};

/** A user-defined theme (#15): a full light + dark token set, keyed by CSS custom
 *  property name (e.g. "--c-accent") -> hex. Imported/exported as JSON. */
export type ThemePreset = {
  id: string;
  name: string;
  light: Record<string, string>;
  dark: Record<string, string>;
};

export type Tag = {
  id: string;
  name: string;
  color: string;
  priority: number; // weight; -9999..9999. A task's priority = max weight of its tags.
  pinned?: boolean; // shown in the curated sidebar tag list; absent = false (#78)
  updated_at?: string; // ISO-8601 local time w/ offset of last tag edit; omitted for older tags
  dashboard_view?: DashboardView; // which view this tag is pinned to on the Dashboard; absent = not pinned (#dashboard)
};

/**
 * One time-tracking session on a task (#81), as READ from the backend: `start`/`end`
 * are ISO-8601 local-time strings with an offset (the Rust side normalizes any legacy
 * on-disk epoch-ms to ISO before sending). `end` absent = the running timer (open
 * interval); present = a finished session.
 *
 * Note the write-side asymmetry: `api.addTimeEntry`/`updateTimeEntry` take epoch
 * MILLIS (numbers), which Rust converts on the way in. So this entity is strings,
 * but manual-entry inputs are numbers — they are deliberately different shapes.
 */
export type TimeEntry = {
  id: string;
  start: string;
  end?: string;
};

export type Attachment = {
  id: string;
  name: string;
  path: string;
  mime_type?: string;
  size?: number;
  created_at: string;
};

export type Task = {
  id: string;
  title: string;
  due_date?: string;       // YYYY-MM-DD
  due_time?: string;       // "HH:MM" local; companion to due_date, absent = all-day (#93)
  start_date?: string; // YYYY-MM-DD
  start_time?: string; // "HH:MM" local; companion to start_date, absent = all-day (#93)
  notes: string;
  attachments?: Attachment[];
  tag_ids: string[];
  estimated_seconds?: number; // whole seconds of expected effort; absent = no estimate
  created_at: string; // ISO-8601 local time w/ offset, e.g. 2026-06-01T20:34:56+08:00
  // ISO-8601 instant (local time w/ offset) the task was completed. The single
  // source of truth for completion AND archival: set = done and hidden from the
  // active views; absent = active. Derive with isDone(t) / isArchived(t). Merged
  // the former done/archived/archived_at fields (#23).
  completed_at?: string;
  updated_at?: string; // ISO-8601 local time w/ offset of last edit; omitted for pre-existing tasks
  time_entries?: TimeEntry[]; // recorded time-tracking sessions (#81); absent = none tracked
};

/** A task is done — equivalently, archived — iff it carries a completion timestamp. */
export function isDone(t: Task): boolean { return t.completed_at != null; }
/** A task is archived (hidden from the active views) iff it is done. */
export function isArchived(t: Task): boolean { return t.completed_at != null; }

/** A template's recurrence schedule (#9). Weekday numbers are ISO 1=Mon..7=Sun. */
export type YearlyDate = { month: number; day: number }; // month 1-12 + day-of-month

export type Recurrence =
  | { kind: "weekly"; weekdays: number[] }   // fires on each listed ISO weekday
  | { kind: "monthly"; days: number[] }      // fires on each listed day-of-month, clamps to month end
  | { kind: "daily" }                        // fires every day
  | { kind: "yearly"; dates: YearlyDate[] }; // fires on each listed month+day; skips Feb 29 in non-leap years

/**
 * A reusable blueprint, stored in its own `Document.template_tasks` list — separate
 * from active tasks (#71). Carries relative date offsets (resolved to absolute
 * dates when a task is spawned from it) instead of completion or absolute dates.
 */
export type TemplateTask = {
  id: string;
  title: string;
  notes: string;
  attachments?: Attachment[];
  tag_ids: string[];
  created_at: string; // ISO-8601 local time w/ offset
  updated_at?: string; // ISO-8601 local time w/ offset of last edit; omitted if never edited
  due_offset_days?: number;       // spawned task's due = today + N days
  start_offset_days?: number; // spawned task's start date = today + M days
  estimated_seconds?: number; // spawned task's expected effort; absent = no estimate
  recurrence?: Recurrence; // #9; absent = manual-only template
  recurrence_tag_id?: string; // #9 which tag the recurrence is keyed to (one of tag_ids)
  recurrence_start_date?: string; // YYYY-MM-DD; earliest occurrence date
  dashboard_view?: DashboardView; // absent = not pinned to the Dashboard
};

/** How a pinned recurring template renders on the Dashboard (#dashboard). */
export type DashboardView = "heatmap" | "streak";

export type Document = {
  version: number;
  last_modified?: string; // ISO-8601 local time w/ offset of last edit; omitted if never edited
  settings: Settings;
  tags: Tag[];
  tasks: Task[];
  template_tasks: TemplateTask[];
};

export type HistoryEntry = {
  timestamp: string;
  event: string;
  entity: "task" | "tag" | "template";
  entity_id: string;
  title: string;
  summary: string;
  device_id?: string | null;
  device_name?: string | null;
  dedup_key?: string | null;
};

// `null` clears an optional field; an omitted key leaves it unchanged.
export type TaskUpdate = {
  id: string;
  title?: string;
  due_date?: string | null;
  due_time?: string | null;
  start_date?: string | null;
  start_time?: string | null;
  notes?: string;
  attachments?: Attachment[];
  tag_ids?: string[];
  estimated_seconds?: number | null;
};

export type NewTemplate = {
  title: string;
  notes?: string;
  attachments?: Attachment[];
  tag_ids?: string[];
  due_offset_days?: number;
  start_offset_days?: number;
  estimated_seconds?: number;
  recurrence?: Recurrence | null;
  recurrence_tag_id?: string | null;
  recurrence_start_date?: string | null; // YYYY-MM-DD; earliest occurrence date
  dashboard_view?: DashboardView | null;
};

// `null` clears an optional offset; an omitted key leaves the field unchanged.
export type TemplateUpdate = {
  id: string;
  title?: string;
  notes?: string;
  attachments?: Attachment[];
  tag_ids?: string[];
  due_offset_days?: number | null;
  start_offset_days?: number | null;
  estimated_seconds?: number | null;
  recurrence?: Recurrence | null; // null clears the schedule; omitted leaves it
  recurrence_tag_id?: string | null;
  recurrence_start_date?: string | null; // null clears the start clip; omitted leaves it
  dashboard_view?: DashboardView | null; // null unpins; omitted leaves it
};

export type DataLocation = {
  folder: string | null;
  device_id: string;
  folder_path: string;
  effective_path: string;
};

/** How to handle this device's owned payload when changing the data folder. */
export type TransferMode = "copy" | "move";

export type TaskDiff =
  | { kind: "differs";     id: string; mine: Task;   theirs: Task }
  | { kind: "only_mine";   id: string; mine: Task }
  | { kind: "only_theirs"; id: string; theirs: Task };

export type Decision =
  | { action: "keep_mine";   id: string }
  | { action: "keep_theirs"; id: string }
  | { action: "keep_both";   id: string }
  | { action: "drop";        id: string };

/** Android folder-sync status surfaced in Settings (#Phase 4B). */
export type SyncStatus = {
  linked: boolean;
  folder_label: string | null;
  permission_ok: boolean;
  last_synced_ms: number | null;
  last_error: string | null;
  conflict_count: number;
};

export const api = {
  getDocument:   ()                          => invoke<Document>("get_document"),
  tryOpenData:   ()                          => invoke<boolean>("try_open_data"),
  showMainWindow: ()                         => invoke<void>("show_main_window"),
  listHistory:   ()                          => invoke<HistoryEntry[]>("list_history"),
  addTask:       (input: Partial<Task> & { title: string }) => invoke<Task>("add_task", { input }),
  updateTask:    (input: TaskUpdate)                         => invoke<Task>("update_task", { input }),
  // `paths` lets a drag-drop hand the files straight in; without it, desktop
  // opens a picker and Android uses the SAF picker command.
  attachTaskFiles: async (id: string, paths?: string[]): Promise<Task | null> => {
    if (paths) return paths.length ? invoke<Task>("attach_task_files", { input: { id, paths } }) : null;
    if (await isAndroid()) return invoke<Task | null>("pick_task_attachments", { id });
    const selected = await open({ multiple: true, directory: false, title: "Attach files" });
    const picked = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
    if (picked.length === 0) return null;
    return invoke<Task>("attach_task_files", { input: { id, paths: picked } });
  },
  attachTemplateFiles: async (id: string, paths?: string[]): Promise<TemplateTask | null> => {
    if (paths) return paths.length ? invoke<TemplateTask>("attach_template_files", { input: { id, paths } }) : null;
    if (await isAndroid()) return invoke<TemplateTask | null>("pick_template_attachments", { id });
    const selected = await open({ multiple: true, directory: false, title: "Attach files" });
    const picked = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
    if (picked.length === 0) return null;
    return invoke<TemplateTask>("attach_template_files", { input: { id, paths: picked } });
  },
  removeTaskAttachment: (id: string, attachmentId: string) =>
    invoke<Task>("remove_task_attachment", { input: { id, attachment_id: attachmentId } }),
  removeTemplateAttachment: (id: string, attachmentId: string) =>
    invoke<TemplateTask>("remove_template_attachment", { input: { id, attachment_id: attachmentId } }),
  // Read an attachment blob's bytes and hand back an object URL for display.
  // Bytes come over IPC (not the asset protocol), so previews render regardless
  // of the data folder's path form (non-ASCII, cloud reparse points). The caller
  // owns the returned URL and MUST revokeObjectURL it when done to avoid a leak.
  attachmentUrl: async (path: string): Promise<string> => {
    const bytes = await invoke<ArrayBuffer>("read_attachment", { path });
    return URL.createObjectURL(new Blob([bytes]));
  },
  // Persist pasted/dropped in-memory content (clipboard image, or a file the
  // webview only has as bytes) as a managed attachment. Returns the updated
  // entity; the caller diffs its attachments to find the freshly-added one.
  attachTaskBytes: (id: string, name: string, mimeType: string | null, bytes: Uint8Array) =>
    invoke<Task>("attach_task_bytes", { input: { id, name, mime_type: mimeType, bytes: Array.from(bytes) } }),
  attachTemplateBytes: (id: string, name: string, mimeType: string | null, bytes: Uint8Array) =>
    invoke<TemplateTask>("attach_template_bytes", { input: { id, name, mime_type: mimeType, bytes: Array.from(bytes) } }),
  /** Reveal an attachment in the OS file manager (desktop); opens it on mobile. */
  revealAttachment: (path: string) => invoke<void>("reveal_attachment", { path }),
  /** Open an attachment in its default application. */
  openAttachment:   (path: string) => invoke<void>("open_attachment", { path }),
  setTaskDone:   (id: string, done: boolean) => invoke<Task>("set_task_done", { id, done }),
  duplicateTask: (id: string)                => invoke<Task>("duplicate_task", { id }),
  deleteTask:    (id: string)                => invoke<void>("delete_task", { id }),
  // Time tracking (#81). Each returns the updated task. start/stop are no-ops when
  // already in that state; manual entry times are epoch millis.
  startTimer:      (id: string) => invoke<Task>("start_timer", { id }),
  stopTimer:       (id: string) => invoke<Task>("stop_timer", { id }),
  addTimeEntry:    (taskId: string, start: number, end: number) =>
                                   invoke<Task>("add_time_entry", { input: { task_id: taskId, start, end } }),
  updateTimeEntry: (taskId: string, entryId: string, patch: { start?: number; end?: number }) =>
                                   invoke<Task>("update_time_entry", { input: { task_id: taskId, entry_id: entryId, ...patch } }),
  deleteTimeEntry: (taskId: string, entryId: string) =>
                                   invoke<Task>("delete_time_entry", { input: { task_id: taskId, entry_id: entryId } }),
  addTemplate:    (input: NewTemplate)    => invoke<TemplateTask>("add_template", { input }),
  updateTemplate: (input: TemplateUpdate) => invoke<TemplateTask>("update_template", { input }),
  duplicateTemplate: (id: string)         => invoke<TemplateTask>("duplicate_template", { id }),
  deleteTemplate: (id: string)            => invoke<void>("delete_template", { id }),
  spawnRecurringTask: (templateId: string, occurrenceDate: string) =>
                                   invoke<Task>("spawn_recurring_task", { input: { templateId, occurrenceDate } }),
  addTag:        (name: string, color: string, priority = 0, pinned = false) =>
                                                invoke<Tag>("add_tag", { input: { name, color, priority, pinned } }),
  deleteTag:     (id: string)                => invoke<void>("delete_tag", { id }),
  updateTag:       (input: { id: string; name?: string; color?: string; priority?: number; pinned?: boolean; dashboard_view?: DashboardView | null }) =>
                                     invoke<Tag>("update_tag", { input }),
  // Any subset of settings; the Rust side merges the provided keys. Typed as
  // Partial<Settings> so a new setting added to Settings is accepted here
  // automatically instead of silently dropping off this hand-maintained list.
  updateSettings: (input: Partial<Settings>) => invoke<void>("update_settings", { input }),
  listConflicts:    ()             => invoke<string[]>("list_conflicts"),
  readConflict:     (path: string) => invoke<TaskDiff[]>("read_conflict", { conflictPath: path }),
  resolveConflict:  (path: string, decisions: Decision[]) =>
                                      invoke<void>("resolve_conflict",
                                        { input: { conflict_path: path, decisions } }),
  dismissConflict:  (path: string) => invoke<void>("dismiss_conflict", { conflictPath: path }),
  getDataLocation: () => invoke<DataLocation>("get_data_location"),
  /** Opens the OS folder picker; returns the chosen path, or null if cancelled. */
  pickDataFolder: async (): Promise<string | null> => {
    const dir = await open({ directory: true, multiple: false, title: "Choose a sync folder" });
    return typeof dir === "string" ? dir : null;
  },
  setDataFolder: (folder: string, transferMode: TransferMode) =>
    invoke<DataLocation>("set_data_folder", { folder, transferMode }),
  clearDataFolder: (transferMode: TransferMode) =>
    invoke<DataLocation>("clear_data_folder", { transferMode }),
  /** Opens the OS folder picker; on a selection, repoints with the given transfer mode. Returns null if cancelled. */
  pickAndSetDataFolder: async (transferMode: TransferMode): Promise<DataLocation | null> => {
    const dir = await open({ directory: true, multiple: false, title: "Choose a sync folder" });
    if (typeof dir !== "string") return null;
    return invoke<DataLocation>("set_data_folder", { folder: dir, transferMode });
  },
  // Android SAF folder sync (#Phase 4B). On desktop these resolve to inert stubs.
  safPickFolder:  () => invoke<SyncStatus>("saf_pick_folder"),
  safClearFolder: () => invoke<void>("saf_clear_folder"),
  safPush:        () => invoke<SyncStatus>("saf_push"),
  safSyncNow:     () => invoke<SyncStatus>("saf_sync_now"),
  safStatus:      () => invoke<SyncStatus>("saf_status"),
};
