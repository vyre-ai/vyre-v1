// The right-click menu of a chat in Chats (team/v1/CONTEXT-MENUS.md). Pure: facts about the row and what the person may do go in, what each item does goes in, the entries of the one Menu surface come out.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { KEY, item, sep, tidy } from "./shared.ts";

export interface ChatFacts {
  starred: boolean;
  unread: boolean;
  /** Not on the server yet: a row that is only drawn. */
  local: boolean;
  archived: boolean;
  /** A direct message with other people: Leave, not Delete. */
  withPeople: boolean;
  muted: boolean;
}
export interface ChatDo {
  open(): void;
  openTab?: (() => void) | undefined;
  rename(): void;
  star(on: boolean): void;
  markRead(): void;
  markUnread(): void;
  mute(on: boolean): void;
  archive(): void;
  unarchive(): void;
  leave(): void;
  remove(): void;
}
/** `has` says which optional parts the caller can do (a sidebar with no Rename leaves it out); by default all. */
export function chatMenu(f: ChatFacts, d: ChatDo, has: { rename?: boolean; mute?: boolean } = {}): MenuEntry[] {
  const rename = has.rename !== false, mute = has.mute !== false;
  return tidy([
    item("Open", d.open, { hint: KEY.enter }),
    d.openTab ? item("Open in New Tab", d.openTab, { hint: KEY.newTab }) : null,
    sep,
    f.local || !rename ? null : item("Rename", d.rename, { hint: KEY.rename }),
    f.starred ? item("Remove Star", () => d.star(false), { hint: KEY.star }) : item("Star", () => d.star(true), { hint: KEY.star }),
    f.unread ? item("Mark as Read", d.markRead, { hint: KEY.unread }) : f.local ? null : item("Mark as Unread", d.markUnread, { hint: KEY.unread }),
    f.local || !mute ? null : f.muted ? item("Unmute", () => d.mute(false)) : item("Mute", () => d.mute(true)),
    sep,
    f.archived ? item("Unarchive", d.unarchive, { hint: KEY.archive }) : item("Archive", d.archive, { hint: KEY.archive }),
    f.local ? null : sep,
    f.local ? null : f.withPeople ? item("Leave chat", d.leave, { danger: true }) : item("Delete chat", d.remove, { danger: true, hint: KEY.remove }),
  ]);
}
