import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { api, Attachment, isDone, Tag, Task, TemplateTask } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import {
  buildAddTaskPayload, buildAddTemplatePayload, buildTaskUpdate, buildTemplateUpdate,
  dueBeforeStart, EditorForm, editorFormFrom, estimatedSecondsFormError,
  estimatedSecondsOrUndefined, isEditorDirty, offsetFormError, recurrenceFormError, startOffsetDisabled,
} from "../state/taskUpdate";
import { resolveTagIds } from "../state/quickAdd";
import { daysBetweenIso, todayIso } from "../lib/dates";
import { defaultTagColor } from "../lib/settings";
import { playCompletionSound } from "../lib/sound";
import { TagInput } from "./TagInput";
import { TimeTracking } from "./TimeTracking";
import { defaultPastedName, isManagedAttachmentPath, markdownRefFor } from "./task-editor/attachmentRefs";
import { AttachmentList, ImageLightbox, MarkdownImage } from "./task-editor/attachments";
import { ConfirmDialog, SaveChangesDialog } from "./task-editor/dialogs";
import { NotesField, type NotesMode } from "./task-editor/NotesField";
import { RecurrenceFields } from "./task-editor/RecurrenceFields";
import { ScheduleFields } from "./task-editor/ScheduleFields";

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
  // So the parent view can hold a just-completed task in the list (#161).
  // Without this the row unmounts on store refresh and takes the editor with it.
  // Do not notify onReopened here: dropping the hold before the store shows the
  // task as open unmounts the row and closes the editor.
  onCompleted?: (id: string) => void;
} & (
  | { kind?: "task"; task: Task }
  | { kind: "template"; template: TemplateTask }
);

const markdownElements = [
  "a", "blockquote", "br", "code", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "img", "li", "ol", "p", "pre", "strong", "ul",
];

