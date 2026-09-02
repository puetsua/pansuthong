import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { appVersion } from "../lib/platform";
import { getPendingUpdate, requestUpdatePrompt, subscribeToPendingUpdate } from "../lib/updater";

const RELEASES_BASE = "https://github.com/puetsua/pansuthong/releases/tag/";

/** Running version plus the pending-update re-entry. Either half can be missing. */
export function AppVersionRow({ className }: { className?: string }) {
  const { t } = useTranslation();
  const pending = useSyncExternalStore(subscribeToPendingUpdate, getPendingUpdate);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void appVersion().then(v => { if (active) setVersion(v); });
    return () => { active = false; };
  }, []);

  if (!version && !pending) return null;

  return (
    <div className={className ? `sidebar-version-row ${className}` : "sidebar-version-row"}>
      {version && (
        <button type="button" className="sidebar-version"
                title={t("sidebar.releaseNotes", { version })}
                onClick={() => void openUrl(RELEASES_BASE + version)}>
          v{version}
        </button>
      )}
      {pending && (
        <button type="button" className="sidebar-version-update"
                title={t("sidebar.updateTo", { version: pending.version })}
                onClick={requestUpdatePrompt}>
          {t("sidebar.update")}
        </button>
      )}
    </div>
  );
}
