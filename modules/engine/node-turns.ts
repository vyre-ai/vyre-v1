// A turn pinned to one of the person's own servers runs its CLI engine there (the "runs on" chip of a chat). The Space still owns the chat, the context, the tools (the engine reaches them over the
// Space's MCP address) and the record; what moves is the engine process. engine.placement.decide says where a turn goes (the person's pin); when it names a server, the session is opened by an
// opener whose launcher starts the process on that server, over the server's live socket (host/src/routes/compute-stream.ts), with the person's own account filled into its environment by the Vault
// fill as on any machine. A server that is off, or not connected, ends the turn with engine.server_off and the server's name: a pinned chat never moves to another machine on its own.
// DECISION: only a turn that decide places on a server or on the person's own computer is routed away; every other turn opens on the Space's own engine as before.
// Lane l-runson: a turn placed on the person's own computer (their Vyre app linked to the Space, node `device:<id>`) opens the same way, through that computer's link, wrapped so that a computer
// that goes away mid-turn hands the turn on (device-turns.ts). The one placement order is agent/src/placement (engine.placement.decide).
// DECISION: the engine process on a server has no Space work folder and no native plugins: it works in a folder of the server's own and reaches Vyre through MCP only.
import { DriverError } from "../../agent/src/drivers/api/driver.ts";
import { LaunchError } from "../../agent/src/drivers/cli/launcher.ts";
import type { CliProcess, Launcher } from "../../agent/src/drivers/cli/types.ts";
import type { EngineSession, OpenSession, SessionSpec } from "../../agent/src/turn-engine/types.ts";
import { handoverSession } from "./device-turns.ts";
import type { Db } from "./projections.ts";

/** What the daemon offers for processes on computers that joined (host/src/seams/engine.ts EngineNodes), structural so neither side imports the other. */
export interface NodeRelay {
  spawn(nodeId: string, spec: { argv: readonly string[]; cwd?: string; env: Readonly<Record<string, string>>; person?: string }): Promise<CliProcess>;
  connected(nodeId: string): boolean;
  secure(nodeId: string): boolean;
  /** Turns running on a node now (all nodes' when none is named). Absent: unknown, the machine's last report stands. */
  running?(nodeId?: string): number;
  /** The person's own computers linked to the Space now. Absent: none ever link (an older host). */
  devices?(person?: string): DeviceLink[];
  onDevice?(fn: (link: DeviceLink, up: boolean) => void): () => void;
}
export interface DeviceLink { nodeId: string; deviceId: string; person: string; name?: string; engines: string[] }

/** The node id of a person's own computer (host/src/routes/compute-stream.ts deviceNode). */
export const deviceNode = (deviceId: string): string => `device:${deviceId}`;
/** The CLI engines: the only turns that have an engine process to put on a computer. An API engine's turn is a few HTTP calls and stays on the Space. */
export const CLI_DRIVERS: ReadonlySet<string> = new Set(["claude_code", "codex", "grok"]);

const TABLE = "CREATE TABLE IF NOT EXISTS engine_turn_node (turn_id TEXT PRIMARY KEY, node_id TEXT NOT NULL)";
const WHERE = "CREATE TABLE IF NOT EXISTS engine_turn_where (turn_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, node_id TEXT, name TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (turn_id, seq))";
const USING = "CREATE TABLE IF NOT EXISTS engine_thread_device (thread_id TEXT NOT NULL, person TEXT NOT NULL, device_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (thread_id, person))";
const ONCE = "CREATE TABLE IF NOT EXISTS engine_thread_once (thread_id TEXT PRIMARY KEY, by_person TEXT NOT NULL, at INTEGER NOT NULL)";
const ready = new WeakSet<object>();
function ensureNodeTable(db: Db): void {
  if (ready.has(db)) return;
  db.run(TABLE); db.run(WHERE); db.run(USING); db.run(ONCE);
  ready.add(db);
}

/** Remember the server a turn ran on, so the turn record can say it. */
export function setTurnNode(db: Db, turnId: string, nodeId: string): void {
  ensureNodeTable(db);
  db.run("DELETE FROM engine_turn_node WHERE turn_id = ?", turnId);
  db.run("INSERT INTO engine_turn_node (turn_id, node_id) VALUES (?, ?)", turnId, nodeId);
}

