// Main-view tabs (spec 3.0, 4.7, ARCH 7.0): per device and per Space, restored when you return to a Space, never synced.
// The state is a plain value (immutable), the controller keeps it for one Space on one device and writes it to this device's storage under a key that names
// the device, the person and the Space. Nothing here calls the server: a tab list that left the device would make Starred and tabs the same thing, and they are not.
import type { PlaceId } from "../rail/kits.ts";
import { PLACE_TITLE, livePlace } from "../rail/kits.ts";
import { parseHash, subjectOf } from "../hash/hash.ts";
import { folderOfFile } from "./file-folders.ts";
import { PAGES as CONSOLE_PAGES } from "../../console/shell/nav.ts";
import { PAGES as SETTINGS_PAGES } from "../../places/settings/model.ts";

/** Tabs are device state. Starred is the synced one (spec 3.0). */
export const TABS_SYNCED = false;

export interface TabEntry {
  key: string;
  title: string;
  /** The place this tab belongs to; a "new" tab belongs to the place it was opened from. */
  place: PlaceId;
  /** An item inside the place (a thread, a file, a record) as the place's own route hash. */
  hash?: string;
  /** The "+" tab: one search that opens anything. */
  isNew?: boolean;
  pinned?: boolean;
  /** When the tab was last the selected one (ms): the most recent of two tabs for the same thing is the one that stays. */
  at?: number;
  /** A chat with no name and no message yet: one such tab is kept, and starting another focuses it. */
  empty?: true;
  /** What a place's own tab is showing, by name (the chat or agent it moved to), for the Back control to say where it goes. The tab's own title stays the place's name. */
  name?: string;
  /** Where this tab has been, oldest first: what Back returns to. One history per tab (NAV-2026-11-14 rule 1). */
  back?: readonly Step[];
  /** What Back stepped away from, oldest first; the last one is what Forward returns to. Any new step clears it. */
  fwd?: readonly Step[];
  /** The tab this one was opened from by pressing an item: Back with nowhere to go back to returns there. */
  from?: string;
  /** The tab that was selected before this one (a rail press, the strip, a link): Back with no steps of its own returns there, so switching places is undone by Back like any other open. */
  came?: string;
  /** The tab Back just came from (this one was selected by Back): Forward returns there. Any step of this tab forgets it. */
  next?: string;
}

/** One place in a tab's history: the address inside the tab's place (the empty text is the place's landing) and the name the tab had there. */
export interface Step {
  hash: string;
  title: string;
}

/** How many steps a tab remembers. */
export const HISTORY_MAX = 50;

export interface TabsState {
  tabs: readonly TabEntry[];
  /** Key of the selected tab; "" when there are none. */
  active: string;
}

export const EMPTY_TABS: TabsState = { tabs: [], active: "" };

/**
 * A tab is unique by what it shows: a place is one tab, an item (thread, record, file...) is one tab by its subject, a Records type is one tab by its type.
 * Other hash parts (the screen inside a place, view settings) move within the tab and never make another one. A hash that is not `k=v` text is an opaque id and stays as given.
 */
/** Your profile is a page of Settings: the address names the page, so it opens in the Settings tab the strip already has and never as a second one (owner walk, 12 Nov). */
export const PROFILE_HASH = "page=profile";

export function tabKey(place: PlaceId, hash?: string): string {
  if (hash === undefined || hash === "") return place;
  if (!hash.includes("=")) return `${place}:${hash}`;
  const t = parseHash(hash);
  const subject = subjectOf(t);
  if (subject !== undefined) return `${place}:subject=${subject.type}:${subject.id}`;
  if (t.screen === "tasks.page" && t.args["taskId"]) return `${place}:subject=task:${t.args["taskId"]}`;
  // an agent's page is that agent's tab, never the place's: opened from a chat it is a step in the chat's tab (or its own tab), so Back returns to the chat
  if (t.screen === "chats.agent-page" && t.args["agentId"]) return `${place}:subject=agent:${t.args["agentId"]}`;
  if (t.screen !== undefined && OWN_TAB[t.screen] !== undefined) return `${place}:${t.screen}`;
  // a page of the Console or of Settings is a tab of its own when opened beside (Cmd-press, Open in new tab); the place's own tab keeps the place's key however far it moves. Your profile is the Settings tab itself.
  const page = t.args["page"];
  if ((place === "console" || place === "settings") && typeof page === "string" && page !== "" && page !== "profile")
    return `${place}:page=${page}`;
  const type = t.args["type"];
  if (type !== undefined && type !== "") return `${place}:type=${type}`;
  return place;
}

/** Screens inside Chats that are a tab of their own, with the tab's name. */
const OWN_TAB: Readonly<Record<string, string>> = {
  "tasks.my-work": "Tasks",
  "inbox.replies": "Replies",
  "chats.artifacts": "Artifacts",
  "chats.notes": "Notes",
  "chats.agent-form": "New agent",
};

/** What a chat tab is called while the chat has no name and no message. */
export const NEW_CHAT = "New chat";

/** What a place's own tab says: its name, except Chats, whose own tab is the landing, the new chat (G7, prototype scene "new"). */
export const placeTabTitle = (place: PlaceId, hash?: string): string =>
  place === "chats" && (hash === undefined || hash === "") ? NEW_CHAT : PLACE_TITLE[place];

