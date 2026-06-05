import { useTranslation } from "react-i18next";
import { Task, Tag } from "../lib/tauri";
import { TaskRow } from "./TaskRow";

type Props = {
  tasks: Task[];
  tags: Map<string, Tag>;
  todayIso: string;
  emptyText?: string;
  // Render rows in Archived mode (a "Restore" action instead of a done-checkbox).
  archived?: boolean;
  // Forwarded to each row so a view can hold a just-completed task for recovery (#recover).
  onCompleted?: (id: string) => void;
  onReopened?: (id: string) => void;
};

export function TaskList({ tasks, tags, todayIso, emptyText, archived = false,
                           onCompleted, onReopened }: Props) {
  const { t } = useTranslation();
  if (tasks.length === 0) return <p className="task-empty">{emptyText ?? t("taskList.empty")}</p>;
  return (
    <div>
      {tasks.map(t => <TaskRow key={t.id} task={t} tags={tags} todayIso={todayIso} archived={archived}
                               onCompleted={onCompleted} onReopened={onReopened} />)}
    </div>
  );
}
