import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { applyLanguage, resolveLanguage } from "./i18n";
import { osLocale } from "./lib/platform";
import { DesktopShell } from "./shell/DesktopShell";
import { MobileShell } from "./shell/MobileShell";
import { useIsMobile } from "./lib/viewport";
import { TodayView } from "./views/TodayView";
import { InboxView } from "./views/InboxView";
import { TagView } from "./views/TagView";
import { UpcomingView } from "./views/UpcomingView";
import { SettingsView } from "./views/SettingsView";
import { TagsView } from "./views/TagsView";
import { ArchivedView } from "./views/ArchivedView";
import { TemplatesView } from "./views/TemplatesView";
import { ConflictsView } from "./views/ConflictsView";
import { HistoryView } from "./views/HistoryView";
import { useDocument } from "./state/store";
import { setCompletionSoundEnabled } from "./lib/sound";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { TimeEstimateReminder } from "./components/TimeEstimateReminder";

export default function App() {
  const { t } = useTranslation();
  const { doc, indexes, error, reloadError, dismissReloadError } = useDocument();
  const isMobile = useIsMobile();

  // Apply the chosen UI language ("auto" follows the OS locale) whenever the
  // setting changes; switching here re-renders the whole tree in the new language (#26).
  const language = doc?.settings.language;
  useEffect(() => {
    let active = true;
    void osLocale().then(loc => {
      if (active) applyLanguage(resolveLanguage(language, loc));
    });
    return () => { active = false; };
  }, [language]);

  // Mirror the device-local completion-sound preference into the sound module so
  // TaskRow can chime without threading settings through every view (#80). Absent
  // = on, matching the Rust default.
  useEffect(() => {
    setCompletionSoundEnabled(doc?.settings.sound_on_complete ?? true);
  }, [doc?.settings.sound_on_complete]);

  if (error) return <p className="app-error">{t("app.loadFailed", { error })}</p>;
  if (!doc || !indexes) return <p className="app-loading">{t("app.loading")}</p>;

  const Shell = isMobile ? MobileShell : DesktopShell;

  return (
    <BrowserRouter>
      <Shell doc={doc} indexes={indexes}>
        <UpdatePrompt />
        <TimeEstimateReminder tasks={doc.tasks} />
        {reloadError && (
          <div className="reload-banner" role="alert">
            <span>{t("app.reloadError", { error: reloadError })}</span>
            <button type="button" className="reload-banner-dismiss" onClick={dismissReloadError}>
              {t("app.dismiss")}
            </button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<TodayView doc={doc} indexes={indexes} />} />
          <Route path="/inbox" element={<InboxView doc={doc} indexes={indexes} />} />
          <Route path="/tag/:id"     element={<TagView doc={doc} indexes={indexes} />} />
          <Route path="/upcoming" element={<UpcomingView doc={doc} indexes={indexes} />} />
          <Route path="/settings" element={<SettingsView doc={doc} />} />
          <Route path="/tags" element={<TagsView doc={doc} indexes={indexes} />} />
          <Route path="/archived" element={<ArchivedView doc={doc} indexes={indexes} />} />
          <Route path="/templates" element={<TemplatesView doc={doc} indexes={indexes} />} />
          <Route path="/history" element={<HistoryView todayIso={indexes.todayIso} />} />
          <Route path="/conflicts/:filename" element={<ConflictsView />} />
          <Route path="*"      element={<p>{t("app.notBuilt")}</p>} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
