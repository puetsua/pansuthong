import { useTranslation } from "react-i18next";
import { Composer } from "../components/Composer";
import { TaskList } from "../components/TaskList";
import { Document } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { useHeldCompletions, withHeld } from "../state/heldCompletions";

type Props = { doc: Document; indexes: Indexes };

export function InboxView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  // Keep a just-completed task visible (at the bottom) until this view is left or
  // the page is refreshed, so a mis-click can be undone in place (#recover).
  const { held, onCompleted, onReopened } = useHeldCompletions(doc.tasks);
  const tasks = withHeld(indexes.inbox, held);
  return (
    <section>
      <header className="view-header">
        <h1>{t("nav.inbox")}</h1>
        <p className="view-sub">{t("inbox.subtitle")}</p>
      </header>
      <Composer todayIso={indexes.todayIso} tagsByName={indexes.tagsByName} />
      <TaskList tasks={tasks} tags={indexes.tagsById} todayIso={indexes.todayIso}
                emptyText={t("inbox.empty")} onCompleted={onCompleted} onReopened={onReopened} />
    </section>
  );
}
