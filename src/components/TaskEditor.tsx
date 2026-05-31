import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, Tag, Task } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { buildTaskUpdate, EditorForm } from "../state/taskUpdate";

type Props = {
  task: Task;
  allTags: Map<string, Tag>;
  onClose: () => void;
};

export function TaskEditor({ task, allTags, onClose }: Props) {
  const initialRef = useRef<EditorForm>({
    title: task.title,
    scheduled_date: task.scheduled_date ?? "",
    due_date: task.due_date ?? "",
    notes: task.notes ?? "",
    tag_ids: task.tag_ids,
  });
  const [form, setForm] = useState<EditorForm>(initialRef.current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  // The element focused before the modal opened (the triggering row button),
  // captured on first render so focus can be restored on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  if (restoreFocusRef.current === null && typeof document !== "undefined") {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
  }

  const isDirty = () => JSON.stringify(form) !== JSON.stringify(initialRef.current);
  const requestClose = () => {
    if (isDirty() && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  };
  // Keep a stable ref to the latest requestClose so the mount-only key handler
  // sees current form state without re-binding (which would restore focus early).
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); requestCloseRef.current(); return; }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const f = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    const opener = restoreFocusRef.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  const set = <K extends keyof EditorForm>(k: K, v: EditorForm[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const toggleTag = (id: string) =>
    setForm(f => ({
      ...f,
      tag_ids: f.tag_ids.includes(id) ? f.tag_ids.filter(t => t !== id) : [...f.tag_ids, id],
    }));

  const save = async () => {
    if (!form.title.trim()) { setError("Title can't be empty."); return; }
    setBusy(true);
    try {
      await api.updateTask(buildTaskUpdate(task.id, form));
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const toggleArchive = async () => {
    setBusy(true);
    try {
      await api.setTaskArchived(task.id, !task.archived);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${task.title}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteTask(task.id);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={requestClose}>
      <div className="task-editor" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Edit task"
           onClick={e => e.stopPropagation()}>
        <label className="te-field">
          <span>Title</span>
          <input value={form.title} autoFocus
                 onChange={e => set("title", e.currentTarget.value)} />
        </label>

        <div className="te-row">
          <label className="te-field">
            <span>Scheduled</span>
            <input type="date" value={form.scheduled_date}
                   onChange={e => set("scheduled_date", e.currentTarget.value)} />
          </label>
          <label className="te-field">
            <span>Due</span>
            <input type="date" value={form.due_date}
                   onChange={e => set("due_date", e.currentTarget.value)} />
          </label>
        </div>

        <div className="te-field">
          <span>Tags</span>
          <div className="te-tags">
            {[...allTags.values()].sort((a, b) => b.priority - a.priority).map(t => (
              <button type="button" key={t.id}
                      className={form.tag_ids.includes(t.id) ? "te-tag on" : "te-tag"}
                      style={{ borderColor: t.color, color: t.color }}
                      onClick={() => toggleTag(t.id)}>
                {t.name}
              </button>
            ))}
            {allTags.size === 0 && <span className="te-empty">No tags yet.</span>}
          </div>
        </div>

        <label className="te-field">
          <span>Notes</span>
          <textarea value={form.notes} rows={4}
                    onChange={e => set("notes", e.currentTarget.value)} />
        </label>

        {error && <p className="composer-error">{error}</p>}

        <div className="te-actions">
          <button type="button" className="te-delete" onClick={remove} disabled={busy}>Delete</button>
          <button type="button" className="te-archive" onClick={toggleArchive} disabled={busy}>
            {task.archived ? "Unarchive" : "Archive"}
          </button>
          <span className="te-spacer" />
          <button type="button" onClick={requestClose} disabled={busy}>Cancel</button>
          <button type="button" className="te-save" onClick={save}
                  disabled={busy || !form.title.trim()}>Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
