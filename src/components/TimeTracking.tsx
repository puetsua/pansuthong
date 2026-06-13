import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, Task, TimeEntry } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { elapsedMs, formatClock, formatDurationShort, isTiming, overlapsExisting } from "../lib/time";
import { estimatedSecondsOrUndefined, formatEstimatedSecondsInput } from "../state/taskUpdate";
import { useNow } from "../lib/useNow";
import { currentLocale } from "../i18n";

type Props = {
  task: Task;
  // The estimate lives in the editor's form so it saves with the task, but it's
  // edited here next to the tracked total (a single source of truth, so the bar
  // recolors live as you type). Omitted in tests that don't exercise it — then it
  // falls back to the saved task's estimate and is effectively read-only.
  estimateInput?: string;
  onEstimateChange?: (value: string) => void;
  estimateError?: string | null;
};

/** "YYYY-MM-DDTHH:MM:SS" in local time for a second-precision datetime-local input.
 *  Seconds are included so the timer's second-level resolution survives a manual edit. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
const fromLocalInput = (s: string): number => new Date(s).getTime();
const entryMs = (s: string): number => Date.parse(s);
/** A finished entry's duration, or 0 while it's still running. */
const durationMs = (e: TimeEntry): number => (e.end != null ? Math.max(0, Date.parse(e.end) - Date.parse(e.start)) : 0);
const fmtMoment = (ms: number): string => new Date(ms).toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "medium" });

type Draft = { start: string; end: string };

/**
 * The task editor's "Time tracked" section (#81): a running total with Start/Stop,
 * a list of recorded sessions, and inline add/edit/delete. Each action calls its
 * command immediately (persisting + emitting store-changed), so edits here aren't
 * tied to the editor's Save — they survive Cancel.
 */
