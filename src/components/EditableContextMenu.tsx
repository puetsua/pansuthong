import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ContextMenu } from "./ContextMenu";
import {
  findEditableTarget,
  getEditableActionStates,
  runEditableAction,
  type EditableAction,
} from "../lib/editableContextMenu";
import { isMacOS, modKeyLabel } from "../lib/platform";

type MenuState = { x: number; y: number; target: HTMLElement };

/**
 * Globally blocks the WebView default context menu and shows Cut/Copy/Paste/Select
 * all on editable targets (design B). Sidebar and other custom menus keep working
 * via their own bubble-phase handlers after this capture listener runs.
 */
export function EditableContextMenu() {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    let active = true;
    void isMacOS().then(mac => { if (active) setIsMac(mac); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const target = findEditableTarget(e.target);
      if (target) {
        setMenu({ x: e.clientX, y: e.clientY, target });
      } else {
        setMenu(null);
      }
    };
    document.addEventListener("contextmenu", onContextMenu, true);
    return () => document.removeEventListener("contextmenu", onContextMenu, true);
  }, []);

  if (!menu) return null;

  const states = getEditableActionStates(menu.target);
  const mod = modKeyLabel(isMac);
  const shortcut = (key: string) => (mod === "⌘" ? `${mod}${key}` : `${mod}+${key}`);
  const actions: { id: EditableAction; label: string; shortcut: string; enabled: boolean }[] = [
    { id: "cut", label: t("contextMenu.cut"), shortcut: shortcut("X"), enabled: states.cut },
    { id: "copy", label: t("contextMenu.copy"), shortcut: shortcut("C"), enabled: states.copy },
    { id: "paste", label: t("contextMenu.paste"), shortcut: shortcut("V"), enabled: states.paste },
    { id: "selectAll", label: t("contextMenu.selectAll"), shortcut: shortcut("A"), enabled: states.selectAll },
  ];

  const items = actions.flatMap(a => {
    const item = {
      id: a.id,
      label: a.label,
      shortcut: a.shortcut,
      disabled: !a.enabled,
      onSelect: () => runEditableAction(menu.target, a.id),
    };
    if (a.id === "selectAll") {
      return [{ type: "separator" as const, id: "sep-select-all" }, item];
    }
    return [item];
  });

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      onClose={() => setMenu(null)}
      items={items}
    />
  );
}
