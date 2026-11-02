// Main-view tabs (spec 3.0, 4.7, ARCH 7.0): per device and per Space, restored when you return to a Space, never synced.
// The state is a plain value (immutable), the controller keeps it for one Space on one device and writes it to this device's storage under a key that names
// the device, the person and the Space. Nothing here calls the server: a tab list that left the device would make Starred and tabs the same thing, and they are not.
import type { PlaceId } from "../rail/kits.ts";
import { PLACE_TITLE, livePlace } from "../rail/kits.ts";
import { parseHash } from "../hash/hash.ts";

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
export function tabKey(place: PlaceId, hash?: string): string {
  if (hash === undefined || hash === "") return place;
  if (!hash.includes("=")) return `${place}:${hash}`;
  const t = parseHash(hash);
  if (t.subject !== undefined) return `${place}:subject=${t.subject.type}:${t.subject.id}`;
  if (t.screen === "tasks.page" && t.args["taskId"]) return `${place}:subject=task:${t.args["taskId"]}`;
  if (t.screen !== undefined && OWN_TAB[t.screen] !== undefined) return `${place}:${t.screen}`;
  const type = t.args["type"];
  if (type !== undefined && type !== "") return `${place}:type=${type}`;
  return place;
}

/** Screens inside Chats that are a tab of their own, with the tab's name. */
const OWN_TAB: Readonly<Record<string, string>> = { "tasks.my-work": "Tasks", "chats.threads": "Threads" };

/** The name a tab starts with when its screen has one of its own; the place's name otherwise. */
export function screenTitle(hash: string | undefined): string | undefined {
  if (hash === undefined || !hash.includes("=")) return undefined;
  const s = parseHash(hash).screen;
  return s === undefined ? undefined : OWN_TAB[s];
}

export function findTab(state: TabsState, key: string): TabEntry | undefined {
  return state.tabs.find((t) => t.key === key);
}

export function activeEntry(state: TabsState): TabEntry | undefined {
  return findTab(state, state.active);
}

/** Opens a tab or selects the one already open with that key. `background` opens it behind the current tab (Cmd-click). */
export function openTab(state: TabsState, tab: TabEntry, background = false): TabsState {
  const at = state.tabs.find((t) => t.key === tab.key);
  if (at !== undefined) {
    if (background) return state;
    // the tab follows where its place went (a new screen inside it), so coming back lands there
    const moved = tab.hash !== undefined && tab.hash !== at.hash && !at.isNew;
    return { tabs: moved ? state.tabs.map((t) => (t === at ? { ...t, hash: tab.hash as string } : t)) : state.tabs, active: tab.key };
  }
  const tabs = [...state.tabs, tab];
  return { tabs, active: background && state.active !== "" ? state.active : tab.key };
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
    const { key, title, place, hash, isNew, pinned } = row;
    if (typeof key !== "string" || typeof title !== "string" || typeof place !== "string" || !KNOWN_PLACES.has(place)) return null;
    const hashText = typeof hash === "string" && hash !== "" ? hash : undefined;
    // a tab saved on Home reopens in Chats, where Home went
    const where = livePlace(place as PlaceId);
    // tab lists saved before a place was unique can hold the same place or item twice: one tab per identity, the first kept
    const id = isNew === true ? key : tabKey(where, hashText);
    renamed.set(key, id);
    if (seen.has(id)) {
      if (pinned === true) { const kept = tabs.find((t) => t.key === id); if (kept !== undefined) kept.pinned = true; }
      continue;
    }
    seen.add(id);
    tabs.push({
      key: id,
      title: place === "home" && where !== place ? (hashText === undefined ? PLACE_TITLE.chats : title) : title,
      place: where,
      ...(typeof hash === "string" && hash !== "" ? { hash } : {}),
      ...(isNew === true ? { isNew: true } : {}),
      ...(pinned === true ? { pinned: true } : {}),
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
  newTab(from: PlaceId): TabEntry;
  select(key: string): void;
  close(key: string): void;
  closeMany(keys: readonly string[]): void;
  reorder(keys: readonly string[]): void;
  /** Rename a tab (a chat title arrives after the tab opens). */
  retitle(key: string, title: string): void;
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
    const kept = saved === null ? null : withoutPlaces(saved, hidden);
    return kept !== null && kept.tabs.length > 0 ? kept : openTab(EMPTY_TABS, placeTab(options.start));
  })();
  const listeners = new Set<() => void>();

  const set = (given: TabsState): void => {
    // closing the last tab leaves the Space's start place open, never an empty stage
    const next = given.tabs.length === 0 ? openTab(EMPTY_TABS, placeTab(options.start)) : given;
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
    newTab(from) {
      const tab = newTabEntry(from, state);
      set(openTab(state, tab));
      return tab;
    },
    select(key) { set(selectTab(state, key)); },
    close(key) { set(closeTab(state, key)); },
    closeMany(keys) { set(closeTabs(state, keys)); },
    reorder(keys) { set(reorderTabs(state, keys)); },
    retitle(key, title) {
      if (findTab(state, key) === undefined) return;
      set({ tabs: state.tabs.map((t) => (t.key === key ? { ...t, title } : t)), active: state.active });
    },
  };
}
