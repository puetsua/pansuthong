import {
  FormEvent,
  KeyboardEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { api, Tag, Task, Settings } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { parseComposer } from "../state/parse";
import { todayIso } from "../lib/dates";
import { defaultTagColor } from "../lib/settings";
import { ComposerPreview } from "./ComposerPreview";
import { TaskEditor } from "./TaskEditor";
import { resolveTagIds } from "../state/quickAdd";
import {
  buildComposerTagOptions,
  getActiveTagFragment,
  replaceComposerTagToken,
  type ComposerTagOption,
} from "../state/composerTagSuggest";
import { normalizeTagHashColor } from "../lib/tagColorDisplay";
import { useThemeVariant } from "../lib/useThemeVariant";

type Props = {
  startDate?: string;
  /** The logical "today" used to resolve relative dates ("today"/"tomorrow"). */
  todayIso?: string;
  settings?: Pick<Settings, "theme">;
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

export function Composer({ startDate, todayIso: today = todayIso(), settings, tagsByName, allTags = EMPTY_TAGS, contextTagId }: Props) {
  const { t } = useTranslation();
  const theme = useThemeVariant(settings);
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [menuSuppress, setMenuSuppress] = useState<{ start: number; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A not-yet-persisted draft for the full editor modal. Pre-filled with the same
  // context the inline composer applies (view's start date / tag), so the button
  // is just a richer way to add the same task. Nothing is created until Save.
  const [draft, setDraft] = useState<Task | null>(null);

  const tagCatalog = useMemo(
    () => (allTags.size > 0 ? [...allTags.values()] : [...tagsByName.values()]),
    [allTags, tagsByName],
  );

  const fragment = useMemo(() => getActiveTagFragment(input, caret), [input, caret]);
  const tokenSnapshot = fragment
    ? input.slice(fragment.start, fragment.tokenEnd)
    : "";

  const showTagMenu = Boolean(
    fragment
    && !(menuSuppress
      && menuSuppress.start === fragment.start
      && menuSuppress.token === tokenSnapshot),
  );

  const options: ComposerTagOption[] = useMemo(
    () => (fragment ? buildComposerTagOptions(tagCatalog, fragment.rawFragment) : []),
    [fragment, tagCatalog],
  );

  const active = Math.min(highlight, Math.max(options.length - 1, 0));

  const syncCaret = (el: HTMLInputElement) => {
    setCaret(el.selectionStart ?? el.value.length);
  };

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

  const applyInput = (value: string, nextCaret: number) => {
    setInput(value);
    setCaret(nextCaret);
    setMenuSuppress(null);
    setHighlight(0);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const commitTagOption = (opt: ComposerTagOption) => {
    if (!fragment) return;
    if (opt.kind === "existing") {
      const { value, caret: nextCaret } = replaceComposerTagToken(input, fragment, opt.tag.name);
      applyInput(value, nextCaret);
      return;
    }
    setMenuSuppress({ start: fragment.start, token: tokenSnapshot });
    setHighlight(0);
    inputRef.current?.focus();
  };

  const onInputChange = (value: string, el: HTMLInputElement) => {
    setInput(value);
    syncCaret(el);
    setHighlight(0);
    if (menuSuppress) {
      const frag = getActiveTagFragment(value, el.selectionStart ?? value.length);
      const snap = frag ? value.slice(frag.start, frag.tokenEnd) : "";
      if (!frag || frag.start !== menuSuppress.start || snap !== menuSuppress.token) {
        setMenuSuppress(null);
      }
    }
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showTagMenu || options.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitTagOption(options[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (fragment) {
        setMenuSuppress({ start: fragment.start, token: tokenSnapshot });
      }
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.title) return;

    try {
      const resolvedTagIds = await resolveTagIds(parsed.tag_names, tagsByName, api.addTag, defaultTagColor());
      // Auto-tag with the current tag view's tag so the task stays in view,
      // without duplicating a tag the user also typed explicitly (#106).
      const tagIds = contextTagId && !resolvedTagIds.includes(contextTagId)
        ? [contextTagId, ...resolvedTagIds]
        : resolvedTagIds;

      // Today view passes `startDate` so plain quick-adds land on today. A parsed
      // due-only line must not inherit that default — start stays unset (#215).
      const implicitStart =
        parsed.start_date ?? (parsed.due_date != null ? undefined : startDate);

      await api.addTask({
        title: parsed.title,
        start_date: implicitStart,
        due_date: parsed.due_date,
        tag_ids: tagIds,
        estimated_seconds: parsed.estimated_seconds,
      });
      setInput("");
      setCaret(0);
      setMenuSuppress(null);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div>
      <form className="composer" onSubmit={submit}>
        <div className="composer-combo te-tag-combo">
          <input
            ref={inputRef}
            value={input}
            onChange={e => onInputChange(e.currentTarget.value, e.currentTarget)}
            onSelect={e => syncCaret(e.currentTarget)}
            onKeyUp={e => syncCaret(e.currentTarget)}
            onClick={e => syncCaret(e.currentTarget)}
            onKeyDown={onInputKeyDown}
            placeholder={t("composer.placeholder")}
            aria-label={t("composer.aria")}
            aria-expanded={showTagMenu && options.length > 0}
            aria-haspopup="listbox"
            autoComplete="off"
          />
          {showTagMenu && options.length > 0 && (
            <ul className="te-tag-menu composer-tag-menu" role="listbox">
              {options.map((opt, i) => {
                const isActive = i === active;
                const cls = `te-opt${isActive ? " te-opt-active" : ""}`;
                if (opt.kind === "create") {
                  return (
                    <li key="__create" role="option" aria-selected={isActive}>
                      <button
                        type="button"
                        className={`${cls} te-opt-create`}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => commitTagOption(opt)}
                      >
                        {t("tagInput.create", { name: opt.name })}
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={opt.tag.id} role="option" aria-selected={isActive}>
                    <button
                      type="button"
                      className={cls}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => commitTagOption(opt)}
                    >
                      <span
                        className="sidebar-hash"
                        aria-hidden="true"
                        style={{ color: normalizeTagHashColor(opt.tag.color, theme) }}
                      >
                        #
                      </span>
                      {opt.tag.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <button type="submit" disabled={!parsed.title}>{t("composer.add")}</button>
        <button type="button" className="composer-expand" onClick={openEditor}
                aria-label={t("composer.expand")} title={t("composer.expand")}>⋯</button>
        {error && <p className="composer-error">{error}</p>}
        {!error && needsTitle && (
          <p className="composer-hint">{t("composer.needTitle")}</p>
        )}
      </form>
      <ComposerPreview parsed={parsed} tagsByName={tagsByName} settings={settings} />
      {draft && (
        <TaskEditor task={draft} allTags={allTags} creating onClose={() => setDraft(null)} />
      )}
    </div>
  );
}
