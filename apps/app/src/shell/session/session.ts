// A signed-in Space, open (ARCH 7.0): who you are, the Space's name and kind, the capability caller on its gateway, the screen hooks every place reads, the live link that keeps them fresh, and the
// ShellRuntime the places are handed. `openRealSession` is the only place the shell touches the network; the places only see the runtime. A call that succeeds re-reads what is on screen,
// the live link re-reads it when the Space changes under you, and while the link is down the session re-reads every few seconds so a place never goes stale silently.
import type { LiveQuery, QueryState } from "../../../../../client/src/index.ts";
import type { ScreenIndexEntry } from "../../../../../generated/screens.ts";
import type { CapMap } from "../../../../../generated/types.ts";
import type { Principal } from "../../places/home/sections-a/data.tsx";
import { formatHash, placeForSubject } from "../hash/hash.ts";
import type { ShellRuntime, ShellTarget } from "../providers/runtime.tsx";
import type { PlaceId } from "../rail/kits.ts";
import type { SpaceDef } from "../spaces/model.ts";
import { CapError, createCapCaller } from "./caps.ts";
import type { CapCall, RouteRow } from "./caps.ts";
import { createDeferred } from "../../../../../client/src/runtime/deferred.ts";
import { createLiveLink } from "./live.ts";
import type { LiveLink, LiveStatus } from "./live.ts";
import { BUILD_REGISTRY_HASH } from "../../../../../client/src/connection/registry-hash.ts";
import type { Dial, Scheduler } from "../../../../../client/src/connection/index.ts";
import { PLACE_QUERIES, WARM_ORDER } from "./prefetch.ts";
import { createRemoteScreenHooks } from "./remote-hooks.ts";
import type { RemoteHooks } from "./remote-hooks.ts";

export interface OpenSessionOptions {
  /** The Space's address, e.g. https://northwind.vyre.run. */
  baseUrl: string;
  token: string;
  /** Where a click goes: the shell maps a screen or subject to a place and shows it. */
  navigate?(place: PlaceId, hash: string): void;
  /** A click that opens something of the shell itself (the search, a new tab, the Space switcher): screens whose place is `shell`. */
  shell?(screen: string, args: Record<string, unknown>): void;
  /** The session ended on the server (401): the shell goes back to sign-in. */
  onSignedOut?(): void;
  fetch?: typeof fetch;
  routes?: () => Promise<readonly RouteRow[]>;
  screens?: () => Promise<ReadonlyMap<string, ScreenIndexEntry>>;
  /** The live socket's dialer and clock, injectable for tests. */
  dial?: Dial;
  scheduler?: Scheduler;
  /** The sync epoch this device agreed with the server last time (stored with the session); absent on a fresh sign-in. */
  syncEpoch?: number;
  /** The device adopted the server's sync epoch: keep it for the next hello. */
  onSyncEpoch?(epoch: number): void;
  /** The contract hash this build was made with (sent in hello); defaults to the one baked in at export. */
  registryHash?: string;
  /** Re-read period while the live link is down. */
  pollMs?: number;
  /** When the idle warm-up starts after the Space opens (ms); default 1500. */
  warmAfterMs?: number;
  now?: () => number;
  openUrl?(url: string): void;
}

export interface RealSession {
  readonly def: SpaceDef;
  readonly baseUrl: string;
  readonly me: Principal;
  readonly hooks: RemoteHooks;
  readonly runtime: ShellRuntime;
  call: CapCall;
  /** Hears the server's purge signals (an epoch); returns how to stop. */
  onPurge(listener: (epoch: number) => void): () => void;
  liveStatus(): LiveStatus;
  /** Warm a place's first queries (pointer-enter or focus on its rail item or tab). */
  prefetchPlace(place: PlaceId): void;
  /** Re-read everything on screen now. */
  refresh(): void;
  close(why?: string): void;
}

const loadScreens = (): Promise<ReadonlyMap<string, ScreenIndexEntry>> => import("../../../../../generated/screens.ts").then((m) => m.screensById);

type Out<C extends keyof CapMap> = CapMap[C]["out"];

/** The rail place a screen belongs to, by the screen's place field. */
const RAIL_PLACES: readonly PlaceId[] = ["home", "chats", "inbox", "records", "files", "apps", "automations", "vault", "settings", "console"];
const railPlace = (p: string): PlaceId | null => (RAIL_PLACES as readonly string[]).includes(p) ? (p as PlaceId) : null;

/** The hash a place opens its item from (see ../hash/hash.ts). */
export const targetHash = (t: ShellTarget): string => formatHash(t);

