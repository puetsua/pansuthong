import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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

export default function App() {
  const { doc, indexes, error, reloadError, dismissReloadError } = useDocument();
  const isMobile = useIsMobile();

  if (error) return <p className="app-error">Failed to load: {error}</p>;
  if (!doc || !indexes) return <p className="app-loading">Loading…</p>;

  const Shell = isMobile ? MobileShell : DesktopShell;

  return (
    <BrowserRouter>
      <Shell doc={doc} indexes={indexes}>
        {reloadError && (
          <div className="reload-banner" role="alert">
            <span>Couldn’t refresh — showing the last loaded data. {reloadError}</span>
            <button type="button" className="reload-banner-dismiss" onClick={dismissReloadError}>
              Dismiss
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
          <Route path="/history" element={<HistoryView />} />
          <Route path="/conflicts/:filename" element={<ConflictsView />} />
          <Route path="*"      element={<p>Not built yet — comes in Phase 2.</p>} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
