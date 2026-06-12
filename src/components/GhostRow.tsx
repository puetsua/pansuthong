import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, Tag, Task } from "../lib/tauri";
import { GhostTask } from "../lib/recurrence";
import { errorMessage } from "../lib/errors";
import { readableTextColor } from "../lib/tags";
import { TaskEditor } from "./TaskEditor";

type Props = {
  ghost: GhostTask;
  tags: Map<string, Tag>;
};

/**
 * A computed recurring-template occurrence (#9). It is not a real task until the
 * user interacts: any action first promotes it via spawn_recurring_task, then
 * applies the action to the returned task. The de-emphasised styling + the
 * recurrence marker distinguish it from real rows.
 */
export function GhostRow({ ghost, tags }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState<Task | null>(null);

  const ghostTags = ghost.tag_ids
    .map(id => tags.get(id))
    .filter((t): t is Tag => t !== undefined)
    .sort((a, b) => b.priority - a.priority);

  const run = (after: (t: Task) => Promise<unknown> | void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    api.spawnRecurringTask(ghost.templateId, ghost.occurrenceDate)
      .then(async t => { await after(t); })
      .catch(err => { setError(errorMessage(err)); setBusy(false); });
    // On success the store refreshes (store-changed) and this ghost disappears, so
    // there's no need to clear `busy` in the happy path — the row unmounts.
  };

  const complete = () => run(t => api.setTaskDone(t.id, true));

  // Open the editor on a DRAFT (not yet persisted) pre-filled from this occurrence,
  // mirroring TemplateRow's "New task from template". Nothing is created until the
  // user hits Save (addTask), so the row stays mounted while the editor is open;
  // the saved task then carries the template's tag + occurrence start_date and
  // suppresses this ghost on the next refresh. (Spawning here would unmount the row
  // mid-edit and close the editor.)
  const open = () => {
    setCreatingDraft({
      id: "",
      title: ghost.title,
      notes: ghost.notes,
      tag_ids: ghost.tag_ids,
      start_date: ghost.occurrenceDate,
      due_date: ghost.due_date,
      created_at: "",
      completed_at: undefined,
    });
  };

  const startTimer = () => run(t => api.startTimer(t.id));

  return (
    <>
      <div className="task-row ghost-row" data-ghost="true">
        <button type="button" className="task-main" onClick={open} disabled={busy}
                aria-label={t("ghostRow.open", { title: ghost.title })}>
          <span className="ghost-mark" aria-hidden>🔁</span>
          <span className="task-title">{ghost.title}</span>
          {ghostTags.map(t => (
            <span key={t.id} className="task-tag" style={{ background: t.color, color: readableTextColor(t.color) }}>
              {t.name}
            </span>
          ))}
        </button>
        <button type="button" className="task-timer" onClick={startTimer} disabled={busy}
                aria-label={t("ghostRow.startTimer", { title: ghost.title })} title={t("ghostRow.startTimerTitle")}>
          <span className="task-timer-icon" aria-hidden>▶</span>
        </button>
        <input type="checkbox" checked={false} onChange={complete} disabled={busy}
               aria-label={t("ghostRow.complete", { title: ghost.title })} />
      </div>
      {error && <p className="composer-error" role="alert">{t("ghostRow.addError", { error })}</p>}
      {creatingDraft && (
        <TaskEditor task={creatingDraft} allTags={tags} creating onClose={() => setCreatingDraft(null)} />
      )}
    </>
  );
}
