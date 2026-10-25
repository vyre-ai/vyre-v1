// Main-view tabs (spec 3.0, 4.7, ARCH 7.0): per device and per Space, restored when you return to a Space, never synced.
// The state is a plain value (immutable), the controller keeps it for one Space on one device and writes it to this device's storage under a key that names
// the device, the person and the Space. Nothing here calls the server: a tab list that left the device would make Starred and tabs the same thing, and they are not.
import type { PlaceId } from "../rail/kits.ts";
import { PLACE_TITLE } from "../rail/kits.ts";

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

export function tabKey(place: PlaceId, hash?: string): string {
  return hash === undefined || hash === "" ? place : `${place}:${hash}`;
}

export function findTab(state: TabsState, key: string): TabEntry | undefined {
  return state.tabs.find((t) => t.key === key);
}

export function activeEntry(state: TabsState): TabEntry | undefined {
  return findTab(state, state.active);
}

/** Opens a tab or selects the one already open with that key. `background` opens it behind the current tab (Cmd-click). */
export function openTab(state: TabsState, tab: TabEntry, background = false): TabsState {
  if (findTab(state, tab.key) !== undefined) return background ? state : { tabs: state.tabs, active: tab.key };
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
  for (const row of data["tabs"] as unknown[]) {
    if (!isRecord(row)) return null;
    const { key, title, place, hash, isNew, pinned } = row;
    if (typeof key !== "string" || typeof title !== "string" || typeof place !== "string" || !KNOWN_PLACES.has(place)) return null;
    if (seen.has(key)) continue;
    seen.add(key);
    tabs.push({
      key,
      title,
      place: place as PlaceId,
      ...(typeof hash === "string" && hash !== "" ? { hash } : {}),
      ...(isNew === true ? { isNew: true } : {}),
      ...(pinned === true ? { pinned: true } : {}),
    });
  }
  const active = data["active"];
  return { tabs, active: tabs.some((t) => t.key === active) ? active : (tabs[0]?.key ?? "") };
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
}

export function createTabsController(options: TabsControllerOptions): TabsController {
  const storeKey = tabsStorageKey(options.deviceId, options.personId, options.spaceId);
  let state: TabsState = (() => {
    let raw: string | null = null;
    try {
      raw = options.storage === null ? null : options.storage.getItem(storeKey);
    } catch {
      raw = null;
    }
    return readTabs(raw) ?? openTab(EMPTY_TABS, placeTab(options.start));
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
    openPlace(place, hash, title, background = false) { set(openTab(state, placeTab(place, hash, title), background)); },
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
