import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, Document } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { TemplateRow } from "../components/TemplateRow";
import { Indexes } from "../state/indexes";

type Props = { doc: Document; indexes: Indexes };

export function TemplatesView({ indexes }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Create a blank template the user then opens to fill in (title, tags, notes,
  // date offsets). Templates live in their own list (#71).
  const newTemplate = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.addTemplate({ title: t("templates.newTemplateTitle") });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const templates = indexes.templates;
  const count = templates.length;
  const today = indexes.todayIso;
  return (
    <section>
      <header className="view-header">
        <div className="view-title-row">
          <h1>{t("nav.templates")}</h1>
          <button type="button" className="link-button tag-edit-link" onClick={newTemplate} disabled={busy}>
            {t("templates.newTemplate")}
          </button>
        </div>
        <p className="view-sub">
          {t("templates.subtitle", { count })}
        </p>
      </header>
      {error && <p className="composer-error" role="alert">{error}</p>}
      {count === 0 ? (
        <p className="task-empty">
          {t("templates.empty")}
        </p>
      ) : (
        <div>
          {templates.map(t => (
            <TemplateRow key={t.id} template={t} tags={indexes.tagsById} todayIso={today} />
          ))}
        </div>
      )}
    </section>
  );
}
