import { useEffect } from "react";

export type ContextMenuItem = {
  type?: "item";
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
};

export type ContextMenuSeparator = {
  type: "separator";
  id: string;
};

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

type Props = {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
};

/** Shared custom context menu shell (surface, border, hover) used app-wide. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="ctx-menu-backdrop"
        onClick={onClose}
        onContextMenu={e => { e.preventDefault(); onClose(); }}
      />
      <div className="ctx-menu" role="menu" style={{ top: y, left: x }}>
        {items.map(entry => {
          if (entry.type === "separator") {
            return <div key={entry.id} className="ctx-menu-separator" role="separator" />;
          }
          return (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              disabled={entry.disabled}
              onClick={() => {
                if (entry.disabled) return;
                entry.onSelect();
                onClose();
              }}
            >
              <span className="ctx-menu-label">{entry.label}</span>
              {entry.shortcut && <span className="ctx-menu-shortcut">{entry.shortcut}</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}
