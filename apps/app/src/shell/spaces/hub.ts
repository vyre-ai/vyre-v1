// The shell hub (spec 2.1 Switching Space, ARCH 7.0, b15): one SpaceSession per Space (replica, connection, tabs, Kit, skin), starred Spaces pre-opened.
// Switching swaps the open session: the skin is on the root before the call returns, the skeleton is the first frame, every place unmounts and its
// subscriptions close, and nothing keyed by another Space is accepted afterwards. The previous replica stays open read-only so an Interrupt from that Space
// can still reach you. Budget: space_switch 500 ms with the skeleton.
import type { ThemeController } from "../../../../../ui/src/theme/index.ts";
import { PLACE_TITLE, kitById, railFor } from "../rail/kits.ts";
import type { KitDef, PlaceId, RailGroups } from "../rail/kits.ts";
import { activeEntry, createTabsController } from "../tabs/store.ts";
import type { TabEntry, TabsController, TabsStorage } from "../tabs/store.ts";
import type { SpaceDef } from "./model.ts";

/** The part of the theme controller the shell uses. */
export type ShellTheme = Pick<ThemeController, "current" | "switchSpace" | "setSkin" | "subscribe">;

export const SPACE_SWITCH_BUDGET_MS = 500;
/** A skeleton never flashes for less than this, so a fast switch still reads as a switch. */
export const SKELETON_MIN_MS = 120;

export type Phase = "skeleton" | "ready";
export type ReplicaMode = "closed" | "open" | "read-only";

export interface ReplicaSlot {
  readonly spaceId: string;
  mode: ReplicaMode;
  /** How many times this replica was brought up; a pre-opened Space that you switch to again stays at 1. */
  opens: number;
}

export interface SpaceSession {
  readonly def: SpaceDef;
  readonly kit: KitDef;
  readonly tabs: TabsController;
  readonly replica: ReplicaSlot;
  connection: "connected" | "offline";
  place: PlaceId;
  hash: string;
  skin: string;
}

export interface StatusLine {
  id: number;
  text: string;
  undo: boolean;
}

export interface HubState {
  openId: string;
  phase: Phase;
  /** Counts switches. Places are keyed by it, so a place never survives a switch. */
  epoch: number;
  place: PlaceId;
  hash: string;
  away: boolean;
  online: boolean;
  waiting: number;
  status: StatusLine | null;
  /** A Space that did not open: the shell shows one line and Try again. */
  error: string | null;
}

export interface HubOptions {
  spaces: readonly SpaceDef[];
  openId: string;
  personId: string;
  deviceId: string;
  /** This device's storage for tabs; null keeps them in memory. */
  storage: TabsStorage | null;
  theme?: ShellTheme;
  /** Brings a replica up (decrypts the local store). May be async; the skeleton waits for it. */
  openReplica?: (spaceId: string) => void | Promise<void>;
  now?: () => number;
  /** Timers, injectable so tests do not wait. Returns a cancel. */
  later?: (fn: () => void, ms: number) => () => void;
  skeletonMs?: number;
}

export interface SwitchProbe {
  from: string;
  to: string;
  /** From the call to the first frame of the new Space's place. */
  ms: number;
}

export interface ShellHub {
  state(): HubState;
  subscribe(listener: () => void): () => void;
  spaces(): readonly SpaceDef[];
  session(spaceId?: string): SpaceSession;
  rail(): RailGroups;
  /** Open another Space. Returns false when it is already open or unknown. */
  switchTo(spaceId: string): boolean;
  /** Resolves when the skeleton is gone and the place may draw. */
  whenReady(): Promise<void>;
  /** The open Space's place draws for the first time after a switch: records the switch time. */
  placeDrawn(epoch: number): void;
  retry(): void;
  /** Navigate: open a place (or an item in it) as a tab and show it. */
  go(place: PlaceId, hash?: string, background?: boolean): void;
  /** Show a tab the strip selected. */
  showTab(tab: TabEntry): void;
  newTab(): TabEntry;
  /** Close a tab (the selected one when no key) and show the tab that is selected afterwards. */
  closeTab(key?: string): void;
  /** Every query key carries the open Space's id first. */
  queryKey(...parts: string[]): readonly string[];
  /** Register a live subscription. A key for any Space but the open one is refused (returns null) and counted. */
  watch(key: readonly string[]): (() => void) | null;
  subscriptions(spaceId?: string): readonly (readonly string[])[];
  refused(): number;
  setAway(on: boolean): void;
  setOnline(online: boolean, waiting: number): void;
  flash(text: string, undo?: () => void): void;
  undoStatus(): void;
  probes(): readonly SwitchProbe[];
}

