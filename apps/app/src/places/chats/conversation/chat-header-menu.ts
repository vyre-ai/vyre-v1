// The chat header's "..." (G4, prototype c-render.js popup "menu"): a short list in sentence case. An agent chat reads Plan first, Fork, Rewind, Find in this chat, Kept, Export, Archive,
// and Stop everyone while it works; a chat with one other person reads Find, Kept, Export, Mute, Archive. The chat's own housekeeping (Rename, Star, Mute, Add people, Copy link, Delete)
// lives where the prototype keeps it: the title renames, the sidebar row menu (menus/chat.ts) stars, mutes, copies the link and deletes, and the plus menu in the composer adds people.
// Pure: facts in, what each item does in, entries out. An entry whose action the caller cannot do yet (Rewind, Kept) is left out, never drawn dead.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { item, sep, tidy } from "../menus/shared.ts";

export interface HeaderMenuFacts {
  /** The chat has an agent in it: Plan first, Fork and Stop everyone are about the agent. */
  withAgent: boolean;
  /** A chat with other people and no agent: Mute and Archive are what is left to say. */
  withPeople: boolean;
  planOn: boolean;
  muted: boolean;
  archived: boolean;
  /** An agent is writing now: Stop everyone is offered only then. */
  working: boolean;
  /** Archive is a chat's own (a channel and a task thread have their own places for it). */
  archivable: boolean;
}
export interface HeaderMenuDo {
  plan(): void;
  fork(): void;
  /** Left out until the chat can rewind (a restore point per turn). */
  rewind?: (() => void) | undefined;
  find(): void;
  /** Left out until the pane has its Kept tab. */
  kept?: (() => void) | undefined;
  exportMd(): void;
  mute(on: boolean): void;
  archive(): void;
  unarchive(): void;
  stopAll(): void;
  /** Entries only some chats have (a channel's "Agents reply in threads", "Connect an outside agent"), placed before the closing group. */
  extra?: readonly MenuEntry[] | undefined;
}

export function chatHeaderEntries(f: HeaderMenuFacts, d: HeaderMenuDo): MenuEntry[] {
  return tidy([
    f.withAgent ? item("Plan first", d.plan, { checked: f.planOn }) : null,
    f.withAgent ? item("Fork", d.fork) : null,
    f.withAgent && d.rewind ? item("Rewind", d.rewind) : null,
    item("Find in this chat", d.find, { hint: "\u2318F" }),
    d.kept ? item("Kept", d.kept) : null,
    sep,
    item("Export", d.exportMd),
    ...(d.extra && d.extra.length > 0 ? [sep, ...d.extra] : []),
    sep,
    f.withPeople && !f.withAgent ? item(f.muted ? "Unmute" : "Mute", () => d.mute(!f.muted)) : null,
    f.archivable ? (f.archived ? item("Unarchive", d.unarchive) : item("Archive", d.archive)) : null,
    f.withAgent && f.working ? item("Stop everyone", d.stopAll, { danger: true }) : null,
  ]);
}

/** Whether a chat is in the Archived list of chat.recent (the list the sidebar's Archived section reads). An older server that sends none has none. */
export function isArchivedIn(
  recent: { archived?: readonly { threadId: string }[] } | null | undefined,
  threadId: string,
): boolean {
  return (recent?.archived ?? []).some((t) => t.threadId === threadId);
}
