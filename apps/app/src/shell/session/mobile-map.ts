// How the phone's screens (mobile/shell: five tabs and one history) map onto the places and the tab hash. A tab's first screen is the place itself; a screen opened on top is
// "<type>:<id>" and the place gets that subject as its hash. Settings, My work and Starred hang off You.
import { formatHash, parseHash, placeForSubject } from "../hash/hash.ts";
import type { Entry, TabId } from "../../mobile/shell/model.ts";
import type { PlaceId } from "../rail/kits.ts";

/** Below this width the production entry uses the phone shell. */
export const PHONE_BELOW = 700;

const TAB_PLACES: readonly PlaceId[] = ["chats", "inbox", "records", "files"];

export function tabOf(place: PlaceId): TabId {
  return (TAB_PLACES as readonly string[]).includes(place) ? (place as TabId) : "you";
}

/** The phone screen for a place and hash. Null for a place the phone does not have (Automations, Console). */
export function entryFor(place: PlaceId, hash: string): Entry | null {
  if (place === "automations" || place === "console") return null;
  if (place === "apps") return { tab: "you", screen: `apps:${encodeURIComponent(hash)}`, title: "Apps" };
  const t = parseHash(hash);
  if (t.screen === "tasks.page" && t.args.taskId) return { tab: "you", screen: `task:${t.args.taskId}` };
  if (t.subject) return { tab: tabOf(place), screen: `${t.subject.type}:${t.subject.id}` };
  if ((TAB_PLACES as readonly string[]).includes(place)) return { tab: place as TabId, screen: place };
  if (place === "settings") return { tab: "you", screen: "you:settings", title: "Settings" };
  if (place === "home") return { tab: "you", screen: "you:my-work", title: "My work" };
  return { tab: "you", screen: "you" };
}

/** The place and hash that draw a phone screen. */
export function placeOf(e: Entry): { place: PlaceId; hash: string } | null {
  const i = e.screen.indexOf(":");
  const kind = i < 0 ? e.screen : e.screen.slice(0, i);
  if (i < 0) return (TAB_PLACES as readonly string[]).includes(kind) ? { place: kind as PlaceId, hash: "" } : null;
  if (kind === "apps") {
    try { return { place: "apps", hash: decodeURIComponent(e.screen.slice(i + 1)) }; } catch { return null; }
  }
  if (kind === "you") {
    const what = e.screen.slice(i + 1);
    if (what === "settings") return { place: "settings", hash: "" };
    return { place: "home", hash: "" };
  }
  const place = placeForSubject(kind);
  return place ? { place: place as PlaceId, hash: formatHash({ subject: { type: kind, id: e.screen.slice(i + 1) } }) } : null;
}
