// A turn pinned to one of the person's own servers runs its CLI engine there (the "runs on" chip of a chat). The Space still owns the chat, the context, the tools (the engine reaches them over the
// Space's MCP address) and the record; what moves is the engine process. engine.placement.decide says where a turn goes (the person's pin); when it names a server, the session is opened by an
// opener whose launcher starts the process on that server, over the server's live socket (host/src/routes/compute-stream.ts), with the person's own account filled into its environment by the Vault
// fill as on any machine. A server that is off, or not connected, ends the turn with engine.server_off and the server's name: a pinned chat never moves to another machine on its own.
// DECISION: only a turn that decide pins to a server is routed here; every other turn opens exactly as before.
// DECISION: the engine process on a server has no Space work folder and no native plugins: it works in a folder of the server's own and reaches Vyre through MCP only.
import { DriverError } from "../../agent/src/drivers/api/driver.ts";
import { LaunchError } from "../../agent/src/drivers/cli/launcher.ts";
import type { CliProcess, Launcher } from "../../agent/src/drivers/cli/types.ts";
import type { OpenSession, SessionSpec } from "../../agent/src/turn-engine/types.ts";
import type { Db } from "./projections.ts";

/** What the daemon offers for processes on computers that joined (host/src/seams/engine.ts EngineNodes), structural so neither side imports the other. */
export interface NodeRelay {
  spawn(nodeId: string, spec: { argv: readonly string[]; cwd?: string; env: Readonly<Record<string, string>> }): Promise<CliProcess>;
  connected(nodeId: string): boolean;
  secure(nodeId: string): boolean;
}

const TABLE = "CREATE TABLE IF NOT EXISTS engine_turn_node (turn_id TEXT PRIMARY KEY, node_id TEXT NOT NULL)";
const ready = new WeakSet<object>();
function ensureNodeTable(db: Db): void {
  if (ready.has(db)) return;
  db.run(TABLE);
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

/** A launcher whose processes run on one server. A refusal keeps its engine.* code so the turn fails with the right words. */
export function remoteLauncher(relay: NodeRelay, nodeId: string): Launcher {
  return {
    async spawn(spec): Promise<CliProcess> {
      try { return await relay.spawn(nodeId, { argv: spec.argv, ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}), env: spec.env }); }
      catch (e) { throw new LaunchError(typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : "engine.cli_failed", e instanceof Error ? e.message : "The server could not start the engine."); }
    },
  };
}

export interface Place { nodeId: string; line?: string; code?: string }

/** Where this turn is pinned to run, if it is pinned to a server: undefined means "as usual". `line` is set when the server is off. */
export async function serverFor(call: (cap: string, input: unknown, as?: string) => Promise<unknown>, relay: Pick<NodeRelay, "connected" | "secure">, spec: SessionSpec): Promise<Place | undefined> {
  let decided: { placement?: string; reason?: string; nodeId?: string; wakeLine?: string };
  try { decided = (await call("engine.placement.decide", { threadId: spec.threadId, agentId: spec.agent.id, kind: "message" }, spec.asker)) as typeof decided; }
  catch { return undefined; }   // a thread or agent decide does not know (an automation step): nothing pins it
  if (decided.reason === "server_off" && decided.nodeId) return { nodeId: decided.nodeId, line: decided.wakeLine ?? "Your server is off" };
  if (decided.reason !== "chosen_server" || !decided.nodeId) return undefined;
  if (!relay.connected(decided.nodeId)) return { nodeId: decided.nodeId, line: "Your server is off" };
  // the engine's environment will hold the person's own account key: it is filled only for a server whose link is private (https, or this machine); nothing is read from the Vault before this
  if (!relay.secure(decided.nodeId)) return { nodeId: decided.nodeId, code: "engine.link_insecure", line: "Your server needs a secure link (https) before it can run your chats." };
  return { nodeId: decided.nodeId };
}

/** The session opener with the turn's pin applied: a pinned turn opens through its server's opener, a server that is off fails the turn with its line. */
export function routed(inner: OpenSession, o: { call(cap: string, input: unknown, as?: string): Promise<unknown>; relay: NodeRelay | undefined; nodeOpener(nodeId: string): OpenSession; db: Db }): OpenSession {
  const relay = o.relay;
  if (!relay) return inner;
  return async (spec) => {
    const place = await serverFor(o.call, relay, spec);
    if (!place) return inner(spec);
    if (place.line !== undefined) throw new DriverError(place.code ?? "engine.server_off", place.line);
    if (spec.turnId) setTurnNode(o.db, spec.turnId, place.nodeId);
    return o.nodeOpener(place.nodeId)(spec);
  };
}
