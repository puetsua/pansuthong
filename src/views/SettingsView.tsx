import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api, Document } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { ThemeSettings } from "../components/ThemeSettings";
import { DataFolderSection } from "../components/settings/DataFolderSection";
import {
  AttachmentCapSection,
  DateTimeSection,
  DayStartSection,
  HeatmapSection,
  LanguageSection,
  NewTagWeightSection,
  ReminderSection,
  SortSection,
  SoundSection,
  UpcomingSection,
  WeekStartSection,
} from "../components/settings/sections";
import { McpSection } from "../components/settings/McpSection";
import { BackgroundSection } from "../components/settings/BackgroundSection";
import { SettingsSection } from "../components/settings/SettingRow";
import { CloseIcon, ListChecksIcon, MonitorIcon, PaletteIcon, SlidersIcon } from "../components/NavIcons";
import { OPEN_SETTINGS_DRAWER } from "../lib/settingsRoute";

const GROUPS = ["general", "appearance", "tasks", "system"] as const;
type GroupId = (typeof GROUPS)[number];

const GROUP_ICONS: Record<GroupId, ComponentType<{ size?: number }>> = {
  general: SlidersIcon,
  appearance: PaletteIcon,
  tasks: ListChecksIcon,
  system: MonitorIcon,
};

const tabId = (g: GroupId) => `settings-tab-${g}`;
const panelId = (g: GroupId) => `settings-panel-${g}`;

type Props = {
  doc: Document;
  /** Shown as a close button when Settings is opened as a panel over the app. */
  onClose?: () => void;
};

/** Settings, one category at a time: category tabs beside (or above, on a
 *  phone) a card of that category's settings. */
export function SettingsView({ doc, onClose }: Props) {
  const { t } = useTranslation();
  // Settings writes used to be fire-and-forget; surface a failure so a click that
  // didn't stick is visible rather than silently swallowed (#51).
  const [settingsErr, setSettingsErr] = useState<string | null>(null);
  const applySettings = async (patch: Parameters<typeof api.updateSettings>[0]) => {
    setSettingsErr(null);
    try {
      await api.updateSettings(patch);
    } catch (e) {
      setSettingsErr(errorMessage(e));
    }
  };

  const [active, setActive] = useState<GroupId>("general");
  // Phone: the categories live in a side drawer opened by the header's ☰.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const open = () => setDrawerOpen(true);
    window.addEventListener(OPEN_SETTINGS_DRAWER, open);
    return () => window.removeEventListener(OPEN_SETTINGS_DRAWER, open);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setDrawerOpen(false); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drawerOpen]);

  const select = (g: GroupId) => {
    setActive(g);
    setDrawerOpen(false);
    // Start each category at its top: the panel body scrolls on desktop, the
    // whole page (.mobile-main) on a phone.
    bodyRef.current?.scrollTo?.({ top: 0 });
    bodyRef.current?.closest(".mobile-main")?.scrollTo?.({ top: 0 });
  };

  // Arrow keys move between tabs (roving focus, as in the ARIA tabs pattern).
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1
      : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    const edge = e.key === "Home" ? GROUPS[0] : e.key === "End" ? GROUPS[GROUPS.length - 1] : null;
    if (!step && !edge) return;
    e.preventDefault();
    const next = edge ?? GROUPS[(GROUPS.indexOf(active) + step + GROUPS.length) % GROUPS.length];
    select(next);
    document.getElementById(tabId(next))?.focus();
  };

  const s = doc.settings;
  const content: Record<GroupId, ReactNode> = {
    // Every card is a titled section. Theme, Date & time format, Background,
    // MCP and Data file render their own.
    general: <>
      <SettingsSection title={t("settings.sections.language")}>
        <LanguageSection settings={s} applySettings={applySettings} />
      </SettingsSection>
      <DateTimeSection settings={s} applySettings={applySettings} />
      <SettingsSection title={t("settings.sections.dayWeek")}>
        <DayStartSection settings={s} applySettings={applySettings} />
        <WeekStartSection settings={s} applySettings={applySettings} />
      </SettingsSection>
      <SettingsSection title={t("settings.sections.soundReminders")}>
        <SoundSection settings={s} applySettings={applySettings} />
        <ReminderSection settings={s} applySettings={applySettings} />
      </SettingsSection>
    </>,
    appearance: <ThemeSettings settings={s} applySettings={applySettings} />,
    tasks: <>
      <SettingsSection title={t("settings.sections.views")}>
        <SortSection settings={s} applySettings={applySettings} />
        <UpcomingSection settings={s} applySettings={applySettings} />
        <HeatmapSection settings={s} applySettings={applySettings} />
      </SettingsSection>
      <SettingsSection title={t("settings.sections.tagsAttachments")}>
        <NewTagWeightSection settings={s} applySettings={applySettings} />
        <AttachmentCapSection settings={s} applySettings={applySettings} />
      </SettingsSection>
    </>,
    system: <>
      <BackgroundSection settings={s} />
      <McpSection settings={s} applySettings={applySettings} />
      <DataFolderSection settings={s} />
    </>,
  };

  return (
    <section className={`settings-view${onClose ? " settings-view-panel" : ""}`}>
      {drawerOpen && <div className="settings-drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
      <div className={`settings-side${drawerOpen ? " open" : ""}`}>
        <h1 id="settings-title" className="settings-title">{t("settings.title")}</h1>
        <div className="settings-nav" role="tablist" aria-label={t("settings.groups.navLabel")} aria-orientation="vertical">
          {GROUPS.map(g => {
            const Icon = GROUP_ICONS[g];
            return (
              <button
                key={g}
                id={tabId(g)}
                type="button"
                role="tab"
                aria-selected={active === g}
                aria-controls={panelId(g)}
                tabIndex={active === g ? 0 : -1}
                className={`settings-nav-item${active === g ? " active" : ""}`}
                onClick={() => select(g)}
                onKeyDown={onTabKey}
              >
                <Icon size={16} />
                <span>{t(`settings.groups.${g}`)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="settings-main">
        <header className="settings-main-header">
          <h2 className="settings-group-title">{t(`settings.groups.${active}`)}</h2>
          {onClose && (
            <button type="button" className="settings-close" aria-label={t("app.close")} onClick={onClose}>
              <CloseIcon size={18} />
            </button>
          )}
        </header>
        <div className="settings-body" ref={bodyRef}>
          {settingsErr && <p className="composer-error" role="alert">{t("settings.saveError", { error: settingsErr })}</p>}
          {/* Every group stays mounted so drafts and live status survive a tab switch. */}
          {GROUPS.map(g => (
            <div
              key={g}
              id={panelId(g)}
              role="tabpanel"
              aria-labelledby={tabId(g)}
              className="settings-panel"
              hidden={active !== g}
            >
              {content[g]}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Settings as a panel over the current view (desktop). Escape, the close
 *  button, or a click outside the panel closes it. */
export function SettingsModal({ doc, onClose }: { doc: Document; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => { previous?.focus?.(); };
  }, []);

  // Only Escape pressed inside the panel itself: nested dialogs (theme picker,
  // data-folder prompt) handle their own Escape first.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (!panelRef.current?.contains(e.target as Node)) return;
    e.preventDefault();
    onClose();
  };

  return createPortal(
    <div className="settings-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <SettingsView doc={doc} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}