export function TimeTracking({ task, estimateInput, onEstimateChange, estimateError }: Props) {
  const { t } = useTranslation();
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>({ start: "", end: "" });
  const [editingId, setEditingId] = useState<string | null>(null);

  const running = isTiming(task);
  const now = useNow(running);
  const total = elapsedMs(task, now);
  // Drive the estimate off the live form input when wired up, so the bar tracks
  // edits before Save; fall back to the saved task's value otherwise.
  const estimateValue = estimateInput ?? formatEstimatedSecondsInput(task.estimated_seconds);
  const estimateSeconds = estimatedSecondsOrUndefined(estimateValue);
  const estimateMs = estimateSeconds != null ? estimateSeconds * 1_000 : 0;
  // Red signals an *active* overrun: only while the timer is running past the
  // estimate. A stopped task that happens to be over its estimate isn't flagged.
  const over = running && estimateMs > 0 && total >= estimateMs;
  const pct = estimateMs > 0 ? Math.round((total / estimateMs) * 100) : 0;
  const entries = [...(task.time_entries ?? [])].sort((a, b) => entryMs(b.start) - entryMs(a.start));

  const run = (p: Promise<unknown>) => { setErr(null); p.catch(e => setErr(errorMessage(e))); };

  const toggleTimer = () => run(running ? api.stopTimer(task.id) : api.startTimer(task.id));

  const openAdd = () => {
    setEditingId(null);
    // Sample the clock now: `now` only ticks while a timer runs, so it can be stale.
    // Default to a one-minute slot starting now, which the user then adjusts.
    const t = Date.now();
    setDraft({ start: toLocalInput(t), end: toLocalInput(t + 60_000) });
    setAdding(true);
  };
  const submitAdd = () => {
    const start = fromLocalInput(draft.start), end = fromLocalInput(draft.end);
    if (Number.isNaN(start) || Number.isNaN(end)) { setErr(t("timeTracking.errEnterStartEnd")); return; }
    if (end <= start) { setErr(t("timeTracking.errEndAfterStart")); return; }
    if (overlapsExisting(task.time_entries, start, end)) { setErr(t("timeTracking.errOverlap")); return; }
    run(api.addTimeEntry(task.id, start, end).then(() => setAdding(false)));
  };

  const openEdit = (e: TimeEntry) => {
    setAdding(false);
    setEditingId(e.id);
    setDraft({ start: toLocalInput(Date.parse(e.start)), end: e.end != null ? toLocalInput(Date.parse(e.end)) : "" });
  };
  const submitEdit = (e: TimeEntry) => {
    const start = fromLocalInput(draft.start);
    if (Number.isNaN(start)) { setErr(t("timeTracking.errEnterStart")); return; }
    const patch: { start?: number; end?: number } = { start };
    // A closed entry edits both ends; the running entry keeps its open end (null),
    // which the overlap check treats as extending to +∞.
    let candidateEnd: number | null = null;
    if (e.end != null) {
      const end = fromLocalInput(draft.end);
      if (Number.isNaN(end)) { setErr(t("timeTracking.errEnterEnd")); return; }
      if (end <= start) { setErr(t("timeTracking.errEndAfterStart")); return; }
      patch.end = end;
      candidateEnd = end;
    }
    if (overlapsExisting(task.time_entries, start, candidateEnd, e.id)) { setErr(t("timeTracking.errOverlap")); return; }
    run(api.updateTimeEntry(task.id, e.id, patch).then(() => setEditingId(null)));
  };

  const del = (id: string) => run(api.deleteTimeEntry(task.id, id));

  return (
    <section className="te-time">
      <div className="te-time-head">
        <span className="te-field-label">{t("timeTracking.timeTracked")}</span>
        <span className="te-time-total" data-running={running}>
          {running ? formatClock(total) : formatDurationShort(total)}
        </span>
        <label className="te-time-est">
          <span className="te-time-est-label">{t("timeTracking.estLabel")}</span>
          <input type="text" inputMode="text" className="te-time-est-input" data-over={over}
                 aria-label={t("timeTracking.estimateAria")}
                 placeholder={t("taskEditor.estimatedSecondsPlaceholder")}
                 value={estimateValue} readOnly={!onEstimateChange}
                 onChange={e => onEstimateChange?.(e.currentTarget.value)} />
        </label>
        <button type="button" className="te-time-toggle" data-running={running} onClick={toggleTimer}>
          {running ? t("timeTracking.stop") : t("timeTracking.start")}
        </button>
      </div>
      {estimateError && <p className="te-warn" role="alert">{estimateError}</p>}
      {estimateMs > 0 && (
        <div className="te-time-progress">
          <div className="te-time-bar" data-over={over}>
            <div className="te-time-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <span className="te-time-bar-pct" data-over={over}>{pct}%</span>
        </div>
      )}

      {entries.length > 0 && (
        <ul className="te-time-list">
          {entries.map(e => (
            <li key={e.id} className="te-time-entry">
              {editingId === e.id ? (
                <div className="te-time-edit">
                  <input type="datetime-local" step="1" aria-label={t("timeTracking.entryStart")} value={draft.start}
                         onChange={ev => { const v = ev.currentTarget.value; setDraft(d => ({ ...d, start: v })); }} />
                  {e.end != null ? (
                    <input type="datetime-local" step="1" aria-label={t("timeTracking.entryEnd")} value={draft.end}
                           onChange={ev => { const v = ev.currentTarget.value; setDraft(d => ({ ...d, end: v })); }} />
                  ) : (
                    <span className="te-time-running">{t("timeTracking.running")}</span>
                  )}
                  <button type="button" className="te-time-save" onClick={() => submitEdit(e)}>{t("timeTracking.save")}</button>
                  <button type="button" onClick={() => setEditingId(null)}>{t("timeTracking.cancel")}</button>
                </div>
              ) : (
                <>
                  <span className="te-time-range">
                    {fmtMoment(Date.parse(e.start))} – {e.end != null ? fmtMoment(Date.parse(e.end)) : <em>{t("timeTracking.running")}</em>}
                  </span>
                  {e.end != null && <span className="te-time-dur">{formatDurationShort(durationMs(e))}</span>}
                  <button type="button" className="te-time-edit-btn" onClick={() => openEdit(e)}
                          aria-label={t("timeTracking.editEntry")}>{t("timeTracking.edit")}</button>
                  <button type="button" className="te-time-del" onClick={() => del(e.id)}
                          aria-label={t("timeTracking.deleteEntry")}>{t("timeTracking.delete")}</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="te-time-edit">
          <input type="datetime-local" step="1" aria-label={t("timeTracking.newEntryStart")} value={draft.start}
                 onChange={ev => { const v = ev.currentTarget.value; setDraft(d => ({ ...d, start: v })); }} />
          <input type="datetime-local" step="1" aria-label={t("timeTracking.newEntryEnd")} value={draft.end}
                 onChange={ev => { const v = ev.currentTarget.value; setDraft(d => ({ ...d, end: v })); }} />
          <button type="button" className="te-time-save" onClick={submitAdd}>{t("timeTracking.add")}</button>
          <button type="button" onClick={() => setAdding(false)}>{t("timeTracking.cancel")}</button>
        </div>
      ) : (
        <button type="button" className="te-time-add" onClick={openAdd}>{t("timeTracking.addEntry")}</button>
      )}

      {err && <p className="composer-error" role="alert">{err}</p>}
    </section>
  );
}
