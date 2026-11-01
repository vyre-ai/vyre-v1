// Placement (ARCH 6.3, spec b8): where a queued turn runs. A pure function of facts the engine gathers (the thread, the item, the agent, the asker's devices and settings),
// so the same answer comes from the engine worker, from engine.placement.decide and from a test.
//
//   HOST   channels, chats with more than one person, run chats, Ask on a shared record, wakes of non-private threads, routines, automations, Journeys, campaigns,
//          background waits, and any agent that has a computer.
//   DEVICE a private chat (one person and agents) runs on the asker's own online daemon when that device allows the engine and "run my private chats on this computer" is on.
//   HOST   a private chat of a phone or web asker (no daemon at all), or of an asker whose computer is off when they opted in to "Let the Space continue my chats when my computer is off".
//   WAIT   otherwise: "Your computer is off", with a one-tap enable. Never a silent move of a private chat to the server.
//   CHOSEN a person can pin one of their private chats to a place: their computer, the Space, or one of their own servers. The choice wins over the rules above (except for what the Space runs by itself:
//          routines, automations and the like), is never taken to anyone else's machine, and an offline target waits with a line instead of moving the chat somewhere else.
import type { QueueKind, ThreadKind } from "../turn-engine/types.ts";

/** Why a turn started: a message in a chat, or something the Space did on a person's behalf. */
export type Origin = "message" | "routine" | "automation" | "journey" | "campaign" | "wait";

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
  online: boolean;
  /** Engine driver ids this device runs and the Space allows on it. */
  engines: readonly string[];
  /** Last time the device was seen, ms; the most recent eligible device wins. */
  lastSeen?: number;
}

export interface PlaceInput {
  thread: PlaceThread;
  item: { kind: QueueKind; origin?: Origin };
  agent: { hasComputer: boolean };
  /** The driver id of the engine that will run the turn ('claude_code', 'anthropic' ...). */
  engine: string;
  asker: {
    devices: readonly PlaceDevice[];
    /** engine.local_runs: run my private chats on this computer. Default on. */
    localRuns?: boolean;
    /** engine.runtime_opt_in: let the Space continue my chats when my computer is off. */
    runtimeOptIn: boolean;
    /** Where this person pinned this chat. A server is one of theirs; `online` and `name` are what the Space knows of it. */
    chosen?: { target: "device" | "space" | "server"; serverId?: string; online?: boolean; name?: string };
  };
}

export type PlaceReason =
  | "shared_thread" | "routine" | "agent_computer" | "wake_shared" | "crew"
  | "device" | "no_daemon" | "device_off_runtime_opt_in" | "device_off" | "local_runs_off" | "chosen_space" | "chosen_server" | "server_off";

export interface Placement {
  placement: "host" | "device" | "wait";
  reason: PlaceReason;
  /** The device a turn runs on. */
  deviceId?: string;
  /** One of the asker's own servers the chat is pinned to (placement stays "host": the Space's engine, with the work on that server). */
  nodeId?: string;
  /** The line the chat shows when the turn waits. */
  wakeLine?: string;
  /** The turn runs on the Space with a key the person's device wrapped for the Space runtime (b7); true when that is needed and the person has not opted in. */
  needsRuntimeOptIn?: boolean;
}

export const DEVICE_OFF_LINE = "Your computer is off";
export const LOCAL_RUNS_OFF_LINE = "Running chats on your computer is off";

const SHARED_BY_ORIGIN: ReadonlySet<Origin> = new Set<Origin>(["routine", "automation", "journey", "campaign", "wait"]);

/** A private chat: one person and any number of agents, not a channel or a run, and not an Ask on something others can see. */
export function isPrivate(t: PlaceThread): boolean {
  if (t.kind === "channel" || t.kind === "run") return false;
  if (t.persons > 1) return false;
  if (t.kind === "ask" && t.onSharedRecord === true) return false;
  return true;
}

export function placeTurn(i: PlaceInput): Placement {
  const origin: Origin = i.item.origin ?? "message";
  if (i.thread.crew === true) return { placement: "host", reason: "crew" };
  if (!isPrivate(i.thread)) {
    return { placement: "host", reason: i.item.kind === "wake" ? "wake_shared" : "shared_thread" };
  }
  if (SHARED_BY_ORIGIN.has(origin)) return { placement: "host", reason: "routine" };
  const pick = i.asker.chosen;
  if (pick?.target === "space") return { placement: "host", reason: "chosen_space" };
  if (pick?.target === "server" && pick.serverId !== undefined) {
    if (pick.online === true) return { placement: "host", reason: "chosen_server", nodeId: pick.serverId };
    return { placement: "wait", reason: "server_off", nodeId: pick.serverId, wakeLine: `${pick.name ?? "Your server"} is off` };
  }
  if (pick?.target !== "device" && i.agent.hasComputer) return { placement: "host", reason: "agent_computer" };

  // A private chat of one person.
  const daemons = i.asker.devices.filter((d) => d.role === "daemon");
  const eligible = daemons
    .filter((d) => d.online && d.engines.includes(i.engine))
    .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0) || (a.id < b.id ? -1 : 1));
  const localRuns = i.asker.localRuns !== false;
  const first = eligible[0];
  if (first && localRuns) return { placement: "device", reason: "device", deviceId: first.id };

  // Phone and web askers have no daemon at all: their private chats run on the Space (b8).
  if (daemons.length === 0) return { placement: "host", reason: "no_daemon", ...(i.asker.runtimeOptIn ? {} : { needsRuntimeOptIn: true }) };

  const reason: PlaceReason = first && !localRuns ? "local_runs_off" : "device_off";
  // a chat pinned to this computer waits for it: it is never moved to the Space on the strength of a general setting
  if (i.asker.runtimeOptIn && pick?.target !== "device") return { placement: "host", reason: "device_off_runtime_opt_in" };
  return { placement: "wait", reason, wakeLine: reason === "local_runs_off" ? LOCAL_RUNS_OFF_LINE : DEVICE_OFF_LINE };
}
