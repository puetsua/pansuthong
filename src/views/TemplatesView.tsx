import { useState } from "react";
import { api, Document } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { TemplateRow } from "../components/TemplateRow";
import { Indexes } from "../state/indexes";

type Props = { doc: Document; indexes: Indexes };

export function TemplatesView({ indexes }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Create a blank template the user then opens to fill in (title, tags, notes,
  // date offsets). Templates live in their own list (#71).
  const newTemplate = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.addTemplate({ title: "New template" });
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
          <h1>Templates</h1>
          <button type="button" className="link-button tag-edit-link" onClick={newTemplate} disabled={busy}>
            New template
          </button>
        </div>
        <p className="view-sub">
          {count} template{count === 1 ? "" : "s"} · Spawn a fresh task from any template
        </p>
      </header>
      {error && <p className="composer-error" role="alert">{error}</p>}
      {count === 0 ? (
        <p className="task-empty">
          No templates yet. Open one's editor to set its title, tags, notes, and date offsets.
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
