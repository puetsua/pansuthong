import { useState } from "react";
import { api, Document } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { TaskList } from "../components/TaskList";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { doc: Document; indexes: Indexes };

export function TemplatesView({ indexes }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Create a blank template the user then opens to fill in (title, tags, notes,
  // date offsets). It's a normal task with is_template=true, so it lives in the
  // tasks list but only ever surfaces here.
  const newTemplate = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.addTask({ title: "New template", is_template: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const count = indexes.templates.length;
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
      <TaskList tasks={indexes.templates} tags={indexes.tagsById} todayIso={todayIso()}
                emptyText="No templates yet. Open one's editor to set its title, tags, notes, and date offsets."
                template />
    </section>
  );
}
