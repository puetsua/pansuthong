import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "./task-editor/dialogs";

type ConfirmRequest = {
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  resolve: (ok: boolean) => void;
};

/**
 * In-app replacement for `window.confirm`: WebView2 shows the native prompt at
 * the top of the window, while this one is centered like every other dialog.
 * Render `dialog` somewhere in the component; `confirm` resolves true on confirm.
 */
export function useConfirm(): [
  (opts: { message: string; confirmLabel: string; cancelLabel?: string }) => Promise<boolean>,
  ReactNode,
] {
  const { t } = useTranslation();
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const pending = useRef<ConfirmRequest | null>(null);
  const confirm = useCallback(
    (opts: { message: string; confirmLabel: string; cancelLabel?: string }) =>
      new Promise<boolean>(resolve => {
        // A replaced request counts as cancelled so its caller never hangs.
        pending.current?.resolve(false);
        const next = { ...opts, resolve };
        pending.current = next;
        setReq(next);
      }),
    [],
  );
  // Unmounting with a prompt open (e.g. the editor closed from outside) cancels it.
  useEffect(() => () => { pending.current?.resolve(false); }, []);
  const finish = (ok: boolean) => {
    req?.resolve(ok);
    pending.current = null;
    setReq(null);
  };
  const dialog = req && (
    <ConfirmDialog
      message={req.message}
      confirmLabel={req.confirmLabel}
      cancelLabel={req.cancelLabel ?? t("common.cancel")}
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    />
  );
  return [confirm, dialog];
}
