// The sync module's side of a Personal Space (ARCH 5.13, spec 2.1): the host device's role. `createPersonalHost` holds the Space kind, the capabilities the Personal matrix refuses and the host's
// presence; it gates a call before the handler runs, guards a handler table, and gives devices the relay's view of the host. The host's invoke pipeline calls `gate` for every capability of a
// Personal Space (that wiring is the lead's: host/src/invoke.ts is frozen), and the relay endpoint of the daemon uses `relay` so a device sees "Your computer is off" while it is.
import { placeAgentTurn, refuseTeamOnly, relayTo, teamOnlySet } from "../../../sync/src/personal/index.ts";
import type { CapabilityRow, Presence, Relay, SpaceKind } from "../../../sync/src/personal/index.ts";

type Handler = (ctx: never, input: never) => Promise<unknown>;

export interface PersonalHostOpts {
  /** `personal` while the Space is a Personal Space; `team` once a server hosts it. */
  kind: () => SpaceKind;
  /** The registry's capability rows. */
  caps: Iterable<CapabilityRow>;
  /** Where the trace id is in a call context. */
  traceOf?: (ctx: unknown) => string;
}

export interface PersonalHost {
  kind(): SpaceKind;
  /** The capabilities refused in a Personal Space. */
  teamOnly(): ReadonlySet<string>;
  /** Throws `permission.needs_team` for a team-only capability in a Personal Space; passes everything else. */
  gate(cap: string, traceId: string): void;
  /** The same gate in front of every handler of a table, so a call is refused before any of its work. */
  guard<H extends Record<string, Handler>>(handlers: H): H;
  /** The handlers as a device reaches them through the relay. */
  relay<H extends Record<string, Handler>>(handlers: H): Relay<H>;
  /** Whether the host device is on, as the relay last saw it. */
  presence(): Presence;
  setPresence(p: Presence): void;
  /** Where an agent turn of this Space runs now. */
  placeTurn(): { where: "host" | "waiting" | "anywhere"; line: string };
}

export function createPersonalHost(o: PersonalHostOpts): PersonalHost {
  const teamOnly = teamOnlySet(o.caps);
  const traceOf = o.traceOf ?? ((c: unknown) => (c as { trace?: { traceId?: string } } | null)?.trace?.traceId ?? "0".repeat(32));
  const state = { on: true };
  const presence = (): Presence => (state.on ? "present" : "absent");
  const host: PersonalHost = {
    kind: o.kind,
    teamOnly: () => teamOnly,
    gate: (cap, traceId) => refuseTeamOnly(o.kind(), cap, teamOnly, traceId),
    guard(handlers) {
      const out: Record<string, Handler> = {};
      for (const [cap, fn] of Object.entries(handlers)) {
        out[cap] = (async (ctx: unknown, input: unknown) => {
          host.gate(cap, traceOf(ctx));
          return (fn as unknown as (c: unknown, i: unknown) => Promise<unknown>)(ctx, input);
        }) as unknown as Handler;
      }
      return out as unknown as typeof handlers;
    },
    relay: (handlers) => relayTo(handlers, { traceOf, state }),
    presence,
    setPresence(p) { state.on = p === "present"; },
    placeTurn: () => placeAgentTurn(o.kind(), presence()),
  };
  return host;
}
