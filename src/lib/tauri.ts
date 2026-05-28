import { invoke } from "@tauri-apps/api/core";

export type Priority = "low" | "med" | "high";

export type Settings = {
  data_file: string | null;
  theme: "auto" | "light" | "dark";
  device_id: string;
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
};

export type Document = {
  version: number;
  settings: Settings;
  projects: Project[];
  tags: Tag[];
  tasks: Task[];
};

export const api = {
  getDocument:   ()                          => invoke<Document>("get_document"),
  addTask:       (input: Partial<Task> & { title: string }) => invoke<Task>("add_task", { input }),
  updateTask:    (input: Partial<Task> & { id: string })    => invoke<Task>("update_task", { input }),
  setTaskDone:   (id: string, done: boolean) => invoke<Task>("set_task_done", { id, done }),
  deleteTask:    (id: string)                => invoke<void>("delete_task", { id }),
  addProject:    (name: string, color: string) => invoke<Project>("add_project", { input: { name, color } }),
  deleteProject: (id: string)                => invoke<void>("delete_project", { id }),
  addTag:        (name: string, color: string, project_id?: string) =>
                                                invoke<Tag>("add_tag", { input: { name, color, project_id } }),
  deleteTag:     (id: string)                => invoke<void>("delete_tag", { id }),
};
