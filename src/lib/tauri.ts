import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type SortOrder = "priority" | "date";

export type Settings = {
  theme: "auto" | "light" | "dark";
  sort_order: SortOrder;
  upcoming_days?: number; // how many days ahead Upcoming looks; 1..365, default 14
  default_tag_color?: string;    // color pre-filled for a new tag; hex, default "#10b981" (#79)
  default_tag_priority?: number; // weight pre-filled for a new tag; -9999..9999, default 0 (#79)
};

export type Tag = {
  id: string;
  name: string;
  color: string;
  priority: number; // weight; -9999..9999. A task's priority = max weight of its tags.
  pinned?: boolean; // shown in the curated sidebar tag list; absent = false (#78)
};

export type Task = {
  id: string;
  title: string;
  due_date?: string;       // YYYY-MM-DD
  scheduled_date?: string; // YYYY-MM-DD
  notes: string;
  tag_ids: string[];
  created_at: string; // ISO-8601 local time w/ offset, e.g. 2026-06-01T20:34:56+08:00
  // ISO-8601 instant (local time w/ offset) the task was completed. The single
  // source of truth for completion AND archival: set = done and hidden from the
  // active views; absent = active. Derive with isDone(t) / isArchived(t). Merged
  // the former done/archived/archived_at fields (#23).
  completed_at?: string;
  updated_at?: string; // ISO-8601 local time w/ offset of last edit; omitted for pre-existing tasks
};

/** A task is done — equivalently, archived — iff it carries a completion timestamp. */
export function isDone(t: Task): boolean { return t.completed_at != null; }
/** A task is archived (hidden from the active views) iff it is done. */
export function isArchived(t: Task): boolean { return t.completed_at != null; }

/**
 * A reusable blueprint, stored in its own `Document.template_tasks` list — separate
 * from active tasks (#71). Carries relative date offsets (resolved to absolute
 * dates when a task is spawned from it) instead of completion or absolute dates.
 */
export type TemplateTask = {
  id: string;
  title: string;
  notes: string;
  tag_ids: string[];
  created_at: string; // ISO-8601 local time w/ offset
  updated_at?: string; // ISO-8601 local time w/ offset of last edit; omitted if never edited
  due_offset_days?: number;       // spawned task's due = today + N days
  scheduled_offset_days?: number; // spawned task's scheduled = today + M days
};

export type Document = {
  version: number;
  last_modified?: string; // ISO-8601 local time w/ offset of last edit; omitted if never edited
  settings: Settings;
  tags: Tag[];
  tasks: Task[];
  template_tasks: TemplateTask[];
};

// `null` clears an optional field; an omitted key leaves it unchanged.
export type TaskUpdate = {
  id: string;
  title?: string;
  due_date?: string | null;
  scheduled_date?: string | null;
  notes?: string;
  tag_ids?: string[];
};

export type NewTemplate = {
  title: string;
  notes?: string;
  tag_ids?: string[];
  due_offset_days?: number;
  scheduled_offset_days?: number;
};

// `null` clears an optional offset; an omitted key leaves the field unchanged.
export type TemplateUpdate = {
  id: string;
  title?: string;
  notes?: string;
  tag_ids?: string[];
  due_offset_days?: number | null;
  scheduled_offset_days?: number | null;
};

export type DataLocation = { folder: string | null; effective_path: string };

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
  /** Force an immediate re-read of tasks.json from disk; returns the freshest doc. */
  syncNow:       ()                          => invoke<Document>("sync_now"),
  addTask:       (input: Partial<Task> & { title: string }) => invoke<Task>("add_task", { input }),
  updateTask:    (input: TaskUpdate)                         => invoke<Task>("update_task", { input }),
  setTaskDone:   (id: string, done: boolean) => invoke<Task>("set_task_done", { id, done }),
  deleteTask:    (id: string)                => invoke<void>("delete_task", { id }),
  addTemplate:    (input: NewTemplate)    => invoke<TemplateTask>("add_template", { input }),
  updateTemplate: (input: TemplateUpdate) => invoke<TemplateTask>("update_template", { input }),
  deleteTemplate: (id: string)            => invoke<void>("delete_template", { id }),
  addTag:        (name: string, color: string, priority = 0, pinned = false) =>
                                                invoke<Tag>("add_tag", { input: { name, color, priority, pinned } }),
  deleteTag:     (id: string)                => invoke<void>("delete_tag", { id }),
  searchTasks:     (query: string) => invoke<Task[]>("search_tasks", { query }),
  updateTag:       (input: { id: string; name?: string; color?: string; priority?: number; pinned?: boolean }) =>
                                     invoke<Tag>("update_tag", { input }),
  updateSettings: (input: { theme?: "auto" | "light" | "dark"; sort_order?: SortOrder; upcoming_days?: number;
                            default_tag_color?: string; default_tag_priority?: number }) =>
                                   invoke<void>("update_settings", { input }),
  listConflicts:    ()             => invoke<string[]>("list_conflicts"),
  readConflict:     (path: string) => invoke<TaskDiff[]>("read_conflict", { conflictPath: path }),
  resolveConflict:  (path: string, decisions: Decision[]) =>
                                      invoke<void>("resolve_conflict",
                                        { input: { conflict_path: path, decisions } }),
  dismissConflict:  (path: string) => invoke<void>("dismiss_conflict", { conflictPath: path }),
  getDataLocation: () => invoke<DataLocation>("get_data_location"),
  clearDataFolder: () => invoke<DataLocation>("clear_data_folder"),
  /** Opens the OS folder picker; on a selection, repoints tasks.json into it. Returns null if cancelled. */
  pickAndSetDataFolder: async (): Promise<DataLocation | null> => {
    const dir = await open({ directory: true, multiple: false, title: "Choose a sync folder" });
    if (typeof dir !== "string") return null;
    return invoke<DataLocation>("set_data_folder", { folder: dir });
  },
  // Android SAF folder sync (#Phase 4B). On desktop these resolve to inert stubs.
  safPickFolder:  () => invoke<SyncStatus>("saf_pick_folder"),
  safClearFolder: () => invoke<void>("saf_clear_folder"),
  safPush:        () => invoke<SyncStatus>("saf_push"),
  safSyncNow:     () => invoke<SyncStatus>("saf_sync_now"),
  safStatus:      () => invoke<SyncStatus>("saf_status"),
};