/** The name a tab starts with when its screen has one of its own; the place's name otherwise. */
export function screenTitle(hash: string | undefined): string | undefined {
  if (hash === undefined || !hash.includes("=")) return undefined;
  const t = parseHash(hash);
  // a chat is never named for its place: "New chat" until its own name or first message arrives
  if (t.subject !== undefined && (t.subject.type === "thread" || t.subject.type === "chat")) return NEW_CHAT;
  // an agent's page or its form, until the agent's name arrives
  if (
    (t.screen === "chats.agent-page" || t.screen === "chats.agent-form") &&
    typeof t.args["agentId"] === "string" &&
    t.args["agentId"] !== ""
  )
    return t.screen === "chats.agent-form" ? "Edit agent" : "Agent";
  if (t.subject !== undefined && t.subject.type === "agent") return "Agent";
  // a page of the Console or of Settings is named for the page
  const page = t.args["page"];
  if (typeof page === "string" && page !== "") {
    if (t.screen?.startsWith("console.") === true) return CONSOLE_PAGES.find((x) => x.id === page)?.title;
    if (t.screen === "settings.page") return SETTINGS_PAGES.find((x) => x.key === page)?.title;
  }
  return t.screen === undefined ? undefined : OWN_TAB[t.screen];
}

export function findTab(state: TabsState, key: string): TabEntry | undefined {
  return state.tabs.find((t) => t.key === key);
}

export function activeEntry(state: TabsState): TabEntry | undefined {
  return findTab(state, state.active);
}

/** The tab that holds `key`: the one opened on it, else a place's tab that is showing it now (the Inbox tab on that conversation). */
function holding(state: TabsState, key: string, except?: TabEntry): TabEntry | undefined {
  return (
    state.tabs.find((t) => t !== except && t.key === key) ??
    state.tabs.find((t) => t !== except && t.isNew !== true && tabKey(t.place, t.hash) === key)
  );
}

/** A tab that stays the tab and shows another address: a step. */
function stepTo(t: TabEntry, hash: string): TabEntry {
  const { fwd: _fwd, back: _back, next: _next, came: _came, ...rest } = t;
  return { ...rest, hash, ...pushed(t) };
}

const stepOf = (t: TabEntry): Step => ({ hash: t.hash ?? "", title: t.name ?? t.title });

/** The history a tab carries to where it moves: what it showed goes on the back list, and the forward list is cleared (a new step). */
function pushed(cur: TabEntry): Pick<TabEntry, "back" | "fwd" | "from"> {
  const back = [...(cur.back ?? []), stepOf(cur)].slice(-HISTORY_MAX);
  return { back, ...(cur.from !== undefined ? { from: cur.from } : {}) };
}

/** The history a tab keeps when it changes its name only. */
function kept(cur: TabEntry): Pick<TabEntry, "back" | "fwd" | "from" | "name" | "next" | "came"> {
  return {
    ...(cur.back !== undefined && cur.back.length > 0 ? { back: cur.back } : {}),
    ...(cur.fwd !== undefined && cur.fwd.length > 0 ? { fwd: cur.fwd } : {}),
    ...(cur.from !== undefined ? { from: cur.from } : {}),
    ...(cur.name !== undefined ? { name: cur.name } : {}),
    ...(cur.next !== undefined ? { next: cur.next } : {}),
    ...(cur.came !== undefined ? { came: cur.came } : {}),
  };
}

/**
 * The untouched "New tab" the person was on is what they opened this in: it does not stay behind as an empty tab (owner, 15 Nov 2026; team/v1/TABS-2026-11-15.md, D5).
 * A tab opened from it takes its place in the strip; a tab that was already open is selected and the empty one goes. A tab opened behind (Cmd-click) leaves it alone.
 */
function leaveNewTab(before: TabsState, after: TabsState): TabsState {
  const was = activeEntry(before);
  if (was === undefined || was.isNew !== true || after.active === was.key) return after;
  const at = after.tabs.findIndex((t) => t.key === was.key);
  if (at < 0) return after;
  const unlink = (t: TabEntry): TabEntry => {
    if (t.from !== was.key) return t;
    const { from: _from, ...rest } = t;
    return rest;
  };
  const rest = after.tabs.filter((t) => t.key !== was.key).map(unlink);
  const opened = rest.find((t) => t.key === after.active);
  if (opened === undefined || before.tabs.some((t) => t.key === opened.key))
    return { tabs: rest, active: after.active };
  const others = rest.filter((t) => t !== opened);
  others.splice(Math.min(at, others.length), 0, opened);
  return { tabs: others, active: after.active };
}

/** Opens a tab or selects the one already open with that key (or showing it). `background` opens it behind the current tab (Cmd-click). */
export function openTab(state: TabsState, tab: TabEntry, background = false, exact = false, link = false): TabsState {
  const out = openTab0(state, tab, background, exact, link);
  return background || tab.isNew === true ? out : leaveNewTab(state, out);
}

function openTab0(state: TabsState, tab: TabEntry, background: boolean, exact: boolean, link: boolean): TabsState {
  const at = holding(state, tab.key);
  if (at !== undefined) {
    if (background) return state;
    // the tab follows where its place went (a new screen inside it), so coming back lands there
    const moved = tab.hash !== undefined && tab.hash !== at.hash && !at.isNew;
    return {
      tabs: moved ? state.tabs.map((t) => (t === at ? stepTo(t, tab.hash as string) : t)) : state.tabs,
      active: at.key,
    };
  }
  // a place that already has a tab is that tab: opening the place (no item named) goes to the one it has, the one on screen first, else the one used last; one tab per place, and one per chat or record
  if (tab.hash === undefined && tab.isNew !== true && !exact) {
    const same = state.tabs.filter((t) => t.place === tab.place && t.isNew !== true);
    const there =
      same.find((t) => t.key === state.active) ?? [...same].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0] ?? undefined;
    if (there !== undefined) return background ? state : { tabs: state.tabs, active: there.key };
  }
  // an item opened by a press from the tab on screen remembers that tab: its Back goes there
  const opener = activeEntry(state);
  const opened: TabEntry =
    !background &&
    !link &&
    tab.isNew !== true &&
    tab.hash !== undefined &&
    tab.from === undefined &&
    opener !== undefined
      ? { ...tab, from: opener.key }
      : tab;
  return { tabs: placedBeside(state, opened), active: background && state.active !== "" ? state.active : tab.key };
}

