// useContextMenu: the one way a row, card or tab gets its menu (team/v1/CONTEXT-MENUS.md). `on(entries)` returns the props that open it every way a person can ask: right-click, the Menu key or Shift+F10, a long press on a
// phone's browser (menuTrigger), and the keys the items show in their hint column, which run the item on the focused row (S, U, E, F2, Cmd+Enter, Cmd+Backspace). `open` shows it from a "..." button or a tap, at a point.
// The entries are asked for when the menu opens, so their words follow the state of that moment. A key typed into a field inside the row is the field's, never a shortcut.
import type { ReactElement } from "react";
import { menuTrigger, useMenu } from "./index.tsx";
import type { MenuEntry } from "./props.ts";
import { shortcutFor } from "./keys.ts";

export interface ContextMenuOptions {
  /** Said to Report a problem and to a screen reader: what the menu is for ("Rivera intake"). */
  label?: string;
  /** Runs just before the entries are asked for (read what the words depend on). */
  before?: () => void;
}
export interface RowMenu {
  element: ReactElement | null;
  /** Props for the row: right-click, Menu key, Shift+F10, long press, and the hint keys. */
  on(entries: (at: { x: number; y: number }) => readonly MenuEntry[] | null, o?: ContextMenuOptions): Record<string, unknown>;
  /** Show the menu at a point (a row's "..." button). */
  open(entries: (at: { x: number; y: number }) => readonly MenuEntry[] | null, x: number, y: number, o?: ContextMenuOptions): void;
  hide(): void;
}

interface KeyLike { key?: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; target?: { tagName?: string; isContentEditable?: boolean }; preventDefault?: () => void; stopPropagation?: () => void; defaultPrevented?: boolean }
const typing = (t: KeyLike["target"]): boolean => t !== undefined && (t.isContentEditable === true || /^(input|textarea|select)$/i.test(t.tagName ?? ""));

/** `shared` is the menu a screen already has (its useMenu), so a row's menu and the screen's other menus are one surface; without it the hook has its own. */
export function useContextMenu(shared?: Pick<ReturnType<typeof useMenu>, "show" | "hide" | "element">): RowMenu {
  const own = useMenu();
  const menu = shared ?? own;
  const open = (entries: (at: { x: number; y: number }) => readonly MenuEntry[] | null, x: number, y: number, o: ContextMenuOptions = {}): void => {
    o.before?.();
    const list = entries({ x, y });
    if (list && list.length > 0) menu.show(list, x, y, "context", o.label ? { label: o.label } : {});
  };
  const on = (entries: (at: { x: number; y: number }) => readonly MenuEntry[] | null, o: ContextMenuOptions = {}): Record<string, unknown> => {
    const trigger = menuTrigger((x, y) => open(entries, x, y, o));
    const menuKey = trigger["onKeyDown"] as ((e: KeyLike) => void) | undefined;
    return {
      ...trigger,
      onKeyDown: (e: KeyLike): void => {
        menuKey?.(e);
        if (e.defaultPrevented === true || typing(e.target)) return;
        const hit = shortcutFor(entries({ x: 0, y: 0 }) ?? [], e);
        if (hit) { e.preventDefault?.(); e.stopPropagation?.(); hit.onSelect?.(); }
      },
    };
  };
  return { element: menu.element, on, open, hide: menu.hide };
}