export function nodeOfTurn(db: Db, turnId: string): string | undefined {
  ensureNodeTable(db);
  const r = (db.all("SELECT node_id FROM engine_turn_node WHERE turn_id = ?", turnId) as Array<{ node_id?: unknown }>)[0];
  return typeof r?.node_id === "string" ? r.node_id : undefined;
}

export type WhereKind = "computer" | "server" | "space";
export interface Ran { kind: WhereKind; name: string; nodeId?: string }

/** One more place the turn ran on, in order: a turn handed on after its computer slept has two. */
export function recordWhere(db: Db, turnId: string, ran: Ran, at: number): void {
  if (turnId === "") return;
  ensureNodeTable(db);
  const n = Number(((db.all("SELECT COUNT(*) AS n FROM engine_turn_where WHERE turn_id = ?", turnId) as Array<{ n?: unknown }>)[0]?.n) ?? 0);
  db.run("INSERT INTO engine_turn_where (turn_id, seq, kind, node_id, name, at) VALUES (?, ?, ?, ?, ?, ?)", turnId, n, ran.kind, ran.nodeId ?? null, ran.name, at);
}

/** Where a turn ran, in order (the turn's details). Empty for a turn recorded before this was kept. */
export function whereOfTurn(db: Db, turnId: string): Ran[] {
  ensureNodeTable(db);
  return (db.all("SELECT kind, node_id, name FROM engine_turn_where WHERE turn_id = ? ORDER BY seq", turnId) as Array<{ kind: string; node_id: string | null; name: string }>)
    .map((r) => ({ kind: r.kind as WhereKind, name: r.name, ...(r.node_id ? { nodeId: r.node_id } : {}) }));
}

/** The computer a person is using in a chat: the device their last message there came from (step 1 of the order). */
export function setUsing(db: Db, threadId: string, person: string, deviceId: string, at: number): void {
  ensureNodeTable(db);
  db.run("INSERT INTO engine_thread_device (thread_id, person, device_id, at) VALUES (?, ?, ?, ?) ON CONFLICT (thread_id, person) DO UPDATE SET device_id = excluded.device_id, at = excluded.at", threadId, person, deviceId, at);
}
export function usingIn(db: Db, threadId: string, person: string): string | undefined {
  ensureNodeTable(db);
  const r = (db.all("SELECT device_id FROM engine_thread_device WHERE thread_id = ? AND person = ?", threadId, person) as Array<{ device_id?: unknown }>)[0];
  return typeof r?.device_id === "string" ? r.device_id : undefined;
}

/** "Run it on the server instead": the next turn of this chat runs on the Space, once, whatever the pin says. */
export function setOnce(db: Db, threadId: string, person: string, at: number): void {
  ensureNodeTable(db);
  db.run("INSERT OR REPLACE INTO engine_thread_once (thread_id, by_person, at) VALUES (?, ?, ?)", threadId, person, at);
}
export function hasOnce(db: Db, threadId: string): boolean {
  ensureNodeTable(db);
  return db.all("SELECT 1 AS x FROM engine_thread_once WHERE thread_id = ?", threadId).length > 0;
}
function takeOnce(db: Db, threadId: string): boolean {
  if (!hasOnce(db, threadId)) return false;
  db.run("DELETE FROM engine_thread_once WHERE thread_id = ?", threadId);
  return true;
}

/**
 * Whether the next turn of this chat waits for a computer (the engine's `place`, synchronous): the chat is pinned to a computer of the person's that is not linked now, and nobody pressed "Run it
 * on the server instead". Pins live in engine_thread_place (place-pref.ts); a computer pin keeps its device id in server_id.
 */
export function waitsForComputer(db: Db, relay: NodeRelay | undefined, threadId: string): { deviceId: string | null; person: string } | null {
  if (!relay?.devices) return null;
  ensureNodeTable(db);
  let pin: { target?: unknown; server_id?: unknown; by_principal?: unknown } | undefined;
  try { pin = (db.all("SELECT target, server_id, by_principal FROM engine_thread_place WHERE thread_id = ?", threadId) as Array<typeof pin>)[0]; } catch { return null; }
  if (pin?.target !== "device" || hasOnce(db, threadId)) return null;
  const person = String(pin.by_principal ?? "");
  const deviceId = typeof pin.server_id === "string" && pin.server_id !== "" ? pin.server_id : null;
  const linked = relay.devices(person).some((l) => (deviceId === null || l.deviceId === deviceId) && l.engines.length > 0);
  return linked ? null : { deviceId, person };
}