/**
 * A tab opened from the tab on screen sits beside it (D2: "a new tab beside the current one"), after the tabs that one already opened, so a run of Cmd-presses reads in the order pressed.
 * A "+" tab goes to the end of the strip, and a tab that is not pinned never lands among the pinned ones.
 */
function placedBeside(state: TabsState, opened: TabEntry): TabEntry[] {
  const cur = activeEntry(state);
  const at = cur === undefined ? -1 : state.tabs.indexOf(cur);
  if (opened.isNew === true || at < 0 || cur === undefined) return [...state.tabs, opened];
  let to = at;
  while (state.tabs[to + 1]?.from === cur.key && state.tabs[to + 1]?.pinned !== true) to++;
  const out = [...state.tabs];
  out.splice(to + 1, 0, opened);
  return out;
}

/** Whether a move changes the address the tab shows (a step), as against only its name. */
function next0Moved(cur: TabEntry, hash: string | undefined): boolean {
  return (cur.hash ?? "") !== (hash ?? "");
}

/**
 * The person went somewhere inside the place the selected tab shows (a conversation in Inbox, a chat in Chats, a file in Files): the tab follows them, and no tab is opened. A place is one
 * tab (spec 3.0): a place's own tab keeps its key and only its hash moves, so the rail and links still find it. A tab opened on an item becomes the tab of what it shows now. When another
 * tab already holds where they went, that tab is selected instead, so two tabs never show the same thing. Anywhere else (another place, a "+" tab) is an ordinary open.
 */
/**
 * The name of a place's own tab as the screen inside it changes: Notes, Artifacts, Tasks ... take the tab's name while shown, and the landing's name (or the chat's) comes back when it is left. The tab's
 * KIND decides, not its title text: a title is the screen's name only while the tab's own address names that screen, so a chat a person called "Notes" or "Tasks" is never reset. The same names a saved
 * tab is restored with (readTabs), so the live tab and the restored one agree.
 */
function ownTitle(cur: TabEntry, place: PlaceId, hash: string | undefined): string {
  const screens = Object.values(OWN_TAB);
  const screenOf = (h: string | undefined): string | undefined =>
    h === undefined || !h.includes("screen=") ? undefined : screenTitle(h);
  const named = screenOf(hash);
  // only a screen the address names (screen=chats.notes): a subject (a thread, a conversation) names no screen of its own
  if (named !== undefined && screens.includes(named)) return named;
  const showing = screenOf(cur.hash);
  // leaving such a screen: the tab is named for where it is now (the landing, or a chat until its own name arrives); any other name (a chat's own, however it reads) is kept
  if (showing !== undefined && screens.includes(showing))
    return (hash === undefined || hash === "" ? undefined : screenTitle(hash)) ?? placeTabTitle(place, hash);
  return cur.title;
}

export function moveTab(state: TabsState, place: PlaceId, hash: string | undefined, title?: string): TabsState {
  const cur = activeEntry(state);
  const tab = placeTab(place, hash, title);
  if (cur === undefined || cur.isNew === true || cur.place !== place) return openTab(state, tab);
  const other = holding(state, tab.key, cur);
  if (other !== undefined) return openTab(state, { ...tab, key: other.key });
  const own = cur.key === place;
  const next: TabEntry = {
    key: own ? cur.key : tab.key,
    // a place's tab keeps its name; a tab that now shows another item starts from the place's name until that item's name arrives (hub.retitle)
    // the same chat the tab was just opened on (the page reporting its own address) keeps the name it has: the placeholder a chat address carries never replaces a real name
    title: own
      ? ownTitle(cur, place, hash)
      : cur.key === tab.key && title === NEW_CHAT && cur.title !== NEW_CHAT
        ? cur.title
        : (title ?? placeTabTitle(place, hash)),
    place,
    ...(hash === undefined || hash === "" ? {} : { hash }),
    ...(cur.pinned === true ? { pinned: true } : {}),
    ...(next0Moved(cur, hash) ? pushed(cur) : kept(cur)),
    // a place's own tab names the item it shows now
    ...(own && hash !== undefined && hash !== "" && title !== undefined ? { name: title } : {}),
  };
  if (next.key === cur.key && next.hash === cur.hash && next.title === cur.title) return state;
  return { tabs: state.tabs.map((t) => (t === cur ? next : t)), active: next.key };
}

/**
 * The "+" tab on screen becomes what was opened from it (a chat started from its search): the same tab, no second one beside it, none left called "New tab". A chat already open in another tab is selected
 * and the "+" tab goes. When the selected tab is not a "+" tab this is an ordinary open.
 */
