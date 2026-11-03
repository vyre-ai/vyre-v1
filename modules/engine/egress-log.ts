// Where AI tools went on the internet (owner ruling 3 Nov). The wall of each engine process reports every host it let through or refused (sandbox/src/egress.ts, host and port only, never a path or
// a byte); spawnCli samples it to one line per host and verdict per process. Here those lines are kept per person and thread, so a turn's details can say "Reached: github.com, registry.npmjs.org"
// for the time the turn ran, and every refusal is an audit row (class deny) an admin finds in the Console's audit log. The Space's choice is read from the setting engine.egress at each process start.
import type { EgressEvent } from "../../sandbox/src/index.ts";
import type { Db } from "./projections.ts";

export const EGRESS_SETTING = "engine.egress";

const TABLE = "CREATE TABLE IF NOT EXISTS engine_egress (thread_id TEXT NOT NULL, person TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, verdict TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL)";
const INDEX = "CREATE INDEX IF NOT EXISTS engine_egress_thread ON engine_egress (thread_id, person, at)";
const ready = new WeakSet<object>();
function ensure(db: Db): void {
  if (ready.has(db)) return;
  db.run(TABLE);
  db.run(INDEX);
  ready.add(db);
}

/** Why a host was refused, in words a person reads in the audit log and the turn's details. */
export const REFUSAL_WORDS: Readonly<Record<EgressEvent["reason"], string>> = {
  ok: "allowed",
  not_listed: "not allowed by this Space's internet setting",
  bad_port: "that port is not allowed",
  private_address: "it points to a private or local address",
  own_network: "it points to this computer or its own network",
  no_address: "the name did not resolve",
  bad_request: "the request was not one the proxy reads",
  busy: "too many connections at once",
  unreachable: "the host did not answer",
};

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;

/** Keep one sampled report, and write a refusal to the audit log for the person the engine acted for. An audit failure is logged by the caller's sink and never stops the engine. */
export function recordEgress(db: Db, call: Call, where: { person: string; threadId: string }, e: EgressEvent, now: () => number = Date.now, log?: (msg: string, attrs?: Record<string, unknown>) => void): void {
  ensure(db);
  db.run("INSERT INTO engine_egress (thread_id, person, host, port, verdict, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?)", where.threadId, where.person, e.host.slice(0, 253), e.port, e.verdict, e.reason, now());
  // a host that did not answer was allowed by the policy: only a refusal by the policy (or the address checks) is a denial
  if (e.verdict !== "deny" || e.reason === "unreachable" || e.reason === "busy") return;
  void call("audit.append", {
    action: "engine.egress_denied", class: "deny", resource: { type: "thread", id: where.threadId }, onBehalfOf: { kind: "person", id: where.person },
    detail: { host: e.host.slice(0, 253), port: e.port, reason: e.reason, why: REFUSAL_WORDS[e.reason] },
  }).catch((err: unknown) => log?.("engine egress audit failed", { code: String((err as { code?: unknown } | null)?.code ?? "") }));
}

/** What a turn reached and what it was refused: the sampled reports of its person and thread while it ran. Hosts reached are distinct and in the order first seen, at most 20. */
export function egressOfTurn(db: Db, t: { threadId: string; person: string; from: number; to: number }): { reached: string[]; refused: Array<{ host: string; port: number; reason: EgressEvent["reason"] }> } {
  ensure(db);
  const rows = db.all("SELECT host, port, verdict, reason FROM engine_egress WHERE thread_id = ? AND person = ? AND at >= ? AND at <= ? ORDER BY at ASC LIMIT 400", t.threadId, t.person, t.from, t.to) as Array<{ host: string; port: number; verdict: string; reason: string }>;
  const reached: string[] = [];
  const refused: Array<{ host: string; port: number; reason: EgressEvent["reason"] }> = [];
  const denied = new Set<string>();
  for (const r of rows) {
    if (r.verdict === "allow") { if (!reached.includes(r.host) && reached.length < 20) reached.push(r.host); }
    else if (r.reason !== "unreachable" && r.reason !== "busy" && !denied.has(`${r.host}:${r.port}`) && refused.length < 20) { denied.add(`${r.host}:${r.port}`); refused.push({ host: r.host, port: r.port, reason: r.reason as EgressEvent["reason"] }); }
  }
  return { reached, refused };
}
