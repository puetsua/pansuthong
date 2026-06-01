import { useState } from "react";
import { Task, Tag } from "../lib/tauri";
import { api } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { addDaysIso } from "../lib/dates";
import { TaskEditor } from "./TaskEditor";

type Props = {
  task: Task;
  tags: Map<string, Tag>;
  todayIso: string;
  // Archived view: show a single "Restore" action instead of the done-checkbox.
  archived?: boolean;
  // Templates view: show a "New task" action instead of the done-checkbox, and
  // summarise the relative date offsets instead of absolute dates.
  template?: boolean;
};

function whenLabel(t: Task, today: string): { text: string; late: boolean } {
  if (t.due_date) {
    if (t.due_date === today)       return { text: "due today", late: false };
    if (t.due_date < today && !t.done) return { text: `−${diffDays(t.due_date, today)}d`, late: true };
    return { text: `due ${t.due_date.slice(5)}`, late: false };
  }
  if (t.scheduled_date === today) return { text: "today", late: false };
  if (t.scheduled_date)           return { text: t.scheduled_date.slice(5), late: false };
  return { text: "", late: false };
}

/** Compact summary of a template's relative offsets, e.g. "start +0d · due +3d". */
function offsetLabel(t: Task): string {
  const parts: string[] = [];
  if (t.scheduled_offset_days != null) parts.push(`start +${t.scheduled_offset_days}d`);
  if (t.due_offset_days != null)       parts.push(`due +${t.due_offset_days}d`);
  return parts.join(" · ");
}

function diffDays(a: string, b: string): number {
  const da = Date.parse(a), db = Date.parse(b);
  return Math.round((db - da) / 86400000);
}

export function TaskRow({ task, tags, todayIso, archived = false, template = false }: Props) {
  const [editing, setEditing] = useState(false);
  // A draft task pre-filled from this template, shown in the editor so the user can
  // finish it before it's actually created (#71). null = not creating.
  const [creatingDraft, setCreatingDraft] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const w = whenLabel(task, todayIso);
  // All of the task's tags as chips, highest-weight (priority) first.
  const taskTags = task.tag_ids
    .map(id => tags.get(id))
    .filter((t): t is Tag => t !== undefined)
    .sort((a, b) => b.priority - a.priority);

  const toggle = () => {
    setError(null);
    api.setTaskDone(task.id, !task.done).catch(err => {
      // The checkbox reflects the persisted `task.done`, so it stays put on
      // failure; surface the error so the user knows the change didn't stick.
      setError(errorMessage(err));
    });
  };

  // Restore = clear `done`, which un-archives via the done↔archived coupling.
  // Always sets done=false (not a toggle) so it also rescues legacy tasks that
  // were archived while still incomplete (done already false) (#23).
  const restore = () => {
    setError(null);
    api.setTaskDone(task.id, false).catch(err => setError(errorMessage(err)));
  };

  // Build a draft task from this template (relative offsets resolved to absolute
  // dates: today + offset) and open the editor so the user can finish it before it
  // is created (#71). Creation happens on the editor's "Add task".
  const newFromTemplate = () => {
    setError(null);
    setCreatingDraft({
      ...task,
      id: "",
      is_template: false,
      due_offset_days: undefined,
      scheduled_offset_days: undefined,
      due_date: task.due_offset_days != null ? addDaysIso(todayIso, task.due_offset_days) : undefined,
      scheduled_date: task.scheduled_offset_days != null ? addDaysIso(todayIso, task.scheduled_offset_days) : undefined,
      done: false,
      completed_at: undefined,
      archived: false,
      archived_at: undefined,
    });
  };

  const open = () => setEditing(true);

  return (
    <>
      <div className="task-row" data-done={task.done}>
        <button type="button" className="task-main" onClick={open}
                aria-label={`Edit ${task.title}`}>
          <span className="task-title">{task.title}</span>
          {taskTags.map(t => (
            <span key={t.id} className="task-tag" style={{ background: t.color + "22", color: t.color }}>
              {t.name}
            </span>
          ))}
          {template
            ? offsetLabel(task) && <span className="task-when">{offsetLabel(task)}</span>
            : w.text && <span className={w.late ? "task-when late" : "task-when"}>{w.text}</span>}
        </button>
        {template ? (
          <button type="button" className="task-restore" onClick={newFromTemplate}
                  aria-label={`New task from ${task.title}`}>
            New task
          </button>
        ) : archived ? (
          <button type="button" className="task-restore" onClick={restore}
                  aria-label={`Restore ${task.title}`}>
            Restore
          </button>
        ) : (
          <input type="checkbox" checked={task.done} onChange={toggle}
                 aria-label={`Toggle ${task.title}`} />
        )}
      </div>
      {error && <p className="composer-error" role="alert">Couldn’t update: {error}</p>}
      {editing && <TaskEditor task={task} allTags={tags} onClose={() => setEditing(false)} />}
      {creatingDraft && (
        <TaskEditor task={creatingDraft} allTags={tags} creating onClose={() => setCreatingDraft(null)} />
      )}
    </>
  );
}
