import { setLinkOrigin } from "../../share/rows.ts";
import { judge, needsJudging, noAccessLine } from "../reach/target.ts";
import { MAKES_A_THREAD, noteMade, threadOfStart } from "./just-made.ts";
import type { Judge } from "../reach/target.ts";
import { adminPages } from "../providers/settings-admin.ts";
import { createLinkPolicy } from "../reach/policy.ts";
import { watchWorking } from "../tabs/working.ts";
import { isAssistantRow } from "../../../../../lib/agent-kind.ts";
import { createRecordsPreview } from "../../../../../client/src/gateway/records-preview.ts";
// A signed-in Space, open (ARCH 7.0): who you are, the Space's name and kind, the capability caller on its gateway, the screen hooks every place reads, the live link that keeps them fresh, and the
// ShellRuntime the places are handed. `openRealSession` is the only place the shell touches the network; the places only see the runtime. A call that may change something re-reads what is on screen,
// the live link re-reads it when the Space changes under you, and while the link is down the session re-reads every few seconds so a place never goes stale silently.
import type { LiveQuery, QueryState } from "../../../../../client/src/index.ts";
import type { ScreenIndexEntry } from "../../../../../generated/screens.ts";
import type { CapMap } from "../../../../../generated/types.ts";
import type { Principal } from "./runtime-data.ts";
import { formatHash, placeForSubject } from "../hash/hash.ts";
import type { ShellRuntime, ShellTarget } from "../providers/runtime.tsx";
import type { PlaceId } from "../rail/kits.ts";
import type { SpaceDef } from "../spaces/model.ts";
import { CapError, createCapCaller } from "./caps.ts";
import type { CapCall, RouteRow } from "./caps.ts";
import { withVaultGate } from "./vault-gate.ts";
import { attemptKey } from "../providers/files-review.ts";
import { loadCryptoKeys } from "../../../../../client/src/crypto/load.ts";
import { handOnLive, keepKey, rehandKey, watchKey } from "../../../../../client/src/gateway/key-keeper.ts";
import {
  holdKeyOnOwnNode,
  keyDoor,
  serverKeyState,
  setServerKeyKept,
} from "../../../../../client/src/gateway/local-key.ts";
import { shellDesktopLinkBridge } from "../../../../../client/src/connection/desktop-link.ts";
import { aiHomeOf } from "../../ai-signin/own-ai.ts";
import { spaceLabel } from "../spaces/space-label.ts";
import { createDeferred } from "../../../../../client/src/runtime/deferred.ts";
import { createLiveLink } from "./live.ts";
import { realScheduler } from "../../../../../client/src/connection/scheduler.ts";

import { createTurnStreams } from "./turn-streams.ts";
import { createTyping } from "./typing.ts";
import { readStoredSessions } from "./stored.ts";
import type { LiveLink, LiveStatus } from "./live.ts";
import { BUILD_REGISTRY_HASH } from "../../../../../client/src/connection/registry-hash.ts";
import { assistantName } from "../../../../../ui/src/Avatar/assistant.ts";
import type { Dial, Scheduler } from "../../../../../client/src/connection/index.ts";
import { PLACE_QUERIES, WARM_ORDER } from "./prefetch.ts";
import { directoryOf, standInsOf } from "./private-agents.ts";
import { setAgentFaces, setAgentStatuses, setStandIns } from "../../../../../ui/src/Avatar/assistant.ts";
import { setFaceImageLoader } from "../../../../../ui/src/Avatar/faceimages.ts";
import { createRemoteScreenHooks, stableJson } from "./remote-hooks.ts";
import { mayKeep } from "./kept.ts";
import type { KeptSession } from "./kept.ts";
const SIDEBAR_QUIET_MS = 1_000;
import type { RemoteHooks } from "./remote-hooks.ts";
import { onRetryLoads } from "../../../../../ui/src/States/retry.ts";
import { speed } from "../../speed/recorder.ts";
import { GATE, hiddenPlaces } from "./gates.ts";
/** How long the live link may be down before the app says it is reconnecting. */
const LOST_AFTER_MS = 1_500;

export interface OpenSessionOptions {
  /** The sign-in name this device typed, when it did. */
  username?: string;
  /** The Space's address, e.g. https://northwind.vyre.run. */
  baseUrl: string;
  token: string;
  /** Device-local cards only; never another Space token or key. */
  spaceCards?: readonly SpaceDef[];
  /** Where a click goes: the shell maps a screen or subject to a place and shows it. */
  navigate?(place: PlaceId, hash: string, background?: boolean, into?: string): void;
  /** A click reach turned away: one quiet line. */
  notice?(text: string): void;
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
  /**
   * What this device kept of the Space (session/kept.ts). Every read that was kept is drawn at once and read again; every answer is handed back to be kept. With `bootFromKept` the session also
   * opens from the kept sign-in facts without waiting for the Space, and confirms them behind the first screen (`confirmed`).
   */
  kept?: KeptSession;
  bootFromKept?: boolean;
  /** Start loading a place's code (the shell knows how): a row that leads there is being pointed at or pressed. */
  warmPlace?(place: PlaceId): void;
  /** The facts the session opened from are out of date (the person's roles, the Space's name, kind, Kit or image changed since they were kept): the shell opens the session again from the new ones. */
  onBootChanged?(): void;
  /** How long to wait before asking the Space again for the facts a kept session opened from, after it could not be reached (ms, by try). */
  confirmRetryMs?(tries: number): number;
}

