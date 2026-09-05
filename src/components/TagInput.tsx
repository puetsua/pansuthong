import { KeyboardEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tag, Settings } from "../lib/tauri";
import { tagPillStyle, normalizeTagHashColor } from "../lib/tagColorDisplay";
import { useThemeVariant } from "../lib/useThemeVariant";
import { defaultTagColor } from "../lib/settings";

type Props = {
  /** Every known tag, keyed by id (same map TaskEditor receives). */
  allTags: Map<string, Tag>;
  settings?: Pick<Settings, "theme">;
  /** Ids of existing tags currently on the task. */
  tagIds: string[];
  /** Lowercased names typed by the user that don't exist as tags yet. */
  newNames: string[];
  onAddExisting: (id: string) => void;
  onAddNew: (name: string) => void;
  onRemoveExisting: (id: string) => void;
  onRemoveNew: (name: string) => void;
};

const byWeightDesc = (a: Tag, b: Tag) => b.priority - a.priority;

/** One row in the candidate dropdown: an existing tag, or "create this name". */
type Option =
  | { kind: "existing"; tag: Tag }
  | { kind: "create"; name: string };

/**
 * Typeahead tag editor used inside the task modal. Shows the task's tags as
 * removable chips and a text field whose dropdown filters the remaining tags;
 * a name that matches nothing offers a "Create" row. New tags are not created
 * here — the typed name is handed up to the parent and only persisted on Save.
 */
export function TagInput({
  allTags, settings, tagIds, newNames,
  onAddExisting, onAddNew, onRemoveExisting, onRemoveNew,
}: Props) {
  const { t } = useTranslation();
  const theme = useThemeVariant(settings);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const assigned = tagIds
    .map(id => allTags.get(id))
    .filter((t): t is Tag => t !== undefined)
    .sort(byWeightDesc);

  // `raw` keeps the typed case for display/creation; `q` is the lowercased form
  // used for all matching so case never spawns a duplicate.
  const raw = query.trim();
  const q = raw.toLowerCase();
  const unassigned = [...allTags.values()]
    .filter(t => !tagIds.includes(t.id))
    .filter(t => !q || t.name.toLowerCase().includes(q))
    .sort(byWeightDesc);

  // A name "exists" if any tag carries it or it's already a pending new chip —
  // in either case we don't offer to create a duplicate (compared case-insensitively).
  const nameTaken =
    [...allTags.values()].some(t => t.name.toLowerCase() === q)
    || newNames.some(n => n.toLowerCase() === q);
  const showCreate = q.length > 0 && !nameTaken;

  const options: Option[] = [
    ...unassigned.map((tag): Option => ({ kind: "existing", tag })),
    ...(showCreate ? [{ kind: "create", name: raw } as Option] : []),
  ];

  const active = Math.min(highlight, Math.max(options.length - 1, 0));

  const reset = () => { setQuery(""); setHighlight(0); };

  const commit = (opt: Option | undefined) => {
    if (!opt) return;
    if (opt.kind === "existing") onAddExisting(opt.tag.id);
    else onAddNew(opt.name);
    reset();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (options.length === 0) return;
      e.preventDefault();
      commit(options[active]);
    } else if (e.key === "Escape" && query !== "") {
      // Clear the field first; don't let Escape bubble up and close the modal.
      e.preventDefault();
      e.stopPropagation();
      reset();
    }
  };

  return (
    <div className="te-taginput">
      <div className="te-tags">
        {assigned.map(tag => (
          <button type="button" key={tag.id} className="te-tag on"
                  style={tagPillStyle(tag.color, theme)}
                  onClick={() => onRemoveExisting(tag.id)}
                  aria-label={t("tagInput.remove", { name: tag.name })} title={t("tagInput.remove", { name: tag.name })}>
            {tag.name} <span aria-hidden="true">×</span>
          </button>
        ))}
        {newNames.map(name => {
          const color = defaultTagColor();
          const pill = tagPillStyle(color, theme);
          return (
            <button type="button" key={`new:${name}`} className="te-tag on te-tag-new"
                    style={{ ...pill, borderStyle: "dashed" }}
                    onClick={() => onRemoveNew(name)}
                    aria-label={t("tagInput.removeNew", { name })} title={t("tagInput.removeNewTitle", { name })}>
              {name} <span aria-hidden="true">×</span>
            </button>
          );
        })}
      </div>

      <div className="te-tag-combo">
        <input
          className="te-tag-field"
          value={query}
          placeholder={t("tagInput.placeholder")}
          aria-label={t("tagInput.aria")}
          autoComplete="off"
          onChange={e => { setQuery(e.currentTarget.value); setHighlight(0); }}
          onFocus={() => setFocused(true)}
          // Delay blur so a click on an option registers before the list unmounts.
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onKeyDown={onKeyDown}
        />
        {focused && options.length > 0 && (
          <ul className="te-tag-menu" role="listbox">
            {options.map((opt, i) => {
              const isActive = i === active;
              const cls = `te-opt${isActive ? " te-opt-active" : ""}`;
              if (opt.kind === "existing") {
                return (
                  <li key={opt.tag.id} role="option" aria-selected={isActive}>
                    <button type="button" className={cls}
                            style={{ color: normalizeTagHashColor(opt.tag.color, theme) }}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => commit(opt)}>
                      {opt.tag.name}
                    </button>
                  </li>
                );
              }
              return (
                <li key="__create" role="option" aria-selected={isActive}>
                  <button type="button" className={`${cls} te-opt-create`}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => commit(opt)}>
                    {t("tagInput.create", { name: opt.name })}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
