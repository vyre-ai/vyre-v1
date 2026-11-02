// The menus of a row in the Chats list. A chat row: Open, Star, Mark as Read, then what the person can do with the chat itself. An imported session's row: importedMenuEntries below. Pure: the sidebar gives it what each item does.
//   Archive / Unarchive  my list only
//   Leave chat           a chat with other people (a direct message): I stop being in it, they keep it
//   Delete chat          a chat only I am in (me and agents): hidden at once, with an Undo; never offered for a channel (channels have their own menu) or a row the server does not know yet
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { ChatRow } from "./model.ts";
import type { ImportedRow } from "../imported/model.ts";

export interface ChatMenuDo { open(): void; star(): void; markRead(): void; archive(): void; unarchive(): void; leaveChat(): void; deleteChat(): void }

export function chatMenuEntries(r: ChatRow, d: ChatMenuDo): MenuEntry[] {
  const items: MenuEntry[] = [
    { label: "Open", onSelect: d.open },
    { separator: true },
    { label: r.starred ? "Remove Star" : "Star", onSelect: d.star },
    ...(r.unread > 0 ? [{ label: "Mark as Read", onSelect: d.markRead }] : []),
    { separator: true },
    r.archived ? { label: "Unarchive", onSelect: d.unarchive } : { label: "Archive", onSelect: d.archive },
  ];
  if (!r.local) items.push({ separator: true }, r.withPeople === true ? { label: "Leave chat", danger: true, onSelect: d.leaveChat } : { label: "Delete chat", danger: true, onSelect: d.deleteChat });
  return items;
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
