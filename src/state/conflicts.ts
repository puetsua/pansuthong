import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/tauri";

export function useConflicts(): string[] {
  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const list = await api.listConflicts();
        if (mounted) setFiles(list);
      } catch { /* ignore */ }
    };

    void refresh();
    const unlistenPromise = listen<string[]>("conflicts-detected", evt => {
      if (mounted) setFiles(evt.payload);
    });

    return () => {
      mounted = false;
      void unlistenPromise.then(fn => fn());
    };
  }, []);

  return files;
}
