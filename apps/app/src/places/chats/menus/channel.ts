// The right-click menu of a channel in Chats (team/v1/CONTEXT-MENUS.md). Pure: facts about the row and what the person may do go in, what each item does goes in, the entries of the one Menu surface come out.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { KEY, item, sep, starItem, tidy } from "./shared.ts";

export interface ChannelFacts { name: string; unread: boolean; starred: boolean; muted: boolean; /** You are in it. */ member: boolean; /** An admin of it. */ admin: boolean }
export interface ChannelDo {
  open(): void;
  markRead(): void;
  markUnread(): void;
  star(on: boolean): void;
  mute(on: boolean): void;
  copyLink(): void;
  leave(): void;
  archive(): void;
  /** Left out when the sidebar cannot: the Add sheet on the channel, how loudly it tells you. */
  invite?: (() => void) | undefined;
  notifications?: (() => void) | undefined;
}
export function channelMenu(f: ChannelFacts, d: ChannelDo): MenuEntry[] {
  return tidy([
    item("Open", d.open, { hint: KEY.enter }),
    sep,
    f.unread ? item("Mark as Read", d.markRead, { hint: KEY.unread }) : item("Mark as Unread", d.markUnread, { hint: KEY.unread }),
    starItem(f.starred, d.star),
    f.muted ? item("Unmute", () => d.mute(false)) : item("Mute", () => d.mute(true)),
    d.notifications ? item("Notifications\u2026", d.notifications) : null,
    sep,
    f.member && d.invite ? item("Invite\u2026", d.invite) : null,
    item("Copy link", d.copyLink),
    f.member || f.admin ? sep : null,
    f.admin ? item("Archive Channel", d.archive, { hint: KEY.archive }) : null,
    f.member ? item("Leave Channel", d.leave, { danger: true }) : null,
  ]);
}
