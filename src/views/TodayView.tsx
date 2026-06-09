import { useTranslation } from "react-i18next";
import { Composer } from "../components/Composer";
import { GhostRow } from "../components/GhostRow";
import { TaskList } from "../components/TaskList";
import { Document } from "../lib/tauri";
import { Indexes, openCount } from "../state/indexes";

type Props = { doc: Document; indexes: Indexes };

export function TodayView({ indexes }: Props) {
  const { t } = useTranslation();
  const today = indexes.todayIso;
  const tasks = indexes.today(today);
  const ghosts = indexes.ghostsForDate(today);
  const remaining = openCount(tasks);
  return (
    <section>
      <header className="view-header">
        <h1>{t("nav.today")}</h1>
        <p className="view-sub">{today} · {t("common.taskCount", { count: remaining })}</p>
      </header>
      <Composer startDate={today} todayIso={today} tagsByName={indexes.tagsByName} allTags={indexes.tagsById} />
      {ghosts.map(g => <GhostRow key={g.id} ghost={g} tags={indexes.tagsById} />)}
      <TaskList tasks={tasks} tags={indexes.tagsById} todayIso={today}
                emptyText={t("today.empty")} />
    </section>
  );
}
