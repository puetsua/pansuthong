import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type Priority = "low" | "med" | "high";

export type Settings = {
  theme: "auto" | "light" | "dark";
};

export type Project = { id: string; name: string; color: string };

export type Tag = {
  id: string;
  name: string;
  color: string;
  project_id?: string;
};

export type Task = {
  id: string;
  title: string;
  done: boolean;
  due_date?: string;       // YYYY-MM-DD
  scheduled_date?: string; // YYYY-MM-DD
  priority?: Priority;
  notes: string;
  tag_ids: string[];
  created_at: number;
  completed_at?: number;
  updated_at: number; // epoch ms of last edit (0 for pre-existing tasks)
};

export type Document = {
  version: number;
  last_modified: number; // epoch ms of last edit to the document (0 if never)
  settings: Settings;
  projects: Project[];
  tags: Tag[];
  tasks: Task[];
};

// `null` clears an optional field; an omitted key leaves it unchanged.
export type TaskUpdate = {
  id: string;
  title?: string;
  due_date?: string | null;
  scheduled_date?: string | null;
  priority?: Priority | null;
  notes?: string;
  tag_ids?: string[];
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

export const api = {
  getDocument:   ()                          => invoke<Document>("get_document"),
  /** Force an immediate re-read of tasks.json from disk; returns the freshest doc. */
  syncNow:       ()                          => invoke<Document>("sync_now"),
  addTask:       (input: Partial<Task> & { title: string }) => invoke<Task>("add_task", { input }),
  updateTask:    (input: TaskUpdate)                         => invoke<Task>("update_task", { input }),
  setTaskDone:   (id: string, done: boolean) => invoke<Task>("set_task_done", { id, done }),
  deleteTask:    (id: string)                => invoke<void>("delete_task", { id }),
  addProject:    (name: string, color: string) => invoke<Project>("add_project", { input: { name, color } }),
  deleteProject: (id: string)                => invoke<void>("delete_project", { id }),
  addTag:        (name: string, color: string, project_id?: string) =>
                                                invoke<Tag>("add_tag", { input: { name, color, project_id } }),
  deleteTag:     (id: string)                => invoke<void>("delete_tag", { id }),
  parseComposer:   (input: string) => invoke<{
    title: string;
    tag_names: string[];
    due_date?: string;
    scheduled_date?: string;
    priority?: Priority;
  }>("parse_composer", { input }),
  searchTasks:     (query: string) => invoke<Task[]>("search_tasks", { query }),
  updateProject:   (input: { id: string; name?: string; color?: string }) =>
                                     invoke<Project>("update_project", { input }),
  updateTag:       (input: { id: string; name?: string; color?: string; project_id?: string }) =>
                                     invoke<Tag>("update_tag", { input }),
  clearTagProject: (id: string)   => invoke<Tag>("clear_tag_project", { id }),
  updateSettings: (input: { theme?: "auto" | "light" | "dark" }) =>
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
};
