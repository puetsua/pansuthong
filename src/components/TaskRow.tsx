import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Task, Tag, isDone } from "../lib/tauri";
import { api } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { readableTextColor } from "../lib/tags";
import { elapsedMs, formatClock, formatDurationShort, isTiming } from "../lib/time";
import { useNow } from "../lib/useNow";
import { playCompletionSound } from "../lib/sound";
import { TaskEditor } from "./TaskEditor";
import { currentDateFormat, currentTimeFormat, formatIsoDate, formatTimeOfDay } from "../lib/dates";
import { currentLocale } from "../i18n";

type Props = {
  task: Task;
  tags: Map<string, Tag>;
  todayIso: string;
  // Archived view: show a single "Restore" action instead of the done-checkbox.
  archived?: boolean;
  // Notified after a successful toggle so a view can keep a just-completed task
  // visible (for recovery) and drop it again on reopen (#recover).
  onCompleted?: (id: string) => void;
  onReopened?: (id: string) => void;
};

function whenLabel(task: Task, today: string, t: TFunction): { text: string; late: boolean } {
  const locale = currentLocale();
  const dateFmt = currentDateFormat();
  const timeFmt = currentTimeFormat();
  // A trailing " HH:MM" when the field carries a time, else "" (all-day) (#93).
  const dueT = task.due_time ? ` ${formatTimeOfDay(task.due_time, timeFmt, locale)}` : "";
  const schedT = task.start_time ? ` ${formatTimeOfDay(task.start_time, timeFmt, locale)}` : "";
  if (task.due_date) {
    if (task.due_date === today)       return { text: t("taskRow.dueToday", { time: dueT }), late: false };
    if (task.due_date < today && !isDone(task)) return { text: t("taskRow.overdue", { days: diffDays(task.due_date, today) }), late: true };
    return { text: t("taskRow.due", { date: formatIsoDate(task.due_date, dateFmt, locale), time: dueT }), late: false };
  }
  if (task.start_date === today) return { text: t("taskRow.today", { time: schedT }), late: false };
  if (task.start_date)           return { text: t("taskRow.scheduled", { date: formatIsoDate(task.start_date, dateFmt, locale), time: schedT }), late: false };
  return { text: "", late: false };
}

function diffDays(a: string, b: string): number {
  const da = Date.parse(a), db = Date.parse(b);
  return Math.round((db - da) / 86400000);
}

export function TaskRow({ task, tags, todayIso, archived = false, onCompleted, onReopened }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const w = whenLabel(task, todayIso, t);
  // All of the task's tags as chips, highest-weight (priority) first.
  const taskTags = task.tag_ids
    .map(id => tags.get(id))
    .filter((t): t is Tag => t !== undefined)
    .sort((a, b) => b.priority - a.priority);

  const toggle = () => {
    setError(null);
    const next = !isDone(task);
    api.setTaskDone(task.id, next)
      .then(() => {
        if (next) { playCompletionSound(); onCompleted?.(task.id); } // chime on done (#80)
        else onReopened?.(task.id);
      })
      .catch(err => {
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

  // Time tracking (#81): tick once a second only while this task's timer runs.
  const running = isTiming(task);
  const now = useNow(running);
  const total = elapsedMs(task, now);
  // Estimate progress (#81): a thin bar along the row when an estimate is set.
  const estimateMs = task.estimated_seconds != null ? task.estimated_seconds * 1_000 : 0;
  const progressPct = estimateMs > 0 ? Math.round((total / estimateMs) * 100) : 0;
  // Red only signals an active overrun (running past the estimate); a stopped task
  // sitting over its estimate shows a full accent bar, not a red one (#81).
  const overEstimate = running && estimateMs > 0 && total >= estimateMs;
  const toggleTimer = () => {
    setError(null);
    (running ? api.stopTimer(task.id) : api.startTimer(task.id))
      .catch(err => setError(errorMessage(err)));
  };

  return (
    <>
      <div className="task-row" data-done={isDone(task)} data-timing={running}>
        <button type="button" className="task-main" onClick={open}
                aria-label={t("taskRow.edit", { title: task.title })}>
          <span className="task-title">{task.title}</span>
          {taskTags.map(t => (
            <span key={t.id} className="task-tag" style={{ background: t.color, color: readableTextColor(t.color) }}>
              {t.name}
            </span>
          ))}
          {w.text && <span className={w.late ? "task-when late" : "task-when"}>{w.text}</span>}
        </button>
        {archived ? (
          <>
            {total > 0 && <span className="task-timer-total" title={t("taskRow.timeTrackedTitle")}>{formatDurationShort(total)}</span>}
            <button type="button" className="task-restore" onClick={restore}
                    aria-label={t("taskRow.restoreAria", { title: task.title })}>
              {t("taskRow.restore")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="task-timer" data-running={running} onClick={toggleTimer}
                    aria-label={running ? t("taskRow.stopTimer", { title: task.title }) : t("taskRow.startTimer", { title: task.title })}
                    title={running ? t("taskRow.stopTimerTitle") : t("taskRow.startTimerTitle")}>
              <span className="task-timer-icon" aria-hidden>{running ? "■" : "▶"}</span>
              {(running || total > 0) && (
                <span className="task-timer-time">{running ? formatClock(total) : formatDurationShort(total)}</span>
              )}
            </button>
            <input type="checkbox" checked={isDone(task)} onChange={toggle}
                   aria-label={t("taskRow.toggle", { title: task.title })} />
          </>
        )}
        {estimateMs > 0 && (
          <div className="task-row-progress" data-over={overEstimate}
               title={t("taskRow.progressTitle", { pct: progressPct })}>
            <div className="task-row-progress-fill" style={{ width: `${Math.min(100, progressPct)}%` }} />
          </div>
        )}
      </div>
      {error && <p className="composer-error" role="alert">{t("taskRow.updateError", { error })}</p>}
      {editing && <TaskEditor task={task} allTags={tags} onClose={() => setEditing(false)} />}
    </>
  );
}
