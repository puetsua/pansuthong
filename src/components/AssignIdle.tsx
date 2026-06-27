import { CSSProperties, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, Task } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { IDLE_MERGE_GAP_MS, lastActivityMs, mergeableEntry, overlapsExisting } from "../lib/time";
import { formatEstimatedSecondsInput, parseEstimatedSeconds } from "../state/taskUpdate";
import { currentLocale } from "../i18n";
import { MarqueeText } from "./MarqueeText";

type Props = {
  // All tasks: the idle anchor (last finished activity vs. current-session reset)
  // is global.
  tasks: Task[];
  // The host view's open tasks, offered as assignment targets.
  candidates: Task[];
  idleAnchorMs: number;
  onClose: () => void;
};

// The idle window, snapshotted once when the form mounts (it does NOT track live
// time): from the last finished activity — or the idle anchor, whichever is
// later — up to now.
function initialSpan(tasks: Task[], idleAnchorMs: number): { anchorMs: number; endMs: number } {
  const last = lastActivityMs(tasks);
  const anchorMs = last != null ? Math.max(last, idleAnchorMs) : idleAnchorMs;
  return { anchorMs, endMs: Date.now() };
}

const clamp = (sec: number, maxSec: number): number => Math.min(maxSec, Math.max(1, sec));

const fmtTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });

/** A custom task dropdown whose closed-state label marquee-scrolls when the task
 *  title is too long to fit (a native <select> can't animate its selected text). */
function TaskSelect({ tasks, value, onChange, ariaLabel }: {
  tasks: Task[]; value: string; onChange: (id: string) => void; ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = tasks.find(tk => tk.id === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="task-select" ref={ref}>
      <button type="button" className="task-select-btn" aria-haspopup="listbox" aria-expanded={open}
              aria-label={ariaLabel} onClick={() => setOpen(o => !o)}>
        <MarqueeText className="task-select-label" text={selected?.title ?? ""} />
        <span className="task-select-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="task-select-list" role="listbox">
          {tasks.map(tk => (
            <li key={tk.id} role="option" aria-selected={tk.id === value}
                className={`task-select-opt${tk.id === value ? " sel" : ""}`}
                onClick={() => { onChange(tk.id); setOpen(false); }}>
              <MarqueeText text={tk.title} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Inline form that transfers idle time onto a chosen task — for when you forgot to
 * hit Start (#idle-timer). Rendered in place of the add-task composer while active.
 *
 * The end is pinned to the moment you opened the form (it does not advance); a
 * one-second-resolution slider — or a typed duration field — picks how far back
 * the work started, bounded by the idle window. It defaults to full (start = the
 * last activity), and a typed value past the window clamps to it. Because the start
 * can never precede the last activity, the span sits at or after every existing
 * entry: at full duration it concatenates into the adjacent entry (within
 * `IDLE_MERGE_GAP_MS`) rather than leaving a one-second seam.
 */
export function AssignIdle({ tasks, candidates, idleAnchorMs, onClose }: Props) {
  const { t } = useTranslation();
  const [{ anchorMs, endMs }] = useState(() => initialSpan(tasks, idleAnchorMs));
  const maxSec = Math.max(1, Math.round((endMs - anchorMs) / 1_000));
  const [durationSec, setDurationSec] = useState(maxSec); // defaults to the full window
  const [editing, setEditing] = useState(false);
  const [durText, setDurText] = useState("");
  const [taskId, setTaskId] = useState(candidates[0]?.id ?? "");
  const [err, setErr] = useState<string | null>(null);

  const startMs = endMs - durationSec * 1_000;
  // Track-fill fraction (0 at the 1s minimum, 1 at the maximum). The CSS offsets
  // this by the thumb width so the fill edge follows the thumb's center.
  const fillFrac = maxSec > 1 ? (durationSec - 1) / (maxSec - 1) : 1;

  const commit = (sec: number) => setDurationSec(clamp(sec, maxSec));
  const onText = (raw: string) => {
    setDurText(raw);
    const parsed = parseEstimatedSeconds(raw);
    if (parsed != null && parsed > 0) commit(parsed);
  };

  const submit = () => {
    const task = candidates.find(c => c.id === taskId);
    if (!task) { setErr(t("idle.errPickTask")); return; }

    // Concatenate with a close-enough existing entry when one exists; otherwise
    // record a fresh session. Either way, guard against clashing with *other*
    // entries on the task.
    const merge = mergeableEntry(task.time_entries, startMs, endMs, IDLE_MERGE_GAP_MS);
    const action = merge && merge.end != null
      ? (() => {
          const ns = Math.min(Date.parse(merge.start), startMs);
          const ne = Math.max(Date.parse(merge.end), endMs);
          if (overlapsExisting(task.time_entries, ns, ne, merge.id)) return null;
          return api.updateTimeEntry(task.id, merge.id, { start: ns, end: ne });
        })()
      : (overlapsExisting(task.time_entries, startMs, endMs) ? null : api.addTimeEntry(task.id, startMs, endMs));

    if (action == null) { setErr(t("idle.errOverlap")); return; }
    setErr(null);
    action.then(onClose).catch(ex => setErr(errorMessage(ex)));
  };

  return (
    <div className="assign-idle" role="group" aria-label={t("idle.assignAria")}>
      <TaskSelect tasks={candidates} value={taskId} onChange={setTaskId} ariaLabel={t("idle.taskLabel")} />
      <div className="assign-idle-slider" style={{ "--p": fillFrac } as CSSProperties}>
        <div className="assign-idle-track" aria-hidden="true" />
        <div className="assign-idle-fill" aria-hidden="true" />
        <div className="assign-idle-thumb" aria-hidden="true" />
        <input type="range" className="assign-idle-range-input" min={1} max={maxSec} step={1}
               value={durationSec} aria-label={t("idle.durationLabel")}
               onChange={ev => commit(Number(ev.currentTarget.value))} />
      </div>
      <input type="text" inputMode="text" className="assign-idle-dur-input"
             aria-label={t("idle.durationInputLabel")}
             value={editing ? durText : formatEstimatedSecondsInput(durationSec)}
             onFocus={() => { setEditing(true); setDurText(formatEstimatedSecondsInput(durationSec)); }}
             onChange={ev => onText(ev.currentTarget.value)}
             onBlur={() => setEditing(false)} />
      <span className="assign-idle-range">{t("idle.range", { from: fmtTime(startMs), to: fmtTime(endMs) })}</span>
      <button type="button" className="assign-idle-action assign-idle-save" onClick={submit}>{t("idle.confirm")}</button>
      <button type="button" className="assign-idle-action" onClick={onClose}>{t("idle.cancel")}</button>
      {err && <p className="composer-error" role="alert">{err}</p>}
    </div>
  );
}