export function TaskEditor(props: Props) {
  const { t } = useTranslation();
  const { allTags, onClose, creating = false, onCompleted } = props;
  const isTemplate = props.kind === "template";
  const taskEntity = props.kind === "template" ? null : props.task;
  const tmplEntity = props.kind === "template" ? props.template : null;
  const entity: Task | TemplateTask = tmplEntity ?? taskEntity!;
  const canComplete = !creating && !isTemplate;
  const isDoneTask = taskEntity ? isDone(taskEntity) : false;

  const initialRef = useRef<EditorForm>(editorFormFrom({
    isTemplate,
    task: taskEntity,
    template: tmplEntity,
    todayIso: todayIso(),
  }));
  // NOTE (known limitation): the form seeds from `task` once. If the same task is
  // changed externally (folder sync, or an edit elsewhere) while this editor is
  // open, Save sends the stale form and overwrites that change — only the editor's
  // own attach/remove ops re-patch `initialRef`. A full fix would compare the
  // task's updated_at on save (optimistic concurrency); attach/remove bumping
  // updated_at makes a naive check false-positive, so it's left as a follow-up.
  const [form, setForm] = useState<EditorForm>(initialRef.current);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [notesMode, setNotesMode] = useState<NotesMode>(
    initialRef.current.notes.trim() ? "preview" : "edit",
  );
  const [busy, setBusy] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Attachment | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const notesBoxRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  if (restoreFocusRef.current === null && typeof document !== "undefined") {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
  }

  const isDirty = () => isEditorDirty(form, initialRef.current);
  const requestClose = () => {
    if (isDirty()) { setConfirmClose(true); return; }
    onClose();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); requestCloseRef.current(); return; }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      // tabIndex=-1 is omitted from the list; treat the parked dialog as a cycle edge (#160).
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === root)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || active === root)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    const opener = restoreFocusRef.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  // Park on the dialog when not creating: a focused input raises the Android
  // IME (#160), and #root is inert so the opener cannot keep focus.
  useLayoutEffect(() => {
    if (!creating) dialogRef.current?.focus();
  }, [creating]);

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
    setForm(f => ({
      ...f,
      tag_ids: f.tag_ids.filter(tagId => tagId !== id),
      recurrence_tag_id: f.recurrence_tag_id === id ? "" : f.recurrence_tag_id,
    }));
  const addNewTag = (name: string) =>
    setForm(f => {
      const names = f.new_tag_names ?? [];
      const dup = names.some(n => n.toLowerCase() === name.toLowerCase());
      return dup ? f : { ...f, new_tag_names: [...names, name] };
    });
  const removeNewTag = (name: string) =>
    setForm(f => ({ ...f, new_tag_names: (f.new_tag_names ?? []).filter(n => n !== name) }));

  const dateError = !isTemplate && dueBeforeStart(form)
    ? t("taskEditor.dueBeforeStart")
    : null;
  const estimateError = estimatedSecondsFormError(form);
  const offsetError = isTemplate ? offsetFormError(form) : null;
  const recurError = isTemplate ? recurrenceFormError(form) : null;
  const isStartOffsetDisabled = isTemplate && startOffsetDisabled(form);

  const resolveTags = async (): Promise<string[]> => {
    const newNames = form.new_tag_names ?? [];
    if (newNames.length === 0) return form.tag_ids;
    const byName = new Map<string, Tag>();
    for (const tag of allTags.values()) byName.set(tag.name.toLowerCase(), tag);
    const newIds = await resolveTagIds(newNames, byName, api.addTag, defaultTagColor());
    return [...form.tag_ids, ...newIds.filter(id => !form.tag_ids.includes(id))];
  };

  const save = async () => {
    if (!form.title.trim()) { setError(t("taskEditor.titleEmpty")); return; }
    if (dateError) { setError(dateError); return; }
    if (estimateError) { setError(estimateError); return; }
    if (offsetError) { setError(offsetError); return; }
    if (recurError) { setError(recurError); return; }
    setBusy(true);
    try {
      const tagIds = await resolveTags();
      if (isTemplate) {
        if (creating) {
          await api.addTemplate(buildAddTemplatePayload(form, tagIds, isStartOffsetDisabled));
        } else {
          await api.updateTemplate(buildTemplateUpdate(entity.id, { ...form, tag_ids: tagIds }));
        }
      } else if (creating) {
        await api.addTask(buildAddTaskPayload(form, tagIds));
      } else {
        await api.updateTask(buildTaskUpdate(entity.id, { ...form, tag_ids: tagIds }));
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const saveAsTemplate = async () => {
    setOptionsOpen(false);
    if (!form.title.trim()) { setError(t("taskEditor.titleEmpty")); return; }
    if (dateError) { setError(dateError); return; }
    setBusy(true);
    try {
      const tagIds = await resolveTags();
      const today = todayIso();
      const offset = (d: string) => (d ? Math.max(0, daysBetweenIso(today, d)) : undefined);
      await api.addTemplate({
        title: form.title.trim(),
        notes: form.notes,
        attachments: form.attachments,
        tag_ids: tagIds,
        start_offset_days: offset(form.start_date),
        due_offset_days: offset(form.due_date),
        estimated_seconds: estimatedSecondsOrUndefined(form.estimated_seconds),
      });
      setBusy(false);
      setError(null);
      setNotice(t("taskEditor.savedAsTemplate"));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const duplicate = async () => {
    setOptionsOpen(false);
    setBusy(true);
    try {
      if (isTemplate) await api.duplicateTemplate(entity.id);
      else            await api.duplicateTask(entity.id);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const toggleComplete = async () => {
    if (isDirty()) {
      if (!form.title.trim()) { setError(t("taskEditor.titleEmpty")); return; }
      if (dateError) { setError(dateError); return; }
      if (estimateError) { setError(estimateError); return; }
    }
    setBusy(true);
    try {
      if (isDirty()) {
        const tagIds = await resolveTags();
        const saved = { ...form, tag_ids: tagIds, new_tag_names: [] };
        await api.updateTask(buildTaskUpdate(entity.id, saved));
        initialRef.current = saved;
        setForm(saved);
      }
      const nextDone = !isDoneTask;
      await api.setTaskDone(entity.id, nextDone);
      if (nextDone) {
        playCompletionSound();
        onCompleted?.(entity.id);
      }
      setBusy(false);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(t("taskEditor.deleteConfirm", { title: entity.title }))) return;
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

  const attachmentIdsRef = useRef(new Set(initialRef.current.attachments.map(a => a.id)));

  const recordAttachments = (next: Attachment[]): Attachment[] => {
    const added = next.filter(a => !attachmentIdsRef.current.has(a.id));
    attachmentIdsRef.current = new Set(next.map(a => a.id));
    setForm(f => ({ ...f, attachments: next }));
    initialRef.current = { ...initialRef.current, attachments: next };
    if (added.length > 0) setAttachmentsOpen(true);
    return added;
  };

  const attachFiles = async () => {
    if (creating) return;
    setBusy(true);
    setAttaching(true);
    try {
      const updated = isTemplate
        ? await api.attachTemplateFiles(entity.id)
        : await api.attachTaskFiles(entity.id);
      if (updated) recordAttachments(updated.attachments ?? []);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setAttaching(false);
    }
  };

  const removeAttachment = async (attachmentId: string) => {
    if (creating) {
      setForm(f => ({ ...f, attachments: f.attachments.filter(a => a.id !== attachmentId) }));
      return;
    }
    setBusy(true);
    try {
      const updated = isTemplate
        ? await api.removeTemplateAttachment(entity.id, attachmentId)
        : await api.removeTaskAttachment(entity.id, attachmentId);
      recordAttachments(updated.attachments ?? []);
      setError(null);
      setBusy(false);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const insertNotes = (snippet: string) => {
    const ta = notesRef.current;
    setForm(f => {
      if (ta && document.activeElement === ta) {
        const s = ta.selectionStart ?? f.notes.length;
        const e = ta.selectionEnd ?? s;
        const next = f.notes.slice(0, s) + snippet + f.notes.slice(e);
        const caret = s + snippet.length;
        requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(caret, caret); });
        return { ...f, notes: next };
      }
      const sep = f.notes && !f.notes.endsWith("\n") ? "\n\n" : "";
      return { ...f, notes: f.notes + sep + snippet };
    });
  };

  const attachBlob = async (file: File): Promise<Attachment | null> => {
    const name = file.name && file.name.length > 0 ? file.name : defaultPastedName(file.type || null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = file.type && file.type.length > 0 ? file.type : null;
    const updated = isTemplate
      ? await api.attachTemplateBytes(entity.id, name, mime, bytes)
      : await api.attachTaskBytes(entity.id, name, mime, bytes);
    return recordAttachments(updated.attachments ?? [])[0] ?? null;
  };

  const handleNotesPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (creating) return;
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    e.preventDefault();
    setBusy(true);
    setAttaching(true);
    try {
      for (const file of files) {
        const att = await attachBlob(file);
        if (att) insertNotes(markdownRefFor(att));
      }
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setAttaching(false);
    }
  };

  useEffect(() => {
    if (creating) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    let webview;
    try {
      webview = getCurrentWebview();
    } catch {
      return;
    }
    webview
      .onDragDropEvent(async event => {
        if (event.payload.type !== "drop") return;
        const paths = event.payload.paths ?? [];
        if (paths.length === 0) return;
        const ratio = window.devicePixelRatio || 1;
        const target = document.elementFromPoint(
          event.payload.position.x / ratio,
          event.payload.position.y / ratio,
        );
        if (!dialogRef.current?.contains(target)) return;
        const overNotes = !!notesBoxRef.current?.contains(target);
        setBusy(true);
        setAttaching(true);
        try {
          const updated = isTemplate
            ? await api.attachTemplateFiles(entity.id, paths)
            : await api.attachTaskFiles(entity.id, paths);
          if (updated) {
            const added = recordAttachments(updated.attachments ?? []);
            if (overNotes) added.forEach(att => insertNotes(markdownRefFor(att)));
          }
          setError(null);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
          setAttaching(false);
        }
      })
      .then(fn => { if (cancelled) fn(); else unlisten = fn; })
      .catch(() => { /* drag-drop unsupported (e.g. Android) — ignore */ });
    return () => { cancelled = true; unlisten?.(); };
  }, [creating, isTemplate, entity.id]);

  const openImage = useCallback((url: string, alt: string) => setLightbox({ url, alt }), []);

  const attachmentPaths = useMemo(
    () => new Set(form.attachments.map(a => a.path)),
    [form.attachments],
  );
  const noteRows = Math.min(16, Math.max(4, form.notes.split(/\r\n|\r|\n/).length + 1));
  const noteHeightRem = Math.min(18, Math.max(7, noteRows * 1.45 + 1.5));

  const markdownComponents = useMemo<Components>(() => ({
    img: ({ src, alt }) => {
      const label = alt ?? "";
      if (typeof src !== "string" || !isManagedAttachmentPath(src)) return <span>{label}</span>;
      if (!attachmentPaths.has(src)) {
        return (
          <span className="te-md-image-broken" title={t("taskEditor.imageUnavailable")}>
            🔗💔 {label || t("taskEditor.imageUnavailable")}
          </span>
        );
      }
      return <MarkdownImage path={src} alt={label} onOpen={openImage} />;
    },
    a: ({ href, children }) => {
      if (typeof href !== "string" || !isManagedAttachmentPath(href)) {
        return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
      }
      if (!attachmentPaths.has(href)) {
        return <span className="te-md-image-broken" title={t("taskEditor.imageUnavailable")}>🔗💔 {children}</span>;
      }
      return <a href="#" onClick={e => { e.preventDefault(); void api.openAttachment(href); }}>{children}</a>;
    },
  }), [openImage, attachmentPaths, t]);

  const deferredNotes = useDeferredValue(form.notes);
  const notesPreview = useMemo(() => (
    <ReactMarkdown allowedElements={markdownElements} components={markdownComponents}>
      {deferredNotes}
    </ReactMarkdown>
  ), [deferredNotes, markdownComponents]);

  const heading = creating
    ? (isTemplate ? t("taskEditor.newTemplate") : t("taskEditor.newTask"))
    : isTemplate ? t("taskEditor.editTemplate") : t("taskEditor.editTask");
  const saveLabel = creating
    ? (isTemplate ? t("taskEditor.addTemplate") : t("taskEditor.addTask"))
    : t("taskEditor.save");

  return createPortal(
    <div className="modal-backdrop">
      <div className="task-editor" ref={dialogRef} role="dialog" aria-modal="true"
           aria-label={heading} tabIndex={-1}
           onClick={e => e.stopPropagation()}>
        <div className="te-header">
          <div className="te-title-actions">
            <h2>{heading}</h2>
            {canComplete && (
              <input type="checkbox" className="te-complete-check" checked={isDoneTask}
                     onChange={toggleComplete} disabled={busy}
                     aria-label={t("taskEditor.toggle", { title: entity.title })} />
            )}
          </div>
          <button type="button" className="te-close" aria-label={t("taskEditor.close")}
                  onClick={requestClose} disabled={busy}>✕</button>
        </div>
        <label className="te-field">
          <span>{t("taskEditor.title")}</span>
          <input value={form.title} autoFocus={creating}
                 onChange={e => set("title", e.currentTarget.value)} />
        </label>

        {isTemplate ? (
          <RecurrenceFields
            form={form}
            allTags={allTags}
            isStartOffsetDisabled={isStartOffsetDisabled}
            offsetError={offsetError}
            recurError={recurError}
            set={set}
            setForm={setForm}
          />
        ) : (
          <ScheduleFields
            form={form}
            dateError={dateError}
            estimateError={estimateError}
            showEstimate={!canComplete}
            set={set}
            setForm={setForm}
          />
        )}

        <div className="te-field">
          <span>{t("taskEditor.tags")}</span>
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

        {canComplete && taskEntity && (
          <TimeTracking
            task={taskEntity}
            estimateInput={form.estimated_seconds}
            onEstimateChange={v => set("estimated_seconds", v)}
            estimateError={estimateError}
          />
        )}

        {isTemplate && (
          <>
            <label className="te-field">
              <span>{t("taskEditor.estimatedSeconds")}</span>
              <input type="text" inputMode="text" placeholder={t("taskEditor.estimatedSecondsPlaceholder")}
                     value={form.estimated_seconds}
                     onChange={e => set("estimated_seconds", e.currentTarget.value)} />
            </label>
            {estimateError && <p className="te-warn" role="alert">{estimateError}</p>}
          </>
        )}

        <NotesField
          notes={form.notes}
          notesMode={notesMode}
          noteRows={noteRows}
          noteHeightRem={noteHeightRem}
          deferredNotes={deferredNotes}
          notesPreview={notesPreview}
          notesRef={notesRef}
          notesBoxRef={notesBoxRef}
          onNotesMode={setNotesMode}
          onNotesChange={value => set("notes", value)}
          onPaste={handleNotesPaste}
        />

        <div className="te-field te-attachments-field">
          <div className="te-field-head">
            <button type="button" className="te-collapse-toggle" aria-expanded={attachmentsOpen}
                    onClick={() => setAttachmentsOpen(o => !o)}>
              <span className="te-collapse-caret" aria-hidden="true">{attachmentsOpen ? "▾" : "▸"}</span>
              {t("taskEditor.attachments")}
              {form.attachments.length > 0 && (
                <span className="te-collapse-count">{form.attachments.length}</span>
              )}
            </button>
            <button type="button" className="te-attach-btn" onClick={attachFiles}
                    disabled={busy || creating}>
              {t("taskEditor.attachFiles")}
            </button>
          </div>
          {attaching && (
            <p className="te-attaching" role="status">
              <span className="te-spinner" aria-hidden="true" />
              {t("taskEditor.savingAttachment")}
            </p>
          )}
          {attachmentsOpen && (
            <AttachmentList
              attachments={form.attachments}
              onRequestRemove={setConfirmDelete}
              onInsert={att => insertNotes(markdownRefFor(att))}
              onOpenImage={openImage}
              emptyLabel={creating ? t("taskEditor.attachmentsEmptyCreating") : t("taskEditor.attachmentsEmpty")}
              disabled={busy}
            />
          )}
        </div>

        {error && <p className="composer-error">{error}</p>}
        {notice && <p className="te-notice" role="status">{notice}</p>}

        <div className="te-actions">
          {!creating && (
            <div className="te-options">
              <button type="button" className="te-options-btn" onClick={() => setOptionsOpen(o => !o)}
                      disabled={busy} aria-haspopup="menu" aria-expanded={optionsOpen}>
                {t("taskEditor.options")}
              </button>
              {optionsOpen && (
                <div className="te-options-menu" role="menu">
                  {!isTemplate && (
                    <button type="button" role="menuitem" onClick={saveAsTemplate} disabled={busy}>
                      {t("taskEditor.saveAsTemplate")}
                    </button>
                  )}
                  <button type="button" role="menuitem" onClick={duplicate} disabled={busy}>
                    {t("taskEditor.duplicate")}
                  </button>
                  <button type="button" role="menuitem" className="te-menu-danger"
                          onClick={() => { setOptionsOpen(false); void remove(); }} disabled={busy}>
                    {t("taskEditor.delete")}
                  </button>
                </div>
              )}
            </div>
          )}
          <span className="te-spacer" />
          <button type="button" onClick={requestClose} disabled={busy}>{t("taskEditor.cancel")}</button>
          <button type="button" className="te-save" onClick={save}
                  disabled={busy || !form.title.trim() || !!dateError || !!estimateError || !!offsetError || !!recurError}>
            {saveLabel}
          </button>
        </div>
        {lightbox && (
          <ImageLightbox url={lightbox.url} alt={lightbox.alt} onClose={() => setLightbox(null)} />
        )}
        {confirmDelete && (
          <ConfirmDialog
            message={t("taskEditor.deleteAttachmentConfirm", { name: confirmDelete.name })}
            confirmLabel={t("taskEditor.delete")}
            cancelLabel={t("taskEditor.cancel")}
            onCancel={() => setConfirmDelete(null)}
            onConfirm={() => { const id = confirmDelete.id; setConfirmDelete(null); void removeAttachment(id); }}
          />
        )}
        {confirmClose && (
          <SaveChangesDialog
            message={t("taskEditor.saveChangesConfirm")}
            saveLabel={t("taskEditor.save")}
            discardLabel={t("taskEditor.discard")}
            cancelLabel={t("taskEditor.cancel")}
            onSave={() => { setConfirmClose(false); void save(); }}
            onDiscard={() => { setConfirmClose(false); onClose(); }}
            onCancel={() => setConfirmClose(false)}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
