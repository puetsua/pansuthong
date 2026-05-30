import { TaskUpdate } from "../lib/tauri";

export type EditorForm = {
  title: string;
  scheduled_date: string;   // "" = none
  due_date: string;         // "" = none
  notes: string;
  tag_ids: string[];
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
