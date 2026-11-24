// The shell hub (spec 2.1 Switching Space, ARCH 7.0, b15): one SpaceSession per Space (replica, connection, tabs, Kit, skin), starred Spaces pre-opened.
// Switching swaps the open session: the skin is on the root before the call returns, the skeleton is the first frame, every place unmounts and its
// subscriptions close, and nothing keyed by another Space is accepted afterwards. The previous replica stays open read-only so an Interrupt from that Space
// can still reach you. Budget: space_switch 500 ms with the skeleton.
import type { ThemeController } from "../../../../../ui/src/theme/index.ts";
import { NO_SCREEN_PLACES, PLACE_TITLE, kitById, livePlace, railFor } from "../rail/kits.ts";
import type { KitDef, PlaceId, RailGroups } from "../rail/kits.ts";
import { activeEntry, backTarget, createTabsController, forwardTarget, screenTitle, tabKey } from "../tabs/store.ts";
import type { TabEntry, TabsController, TabsStorage } from "../tabs/store.ts";
import { openPlan } from "../tabs/open-rule.ts";
import type { OpenHow } from "../tabs/open-rule.ts";
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
  def: SpaceDef;
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

/** A place that just joined the rail (Inbox, when the first mailbox, calendar or number arrives): it comes in with the rail's calm reveal, once, with an optional one-time tip. */
export interface FreshPlace {
  place: PlaceId;
  tip: string | null;
}

export interface HubState {
  openId: string;
  phase: Phase;
  /** Counts switches. Places are keyed by it, so a place never survives a switch. */
  epoch: number;
  place: PlaceId;
  hash: string;
  /** Counts the addresses that came to the app from outside (a link, a pasted address, a goto), never the page's own reports: a page that was drawn for the same address twice can tell a link back to it from nothing. */
  links: number;
  /** Counts the addresses a place wrote itself (its report of what the person opened inside it), never a link or a press elsewhere: the shell uses it to tell a place's own address from one that came to it. */
  reports: number;
  /** The address of the last report a place wrote itself (what it showed when it reported): a changed address equal to it, arriving with a report and no link, is that report coming back. */
  ownHash: string;
  /** Counts the moves that are not a place's own report (a tab switch, Back, a link, closing a tab): a report issued by a page drawn before the latest one is stale. */
  shifts: number;
  away: boolean;
  online: boolean;
  waiting: number;
  status: StatusLine | null;
  /** A Space that did not open: the shell shows one line and Try again. */
  error: string | null;
  /** A place that just joined the open Space's rail; null once it has settled. */
  fresh: FreshPlace | null;
  /** Where Back and Forward would go from the tab on screen: the name of that place, or null when there is nowhere. */
  nav?: NavState;
}

export interface NavState {
  back: string | null;
  forward: string | null;
}

