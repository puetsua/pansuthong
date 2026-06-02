import { type MouseEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, isDone, Tag, Task, TemplateTask } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { buildTaskUpdate, buildTemplateUpdate, dueBeforeStart, EditorForm, isEditorDirty, offsetFormError } from "../state/taskUpdate";
import { resolveTagIds } from "../state/quickAdd";
import { daysBetweenIso, todayIso } from "../lib/dates";
import { TagInput } from "./TagInput";

// The editor edits either a real task (absolute dates) or a template (relative
// offsets), fixed by `kind`. A task is never converted in place; "Save as
// template" creates a separate template copy instead (#71). `creating` makes Save
// add a brand-new entity (api.addTask / api.addTemplate) rather than update one —
// used for "New task from template" (a task draft pre-filled from the template)
// and "New template".
type Props = {
  allTags: Map<string, Tag>;
  onClose: () => void;
  creating?: boolean;
} & (
  | { kind?: "task"; task: Task }
  | { kind: "template"; template: TemplateTask }
);

export function TaskEditor(props: Props) {
  const { allTags, onClose, creating = false } = props;
  const isTemplate = props.kind === "template";
  const taskEntity = props.kind === "template" ? null : props.task;
  const tmplEntity = props.kind === "template" ? props.template : null;
  const entity: Task | TemplateTask = tmplEntity ?? taskEntity!;
  // Completion only applies to a saved real task (templates have no completion;
  // a not-yet-created task can't be completed).
  const canComplete = !creating && !isTemplate;
  const isDoneTask = taskEntity ? isDone(taskEntity) : false;

  const initialRef = useRef<EditorForm>({
    title: entity.title,
    start_date: taskEntity?.start_date ?? "",
    start_time: taskEntity?.start_time ?? "",
    due_date: taskEntity?.due_date ?? "",
    due_time: taskEntity?.due_time ?? "",
    notes: entity.notes ?? "",
    tag_ids: entity.tag_ids,
    new_tag_names: [],
    is_template: isTemplate,
    due_offset_days: tmplEntity?.due_offset_days != null ? String(tmplEntity.due_offset_days) : "",
    start_offset_days: tmplEntity?.start_offset_days != null ? String(tmplEntity.start_offset_days) : "",
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
      const dup = names.some(n => n.toLowerCase() === name.toLowerCase());
      return dup ? f : { ...f, new_tag_names: [...names, name] };
    });
  const removeNewTag = (name: string) =>
    setForm(f => ({ ...f, new_tag_names: (f.new_tag_names ?? []).filter(n => n !== name) }));

  // Cross-field guard: a due date before the start date is almost always a
  // mistake, so it's surfaced and blocks Save rather than persisting silently (#51).
  // Only meaningful for real tasks — templates use relative offsets, not absolute
  // dates, so the guard doesn't apply when editing a template (#71).
  const dateError = !isTemplate && dueBeforeStart(form)
    ? "Due date can't be before the start date."
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

  /** "" => undefined (no offset); otherwise the parsed integer. */
  const offsetNum = (s: string): number | undefined => {
    const n = parseInt(s.trim(), 10);
    return Number.isNaN(n) ? undefined : n;
  };

  const save = async () => {
    if (!form.title.trim()) { setError("Title can't be empty."); return; }
    if (dateError) { setError(dateError); return; }
    if (offsetError) { setError(offsetError); return; }
    setBusy(true);
    try {
      const tagIds = await resolveTags();
      if (isTemplate) {
        if (creating) {
          await api.addTemplate({
            title: form.title.trim(),
            notes: form.notes,
            tag_ids: tagIds,
            start_offset_days: offsetNum(form.start_offset_days),
            due_offset_days: offsetNum(form.due_offset_days),
          });
        } else {
          await api.updateTemplate(buildTemplateUpdate(entity.id, { ...form, tag_ids: tagIds }));
        }
      } else if (creating) {
        // A brand-new task (e.g. spawned from a template): create it now.
        await api.addTask({
          title: form.title.trim(),
          start_date: form.start_date || undefined,
          start_time: form.start_date && form.start_time ? form.start_time : undefined,
          due_date: form.due_date || undefined,
          due_time: form.due_date && form.due_time ? form.due_time : undefined,
          notes: form.notes,
          tag_ids: tagIds,
        });
      } else {
        await api.updateTask(buildTaskUpdate(entity.id, { ...form, tag_ids: tagIds }));
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
      await api.addTemplate({
        title: form.title.trim(),
        notes: form.notes,
        tag_ids: tagIds,
        start_offset_days: offset(form.start_date),
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

  // Mark the task complete (or reopen it if already done) and close. Any pending
  // edits are saved first so completing from the modal never silently drops them;
  // an invalid form blocks the action and surfaces the error, like Save.
  const toggleComplete = async () => {
    if (isDirty()) {
      if (!form.title.trim()) { setError("Title can't be empty."); return; }
      if (dateError) { setError(dateError); return; }
    }
    setBusy(true);
    try {
      if (isDirty()) {
        const tagIds = await resolveTags();
        await api.updateTask(buildTaskUpdate(entity.id, { ...form, tag_ids: tagIds }));
      }
      await api.setTaskDone(entity.id, !isDoneTask);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${entity.title}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      if (isTemplate) await api.deleteTemplate(entity.id);
      else            await api.deleteTask(entity.id);
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
                <span>Start in (days)</span>
                <input type="number" min={0} max={3650} inputMode="numeric" placeholder="—"
                       value={form.start_offset_days}
                       onChange={e => set("start_offset_days", e.currentTarget.value)} />
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
                <span>Start Date</span>
                <div className="te-datetime">
                  <input type="date" value={form.start_date}
                         onChange={e => { const v = e.currentTarget.value; setForm(f => ({
                           ...f,
                           start_date: v,
                           // Clearing the date drops its time (time needs a date) (#93).
                           start_time: v ? f.start_time : "",
                         })); }} />
                  <input type="time" aria-label="Start time" className="te-time"
                         value={form.start_time} disabled={!form.start_date}
                         onChange={e => set("start_time", e.currentTarget.value)} />
                </div>
              </label>
              <label className="te-field">
                <span>Due Date</span>
                <div className="te-datetime">
                  <input type="date" value={form.due_date}
                         onChange={e => { const v = e.currentTarget.value; setForm(f => ({
                           ...f,
                           due_date: v,
                           due_time: v ? f.due_time : "",
                         })); }} />
                  <input type="time" aria-label="Due time" className="te-time"
                         value={form.due_time} disabled={!form.due_date}
                         onChange={e => set("due_time", e.currentTarget.value)} />
                </div>
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
          {canComplete && (
            <button type="button" className="te-complete" onClick={toggleComplete} disabled={busy}>
              {isDoneTask ? "Reopen" : "Complete"}
            </button>
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
