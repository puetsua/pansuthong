import { useEffect, useState } from "react";
import { api, DataLocation, Document, SyncStatus } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { isAndroid } from "../lib/platform";
import {
  clampUpcomingDays, upcomingDays, UPCOMING_DAYS_MAX, UPCOMING_DAYS_MIN,
  dayStartHour, DAY_START_HOUR_MAX, DAY_START_HOUR_MIN,
  defaultTagPriority,
} from "../lib/settings";
import { clampWeight, WEIGHT_MAX, WEIGHT_MIN } from "../lib/tags";

type Props = { doc: Document };

/** A 24-hour clock hour as a friendly label, e.g. 0 -> "12:00 AM", 16 -> "4:00 PM". */
function hourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${period}`;
}

export function SettingsView({ doc }: Props) {
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

  const theme = doc.settings.theme;
  const setTheme = (t: "auto" | "light" | "dark") => { void applySettings({ theme: t }); };

  const sortOrder = doc.settings.sort_order;
  const setSort = (s: "priority" | "date") => { void applySettings({ sort_order: s }); };

  // Upcoming horizon: presets apply immediately; the free input commits on blur/Enter.
  const days = upcomingDays(doc.settings);
  const [draftDays, setDraftDays] = useState(String(days));
  useEffect(() => { setDraftDays(String(days)); }, [days]); // resync when the doc changes
  const setUpcoming = (n: number) => { void applySettings({ upcoming_days: n }); };
  const commitDraftDays = () => {
    const n = clampUpcomingDays(draftDays);
    setDraftDays(String(n));
    if (n !== days) setUpcoming(n);
  };

  // Day-start hour: the Today view rolls over at this hour instead of midnight,
  // for people who treat the late-night hours as still "yesterday".
  const startHour = dayStartHour(doc.settings);
  const setStartHour = (h: number) => { void applySettings({ day_start_hour: h }); };

  // New-tag default weight (#79): commits on blur/Enter. (The default color is
  // fixed, not user-configurable — new tags start from a neutral gray.)
  const newTagWeight = defaultTagPriority(doc.settings);
  const [draftTagWeight, setDraftTagWeight] = useState(String(newTagWeight));
  useEffect(() => { setDraftTagWeight(String(newTagWeight)); }, [newTagWeight]);
  const commitDraftTagWeight = () => {
    const n = clampWeight(draftTagWeight);
    setDraftTagWeight(String(n));
    if (n !== newTagWeight) void applySettings({ default_tag_priority: n });
  };

  const [android, setAndroid] = useState(false);
  const [loc, setLoc] = useState<DataLocation | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { void isAndroid().then(setAndroid); }, []);
  useEffect(() => { void api.getDataLocation().then(setLoc).catch(() => {}); }, []);
  useEffect(() => { if (android) void api.safStatus().then(setSync).catch(() => {}); }, [android]);

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

  // Android SAF folder sync (#Phase 4B).
  const pickSaf = async () => {
    setBusy(true); setErr(null);
    try { setSync(await api.safPickFolder()); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const syncNowSaf = async () => {
    setBusy(true); setErr(null);
    try { setSync(await api.safSyncNow()); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const unlinkSaf = async () => {
    setBusy(true); setErr(null);
    try { await api.safClearFolder(); setSync(await api.safStatus()); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <section>
      <header className="view-header">
        <h1>Settings</h1>
      </header>

      {settingsErr && <p className="composer-error" role="alert">Couldn’t save setting: {settingsErr}</p>}

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
        <h2>Day start</h2>
        <p className="view-sub">
          When the Today view rolls over to the next day. Set this later than midnight if
          you work past midnight and still consider it the same day.
        </p>
        <label className="te-field">
          <span>Day starts at</span>
          <select
            className="weight-input"
            aria-label="Day start hour"
            value={startHour}
            onChange={e => setStartHour(Number(e.currentTarget.value))}
          >
            {Array.from({ length: DAY_START_HOUR_MAX - DAY_START_HOUR_MIN + 1 }, (_, i) => i + DAY_START_HOUR_MIN).map(h => (
              <option key={h} value={h}>
                {hourLabel(h)}{h === 0 ? " (midnight)" : ""}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="settings-section">
        <h2>New tag weight</h2>
        <p className="view-sub">The priority weight pre-filled when you create a new tag.</p>
        <label className="te-field">
          <span>Weight</span>
          <input
            type="number"
            className="weight-input"
            min={WEIGHT_MIN}
            max={WEIGHT_MAX}
            value={draftTagWeight}
            onChange={e => setDraftTagWeight(e.currentTarget.value)}
            onBlur={commitDraftTagWeight}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
        </label>
      </section>

      <section className="settings-section">
        <h2>Data file</h2>
        <p className="view-sub">
          Tasks persist to: <code>{loc?.effective_path ?? "…"}</code>
        </p>
        {android ? (
          sync?.linked ? (
            <>
              <p className="view-sub">
                Synced folder: <code>{sync.folder_label ?? "(linked)"}</code>
                {!sync.permission_ok && " — access lost, re-pick the folder"}
              </p>
              <p className="view-sub">
                {sync.last_synced_ms
                  ? `Last synced ${new Date(sync.last_synced_ms).toLocaleString()}`
                  : "Not synced yet"}
                {sync.conflict_count > 0 && ` · ${sync.conflict_count} conflict(s)`}
                {sync.last_error && ` · error: ${sync.last_error}`}
              </p>
              <div className="theme-options">
                <button className="theme-option" disabled={busy} onClick={syncNowSaf}>Sync now</button>
                <button className="theme-option" disabled={busy} onClick={pickSaf}>Change folder…</button>
                <button className="theme-option" disabled={busy} onClick={unlinkSaf}>Unlink</button>
              </div>
            </>
          ) : (
            <>
              <p className="view-sub">
                Pick a Syncthing- or Drive-synced folder to keep tasks in sync across devices. On
                first link it adopts that folder's <code>tasks.json</code> if present, otherwise it
                seeds it.
              </p>
              <button className="theme-option" disabled={busy} onClick={pickSaf}>Pick folder…</button>
            </>
          )
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
          </>
        )}
        {err && <p className="view-sub" style={{ color: "var(--c-danger)" }}>{err}</p>}
      </section>
    </section>
  );
}
