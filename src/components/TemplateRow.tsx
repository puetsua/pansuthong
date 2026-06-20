import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Tag, Task, TemplateTask } from "../lib/tauri";
import { addDaysIso } from "../lib/dates";
import { readableTextColor } from "../lib/tags";
import { TaskEditor } from "./TaskEditor";

type Props = {
  template: TemplateTask;
  tags: Map<string, Tag>;
  todayIso: string;
};

/** Compact summary of a template's relative offsets, e.g. "start +0d · due +3d". */
function offsetLabel(tmpl: TemplateTask, t: TFunction): string {
  const parts: string[] = [];
  if (tmpl.start_offset_days != null) parts.push(t("templateRow.startOffset", { days: tmpl.start_offset_days }));
  if (tmpl.due_offset_days != null)       parts.push(t("templateRow.dueOffset", { days: tmpl.due_offset_days }));
  return parts.join(" · ");
}

export function TemplateRow({ template, tags, todayIso }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  // A draft task pre-filled from this template, shown in the editor so the user can
  // finish it before it's actually created (#71). null = not creating.
  const [creatingDraft, setCreatingDraft] = useState<Task | null>(null);

  const tmplTags = template.tag_ids
    .map(id => tags.get(id))
    .filter((t): t is Tag => t !== undefined)
    .sort((a, b) => b.priority - a.priority);

  // Build a draft task from this template (relative offsets resolved to absolute
  // dates: today + offset) and open the editor so the user can finish it before it
  // is created (#71). Creation happens on the editor's "Add task".
  const newFromTemplate = () => {
    setCreatingDraft({
      id: "",
      title: template.title,
      notes: template.notes,
      tag_ids: template.tag_ids,
      created_at: "",
      due_date: template.due_offset_days != null ? addDaysIso(todayIso, template.due_offset_days) : undefined,
      start_date: template.start_offset_days != null ? addDaysIso(todayIso, template.start_offset_days) : undefined,
      estimated_seconds: template.estimated_seconds,
      completed_at: undefined,
    });
  };

  const label = offsetLabel(template, t);

  return (
    <>
      <div className="task-row">
        <button type="button" className="task-main" onClick={() => setEditing(true)}
                aria-label={t("templateRow.edit", { title: template.title })}>
          {template.recurrence_tag_id && (
            <span className="task-recurring" title={t("templateRow.recurring")} aria-label={t("templateRow.recurring")}>↻</span>
          )}
          <span className="task-title">{template.title}</span>
          {tmplTags.map(t => (
            <span key={t.id} className="task-tag" style={{ background: t.color, color: readableTextColor(t.color) }}>
              {t.name}
            </span>
          ))}
          {label && <span className="task-when">{label}</span>}
        </button>
        <button type="button" className="task-restore" onClick={newFromTemplate}
                aria-label={t("templateRow.newTaskAria", { title: template.title })}>
          {t("templateRow.newTask")}
        </button>
      </div>
      {editing && (
        <TaskEditor kind="template" template={template} allTags={tags} onClose={() => setEditing(false)} />
      )}
      {creatingDraft && (
        <TaskEditor task={creatingDraft} allTags={tags} creating onClose={() => setCreatingDraft(null)} />
      )}
    </>
  );
}
