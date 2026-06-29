import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { api, Attachment, isDone, Tag, Task, TemplateTask } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { buildTaskUpdate, buildTemplateUpdate, dueBeforeStart, EditorForm, estimatedSecondsFormError, estimatedSecondsOrUndefined, formatEstimatedSecondsInput, isEditorDirty, maxDayForMonth, offsetFormError, recurrenceFormError, recurrenceFromForm, startOffsetDisabled } from "../state/taskUpdate";
import { resolveTagIds } from "../state/quickAdd";
import { daysBetweenIso, todayIso } from "../lib/dates";
import { readableTextColor } from "../lib/tags";
import { TagInput } from "./TagInput";
import { TimeTracking } from "./TimeTracking";

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

type NotesMode = "edit" | "split" | "preview";

const markdownElements = [
  "a", "blockquote", "br", "code", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "img", "li", "ol", "p", "pre", "strong", "ul",
];

const IMAGE_EXT = /\.(avif|gif|jpe?g|png|webp)$/i;

// A reference the markdown renderers treat as a managed attachment (and resolve
// via the asset protocol): the stored relative path, optionally device-scoped.
// Anything else (external URLs, traversal) is left to default rendering so a
// note can't reach outside the data folder.
function isManagedAttachmentPath(ref: string): boolean {
  return /^(attachments_[A-Za-z0-9_-]+\/)?attachment_[^/\\]+$/.test(ref) && !ref.includes("..");
}

function isImageAttachment(att: Attachment): boolean {
  return att.mime_type?.startsWith("image/") ?? IMAGE_EXT.test(att.name);
}

// Markdown to embed an attachment: an image renders inline, anything else links.
function markdownRefFor(att: Attachment): string {
  const link = `[${att.name}](${att.path})`;
  return isImageAttachment(att) ? `!${link}` : link;
}

// A pasted clipboard image often has no usable filename; fall back to one keyed
// off its mime subtype so the managed name and markdown ref stay sensible.
function defaultPastedName(mime: string | null): string {
  const ext = mime?.startsWith("image/") ? mime.slice("image/".length) : "bin";
  return `pasted.${ext || "bin"}`;
}

