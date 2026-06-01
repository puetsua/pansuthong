import { useState } from "react";
import { api } from "../lib/tauri";
import { formatIsoLocal } from "../lib/dates";

type Props = {
  /** doc.last_modified — ISO-8601 local time w/ offset of the last edit (undefined = never). */
  lastModified: string | undefined;
  /** Extra class for layout (e.g. "sync-status-mobile"). */
  className?: string;
};

/**
 * "Last synced" indicator + manual "Sync now" button. The button forces an
 * immediate re-read of tasks.json from disk; if it changed, the backend emits
 * `store-changed` and the document store reloads on its own. Shared by the
 * desktop sidebar and the mobile shell.
 */
export function SyncStatus({ lastModified, className }: Props) {
  const [syncing, setSyncing] = useState(false);

  const sync = async () => {
    setSyncing(true);
    try {
      await api.syncNow();
    } catch {
      // Best-effort: the polling fallback will catch the change shortly anyway.
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className={className ? `sync-status ${className}` : "sync-status"}>
      <button
        type="button"
        className="sync-now-btn"
        onClick={sync}
        disabled={syncing}
        title="Re-read data from disk now"
      >
        <span className={syncing ? "sync-icon spinning" : "sync-icon"} aria-hidden>⟳</span>
        {syncing ? "Syncing…" : "Sync now"}
      </button>
      <span className="sync-time" title="Data last edited (this view)">
        Last synced: <time>{formatIsoLocal(lastModified)}</time>
      </span>
    </div>
  );
}