/** A live query computed from other live queries; its snapshot is the same object until one of its sources changes. */
export function derived<T>(sources: readonly LiveQuery<unknown>[], make: (snaps: readonly QueryState<unknown>[]) => QueryState<T>): LiveQuery<T> {
  let last: readonly QueryState<unknown>[] = [];
  let out: QueryState<T> = { status: "loading" };
  return {
    subscribe(l) {
      const offs = sources.map((s) => s.subscribe(l));
      return () => { for (const off of offs) off(); };
    },
    getSnapshot() {
      const now = sources.map((s) => s.getSnapshot());
      if (last.length === now.length && now.every((s, i) => s === last[i])) return out;
      last = now;
      out = make(now);
      return out;
    },
  };
}

const AI_CONNECTORS = /anthropic|claude|openai|codex|grok|opencode|gemini/i;
const CALENDAR_CONNECTORS = /calendar|gcal|outlook|caldav/i;

export async function openRealSession(o: OpenSessionOptions): Promise<RealSession> {
  let token: string | null = o.token;
  let reachable = true;
  let closed = false;
  const listeners = new Set<() => void>();
  const tell = (): void => { for (const l of [...listeners]) l(); };

  const raw = createCapCaller({
    baseUrl: o.baseUrl,
    token: () => token,
    ...(o.fetch ? { fetch: o.fetch } : {}),
    ...(o.routes ? { routes: o.routes } : {}),
    onUnauthenticated: () => { if (token !== null) { token = null; o.onSignedOut?.(); } },
  });
  // Network failures (no CapError) mark the Space unreachable; any answer, even a refusal, proves it is there.
  const reach = async (cap: string, input?: unknown, opts?: { idempotencyKey?: string; signal?: AbortSignal }): Promise<unknown> => {
    // Signed out (a 401 ended the session): nothing more goes to the Space, so a refused session is one signal and not a flood of refused calls.
    if (token === null) throw new CapError({ code: "auth.unauthenticated", message: "You are signed out.", traceId: "", status: 401 });
    try {
      const r = await raw(cap, input, opts);
      if (!reachable) { reachable = true; tell(); }
      return r;
    } catch (e) {
      const up = e instanceof CapError;
      if (up !== reachable) { reachable = up; tell(); }
      throw e;
    }
  };

  const who = (await reach("identity.whoami", {})) as Out<"identity.whoami">;
  const [spaceOut, switcher, screens] = await Promise.all([
    reach("spaces.get", {}) as Promise<Out<"spaces.get">>,
    reach("spaces.switcher", {}).catch(() => null) as Promise<Out<"spaces.switcher"> | null>,
    (o.screens ?? loadScreens)(),
  ]);
  const space = spaceOut.space;
  const deferred = createDeferred(who.deferred, who.deferredModules);
  const me: Principal = { id: who.principal.id, name: who.name, kind: "person" };

  // A 401 means signed out (once, to sign-in): it is never a failure state a screen reacts to by asking again.
  const hooks = createRemoteScreenHooks({ screens, read: (cap, input) => reach(cap, input), ignoreError: (e) => e instanceof CapError && e.status === 401 });
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const refresh = (): void => {
    if (closed || refreshTimer !== null) return;
    refreshTimer = setTimeout(() => { refreshTimer = null; if (!closed) hooks.invalidate(); }, 120);
  };
  const call: CapCall = async (cap, input, opts) => {
    const r = await reach(cap, input, opts);
    refresh();
    return r;
  };

  const purgeListeners = new Set<(epoch: number) => void>();
  let live: LiveStatus = "offline";
  let everLive = false;
  const link: LiveLink = createLiveLink({
    baseUrl: o.baseUrl,
    token: () => token,
    deviceId: who.deviceId ?? "web",
    ...(o.syncEpoch !== undefined ? { epoch: o.syncEpoch } : {}),
    ...(o.onSyncEpoch ? { onEpoch: o.onSyncEpoch } : {}),
    registryHash: o.registryHash ?? BUILD_REGISTRY_HASH,
    onChange: refresh,
    onStatus: (s) => { live = s; if (s === "live") everLive = true; tell(); },
    onPurge: (epoch) => { for (const l of [...purgeListeners]) l(epoch); },
    ...(o.dial ? { dial: o.dial } : {}),
    ...(o.scheduler ? { scheduler: o.scheduler } : {}),
  });
  link.start();
  const poll = setInterval(() => { if (!closed && live !== "live" && hooks.watching() > 0) hooks.invalidate(); }, o.pollMs ?? 5000);

  const prefetchPlace = (place: PlaceId): void => {
    if (closed) return;
    for (const w of PLACE_QUERIES[place] ?? []) {
      try { hooks.prefetch(w.screen, w.query, w.state ?? {}); } catch { /* a screen the registry lacks is not worth failing a hover for */ }
    }
  };
  // Idle warm-up: once the Space is open, read each place's first list one after another so the first visit paints from the session's cache.
  const warmTimers: ReturnType<typeof setTimeout>[] = [];
  WARM_ORDER.forEach((place, i) => { warmTimers.push(setTimeout(() => prefetchPlace(place), o.warmAfterMs === undefined ? 1500 + i * 250 : o.warmAfterMs + i * 250)); });

  const connections = hooks.capQuery<Out<"connections.list">>("connections.list", {});
  const principalsList = hooks.capQuery<Out<"access.principals.list">>("access.principals.list", {});
  const groupsList = hooks.capQuery<Out<"access.groups.list">>("access.groups.list", {});
  const agentsList = hooks.capQuery<Out<"agents.list">>("agents.list", {});
  // Keep the shell's own lists warm for the life of the session.
  const keep = [connections, principalsList, groupsList, agentsList].map((q) => q.subscribe(() => undefined));

  const principals = derived<Principal[]>([principalsList, groupsList], ([p, g]) => {
    const list = new Map<string, Principal>([[me.id, me]]);
    if (p?.status === "ready") {
      for (const x of (p.data as Out<"access.principals.list">).principals) {
        list.set(x.id, { id: x.id, name: x.name, kind: x.kind === "person" ? "person" : "agent" });
      }
    }
    if (g?.status === "ready") {
      for (const x of (g.data as Out<"access.groups.list">).groups) list.set(x.id, { id: x.id, name: x.name, kind: "group" });
    }
    return { status: "ready", data: [...list.values()] };
  });

  const connected = (re: RegExp): boolean => {
    const s = connections.getSnapshot();
    return s.status === "ready" && s.data.connections.some((c) => c.state === "active" && re.test(c.connector));
  };
  const assistant = (): { id: string; name: string } => {
    const s = agentsList.getSnapshot();
    const a = s.status === "ready" ? (s.data.agents.find((x) => x.role === "assistant") ?? s.data.agents.find((x) => /assistant/i.test(x.name))) : undefined;
    return a ? { id: a.agentId, name: a.name } : { id: "assistant", name: "Assistant" };
  };

  const open = (t: ShellTarget): void => {
    const where = t.screen ? (screens.get(t.screen)?.place ?? "") : (t.subject ? (placeForSubject(t.subject.type) ?? "") : "");
    if (where === "shell") { if (t.screen) o.shell?.(t.screen, t.args ?? {}); return; }
    const place = railPlace(where);
    if (place && o.navigate) o.navigate(place, targetHash(t));
  };

  const def: SpaceDef = {
    spaceId: space.id,
    name: space.name,
    kind: space.kind,
    address: o.baseUrl.replace(/^https?:\/\//, ""),
    role: switcher?.role ?? "Member",
    tint: ["#6E5CF0", "#9B6BE8"],
    kit: space.kind === "personal" ? "personal" : "northwind",
    skinDefault: "system",
    starred: true,
    needsYou: (switcher?.needsYou ?? 0) > 0,
    console: who.roles.some((r) => r === "owner" || r === "admin"),
    terminal: who.roles.some((r) => r === "owner" || r === "developer"),
    counts: switcher && switcher.unread > 0 ? { chats: switcher.unread } : {},
    dots: {},
  };

  const runtime: ShellRuntime = {
    screens: hooks,
    call: (cap, input) => call(cap, input),
    connection: {
      get: () => (reachable && !(everLive && live === "offline") ? "online" : "offline"),
      subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    },
    principals,
    recordTitle: () => undefined,
    me,
    clock: () => ({ now: (o.now ?? Date.now)(), offsetMin: -new Date().getTimezoneOffset() }),
    space: { id: space.id, kind: space.kind, name: space.name },
    get assistant() { return assistant(); },
    get aiConnected() { return connected(AI_CONNECTORS); },
    get calendarConnected() { return connected(CALENDAR_CONNECTORS); },
    deferredModules: deferred.deferredModules,
    isDeferred: deferred.isDeferred,
    open,
    openUrl: (url) => {
      if (o.openUrl) o.openUrl(url);
      else (globalThis as { open?: (u: string, t: string, f: string) => unknown }).open?.(url, "_blank", "noopener");
    },
  };

  return {
    def, baseUrl: o.baseUrl, me, hooks, runtime, call,
    onPurge: (l) => { purgeListeners.add(l); return () => { purgeListeners.delete(l); }; },
    liveStatus: () => live,
    prefetchPlace,
    refresh,
    close(why = "unspecified") {
      if (closed) return;
      closed = true;
      console.info(`vyre session closed: ${why}`);
      clearInterval(poll);
      for (const t of warmTimers) clearTimeout(t);
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      link.stop();
      for (const off of keep) off();
      hooks.close();
      listeners.clear();
      purgeListeners.clear();
      token = null;
    },
  };
}
