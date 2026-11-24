import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, DataLocation, Settings, SyncStatus, TransferMode } from "../../lib/tauri";
import { errorMessage } from "../../lib/errors";
import { currentLocale } from "../../i18n";
import { isAndroid } from "../../lib/platform";
import { formatDateTime } from "../../lib/dates";
import { dateFormat, timeFormat } from "../../lib/settings";

/**
 * Confirm a data-folder change (WebView2-safe in-app dialog). A folder without
 * Pansuthong data asks whether to keep the old copy (copy / move); a folder that
 * already has data asks whether to merge with it (merge / adopt).
 */
function DataFolderTransferDialog({
  hasData,
  onChoose,
  onCancel,
}: {
  hasData: boolean;
  onChoose: (mode: TransferMode) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [primary, secondary]: [TransferMode, TransferMode] = hasData
    ? ["merge", "adopt"]
    : ["copy", "move"];
  const variant = hasData ? "existing" : "empty";
  useEffect(() => {
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    <div
      className="te-confirm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="data-folder-transfer-title"
      onClick={onCancel}
    >
      <div className="te-confirm-box" onClick={e => e.stopPropagation()}>
        <h2 id="data-folder-transfer-title" className="te-confirm-title">
          {t(`settings.transfer.${variant}.title`)}
        </h2>
        <p>{t(`settings.transfer.${variant}.body`)}</p>
        <p className="view-sub">{t("settings.transfer.peersNote")}</p>
        <div className="te-confirm-actions">
          <button type="button" className="te-confirm-cancel-start" onClick={onCancel}>
            {t("settings.transfer.cancel")}
          </button>
          <button type="button" onClick={() => onChoose(secondary)}>
            {t(`settings.transfer.${secondary}`)}
          </button>
          <button type="button" ref={primaryRef} className="te-save" onClick={() => onChoose(primary)}>
            {t(`settings.transfer.${primary}`)}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DataFolderSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const dateFmt = dateFormat(settings);
  const timeFmt = timeFormat(settings);

  const [android, setAndroid] = useState(false);
  const [loc, setLoc] = useState<DataLocation | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [transferPrompt, setTransferPrompt] =
    useState<{ kind: "set" | "clear"; hasData: boolean } | null>(null);
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);

  useEffect(() => { void isAndroid().then(setAndroid); }, []);
  useEffect(() => { void api.getDataLocation().then(setLoc).catch(() => {}); }, []);
  useEffect(() => { if (android) void api.safStatus().then(setSync).catch(() => {}); }, [android]);

  /** Inspect the target (null = default location), then ask — or do nothing
   *  when it is the folder already in use. */
  const askTransfer = async (kind: "set" | "clear", folder: string | null) => {
    const inspection = await api.inspectDataFolder(folder);
    if (inspection.is_current) {
      // Same folder: nothing moves. Clearing still has to drop the custom-folder
      // setting (it may point at the default dir); merge never deletes anything.
      if (kind === "clear") setLoc(await api.clearDataFolder("merge"));
      return;
    }
    setPendingFolder(folder);
    setTransferPrompt({ kind, hasData: inspection.has_data });
  };
  const pick = async () => {
    setBusy(true); setErr(null);
    try {
      const dir = await api.pickDataFolder();
      if (!dir) return;
      await askTransfer("set", dir);
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true); setErr(null);
    try { await askTransfer("clear", null); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const cancelTransfer = () => {
    setTransferPrompt(null);
    setPendingFolder(null);
  };
  const confirmTransfer = async (mode: TransferMode) => {
    const kind = transferPrompt?.kind;
    const folder = pendingFolder;
    setTransferPrompt(null);
    setPendingFolder(null);
    if (!kind) return;
    setBusy(true); setErr(null);
    try {
      if (kind === "set") {
        if (!folder) return;
        setLoc(await api.setDataFolder(folder, mode));
      } else {
        setLoc(await api.clearDataFolder(mode));
      }
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

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
    <>
      <section className="settings-section settings-section-flow">
        <h2>{t("settings.dataFile")}</h2>
        <p className="view-sub">
          {t("settings.deviceId")}<code>{loc?.device_id ?? "…"}</code>
        </p>
        {/* Desktop: "Folder:" is the sync directory. Android: "Folder:" is the
            local app-data path; "Synced folder:" is the SAF mirror. When SAF is
            linked, hide the local Folder line so the screen matches desktop's
            one-folder UX without mislabeling SAF as Folder (see docs/ui-terms.html). */}
        {!(android && sync?.linked) && (
          <p className="view-sub">
            {t("settings.dataFolder")}<code>{loc?.folder_path ?? "…"}</code>
          </p>
        )}
        {android ? (
          sync?.linked ? (
            <>
              <p className="view-sub">
                {t("settings.syncedFolder")}<code>{sync.folder_label ?? t("settings.linked")}</code>
                {!sync.permission_ok && t("settings.accessLost")}
              </p>
              <p className="view-sub">
                {sync.last_synced_ms
                  ? t("settings.lastSynced", { when: formatDateTime(sync.last_synced_ms, dateFmt, timeFmt, locale) })
                  : t("settings.notSyncedYet")}
                {sync.conflict_count > 0 && t("settings.conflictCount", { count: sync.conflict_count })}
                {sync.last_error && t("settings.syncError", { error: sync.last_error })}
              </p>
              <div className="theme-options">
                <button className="theme-option" disabled={busy} onClick={syncNowSaf}>{t("settings.syncNow")}</button>
                <button className="theme-option" disabled={busy} onClick={pickSaf}>{t("settings.changeFolder")}</button>
                <button className="theme-option" disabled={busy} onClick={unlinkSaf}>{t("settings.unlink")}</button>
              </div>
            </>
          ) : (
            <>
              <p className="view-sub">
                {t("settings.pickFolderHintAndroid")}
              </p>
              <button className="theme-option" disabled={busy} onClick={pickSaf}>{t("settings.pickFolder")}</button>
            </>
          )
        ) : (
          <>
            <p className="view-sub">
              {t("settings.desktopHint")}
            </p>
            <div className="theme-options">
              <button className="theme-option" disabled={busy} onClick={pick}>{t("settings.chooseFolder")}</button>
              {loc?.folder && (
                <button className="theme-option" disabled={busy} onClick={() => { void reset(); }}>{t("settings.useDefault")}</button>
              )}
            </div>
          </>
        )}
        {err && <p className="view-sub" style={{ color: "var(--c-danger)" }}>{err}</p>}
      </section>

      {transferPrompt && (
        <DataFolderTransferDialog
          hasData={transferPrompt.hasData}
          onChoose={mode => { void confirmTransfer(mode); }}
          onCancel={cancelTransfer}
        />
      )}
    </>
  );
}
