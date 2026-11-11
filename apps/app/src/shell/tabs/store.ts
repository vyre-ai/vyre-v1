// Main-view tabs (spec 3.0, 4.7, ARCH 7.0): per device and per Space, restored when you return to a Space, never synced.
// The state is a plain value (immutable), the controller keeps it for one Space on one device and writes it to this device's storage under a key that names
// the device, the person and the Space. Nothing here calls the server: a tab list that left the device would make Starred and tabs the same thing, and they are not.
import type { PlaceId } from "../rail/kits.ts";
import { PLACE_TITLE, livePlace } from "../rail/kits.ts";
import { parseHash, subjectOf } from "../hash/hash.ts";

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
}

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
  if (t.screen !== undefined && OWN_TAB[t.screen] !== undefined) return `${place}:${t.screen}`;
  const type = t.args["type"];
  if (type !== undefined && type !== "") return `${place}:type=${type}`;
  return place;
}

/** Screens inside Chats that are a tab of their own, with the tab's name. */
const OWN_TAB: Readonly<Record<string, string>> = { "tasks.my-work": "Tasks", "inbox.replies": "Replies", "chats.artifacts": "Artifacts", "chats.notes": "Notes", "chats.agent-form": "New agent" };

/** What a chat tab is called while the chat has no name and no message. */
export const NEW_CHAT = "New chat";

/** The name a tab starts with when its screen has one of its own; the place's name otherwise. */
export function screenTitle(hash: string | undefined): string | undefined {
  if (hash === undefined || !hash.includes("=")) return undefined;
  const t = parseHash(hash);
  // a chat is never named for its place: "New chat" until its own name or first message arrives
  if (t.subject !== undefined && (t.subject.type === "thread" || t.subject.type === "chat")) return NEW_CHAT;
  // an agent's page or its form, until the agent's name arrives
  if ((t.screen === "chats.agent-page" || t.screen === "chats.agent-form") && typeof t.args["agentId"] === "string" && t.args["agentId"] !== "") return t.screen === "chats.agent-form" ? "Edit agent" : "Agent";
  if (t.subject !== undefined && t.subject.type === "agent") return "Agent";
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
  return state.tabs.find((t) => t !== except && t.key === key) ?? state.tabs.find((t) => t !== except && t.isNew !== true && tabKey(t.place, t.hash) === key);
}

/** Opens a tab or selects the one already open with that key (or showing it). `background` opens it behind the current tab (Cmd-click). */
export function openTab(state: TabsState, tab: TabEntry, background = false, exact = false): TabsState {
  const at = holding(state, tab.key);
  if (at !== undefined) {
    if (background) return state;
    // the tab follows where its place went (a new screen inside it), so coming back lands there
    const moved = tab.hash !== undefined && tab.hash !== at.hash && !at.isNew;
    return { tabs: moved ? state.tabs.map((t) => (t === at ? { ...t, hash: tab.hash as string } : t)) : state.tabs, active: at.key };
  }
  // a place that already has a tab is that tab: opening the place (no item named) goes to the one it has, the one on screen first, else the one used last; one tab per place, and one per chat or record
  if (tab.hash === undefined && tab.isNew !== true && !exact) {
    const same = state.tabs.filter((t) => t.place === tab.place && t.isNew !== true);
    const there = same.find((t) => t.key === state.active) ?? [...same].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0] ?? undefined;
    if (there !== undefined) return background ? state : { tabs: state.tabs, active: there.key };
  }
  const tabs = [...state.tabs, tab];
  return { tabs, active: background && state.active !== "" ? state.active : tab.key };
}

/**
 * The person went somewhere inside the place the selected tab shows (a conversation in Inbox, a chat in Chats, a file in Files): the tab follows them, and no tab is opened. A place is one
 * tab (spec 3.0): a place's own tab keeps its key and only its hash moves, so the rail and links still find it. A tab opened on an item becomes the tab of what it shows now. When another
 * tab already holds where they went, that tab is selected instead, so two tabs never show the same thing. Anywhere else (another place, a "+" tab) is an ordinary open.
 */
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
    title: own ? cur.title : title ?? PLACE_TITLE[place],
    place,
    ...(hash === undefined || hash === "" ? {} : { hash }),
    ...(cur.pinned === true ? { pinned: true } : {}),
  };
  if (next.key === cur.key && next.hash === cur.hash && next.title === cur.title) return state;
  return { tabs: state.tabs.map((t) => (t === cur ? next : t)), active: next.key };
}