function defaultNow(): number {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p !== undefined ? p.now() : Date.now();
}

function defaultLater(fn: () => void, ms: number): () => void {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
}

export function createShellHub(options: HubOptions): ShellHub {
  const now = options.now ?? defaultNow;
  const later = options.later ?? defaultLater;
  const skeletonMs = options.skeletonMs ?? SKELETON_MIN_MS;
  const defs = options.spaces;
  const sessions = new Map<string, SpaceSession>();

  for (const def of defs) {
    const tabs = createTabsController({ deviceId: options.deviceId, personId: options.personId, spaceId: def.spaceId, storage: options.storage, start: kitById(def.kit).start });
    const first = activeEntry(tabs.state());
    sessions.set(def.spaceId, {
      def,
      kit: kitById(def.kit),
      tabs,
      replica: { spaceId: def.spaceId, mode: "closed", opens: 0 },
      connection: "connected",
      place: first?.place ?? kitById(def.kit).start,
      hash: first?.hash ?? "",
      skin: def.skinDefault,
    });
  }
  if (!sessions.has(options.openId)) throw new Error(`the shell cannot open ${options.openId}: it is not one of this person's Spaces`);

  // the open Space and every starred Space come up now, so switching to a starred Space needs no wait
  for (const s of sessions.values()) {
    if (s.def.spaceId === options.openId || s.def.starred) {
      s.replica.mode = s.def.spaceId === options.openId ? "open" : "read-only";
      s.replica.opens = 1;
    }
  }

  let openId = options.openId;
  let epoch = 0;
  let phase: Phase = "ready";
  let away = false;
  let online = true;
  let waiting = 0;
  let status: StatusLine | null = null;
  let statusUndo: (() => void) | null = null;
  let statusId = 0;
  let cancelStatus: (() => void) | null = null;
  let error: string | null = null;
  let t0 = now();
  let switchedFrom = openId;
  let drawn = true;
  let refusals = 0;
  const probeLog: SwitchProbe[] = [];
  const listeners = new Set<() => void>();
  const waiters: (() => void)[] = [];
  const subs = new Map<string, Map<string, readonly string[]>>();
  let snap: HubState;

  const open = (): SpaceSession => sessions.get(openId) as SpaceSession;

  function build(): HubState {
    const s = open();
    return { openId, phase, epoch, place: s.place, hash: s.hash, away, online, waiting, status, error };
  }
  snap = build();

  function emit(): void {
    snap = build();
    for (const l of [...listeners]) l();
  }

  function release(): void {
    for (const w of waiters.splice(0)) w();
  }

  function closeSubscriptions(spaceId: string): void {
    subs.delete(spaceId);
  }

  function bringUp(session: SpaceSession): Promise<void>[] {
    const wait: Promise<void>[] = [];
    if (session.replica.mode === "closed") {
      session.replica.mode = "open";
      session.replica.opens += 1;
      if (options.openReplica !== undefined) {
        const r = options.openReplica(session.def.spaceId);
        if (r !== undefined) wait.push(r);
      }
    } else {
      session.replica.mode = "open";
    }
    return wait;
  }

  function begin(): void {
    const target = open();
    const mine = epoch;
    error = null;
    phase = "skeleton";
    const wait = bringUp(target);
    const minimum = new Promise<void>((resolve) => { later(resolve, skeletonMs); });
    Promise.all([minimum, ...wait]).then(
      () => {
        if (epoch !== mine) return;
        phase = "ready";
        emit();
        release();
      },
      (cause: unknown) => {
        if (epoch !== mine) return;
        error = cause instanceof Error && cause.message !== "" ? cause.message : `${target.def.name} did not open`;
        phase = "ready";
        emit();
        release();
      },
    );
  }

  const hub: ShellHub = {
    state: () => snap,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    spaces: () => defs,
    session: (spaceId) => (spaceId === undefined ? open() : (sessions.get(spaceId) ?? open())),
    rail() {
      const s = open();
      return railFor({ kit: s.kit, console: s.def.console, counts: s.def.counts, dots: s.def.dots, active: s.place });
    },
    switchTo(spaceId) {
      const next = sessions.get(spaceId);
      if (next === undefined || spaceId === openId) return false;
      t0 = now();
      const prev = open();
      prev.replica.mode = prev.replica.mode === "open" ? "read-only" : prev.replica.mode;
      closeSubscriptions(prev.def.spaceId);
      switchedFrom = prev.def.spaceId;
      openId = spaceId;
      epoch += 1;
      drawn = false;
      // the skin is on the root before this call returns: the first frame is already the new Space's skin
      if (options.theme !== undefined) {
        options.theme.switchSpace(spaceId);
        next.skin = options.theme.current().skin;
      }
      begin();
      emit();
      return true;
    },
    whenReady() {
      return phase === "ready" ? Promise.resolve() : new Promise<void>((resolve) => { waiters.push(resolve); });
    },
    placeDrawn(forEpoch) {
      if (forEpoch !== epoch || drawn || phase !== "ready") return;
      drawn = true;
      probeLog.push({ from: switchedFrom, to: openId, ms: now() - t0 });
    },
    retry() {
      if (error === null) return;
      const target = open();
      target.replica.mode = "closed";
      epoch += 1;
      begin();
      emit();
    },
    go(place, hash, background = false) {
      const s = open();
      s.tabs.openPlace(place, hash, undefined, background);
      if (!background) {
        s.place = place;
        s.hash = hash ?? "";
      }
      emit();
    },
    showTab(tab) {
      const s = open();
      s.place = tab.place;
      s.hash = tab.hash ?? "";
      emit();
    },
    closeTab(key) {
      const s = open();
      s.tabs.close(key ?? s.tabs.state().active);
      const now = s.tabs.state();
      const t = now.tabs.find((x) => x.key === now.active);
      if (t !== undefined) {
        s.place = t.place;
        s.hash = t.hash ?? "";
      }
      emit();
    },
    newTab() {
      const s = open();
      const tab = s.tabs.newTab(s.place);
      s.place = tab.place;
      s.hash = "";
      emit();
      return tab;
    },
    queryKey: (...parts) => [openId, ...parts],
    watch(key) {
      const space = key[0];
      if (space === undefined || space !== openId) {
        refusals += 1;
        return null;
      }
      const id = JSON.stringify(key);
      let mine = subs.get(space);
      if (mine === undefined) {
        mine = new Map();
        subs.set(space, mine);
      }
      mine.set(id, key);
      return () => { subs.get(space)?.delete(id); };
    },
    subscriptions(spaceId) {
      const out: (readonly string[])[] = [];
      for (const [space, keys] of subs) if (spaceId === undefined || space === spaceId) for (const k of keys.values()) out.push(k);
      return out;
    },
    refused: () => refusals,
    setAway(on) {
      away = on;
      emit();
    },
    setOnline(isOnline, count) {
      online = isOnline;
      waiting = Math.max(0, Math.floor(count));
      open().connection = isOnline ? "connected" : "offline";
      emit();
    },
    flash(text, undo) {
      statusId += 1;
      status = { id: statusId, text, undo: undo !== undefined };
      statusUndo = undo ?? null;
      cancelStatus?.();
      const mine = statusId;
      cancelStatus = later(() => {
        if (statusId !== mine) return;
        status = null;
        statusUndo = null;
        emit();
      }, undo === undefined ? 2400 : 5000);
      emit();
    },
    undoStatus() {
      const fn = statusUndo;
      status = null;
      statusUndo = null;
      cancelStatus?.();
      emit();
      if (fn !== null) fn();
    },
    probes: () => probeLog,
  };
  return hub;
}

/** "Vyre · Northwind · Chats", with "· Away" when you set yourself away. The title carries the Space so a window never lies about where you are. */
export function titleText(spaceName: string, place: PlaceId, away: boolean): string {
  return `Vyre · ${spaceName} · ${PLACE_TITLE[place]}${away ? " · Away" : ""}`;
}
