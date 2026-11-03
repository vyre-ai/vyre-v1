// Placement (ARCH 6.3, spec b8; owner rulings 2 and 3 Nov): where a queued turn runs. A pure function of facts the engine gathers (the thread, the item, the agent, the asker's computers and servers,
// what the Space allows), so the same answer comes from the engine, from engine.placement.decide and from a test. Lane l-multidevice reuses it for a Personal Space, where step 4 does not exist.
//
//   HOST    channels, chats with more than one person, run chats, Ask on a shared record, wakes of non-private threads, routines, automations, Journeys, background waits, crew threads.
//   CHOSEN  a person can pin one of their private chats to a place: a computer of theirs, the Space, or one of their own servers. The pin wins over the order below (not over what the Space runs by
//           itself) and is never moved: a pinned computer or server that is off makes the turn wait with a line, never run somewhere else on its own.
//   AUTO    a private chat that is not pinned runs at the first of (owner ruling 3 Nov, one order):
//             1. the computer the person is using, when it is a desktop app joined to this Space and runs the turn's engine;
//             2. another of the person's computers joined to this Space and awake (the most recently seen first);
//             3. a server the person added to this Space as their own, while it is connected;
//             4. the Space's shared server, when the Space allows it (the default) and the person has not turned off "Let the Space continue my chats when my computer is off" (on by
//                default, owner ruling 3 Nov, spec b7). A Personal Space has no step 4.
//           Nothing of theirs is there and step 4 is not allowed: the turn waits, "Your computer is off".
//   Never another member's computer or another member's server: the caller passes only the asker's own.
import type { QueueKind, ThreadKind } from "../turn-engine/types.ts";

/** Why a turn started: a message in a chat, or something the Space did on a person's behalf. */
export type Origin = "message" | "routine" | "automation" | "journey" | "wait";

export interface PlaceThread {
  kind: ThreadKind;
  /** How many different people are in the thread (agents do not count). */
  persons: number;
  /** An Ask pane scoped to a record other people can see. */
  onSharedRecord?: boolean;
  /** A crew teammate's thread: its work is a copy of the project's repository on the host, so it runs there and nowhere else. */
  crew?: boolean;
}

export interface PlaceDevice {
  id: string;
  /** A device that can run an engine (desktop app, CLI daemon), or a client (phone, browser tab). */
  role: "daemon" | "client";
  /** Joined to this Space right now: its live link to the Space is up (not a stored "last seen"). */
  online: boolean;
  /** Engine driver ids this device runs and the Space allows on it. */
  engines: readonly string[];
  /** Last time the device was seen, ms; among the person's other computers the most recent wins. */
  lastSeen?: number;
  /** What the person calls it ("Dana's MacBook"). */
  name?: string;
}

/** One of the asker's own servers in this Space (approved). `online`: connected to the Space now. */
export interface PlaceServer { serverId: string; name: string; online: boolean; engines?: readonly string[] }

export interface PlaceInput {
  thread: PlaceThread;
  item: { kind: QueueKind; origin?: Origin };
  agent: { hasComputer: boolean };
  /** The driver id of the engine that will run the turn ('claude_code', 'anthropic' ...). */
  engine: string;
  asker: {
    devices: readonly PlaceDevice[];
    /** The device the person is using (the one their message came from). */
    current?: string;
    /** Their own servers in this Space. */
    servers?: readonly PlaceServer[];
    /** engine.local_runs: run my private chats on my computers. Default on. Off skips steps 1 and 2. */
    localRuns?: boolean;
    /** engine.runtime_opt_in: "Let the Space continue my chats when my computer is off", on unless the person turned it off. Off, step 4 is skipped for them. */
    runtimeOptIn: boolean;
    /** Where this person pinned this chat. A device or server is one of theirs; `online` and `name` are what the Space knows of it. */
    chosen?: { target: "device" | "space" | "server"; deviceId?: string; serverId?: string; online?: boolean; name?: string };
  };
  /** The Space: whether it has a shared server that may run members' turns (step 4). Absent: a Team Space that allows it, the default. A Personal Space passes { shared: false, hostIsAsker: true }. */
  space?: { shared: boolean; hostIsAsker?: boolean };
}

export type PlaceReason =
  | "shared_thread" | "routine" | "agent_computer" | "wake_shared" | "crew"
  | "device" | "other_device" | "own_server" | "space" | "own_host" | "device_off" | "chosen_device" | "chosen_space" | "chosen_server" | "server_off";

