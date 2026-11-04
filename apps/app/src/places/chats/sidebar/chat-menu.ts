// The menus of a row in the Chats list. A chat row: Open, Star, Mark as Read (or Mark as Unread), then what the person can do with the chat itself. An imported session's row: importedMenuEntries below. Pure: the sidebar gives it what each item does.
//   Archive / Unarchive  my list only
//   Leave chat           a chat with other people (a direct message): I stop being in it, they keep it
//   Delete chat          a chat only I am in (me and agents): hidden at once, with an Undo; never offered for a channel (channels have their own menu) or a row the server does not know yet
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { ChatRow } from "./model.ts";
import type { ImportedRow } from "../imported/model.ts";
import { chatMenu } from "../menus/kinds.ts";

export interface ChatMenuDo {
  open(): void; star(): void; markRead(): void; markUnread(): void; archive(): void; unarchive(): void; leaveChat(): void; deleteChat(): void;
  rename?: (() => void) | undefined;
  openTab?: (() => void) | undefined;
  muted?: boolean | undefined;
  mute?: ((on: boolean) => void) | undefined;
  addPeople?: (() => void) | undefined;
  copyLink?: (() => void) | undefined;
  notifications?: (() => void) | undefined;
}

/** The chat row's menu is the Chats menu of kinds.ts (open, change, archive, then leave or delete); the sidebar gives it what each item does. A part the sidebar does not give (Rename, Mute, a new tab) is left out. */
export function chatMenuEntries(r: ChatRow, d: ChatMenuDo): MenuEntry[] {
  return chatMenu({ starred: r.starred, unread: r.unread > 0, local: r.local, archived: r.archived === true, withPeople: r.withPeople === true, muted: d.muted === true }, {
    open: d.open, openTab: d.openTab, rename: d.rename ?? (() => undefined), star: () => d.star(), markRead: d.markRead, markUnread: d.markUnread, mute: d.mute ?? (() => undefined),
    archive: d.archive, unarchive: d.unarchive, leave: d.leaveChat, remove: d.deleteChat, addPeople: d.addPeople, copyLink: d.copyLink, notifications: d.notifications,
  }, { rename: d.rename !== undefined, mute: d.mute !== undefined });
}

export interface ImportedMenuDo { open(): void; rename(): void; archive(): void; unarchive(): void; deleteSession(): void }

/** The menu of an imported session's row: Open, then Rename (the title shown; the transcript never changes), Archive or Unarchive, and Delete session, which asks first. */
export function importedMenuEntries(r: ImportedRow, d: ImportedMenuDo): MenuEntry[] {
  return [
    { label: "Open", onSelect: d.open },
    { separator: true },
    { label: "Rename", onSelect: d.rename },
    r.archived === true ? { label: "Unarchive", onSelect: d.unarchive } : { label: "Archive", onSelect: d.archive },
    { separator: true },
    { label: "Delete session", danger: true, onSelect: d.deleteSession },
  ];
}

/** The plain confirm a delete asks in the menu's own place: the imported copy goes, and a chat continued from it stays. */
export function importedDeleteConfirm(r: ImportedRow, remove: () => void): MenuEntry[] {
  return [
    { head: r.continuedThreadId ? "Delete this imported session? Its chat stays." : "Delete this imported session?" },
    { label: "Delete session", danger: true, onSelect: remove },
    { label: "Cancel" },
  ];
}
