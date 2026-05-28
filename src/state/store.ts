import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, Document } from "../lib/tauri";
import { buildIndexes, Indexes } from "./indexes";

type DocState = { doc: Document | null; indexes: Indexes | null; error: string | null };

export function useDocument(): DocState {
  const [doc, setDoc] = useState<Document | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const d = await api.getDocument();
        if (mounted) setDoc(d);
      } catch (e) {
        if (mounted) setError(String(e));
      }
    };

    const unlistenPromise = listen("store-changed", () => { void load(); });
    void load();

    return () => {
      mounted = false;
      void unlistenPromise.then(fn => fn());
    };
  }, []);

  useEffect(() => {
    const theme = doc?.settings.theme ?? "auto";
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else                  document.documentElement.setAttribute("data-theme", theme);
  }, [doc?.settings.theme]);

  const indexes = useMemo(() => (doc ? buildIndexes(doc) : null), [doc]);
  return { doc, indexes, error };
}
