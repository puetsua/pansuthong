import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Task, Tag, Settings, isDone } from "../../lib/tauri";
import { chipLabel, isGhostRow } from "../../lib/calendar";
import type { Row } from "../../state/indexes";
import { formatIsoDate, formatTimeOfDay, isOverdue } from "../../lib/dates";
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

function metaLine(row: Row, todayIso: string, tags: Map<string, Tag>, t: TFunction): string {
  const parts: string[] = [];
  if (row.kind === "task") {
    const task = row.task;
    for (const id of task.tag_ids) {
      const tag = tags.get(id);
      if (tag) parts.push(tag.name);
    }
    const locale = currentLocale();
    const dateFmt = currentDateFormat();
    const timeFmt = currentTimeFormat();
    const dueT = task.due_time ? formatTimeOfDay(task.due_time, timeFmt, locale) : "";
    const schedT = task.start_time ? formatTimeOfDay(task.start_time, timeFmt, locale) : "";
    if (task.due_date === todayIso) parts.push(t("taskRow.dueToday", { time: dueT }).trim());
    else if (task.due_date && isOverdue(task.due_date, todayIso, isDone(task))) {
      parts.push(t("taskRow.overdue", { days: 0 }).replace(/\s*0\s*/, " ").trim());
    } else if (task.due_date) {
      parts.push(formatIsoDate(task.due_date, dateFmt, locale) + dueT);
    } else if (task.start_date === todayIso) parts.push(t("taskRow.today", { time: schedT }).trim());
    else if (task.start_date) {
      parts.push(formatIsoDate(task.start_date, dateFmt, locale) + schedT);
    }
  } else if (row.kind === "ghost") {
    for (const id of row.ghost.tag_ids) {
      const tag = tags.get(id);
      if (tag) parts.push(tag.name);
    }
    parts.push(t("calendar.recurringShort"));
  }
  return parts.filter(Boolean).join(" · ");
}

/** Compact week-column row: title + optional meta; no checkbox or timer. */
export function CalendarWeekRow({ row, tags, todayIso, settings }: Props) {
  const { t } = useTranslation();
  const theme = useThemeVariant(settings);
  const ghost = isGhostRow(row);
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState<Task | null>(null);
  const meta = metaLine(row, todayIso, tags, t);
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
        <span className="calendar-week-row-title">
          {ghost && <span className="task-recurring" aria-hidden="true">↻</span>}
          {title}
        </span>
        {meta && <span className="calendar-week-row-meta">{meta}</span>}
        {row.kind === "task" && row.task.tag_ids.length > 0 && (
          <span className="calendar-week-row-tags">
            {row.task.tag_ids
              .map(id => tags.get(id))
              .filter((tag): tag is Tag => tag != null)
              .sort((a, b) => b.priority - a.priority)
              .map(tag => (
                <span key={tag.id} className="task-tag" style={tagPillStyle(tag.color, theme)}>
                  {tag.name}
                </span>
              ))}
          </span>
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