export function fillTab(
  state: TabsState,
  place: PlaceId,
  hash: string | undefined,
  title?: string,
  from?: string,
): TabsState {
  // the tab the press came from, by its key; the selected one when no key is given. The person may have gone to another tab while the chat was being made: that tab stays selected.
  const cur = from === undefined ? activeEntry(state) : findTab(state, from);
  const tab = placeTab(place, hash, title);
  if (cur === undefined || cur.isNew !== true) return openTab(state, tab);
  const wasActive = state.active === cur.key;
  const other = holding(state, tab.key, cur);
  if (other !== undefined)
    return { tabs: state.tabs.filter((t) => t !== cur), active: wasActive ? other.key : state.active };
  return {
    tabs: state.tabs.map((t) => (t === cur ? { ...tab, ...(cur.pinned === true ? { pinned: true } : {}) } : t)),
    active: wasActive ? tab.key : state.active,
  };
}

/**
 * The person asked for a place's landing itself (an address with no item, /chat): the tab that shows it is the place's own tab. One that already exists is selected; else the selected tab of that
 * place becomes it (the same-tab navigation changes that tab, so a tab never names the item it no longer shows); else it is opened. A tab on an item elsewhere is another tab and stays.
 */
export function landOn(state: TabsState, place: PlaceId): TabsState {
  const key = tabKey(place);
  const own = state.tabs.find((t) => t.key === key && t.isNew !== true);
  if (own !== undefined) return leaveNewTab(state, selectTab(state, own.key));
  const cur = activeEntry(state);
  if (cur === undefined || cur.isNew === true || cur.place !== place)
    return openTab(state, placeTab(place), false, true);
  const next: TabEntry = {
    key,
    title: placeTabTitle(place),
    place,
    ...(cur.pinned === true ? { pinned: true } : {}),
    ...(next0Moved(cur, undefined) ? pushed(cur) : kept(cur)),
  };
  return { tabs: state.tabs.map((t) => (t === cur ? next : t)), active: key };
}

/**
 * The tab to select after `closed` goes away (D6): the one the person was on before it (`recent`, the tabs selected before, latest first) when it is still open, else the one it was opened or
 * selected from, else the neighbour on the left, else the one on the right.
 */
export function afterClosing(
  tabs: readonly TabEntry[],
  closed: string,
  active: string,
  recent: readonly string[] = [],
): string {
  if (closed !== active) return active;
  const open = (k: string | undefined): k is string => k !== undefined && k !== closed && tabs.some((t) => t.key === k);
  const back = recent.find(open);
  if (back !== undefined) return back;
  const at = tabs.findIndex((t) => t.key === closed);
  const came = tabs[at]?.came;
  if (open(came)) return came;
  return tabs[at - 1]?.key ?? tabs[at + 1]?.key ?? "";
}

export function closeTab(state: TabsState, key: string, recent: readonly string[] = []): TabsState {
  const tab = findTab(state, key);
  if (tab === undefined || tab.pinned === true) return state;
  const active = afterClosing(state.tabs, key, state.active, recent);
  return { tabs: state.tabs.filter((t) => t.key !== key), active };
}

export function closeTabs(state: TabsState, keys: readonly string[], recent: readonly string[] = []): TabsState {
  let next = state;
  for (const k of keys) next = closeTab(next, k, recent);
  return next;
}

export function selectTab(state: TabsState, key: string): TabsState {
  return findTab(state, key) === undefined || state.active === key ? state : { tabs: state.tabs, active: key };
}

/** Pinned tabs sit at the left in the order they were pinned; a tab pinned or unpinned moves to the edge of the pinned group. */
export function pinTab(state: TabsState, key: string, on: boolean): TabsState {
  const tab = findTab(state, key);
  if (tab === undefined || (tab.pinned === true) === on || tab.isNew === true) return state;
  const rest = state.tabs.filter((t) => t.key !== key);
  const pinned = rest.filter((t) => t.pinned === true);
  const loose = rest.filter((t) => t.pinned !== true);
  const { pinned: _p, ...plain } = tab;
  return on
    ? { tabs: [...pinned, { ...plain, pinned: true }, ...loose], active: state.active }
    : { tabs: [...pinned, plain, ...loose], active: state.active };
}

/** The unpinned tabs to the right of `key`, nearest first. */
export function keysToTheRight(state: TabsState, key: string): string[] {
  const at = state.tabs.findIndex((t) => t.key === key);
  return at < 0
    ? []
    : state.tabs
        .slice(at + 1)
        .filter((t) => t.pinned !== true)
        .map((t) => t.key);
}

/** Puts the tabs in the order of `keys`. Unknown keys are ignored; tabs missing from `keys` keep their relative order at the end. */
export function reorderTabs(state: TabsState, keys: readonly string[]): TabsState {
  const by = new Map(state.tabs.map((t) => [t.key, t] as const));
  const out: TabEntry[] = [];
  for (const k of keys) {
    const t = by.get(k);
    if (t !== undefined) {
      out.push(t);
      by.delete(k);
    }
  }
  for (const t of state.tabs) if (by.has(t.key)) out.push(t);
  return { tabs: out, active: state.active };
}

/* ---------- Back and Forward: one history per tab (NAV-2026-11-14) ---------- */

const FILE_UP: readonly string[] = ["file", "doc", "document"];

/** The address one level up inside a place: an item goes to the list it belongs to, a list goes to the place's landing. Null at the landing. */
export function upHash(hash: string | undefined): string | null {
  if (hash === undefined || hash === "") return null;
  if (!hash.includes("=")) return "";
  const t = parseHash(hash);
  // a file opened cold goes up to the folder it sits in, once the Files place has read the file (file-folders.ts); until then, and for a file it cannot place, to the landing
  if (t.subject !== undefined && FILE_UP.includes(t.subject.type)) {
    const folder = folderOfFile(t.subject.id);
    if (folder !== undefined) return `subject=folder:${folder}`;
  }
  const type = t.args["type"];
  // an item that names the list it sits in (a record's type, a file's folder) goes to that list
  if ((t.subject !== undefined || t.screen !== undefined) && typeof type === "string" && type !== "") {
    const list = `type=${type}`;
    return list === hash ? "" : list;
  }
  return "";
}

