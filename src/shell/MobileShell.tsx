import { ReactNode } from "react";
import { Document } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { ConflictBanner } from "../components/ConflictBanner";
import { SyncStatus } from "../components/SyncStatus";
import { MobileHeader } from "./MobileHeader";
import { BottomTabs } from "./BottomTabs";

type Props = { doc: Document; indexes: Indexes; children: ReactNode };

export function MobileShell({ doc, indexes, children }: Props) {
  return (
    <div className="mobile-shell">
      <MobileHeader indexes={indexes} />
      <SyncStatus lastModified={doc.last_modified} className="sync-status-mobile" />
      <main className="mobile-main">
        <ConflictBanner />
        {children}
      </main>
      <BottomTabs indexes={indexes} />
    </div>
  );
}
