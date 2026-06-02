import { useState } from "react";
import { api, Task, TimeEntry } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { elapsedMs, formatClock, formatDurationShort, isTiming } from "../lib/time";
import { useNow } from "../lib/useNow";

type Props = { task: Task };

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
const fmtMoment = (ms: number): string => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" });

type Draft = { start: string; end: string };

/**
 * The task editor's "Time tracked" section (#81): a running total with Start/Stop,
 * a list of recorded sessions, and inline add/edit/delete. Each action calls its
 * command immediately (persisting + emitting store-changed), so edits here aren't
 * tied to the editor's Save — they survive Cancel.
 */
export function TimeTracking({ task }: Props) {
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>({ start: "", end: "" });
  const [editingId, setEditingId] = useState<string | null>(null);

  const running = isTiming(task);
  const now = useNow(running);
  const total = elapsedMs(task, now);
  const entries = [...(task.time_entries ?? [])].sort((a, b) => entryMs(b.start) - entryMs(a.start));

  const run = (p: Promise<unknown>) => { setErr(null); p.catch(e => setErr(errorMessage(e))); };

  const toggleTimer = () => run(running ? api.stopTimer(task.id) : api.startTimer(task.id));

  const openAdd = () => {
    setEditingId(null);
    setDraft({ start: toLocalInput(now - 30 * 60_000), end: toLocalInput(now) });
    setAdding(true);
  };
  const submitAdd = () => {
    const start = fromLocalInput(draft.start), end = fromLocalInput(draft.end);
    if (Number.isNaN(start) || Number.isNaN(end)) { setErr("Enter a start and end time."); return; }
    if (end <= start) { setErr("End must be after start."); return; }
    run(api.addTimeEntry(task.id, start, end).then(() => setAdding(false)));
  };

  const openEdit = (e: TimeEntry) => {
    setAdding(false);
    setEditingId(e.id);
    setDraft({ start: toLocalInput(Date.parse(e.start)), end: e.end != null ? toLocalInput(Date.parse(e.end)) : "" });
  };
  const submitEdit = (e: TimeEntry) => {
    const start = fromLocalInput(draft.start);
    if (Number.isNaN(start)) { setErr("Enter a start time."); return; }
    const patch: { start?: number; end?: number } = { start };
    if (e.end != null) {
      const end = fromLocalInput(draft.end);
      if (Number.isNaN(end)) { setErr("Enter an end time."); return; }
      if (end <= start) { setErr("End must be after start."); return; }
      patch.end = end;
    }
    run(api.updateTimeEntry(task.id, e.id, patch).then(() => setEditingId(null)));
  };

  const del = (id: string) => run(api.deleteTimeEntry(task.id, id));

  return (
    <section className="te-time">
      <div className="te-time-head">
        <span className="te-field-label">Time tracked</span>
        <span className="te-time-total" data-running={running}>
          {running ? formatClock(total) : formatDurationShort(total)}
        </span>
        <button type="button" className="te-time-toggle" data-running={running} onClick={toggleTimer}>
          {running ? "Stop" : "Start"}
        </button>
      </div>

      {entries.length > 0 && (
        <ul className="te-time-list">
          {entries.map(e => (
            <li key={e.id} className="te-time-entry">
              {editingId === e.id ? (
                <div className="te-time-edit">
                  <input type="datetime-local" step="1" aria-label="Entry start" value={draft.start}
                         onChange={ev => { const v = ev.currentTarget.value; setDraft(d => ({ ...d, start: v })); }} />
                  {e.end != null ? (
                    <input type="datetime-local" step="1" aria-label="Entry end" value={draft.end}
                           onChange={ev => { const v = ev.currentTarget.value; setDraft(d => ({ ...d, end: v })); }} />
                  ) : (
                    <span className="te-time-running">running</span>
                  )}
                  <button type="button" className="te-time-save" onClick={() => submitEdit(e)}>Save</button>
                  <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <span className="te-time-range">
                    {fmtMoment(Date.parse(e.start))} – {e.end != null ? fmtMoment(Date.parse(e.end)) : <em>running</em>}
                  </span>
                  {e.end != null && <span className="te-time-dur">{formatDurationShort(durationMs(e))}</span>}
                  <button type="button" className="te-time-edit-btn" onClick={() => openEdit(e)}
                          aria-label="Edit entry">Edit</button>
                  <button type="button" className="te-time-del" onClick={() => del(e.id)}
                          aria-label="Delete entry">Delete</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="te-time-edit">
          <input type="datetime-local" step="1" aria-label="New entry start" value={draft.start}
                 onChange={ev => { const v = ev.currentTarget.value; setDraft(d => ({ ...d, start: v })); }} />
          <input type="datetime-local" step="1" aria-label="New entry end" value={draft.end}
                 onChange={ev => { const v = ev.currentTarget.value; setDraft(d => ({ ...d, end: v })); }} />
          <button type="button" className="te-time-save" onClick={submitAdd}>Add</button>
          <button type="button" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="te-time-add" onClick={openAdd}>Add entry</button>
      )}

      {err && <p className="composer-error" role="alert">{err}</p>}
    </section>
  );
}