const ownTab = (t: TabEntry): boolean => t.key === t.place;

/** The key a tab would have showing `hash`. A place's own tab keeps its key. */
function keyAt(cur: TabEntry, hash: string): string {
  return ownTab(cur) ? cur.key : tabKey(cur.place, hash === "" ? undefined : hash);
}

/** Whether the tab can show `hash`: no other tab already shows it (that tab is where it lives). */
function free(state: TabsState, cur: TabEntry, hash: string): boolean {
  const item = tabKey(cur.place, hash === "" ? undefined : hash);
  return item === cur.key || holding(state, item, cur) === undefined;
}

/** Where Back goes from the selected tab: a step it took, the tab it was opened from, or one level up. Null when there is nowhere. */
export type BackTarget =
  | { kind: "step"; index: number; title: string; hash: string }
  | { kind: "opener"; key: string; title: string }
  | { kind: "up"; hash: string; title: string };

export function backTarget(state: TabsState, o: { up?: boolean } = {}): BackTarget | null {
  const cur = activeEntry(state);
  if (cur === undefined || cur.isNew === true) return null;
  // the last thing done was selecting this tab (the rail, the strip, a link): Back undoes that first, then the steps the tab itself took
  const entered = cur.came === undefined ? undefined : findTab(state, cur.came);
  if (entered !== undefined && entered !== cur)
    return { kind: "opener", key: entered.key, title: entered.name ?? entered.title };
  const steps = cur.back ?? [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i] as Step;
    if (free(state, cur, s.hash)) return { kind: "step", index: i, ...s };
  }
  const opener = cur.from === undefined ? undefined : findTab(state, cur.from);
  if (opener !== undefined && opener !== cur)
    return { kind: "opener", key: opener.key, title: opener.name ?? opener.title };
  if (o.up === false) return null;
  const up = upHash(cur.hash);
  if (up === null) return null;
  return {
    kind: "up",
    hash: up,
    title: up === "" ? PLACE_TITLE[cur.place] : (screenTitle(up) ?? PLACE_TITLE[cur.place]),
  };
}

/** Where Forward goes from the selected tab: a step Back stepped away from, or the tab Back came from. */
export type ForwardTarget =
  | { kind: "step"; index: number; title: string; hash: string }
  | { kind: "tab"; key: string; title: string };

export function forwardTarget(state: TabsState): ForwardTarget | null {
  const cur = activeEntry(state);
  if (cur === undefined || cur.isNew === true) return null;
  const steps = cur.fwd ?? [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i] as Step;
    if (free(state, cur, s.hash)) return { kind: "step", index: i, ...s };
  }
  const next = cur.next === undefined ? undefined : findTab(state, cur.next);
  if (next !== undefined && next !== cur) return { kind: "tab", key: next.key, title: next.name ?? next.title };
  return null;
}

function showing(cur: TabEntry, s: Step, back: readonly Step[], fwd: readonly Step[]): TabEntry {
  const { back: _b, fwd: _f, hash: _h, name: _n, ...rest } = cur;
  return {
    ...rest,
    key: keyAt(cur, s.hash),
    // a place's own tab keeps its name and names the item it shows; an item's tab has the name it had there
    title: ownTab(cur) ? cur.title : s.title,
    ...(ownTab(cur) && s.hash !== "" ? { name: s.title } : {}),
    ...(s.hash === "" ? {} : { hash: s.hash }),
    ...(back.length > 0 ? { back } : {}),
    ...(fwd.length > 0 ? { fwd } : {}),
  };
}

/** Leaving a tab for another that is already open (the one this was opened from, or the one that shows where Back goes): that tab is selected, this one stays, and Forward comes back to it. */
function goTo(state: TabsState, from: TabEntry, to: string): TabsState {
  return {
    tabs: state.tabs.map((t) => {
      // the selection this Back undoes is spent (so Back goes on to the one before it); Forward on the tab it returned to comes back here
      if (t.key === from.key) {
        const { came: _c, ...rest } = t;
        return rest;
      }
      return t.key === to ? { ...t, next: from.key } : t;
    }),
    active: to,
  };
}

/** Back from the selected tab. */
export function goBack(state: TabsState, o: { up?: boolean } = {}): TabsState {
  const to = backTarget(state, o);
  const cur = activeEntry(state);
  if (to === null || cur === undefined) return state;
  if (to.kind === "opener") return goTo(state, cur, to.key);
  const here = stepOf(cur);
  const fwd = [...(cur.fwd ?? []), here].slice(-HISTORY_MAX);
  if (to.kind === "up") {
    // one level up is where another tab already is (the place's own tab): go there
    const held = holding(state, tabKey(cur.place, to.hash === "" ? undefined : to.hash), cur);
    if (held !== undefined) return goTo(state, cur, held.key);
    const next = showing(cur, { hash: to.hash, title: to.title }, cur.back ?? [], fwd);
    return { tabs: state.tabs.map((t) => (t === cur ? next : t)), active: next.key };
  }
  const steps = cur.back ?? [];
  const next = showing(cur, to, steps.slice(0, to.index), fwd);
  return { tabs: state.tabs.map((t) => (t === cur ? next : t)), active: next.key };
}

