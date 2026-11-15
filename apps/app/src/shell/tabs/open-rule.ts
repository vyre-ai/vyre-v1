// What a press opens, and where: ONE function (owner, 15 Nov 2026: "What opens as a new tab, how they switch and what opens in the right pane"; the model is D1 to D8 in team/v1/TABS-2026-11-15.md).
// Every place opens things through ShellRuntime.open, which ends in the hub's go(); go() asks this file and nothing else decides. No place has a rule of its own.
//
//   a plain press on a row (a chat, a file, a record type, an Automation, a Console page)  -> the tab on screen shows it (a step: Back returns)
//   Cmd-press, middle-press, "Open in new tab" in a row's menu                              -> a new tab beside the tab on screen, and it is shown ("tab")
//   Shift with any of these                                                                 -> the new tab opens behind, the person stays ("behind")
//   a thing already open in a tab                                                           -> that tab is shown; a second one is never made (the store's holding())
//   a link to a thing inside a page (a mention, a file in a message, a task, a person)      -> the right pane where the place has one (Details first); "Open as a tab" in the pane's head
//   the rail                                                                                 -> the place's own tab
//   a link from outside (an address, a notification)                                         -> a tab, never a step of the tab on screen
import type { PlaceId } from "../rail/kits.ts";
import { activeEntry } from "./store.ts";
import type { TabsState } from "./store.ts";

/** How the person asked: in the tab on screen, in a new tab they go to, or in a new tab behind. */
export type OpenHow = "here" | "tab" | "behind";

export type OpenPlan =
  /** The place's own tab shows it (an address with no item). */
  | { do: "land" }
  /** The tab on screen shows it: one step in that tab's history. */
  | { do: "step" }
  /** A tab holds it: the one already open is selected, else a new one opens beside the selected tab (behind it when `background`). */
  | { do: "open"; background: boolean };

export interface OpenAsk {
  place: PlaceId;
  /** The address inside the place. Undefined: the place itself (the rail). The empty text: the place's landing, asked for by address. */
  hash: string | undefined;
  how: OpenHow;
  /** An address, a pasted link, a notification: reached from outside, never a step of the tab on screen. */
  link?: boolean;
}

export function openPlan(state: TabsState, a: OpenAsk): OpenPlan {
  if (a.how === "behind") return { do: "open", background: true };
  if (a.how === "tab") return { do: "open", background: false };
  if (a.hash === "") return { do: "land" };
  if (a.link === true || a.hash === undefined) return { do: "open", background: false };
  const cur = activeEntry(state);
  // a row or a press inside the place on screen moves this tab; an item of another place, or a tab that is only "+", is an open
  if (cur !== undefined && cur.isNew !== true && cur.place === a.place && (cur.hash ?? "") !== a.hash)
    return { do: "step" };
  return { do: "open", background: false };
}
