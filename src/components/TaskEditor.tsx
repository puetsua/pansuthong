import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, Tag, Task } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { buildTaskUpdate, dueBeforeScheduled, EditorForm, isEditorDirty } from "../state/taskUpdate";
import { resolveTagIds } from "../state/quickAdd";
import { TagInput } from "./TagInput";

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
    new_tag_names: [],
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

  const isDirty = () => isEditorDirty(form, initialRef.current);
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

  const addExistingTag = (id: string) =>
    setForm(f => (f.tag_ids.includes(id) ? f : { ...f, tag_ids: [...f.tag_ids, id] }));
  const removeExistingTag = (id: string) =>
    setForm(f => ({ ...f, tag_ids: f.tag_ids.filter(t => t !== id) }));
  const addNewTag = (name: string) =>
    setForm(f => {
      const names = f.new_tag_names ?? [];
      return names.includes(name) ? f : { ...f, new_tag_names: [...names, name] };
    });
  const removeNewTag = (name: string) =>
    setForm(f => ({ ...f, new_tag_names: (f.new_tag_names ?? []).filter(n => n !== name) }));

  // Cross-field guard: a due date before the scheduled date is almost always a
  // mistake, so it's surfaced and blocks Save rather than persisting silently (#51).
  const dateError = dueBeforeScheduled(form)
    ? "Due date can't be before the scheduled date."
    : null;

  const save = async () => {
    if (!form.title.trim()) { setError("Title can't be empty."); return; }
    if (dateError) { setError(dateError); return; }
    setBusy(true);
    try {
      // Create any tags the user typed but didn't pick from the list, then fold
      // their ids in alongside the existing ones. Done here (not on each add) so
      // Cancel leaves no orphan tags behind.
      let tagIds = form.tag_ids;
      const newNames = form.new_tag_names ?? [];
      if (newNames.length > 0) {
        const byName = new Map<string, Tag>();
        for (const t of allTags.values()) byName.set(t.name.toLowerCase(), t);
        const newIds = await resolveTagIds(newNames, byName, api.addTag);
        tagIds = [...form.tag_ids, ...newIds.filter(id => !form.tag_ids.includes(id))];
      }
      await api.updateTask(buildTaskUpdate(task.id, { ...form, tag_ids: tagIds }));
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
        {dateError && <p className="te-warn" role="alert">{dateError}</p>}

        <div className="te-field">
          <span>Tags</span>
          <TagInput
            allTags={allTags}
            tagIds={form.tag_ids}
            newNames={form.new_tag_names ?? []}
            onAddExisting={addExistingTag}
            onAddNew={addNewTag}
            onRemoveExisting={removeExistingTag}
            onRemoveNew={removeNewTag}
          />
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
                  disabled={busy || !form.title.trim() || !!dateError}>Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
