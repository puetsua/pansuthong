import { Task, Tag } from "../lib/tauri";
import { api } from "../lib/tauri";

type Props = {
  task: Task;
  tags: Map<string, Tag>;
  todayIso: string;
};

function priColor(p: Task["priority"]): string {
  switch (p) {
    case "high": return "var(--c-pri-high)";
    case "med":  return "var(--c-pri-med)";
    case "low":  return "var(--c-pri-low)";
    default:     return "transparent";
  }
}

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

function diffDays(a: string, b: string): number {
  const da = Date.parse(a), db = Date.parse(b);
  return Math.round((db - da) / 86400000);
}

export function TaskRow({ task, tags, todayIso }: Props) {
  const w = whenLabel(task, todayIso);
  const firstTag = task.tag_ids.length ? tags.get(task.tag_ids[0]) : undefined;

  const toggle = () => {
    api.setTaskDone(task.id, !task.done).catch(err => {
      console.error("setTaskDone failed:", err);
    });
  };
  const remove = () => {
    api.deleteTask(task.id).catch(err => {
      console.error("deleteTask failed:", err);
    });
  };

  return (
    <div className="task-row" data-done={task.done}>
      <span className="task-pri" style={{ background: priColor(task.priority) }} />
      <input type="checkbox" checked={task.done} onChange={toggle} aria-label={`Toggle ${task.title}`} />
      <span className="task-title">{task.title}</span>
      {firstTag && (
        <span className="task-tag" style={{ background: firstTag.color + "22", color: firstTag.color }}>
          {firstTag.name}
        </span>
      )}
      {w.text && <span className={w.late ? "task-when late" : "task-when"}>{w.text}</span>}
      <button className="task-delete" onClick={remove} aria-label={`Delete ${task.title}`}>×</button>
    </div>
  );
}
