import { type MouseEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, Tag, Task } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { buildTaskUpdate, dueBeforeScheduled, EditorForm, isEditorDirty, offsetFormError } from "../state/taskUpdate";
import { resolveTagIds } from "../state/quickAdd";
import { daysBetweenIso, todayIso } from "../lib/dates";
import { TagInput } from "./TagInput";

type Props = {
  task: Task;
  allTags: Map<string, Tag>;
  onClose: () => void;
  // Create a brand-new task on save (api.addTask) instead of editing `task`. Used
  // for "New task from template": the row pre-fills `task` with the template's
  // resolved values and the user finishes before the task is created (#71).
  creating?: boolean;
};

export function TaskEditor({ task, allTags, onClose, creating = false }: Props) {
  // Whether this editor is for a template entity (offset inputs) vs a real task
  // (absolute dates). Fixed by the entity — a task is never converted in place;
  // "Save as template" creates a separate copy instead (#71).
  const isTemplate = (task.is_template ?? false) && !creating;
  const initialRef = useRef<EditorForm>({
    title: task.title,
    scheduled_date: task.scheduled_date ?? "",
    due_date: task.due_date ?? "",
    notes: task.notes ?? "",
    tag_ids: task.tag_ids,
    new_tag_names: [],
    is_template: task.is_template ?? false,
    due_offset_days: task.due_offset_days != null ? String(task.due_offset_days) : "",
    scheduled_offset_days: task.scheduled_offset_days != null ? String(task.scheduled_offset_days) : "",
  });
  const [form, setForm] = useState<EditorForm>(initialRef.current);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropPressStartedRef = useRef<boolean | null>(null);
  const backdropPressEndedRef = useRef<boolean | null>(null);
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

  // While the editor is open, make the rest of the app inert so assistive tech
  // (and pointer/focus) can't reach the background behind the dialog. The modal is
  // portaled to document.body — a sibling of #root — so #root can be inert without
  // affecting the dialog. aria-hidden is a fallback for any WebView lacking `inert`
  // support; both are cleared on unmount (#43).
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    root.setAttribute("inert", "");
    root.setAttribute("aria-hidden", "true");
    return () => {
      root.removeAttribute("inert");
      root.removeAttribute("aria-hidden");
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
  // Only meaningful for real tasks — templates use relative offsets, not absolute
  // dates, so the guard doesn't apply when editing a template (#71).
  const dateError = !isTemplate && dueBeforeScheduled(form)
    ? "Due date can't be before the scheduled date."
    : null;
  // Templates use relative offsets instead of absolute dates; validate them (range
  // and due-before-scheduled ordering) the same way #51 validates dates, so a
  // template can't silently spawn invalid tasks on every instantiation (#71).
  const offsetError = isTemplate ? offsetFormError(form) : null;

  // Create any tags the user typed but didn't pick from the list, then fold their
  // ids in alongside the existing ones. Done at save time (not on each add) so
  // Cancel leaves no orphan tags behind.
  const resolveTags = async (): Promise<string[]> => {
    const newNames = form.new_tag_names ?? [];
    if (newNames.length === 0) return form.tag_ids;
    const byName = new Map<string, Tag>();
    for (const t of allTags.values()) byName.set(t.name.toLowerCase(), t);
    const newIds = await resolveTagIds(newNames, byName, api.addTag);
    return [...form.tag_ids, ...newIds.filter(id => !form.tag_ids.includes(id))];
  };

  const save = async () => {
    if (!form.title.trim()) { setError("Title can't be empty."); return; }
    if (dateError) { setError(dateError); return; }
    if (offsetError) { setError(offsetError); return; }
    setBusy(true);
    try {
      const tagIds = await resolveTags();
      if (creating) {
        // A brand-new task (e.g. spawned from a template): create it now.
        await api.addTask({
          title: form.title.trim(),
          scheduled_date: form.scheduled_date || undefined,
          due_date: form.due_date || undefined,
          notes: form.notes,
          tag_ids: tagIds,
        });
      } else {
        await api.updateTask(buildTaskUpdate(task.id, { ...form, tag_ids: tagIds }));
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  // "Save as template" (an option for a normal task): create a separate template
  // copy and KEEP the original task untouched (#71). The task's absolute dates
  // become relative offsets (today + N), clamped to >= 0.
  const saveAsTemplate = async () => {
    setOptionsOpen(false);
    if (!form.title.trim()) { setError("Title can't be empty."); return; }
    if (dateError) { setError(dateError); return; }
    setBusy(true);
    try {
      const tagIds = await resolveTags();
      const today = todayIso();
      const offset = (d: string) => (d ? Math.max(0, daysBetweenIso(today, d)) : undefined);
      await api.addTask({
        title: form.title.trim(),
        notes: form.notes,
        tag_ids: tagIds,
        is_template: true,
        scheduled_offset_days: offset(form.scheduled_date),
        due_offset_days: offset(form.due_date),
      });
      setBusy(false);
      setError(null);
      setNotice("Saved as a template — this task is unchanged.");
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

  // Clicking the dimmed backdrop auto-saves rather than prompting to discard:
  // commit the edits like Save would, then close. If the form is invalid, save()
  // surfaces the error and keeps the modal open instead of losing the edits; if
  // nothing changed, just close (no redundant write). Escape and Cancel still use
  // requestClose, so an explicit discard path remains (#66).
  const saveOnBackdrop = () => {
    if (busy) return;
    // A new (not-yet-created) task shouldn't be created by an outside click — treat
    // the backdrop like Cancel. For an existing task, auto-save the edits (#66).
    if (creating) { requestClose(); return; }
    if (isDirty()) void save();
    else onClose();
  };

  const onBackdropMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    backdropPressStartedRef.current = e.target === e.currentTarget;
    backdropPressEndedRef.current = null;
  };

  const onBackdropMouseUp = (e: MouseEvent<HTMLDivElement>) => {
    backdropPressEndedRef.current = e.target === e.currentTarget;
  };

  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const startedOnBackdrop = backdropPressStartedRef.current;
    const endedOnBackdrop = backdropPressEndedRef.current;
    backdropPressStartedRef.current = null;
    backdropPressEndedRef.current = null;
    if (startedOnBackdrop === false || endedOnBackdrop === false) return;
    saveOnBackdrop();
  };

  return createPortal(
    <div className="modal-backdrop"
         onMouseDown={onBackdropMouseDown}
         onMouseUp={onBackdropMouseUp}
         onClick={onBackdropClick}>
      <div className="task-editor" ref={dialogRef} role="dialog" aria-modal="true"
           aria-label={creating ? "New task" : isTemplate ? "Edit template" : "Edit task"}
           onClick={e => e.stopPropagation()}>
        <label className="te-field">
          <span>Title</span>
          <input value={form.title} autoFocus
                 onChange={e => set("title", e.currentTarget.value)} />
        </label>

        {isTemplate ? (
          <>
            <div className="te-row">
              <label className="te-field">
                <span>Scheduled in (days)</span>
                <input type="number" min={0} max={3650} inputMode="numeric" placeholder="—"
                       value={form.scheduled_offset_days}
                       onChange={e => set("scheduled_offset_days", e.currentTarget.value)} />
              </label>
              <label className="te-field">
                <span>Due in (days)</span>
                <input type="number" min={0} max={3650} inputMode="numeric" placeholder="—"
                       value={form.due_offset_days}
                       onChange={e => set("due_offset_days", e.currentTarget.value)} />
              </label>
            </div>
            {offsetError && <p className="te-warn" role="alert">{offsetError}</p>}
          </>
        ) : (
          <>
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
          </>
        )}

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
        {notice && <p className="te-notice" role="status">{notice}</p>}

        <div className="te-actions">
          {!creating && (
            <div className="te-options">
              <button type="button" className="te-options-btn" onClick={() => setOptionsOpen(o => !o)}
                      disabled={busy} aria-haspopup="menu" aria-expanded={optionsOpen}>
                Options ▾
              </button>
              {optionsOpen && (
                <div className="te-options-menu" role="menu">
                  {!isTemplate && (
                    <button type="button" role="menuitem" onClick={saveAsTemplate} disabled={busy}>
                      Save as template
                    </button>
                  )}
                  <button type="button" role="menuitem" className="te-menu-danger"
                          onClick={() => { setOptionsOpen(false); void remove(); }} disabled={busy}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}
          <span className="te-spacer" />
          <button type="button" onClick={requestClose} disabled={busy}>Cancel</button>
          <button type="button" className="te-save" onClick={save}
                  disabled={busy || !form.title.trim() || !!dateError || !!offsetError}>
            {creating ? "Add task" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
