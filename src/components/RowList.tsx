import { useTranslation } from "react-i18next";
import { Tag } from "../lib/tauri";
import { Row } from "../state/indexes";
import { TaskRow } from "./TaskRow";
import { GhostRow } from "./GhostRow";

type Props = {
  rows: Row[];
  tags: Map<string, Tag>;
  todayIso: string;
  emptyText?: string;
  // Forwarded to task rows so a view can hold a just-completed task for recovery (#recover).
  onCompleted?: (id: string) => void;
  onReopened?: (id: string) => void;
};

/** Renders a merged task/ghost sequence (#9): real tasks and computed recurring
 *  ghosts interleaved in one sorted list, so a ghost shows where its promoted task
 *  would sit. */
export function RowList({ rows, tags, todayIso, emptyText, onCompleted, onReopened }: Props) {
  const { t } = useTranslation();
  if (rows.length === 0) return <p className="task-empty">{emptyText ?? t("taskList.empty")}</p>;
  return (
    <div>
      {rows.map(row => row.kind === "ghost"
        ? <GhostRow key={row.ghost.id} ghost={row.ghost} tags={tags} />
        : <TaskRow key={row.task.id} task={row.task} tags={tags} todayIso={todayIso}
                   onCompleted={onCompleted} onReopened={onReopened} />)}
    </div>
  );
}
