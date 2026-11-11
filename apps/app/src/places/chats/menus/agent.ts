// The right-click menu of an agent in Chats (team/v1/CONTEXT-MENUS.md). Pure: facts about the row and what the person may do go in, what each item does goes in, the entries of the one Menu surface come out.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { KEY, item, sep, starItem, tidy } from "./shared.ts";

export interface AgentFacts {
  name: string;
  /** Your own assistant: it cannot be paused or deleted from here. */
  assistant: boolean;
  starred: boolean;
  status: "awake" | "working" | "asleep" | "paused";
  hasComputer: boolean;
  /** Its computer, when it has one (computers.list), and whether it sleeps now. Absent while unknown: Wake and Sleep are then left out. */
  computer?: { computerId: string; asleep: boolean } | undefined;
  muted: boolean;
  /** agents.manage: pause, wake and sleep its computer, delete. */
  manage: boolean;
}
export interface AgentDo {
  message(): void;
  openProfile?: (() => void) | undefined;
  openComputer?: (() => void) | undefined;
  wake(): void;
  sleep(): void;
  pause(): void;
  resume(): void;
  star(on: boolean): void;
  mute(on: boolean): void;
  remove(): void;
  /** Left out when the sidebar cannot: nudge it in your own chat with it (threads.poke), put it in another chat, share it, edit what it is told. */
  poke?: (() => void) | undefined;
  addToChat?: (() => void) | undefined;
  share?: (() => void) | undefined;
  editInstructions?: (() => void) | undefined;
}
export function agentMenu(f: AgentFacts, d: AgentDo): MenuEntry[] {
  // every agent has a terminal and a browser (its Computer tab): Open lands there. Wake and Sleep are only for an old desktop that still exists.
  const computer = [d.openComputer ? item("Open Its Computer", d.openComputer) : null, f.manage && f.computer ? (f.computer.asleep ? item("Wake Its Computer", d.wake) : item("Sleep Its Computer", d.sleep)) : null];
  return tidy([
    item(`Message ${f.name}`, d.message, { hint: KEY.enter }),
    d.openProfile ? item("Open Profile", d.openProfile, { hint: KEY.profile }) : null,
    d.poke ? item("Poke", d.poke) : null,
    sep,
    d.addToChat ? item("Add to a Chat\u2026", d.addToChat) : null,
    d.share && f.manage && !f.assistant ? item("Share\u2026", d.share) : null,
    sep,
    ...computer,
    sep,
    d.editInstructions && f.manage && !f.assistant ? item("Edit Instructions", d.editInstructions) : null,
    f.manage && !f.assistant ? (f.status === "paused" ? item("Resume", d.resume) : item("Pause", d.pause)) : null,
    sep,
    starItem(f.starred, d.star),
    f.muted ? item("Unmute", () => d.mute(false)) : item("Mute", () => d.mute(true)),
    f.manage && !f.assistant ? sep : null,
    f.manage && !f.assistant ? item("Delete Agent…", d.remove, { danger: true, hint: KEY.remove }) : null,
  ]);
}
