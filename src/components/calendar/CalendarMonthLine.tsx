import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Task, Tag } from "../../lib/tauri";
import { chipLabel, isGhostRow } from "../../lib/calendar";
import type { Row } from "../../state/indexes";
import { TaskEditor } from "../TaskEditor";

type Props = {
  row: Row;
  tags: Map<string, Tag>;
};

/** Neutral truncated task line for a month grid cell; opens the task editor on click. */
export function CalendarMonthLine({ row, tags }: Props) {
  const { t } = useTranslation();
  const ghost = isGhostRow(row);
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState<Task | null>(null);

  const open = () => {
    if (row.kind === "task") setEditing(row.task);
    else {
      const g = row.ghost;
      setCreating({
        id: "",
        title: g.title,
        notes: g.notes,
        tag_ids: g.tag_ids,
        start_date: g.occurrenceDate,
        due_date: g.due_date,
        created_at: "",
      });
    }
  };

  const title = chipLabel(row);

  return (
    <>
      <button
        type="button"
        className={`calendar-month-line${ghost ? " calendar-month-line-ghost" : ""}`}
        onClick={open}
        aria-label={t("taskRow.edit", { title })}
      >
        {ghost && <span className="task-recurring" aria-hidden="true">↻</span>}
        <span className="calendar-month-line-title">{title}</span>
      </button>
      {editing && (
        <TaskEditor task={editing} allTags={tags} onClose={() => setEditing(null)} />
      )}
      {creating && (
        <TaskEditor task={creating} allTags={tags} creating onClose={() => setCreating(null)} />
      )}
    </>
  );
}
