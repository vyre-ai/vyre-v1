// The chat header's "..." carries the chat's own items (Rename, Star, Mute, Archive, Leave or Delete, Add People, Copy link) from the SAME builder as the sidebar row menu (menus/chat.ts chatMenu): one list, one set of words.
// Open and Mark as Read are left out, because the chat is open and its read mark is the sidebar's. Pure: facts in, what each item does in, entries out.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { chatMenu } from "../menus/chat.ts";

export interface HeaderChatFacts { starred: boolean; muted: boolean; archived: boolean; /** A direct message with other people (no agent): Leave, not Delete. */ withPeople: boolean }
export interface HeaderChatDo {
  rename(): void; star(on: boolean): void; mute(on: boolean): void; archive(): void; unarchive(): void; leave(): void; remove(): void;
  addPeople?: (() => void) | undefined; copyLink?: (() => void) | undefined; notifications?: (() => void) | undefined;
}

const none = (): void => undefined;
export function chatHeaderEntries(f: HeaderChatFacts, d: HeaderChatDo): MenuEntry[] {
  return chatMenu(
    { starred: f.starred, unread: false, local: false, archived: f.archived, withPeople: f.withPeople, muted: f.muted },
    { open: none, rename: d.rename, star: d.star, markRead: none, markUnread: none, mute: d.mute, archive: d.archive, unarchive: d.unarchive, leave: d.leave, remove: d.remove, addPeople: d.addPeople, copyLink: d.copyLink, notifications: d.notifications },
    { open: false, read: false },
  );
}