/** A launcher whose processes run on one server or on one person's computer (`person`: the only person whose turns it may start there). A refusal keeps its engine.* code so the turn fails with the right words. */
export function remoteLauncher(relay: NodeRelay, nodeId: string, person?: string): Launcher {
  return {
    async spawn(spec): Promise<CliProcess> {
      try { return await relay.spawn(nodeId, { argv: spec.argv, ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}), env: spec.env, ...(person !== undefined ? { person } : {}) }); }
      catch (e) { throw new LaunchError(typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : "engine.cli_failed", e instanceof Error ? e.message : "The server could not start the engine."); }
    },
  };
}

interface Decided { placement?: string; reason?: string; nodeId?: string; deviceId?: string; wakeLine?: string }

async function decide(call: (cap: string, input: unknown, as?: string) => Promise<unknown>, spec: SessionSpec): Promise<Decided | undefined> {
  try { return (await call("engine.placement.decide", { threadId: spec.threadId, agentId: spec.agent.id, kind: "message" }, spec.asker)) as Decided; }
  catch { return undefined; }   // a thread or agent decide does not know (an automation step): nothing places it
}

export interface Place { nodeId: string; line?: string; code?: string }

/** Where this turn is pinned to run, if it is pinned to a server: undefined means "as usual". `line` is set when the server is off. */
export async function serverFor(call: (cap: string, input: unknown, as?: string) => Promise<unknown>, relay: Pick<NodeRelay, "connected" | "secure">, spec: SessionSpec): Promise<Place | undefined> {
  const decided = await decide(call, spec);
  if (!decided) return undefined;
  return serverOf(decided, relay);
}

function serverOf(decided: Decided, relay: Pick<NodeRelay, "connected" | "secure">): Place | undefined {
  if (decided.reason === "server_off" && decided.nodeId) return { nodeId: decided.nodeId, line: decided.wakeLine ?? "Your server is off" };
  if ((decided.reason !== "chosen_server" && decided.reason !== "own_server") || !decided.nodeId) return undefined;
  if (!relay.connected(decided.nodeId)) return decided.reason === "own_server" ? undefined : { nodeId: decided.nodeId, line: "Your server is off" };
  // the engine's environment will hold the person's own account key: it is filled only for a server whose link is private (https, or this machine); nothing is read from the Vault before this
  if (!relay.secure(decided.nodeId)) return decided.reason === "own_server" ? undefined : { nodeId: decided.nodeId, code: "engine.link_insecure", line: "Your server needs a secure link (https) before it can run your chats." };
  return { nodeId: decided.nodeId };
}

export interface RouteDeps {
  call(cap: string, input: unknown, as?: string): Promise<unknown>;
  relay: NodeRelay | undefined;
  /** The opener of one server or computer. A computer's (`person` set) is that person's alone. */
  nodeOpener(nodeId: string, person?: string): OpenSession;
  db: Db;
  now?: () => number;
  /** The Space's own server in a line ("the MLA server"). */
  spaceName?: () => Promise<string>;
  /** A server of the person's by its id, for its name. */
  serverName?: (serverId: string, person: string) => Promise<string | undefined>;
  /** A line in the chat (a turn_status note). */
  note?: (spec: SessionSpec, text: string) => void;
  /** The live line of a turn waiting for its computer. */
  live?: (spec: SessionSpec, phase: "call" | "result") => void;
}

/**
 * The session opener with the turn's place applied: on the person's own computer through its link, on one of their servers, or on the Space's own engine. A pinned place that is off fails the turn
 * with its line (a pinned computer that is off never reaches here: the engine's `place` keeps the turn queued until it is back).
 */