/** What the Space says this session is, once it has answered: the shell checks it against the saved sign-in (stored.ts). */
export interface Confirmed {
  personId: string;
  spaceId: string;
  marker: string;
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
  /** Warm what a thing's page reads first, and nothing else: the pointer is resting on its row, or (`pressed`) the row is being pressed. Never the Vault. */
  prefetchTarget(target: ShellTarget, pressed?: boolean): void;
  /** The place on screen changed: the reads watched from now on are that place's (what pointing at it in the rail brings up to date later). */
  shownPlace(place: PlaceId | null): void;
  /** The Space's own word on who this session is. A session opened the usual way has it already; one opened from what this device kept gets it behind the first screen. Rejects when the Space refuses. */
  readonly confirmed: Promise<Confirmed>;
  /** Re-read everything on screen now. */
  refresh(): void;
  close(why?: string): void;
}

/** Last seen is sent at most this often while the person is doing something in the app. */
export const TOUCH_EVERY_MS = 60_000;
/** How often a hidden window re-reads what is on screen. */
export const HIDDEN_REFRESH_MS = 30_000;
/** Is the window hidden (minimized, another desktop, a background tab)? Without a document (tests, native) it counts as showing. */
const hidden = (): boolean =>
  (globalThis as { document?: { visibilityState?: string } }).document?.visibilityState === "hidden";

const loadScreens = (): Promise<ReadonlyMap<string, ScreenIndexEntry>> =>
  import("../../../../../generated/screens.ts").then((m) => m.screensById);

type Out<C extends keyof CapMap> = CapMap[C]["out"];

/** Does this person hold one of these built-in roles? identity.whoami's schema says `rol_owner`, a claimed owner really gets `Owner`, so every form counts. */
export function holdsRole(roles: readonly string[], ...names: readonly string[]): boolean {
  return roles.some((r) => names.includes(r.toLowerCase().replace(/^rol_/, "")));
}

/** The rail place a screen belongs to, by the screen's place field. The task screens still say "home": the hub lands them in Chats. */
/** The built-in roles that hold console.access (manifests/permissions.ts), and the ones that do not. Anything else is a role this Space made, and only the server knows what it holds. */
const CONSOLE_ROLES = ["owner", "admin", "developer"] as const;
const PLAIN_ROLES = ["member", "guest"] as const;
export const roleOpensConsole = (roles: readonly string[]): boolean => holdsRole(roles, ...CONSOLE_ROLES);
export const roleAsksServer = (roles: readonly string[]): boolean =>
  !roleOpensConsole(roles) && roles.some((r) => !holdsRole([r], ...PLAIN_ROLES));
/** The Console's rail button (owner ruling, 3 Nov 2026: the Console is in the app's rail for people with console.access, on desktop widths only). A built-in role answers at once; a role this
 *  Space made asks the server (`ask`, console.nav); a plain Member or Guest never sees it and is never asked for it. */
export async function railConsole(roles: readonly string[], ask: () => Promise<boolean>): Promise<boolean> {
  if (roleOpensConsole(roles)) return true;
  return roleAsksServer(roles) ? ask().catch(() => false) : false;
}
/** Only the built-in Member or Guest roles, in a Team Space: no console.access, connectors.manage or schema.manage, so the UI asks for none of them (ShellRuntime.plainRole). */
export const plainRoleOnly = (roles: readonly string[], kind: string): boolean =>
  kind === "team" && roles.length > 0 && roles.every((r) => holdsRole([r], ...PLAIN_ROLES));

const RAIL_PLACES: readonly PlaceId[] = [
  "home",
  "chats",
  "inbox",
  "records",
  "files",
  "apps",
  "automations",
  "vault",
  "settings",
  "console",
];
const railPlace = (p: string): PlaceId | null =>
  (RAIL_PLACES as readonly string[]).includes(p) ? (p as PlaceId) : null;

/** The hash a place opens its item from (see ../hash/hash.ts). */
export const targetHash = (t: ShellTarget): string => formatHash(t);

