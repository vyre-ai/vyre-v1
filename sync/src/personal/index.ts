// Personal Space hosting (ARCH 5.13, spec 2.1): a Personal Space is a daemon on one of the person's desktops, its host device, and the person's other devices reach it through the relay.
// Three small things live here. The matrix: a capability whose manifest says `teamOnly` is refused with `permission.needs_team` in a Personal Space. The relay: it hands a device's calls to the
// host, and while the host is off it answers "unavailable" (the device keeps reading its replica and queues its changes). The view: what a device says while the host is off ("Your computer is off").
import { VyreErr } from "../../../packages/contracts/src/errors.ts";

export type SpaceKind = "personal" | "team";

/** The connection manager's status (client/src/connection), repeated here because sync does not import the client. */
export type ConnStatus = "idle" | "connecting" | "live" | "reconnecting" | "read_only" | "stopped";

/** The one line a screen shows for something a Personal Space cannot do. */
export const NEEDS_TEAM_LINE = "Needs a Team Space";
export const HOST_OFF_LINE = "Your computer is off";
export const HOST_OFF_CHAT_LINE = "Your computer is off, turn it on to continue";

/** What the matrix needs of a capability row (the registry's rows have more). */
export interface CapabilityRow { name: string; teamOnly?: boolean }

/** The capabilities a Personal Space refuses. */
export function teamOnlySet(caps: Iterable<CapabilityRow>): ReadonlySet<string> {
  const out = new Set<string>();
  for (const c of caps) if (c.teamOnly === true) out.add(c.name);
  return out;
}

export function needsTeamError(cap: string, traceId: string): VyreErr {
  return new VyreErr({
    code: "permission.needs_team",
    message: `${NEEDS_TEAM_LINE}. ${cap} works in a Team Space; create or join one to use it.`,
    retryable: false, traceId,
    next: [{ kind: "open_settings", label: "Create or join a Team Space" }],
    details: { capability: cap },
  });
}

/** Throws `permission.needs_team` when a Personal Space is asked for a team-only capability. A Team Space allows everything the manifest does. */
export function refuseTeamOnly(kind: SpaceKind, cap: string, teamOnly: ReadonlySet<string>, traceId: string): void {
  if (kind === "personal" && teamOnly.has(cap)) throw needsTeamError(cap, traceId);
}

// ---- the relay

export type Presence = "present" | "absent";

type Handler = (ctx: never, input: never) => Promise<unknown>;

export interface Relay<H extends Record<string, Handler>> {
  /** The host's handlers as a device reaches them: each call goes through while the host is on and fails `internal.unavailable` while it is off. */
  handlers: H;
  presence(): Presence;
  hostOn(): void;
  hostOff(): void;
  /** Calls that were turned away because the host was off. */
  refused(): number;
}

export const hostOffError = (traceId: string): VyreErr => new VyreErr({
  code: "internal.unavailable",
  message: `${HOST_OFF_LINE}. Changes are kept and sent when it is back.`,
  retryable: true, traceId,
  next: [{ kind: "wait", label: "Turn your computer on" }],
  details: { host: "off" },
});

/** Put a relay in front of a handler table. `traceOf` reads the trace id out of the call context (the host's own ctx has `trace.traceId`); `state` is shared when several relays follow one host. */
export function relayTo<H extends Record<string, Handler>>(host: H, o: { traceOf?: (ctx: unknown) => string; state?: { on: boolean } } = {}): Relay<H> {
  const state = o.state ?? { on: true };
  let refused = 0;
  const traceOf = o.traceOf ?? ((c) => (c as { trace?: { traceId?: string } } | null)?.trace?.traceId ?? "0".repeat(32));
  const wrapped: Record<string, Handler> = {};
  for (const [name, fn] of Object.entries(host)) {
    wrapped[name] = (async (ctx: unknown, input: unknown) => {
      if (!state.on) { refused++; throw hostOffError(traceOf(ctx)); }
      return (fn as unknown as (c: unknown, i: unknown) => Promise<unknown>)(ctx, input);
    }) as unknown as Handler;
  }
  return { handlers: wrapped as H, presence: () => (state.on ? "present" : "absent"), hostOn() { state.on = true; }, hostOff() { state.on = false; }, refused: () => refused };
}

// ---- a revoked device

/** The epoch a device must present: its person's, or its own if that is higher (sync/src/purge `effectiveEpoch` over the host's tables). */
export type DeviceEpoch = (person: string, device: string) => number;

