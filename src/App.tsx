import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DesktopShell } from "./shell/DesktopShell";
import { TodayView } from "./views/TodayView";
import { InboxView } from "./views/InboxView";
import { ProjectView } from "./views/ProjectView";
import { TagView } from "./views/TagView";
import { useDocument } from "./state/store";

export default function App() {
  const { doc, indexes, error } = useDocument();

  if (error) return <p className="app-error">Failed to load: {error}</p>;
  if (!doc || !indexes) return <p className="app-loading">Loading…</p>;

  return (
    <BrowserRouter>
      <DesktopShell doc={doc} indexes={indexes}>
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<TodayView doc={doc} indexes={indexes} />} />
          <Route path="/inbox" element={<InboxView doc={doc} indexes={indexes} />} />
          <Route path="/project/:id" element={<ProjectView indexes={indexes} />} />
          <Route path="/tag/:id"     element={<TagView indexes={indexes} />} />
          <Route path="*"      element={<p>Not built yet — comes in Phase 2.</p>} />
        </Routes>
      </DesktopShell>
    </BrowserRouter>
  );
}
