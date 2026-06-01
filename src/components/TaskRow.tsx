import { useState } from "react";
import { Task, Tag, isDone } from "../lib/tauri";
import { api } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { TaskEditor } from "./TaskEditor";

type Props = {
  task: Task;
  tags: Map<string, Tag>;
  todayIso: string;
  // Archived view: show a single "Restore" action instead of the done-checkbox.
  archived?: boolean;
};

function whenLabel(t: Task, today: string): { text: string; late: boolean } {
  if (t.due_date) {
    if (t.due_date === today)       return { text: "due today", late: false };
    if (t.due_date < today && !isDone(t)) return { text: `−${diffDays(t.due_date, today)}d`, late: true };
    return { text: `due ${t.due_date.slice(5)}`, late: false };
  }
  if (t.scheduled_date === today) return { text: "today", late: false };
  if (t.scheduled_date)           return { text: t.scheduled_date.slice(5), late: false };
  return { text: "", late: false };
}

function diffDays(a: string, b: string): number {
  const da = Date.parse(a), db = Date.parse(b);
  return Math.round((db - da) / 86400000);
}

export function TaskRow({ task, tags, todayIso, archived = false }: Props) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const w = whenLabel(task, todayIso);
  // All of the task's tags as chips, highest-weight (priority) first.
  const taskTags = task.tag_ids
    .map(id => tags.get(id))
    .filter((t): t is Tag => t !== undefined)
    .sort((a, b) => b.priority - a.priority);

  const toggle = () => {
    setError(null);
    api.setTaskDone(task.id, !isDone(task)).catch(err => {
      // The checkbox reflects the persisted completion state, so it stays put on
      // failure; surface the error so the user knows the change didn't stick.
      setError(errorMessage(err));
    });
  };

  // Restore = clear completion, which un-archives the task (completion and
  // archival are the same `completed_at` state now). Always clears (not a toggle)
  // so it also rescues any legacy task that loaded as archived (#23).
  const restore = () => {
    setError(null);
    api.setTaskDone(task.id, false).catch(err => setError(errorMessage(err)));
  };

  const open = () => setEditing(true);

  return (
    <>
      <div className="task-row" data-done={isDone(task)}>
        <button type="button" className="task-main" onClick={open}
                aria-label={`Edit ${task.title}`}>
          <span className="task-title">{task.title}</span>
          {taskTags.map(t => (
            <span key={t.id} className="task-tag" style={{ background: t.color + "22", color: t.color }}>
              {t.name}
            </span>
          ))}
          {w.text && <span className={w.late ? "task-when late" : "task-when"}>{w.text}</span>}
        </button>
        {archived ? (
          <button type="button" className="task-restore" onClick={restore}
                  aria-label={`Restore ${task.title}`}>
            Restore
          </button>
        ) : (
          <input type="checkbox" checked={isDone(task)} onChange={toggle}
                 aria-label={`Toggle ${task.title}`} />
        )}
      </div>
      {error && <p className="composer-error" role="alert">Couldn’t update: {error}</p>}
      {editing && <TaskEditor task={task} allTags={tags} onClose={() => setEditing(false)} />}
    </>
  );
}
