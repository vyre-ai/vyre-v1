// How the phone's screens (mobile/shell: five tabs and one history) map onto the places and the tab hash. A tab's first screen is the place itself; a screen opened on top is
// "<type>:<id>" and the place gets that subject as its hash. Settings, My work, Starred, Apps and the Vault hang off You.
// Automations and the Console are not on the phone (owner ruling, 3 Nov: "You can chat about them in chats na so not needed in phone"). A link to either opens one calm line with
// "Chat about it", which opens an Ask with the assistant about the item the link named. An Ask link keeps its whole hash, so the Chats place finds or makes that Ask thread.
import { formatHash, parseHash, placeForSubject } from "../hash/hash.ts";
import type { Entry, TabId } from "../../mobile/shell/model.ts";
import type { AskAbout } from "../providers/ask.ts";
import type { PlaceId } from "../rail/kits.ts";

/** Below this width the production entry uses the phone shell. */
export const PHONE_BELOW = 700;

const TAB_PLACES: readonly PlaceId[] = ["chats", "inbox", "records", "files"];

export function tabOf(place: PlaceId): TabId {
  return (TAB_PLACES as readonly string[]).includes(place) ? (place as TabId) : "you";
}

/** The screens that are a conversation: its header carries the Back chevron, so the shell draws no Back bar above it. */
export const headerBack = (e: Entry): boolean => e.tab === "chats" && /^(chat|thread|channel|ask):/.test(e.screen);

/** Places only a computer draws. On a phone a link to one opens the Chat-about-it line instead. */
export const DESKTOP_ONLY: readonly PlaceId[] = ["automations", "console"];
/** Subject kinds that belong to a desktop-only place: an automation, a run or a Journey opened from anywhere on the phone also gets the Chat-about-it line. */
const DESKTOP_KINDS: Readonly<Record<string, PlaceId>> = { automation: "automations", automations: "automations", run: "automations", journey: "automations", journeys: "automations", console: "console" };
const DESKTOP_TITLE: Readonly<Record<string, string>> = { automations: "Automations", console: "Console" };

/** The Chat-about-it screen for a link to a desktop-only place. */
export function desktopEntry(place: PlaceId, hash: string): Entry {
  return { tab: "chats", screen: `desktop:${place}:${encodeURIComponent(hash)}`, title: DESKTOP_TITLE[place] ?? place };
}

/** The place and hash a Chat-about-it screen stands for, or null for any other screen. */
export function desktopOnly(e: Entry): { place: PlaceId; hash: string } | null {
  const m = /^desktop:([a-z]+):(.*)$/.exec(e.screen);
  if (!m || !(DESKTOP_ONLY as readonly string[]).includes(m[1]!)) return null;
  try { return { place: m[1] as PlaceId, hash: decodeURIComponent(m[2]!) }; } catch { return { place: m[1] as PlaceId, hash: "" }; }
}

/** What the assistant is asked about: the item the link named, else the place and its screen. */
export function chatAboutOf(place: PlaceId, hash: string): AskAbout {
  const t = parseHash(hash);
  if (t.subject) return { kind: t.subject.type, id: t.subject.id };
  return { kind: place, id: t.screen ?? (hash.trim() === "" ? place : hash.replace(/^#/, "")) };
}

/** The one line a Chat-about-it screen says. */
export function desktopLine(place: PlaceId): string {
  return place === "console" ? "The Console opens on a computer. You can chat about it here." : "Automations open on a computer. You can chat about them here.";
}

/** The phone screen for an item a place opened: an item of a desktop-only kind gets the Chat-about-it screen. */
export function subjectEntry(tab: TabId, subject: { type: string; id: string }): Entry {
  const away = DESKTOP_KINDS[subject.type];
  if (away) return desktopEntry(away, formatHash({ subject }));
  return { tab, screen: `${subject.type}:${subject.id}` };
}

/** The screens that are an Ask link: the Chats place resolves them to the Ask thread, which then takes this screen's place in the history. */
export const isAskEntry = (e: Entry): boolean => e.screen.startsWith("ask:");

/** The phone screen for a place and hash. Never null: a place the phone does not have is the Chat-about-it screen. */
export function entryFor(place: PlaceId, hash: string): Entry {
  if ((DESKTOP_ONLY as readonly string[]).includes(place)) return desktopEntry(place, hash);
  if (place === "apps") return { tab: "you", screen: `apps:${encodeURIComponent(hash)}`, title: "Apps" };
  if (place === "vault") return { tab: "you", screen: `vault:${encodeURIComponent(hash)}`, title: "Vault" };
  const t = parseHash(hash);
  if (t.subject && DESKTOP_KINDS[t.subject.type]) return subjectEntry(tabOf(place), t.subject);
  // an Ask link (chats.conversation or chats.ask with an agent): the hash is the whole route, so it is kept as it is
  if (place === "chats" && (t.screen === "chats.conversation" || t.screen === "chats.ask") && !t.subject) return { tab: "chats", screen: `ask:${encodeURIComponent(hash)}`, title: "Assistant" };
  // Tasks lives in Chats: the list and every task sit on the Chats tab's history
  if (t.screen === "tasks.my-work") return { tab: "chats", screen: "tasks:list", title: "Tasks" };
  if (t.screen === "tasks.page" && t.args.taskId) return { tab: "chats", screen: `task:${t.args.taskId}` };
  // the replies I follow sit on the Chats tab's history, like Tasks (a link to the old Threads page arrives here too)
  if (t.screen === "inbox.replies") return { tab: "chats", screen: "replies:list", title: "Replies" };
  if (t.subject) return { tab: tabOf(place), screen: `${t.subject.type}:${t.subject.id}` };
  if ((TAB_PLACES as readonly string[]).includes(place)) return { tab: place as TabId, screen: place };
  if (place === "settings") return { tab: "you", screen: "you:settings", title: "Settings" };
  return { tab: "you", screen: "you" };
}

/** Where the phone starts for a place and hash: a tab's own screen is that tab, anything else opens on top of the Chats tab. */
export function phoneStart(place: PlaceId, hash: string): { initialTab: TabId; initialEntry?: Entry } {
  const e = entryFor(place, hash);
  return e.screen === e.tab ? { initialTab: e.tab } : { initialTab: "chats", initialEntry: e };
}

/** The place and hash that draw a phone screen. */
export function placeOf(e: Entry): { place: PlaceId; hash: string } | null {
  const i = e.screen.indexOf(":");
  const kind = i < 0 ? e.screen : e.screen.slice(0, i);
  if (i < 0) return (TAB_PLACES as readonly string[]).includes(kind) ? { place: kind as PlaceId, hash: "" } : null;
  if (kind === "desktop") return null;
  if (kind === "apps" || kind === "vault") {
    try { return { place: kind, hash: decodeURIComponent(e.screen.slice(i + 1)) }; } catch { return null; }
  }
  if (kind === "ask") {
    try { return { place: "chats", hash: decodeURIComponent(e.screen.slice(i + 1)) }; } catch { return null; }
  }
  if (kind === "tasks") return { place: "chats", hash: formatHash({ screen: "tasks.my-work", args: {} }) };
  if (kind === "replies" || kind === "threads") return { place: "inbox", hash: formatHash({ screen: "inbox.replies", args: {} }) };
  if (kind === "you") {
    const what = e.screen.slice(i + 1);
    if (what === "settings") return { place: "settings", hash: "" };
    return { place: "chats", hash: "screen=tasks.my-work" };
  }
  const place = placeForSubject(kind);
  return place ? { place: place as PlaceId, hash: formatHash({ subject: { type: kind, id: e.screen.slice(i + 1) } }) } : null;
}
