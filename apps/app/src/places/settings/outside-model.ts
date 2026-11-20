// Connected apps, as the Settings page words them (lane r42-mcp, 19 Nov 2026): what each app did last, when, and whether it is working now. Pure: the clock comes in. An app that has not acted says when it was
// connected ("Connected yesterday"), never "has not done anything".
import type { CapMap } from "../../../../../generated/types.ts";
import { agoLabel } from "../chats/rightpane/model.ts";

export type Connected = CapMap["mcp.connected.list"]["out"]["agents"][number];
export interface Clock {
  now: number;
  offsetMin: number;
}
/** An app that called a tool this recently shows the green dot. */
export const ACTIVE_MS = 2 * 60_000;

const lower = (s: string): string => (s === "Yesterday" ? "yesterday" : s);

/** The second line: the newest thing it did, or when it joined. */
export function appSub(a: Connected, c: Clock): string {
  if (a.lastDid) return a.lastDid;
  return `Connected ${lower(agoLabel(a.connectedAt, c))}`;
}

/** The time at the right: its last call, or when it joined. */
export function appWhen(a: Connected, c: Clock): string {
  return agoLabel(a.lastSeenAt ?? a.connectedAt, c);
}

export const activeNow = (a: Connected, now: number): boolean =>
  a.lastSeenAt !== undefined && now - a.lastSeenAt < ACTIVE_MS && now >= a.lastSeenAt;

/** The mark for an app, by the name it gave itself: one of the glyphs Settings has. */
export function appGlyph(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("claude") && n.includes("code")) return "laptop";
  if (n.includes("claude")) return "spark";
  if (n.includes("cursor")) return "grid";
  if (n.includes("chatgpt") || n.includes("openai")) return "globe2";
  return "link";
}

export const CONNECTED_NOTE = "Each one can do what you can here, and no more. Sends wait for your yes.";
