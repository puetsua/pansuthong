import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Task, Tag, isDone } from "../../lib/tauri";
import { chipLabel, isGhostRow } from "../../lib/calendar";
import type { Row } from "../../state/indexes";
import { formatIsoDate, formatTimeOfDay, isOverdue, daysBetweenIso } from "../../lib/dates";
import { currentLocale } from "../../i18n";
import { currentDateFormat, currentTimeFormat } from "../../lib/dates";
import { TaskEditor } from "../TaskEditor";

type Props = {
  row: Row;
  tags: Map<string, Tag>;
  todayIso: string;
};

function whenMeta(row: Row, todayIso: string, t: TFunction): { text: string; late: boolean } | null {
  if (row.kind !== "task") return null;
  const task = row.task;
  const locale = currentLocale();
  const dateFmt = currentDateFormat();
  const timeFmt = currentTimeFormat();
  const dueT = task.due_time ? ` ${formatTimeOfDay(task.due_time, timeFmt, locale)}` : "";
  const schedT = task.start_time ? ` ${formatTimeOfDay(task.start_time, timeFmt, locale)}` : "";
  if (task.due_date === todayIso) return { text: t("taskRow.dueToday", { time: dueT }).trim(), late: false };
  if (task.due_date && isOverdue(task.due_date, todayIso, isDone(task))) {
    return { text: t("taskRow.overdue", { days: daysBetweenIso(task.due_date, todayIso) }), late: true };
  }
  if (task.due_date) {
    return { text: t("taskRow.due", { date: formatIsoDate(task.due_date, dateFmt, locale), time: dueT }), late: false };
  }
  if (task.start_date === todayIso) return { text: t("taskRow.today", { time: schedT }).trim(), late: false };
  if (task.start_date) {
    return { text: t("taskRow.scheduled", { date: formatIsoDate(task.start_date, dateFmt, locale), time: schedT }), late: false };
  }
  return null;
}

/** Compact week-column row: title + optional when; no checkbox, timer, or tags. */
export function CalendarWeekRow({ row, tags, todayIso }: Props) {
  const { t } = useTranslation();
  const ghost = isGhostRow(row);
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState<Task | null>(null);
  const when = whenMeta(row, todayIso, t);
  const title = chipLabel(row);

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

  return (
    <>
      <button
        type="button"
        className={`calendar-week-row${ghost ? " calendar-week-row-ghost" : ""}`}
        onClick={open}
        aria-label={t("taskRow.edit", { title })}
      >
        <span className="calendar-line-clip">
          <span className="calendar-line-prefix">
            {ghost && <span className="task-recurring" aria-hidden="true">↻</span>}
          </span>
          <span className="calendar-week-row-title">{title}</span>
        </span>
        {when?.text && (
          <span className={when.late ? "task-when late" : "task-when"}>{when.text}</span>
        )}
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