/** Forward from the selected tab. */
export function goForward(state: TabsState): TabsState {
  const to = forwardTarget(state);
  const cur = activeEntry(state);
  if (to === null || cur === undefined) return state;
  if (to.kind === "tab") {
    const { next: _n, ...rest } = cur;
    return {
      tabs: state.tabs.map((t) => (t === cur ? rest : t.key === to.key ? { ...t, came: cur.key } : t)),
      active: to.key,
    };
  }
  const steps = cur.fwd ?? [];
  const back = [...(cur.back ?? []), stepOf(cur)].slice(-HISTORY_MAX);
  const next = showing(cur, to, back, steps.slice(0, to.index));
  return { tabs: state.tabs.map((t) => (t === cur ? next : t)), active: next.key };
}

/** A place's own tab, or an item inside it. */
export function placeTab(place: PlaceId, hash?: string, title?: string): TabEntry {
  return {
    key: tabKey(place, hash),
    title: title ?? placeTabTitle(place, hash),
    place,
    ...(hash === undefined || hash === "" ? {} : { hash }),
  };
}

let newCounter = 0;

/** A fresh "+" tab. The counter keeps keys unique inside one session; restored tabs keep the key they were saved with. */
export function newTabEntry(from: PlaceId, existing: TabsState): TabEntry {
  let key = "";
  do {
    newCounter += 1;
    key = `new:${newCounter}`;
  } while (findTab(existing, key) !== undefined);
  return { key, title: "New tab", place: from, isNew: true };
}

/* ---------- storage: this device only ---------- */

export interface TabsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The key names the device, the person and the Space, so two Spaces (or two people on one device) never share a tab list. */
export function tabsStorageKey(deviceId: string, personId: string, spaceId: string): string {
  return `vyre.tabs.v1:${deviceId}:${personId}:${spaceId}`;
}

/**
 * Tabs saved before the rule held can show the same thing twice. One tab stays for each place, chat or record, the one used last. Two chats are two tabs even when neither has a name yet.
 */
/** Places that are one tab however they were reached: a conversation opened in Inbox moves the Inbox tab, it is never a second Inbox. */
const ONE_TAB_PLACES: readonly PlaceId[] = ["inbox"];

export function dedupeTabs(state: TabsState): TabsState {
  const newest = (a: TabEntry, b: TabEntry): TabEntry =>
    ((b.at ?? 0) >= (a.at ?? 0) && state.tabs.indexOf(b) > state.tabs.indexOf(a)) || (b.at ?? 0) > (a.at ?? 0) ? b : a;
  const winner = new Map<string, TabEntry>();
  for (const t of state.tabs) {
    if (t.isNew === true) continue;
    const id = tabKey(t.place, t.hash);
    const cur = winner.get(id);
    winner.set(id, cur === undefined ? t : newest(cur, t));
  }
  // blank chats left open: one stays, the one used last
  const blanks = state.tabs.filter(
    (t) => t.empty === true && t.pinned !== true && winner.get(tabKey(t.place, t.hash)) === t,
  );
  const blank = blanks.reduce<TabEntry | undefined>((a, b) => (a === undefined ? b : newest(a, b)), undefined);
  // an Inbox tab saved twice (the place and a conversation in it): the one used last stays
  const lone = new Map<string, TabEntry>();
  for (const t of state.tabs) {
    if (t.isNew === true || !ONE_TAB_PLACES.includes(t.place)) continue;
    const cur = lone.get(t.place);
    lone.set(
      t.place,
      cur === undefined || (cur.pinned !== true && (t.pinned === true || newest(cur, t) === t)) ? t : cur,
    );
  }
  const tabs = state.tabs.filter(
    (t) =>
      (t.isNew === true || winner.get(tabKey(t.place, t.hash)) === t || t.pinned === true) &&
      !(t.empty === true && t.pinned !== true && t !== blank) &&
      (t.isNew === true || !ONE_TAB_PLACES.includes(t.place) || lone.get(t.place) === t),
  );
  if (tabs.length === state.tabs.length) return state;
  return {
    tabs,
    active: tabs.some((t) => t.key === state.active)
      ? state.active
      : ([...tabs].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0]?.key ?? ""),
  };
}

/** The blank chat tab that is open, if there is one: "New chat" goes to it instead of making a second. A chat that was opened and happens to be empty is a real chat; it is only marked blank once its name was read. */
export function blankChat(state: TabsState): TabEntry | undefined {
  return state.tabs.find((t) => t.empty === true && t.isNew !== true);
}

