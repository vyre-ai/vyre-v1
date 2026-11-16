// The "open" group every row menu starts with, built once (the owner's navigation rule: a row can always be opened here, in a new tab, and where the place has one, in the side pane). Chats, Files,
// Records, Automations, Console, Settings, Vault and Inbox all build this group here, so the words, the order and the keys are the same in every place. A way the place cannot offer is left out.
import type { MenuEntry } from "./index.tsx";
import { item, tidy } from "./entries.ts";

/** The one spelling and key of the item, for the menus that build their own group around it. */
export const OPEN_IN_NEW_TAB = { label: "Open in New Tab", hint: "\u2318\u21B5" } as const;

export interface OpenDo {
  /** In the tab on screen (a step Back returns from). */
  open(): void;
  /** As a tab beside this one. Left out where the shell has no tabs. */
  openTab?(): void;
  /** In the side pane, where the open rule gives this kind of row a pane. */
  openPane?(): void;
  /** False where the row does not answer Cmd+Enter: the menu then shows no key it would not run. */
  tabKey?: boolean;
}

/** Open, Open in New Tab and Open in Side Pane, each only when the place can do it. */
export function openEntries(d: OpenDo): MenuEntry[] {
  return tidy([
    item("Open", d.open, { hint: "Enter" }),
    d.openTab ? item(OPEN_IN_NEW_TAB.label, d.openTab, d.tabKey === false ? {} : { hint: OPEN_IN_NEW_TAB.hint }) : null,
    d.openPane ? item("Open in Side Pane", d.openPane) : null,
  ]);
}
