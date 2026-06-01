import { useState } from "react";
import { Tag, Task, TemplateTask } from "../lib/tauri";
import { addDaysIso } from "../lib/dates";
import { TaskEditor } from "./TaskEditor";

type Props = {
  template: TemplateTask;
  tags: Map<string, Tag>;
  todayIso: string;
};

/** Compact summary of a template's relative offsets, e.g. "start +0d · due +3d". */
function offsetLabel(t: TemplateTask): string {
  const parts: string[] = [];
  if (t.scheduled_offset_days != null) parts.push(`start +${t.scheduled_offset_days}d`);
  if (t.due_offset_days != null)       parts.push(`due +${t.due_offset_days}d`);
  return parts.join(" · ");
}

export function TemplateRow({ template, tags, todayIso }: Props) {
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
      scheduled_date: template.scheduled_offset_days != null ? addDaysIso(todayIso, template.scheduled_offset_days) : undefined,
      completed_at: undefined,
    });
  };

  const label = offsetLabel(template);

  return (
    <>
      <div className="task-row">
        <button type="button" className="task-main" onClick={() => setEditing(true)}
                aria-label={`Edit ${template.title}`}>
          <span className="task-title">{template.title}</span>
          {tmplTags.map(t => (
            <span key={t.id} className="task-tag" style={{ background: t.color + "22", color: t.color }}>
              {t.name}
            </span>
          ))}
          {label && <span className="task-when">{label}</span>}
        </button>
        <button type="button" className="task-restore" onClick={newFromTemplate}
                aria-label={`New task from ${template.title}`}>
          New task
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