export const deviceRevokedError = (traceId: string): VyreErr => new VyreErr({
  code: "auth.device_revoked",
  message: "This device was signed out of the Space. Pair it again to use it.",
  retryable: false, traceId,
  next: [{ kind: "open_settings", label: "Pair this device again" }],
});

/**
 * Hold a revoked device to the epoch the host has for it. A pull that presents an older epoch is answered `reset: "purge"` with the host's epoch and no rows; a push that presents one is
 * refused `auth.device_revoked` and applies nothing. (The pull handler itself reads the person's epoch only; the device's own epoch is read here, at the host's door.)
 */
export function guardDeviceEpoch<H extends Record<string, Handler>>(
  host: H,
  o: { epoch: DeviceEpoch; whoOf: (ctx: unknown) => { person: string; device: string }; traceOf: (ctx: unknown) => string },
): H {
  const out: Record<string, Handler> = { ...host };
  const pull = host["sync.pull"] as unknown as ((c: unknown, i: { epoch: number; cursor: number }) => Promise<Record<string, unknown>>) | undefined;
  if (pull) {
    out["sync.pull"] = (async (ctx: unknown, req: { epoch: number; cursor: number }) => {
      const w = o.whoOf(ctx);
      const eff = o.epoch(w.person, w.device);
      if (req.epoch >= eff) return pull(ctx, req);
      // the host answers a stale epoch with a purge and no rows (what the pull found is thrown away); its own epoch for this device goes in the answer so the device remembers which purge it did
      const res = await pull(ctx, req);
      return { ...res, changes: [], hide: [], more: false, next: req.cursor, epoch: eff, reset: "purge" };
    }) as unknown as Handler;
  }
  const push = host["sync.push"] as unknown as ((c: unknown, i: { epoch: number }) => Promise<unknown>) | undefined;
  if (push) {
    out["sync.push"] = (async (ctx: unknown, req: { epoch: number }) => {
      const w = o.whoOf(ctx);
      if (req.epoch < o.epoch(w.person, w.device)) throw deviceRevokedError(o.traceOf(ctx));
      return push(ctx, req);
    }) as unknown as Handler;
  }
  return out as unknown as H;
}

// ---- what a device says

export type DeviceState = "online" | "host_off" | "no_network" | "connecting" | "read_only" | "stopped";

export interface DeviceView {
  state: DeviceState;
  /** The words for the title bar or the Space banner; empty while all is well. */
  line: string;
  /** "3 changes waiting" or empty. */
  waiting: string;
}

const changes = (n: number): string => (n === 0 ? "" : `${n} ${n === 1 ? "change" : "changes"} waiting`);

/**
 * What a device in a Personal Space shows. The connection status says whether a path to the host is open; `presence` says what the relay reported when it could be reached:
 * `absent` means the relay is up and the host is not, so the person is told their computer is off; `undefined` means nothing was heard, which is the phone's own network.
 */
export function deviceView(o: { status: ConnStatus; presence?: Presence; pending: number }): DeviceView {
  const waiting = changes(o.pending);
  switch (o.status) {
    case "live": return { state: "online", line: "", waiting };
    case "read_only": return { state: "read_only", line: "Update the app to make changes", waiting };
    case "stopped": case "idle": return { state: "stopped", line: "", waiting };
    case "connecting": case "reconnecting":
      if (o.presence === "absent") return { state: "host_off", line: HOST_OFF_LINE, waiting };
      return { state: o.status === "connecting" ? "connecting" : "no_network", line: o.status === "connecting" ? "" : "Offline", waiting };
  }
}

/** Where an agent turn runs in a Personal Space: on the host device only. A phone chat waits while the host is off. */
export function placeAgentTurn(kind: SpaceKind, presence: Presence): { where: "host" | "waiting" | "anywhere"; line: string } {
  if (kind === "team") return { where: "anywhere", line: "" };
  return presence === "present" ? { where: "host", line: "" } : { where: "waiting", line: HOST_OFF_CHAT_LINE };
}

/** The endpoint list a device keeps for a Personal Space: the host device directly when it is reachable, always the relay (ARCH 5.13). */
export function personalEndpoints(o: { direct?: string; relay: string }): Array<{ kind: "direct" | "relay"; url: string }> {
  return [...(o.direct ? [{ kind: "direct" as const, url: o.direct }] : []), { kind: "relay" as const, url: o.relay }];
}

export { createPhonePurge } from "./revoke.ts";
export type { PhonePurgeOpts } from "./revoke.ts";