export interface HubOptions {
  spaces: readonly SpaceDef[];
  openId: string;
  personId: string;
  /** A person can have a distinct identity on each server. */
  personIds?: Readonly<Record<string, string>>;
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
  /** `fresh`: a new tab beside the selected one that is shown (Cmd-press, middle-press, Open in new tab); `background`: the same, left behind. */
  go(place: PlaceId, hash?: string, background?: boolean, link?: boolean, fresh?: boolean): void;
  /** Back in the tab on screen: a step it took, the tab it was opened from, or one level up. False when there is nowhere to go. */
  /** `up: false` leaves out the one-level-up step: what the browser's own Back may take (it leaves Vyre when there is nothing else). */
  back(o?: { up?: boolean }): boolean;
  /** Forward in the tab on screen, after Back. */
  forward(): boolean;
  /** The person went somewhere inside the place on screen: the selected tab follows, no tab opens (tabs/store.ts moveTab). */
  move(place: PlaceId, hash?: string, own?: boolean): void;
  /** The "+" tab on screen becomes this place and item (a chat started from its search): the same tab, named, no second tab (tabs/store.ts fillTab). */
  fill(place: PlaceId, hash: string, title?: string, from?: string): void;
  /** The view is about to change: whoever draws the frame keeps a still copy until the next one is ready. */
  hold(): void;
  /**
   * `to` names the tab being shown, when the change is a switch to a tab: the frame can then show that tab's own last view at once. When it does, it answers true and
   * runs `then` itself once that view has been painted: the change of place waits one frame, so the press is answered before the place is made again.
   */
  /**
   * `soon`: the change is one the shell draws after the next painted frame (a place from the rail, Back, a closed tab: Shell.tsx), so the still copy can be taken after that frame too, and the
   * frame that answers the press has nothing to copy or repaint.
   */
  setHolder(fn: ((to?: string, then?: () => void, soon?: boolean, place?: string) => boolean | void) | null): void;
  /** Name a tab for the item it holds (its title arrives after the tab opens). */
  retitle(key: string, title: string, empty?: boolean): void;
  /** The count on a place of the open Space, from what it counts live (the rail reads it, and only redraws when it changes). */
  count(place: PlaceId, n: number): void;
  /** The quiet dot on a place of the open Space: something new, no number (Chats: an unread chat, channel or thread). Only a change redraws. */
  dot(place: PlaceId, on: boolean): void;
  /** Whether this person has something flowing into Inbox in the open Space (rail/inbox-sources.ts). Only a change redraws. With `reveal`, Inbox joining the rail comes in as a fresh place. */
  setInbox(has: boolean, reveal?: { tip: string | null }): void;
  /** The open Space's image changed (Console saved a new one, or removed it): the tile and the switcher follow at once. Only a change redraws. */
  setFace(face: { image: string; imageKey: string } | null): void;
  /** The fresh place has been seen (its tip dismissed or timed out). */
  settle(): void;
  /** Show a tab the strip selected. */
  showTab(tab: TabEntry): void;
  newTab(): TabEntry;
  /** The tab closed last comes back and is shown (Cmd-Shift-T). */
  reopenTab(): void;
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

/** How long a tab just filled with a chat keeps the name it was given against a read that calls the chat blank. */
const FILLED_MS = 10_000;

export function createShellHub(options: HubOptions): ShellHub {
  const filled = new Map<string, number>();
  const now = options.now ?? defaultNow;
  const later = options.later ?? defaultLater;
  const skeletonMs = options.skeletonMs ?? SKELETON_MIN_MS;
  const defs = options.spaces;
  const sessions = new Map<string, SpaceSession>();

  for (const def of defs) {
    const tabs = createTabsController({
      deviceId: options.deviceId,
      personId: options.personIds?.[def.spaceId] ?? options.personId,
      spaceId: def.spaceId,
      storage: options.storage,
      start: kitById(def.kit).start,
      hidden: def.kind === "personal" ? (["apps", "console", ...NO_SCREEN_PLACES] as const) : NO_SCREEN_PLACES,
    });
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
  if (!sessions.has(options.openId))
    throw new Error(`the shell cannot open ${options.openId}: it is not one of this person's Spaces`);

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
  let fresh: FreshPlace | null = null;
  let t0 = now();
  let switchedFrom = openId;
  let drawn = true;
  let refusals = 0;
  const probeLog: SwitchProbe[] = [];
  const listeners = new Set<() => void>();
  let holder: ((to?: string, then?: () => void, soon?: boolean, place?: string) => boolean | void) | null = null;
  /** counts presses on a tab (showTab): a press that waited a frame gives way to any press after it */
  let shows = 0;
  const waiters: (() => void)[] = [];
  const subs = new Map<string, Map<string, readonly string[]>>();
  let snap: HubState;

  const open = (): SpaceSession => sessions.get(openId) as SpaceSession;

  let links = 0;
  let reports = 0;
  let ownHash = "";
  let shifts = 0;
  function build(): HubState {
    const s = open();
    const tabs = s.tabs.state();
    const back = backTarget(tabs);
    const fwd = forwardTarget(tabs);
    const nav: NavState = { back: back === null ? null : back.title, forward: fwd === null ? null : fwd.title };
    return {
      openId,
      phase,
      epoch,
      place: s.place,
      hash: s.hash,
      links,
      reports,
      ownHash,
      shifts,
      away,
      online,
      waiting,
      status,
      error,
      fresh,
      nav,
    };
  }
  snap = build();

  /** A move the person or the app made that is not a place's own report (a tab switch, Back, Forward, closing a tab, opening anything): the last own report no longer names the address on screen, so nothing can be taken for its echo. */
  const notOwn = (): void => {
    ownHash = "\u0000";
    shifts += 1;
  };
  /** Back or Forward in the tab on screen; the page shows what the tab shows afterwards. */
  function step(run: (tabs: TabsController) => boolean): boolean {
    notOwn();
    const s = open();
    holder?.(undefined, undefined, true);
    if (!run(s.tabs)) return false;
    const now = s.tabs.state();
    const t = now.tabs.find((x) => x.key === now.active);
    if (t !== undefined) {
      s.place = t.place;
      s.hash = t.hash ?? "";
    }
    emit();
    return true;
  }

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
    const minimum = new Promise<void>((resolve) => {
      later(resolve, skeletonMs);
    });
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
      return () => {
        listeners.delete(listener);
      };
    },
    spaces: () => defs,
    session: (spaceId) => (spaceId === undefined ? open() : (sessions.get(spaceId) ?? open())),
    rail() {
      const s = open();
      return railFor({
        kit: s.kit,
        console: s.def.console,
        ...(s.def.hidden ? { hidden: s.def.hidden } : {}),
        ...(s.def.inbox === undefined ? {} : { inbox: s.def.inbox }),
        counts: s.def.counts,
        dots: s.def.dots,
        active: s.place,
      });
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
      fresh = null;
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
      return phase === "ready"
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiters.push(resolve);
          });
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
    count(place, n) {
      const s = open();
      if ((s.def.counts[place] ?? 0) === n) return;
      s.def = { ...s.def, counts: { ...s.def.counts, [place]: n } };
      emit();
    },
    dot(place, on) {
      const s = open();
      if ((s.def.dots[place] === true) === on) return;
      s.def = { ...s.def, dots: { ...s.def.dots, [place]: on } };
      emit();
    },
    setInbox(has, reveal) {
      const s = open();
      if (s.def.inbox === has) return;
      const joins = has && s.def.inbox === false;
      s.def = { ...s.def, inbox: has };
      if (joins && reveal !== undefined) fresh = { place: "inbox", tip: reveal.tip };
      else if (!has && fresh?.place === "inbox") fresh = null;
      emit();
    },
    setFace(face) {
      const s = open();
      if ((s.def.imageKey ?? null) === (face?.imageKey ?? null) && (s.def.image ?? null) === (face?.image ?? null))
        return;
      const { image: _image, imageKey: _key, ...rest } = s.def;
      s.def = face ? { ...rest, image: face.image, imageKey: face.imageKey } : rest;
      emit();
    },
    settle() {
      if (fresh === null) return;
      fresh = null;
      emit();
    },
    retitle(key, title, empty) {
      const s = open();
      const was = s.tabs.state().tabs.find((t) => t.key === key);
      // a tab just named for the chat it became (fill) is not called blank by a read that has not caught up with the new chat: that read says "New chat" for a moment and the tab flashed it (and "+" then went to it as a blank chat)
      if (empty === true && was !== undefined && Date.now() - (filled.get(key) ?? 0) < FILLED_MS) return;
      if (was?.title === title && (was.empty === true) === (empty === true)) return;
      s.tabs.retitle(key, title, empty);
      emit();
    },
    go(requested, hash, background = false, link = false, fresh = false) {
      notOwn();
      if (link) links += 1;
      // a place with no screen (the old Join) opens Chats instead of an empty page; Home's links land in Chats with their hash
      const gone = NO_SCREEN_PLACES.includes(requested);
      const place = gone ? "chats" : livePlace(requested);
      if (gone) hash = undefined;
      const s = open();
      // ONE rule decides (tabs/open-rule.ts): a press on a row opens it in the tab on screen (a step, Back returns); Cmd-press, middle-press and "Open in new tab" open a tab beside it
      // ("fresh"; `background` keeps the person where they are); a link, and an item of another place, open or select a tab.
      const how: OpenHow = background ? "behind" : fresh ? "tab" : "here";
      const plan = openPlan(s.tabs.state(), { place, hash, how, link });
      if (plan.do === "step" && hash !== undefined) {
        hub.move(place, hash);
        return;
      }
      if (!background && (place !== s.place || (hash ?? "") !== s.hash)) holder?.(undefined, undefined, true);
      // an address with no item (hash "") asks for the place's landing: its own tab shows it. A place asked for with no hash at all (the rail) goes to the tab the place has.
      if (plan.do === "land") s.tabs.land(place);
      else s.tabs.openPlace(place, hash, screenTitle(hash), plan.do === "open" && plan.background, link);
      if (!background) {
        // the page shows what the selected tab shows, so a tab never names one thing over another
        const now = s.tabs.state();
        const t = now.tabs.find((x) => x.key === now.active);
        const same = t !== undefined && t.isNew !== true && t.place === place;
        s.place = same ? t.place : place;
        s.hash = same ? (t.hash ?? "") : (hash ?? "");
      }
      emit();
    },
    back(o) {
      return backTarget(open().tabs.state(), o) !== null && step((tabs) => tabs.back(o));
    },
    forward() {
      return forwardTarget(open().tabs.state()) !== null && step((tabs) => tabs.forward());
    },
    move(place, hash, own = false) {
      if (own) {
        reports += 1;
        ownHash = hash ?? "";
      } else notOwn();
      const s = open();
      if (place !== s.place || (hash ?? "") !== s.hash) holder?.();
      s.tabs.move(livePlace(place), hash, screenTitle(hash));
      const now = s.tabs.state();
      const t = now.tabs.find((x) => x.key === now.active);
      if (t !== undefined) {
        s.place = t.place;
        s.hash = t.hash ?? "";
      }
      emit();
    },
    fill(place, hash, title, from) {
      notOwn();
      const s = open();
      holder?.(undefined, undefined, true);
      s.tabs.fill(livePlace(place), hash, title, from);
      const now = s.tabs.state();
      const t = now.tabs.find((x) => x.key === now.active);
      filled.set(tabKey(livePlace(place), hash), Date.now());
      if (t !== undefined) {
        s.place = t.place;
        s.hash = t.hash ?? "";
      }
      emit();
    },
    hold() {
      holder?.();
    },
    setHolder(fn) {
      holder = fn;
    },
    showTab(tab) {
      notOwn();
      const s = open();
      const mine = ++shows;
      const was = { active: s.tabs.state().active, place: s.place, hash: s.hash };
      // Run a frame later when the frame is showing the tab's own last view: by then the person may have gone on (another tab, another place, another Space) or the
      // tab may be closed, and then this press is no longer what they asked for. What is shown is what the tab holds at that moment.
      const later = (): void => {
        if (open() !== s || mine !== shows) return;
        const now = s.tabs.state();
        const t = now.tabs.find((x) => x.key === tab.key);
        if (t === undefined || now.active !== was.active || s.place !== was.place || s.hash !== was.hash) return;
        s.tabs.select(t.key);
        s.place = t.place;
        s.hash = t.hash ?? "";
        emit();
      };
      if (holder?.(tab.key, later, undefined, tab.place) === true) return;
      s.tabs.select(tab.key);
      s.place = tab.place;
      s.hash = tab.hash ?? "";
      emit();
    },
    closeTab(key) {
      notOwn();
      const s = open();
      holder?.(undefined, undefined, true);
      s.tabs.close(key ?? s.tabs.state().active);
      const now = s.tabs.state();
      const t = now.tabs.find((x) => x.key === now.active);
      if (t !== undefined) {
        s.place = t.place;
        s.hash = t.hash ?? "";
      }
      emit();
    },
    reopenTab() {
      notOwn();
      const s = open();
      if (!s.tabs.canReopen()) return;
      holder?.(undefined, undefined, true);
      s.tabs.reopen();
      const now = s.tabs.state();
      const t = now.tabs.find((x) => x.key === now.active);
      if (t !== undefined) {
        s.place = t.place;
        s.hash = t.hash ?? "";
      }
      emit();
    },
    newTab() {
      notOwn();
      const s = open();
      const tab = s.tabs.newTab(s.place);
      s.place = tab.place;
      s.hash = tab.hash ?? "";
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
      return () => {
        subs.get(space)?.delete(id);
      };
    },
    subscriptions(spaceId) {
      const out: (readonly string[])[] = [];
      for (const [space, keys] of subs)
        if (spaceId === undefined || space === spaceId) for (const k of keys.values()) out.push(k);
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
      cancelStatus = later(
        () => {
          if (statusId !== mine) return;
          status = null;
          statusUndo = null;
          emit();
        },
        undo === undefined ? 2400 : 5000,
      );
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

/**
 * Is a place's report stale? The place was drawn when the hub had counted `drawn` shifts; if the hub has counted more since (a tab switch, Back or a link moved the address under it), the
 * place is reporting what it showed before that move, and writing it would put the old address back over the switch (and set the own-report claim to it).
 */
export const staleReport = (drawn: number, now: number): boolean => now !== drawn;
