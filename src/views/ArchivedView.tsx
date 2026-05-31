import { useState } from "react";
import { api, Document } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { TaskList } from "../components/TaskList";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { doc: Document; indexes: Indexes };

export function ArchivedView({ indexes }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const archived = indexes.archived;
  // Active (non-archived) tasks already marked done — the sweep candidates.
  const completedActive = indexes.tasks.filter(t => t.done).length;

  const archiveCompleted = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.archiveCompleted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <header className="view-header">
        <div className="view-title-row">
          <h1>Archived</h1>
          {completedActive > 0 && (
            <button type="button" className="link-button tag-edit-link" disabled={busy}
                    onClick={archiveCompleted}>
              Archive {completedActive} completed
            </button>
          )}
        </div>
        <p className="view-sub">{archived.length} archived · un-check a task to restore it</p>
      </header>
      {error && <p className="composer-error" role="alert">{error}</p>}
      <TaskList tasks={archived} tags={indexes.tagsById} todayIso={todayIso()}
                emptyText="No archived tasks yet." />
    </section>
  );
}
