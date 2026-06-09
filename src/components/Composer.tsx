import { FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, Tag, Task } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { parseComposer } from "../state/parse";
import { todayIso } from "../lib/dates";
import { ComposerPreview } from "./ComposerPreview";
import { TaskEditor } from "./TaskEditor";
import { resolveTagIds } from "../state/quickAdd";

type Props = {
  startDate?: string;
  /** The logical "today" used to resolve relative dates ("today"/"tomorrow"). */
  todayIso?: string;
  tagsByName: Map<string, Tag>;
  /** Every known tag keyed by id — handed to the full editor modal (same map TaskEditor wants). */
  allTags?: Map<string, Tag>;
  /**
   * Tag id of the current view, if any. A task added here is auto-tagged with
   * it so it stays visible in the tag view, even when no #tag is typed (#106).
   */
  contextTagId?: string;
};

const EMPTY_TAGS: Map<string, Tag> = new Map();

export function Composer({ startDate, todayIso: today = todayIso(), tagsByName, allTags = EMPTY_TAGS, contextTagId }: Props) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A not-yet-persisted draft for the full editor modal. Pre-filled with the same
  // context the inline composer applies (view's start date / tag), so the button
  // is just a richer way to add the same task. Nothing is created until Save.
  const [draft, setDraft] = useState<Task | null>(null);

  const openEditor = () => setDraft({
    id: "",
    title: "",
    notes: "",
    tag_ids: contextTagId ? [contextTagId] : [],
    start_date: startDate,
    created_at: "",
    completed_at: undefined,
  });

  const parsed = useMemo(() => parseComposer(input, today), [input, today]);
  // The user typed something, but it parsed to only tags/dates with no title —
  // explain why Enter/Add does nothing instead of failing silently (#51).
  const needsTitle = input.trim().length > 0 && !parsed.title;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.title) return;

    try {
      const resolvedTagIds = await resolveTagIds(parsed.tag_names, tagsByName, api.addTag);
      // Auto-tag with the current tag view's tag so the task stays in view,
      // without duplicating a tag the user also typed explicitly (#106).
      const tagIds = contextTagId && !resolvedTagIds.includes(contextTagId)
        ? [contextTagId, ...resolvedTagIds]
        : resolvedTagIds;

      await api.addTask({
        title: parsed.title,
        start_date: parsed.start_date ?? startDate,
        due_date: parsed.due_date,
        tag_ids: tagIds,
      });
      setInput("");
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div>
      <form className="composer" onSubmit={submit}>
        <input
          value={input}
          onChange={e => setInput(e.currentTarget.value)}
          placeholder={t("composer.placeholder")}
          aria-label={t("composer.aria")}
        />
        <button type="submit" disabled={!parsed.title}>{t("composer.add")}</button>
        <button type="button" className="composer-expand" onClick={openEditor}
                aria-label={t("composer.expand")} title={t("composer.expand")}>⋯</button>
        {error && <p className="composer-error">{error}</p>}
        {!error && needsTitle && (
          <p className="composer-hint">{t("composer.needTitle")}</p>
        )}
      </form>
      <ComposerPreview parsed={parsed} tagsByName={tagsByName} />
      {draft && (
        <TaskEditor task={draft} allTags={allTags} creating onClose={() => setDraft(null)} />
      )}
    </div>
  );
}
