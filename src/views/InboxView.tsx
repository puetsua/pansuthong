import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AssignIdle } from "../components/AssignIdle";
import { Composer } from "../components/Composer";
import { IdleStatus } from "../components/IdleStatus";
import { TaskList } from "../components/TaskList";
import { useIdleAnchor } from "../lib/useIdleAnchor";
import { Document, isDone } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { useHeldCompletions, withHeld } from "../state/heldCompletions";

type Props = { doc: Document; indexes: Indexes };

export function InboxView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const [assigning, setAssigning] = useState(false);
  const { idleAnchorMs, resetIdleAnchor } = useIdleAnchor();
  // Keep a just-completed task visible (at the bottom) until this view is left or
  // the page is refreshed, so a mis-click can be undone in place (#recover).
  const { held, onCompleted, onReopened } = useHeldCompletions(doc.tasks);
  const tasks = withHeld(indexes.inbox, held);
  const candidates = indexes.inbox.filter(task => !isDone(task));
  return (
    <section>
      <header className="view-header">
        <h1>{t("nav.inbox")}</h1>
        <p className="view-sub">
          {t("inbox.subtitle")}
          <IdleStatus tasks={doc.tasks} active={assigning} idleAnchorMs={idleAnchorMs}
                      onResetIdle={resetIdleAnchor}
                      onAssign={candidates.length > 0 ? () => setAssigning(a => !a) : undefined} />
        </p>
      </header>
      {assigning ? (
        <AssignIdle tasks={doc.tasks} candidates={candidates} idleAnchorMs={idleAnchorMs}
                    onClose={() => setAssigning(false)} />
      ) : (
        <Composer todayIso={indexes.todayIso} settings={doc.settings} tagsByName={indexes.tagsByName} allTags={indexes.tagsById} />
      )}
      <TaskList tasks={tasks} tags={indexes.tagsById} todayIso={indexes.todayIso} settings={doc.settings}
                emptyText={t("inbox.empty")} onCompleted={onCompleted} onReopened={onReopened}
                onTimerStarted={() => setAssigning(false)} />
    </section>
  );
}