/** A live query computed from other live queries; its snapshot is the same object until one of its sources changes. */
export function derived<T>(
  sources: readonly LiveQuery<unknown>[],
  make: (snaps: readonly QueryState<unknown>[]) => QueryState<T>,
): LiveQuery<T> {
  let last: readonly QueryState<unknown>[] = [];
  let out: QueryState<T> = { status: "loading" };
  return {
    subscribe(l) {
      const offs = sources.map((s) => s.subscribe(l));
      return () => {
        for (const off of offs) off();
      };
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

/** The answers a session opens from, each as its capability gave it. */
interface Boot {
  who: Out<"identity.whoami">;
  space: Out<"spaces.get">["space"];
  switcher: Out<"spaces.switcher"> | null;
  kit: Out<"settings.kit.get"> | null;
  face: { logoFileId?: string; image?: string } | null;
  console: boolean;
}

/** What this device kept, when it has the shape a session can open from; anything else is as if nothing was kept. */
function bootOf(
  kept: { who: unknown; space: unknown; switcher: unknown; kit: unknown; face: unknown; console: boolean } | null,
): Boot | null {
  if (!kept) return null;
  const who = kept.who as Partial<Out<"identity.whoami">> | null;
  const space = kept.space as Partial<Out<"spaces.get">["space"]> | null;
  if (
    !who ||
    typeof who !== "object" ||
    typeof who.principal?.id !== "string" ||
    !Array.isArray(who.roles) ||
    !space ||
    typeof space !== "object" ||
    typeof space.id !== "string" ||
    typeof space.fingerprint !== "string" ||
    (space.kind !== "team" && space.kind !== "personal") ||
    typeof space.defaults !== "object" ||
    space.defaults === null
  )
    return null;
  return kept as Boot;
}

/** What a session is built from, without what changes by itself (a count, a time): when this differs between what was kept and what the Space says now, the session is opened again. */
function bootShape(b: Boot): string {
  return stableJson({
    person: b.who.principal.id,
    name: b.who.name,
    roles: [...b.who.roles].sort(),
    device: b.who.deviceId ?? null,
    deferred: b.who.deferred ?? null,
    deferredModules: (b.who as { deferredModules?: readonly string[] }).deferredModules ?? null,
    space: [
      b.space.id,
      b.space.name,
      b.space.kind,
      b.space.fingerprint,
      b.space.logoFileId ?? null,
      b.space.defaults.skin ?? null,
    ],
    role: b.switcher?.role ?? null,
    kit: b.kit?.kit.effective ?? null,
    face: b.face?.logoFileId ?? null,
    console: b.console,
  });
}

export async function openRealSession(o: OpenSessionOptions): Promise<RealSession> {
  let token: string | null = o.token;
  let reachable = true;
  let closed = false;
  const listeners = new Set<() => void>();
  const tell = (): void => {
    for (const l of [...listeners]) l();
  };

  setLinkOrigin(o.baseUrl); // links to things in this Space are made from its own address (the desktop app runs in tauri://localhost)
  const raw = createCapCaller({
    baseUrl: o.baseUrl,
    token: () => token,
    ...(o.fetch ? { fetch: o.fetch } : {}),
    ...(o.routes ? { routes: o.routes } : {}),
    onUnauthenticated: () => {
      if (token !== null) {
        token = null;
        o.onSignedOut?.();
      }
    },
  });
  // Network failures (no CapError) mark the Space unreachable; any answer, even a refusal, proves it is there.
  const reach = async (
    cap: string,
    input?: unknown,
    opts?: { idempotencyKey?: string; signal?: AbortSignal },
  ): Promise<unknown> => {
    // Signed out (a 401 ended the session): nothing more goes to the Space, so a refused session is one signal and not a flood of refused calls.
    if (token === null)
      throw new CapError({ code: "auth.unauthenticated", message: "You are signed out.", traceId: "", status: 401 });
    try {
      const r = await raw(cap, input, opts);
      if (!reachable) {
        reachable = true;
        tell();
      }
      return r;
    } catch (e) {
      const up = e instanceof CapError;
      if (up !== reachable) {
        reachable = up;
        tell();
      }
      throw e;
    }
  };

  // The facts a session opens from. Kept from the last launch (r41), the session is there at once and the Space is asked behind the first screen; otherwise the Space is asked first, as on a sign-in.
  const keptBoot = o.bootFromKept === true ? bootOf(o.kept?.boot() ?? null) : null;
  const who = keptBoot ? keptBoot.who : ((await reach("identity.whoami", {})) as Out<"identity.whoami">);
  const [spaceOut, switcher, screens, kitChoice] = keptBoot
    ? [{ space: keptBoot.space }, keptBoot.switcher, await (o.screens ?? loadScreens)(), keptBoot.kit]
    : await Promise.all([
        reach("spaces.get", {}) as Promise<Out<"spaces.get">>,
        reach("spaces.switcher", {}).catch(() => null) as Promise<Out<"spaces.switcher"> | null>,
        (o.screens ?? loadScreens)(),
        reach("settings.kit.get", {}).catch(() => null) as Promise<Out<"settings.kit.get"> | null>,
      ]);
  const space = spaceOut.space;
  const deferred = createDeferred(
    who.deferred,
    (who as typeof who & { deferredModules?: readonly string[] }).deferredModules,
  );
  const me: Principal = {
    id: who.principal.id,
    name: who.name,
    kind: "person",
    ...(o.username ? { username: o.username } : {}),
  };
  // a place whose first permission the role lacks is off the rail and never warmed (a guest: no Mine automations, nothing kept in the Vault)
  // the person's permissions, kept live: a change to their role or a permission exception reaches an open session (the set is the runtime's own object, so every gate reads the new answer)
  const livePerms: Set<string> | null = who.permissions ? new Set(who.permissions) : null;
  let permsAt = 0,
    permsTimer: ReturnType<typeof setTimeout> | null = null;
  const rereadPerms = (): void => {
    if (!livePerms || closed || permsTimer !== null) return;
    permsTimer = setTimeout(
      () => {
        permsTimer = null;
        permsAt = Date.now();
        void reach("identity.whoami", {}).then(
          (out) => {
            const next = (out as { permissions?: string[] }).permissions;
            if (!next || closed) return;
            if (next.length === livePerms.size && next.every((k) => livePerms.has(k))) return;
            livePerms.clear();
            for (const k of next) livePerms.add(k);
            hooks.invalidate();
          },
          () => undefined,
        );
      },
      Math.max(400, 3000 - (Date.now() - permsAt)),
    );
  };
  const offRail: readonly string[] = who.permissions && space.kind === "team" ? hiddenPlaces(who.permissions) : [];

  // A 401 means signed out (once, to sign-in): it is never a failure state a screen reacts to by asking again.
  const hooks = createRemoteScreenHooks({
    screens,
    read: (cap, input) => reach(cap, input),
    ignoreError: (e) => e instanceof CapError && e.status === 401,
    // a busy Space asks for the sidebar again and again; once a second is as fresh as a person can tell (their own actions are read at once)
    quietMs: { "chats.sidebar": SIDEBAR_QUIET_MS },
    // what this device kept is drawn at once and read again; an answer the Space refuses (access taken away, the thing gone) is dropped, one it could not be asked about stays
    ...(o.kept ? { kept: o.kept } : {}),
    refused: (e) =>
      e instanceof CapError && e.status >= 400 && e.status < 500 && ![401, 408, 425, 429].includes(e.status),
  });
  const stopPerms = livePerms ? hooks.onInvalidate(rereadPerms) : (): void => undefined;
  // While the window is hidden a change re-reads the screen at most every HIDDEN_REFRESH_MS; showing it again re-reads at once whatever is waiting.
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const reread = (urgent = false): void => {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = null;
    if (!closed) hooks.invalidate(urgent ? { now: true } : undefined);
  };
  const refresh = (): void => {
    if (closed || refreshTimer !== null) return;
    refreshTimer = setTimeout(reread, hidden() ? HIDDEN_REFRESH_MS : 120);
  };
  const page = (
    globalThis as {
      document?: {
        addEventListener?(t: string, l: () => void): void;
        removeEventListener?(t: string, l: () => void): void;
      };
    }
  ).document;
  // the window showing again is activity too: it moves last seen (touchShown, set once the session knows its device)
  let touchShown = (): void => undefined;
  const shown = (): void => {
    // a window being hidden may be closed next: what changed is written to this device's kept copy now
    if (hidden()) {
      o.kept?.flush();
      return;
    }
    if (refreshTimer !== null) reread(true);
    touchShown();
  };
  page?.addEventListener?.("visibilitychange", shown);
  // Retry on a failed or stalled load (ui/States Loads and Quiet) re-reads what is on screen
  const offRetry = onRetryLoads(() => {
    if (!closed) hooks.invalidate();
  });
  // A read changes nothing, so it does not re-read the screen. Re-reading after every read made a loop: a screen that reads on render re-rendered on the re-read and read again, every two
  // seconds, whole screens at a time (about 15 reads a second from an idle Mac). Until the route table has loaded, every call re-reads, as before.
  let reads: ReadonlySet<string> | null = null;
  void import("../../../../../generated/routes.ts").then(
    (m) => {
      reads = new Set(m.routes.filter((r) => r.effects === "read").map((r) => r.cap));
    },
    () => undefined,
  );
  const unlockVault = async (password: string): Promise<void> => {
    const got = (await reach("identity.keys_get", {})) as {
      keys: { personKeyByPassword: string; personKeyByRecovery?: string; publicKey: string; privateKeyWrapped: string };
    };
    const { openBundle, heldKeyOf, wipeOpened } = await loadCryptoKeys();
    let opened: Awaited<ReturnType<typeof openBundle>>;
    try {
      opened = await openBundle(password, { ...got.keys, personKeyByRecovery: got.keys.personKeyByRecovery ?? "" });
    } catch {
      throw new Error("That password does not open your vault.");
    }
    try {
      if (!(await holdKeyOnOwnNode(o.baseUrl, token ?? "", heldKeyOf(opened))))
        throw new Error("Your Vault could not be opened. Sign in again to open it.");
      await keepKey(heldKeyOf(opened), token ?? "");
    } finally {
      wipeOpened(opened);
    }
  };

  const once: CapCall = async (cap, input, opts) => {
    const r = await reach(cap, input, opts);
    // a read a page makes itself (not through the screen hooks) is kept for the next launch as well, when it is one of the reads that may be: the page starts from it with `recall`
    if (
      o.kept &&
      reads?.has(cap) &&
      mayKeep(cap) &&
      !closed &&
      (input === undefined || (typeof input === "object" && input !== null))
    )
      o.kept.wrote(cap, (input ?? {}) as Record<string, unknown>, r, stableJson(r).length);
    // an Automation made, copied or promoted is in the list at once (not after the quiet 120 ms): a person's own action is read at once
    if (!reads?.has(cap))
      /^automations\.(create|templates\.use|promote|make_personal_copy)$/.test(cap) ? reread(true) : refresh();
    return r;
  };
  // where the Space runs (ai-signin/own-ai.ts), for the words of a refusal
  const aiHome = aiHomeOf(o.baseUrl, shellDesktopLinkBridge() !== null);
  // A locked vault key is opened where the call met it, silently, with the key this app kept from its one password at sign-in (a Space that restarted or deployed behind the open app), and the call
  // goes again. No password is asked for on a Space server (owner ruling 3 Nov): a member signed in through Google, Microsoft or GitHub gets it back from the server's own wrap, and anyone else
  // whose app no longer has it (a reloaded tab) signs in again. Only the Space on this computer asks, as its lock screen always has.
  const door = keyDoor(o.baseUrl) !== null;
  const gated: CapCall = withVaultGate(once, aiHome === "here" || door ? unlockVault : undefined, () =>
    rehandKey(o.baseUrl, token ?? ""),
  );
  // one idempotency key per logical call: the gate's retry after the password, and any other send of the same call, carries the same opts and so the same key
  const call: CapCall = (cap, input, given) => {
    const sent = gated(cap, input, given?.idempotencyKey ? given : { ...given, idempotencyKey: attemptKey() });
    // a chat this person just started is not refused while its row is still landing (shell/session/just-made.ts)
    if (MAKES_A_THREAD.includes(cap))
      void Promise.resolve(sent).then(
        (out) => {
          const id = threadOfStart(out);
          if (id !== null) noteMade(id);
        },
        () => undefined,
      );
    return sent;
  };

  const purgeListeners = new Set<(epoch: number) => void>();
  let live: LiveStatus = "offline";
  let everLive = false;
  // The link was live and has not been for LOST_AFTER_MS: the title bar says the app is reconnecting. A blip shorter than that shows nothing, and neither does a first connect.
  let linkLost = false;
  let lostTimer: (() => void) | null = null;
  const clock = o.scheduler ?? realScheduler;
  const turns = createTurnStreams();
  let sendFrame: (f: unknown) => boolean = () => false;
  const typing = createTyping({ send: (f) => sendFrame(f), me: () => who.principal.id });
  const link: LiveLink = createLiveLink({
    baseUrl: o.baseUrl,
    token: () => token,
    deviceId: who.deviceId ?? "web",
    ...(o.syncEpoch !== undefined ? { epoch: o.syncEpoch } : {}),
    ...(o.onSyncEpoch ? { onEpoch: o.onSyncEpoch } : {}),
    registryHash: o.registryHash ?? BUILD_REGISTRY_HASH,
    onChange: refresh,
    onStatus: (s) => {
      // back after a drop (the server restarted or deployed): hand the kept key back through the key door before anything needs it, so the next turn runs on the person's own account
      if (handOnLive(live, s, door)) void rehandKey(o.baseUrl, token ?? "").catch(() => false);
      live = s;
      if (s === "live") everLive = true;
      else turns.reset();
      if (s === "live") {
        lostTimer?.();
        lostTimer = null;
        linkLost = false;
      } else if (everLive && !linkLost && lostTimer === null)
        lostTimer = clock.after(LOST_AFTER_MS, () => {
          lostTimer = null;
          if (!closed && live !== "live") {
            linkLost = true;
            tell();
          }
        });
      tell();
    },
    onTurn: (f) => turns.onFrame(f),
    onTyping: (f) => typing.onFrame(f),
    onPurge: (epoch) => {
      for (const l of [...purgeListeners]) l(epoch);
    },
    ...(o.dial ? { dial: o.dial } : {}),
    ...(o.scheduler ? { scheduler: o.scheduler } : {}),
  });
  sendFrame = (f) => link.send(f);
  link.start();
  // a Space server that lost the key under an open link (a restart the link did not notice) gets it back from this app within one beat
  const stopKeyWatch = watchKey(o.baseUrl, () => token);
  // this Space's own door for the timing samples the app measured in it (apps/app/src/speed): only this session, with this Space's token, ever sends them
  const detachSpeed = speed.attach({
    spaceId: space.id,
    ready: () => !closed && token !== null && reachable,
    upload: async (samples) => {
      await reach("logs.client_upload", { device: who.deviceId ?? "web", entries: [], samples });
    },
  });
  // Last seen follows what the person does here (devices.touch, at most once a minute): opening the Space, a press, a key, the window showing again. Never a timer, so an idle window
  // goes quiet and teammates see the dot clear. Coming back after a long absence answers `back`, and the re-read brings the While you were away row.
  let touchedAt = -Infinity;
  const touch = (): void => {
    if (closed || token === null) return;
    const t = (o.now ?? Date.now)();
    if (t - touchedAt < TOUCH_EVERY_MS) return;
    touchedAt = t;
    void reach(
      "devices.touch",
      typeof who.deviceId === "string" && who.deviceId.startsWith("dev_") ? { deviceId: who.deviceId } : {},
    ).then(
      (out) => {
        if ((out as { back?: boolean } | null)?.back === true && !closed) hooks.invalidate();
      },
      () => undefined,
    );
  };
  touchShown = touch;
  page?.addEventListener?.("pointerdown", touch);
  page?.addEventListener?.("keydown", touch);
  touch();
  // while the link is down: every pollMs, or every HIDDEN_REFRESH_MS while the window is hidden
  let polledAt = 0;
  const poll = setInterval(() => {
    if (closed || live === "live" || hooks.watching() === 0) return;
    const t = (o.now ?? Date.now)();
    if (hidden() && t - polledAt < HIDDEN_REFRESH_MS) return;
    polledAt = t;
    hooks.invalidate();
  }, o.pollMs ?? 5000);

  const prefetchPlace = (place: PlaceId): void => {
    if (closed) return;
    for (const w of PLACE_QUERIES[place] ?? []) {
      try {
        hooks.prefetch(w.screen, w.query, w.state ?? {});
      } catch {
        /* a screen the registry lacks is not worth failing a hover for */
      }
    }
    // and whatever the place was reading when it was last on screen in this session, brought up to date
    hooks.warmScope(place);
  };
  // Idle warm-up: once the Space is open, read each place's first list one after another so the first visit paints from the session's cache.
  const warmTimers: ReturnType<typeof setTimeout>[] = [];
  WARM_ORDER.filter((place) => !offRail.includes(place)).forEach((place, i) => {
    warmTimers.push(
      setTimeout(() => prefetchPlace(place), o.warmAfterMs === undefined ? 1500 + i * 250 : o.warmAfterMs + i * 250),
    );
  });

  // the pictures of uploaded agent faces are files in the agents' folders: read once as the person, kept for the session
  setFaceImageLoader(async (fileId) => {
    const out = (await call("files.read", { fileId, as: "base64" })) as { base64?: string; mime?: string };
    if (typeof out.base64 !== "string" || typeof out.mime !== "string") throw new Error("not a picture");
    return `data:${out.mime};base64,${out.base64}`;
  });

  const connections = hooks.capQuery<Out<"connections.list">>("connections.list", {});
  const principalsList = hooks.capQuery<Out<"access.principals.list">>("access.principals.list", {});
  const groupsList = hooks.capQuery<Out<"access.groups.list">>("access.groups.list", {});
  const agentsList = hooks.capQuery<Out<"agents.list">>("agents.list", {});
  const erasedList = hooks.capQuery<Out<"agents.erased">>("agents.erased", {});
  // Keep the shell's own lists warm for the life of the session.
  const keep = [connections, principalsList, groupsList, agentsList, erasedList].map((q) =>
    q.subscribe(() => undefined),
  );

  const principals = derived<Principal[]>([principalsList, groupsList, agentsList, erasedList], ([p, g, ag]) => {
    const own = assistant();
    const list = new Map<string, Principal>([[me.id, me]]);
    // the agents this person may use are what agents.list answers (the agents module's visibility rule); any other agent is someone else's private one, credited to its person ("Imran Ibarra (Agent)") and never offered
    const usable =
      ag?.status === "ready" ? new Set((ag.data as Out<"agents.list">).agents.map((a) => a.agentId)) : null;
    // what was picked on an agent's page shows on every face of that agent, in every place (not only Chats)
    if (ag?.status === "ready") {
      const rows = (ag.data as Out<"agents.list">).agents;
      setAgentFaces(rows.map((a) => ({ id: a.agentId, face: a.face })));
      // how each agent is doing shows on every one of its faces, in every place
      setAgentStatuses(rows.map((a) => ({ id: a.agentId, status: a.status })));
    }
    if (p?.status === "ready") {
      const dir = directoryOf((p.data as Out<"access.principals.list">).principals, own, me.id, usable);
      for (const x of dir) list.set(x.id, x);
      setStandIns(standInsOf(dir));
    }
    if (g?.status === "ready") {
      for (const x of (g.data as Out<"access.groups.list">).groups)
        list.set(x.id, { id: x.id, name: x.name, kind: "group" });
    }
    return { status: "ready", data: [...list.values()] };
  });

  const connected = (re: RegExp): boolean => {
    const s = connections.getSnapshot();
    return s.status === "ready" && s.data.connections.some((c) => c.state === "active" && re.test(c.connector));
  };
  const assistant = (): { id: string; name: string } => {
    const s = agentsList.getSnapshot();
    const a = s.status === "ready" ? s.data.agents.find(isAssistantRow) : undefined;
    return a ? { id: a.agentId, name: assistantName(a.name, who.name) } : { id: "assistant", name: "Assistant" };
  };

  // every click that opens something goes through this one door, and reach decides: the Console page or the item must be one this person can open (shell/reach/target.ts)
  const links = createLinkPolicy({ call: (cap, input) => reach(cap, input), ...(o.notice ? { flash: o.notice } : {}) });
  const judging: Judge = {
    links,
    viewer: () => ({ id: me.id, spaceId: space.id, ...(livePerms ? { perms: livePerms } : {}) }),
    call: (cap, input) => reach(cap, input),
    consolePages: () => consolePagesOnce(),
    memo: new Map(),
  };
  let consoleRead: Promise<ReadonlySet<string>> | null = null;
  const consolePagesOnce = (): Promise<ReadonlySet<string>> => {
    if (consoleRead === null) {
      consoleRead =
        space.kind === "personal" || (who.roles.length > 0 && plainRoleOnly(who.roles, space.kind))
          ? Promise.resolve(new Set<string>())
          : (reach("console.nav", {}) as Promise<Parameters<typeof adminPages>[0]>).then(
              (out) => adminPages(out),
              () => new Set<string>(),
            );
    }
    return consoleRead;
  };
  const open = (t: ShellTarget): void => {
    // a screen the registry lacks is one a place draws from its own hash (chats.ask, chats.notes, files.knowledge): the place its id starts with; an id of no place opens nothing
    const where = t.screen
      ? (screens.get(t.screen)?.place ?? railPlace(t.screen.split(".")[0] ?? "") ?? "")
      : t.subject
        ? (placeForSubject(t.subject.type) ?? "")
        : (t.place ?? "");
    if (where === "shell") {
      if (t.screen) o.shell?.(t.screen, t.args ?? {});
      return;
    }
    const place = railPlace(where);
    if (!place || !o.navigate) return;
    const go = (): void => {
      o.navigate?.(place, targetHash(t), t.background === true, t.into);
    };
    // a tab or view of what is already open is not a new door: no read, no refusal
    if (t.local === true || !needsJudging(t)) {
      go();
      return;
    }
    void judge(t, judging).then((r) => {
      if (r.to === "open") {
        go();
        return;
      }
      // the last resort: a link should have drawn plain before it was pressed. Under test it is a failure, so the suite counts zero of these.
      if (o.notice) o.notice(noAccessLine(t));
      else if (
        (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
          "NODE_TEST_CONTEXT"
        ] !== undefined
      )
        throw new Error("reach fallback fired: a link led somewhere the viewer cannot open");
    });
  };

  // a Space that never learnt its name answers its id: it is called by its address instead (spaces/space-label.ts)
  const shownName = spaceLabel(space.name, o.baseUrl);
  // the Space image for the tile and the switcher; a Space too old to have spaces.image shows its letter
  const face = keptBoot
    ? keptBoot.face
    : space.logoFileId
      ? await (reach("spaces.image", {}) as Promise<{ logoFileId?: string; image?: string }>).catch(() => null)
      : null;
  // whoever holds console.access gets the rail button: the same answer as opening the Console by its address
  const consoleOk = keptBoot
    ? keptBoot.console
    : await railConsole(who.roles, () =>
        reach("console.nav", {}).then(
          () => true,
          () => false,
        ),
      );
  const def: SpaceDef = {
    spaceId: space.id,
    name: shownName,
    kind: space.kind,
    address: o.baseUrl.replace(/^https?:\/\//, ""),
    role: switcher?.role ?? "Member",
    tint: ["#6E5CF0", "#9B6BE8"],
    ...(face?.image && face.logoFileId ? { image: face.image, imageKey: face.logoFileId } : {}),
    kit: space.kind === "personal" ? "personal" : (kitChoice?.kit.effective ?? "northwind"),
    skinDefault: typeof space.defaults.skin === "string" ? space.defaults.skin : "system",
    starred: true,
    needsYou: (switcher?.needsYou ?? 0) > 0,
    console: consoleOk,
    ...(offRail.length ? { hidden: offRail as PlaceId[] } : {}),
    // a Personal Space has one person and their own computer: the terminal is always theirs. A Team Space gives it to owners and developers
    terminal: space.kind === "personal" || holdsRole(who.roles, "owner", "developer"),
    // members.invite is the Owner's and Admins' (manifests/permissions.ts); a Personal Space has nobody to invite
    invite:
      space.kind === "team" &&
      (who.permissions ? who.permissions.includes(GATE.invite) : holdsRole(who.roles, "owner", "admin")),
    counts: {}, // the Chats badge is Needs you, live: ShellHost follows tasks.count_needs_you
    dots: {},
  };

  const runtime: ShellRuntime = {
    createRecordsPreview: (ticket) =>
      createRecordsPreview({
        ...ticket,
        baseUrl: o.baseUrl,
        ...(o.fetch ? { fetch: o.fetch } : {}),
        ...(o.routes ? { routes: o.routes } : {}),
        now: o.now ?? Date.now,
      }),
    screens: hooks,
    changes: { subscribe: (l) => hooks.onInvalidate(l) },
    turns,
    typing,
    call: (cap, input) => call(cap, input),
    callIn: async (spaceId, cap, input) => {
      // another Space this device is signed in to: its own address and its own token, never this Space's
      const other = readStoredSessions().find((x) => x.def.spaceId === spaceId);
      if (!other || other.def.spaceId === space.id) throw new Error("This device is not signed in to that Space");
      const caller = createCapCaller({
        baseUrl: other.baseUrl,
        token: () => other.token,
        ...(o.fetch ? { fetch: o.fetch } : {}),
        ...(o.routes ? { routes: o.routes } : {}),
      });
      return caller(cap, input);
    },
    putBlob: async (path, bytes) => {
      // the upload address files.upload_url hands out: the bytes go there with the person's own token, one time
      if (token === null)
        throw new CapError({ code: "auth.unauthenticated", message: "You are signed out.", traceId: "", status: 401 });
      const send = o.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
      if (!send) throw new Error("This device cannot upload");
      const to = new URL(path, o.baseUrl);
      if (to.origin !== new URL(o.baseUrl).origin) throw new Error("The upload did not go through");
      const r = await send(to.toString(), {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
        body: bytes as unknown as BodyInit,
      });
      if (!r.ok)
        throw new Error(r.status === 413 ? "The file is over the size limit" : "The upload did not go through");
    },
    blobOrigin: new URL(o.baseUrl).origin,
    fetchBlobUrl: async (path) => {
      if (token === null)
        throw new CapError({ code: "auth.unauthenticated", message: "You are signed out.", traceId: "", status: 401 });
      const send = o.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
      if (!send) throw new Error("This device cannot load a picture");
      // the token goes only to this Space: an address on another host (a reply or a document can name any) is never fetched with it
      const at = new URL(path, o.baseUrl);
      if (at.origin !== new URL(o.baseUrl).origin) throw new Error("The picture did not load");
      const r = await send(at.toString(), { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error("The picture did not load");
      const url = (globalThis as { URL?: { createObjectURL?(b: Blob): string } }).URL;
      if (!url?.createObjectURL) throw new Error("This device cannot show a picture");
      return url.createObjectURL(await r.blob());
    },
    ...(aiHome === "here" || door ? { unlockVault } : {}),
    aiHome,
    // a Space server keeps a wrap of the person's key for their Google or GitHub sign-ins: the Vault shows it, with Forget on this server
    serverKey: {
      state: () => serverKeyState(o.baseUrl, token ?? ""),
      keep: (keep: boolean) => setServerKeyKept(o.baseUrl, token ?? "", keep),
    },
    connection: {
      get: () => (reachable && !linkLost && !(everLive && live === "offline") ? "online" : "offline"),
      subscribe: (l) => {
        listeners.add(l);
        return () => {
          listeners.delete(l);
        };
      },
    },
    principals,
    erased: (id) => {
      const e = erasedList.getSnapshot();
      return e.status === "ready"
        ? (e.data as Out<"agents.erased">).agents.find((a) => a.agentId === id)?.name
        : undefined;
    },
    recordTitle: () => undefined,
    me,
    clock: () => ({ now: (o.now ?? Date.now)(), offsetMin: -new Date().getTimezoneOffset() }),
    space: { id: space.id, kind: space.kind, name: shownName },
    baseUrl: o.baseUrl,
    ...(o.spaceCards ? { knownSpaces: o.spaceCards } : {}),
    get assistant() {
      return assistant();
    },
    get aiConnected() {
      return connected(AI_CONNECTORS);
    },
    get calendarConnected() {
      return connected(CALENDAR_CONNECTORS);
    },
    plainRole: plainRoleOnly(who.roles, space.kind),
    ...(livePerms ? { permissions: livePerms } : {}),
    deferredModules: deferred.deferredModules,
    isDeferred: deferred.isDeferred,
    open,
    recall: <T>(cap: string, input?: Record<string, unknown>) => hooks.peek(cap, input ?? {}) as T | undefined,
    warm: (t, pressed) => prefetchTarget(t, pressed === true),
    links,
    openUrl: (url) => {
      if (o.openUrl) o.openUrl(url);
      else (globalThis as { open?: (u: string, t: string, f: string) => unknown }).open?.(url, "_blank", "noopener");
    },
  };

  // A session opened the usual way knows who it is from the Space itself, and keeps those facts for the next launch. One opened from what this device kept asks the Space now, behind the first
  // screen: until it answers, the session is this device's own memory of it. A Space that cannot be reached is asked again (the screen says it is offline); one that refuses ends the session.
  const fresh: Boot = { who, space, switcher, kit: kitChoice, face, console: consoleOk };
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  const confirm = async (): Promise<Confirmed> => {
    for (let tries = 0; ; tries++) {
      try {
        const w = (await reach("identity.whoami", {})) as Out<"identity.whoami">;
        const [sp, sw, kit] = await Promise.all([
          reach("spaces.get", {}) as Promise<Out<"spaces.get">>,
          reach("spaces.switcher", {}).catch(() => null) as Promise<Out<"spaces.switcher"> | null>,
          reach("settings.kit.get", {}).catch(() => null) as Promise<Out<"settings.kit.get"> | null>,
        ]);
        const img = sp.space.logoFileId
          ? await (reach("spaces.image", {}) as Promise<{ logoFileId?: string; image?: string }>).catch(() => null)
          : null;
        const con = await railConsole(w.roles, () =>
          reach("console.nav", {}).then(
            () => true,
            () => false,
          ),
        );
        const now: Boot = { who: w, space: sp.space, switcher: sw, kit, face: img, console: con };
        if (!closed) o.kept?.saveBoot(now);
        if (!closed && bootShape(now) !== bootShape(fresh)) o.onBootChanged?.();
        else if (!closed && livePerms && w.permissions) {
          // the same person in the same roles, with a permission exception changed since: the gates read the new set, and what is on screen is read again
          if (w.permissions.length !== livePerms.size || !w.permissions.every((k) => livePerms.has(k))) {
            livePerms.clear();
            for (const k of w.permissions) livePerms.add(k);
            hooks.invalidate();
          }
        }
        return { personId: w.principal.id, spaceId: sp.space.id, marker: sp.space.fingerprint };
      } catch (e) {
        // the Space answered and refused: the session is not what this device remembered
        if (e instanceof CapError || closed) throw e;
        await new Promise<void>((r) => {
          confirmTimer = setTimeout(r, o.confirmRetryMs?.(tries) ?? Math.min(30_000, 1_500 * 2 ** Math.min(tries, 5)));
        });
        if (closed) throw e;
      }
    }
  };
  let confirmed: Promise<Confirmed>;
  if (keptBoot) confirmed = confirm();
  else {
    o.kept?.saveBoot(fresh);
    confirmed = Promise.resolve({ personId: who.principal.id, spaceId: space.id, marker: space.fingerprint });
  }
  // nobody may be listening yet (the shell attaches after the session is returned)
  confirmed.catch(() => undefined);

  // What a thing's page reads first, warmed while the pointer rests on its row or the row is being pressed (r41). What a page of that kind reads is learnt from the last one the person opened
  // (remote-hooks learn / warmLike), so nothing is asked for that the page would not ask for itself. Pressed, the row also says "learn from this one". The Vault and the Console are never warmed.
  const kindOf = (t: ShellTarget): { place: PlaceId; kind: string; id: string } | null => {
    const where = t.screen
      ? (screens.get(t.screen)?.place ?? railPlace(t.screen.split(".")[0] ?? "") ?? "")
      : t.subject
        ? (placeForSubject(t.subject.type) ?? "")
        : (t.place ?? "");
    const place = railPlace(where);
    if (!place || place === "vault" || place === "console") return null;
    if (t.subject) return { place, kind: `${place}:${t.subject.type}`, id: t.subject.id };
    const ids = Object.values(t.args ?? {}).filter((v): v is string => typeof v === "string" && v !== "");
    return { place, kind: `${place}:${t.screen ?? ""}`, id: ids.length === 1 ? ids[0]! : "" };
  };
  const prefetchTarget = (t: ShellTarget, pressed = false): void => {
    if (closed) return;
    const k = kindOf(t);
    if (!k) return;
    o.warmPlace?.(k.place);
    if (k.id === "") return;
    hooks.warmLike(k.kind, k.id);
    if (pressed) hooks.learn(k.kind, k.id);
  };

  // the chats whose agents (or helpers left running in the background) work now: the tab strip marks their tabs
  const stopWorking = watchWorking({
    call: (cap, input) => call(cap, input),
    onInvalidate: (l) => hooks.onInvalidate(l),
  });

  return {
    def,
    baseUrl: o.baseUrl,
    me,
    hooks,
    runtime,
    call,
    onPurge: (l) => {
      purgeListeners.add(l);
      return () => {
        purgeListeners.delete(l);
      };
    },
    liveStatus: () => live,
    prefetchPlace,
    prefetchTarget,
    shownPlace: (place) => hooks.scope(place),
    confirmed,
    refresh,
    close(why = "unspecified") {
      if (closed) return;
      closed = true;
      if (confirmTimer !== null) clearTimeout(confirmTimer);
      o.kept?.flush();
      stopPerms();
      stopWorking();
      if (permsTimer !== null) clearTimeout(permsTimer);
      detachSpeed();
      stopKeyWatch();
      console.info(`vyre session closed: ${why}`);
      clearInterval(poll);
      for (const t of warmTimers) clearTimeout(t);
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      page?.removeEventListener?.("visibilitychange", shown);
      page?.removeEventListener?.("pointerdown", touch);
      page?.removeEventListener?.("keydown", touch);
      offRetry();
      lostTimer?.();
      lostTimer = null;
      link.stop();
      turns.dispose();
      typing.dispose();
      for (const off of keep) off();
      hooks.close();
      listeners.clear();
      purgeListeners.clear();
      token = null;
    },
  };
}
