import { useTranslation } from "react-i18next";
import { Task, Tag, Settings } from "../lib/tauri";
import { TaskRow } from "./TaskRow";

type Props = {
  tasks: Task[];
  tags: Map<string, Tag>;
  todayIso: string;
  settings?: Pick<Settings, "theme">;
  emptyText?: string;
  // Render rows in Archived mode (a "Restore" action instead of a done-checkbox).
  archived?: boolean;
  // Forwarded to each row so a view can hold a just-completed task for recovery (#recover).
  onCompleted?: (id: string) => void;
  onReopened?: (id: string) => void;
  onTimerStarted?: () => void;
};

export function TaskList({ tasks, tags, todayIso, settings, emptyText, archived = false,
                           onCompleted, onReopened, onTimerStarted }: Props) {
  const { t } = useTranslation();
  if (tasks.length === 0) return <p className="task-empty">{emptyText ?? t("taskList.empty")}</p>;
  return (
    <div>
      {tasks.map(t => <TaskRow key={t.id} task={t} tags={tags} todayIso={todayIso} settings={settings} archived={archived}
                               onCompleted={onCompleted} onReopened={onReopened}
                               onTimerStarted={onTimerStarted} />)}
    </div>
  );
}
