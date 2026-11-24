import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { api } from "../lib/tauri";
import { isAndroid } from "../lib/platform";

/** Device-local flag: the one-time "still running in the tray" notice was shown. */
export const TRAY_NOTICE_KEY = "pansuthong.trayNoticeShown";

function noticeShown(): boolean {
  try {
    return localStorage.getItem(TRAY_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

function markNoticeShown(): void {
  try {
    localStorage.setItem(TRAY_NOTICE_KEY, "1");
  } catch {
    // Storage blocked: the notice may show again next time.
  }
}

/** Desktop tray glue (#252): translated tray menu and the first-close notice. */
export function TrayIntegration() {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    void isAndroid().then(android => {
      if (android) return;
      void api.setTrayLabels(t("tray.show"), t("tray.quit")).catch(() => {});
    });
  }, [t, i18n.language]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void isAndroid().then(android => {
      if (android || cancelled) return;
      void api.onHiddenToTray(() => {
        if (noticeShown()) return;
        void isPermissionGranted().then(granted => {
          if (!granted || noticeShown()) return;
          markNoticeShown();
          sendNotification({ title: t("tray.noticeTitle"), body: t("tray.noticeBody") });
        }).catch(() => {});
      })
        .then(un => { if (cancelled) un(); else unlisten = un; })
        .catch(() => {});
    });
    return () => { cancelled = true; unlisten?.(); };
  }, [t]);

  return null;
}