/**
 * The person asked for a place's landing itself (an address with no item, /chat): the tab that shows it is the place's own tab. One that already exists is selected; else the selected tab of that
 * place becomes it (the same-tab navigation changes that tab, so a tab never names the item it no longer shows); else it is opened. A tab on an item elsewhere is another tab and stays.
 */
export function landOn(state: TabsState, place: PlaceId): TabsState {
  const key = tabKey(place);
  const own = state.tabs.find((t) => t.key === key && t.isNew !== true);
  if (own !== undefined) return selectTab(state, own.key);
  const cur = activeEntry(state);
  if (cur === undefined || cur.isNew === true || cur.place !== place) return openTab(state, placeTab(place), false, true);
  const next: TabEntry = { key, title: PLACE_TITLE[place], place, ...(cur.pinned === true ? { pinned: true } : {}) };
  return { tabs: state.tabs.map((t) => (t === cur ? next : t)), active: key };
}

/** The tab to select after `closed` goes away: the neighbour on the right, else on the left. */
export function afterClosing(tabs: readonly TabEntry[], closed: string, active: string): string {
  if (closed !== active) return active;
  const at = tabs.findIndex((t) => t.key === closed);
  return tabs[at + 1]?.key ?? tabs[at - 1]?.key ?? "";
}

export function closeTab(state: TabsState, key: string): TabsState {
  const tab = findTab(state, key);
  if (tab === undefined || tab.pinned === true) return state;
  const active = afterClosing(state.tabs, key, state.active);
  return { tabs: state.tabs.filter((t) => t.key !== key), active };
}

export function closeTabs(state: TabsState, keys: readonly string[]): TabsState {
  let next = state;
  for (const k of keys) next = closeTab(next, k);
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
  return on ? { tabs: [...pinned, { ...plain, pinned: true }, ...loose], active: state.active } : { tabs: [...pinned, plain, ...loose], active: state.active };
}

/** The unpinned tabs to the right of `key`, nearest first. */
export function keysToTheRight(state: TabsState, key: string): string[] {
  const at = state.tabs.findIndex((t) => t.key === key);
  return at < 0 ? [] : state.tabs.slice(at + 1).filter((t) => t.pinned !== true).map((t) => t.key);
}

/** Puts the tabs in the order of `keys`. Unknown keys are ignored; tabs missing from `keys` keep their relative order at the end. */
export function reorderTabs(state: TabsState, keys: readonly string[]): TabsState {
  const by = new Map(state.tabs.map((t) => [t.key, t] as const));
  const out: TabEntry[] = [];
  for (const k of keys) {
    const t = by.get(k);
    if (t !== undefined) { out.push(t); by.delete(k); }
  }
  for (const t of state.tabs) if (by.has(t.key)) out.push(t);
  return { tabs: out, active: state.active };
}