export function TaskEditor(props: Props) {
  const { t } = useTranslation();
  // Month labels for the yearly-recurrence picker; index + 1 is the stored month.
  const MONTHS = t("taskEditor.months", { returnObjects: true }) as string[];
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
    attachments: entity.attachments ?? [],
    tag_ids: entity.tag_ids,
    estimated_seconds: formatEstimatedSecondsInput(taskEntity?.estimated_seconds ?? tmplEntity?.estimated_seconds),
    new_tag_names: [],
    is_template: isTemplate,
    due_offset_days: tmplEntity?.due_offset_days != null ? String(tmplEntity.due_offset_days) : "",
    start_offset_days: tmplEntity?.start_offset_days != null ? String(tmplEntity.start_offset_days) : "",
    repeat: tmplEntity?.recurrence?.kind ?? "none",
    repeat_weekdays: tmplEntity?.recurrence?.kind === "weekly" ? tmplEntity.recurrence.weekdays : [],
    repeat_days: tmplEntity?.recurrence?.kind === "monthly" ? tmplEntity.recurrence.days.join(", ") : "",
    repeat_dates: tmplEntity?.recurrence?.kind === "yearly" ? tmplEntity.recurrence.dates : [],
    recurrence_tag_id: tmplEntity?.recurrence_tag_id ?? "",
    // Default an unconfigured start date to today so a new recurrence doesn't
    // back-fill ghost rows before it was set up.
    recurrence_start_date: tmplEntity?.recurrence_start_date ?? todayIso(),
  });
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
  // Open straight into the rendered preview; fall back to edit when there's
  // nothing to preview yet (new/empty notes) so the cursor lands in the editor.
  const [notesMode, setNotesMode] = useState<NotesMode>(
    initialRef.current.notes.trim() ? "preview" : "edit",
  );
  const [busy, setBusy] = useState(false);
  // True while a paste/drop/attach is persisting a file — drives a loading
  // indicator so a large file doesn't look like nothing happened.
  const [attaching, setAttaching] = useState(false);
  // Whether the attachments list is expanded. Collapsed by default to save
  // space; auto-expands when an attachment is added (see recordAttachments).
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  // Enlarged-image overlay, shared by list thumbnails and inline markdown images.
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);
  // The attachment awaiting a delete confirmation (custom modal — WebView2's
  // window.confirm is unreliable, and a styled dialog matches the red button).
  const [confirmDelete, setConfirmDelete] = useState<Attachment | null>(null);
  // True while the "save before closing?" prompt is up (closing a dirty editor).
  const [confirmClose, setConfirmClose] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  // The notes textarea (for caret-aware insertion) and its container (for
  // hit-testing where a file was dropped).
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const notesBoxRef = useRef<HTMLDivElement>(null);
  // The element focused before the modal opened (the triggering row button),
  // captured on first render so focus can be restored on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  if (restoreFocusRef.current === null && typeof document !== "undefined") {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
  }

  const isDirty = () => isEditorDirty(form, initialRef.current);
  // Closing a dirty editor asks whether to save first (Save / Discard / Cancel)
  // via an in-app dialog — WebView2's native window.confirm is unreliable, and a
  // two-way confirm can't offer "save". A pristine editor closes immediately.
  const requestClose = () => {
    if (isDirty()) { setConfirmClose(true); return; }
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
    setForm(f => ({
      ...f,
      tag_ids: f.tag_ids.filter(t => t !== id),
      // Removing the tag the recurrence is keyed to clears the choice, so the
      // editor falls back to "Choose a tag…" rather than pointing at a tag the
      // template no longer carries (#9).
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

  // Cross-field guard: a due date before the start date is almost always a
  // mistake, so it's surfaced and blocks Save rather than persisting silently (#51).
  // Only meaningful for real tasks — templates use relative offsets, not absolute
  // dates, so the guard doesn't apply when editing a template (#71).
  const dateError = !isTemplate && dueBeforeStart(form)
    ? t("taskEditor.dueBeforeStart")
    : null;
  const estimateError = estimatedSecondsFormError(form);
  // Templates use relative offsets instead of absolute dates; validate them (range
  // and due-before-scheduled ordering) the same way #51 validates dates, so a
  // template can't silently spawn invalid tasks on every instantiation (#71).
  const offsetError = isTemplate ? offsetFormError(form) : null;
  const recurError = isTemplate ? recurrenceFormError(form) : null;
  const isStartOffsetDisabled = isTemplate && startOffsetDisabled(form);

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
          await api.addTemplate({
            title: form.title.trim(),
            notes: form.notes,
            attachments: form.attachments,
            tag_ids: tagIds,
            start_offset_days: isStartOffsetDisabled ? undefined : offsetNum(form.start_offset_days),
            due_offset_days: offsetNum(form.due_offset_days),
            estimated_seconds: estimatedSecondsOrUndefined(form.estimated_seconds),
            recurrence: recurrenceFromForm(form),
            recurrence_tag_id: form.repeat !== "none" ? (form.recurrence_tag_id || null) : null,
            recurrence_start_date: form.repeat !== "none" ? (form.recurrence_start_date || null) : null,
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
          attachments: form.attachments,
          tag_ids: tagIds,
          estimated_seconds: estimatedSecondsOrUndefined(form.estimated_seconds),
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

  // Mark the task complete (or reopen it if already done) and close. Any pending
  // edits are saved first so completing from the modal never silently drops them;
  // an invalid form blocks the action and surfaces the error, like Save.
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

  // The current attachment ids, tracked in a ref so the drag-drop callback
  // (whose closure is created once per entity) always diffs against the live set
  // rather than a stale snapshot — otherwise an attachment added mid-session
  // would look "new" again and its markdown would be re-inserted.
  const attachmentIdsRef = useRef(new Set(initialRef.current.attachments.map(a => a.id)));

  // Record the attachments returned by an attach/remove call, returning the ones
  // that are new (so the caller can insert markdown for them). Keeps form,
  // initialRef, and the id ref in sync.
  const recordAttachments = (next: Attachment[]): Attachment[] => {
    const added = next.filter(a => !attachmentIdsRef.current.has(a.id));
    attachmentIdsRef.current = new Set(next.map(a => a.id));
    setForm(f => ({ ...f, attachments: next }));
    initialRef.current = { ...initialRef.current, attachments: next };
    // Reveal the (collapsed-by-default) list so a freshly added file is visible.
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

  // Insert markdown into the notes at the textarea caret (replacing any
  // selection); if the textarea isn't focused, append on a fresh line. The caret
  // is moved past the inserted text after React commits the new value.
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

  // Persist one pasted/dropped blob (clipboard image or a file with no path) and
  // return the created attachment, or null on failure.
  const attachBlob = async (file: File): Promise<Attachment | null> => {
    const name = file.name && file.name.length > 0 ? file.name : defaultPastedName(file.type || null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = file.type && file.type.length > 0 ? file.type : null;
    const updated = isTemplate
      ? await api.attachTemplateBytes(entity.id, name, mime, bytes)
      : await api.attachTaskBytes(entity.id, name, mime, bytes);
    return recordAttachments(updated.attachments ?? [])[0] ?? null;
  };

  // Paste handler for the notes textarea: clipboard images/files become managed
  // attachments and their markdown is inserted at the caret. Plain text falls
  // through to the default paste.
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

  // OS file drops are captured at the window level by Tauri (dragDropEnabled),
  // so a normal DOM drop never fires — we subscribe to the webview drag-drop
  // event while the editor is open. A drop anywhere in the editor attaches to
  // this entity; if it lands over the notes area, the markdown is also inserted.
  useEffect(() => {
    if (creating) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    let webview;
    try {
      webview = getCurrentWebview();
    } catch {
      return; // no Tauri webview (tests / non-Tauri host) — drag-drop disabled
    }
    webview
      .onDragDropEvent(async event => {
        if (event.payload.type !== "drop") return;
        const paths = event.payload.paths ?? [];
        if (paths.length === 0) return;
        // Physical → CSS pixels, then locate the drop target.
        const ratio = window.devicePixelRatio || 1;
        const target = document.elementFromPoint(
          event.payload.position.x / ratio,
          event.payload.position.y / ratio,
        );
        if (!dialogRef.current?.contains(target)) return; // not our editor
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

  // The set of attachment paths currently on this entity. A managed markdown ref
  // is only "live" if its path is still here — when an attachment is deleted it
  // leaves this set, so the renderer can mark the ref broken immediately instead
  // of loading a (possibly webview-cached) asset URL whose file is already gone.
  const attachmentPaths = useMemo(
    () => new Set(form.attachments.map(a => a.path)),
    [form.attachments],
  );
  const noteRows = Math.min(16, Math.max(4, form.notes.split(/\r\n|\r|\n/).length + 1));
  const noteHeightRem = Math.min(18, Math.max(7, noteRows * 1.45 + 1.5));

  // Markdown renderers: resolve live managed attachment paths to asset URLs.
  // Inline images open the lightbox; managed links open in the default app. A
  // managed ref whose attachment was deleted renders a broken marker; anything
  // non-managed falls back to plain rendering so a note can't load arbitrary
  // content.
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

  const heading = creating ? t("taskEditor.newTask") : isTemplate ? t("taskEditor.editTemplate") : t("taskEditor.editTask");

  return createPortal(
    <div className="modal-backdrop">
      <div className="task-editor" ref={dialogRef} role="dialog" aria-modal="true"
           aria-label={heading}
           onClick={e => e.stopPropagation()}>
        <div className="te-header">
          <div className="te-title-actions">
            <h2>{heading}</h2>
            {canComplete && (
              <button type="button" className="te-complete" onClick={toggleComplete} disabled={busy}>
                {isDoneTask ? t("taskEditor.reopen") : t("taskEditor.complete")}
              </button>
            )}
          </div>
          <button type="button" className="te-close" aria-label={t("taskEditor.close")}
                  onClick={requestClose} disabled={busy}>✕</button>
        </div>
        <label className="te-field">
          <span>{t("taskEditor.title")}</span>
          <input value={form.title} autoFocus
                 onChange={e => set("title", e.currentTarget.value)} />
        </label>

        {isTemplate ? (
          <>
            <div className="te-row">
              <label className="te-field">
                <span>{t("taskEditor.startInDays")}</span>
                <input type="number" min={0} max={3650} inputMode="numeric" placeholder="—"
                       value={isStartOffsetDisabled ? "" : form.start_offset_days}
                       disabled={isStartOffsetDisabled}
                       onChange={e => set("start_offset_days", e.currentTarget.value)} />
              </label>
              <label className="te-field">
                <span>{t("taskEditor.dueInDays")}</span>
                <input type="number" min={0} max={3650} inputMode="numeric" placeholder="—"
                       value={form.due_offset_days}
                       onChange={e => set("due_offset_days", e.currentTarget.value)} />
              </label>
            </div>
            {offsetError && <p className="te-warn" role="alert">{offsetError}</p>}
            <div className="te-field">
              <span>{t("taskEditor.repeat")}</span>
              <select value={form.repeat}
                      onChange={e => set("repeat", e.currentTarget.value as EditorForm["repeat"])}>
                <option value="none">{t("taskEditor.repeatNone")}</option>
                <option value="daily">{t("taskEditor.repeatDaily")}</option>
                <option value="weekly">{t("taskEditor.repeatWeekly")}</option>
                <option value="monthly">{t("taskEditor.repeatMonthly")}</option>
                <option value="yearly">{t("taskEditor.repeatYearly")}</option>
              </select>
            </div>
            {form.repeat === "weekly" && (
              <div className="te-weekdays" role="group" aria-label={t("taskEditor.weekdaysAria")}>
                {([["taskEditor.weekdayMon",1],["taskEditor.weekdayTue",2],["taskEditor.weekdayWed",3],["taskEditor.weekdayThu",4],["taskEditor.weekdayFri",5],["taskEditor.weekdaySat",6],["taskEditor.weekdaySun",7]] as const).map(([labelKey, day]) => {
                  const on = form.repeat_weekdays.includes(day);
                  return (
                    <button type="button" key={day} aria-pressed={on}
                            className={on ? "te-weekday on" : "te-weekday"}
                            onClick={() => set("repeat_weekdays",
                              on ? form.repeat_weekdays.filter(d => d !== day)
                                 : [...form.repeat_weekdays, day])}>
                      {t(labelKey)}
                    </button>
                  );
                })}
                <button type="button" className="te-weekday-preset"
                        onClick={() => set("repeat_weekdays", [1, 2, 3, 4, 5])}>
                  {t("taskEditor.weekdaysPreset")}
                </button>
              </div>
            )}
            {form.repeat === "monthly" && (
              <label className="te-field">
                <span>{t("taskEditor.monthlyLabel")}</span>
                <input type="text" inputMode="numeric" placeholder={t("taskEditor.monthlyPlaceholder")}
                       value={form.repeat_days}
                       onChange={e => set("repeat_days", e.currentTarget.value)} />
              </label>
            )}
            {form.repeat === "yearly" && (
              <div className="te-field">
                <span>{t("taskEditor.yearlyLabel")}</span>
                <div className="te-yearly-dates">
                  {form.repeat_dates.map((d, i) => (
                    <div className="te-yearly-row" key={i}>
                      <select aria-label={t("taskEditor.month")} value={d.month || ""}
                              onChange={e => set("repeat_dates", form.repeat_dates.map((x, j) =>
                                j === i ? { ...x, month: parseInt(e.currentTarget.value, 10) || 0 } : x))}>
                        <option value="">{t("taskEditor.monthPlaceholder")}</option>
                        {MONTHS.map((name, m) => <option key={name} value={m + 1}>{name}</option>)}
                      </select>
                      <input type="number" aria-label={t("taskEditor.day")} min={1}
                             max={maxDayForMonth(d.month || 1)} inputMode="numeric" placeholder={t("taskEditor.dayPlaceholder")}
                             value={d.day || ""}
                             onChange={e => set("repeat_dates", form.repeat_dates.map((x, j) =>
                               j === i ? { ...x, day: parseInt(e.currentTarget.value, 10) || 0 } : x))} />
                      <button type="button" className="te-yearly-remove" aria-label={t("taskEditor.removeDate")}
                              onClick={() => set("repeat_dates", form.repeat_dates.filter((_, j) => j !== i))}>
                        ✕
                      </button>
                    </div>
                  ))}
                  <button type="button" className="te-yearly-add"
                          onClick={() => set("repeat_dates", [...form.repeat_dates, { month: 0, day: 0 }])}>
                    {t("taskEditor.addDate")}
                  </button>
                </div>
              </div>
            )}
            {form.repeat !== "none" && (
              <>
                <label className="te-field">
                  <span>{t("taskEditor.recurrenceTag")}</span>
                  <select value={form.recurrence_tag_id}
                          onChange={e => setForm(f => ({
                            ...f,
                            recurrence_tag_id: e.currentTarget.value,
                            start_offset_days: e.currentTarget.value ? "" : f.start_offset_days,
                          }))}>
                    <option value="">{t("taskEditor.chooseTag")}</option>
                    {form.tag_ids
                      .map(id => allTags.get(id))
                      .filter((t): t is Tag => t !== undefined)
                      .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                {(() => {
                  // Only confirm a recurrence tag the template actually still carries —
                  // resolving against the template's tags (not all tags) so a removed
                  // tag stops showing here (#9).
                  const recurTag = form.tag_ids.includes(form.recurrence_tag_id)
                    ? allTags.get(form.recurrence_tag_id) : undefined;
                  return recurTag ? (
                    <p className="te-recur-tags">
                      <span className="te-recur-tags-label">{t("taskEditor.recursUnder")}</span>
                      <span className="task-tag"
                            style={{ background: recurTag.color, color: readableTextColor(recurTag.color) }}>{recurTag.name}</span>
                    </p>
                  ) : null;
                })()}
                <label className="te-field">
                  <span>{t("taskEditor.recurrenceStartDate")}</span>
                  <input type="date" value={form.recurrence_start_date}
                         onChange={e => set("recurrence_start_date", e.currentTarget.value)} />
                </label>
              </>
            )}
            {recurError && <p className="te-warn" role="alert">{recurError}</p>}
          </>
        ) : (
          <>
            <div className="te-row">
              <label className="te-field">
                <span>{t("taskEditor.startDate")}</span>
                <div className="te-datetime">
                  <input type="date" value={form.start_date}
                         onChange={e => { const v = e.currentTarget.value; setForm(f => ({
                           ...f,
                           start_date: v,
                           // Clearing the date drops its time (time needs a date) (#93).
                           start_time: v ? f.start_time : "",
                         })); }} />
                  <input type="time" aria-label={t("taskEditor.startTime")} className="te-time"
                         value={form.start_time} disabled={!form.start_date}
                         onChange={e => set("start_time", e.currentTarget.value)} />
                </div>
              </label>
              <label className="te-field">
                <span>{t("taskEditor.dueDate")}</span>
                <div className="te-datetime">
                  <input type="date" value={form.due_date}
                         onChange={e => { const v = e.currentTarget.value; setForm(f => ({
                           ...f,
                           due_date: v,
                           due_time: v ? f.due_time : "",
                         })); }} />
                  <input type="time" aria-label={t("taskEditor.dueTime")} className="te-time"
                         value={form.due_time} disabled={!form.due_date}
                         onChange={e => set("due_time", e.currentTarget.value)} />
                </div>
              </label>
            </div>
            {dateError && <p className="te-warn" role="alert">{dateError}</p>}
            {/* A saved task edits its estimate inside the Time tracked section below
                (single source of truth, live progress bar). A brand-new draft has no
                time tracking yet, so it keeps the standalone field here. */}
            {!canComplete && (
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
          </>
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

        <div className="te-field te-notes-field">
          <div className="te-field-head">
            <span>{t("taskEditor.notes")}</span>
            <div className="te-segmented" role="group" aria-label={t("taskEditor.notesView")}>
              {(["edit", "split", "preview"] as const).map(mode => (
                <button type="button" key={mode}
                        aria-pressed={notesMode === mode}
                        className={notesMode === mode ? "active" : ""}
                        onClick={() => setNotesMode(mode)}>
                  {t(`taskEditor.notesMode.${mode}`)}
                </button>
              ))}
            </div>
          </div>
          <div className={`te-notes te-notes-mode-${notesMode}`}
               ref={notesBoxRef}
               style={{ "--te-notes-height": `${noteHeightRem}rem` } as CSSProperties}>
            {notesMode !== "preview" && (
              <textarea aria-label={t("taskEditor.notesMarkdown")}
                        ref={notesRef}
                        value={form.notes} rows={noteRows}
                        onChange={e => set("notes", e.currentTarget.value)}
                        onPaste={handleNotesPaste} />
            )}
            {notesMode !== "edit" && (
              <div className="te-notes-preview" aria-label={t("taskEditor.notesPreview")}>
                {form.notes.trim() ? (
                  <ReactMarkdown allowedElements={markdownElements} components={markdownComponents}>
                    {form.notes}
                  </ReactMarkdown>
                ) : (
                  <p className="te-notes-empty">{t("taskEditor.notesPreviewEmpty")}</p>
                )}
              </div>
            )}
          </div>
        </div>

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
          {/* Outside the collapse so a pending save is always visible. */}
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
            {creating ? t("taskEditor.addTask") : t("taskEditor.save")}
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

function AttachmentList({
  attachments,
  onRequestRemove,
  onInsert,
  onOpenImage,
  emptyLabel,
  disabled,
}: {
  attachments: Attachment[];
  onRequestRemove: (att: Attachment) => void;
  onInsert: (att: Attachment) => void;
  onOpenImage: (url: string, alt: string) => void;
  emptyLabel: string;
  disabled: boolean;
}) {
  if (attachments.length === 0) {
    return <p className="te-attachments-empty">{emptyLabel}</p>;
  }
  return (
    <div className="te-attachments">
      {attachments.map(att => (
        <AttachmentItem
          key={att.id}
          attachment={att}
          onRequestRemove={() => onRequestRemove(att)}
          onInsert={() => onInsert(att)}
          onOpenImage={onOpenImage}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function AttachmentItem({
  attachment,
  onRequestRemove,
  onInsert,
  onOpenImage,
  disabled,
}: {
  attachment: Attachment;
  onRequestRemove: () => void;
  onInsert: () => void;
  onOpenImage: (url: string, alt: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setImgFailed(false);
    api.attachmentUrl(attachment.path)
      .then(u => { if (live) setUrl(u); })
      .catch(() => { if (live) setUrl(null); });
    return () => { live = false; };
  }, [attachment.path]);
  const isImage = isImageAttachment(attachment);
  // Only reserve the image column when we'll actually show a preview, so a
  // failed or still-loading image collapses to the filename row instead of
  // leaving a permanent blank gap.
  const showImage = isImage && url != null && !imgFailed;
  // Clicking the filename reveals the file in the OS file manager (both images
  // and files); clicking the image thumbnail enlarges it in the lightbox.
  const reveal = () => { void api.revealAttachment(attachment.path); };
  return (
    <div className={showImage ? "te-attachment image" : "te-attachment"}>
      {showImage && (
        <button type="button" className="te-attachment-thumb"
                aria-label={t("taskEditor.enlargeImage", { name: attachment.name })}
                onClick={() => onOpenImage(url!, attachment.name)}>
          <img src={url!} alt={attachment.name} onError={() => setImgFailed(true)} />
        </button>
      )}
      <div className="te-attachment-meta">
        <button type="button" className="te-attachment-name"
                title={t("taskEditor.revealAttachment", { name: attachment.name })}
                onClick={reveal}>
          {attachment.name}
        </button>
        {attachment.size != null && <span className="te-attachment-size">{formatBytes(attachment.size)}</span>}
      </div>
      <div className="te-attachment-actions">
        <button type="button" className="te-attachment-insert"
                aria-label={t("taskEditor.insertAttachment", { name: attachment.name })}
                title={t("taskEditor.insertAttachment", { name: attachment.name })}
                onClick={onInsert} disabled={disabled}>↳</button>
        <button type="button" className="te-attachment-delete"
                aria-label={t("taskEditor.removeAttachment", { name: attachment.name })}
                onClick={onRequestRemove} disabled={disabled}>×</button>
      </div>
    </div>
  );
}

// Resolves a managed attachment path to an asset URL and renders it inline in
// the notes preview. A failed/unresolved image collapses to its alt text rather
// than leaving a bare broken-image icon; clicking opens the shared lightbox.
function MarkdownImage({ path, alt, onOpen }: {
  path: string;
  alt: string;
  onOpen: (url: string, alt: string) => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    api.attachmentUrl(path)
      .then(u => { if (live) setUrl(u); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [path]);
  // A managed image whose file is gone (deleted attachment) resolves to a URL
  // that 404s — surface it as a "broken link" marker, not a silent gap, so the
  // user knows the reference points at a missing attachment.
  if (failed) {
    return (
      <span className="te-md-image-broken" title={t("taskEditor.imageUnavailable")}>
        🔗💔 {alt || t("taskEditor.imageUnavailable")}
      </span>
    );
  }
  if (url == null) return <span>{alt}</span>;
  return (
    <img className="te-md-image" src={url} alt={alt}
         onClick={() => onOpen(url, alt)}
         onError={() => setFailed(true)} />
  );
}

// Full-size image overlay. Esc or a backdrop/close click dismisses it.
function ImageLightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="te-lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <button type="button" className="te-lightbox-close" aria-label={t("taskEditor.closeImage")}
              onClick={onClose}>×</button>
      <img src={url} alt={alt} onClick={e => e.stopPropagation()} />
    </div>
  );
}

// In-app confirmation modal with a red confirm button. Used for attachment
// deletion (WebView2's native window.confirm is unreliable here). Esc cancels;
// the destructive button is auto-focused so Enter confirms.
function ConfirmDialog({ message, confirmLabel, cancelLabel, onConfirm, onCancel }: {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    <div className="te-confirm" role="dialog" aria-modal="true" aria-label={message} onClick={onCancel}>
      <div className="te-confirm-box" onClick={e => e.stopPropagation()}>
        <p>{message}</p>
        <div className="te-confirm-actions">
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" ref={confirmRef} className="te-confirm-delete" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// "Save before closing?" prompt for a dirty editor. Three choices: Save (the
// primary action, auto-focused so Enter saves), Discard, or Cancel. Esc cancels.
// Built in-app for the same reason as ConfirmDialog (WebView2's window.confirm is
// unreliable) and because a native confirm can't offer a third "save" option.
function SaveChangesDialog({ message, saveLabel, discardLabel, cancelLabel, onSave, onDiscard, onCancel }: {
  message: string;
  saveLabel: string;
  discardLabel: string;
  cancelLabel: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const saveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    saveRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    <div className="te-confirm" role="dialog" aria-modal="true" aria-label={message} onClick={onCancel}>
      <div className="te-confirm-box" onClick={e => e.stopPropagation()}>
        <p>{message}</p>
        <div className="te-confirm-actions">
          <button type="button" onClick={onDiscard}>{discardLabel}</button>
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" ref={saveRef} className="te-save" onClick={onSave}>
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}
