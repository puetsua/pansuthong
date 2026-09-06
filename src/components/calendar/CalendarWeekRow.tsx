import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Task, Tag, Settings, isDone } from "../../lib/tauri";
import { chipLabel, isGhostRow } from "../../lib/calendar";
import type { Row } from "../../state/indexes";
import { formatIsoDate, formatTimeOfDay, isOverdue, daysBetweenIso } from "../../lib/dates";
import { currentLocale } from "../../i18n";
import { currentDateFormat, currentTimeFormat } from "../../lib/dates";
import { tagPillStyle } from "../../lib/tagColorDisplay";
import { useThemeVariant } from "../../lib/useThemeVariant";
import { TaskEditor } from "../TaskEditor";

type Props = {
  row: Row;
  tags: Map<string, Tag>;
  todayIso: string;
  settings?: Pick<Settings, "theme">;
};

function rowTags(row: Row, tags: Map<string, Tag>): Tag[] {
  const ids = row.kind === "task" ? row.task.tag_ids : row.ghost.tag_ids;
  return ids
    .map(id => tags.get(id))
    .filter((tag): tag is Tag => tag != null)
    .sort((a, b) => b.priority - a.priority);
}

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

/** Compact week-column row: title + optional when/tags; no checkbox or timer. */
export function CalendarWeekRow({ row, tags, todayIso, settings }: Props) {
  const { t } = useTranslation();
  const theme = useThemeVariant(settings);
  const ghost = isGhostRow(row);
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState<Task | null>(null);
  const when = whenMeta(row, todayIso, t);
  const title = chipLabel(row);
  const taskTags = rowTags(row, tags);

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
        <span className="task-heading calendar-week-row-heading">
          {ghost && <span className="task-recurring" aria-hidden="true">↻</span>}
          <span className="task-title">{title}</span>
        </span>
        {taskTags.map(tag => (
          <span key={tag.id} className="task-tag" style={tagPillStyle(tag.color, theme)}>
            {tag.name}
          </span>
        ))}
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
