import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Settings, Tag } from "../lib/tauri";
import { normalizeTagHashColor } from "../lib/tagColorDisplay";
import { useThemeVariant } from "../lib/useThemeVariant";

type Props = {
  tags: Tag[];
  settings: Pick<Settings, "theme">;
  onSelect: (tag: Tag) => void;
};

/** Searchable popover for pinning an unpinned tag to the Dashboard (#201). */
export function DashboardAddTagPopover({ tags, settings, onSelect }: Props) {
  const { t } = useTranslation();
  const theme = useThemeVariant(settings);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const filtered = tags.filter(tag => !q || tag.name.toLowerCase().includes(q));
  const active = Math.min(highlight, Math.max(filtered.length - 1, 0));

  const close = () => {
    setOpen(false);
    setQuery("");
    setHighlight(0);
  };

  const select = (tag: Tag) => {
    onSelect(tag);
    close();
  };

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      select(filtered[active]);
    }
  };

  return (
    <div className="dashboard-add-popover" ref={rootRef}>
      <button
        type="button"
        className="dashboard-add-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {t("dashboard.addTag")}
      </button>
      {open && (
        <div className="dashboard-add-panel">
          <div className="dashboard-add-search">
            <span className="dashboard-add-search-icon" aria-hidden="true">⌕</span>
            <input
              ref={inputRef}
              type="search"
              className="dashboard-add-search-input"
              placeholder={t("dashboard.searchTags")}
              aria-label={t("dashboard.searchTags")}
              value={query}
              autoComplete="off"
              onChange={e => { setQuery(e.currentTarget.value); setHighlight(0); }}
              onKeyDown={onInputKeyDown}
            />
          </div>
          <ul className="dashboard-add-list" role="listbox" aria-label={t("dashboard.addTag")}>
            {filtered.length === 0 ? (
              <li className="dashboard-add-empty" role="presentation">{t("dashboard.noMatchingTags")}</li>
            ) : filtered.map((tag, i) => {
              const isActive = i === active;
              return (
                <li key={tag.id} role="option" aria-selected={isActive}>
                  <button
                    type="button"
                    className={["dashboard-add-opt", isActive ? "active" : ""].filter(Boolean).join(" ")}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => select(tag)}
                  >
                    <span className="sidebar-hash" aria-hidden="true" style={{ color: normalizeTagHashColor(tag.color, theme) }}>#</span>
                    {tag.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
