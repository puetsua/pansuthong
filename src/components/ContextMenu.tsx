import { useEffect } from "react";

export type ContextMenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
};

type Props = {
  x: number;
  y: number;
  items: ContextMenuItem[];
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
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
          >
            <span className="ctx-menu-label">{item.label}</span>
            {item.shortcut && <span className="ctx-menu-shortcut">{item.shortcut}</span>}
          </button>
        ))}
      </div>
    </>
  );
}
