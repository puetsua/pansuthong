import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Document, TemplateTask } from "../lib/tauri";
import { TemplateRow } from "../components/TemplateRow";
import { TaskEditor } from "../components/TaskEditor";
import { Indexes } from "../state/indexes";

type Props = { doc: Document; indexes: Indexes };

const BLANK_TEMPLATE: TemplateTask = {
  id: "",
  title: "",
  notes: "",
  tag_ids: [],
  created_at: "",
};

export function TemplatesView({ indexes }: Props) {
  const { t } = useTranslation();
  // null = closed; open the full template editor before anything is persisted
  // (same pattern as TagsView / Composer — create on Save, not on the link click).
  const [creating, setCreating] = useState(false);

  const templates = indexes.templates;
  const count = templates.length;
  const today = indexes.todayIso;
  return (
    <section>
      <header className="view-header">
        <div className="view-title-row">
          <h1>{t("nav.templates")}</h1>
          <button type="button" className="link-button tag-edit-link"
                  onClick={() => setCreating(true)}>
            {t("templates.newTemplate")}
          </button>
        </div>
        <p className="view-sub">
          {t("templates.subtitle", { count })}
        </p>
      </header>
      {count === 0 ? (
        <p className="task-empty">
          {t("templates.empty")}
        </p>
      ) : (
        <div>
          {templates.map(tmpl => (
            <TemplateRow key={tmpl.id} template={tmpl} tags={indexes.tagsById} todayIso={today} />
          ))}
        </div>
      )}
      {creating && (
        <TaskEditor
          kind="template"
          template={BLANK_TEMPLATE}
          allTags={indexes.tagsById}
          creating
          onClose={() => setCreating(false)}
        />
      )}
    </section>
  );
}
