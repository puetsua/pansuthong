import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Desktop-only custom chrome: icon + drag region + window controls. */
export function DesktopTitlebar() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    const syncMaximized = async () => {
      try {
        const next = await getCurrentWindow().isMaximized();
        if (active) setMaximized(next);
      } catch {
        // Outside Tauri (tests / browser preview) — leave restored.
      }
    };

    // Belt-and-suspenders: window-state used to restore decorations=true and
    // override tauri.conf.json. Force frameless once on mount.
    void getCurrentWindow().setDecorations(false).catch(() => { /* non-Tauri */ });
    void syncMaximized();
    void getCurrentWindow()
      .onResized(() => { void syncMaximized(); })
      .then(fn => { unlisten = fn; })
      .catch(() => { /* non-Tauri */ });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const toggleMaximize = () => {
    const win = getCurrentWindow();
    void win.toggleMaximize().then(async () => {
      try { setMaximized(await win.isMaximized()); } catch { /* ignore */ }
    }).catch(() => { /* non-Tauri */ });
  };

  return (
    <header className="desktop-titlebar">
      {/*
        Single drag/maximize path: Tauri injects drag.js on
        data-tauri-drag-region (mousedown drag; second mousedown toggles
        maximize on Windows + Linux). Do not also attach startDragging /
        onDoubleClick or CSS app-region — those stack with the injected
        listener and double-toggle maximize. Controls are siblings, not
        inside the drag region.
      */}
      <div className="desktop-titlebar-drag" data-tauri-drag-region>
        <img
          className="desktop-titlebar-icon"
          src="/app-icon.png"
          alt=""
          width={16}
          height={16}
          draggable={false}
        />
      </div>
      <div
        className="desktop-titlebar-controls"
        onMouseDown={e => e.stopPropagation()}
      >
        <button
          type="button"
          className="desktop-titlebar-btn"
          title={t("titlebar.minimize")}
          aria-label={t("titlebar.minimize")}
          onClick={() => { void getCurrentWindow().minimize().catch(() => {}); }}
        >
          <MinimizeIcon />
        </button>
        <button
          type="button"
          className="desktop-titlebar-btn"
          title={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
          aria-label={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
          onClick={toggleMaximize}
        >
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button
          type="button"
          className="desktop-titlebar-btn desktop-titlebar-btn-close"
          title={t("titlebar.close")}
          aria-label={t("titlebar.close")}
          onClick={() => { void getCurrentWindow().close().catch(() => {}); }}
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}

function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path fill="currentColor" d="M0 5h10v1H0z" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path fill="currentColor" d="M0 0h10v10H0zm1 1v8h8V1z" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2 0v2H0v8h8V8h2V0zm1 1h6v6H8V2H3zM1 3h6v6H1z"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        fill="currentColor"
        d="M1.1 0L0 1.1 3.9 5 0 8.9 1.1 10 5 6.1 8.9 10 10 8.9 6.1 5 10 1.1 8.9 0 5 3.9z"
      />
    </svg>
  );
}
