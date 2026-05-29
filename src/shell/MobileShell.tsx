import { ReactNode } from "react";
import { Document } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { MobileHeader } from "./MobileHeader";
import { BottomTabs } from "./BottomTabs";

type Props = { doc: Document; indexes: Indexes; children: ReactNode };

export function MobileShell({ doc, indexes, children }: Props) {
  return (
    <div className="mobile-shell">
      <MobileHeader doc={doc} indexes={indexes} />
      <main className="mobile-main">{children}</main>
      <BottomTabs indexes={indexes} />
    </div>
  );
}