export interface Placement {
  placement: "host" | "device" | "wait";
  reason: PlaceReason;
  /** The device a turn runs on (placement device), or the pinned device it waits for. */
  deviceId?: string;
  /** One of the asker's own servers the turn runs on (placement stays "host": the Space's engine, with the work on that server), or the pinned server it waits for. */
  nodeId?: string;
  /** The line the chat shows when the turn waits. */
  wakeLine?: string;
}

export const DEVICE_OFF_LINE = "Your computer is off";
export const LOCAL_RUNS_OFF_LINE = "Running chats on your computer is off";

const SHARED_BY_ORIGIN: ReadonlySet<Origin> = new Set<Origin>(["routine", "automation", "journey", "wait"]);

/** A private chat: one person and any number of agents, not a channel or a run, and not an Ask on something others can see. */
export function isPrivate(t: PlaceThread): boolean {
  if (t.kind === "channel" || t.kind === "run") return false;
  if (t.persons > 1) return false;
  if (t.kind === "ask" && t.onSharedRecord === true) return false;
  return true;
}

/** A computer of the person that can take this turn now: a desktop app or daemon, joined to the Space, running the turn's engine. */
const able = (d: PlaceDevice, engine: string): boolean => d.role === "daemon" && d.online && d.engines.includes(engine);

export function placeTurn(i: PlaceInput): Placement {
  const origin: Origin = i.item.origin ?? "message";
  if (i.thread.crew === true) return { placement: "host", reason: "crew" };
  if (!isPrivate(i.thread)) return { placement: "host", reason: i.item.kind === "wake" ? "wake_shared" : "shared_thread" };
  if (SHARED_BY_ORIGIN.has(origin)) return { placement: "host", reason: "routine" };
  const space = i.space ?? { shared: true };
  const pick = i.asker.chosen;
  if (pick?.target === "space") return { placement: "host", reason: "chosen_space" };
  if (pick?.target === "server" && pick.serverId !== undefined) {
    if (pick.online === true) return { placement: "host", reason: "chosen_server", nodeId: pick.serverId };
    return { placement: "wait", reason: "server_off", nodeId: pick.serverId, wakeLine: `${pick.name ?? "Your server"} is off` };
  }
  if (pick?.target === "device") {
    // pinned to a computer: that one (or, for an old pin that names none, the one in use, then any of theirs); off, it waits for it
    const named = pick.deviceId !== undefined ? i.asker.devices.filter((d) => d.id === pick.deviceId) : ordered(i);
    const on = named.find((d) => able(d, i.engine));
    if (on) return { placement: "device", reason: "chosen_device", deviceId: on.id };
    if (pick.deviceId === undefined && space.hostIsAsker === true) return { placement: "host", reason: "own_host" };
    return { placement: "wait", reason: "device_off", ...(pick.deviceId !== undefined ? { deviceId: pick.deviceId } : {}), wakeLine: DEVICE_OFF_LINE };
  }
  if (i.agent.hasComputer) return { placement: "host", reason: "agent_computer" };

  // Automatic: the one order
  const localRuns = i.asker.localRuns !== false;
  if (localRuns) {
    const list = ordered(i).filter((d) => able(d, i.engine));
    const first = list[0];
    if (first) return { placement: "device", reason: first.id === i.asker.current ? "device" : "other_device", deviceId: first.id };
    // a Personal Space lives on the person's own computer: the host is one of their computers
    if (space.hostIsAsker === true) return { placement: "host", reason: "own_host" };
  }
  const server = (i.asker.servers ?? []).filter((s) => s.online && (s.engines === undefined || s.engines.includes(i.engine))).sort((a, b) => (a.serverId < b.serverId ? -1 : 1))[0];
  if (server) return { placement: "host", reason: "own_server", nodeId: server.serverId };
  if (space.shared && i.asker.runtimeOptIn) return { placement: "host", reason: "space" };
  return { placement: "wait", reason: "device_off", wakeLine: localRuns ? DEVICE_OFF_LINE : LOCAL_RUNS_OFF_LINE };
}

/** The person's computers in the order steps 1 and 2 take them: the one in use first, then the most recently seen (ties by id). */
function ordered(i: PlaceInput): PlaceDevice[] {
  return [...i.asker.devices].sort((a, b) => {
    const ca = a.id === i.asker.current ? 1 : 0, cb = b.id === i.asker.current ? 1 : 0;
    return cb - ca || (b.lastSeen ?? 0) - (a.lastSeen ?? 0) || (a.id < b.id ? -1 : 1);
  });
}
