import { api, Document } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { ProjectManager } from "./settings/ProjectManager";
import { TagManager } from "./settings/TagManager";

type Props = { doc: Document; indexes: Indexes };

export function SettingsView({ doc, indexes: _indexes }: Props) {
  const theme = doc.settings.theme;
  const setTheme = (t: "auto" | "light" | "dark") => { void api.updateSettings({ theme: t }); };

  return (
    <section>
      <header className="view-header">
        <h1>Settings</h1>
      </header>

      <section className="settings-section">
        <h2>Theme</h2>
        <div className="theme-options">
          {(["auto", "light", "dark"] as const).map(t => (
            <button
              key={t}
              className={`theme-option ${theme === t ? "active" : ""}`}
              onClick={() => setTheme(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      <ProjectManager projects={doc.projects} />
      <TagManager tags={doc.tags} projects={doc.projects} />

      <section className="settings-section">
        <h2>Data file</h2>
        <p className="view-sub">
          Tasks persist to:&nbsp;
          <code>{doc.settings.data_file ?? "(default app data directory)"}</code>
        </p>
        <p className="view-sub">
          Custom paths come in Phase 2-sync. Use the default location for now.
        </p>
      </section>
    </section>
  );
}
