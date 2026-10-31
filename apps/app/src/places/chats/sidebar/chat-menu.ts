// The menu of a chat row in the Chats list: Open, Star, Mark as Read, then what the person can do with the chat itself. Pure: the sidebar gives it what each item does.
//   Archive / Unarchive  my list only
//   Leave chat           a chat with other people (a direct message): I stop being in it, they keep it
//   Delete chat          a chat only I am in (me and agents): hidden at once, with an Undo; never offered for a channel (channels have their own menu) or a row the server does not know yet
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { ChatRow } from "./model.ts";

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
