import { useState } from "react";
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

type Props = { doc: Document };

export function SettingsView({ doc }: Props) {
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

  return (
    <section className="settings-view">
      <header className="view-header">
        <h1>{t("settings.title")}</h1>
      </header>

      {settingsErr && <p className="composer-error" role="alert">{t("settings.saveError", { error: settingsErr })}</p>}

      <ThemeSettings settings={doc.settings} applySettings={applySettings} />
      <LanguageSection settings={doc.settings} applySettings={applySettings} />
      <DateTimeSection settings={doc.settings} applySettings={applySettings} />
      <SortSection settings={doc.settings} applySettings={applySettings} />
      <UpcomingSection settings={doc.settings} applySettings={applySettings} />
      <DayStartSection settings={doc.settings} applySettings={applySettings} />
      <HeatmapSection settings={doc.settings} applySettings={applySettings} />
      <WeekStartSection settings={doc.settings} applySettings={applySettings} />
      <SoundSection settings={doc.settings} applySettings={applySettings} />
      <ReminderSection settings={doc.settings} applySettings={applySettings} />
      <AttachmentCapSection settings={doc.settings} applySettings={applySettings} />
      <NewTagWeightSection settings={doc.settings} applySettings={applySettings} />
      <DataFolderSection settings={doc.settings} />
    </section>
  );
}
