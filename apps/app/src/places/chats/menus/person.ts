// The right-click menu of a person in Chats (team/v1/CONTEXT-MENUS.md). Pure: facts about the row and what the person may do go in, what each item does goes in, the entries of the one Menu surface come out.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { KEY, item, sep, tidy } from "./shared.ts";

export interface PersonFacts { name: string; /** Their direct message with you, when there is one. */ dm: boolean; unread: boolean; muted: boolean }
export interface PersonDo {
  message(): void; markRead(): void; markUnread(): void; mute(on: boolean): void;
  /** Left out when the sidebar cannot: call them (the softphone), put them in a chat, copy @name. */
  call?: (() => void) | undefined;
  addToChat?: (() => void) | undefined;
  copyHandle?: (() => void) | undefined;
}
export function personMenu(f: PersonFacts, d: PersonDo): MenuEntry[] {
  return tidy([
    item(`Message ${f.name}`, d.message, { hint: KEY.enter }),
    d.call ? item("Call", d.call) : null,
    sep,
    d.addToChat ? item("Add to a Chat\u2026", d.addToChat) : null,
    d.copyHandle ? item("Copy @name", d.copyHandle) : null,
    sep,
    f.dm ? (f.unread ? item("Mark as Read", d.markRead, { hint: KEY.unread }) : item("Mark as Unread", d.markUnread, { hint: KEY.unread })) : null,
    f.muted ? item("Unmute", () => d.mute(false)) : item("Mute", () => d.mute(true)),
  ]);
}
