// The one row menu for the rows that only open something (a Console page, a Settings page, a Vault folder, an Inbox view): Open, Open in New Tab and, where the place has a side pane, Open in Side
// Pane. It is the same menu Chats, Files, Records and Automations show (ui/src/Menu/open-entries.ts), reached the same ways (right-click, the Menu key, Shift+F10, a long press). "Open in New Tab"
// asks for the tab through openIn(), exactly as Cmd-press does, so the open rule (tabs/open-rule.ts) decides and no place has a rule of its own.
import type { ReactElement } from "react";
import { useContextMenu } from "../../../../../ui/src/Menu/context.tsx";
import { openEntries } from "../../../../../ui/src/Menu/open-entries.ts";
import { openIn } from "./open-how.ts";

export interface RowOpen {
  /** What the row says (the menu's name for a screen reader and Report a problem). */
  label: string;
  open(): void;
  /** Present when the place can show this row as a tab; the tab is asked for here, so the function only has to open the row. */
  openTab?: () => void;
  openPane?: () => void;
}

export interface OpenRowMenu {
  /** Render once beside the rows. */
  element: ReactElement | null;
  /** Props for the row's wrapper: right-click, Menu key, Shift+F10, long press. */
  on(row: RowOpen): Record<string, unknown>;
}

/** The menu's entries for one row (pure, so a test reads them without a screen). */
export function rowOpenEntries(row: RowOpen): ReturnType<typeof openEntries> {
  const tab = row.openTab;
  return openEntries({
    open: row.open,
    ...(tab ? { openTab: () => openIn("tab", tab) } : {}),
    ...(row.openPane ? { openPane: row.openPane } : {}),
  });
}

export function useOpenRowMenu(): OpenRowMenu {
  const menus = useContextMenu();
  return {
    element: menus.element,
    on: (row) => menus.on(() => rowOpenEntries(row), { label: row.label }),
  };
}
