import { Task, Tag } from "../lib/tauri";
import { TaskRow } from "./TaskRow";

type Props = {
  tasks: Task[];
  tags: Map<string, Tag>;
  todayIso: string;
  emptyText?: string;
};

export function TaskList({ tasks, tags, todayIso, emptyText = "Nothing here." }: Props) {
  if (tasks.length === 0) return <p className="task-empty">{emptyText}</p>;
  return (
    <div>
      {tasks.map(t => <TaskRow key={t.id} task={t} tags={tags} todayIso={todayIso} />)}
    </div>
  );
}
