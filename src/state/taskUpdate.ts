import { Priority, TaskUpdate } from "../lib/tauri";

export type EditorForm = {
  title: string;
  scheduled_date: string;   // "" = none
  due_date: string;         // "" = none
  priority: "" | Priority;  // "" = none
  notes: string;
  tag_ids: string[];
};

/** Map editor form state to an update_task payload. Empty date/priority => null (clear). */
export function buildTaskUpdate(id: string, form: EditorForm): TaskUpdate {
  return {
    id,
    title: form.title.trim(),
    scheduled_date: form.scheduled_date || null,
    due_date: form.due_date || null,
    priority: form.priority || null,
    notes: form.notes,
    tag_ids: form.tag_ids,
  };
}
