import { useEffect, useMemo, useState } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { api, Document } from "../lib/tauri";
import { buildIndexes, Indexes } from "./indexes";

type DocState = { doc: Document | null; indexes: Indexes | null; error: string | null };

export function useDocument(): DocState {
  const [doc, setDoc] = useState<Document | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let unlisten: UnlistenFn | undefined;

    const load = async () => {
      try {
        const d = await api.getDocument();
        if (mounted) setDoc(d);
      } catch (e) {
        if (mounted) setError(String(e));
      }
    };

    void load();
    void listen("store-changed", () => { void load(); }).then(fn => { unlisten = fn; });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const indexes = useMemo(() => (doc ? buildIndexes(doc) : null), [doc]);
  return { doc, indexes, error };
}
