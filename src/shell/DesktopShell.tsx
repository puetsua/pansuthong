import { ReactNode } from "react";
import { Document } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { Sidebar } from "./Sidebar";

type Props = { doc: Document; indexes: Indexes; children: ReactNode };

export function DesktopShell({ doc, indexes, children }: Props) {
  return (
    <div className="desktop-shell">
      <Sidebar doc={doc} indexes={indexes} />
      <main className="desktop-main">{children}</main>
    </div>
  );
}
