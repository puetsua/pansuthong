import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { exit } from "@tauri-apps/plugin-process";
import { applyLanguage, resolveLanguage } from "./i18n";
import { osLocale } from "./lib/platform";
import { DesktopShell } from "./shell/DesktopShell";
import { DesktopTitlebar } from "./shell/DesktopTitlebar";
import { MobileShell } from "./shell/MobileShell";
import { useIsMobile } from "./lib/viewport";
import { TodayView } from "./views/TodayView";
import { InboxView } from "./views/InboxView";
import { TagView } from "./views/TagView";
import { UpcomingView } from "./views/UpcomingView";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";
import { TagsView } from "./views/TagsView";
import { ArchivedView } from "./views/ArchivedView";
import { TemplatesView } from "./views/TemplatesView";
import { DashboardView } from "./views/DashboardView";
import { ConflictsView } from "./views/ConflictsView";
import { HistoryView } from "./views/HistoryView";
import { useDocument } from "./state/store";
import { setCompletionSoundEnabled } from "./lib/sound";
import { currentDateFormat, currentTimeFormat, setDateFormat, setTimeFormat } from "./lib/dates";
import { dateFormat, reminderIntervalMinutes, timeFormat } from "./lib/settings";
import { api } from "./lib/tauri";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { TimeEstimateReminder } from "./components/TimeEstimateReminder";

export default function App() {
  const { t } = useTranslation();
  const { doc, indexes, error, reloadError, dismissReloadError, waitingForData, retryCount, nextRetryIn, showFallback, gaveUp, createNewData } = useDocument();
  const isMobile = useIsMobile();
  const didShowWindow = useRef(false);

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

  // Mirror the device-local date/time format preferences into the dates module so
  // any component can format dates and instants with the user's chosen presets without
  // threading settings through every layer (#date-time-format).
  useEffect(() => {
    const nextDate = dateFormat(doc?.settings);
    const nextTime = timeFormat(doc?.settings);
    if (nextDate !== currentDateFormat()) setDateFormat(nextDate);
    if (nextTime !== currentTimeFormat()) setTimeFormat(nextTime);
  }, [doc?.settings]);

  // The native window starts hidden so persisted position/size and WebView2 can
  // settle off-screen. This effect follows the theme effect in useDocument; two
  // animation frames ensure the first themed success, waiting, give-up, or error
  // UI has painted before revealing the window.
  //
  // WebKitGTK may never fire rAF while the window is unmapped (#167), so Linux
  // also maps the window from Rust. A long timeout is a frontend fallback in
  // case timers run but frames do not; it is well after a healthy Windows paint
  // so it does not reintroduce a WebView2 flash.
  useEffect(() => {
    if (didShowWindow.current || (!error && !waitingForData && !showFallback && !gaveUp && (!doc || !indexes))) return;

    let cancelled = false;
    let secondFrame: number | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    function reveal() {
      if (didShowWindow.current || cancelled) return;
      clearTimeout(fallbackTimer);
      void api.showMainWindow()
        .then(() => {
          if (!cancelled) didShowWindow.current = true;
        })
        .catch(() => {
          if (!cancelled) retryTimer = setTimeout(reveal, 250);
        });
    }
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        reveal();
      });
    });
    const fallbackTimer = setTimeout(reveal, 1000);

    return () => {
      cancelled = true;
      cancelAnimationFrame(firstFrame);
      if (secondFrame != null) cancelAnimationFrame(secondFrame);
      if (retryTimer != null) clearTimeout(retryTimer);
      clearTimeout(fallbackTimer);
    };
  }, [doc, indexes, error, waitingForData, showFallback, gaveUp]);

  const bootScreen = (body: React.ReactNode) => isMobile ? body : (
    <div className="desktop-shell">
      <DesktopTitlebar />
      {body}
    </div>
  );

  if (error) return bootScreen(<p className="app-error">{t("app.loadFailed", { error })}</p>);
  if (waitingForData || showFallback || gaveUp) {
    return bootScreen(
      <div className={`app-loading${showFallback ? " app-loading-with-actions" : ""}`}>
        {!gaveUp && <span className="app-loading-spinner" aria-hidden="true" />}
        <p className="app-loading-title">
          {gaveUp ? t("app.dataFolderGiveUp") : t("app.waitingForData")}
        </p>
        {retryCount >= 2 && (
          <p className="app-loading-retry">
            {gaveUp
              ? t("app.retryFinished", { count: retryCount, total: 10 })
              : t("app.retryStatus", { count: retryCount, total: 10, seconds: nextRetryIn })}
          </p>
        )}
        {showFallback && (
          <div className="app-loading-actions">
            <button type="button" className="app-loading-btn" onClick={() => { void createNewData(); }}>
              {t("app.useDefaultLocation")}
            </button>
            {!isMobile && (
              <button type="button" className="app-loading-btn app-loading-btn-secondary" onClick={() => { void exit(); }}>
                {t("app.close")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  if (!doc || !indexes) return bootScreen(<p className="app-loading">{t("app.loading")}</p>);

  const Shell = isMobile ? MobileShell : DesktopShell;

  return (
    <BrowserRouter>
      <Shell doc={doc} indexes={indexes}>
        <UpdatePrompt />
        <TimeEstimateReminder tasks={doc.tasks} intervalMinutes={reminderIntervalMinutes(doc.settings)} />
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
          <Route path="/search" element={<SearchView doc={doc} indexes={indexes} />} />
          <Route path="/settings" element={<SettingsView doc={doc} />} />
          <Route path="/tags" element={<TagsView doc={doc} indexes={indexes} />} />
          <Route path="/archived" element={<ArchivedView doc={doc} indexes={indexes} />} />
          <Route path="/templates" element={<TemplatesView doc={doc} indexes={indexes} />} />
          <Route path="/dashboard" element={<DashboardView doc={doc} indexes={indexes} />} />
          <Route path="/recurrence" element={<Navigate to="/dashboard" replace />} />
          <Route path="/history" element={<HistoryView todayIso={indexes.todayIso} />} />
          <Route path="/conflicts/:filename" element={<ConflictsView />} />
          <Route path="*"      element={<p>{t("app.notBuilt")}</p>} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
