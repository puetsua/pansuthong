import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, DataLocation, Document } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { isAndroid } from "../lib/platform";
import { Indexes } from "../state/indexes";
import { clampUpcomingDays, upcomingDays, UPCOMING_DAYS_MAX, UPCOMING_DAYS_MIN } from "../lib/settings";

type Props = { doc: Document; indexes: Indexes };

export function SettingsView({ doc, indexes }: Props) {
  const theme = doc.settings.theme;
  const setTheme = (t: "auto" | "light" | "dark") => { void api.updateSettings({ theme: t }); };

  const sortOrder = doc.settings.sort_order;
  const setSort = (s: "priority" | "date") => { void api.updateSettings({ sort_order: s }); };

  // Upcoming horizon: presets apply immediately; the free input commits on blur/Enter.
  const days = upcomingDays(doc.settings);
  const [draftDays, setDraftDays] = useState(String(days));
  useEffect(() => { setDraftDays(String(days)); }, [days]); // resync when the doc changes
  const setUpcoming = (n: number) => { void api.updateSettings({ upcoming_days: n }); };
  const commitDraftDays = () => {
    const n = clampUpcomingDays(draftDays);
    setDraftDays(String(n));
    if (n !== days) setUpcoming(n);
  };

  const archivedCount = indexes.archived.length;

  const [android, setAndroid] = useState(false);
  const [loc, setLoc] = useState<DataLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { void isAndroid().then(setAndroid); }, []);
  useEffect(() => { void api.getDataLocation().then(setLoc).catch(() => {}); }, []);

  const pick = async () => {
    setBusy(true); setErr(null);
    try {
      const next = await api.pickAndSetDataFolder();
      if (next) setLoc(next);
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true); setErr(null);
    try { setLoc(await api.clearDataFolder()); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

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
              aria-pressed={theme === t}
              onClick={() => setTheme(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>Sort order</h2>
        <p className="view-sub">
          How task lists are ordered. Priority sorts by the highest weight among a task's tags.
        </p>
        <div className="theme-options">
          {(["priority", "date"] as const).map(s => (
            <button
              key={s}
              className={`theme-option ${sortOrder === s ? "active" : ""}`}
              aria-pressed={sortOrder === s}
              onClick={() => setSort(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>Upcoming range</h2>
        <p className="view-sub">How many days ahead the Upcoming view looks.</p>
        <div className="theme-options">
          {[7, 14, 30].map(n => (
            <button
              key={n}
              className={`theme-option ${days === n ? "active" : ""}`}
              aria-pressed={days === n}
              onClick={() => setUpcoming(n)}
            >
              {n} days
            </button>
          ))}
          <input
            type="number"
            className="weight-input"
            aria-label="Custom upcoming days"
            min={UPCOMING_DAYS_MIN}
            max={UPCOMING_DAYS_MAX}
            value={draftDays}
            onChange={e => setDraftDays(e.currentTarget.value)}
            onBlur={commitDraftDays}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
        </div>
      </section>

      <section className="settings-section">
        <h2>Archived tasks</h2>
        <p className="view-sub">Completed tasks you’ve tucked out of the active lists.</p>
        <Link to="/archived" className="theme-option">
          View archived{archivedCount > 0 ? ` (${archivedCount})` : ""}
        </Link>
      </section>

      <section className="settings-section">
        <h2>Data file</h2>
        <p className="view-sub">
          Tasks persist to: <code>{loc?.effective_path ?? "…"}</code>
        </p>
        {android ? (
          <p className="view-sub">
            On Android, use the in-app sync folder (Android storage access), not this picker.
          </p>
        ) : (
          <>
            <p className="view-sub">
              Point this at a Syncthing-managed folder to sync across devices. On first link it
              adopts that folder's <code>tasks.json</code> if present, otherwise it seeds it.
            </p>
            <div className="theme-options">
              <button className="theme-option" disabled={busy} onClick={pick}>Choose folder…</button>
              {loc?.folder && (
                <button className="theme-option" disabled={busy} onClick={reset}>Use default location</button>
              )}
            </div>
            {err && <p className="view-sub" style={{ color: "var(--c-danger)" }}>{err}</p>}
          </>
        )}
      </section>
    </section>
  );
}