export function writeTabs(state: TabsState): string {
  return JSON.stringify({ v: 1, active: state.active, tabs: state.tabs });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Steps as saved; anything that is not a step is dropped. */
function readSteps(v: unknown): Step[] {
  if (!Array.isArray(v)) return [];
  const out: Step[] = [];
  for (const row of v as unknown[]) {
    if (isRecord(row) && typeof row["hash"] === "string" && typeof row["title"] === "string")
      out.push({ hash: row["hash"], title: row["title"] });
  }
  return out.slice(-HISTORY_MAX);
}

const KNOWN_PLACES: ReadonlySet<string> = new Set(Object.keys(PLACE_TITLE));

/** Reads what writeTabs wrote. Anything malformed is null, and the Space opens on its Kit's start place instead. */
export function readTabs(raw: string | null): TabsState | null {
  if (raw === null || raw === "") return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data["v"] !== 1 || typeof data["active"] !== "string" || !Array.isArray(data["tabs"]))
    return null;
  const tabs: TabEntry[] = [];
  const seen = new Set<string>();
  const renamed = new Map<string, string>();
  for (const row of data["tabs"] as unknown[]) {
    if (!isRecord(row)) return null;
    const { key, title, place, hash, isNew, pinned, at, empty } = row;
    const back = readSteps(row["back"]);
    const fwd = readSteps(row["fwd"]);
    const from = typeof row["from"] === "string" ? row["from"] : undefined;
    const name = typeof row["name"] === "string" ? row["name"] : undefined;
    const came = typeof row["came"] === "string" ? row["came"] : undefined;
    const nextTab = typeof row["next"] === "string" ? row["next"] : undefined;
    if (typeof key !== "string" || typeof title !== "string" || typeof place !== "string" || !KNOWN_PLACES.has(place))
      return null;
    const hashText = typeof hash === "string" && hash !== "" ? hash : undefined;
    // a tab saved on Home reopens in Chats, where Home went
    const where = livePlace(place as PlaceId);
    // tab lists saved before a place was unique can hold the same place or item twice: one tab per identity, the first kept
    const id = isNew === true ? key : tabKey(where, hashText);
    renamed.set(key, id);
    if (seen.has(id)) {
      // the same thing saved twice: the copy used last stays, in the first one's place
      const at0 = tabs.findIndex((t) => t.key === id);
      const kept = tabs[at0];
      if (kept !== undefined) {
        if (pinned === true) kept.pinned = true;
        if (typeof at === "number" && at > (kept.at ?? 0)) {
          kept.at = at;
          kept.title = title;
        }
      }
      continue;
    }
    seen.add(id);
    tabs.push({
      key: id,
      title:
        place === "home" && where !== place
          ? hashText === undefined
            ? PLACE_TITLE.chats
            : title
          : hashText !== undefined && (title === PLACE_TITLE[where] || (where === "chats" && title === NEW_CHAT))
            ? (screenTitle(hashText) ?? title)
            : title,
      place: where,
      ...(typeof hash === "string" && hash !== "" ? { hash } : {}),
      ...(isNew === true ? { isNew: true } : {}),
      ...(pinned === true ? { pinned: true } : {}),
      ...(typeof at === "number" ? { at } : {}),
      // a chat saved while its name read as blank carries the placeholder title: tab lists saved before the mark held are marked now, so they collapse to one like the rest
      ...((empty === true ||
        (title === NEW_CHAT && pinned !== true && isNew !== true && screenTitle(hashText) === NEW_CHAT)) &&
      hashText !== undefined
        ? { empty: true as const }
        : {}),
      ...(back.length > 0 ? { back } : {}),
      ...(fwd.length > 0 ? { fwd } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(came !== undefined ? { came } : {}),
      ...(nextTab !== undefined ? { next: nextTab } : {}),
    });
  }
  const active = renamed.get(data["active"]) ?? data["active"];
  return { tabs, active: tabs.some((t) => t.key === active) ? active : (tabs[0]?.key ?? "") };
}

/** A tab list without the tabs of places a Space does not show; the selection moves to a neighbour when its tab goes. */
export function withoutPlaces(state: TabsState, hidden: readonly PlaceId[]): TabsState {
  if (!state.tabs.some((t) => hidden.includes(t.place))) return state;
  const tabs = state.tabs.filter((t) => !hidden.includes(t.place));
  return { tabs, active: tabs.some((t) => t.key === state.active) ? state.active : (tabs[0]?.key ?? "") };
}

/* ---------- the controller for one Space on one device ---------- */

export interface TabsController {
  readonly spaceId: string;
  state(): TabsState;
  subscribe(listener: () => void): () => void;
  /** Open a place (or an item in it) as a tab, or select it. */
  openPlace(place: PlaceId, hash?: string, title?: string, background?: boolean, link?: boolean): void;
  /** The place's landing was asked for by address: its own tab shows it (landOn). */
  land(place: PlaceId): void;
  /** The person went somewhere inside the selected tab's place: the tab follows (moveTab). */
  move(place: PlaceId, hash?: string, title?: string): void;
  /** The "+" tab on screen becomes what was opened from it (fillTab). */
  fill(place: PlaceId, hash?: string, title?: string, from?: string): void;
  newTab(from: PlaceId): TabEntry;
  select(key: string): void;
  close(key: string): void;
  closeMany(keys: readonly string[]): void;
  reorder(keys: readonly string[]): void;
  /** Rename a tab (a chat title arrives after the tab opens). */
  retitle(key: string, title: string, empty?: boolean): void;
  /** Pin a tab (it stays at the left, and Close does not take it) or let it go. */
  pin(key: string, on: boolean): void;
  /** Close every unpinned tab to the right of this one. */
  closeRight(key: string): void;
  /** Back in the selected tab: a step it took, the tab it was opened from, or one level up. False when there is nowhere to go. */
  back(o?: { up?: boolean }): boolean;
  /** Forward in the selected tab, after Back. */
  forward(): boolean;
  /** A tab that was closed comes back, the last closed first. */
  reopen(): void;
  /** Whether a closed tab can come back. */
  canReopen(): boolean;
}

export interface TabsControllerOptions {
  deviceId: string;
  personId: string;
  spaceId: string;
  /** This device's storage; null keeps tabs in memory for the session. */
  storage: TabsStorage | null;
  /** The place a Space opens on when nothing was saved. */
  start: PlaceId;
  /** Places this Space does not show (a Personal Space has no Apps): never opened as a tab, dropped from a saved list. */
  hidden?: readonly PlaceId[];
}

export function createTabsController(options: TabsControllerOptions): TabsController {
  const storeKey = tabsStorageKey(options.deviceId, options.personId, options.spaceId);
  const hidden = options.hidden ?? [];
  let state: TabsState = (() => {
    let raw: string | null = null;
    try {
      raw = options.storage === null ? null : options.storage.getItem(storeKey);
    } catch {
      raw = null;
    }
    const saved = readTabs(raw);
    const kept = saved === null ? null : dedupeTabs(withoutPlaces(saved, hidden));
    return kept !== null && kept.tabs.length > 0 ? kept : openTab(EMPTY_TABS, placeTab(options.start));
  })();
  const listeners = new Set<() => void>();
  /** Closed tabs, the last closed on top: Reopen Closed Tab takes them back. Kept for this session only. */
  const closed: TabEntry[] = [];
  const remember = (keys: readonly string[]): void => {
    for (const k of keys) {
      const t = findTab(state, k);
      if (t !== undefined && t.pinned !== true && t.isNew !== true) {
        closed.push(t);
        if (closed.length > 10) closed.shift();
      }
    }
  };

  /** The tabs selected before this one, latest first: closing the selected tab returns to the one the person was on (D6). */
  const recent: string[] = [];
  /** Back and Forward select tabs without that being a new step. */
  let navigating = false;
  const set = (given: TabsState): void => {
    // closing the last tab leaves the Space's start place open, never an empty stage
    let next = given.tabs.length === 0 ? openTab(EMPTY_TABS, placeTab(options.start)) : given;
    // the tab the person is on is the one used last: stamp it, so "the most recent" has a meaning
    if (next.active !== state.active || state.tabs.length === 0)
      next = {
        tabs: next.tabs.map((t) => (t.key === next.active ? { ...t, at: Date.now() } : t)),
        active: next.active,
      };
    // selecting another tab (the rail, the strip, a link) is remembered on the tab selected: Back returns to where the person was
    if (
      !navigating &&
      next.active !== state.active &&
      state.active !== "" &&
      next.tabs.some((t) => t.key === state.active)
    )
      next = {
        tabs: next.tabs.map((t) => {
          if (t.key !== next.active) return t;
          const { next: _n, ...rest } = t;
          return { ...rest, came: state.active };
        }),
        active: next.active,
      };
    if (next === state) return;
    if (next.active !== state.active && state.active !== "") {
      const at = recent.indexOf(state.active);
      if (at >= 0) recent.splice(at, 1);
      recent.unshift(state.active);
      recent.length = Math.min(recent.length, 30);
    }
    state = next;
    try {
      options.storage?.setItem(storeKey, writeTabs(state));
    } catch {
      // Storage can be full or blocked; the tabs still hold for this session.
    }
    for (const l of [...listeners]) l();
  };

  return {
    spaceId: options.spaceId,
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    openPlace(place, hash, title, background = false, link = false) {
      if (hidden.includes(place)) return;
      // a link (an address, a pasted URL) is not reached from the tab on screen: it has an up, not a way back to a tab the person never pressed from
      navigating = link;
      try {
        set(openTab(state, placeTab(place, hash, title), background, false, link));
      } finally {
        navigating = false;
      }
    },
    move(place, hash, title) {
      if (hidden.includes(place)) return;
      set(moveTab(state, place, hash, title));
    },
    fill(place, hash, title, from) {
      if (hidden.includes(place)) return;
      set(fillTab(state, place, hash, title, from));
    },
    land(place) {
      if (hidden.includes(place)) return;
      set(landOn(state, place));
    },
    newTab(from) {
      // a blank chat is already open: New chat goes to it, and no tab is added
      const blank = blankChat(state);
      if (blank !== undefined) {
        set(selectTab(state, blank.key));
        return blank;
      }
      const tab = newTabEntry(from, state);
      set(openTab(state, tab));
      return tab;
    },
    select(key) {
      // choosing among open tabs in the strip is not a step: Back in that tab steps that tab's own history
      navigating = true;
      try {
        set(selectTab(state, key));
      } finally {
        navigating = false;
      }
    },
    close(key) {
      remember([key]);
      set(closeTab(state, key, recent));
    },
    closeMany(keys) {
      remember(keys);
      set(closeTabs(state, keys, recent));
    },
    pin(key, on) {
      set(pinTab(state, key, on));
    },
    closeRight(key) {
      const keys = keysToTheRight(state, key);
      remember(keys);
      set(closeTabs(state, keys, recent));
    },
    reopen() {
      const tab = closed.pop();
      if (tab === undefined || hidden.includes(tab.place)) return;
      set(openTab(state, tab));
    },
    canReopen: () => closed.length > 0,
    back(o) {
      const next = goBack(state, o);
      if (next === state) return false;
      navigating = true;
      try {
        set(next);
      } finally {
        navigating = false;
      }
      return true;
    },
    forward() {
      const next = goForward(state);
      if (next === state) return false;
      navigating = true;
      try {
        set(next);
      } finally {
        navigating = false;
      }
      return true;
    },
    reorder(keys) {
      set(reorderTabs(state, keys));
    },
    retitle(key, title, empty) {
      if (findTab(state, key) === undefined) return;
      set({
        tabs: state.tabs.map((t) =>
          t.key === key
            ? (({ empty: _e, ...rest }) => ({ ...rest, title, ...(empty === true ? { empty: true as const } : {}) }))(t)
            : t,
        ),
        active: state.active,
      });
    },
  };
}