export function routed(inner: OpenSession, o: RouteDeps): OpenSession {
  const relay = o.relay;
  if (!relay) return inner;
  const now = o.now ?? Date.now;
  const spaceName = async (): Promise<string> => { try { return (await o.spaceName?.()) ?? "the Space's server"; } catch { return "the Space's server"; } };
  const onSpace = async (spec: SessionSpec): Promise<{ session: EngineSession; name: string }> => {
    const name = await spaceName();
    if (spec.turnId) recordWhere(o.db, spec.turnId, { kind: "space", name }, now());
    return { session: await inner(spec), name };
  };
  /** Where the turn goes on after its computer went away: next in the order without any computer (their own server, else the Space). */
  const next = async (spec: SessionSpec): Promise<{ session: EngineSession; name: string }> => {
    const d = await decide(o.call, spec);
    const server = d && d.placement === "host" ? serverOf(d, relay) : undefined;
    if (server && server.line === undefined) {
      const name = (await o.serverName?.(server.nodeId, spec.asker).catch(() => undefined)) ?? "your server";
      if (spec.turnId) recordWhere(o.db, spec.turnId, { kind: "server", name, nodeId: server.nodeId }, now());
      return { session: await o.nodeOpener(server.nodeId)(spec), name };
    }
    return onSpace(spec);
  };
  return async (spec) => {
    if (takeOnce(o.db, spec.threadId)) return (await onSpace(spec)).session;   // "Run it on the server instead"
    const decided = await decide(o.call, spec);
    if (!decided) return inner(spec);
    if (decided.placement === "device" && decided.deviceId) {
      const pinned = decided.reason === "chosen_device";
      const deviceId = decided.deviceId;
      const nodeId = deviceNode(deviceId);
      const link = () => relay.devices?.(spec.asker).find((l) => l.deviceId === deviceId);
      const here = link();
      const cli = CLI_DRIVERS.has(spec.account?.driver ?? "");
      // an API engine has no process to move; a computer that went away since the decision, or one on a link that is not private, is passed over (Automatic) or waits (pinned)
      if (!cli || !here || !relay.secure(nodeId)) {
        if (pinned && cli) throw new DriverError(here ? "engine.link_insecure" : "engine.device_off", here ? "Your computer's link to the Space is not private (https), so it cannot run your chats." : "Your computer is off. This chat runs when it is back.");
        return (await (cli ? next(spec) : onSpace(spec))).session;
      }
      const from = here.name ?? "your computer";
      const open = o.nodeOpener(nodeId, spec.asker);
      if (spec.turnId) { setTurnNode(o.db, spec.turnId, nodeId); recordWhere(o.db, spec.turnId, { kind: "computer", name: from, nodeId }, now()); }
      const first = await open(spec);
      return handoverSession(first, {
        linkUp: () => relay.connected(nodeId), pinned, from,
        openServer: () => next(spec),
        reopenDevice: async () => { if (spec.turnId) recordWhere(o.db, spec.turnId, { kind: "computer", name: from, nodeId }, now()); return open(spec); },
        waitFor: (signal) => new Promise((resolve) => {
          let off: (() => void) | undefined;
          const done = (a: "device" | "server" | "cancelled"): void => { off?.(); clearInterval(poll); signal.removeEventListener("abort", stop); resolve(a); };
          const stop = (): void => done("cancelled");
          signal.addEventListener("abort", stop, { once: true });
          off = relay.onDevice?.((l, up) => { if (up && l.deviceId === deviceId && l.person === spec.asker && l.engines.length > 0) done("device"); });
          // the person pressed "Run it on the server instead" (engine.placement.set once): read here, so the button works on a turn that is already waiting
          const poll = setInterval(() => { if (takeOnce(o.db, spec.threadId)) done("server"); }, 500);
          poll.unref?.();
        }),
        note: (text) => o.note?.(spec, text),
        moved: () => undefined,
        live: (phase) => o.live?.(spec, phase),
      });
    }
    if (decided.placement === "wait") {
      if (decided.reason === "server_off") throw new DriverError("engine.server_off", decided.wakeLine ?? "Your server is off");
      throw new DriverError("engine.device_off", decided.wakeLine ?? "Your computer is off");
    }
    const place = serverOf(decided, relay);
    if (!place) return (await onSpace(spec)).session;
    if (place.line !== undefined) throw new DriverError(place.code ?? "engine.server_off", place.line);
    if (spec.turnId) {
      setTurnNode(o.db, spec.turnId, place.nodeId);
      recordWhere(o.db, spec.turnId, { kind: "server", name: (await o.serverName?.(place.nodeId, spec.asker).catch(() => undefined)) ?? "your server", nodeId: place.nodeId }, now());
    }
    return o.nodeOpener(place.nodeId)(spec);
  };
}