/** A place's own tab, or an item inside it. */
export function placeTab(place: PlaceId, hash?: string, title?: string): TabEntry {
  return { key: tabKey(place, hash), title: title ?? PLACE_TITLE[place], place, ...(hash === undefined || hash === "" ? {} : { hash }) };
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
  const newest = (a: TabEntry, b: TabEntry): TabEntry => ((b.at ?? 0) >= (a.at ?? 0) && state.tabs.indexOf(b) > state.tabs.indexOf(a)) || (b.at ?? 0) > (a.at ?? 0) ? b : a;
  const winner = new Map<string, TabEntry>();
  for (const t of state.tabs) {
    if (t.isNew === true) continue;
    const id = tabKey(t.place, t.hash);
    const cur = winner.get(id);
    winner.set(id, cur === undefined ? t : newest(cur, t));
  }
  // blank chats left open: one stays, the one used last
  const blanks = state.tabs.filter((t) => t.empty === true && t.pinned !== true && winner.get(tabKey(t.place, t.hash)) === t);
  const blank = blanks.reduce<TabEntry | undefined>((a, b) => (a === undefined ? b : newest(a, b)), undefined);
  // an Inbox tab saved twice (the place and a conversation in it): the one used last stays
  const lone = new Map<string, TabEntry>();
  for (const t of state.tabs) {
    if (t.isNew === true || !ONE_TAB_PLACES.includes(t.place)) continue;
    const cur = lone.get(t.place);
    lone.set(t.place, cur === undefined || cur.pinned !== true && (t.pinned === true || newest(cur, t) === t) ? t : cur);
  }
  const tabs = state.tabs.filter((t) => (t.isNew === true || winner.get(tabKey(t.place, t.hash)) === t || t.pinned === true) && !(t.empty === true && t.pinned !== true && t !== blank) && (t.isNew === true || !ONE_TAB_PLACES.includes(t.place) || lone.get(t.place) === t));
  if (tabs.length === state.tabs.length) return state;
  return { tabs, active: tabs.some((t) => t.key === state.active) ? state.active : ([...tabs].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0]?.key ?? "") };
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
  if (!isRecord(data) || data["v"] !== 1 || typeof data["active"] !== "string" || !Array.isArray(data["tabs"])) return null;
  const tabs: TabEntry[] = [];
  const seen = new Set<string>();
  const renamed = new Map<string, string>();
  for (const row of data["tabs"] as unknown[]) {
    if (!isRecord(row)) return null;
    const { key, title, place, hash, isNew, pinned, at, empty } = row;
    if (typeof key !== "string" || typeof title !== "string" || typeof place !== "string" || !KNOWN_PLACES.has(place)) return null;
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
        if (typeof at === "number" && at > (kept.at ?? 0)) { kept.at = at; kept.title = title; }
      }
      continue;
    }
    seen.add(id);
    tabs.push({
      key: id,
      title: place === "home" && where !== place ? (hashText === undefined ? PLACE_TITLE.chats : title) : hashText !== undefined && title === PLACE_TITLE[where] ? (screenTitle(hashText) ?? title) : title,
      place: where,
      ...(typeof hash === "string" && hash !== "" ? { hash } : {}),
      ...(isNew === true ? { isNew: true } : {}),
      ...(pinned === true ? { pinned: true } : {}),
      ...(typeof at === "number" ? { at } : {}),
      // a chat saved while its name read as blank carries the placeholder title: tab lists saved before the mark held are marked now, so they collapse to one like the rest
      ...((empty === true || (title === NEW_CHAT && pinned !== true && isNew !== true)) && hashText !== undefined ? { empty: true as const } : {}),
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
  openPlace(place: PlaceId, hash?: string, title?: string, background?: boolean): void;
  /** The place's landing was asked for by address: its own tab shows it (landOn). */
  land(place: PlaceId): void;
  /** The person went somewhere inside the selected tab's place: the tab follows (moveTab). */
  move(place: PlaceId, hash?: string, title?: string): void;
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
    for (const k of keys) { const t = findTab(state, k); if (t !== undefined && t.pinned !== true && t.isNew !== true) { closed.push(t); if (closed.length > 10) closed.shift(); } }
  };

  const set = (given: TabsState): void => {
    // closing the last tab leaves the Space's start place open, never an empty stage
    let next = given.tabs.length === 0 ? openTab(EMPTY_TABS, placeTab(options.start)) : given;
    // the tab the person is on is the one used last: stamp it, so "the most recent" has a meaning
    if (next.active !== state.active || state.tabs.length === 0) next = { tabs: next.tabs.map((t) => (t.key === next.active ? { ...t, at: Date.now() } : t)), active: next.active };
    if (next === state) return;
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
      return () => { listeners.delete(listener); };
    },
    openPlace(place, hash, title, background = false) {
      if (hidden.includes(place)) return;
      set(openTab(state, placeTab(place, hash, title), background));
    },
    move(place, hash, title) {
      if (hidden.includes(place)) return;
      set(moveTab(state, place, hash, title));
    },
    land(place) {
      if (hidden.includes(place)) return;
      set(landOn(state, place));
    },
    newTab(from) {
      // a blank chat is already open: New chat goes to it, and no tab is added
      const blank = blankChat(state);
      if (blank !== undefined) { set(selectTab(state, blank.key)); return blank; }
      const tab = newTabEntry(from, state);
      set(openTab(state, tab));
      return tab;
    },
    select(key) { set(selectTab(state, key)); },
    close(key) { remember([key]); set(closeTab(state, key)); },
    closeMany(keys) { remember(keys); set(closeTabs(state, keys)); },
    pin(key, on) { set(pinTab(state, key, on)); },
    closeRight(key) { const keys = keysToTheRight(state, key); remember(keys); set(closeTabs(state, keys)); },
    reopen() {
      const tab = closed.pop();
      if (tab === undefined || hidden.includes(tab.place)) return;
      set(openTab(state, tab));
    },
    canReopen: () => closed.length > 0,
    reorder(keys) { set(reorderTabs(state, keys)); },
    retitle(key, title, empty) {
      if (findTab(state, key) === undefined) return;
      set({ tabs: state.tabs.map((t) => (t.key === key ? (({ empty: _e, ...rest }) => ({ ...rest, title, ...(empty === true ? { empty: true as const } : {}) }))(t) : t)), active: state.active });
    },
  };
}
