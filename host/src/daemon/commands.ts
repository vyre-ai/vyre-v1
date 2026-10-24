// The two queues the Console writes for the daemon (rows in the module tables, because a module only has ctx.db):
//   health_restart   a person asked to restart a service      -> the supervisor restarts it, the row gets done_at
//   network_command  set_domain, set_mode, renew, reconnect, remove -> the NetworkPort does it, the result lands in network_dns / network_cert / network_server / network_config
// `pollCommands` runs every second from the scheduler. A command that fails is logged and closed (done_at set) so it never loops; the Console reads the state tables, not the queue.
import dns from "node:dns/promises";
import type { Logger } from "../../../packages/contracts/src/ctx.ts";
import type { Supervisor } from "../supervisor/index.ts";
import type { HostDb } from "./sqlite.ts";

export interface DnsRecord { type: string; name: string; value: string }
export type ServerState = "healthy" | "degraded" | "down";

/** What the host can do about the network. The default (`defaultNetworkPort`) checks DNS and records state; the Caddy driver (P-L7b_04) and the connection manager supply the rest. */
export interface NetworkPort {
  /** Does `domain` point at this Space? `expected` is the relay address the CNAME should name, when there is one. */
  checkDns(domain: string, expected: string | null): Promise<{ ok: boolean; records: DnsRecord[] }>;
  /** Make `address` the Space's address in Caddy / the relay. */
  applyAddress(a: { mode: "own_domain" | "relay"; address: string }): Promise<void>;
  /** Issue or renew the certificate for `host`. expiresAt is null when nothing issued it. */
  renew(host: string): Promise<{ expiresAt: number | null; reason?: string }>;
  reconnect(serverId: string): Promise<ServerState | null>;
  disconnect(serverId: string): Promise<void>;
}

export interface Resolver {
  cname(domain: string): Promise<string[]>;
  address(domain: string): Promise<string[]>;
}
export const systemResolver: Resolver = {
  cname: (d) => dns.resolveCname(d).catch(() => []),
  address: (d) => dns.resolve4(d).catch(() => []),
};
const bare = (h: string): string => h.trim().toLowerCase().replace(/\.$/, "");

export function defaultNetworkPort(o: { resolver?: Resolver } = {}): NetworkPort {
  const resolver = o.resolver ?? systemResolver;
  return {
    async checkDns(domain, expected) {
      const records: DnsRecord[] = expected ? [{ type: "CNAME", name: domain, value: expected }] : [];
      if (expected) {
        const names = (await resolver.cname(domain)).map(bare);
        if (names.includes(bare(expected))) return { ok: true, records };
        // an A record that equals the relay's addresses is as good as the CNAME
        const [mine, theirs] = await Promise.all([resolver.address(domain), resolver.address(expected)]);
        return { ok: mine.length > 0 && mine.every((a) => theirs.includes(a)), records };
      }
      return { ok: (await resolver.address(domain)).length > 0, records };
    },
    applyAddress: () => Promise.resolve(),
    renew: () => Promise.resolve({ expiresAt: null, reason: "No certificate manager is connected to this host." }),
    reconnect: () => Promise.resolve(null),
    disconnect: () => Promise.resolve(),
  };
}

export interface CommandDeps {
  db: HostDb;
  supervisor: Supervisor;
  network: NetworkPort;
  now: () => number;
  log?: Logger | undefined;
}

type Row = Record<string, unknown>;
const row = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Do every open restart and network command. Returns how many ran. */
export async function pollCommands(d: CommandDeps): Promise<number> {
  let n = 0;
  for (const raw of d.db.all("SELECT id, service FROM health_restart WHERE done_at IS NULL ORDER BY at, id")) {
    const r = row(raw);
    const id = text(r["id"]), service = text(r["service"]);
    try {
      if (d.supervisor.has(service)) await d.supervisor.restart(service);
      else d.log?.warn("command.restart_unknown_service", { service });
    } catch (e) {
      d.log?.error("command.restart_failed", { service, error: e instanceof Error ? e.message : String(e) });
    }
    d.db.run("UPDATE health_restart SET done_at = ? WHERE id = ?", d.now(), id);
    n++;
  }
  for (const raw of d.db.all("SELECT id, kind, target FROM network_command WHERE done_at IS NULL ORDER BY at, id")) {
    const r = row(raw);
    const id = r["id"] as number, kind = text(r["kind"]), target = text(r["target"]);
    try { await runNetwork(d, kind, target); }
    catch (e) { d.log?.error("command.network_failed", { kind, target, error: e instanceof Error ? e.message : String(e) }); }
    d.db.run("UPDATE network_command SET done_at = ? WHERE id = ?", d.now(), id);
    n++;
  }
  return n;
}

async function runNetwork(d: CommandDeps, kind: string, target: string): Promise<void> {
  const t = d.now();
  switch (kind) {
    case "set_domain": {
      const cfg = row(d.db.all("SELECT relay_address FROM network_config WHERE id = 1")[0]);
      const r = await d.network.checkDns(target, text(cfg["relay_address"]) || null);
      d.db.run(
        "INSERT INTO network_dns (domain, ok, records_json, checked_at) VALUES (?, ?, ?, ?) ON CONFLICT(domain) DO UPDATE SET ok = excluded.ok, records_json = excluded.records_json, checked_at = excluded.checked_at",
        target, r.ok ? 1 : 0, JSON.stringify(r.records), t,
      );
      if (r.ok) await d.network.applyAddress({ mode: "own_domain", address: target });
      return;
    }
    case "set_mode": {
      const mode = target === "relay" ? "relay" : "own_domain";
      const cfg = row(d.db.all("SELECT address FROM network_config WHERE id = 1")[0]);
      const address = text(cfg["address"]);
      if (address) await d.network.applyAddress({ mode, address });
      return;
    }
    case "renew": {
      const r = await d.network.renew(target);
      d.db.run(
        "INSERT INTO network_cert (host, expires_at, reason, reported_at) VALUES (?, ?, ?, ?) ON CONFLICT(host) DO UPDATE SET expires_at = COALESCE(excluded.expires_at, network_cert.expires_at), reason = excluded.reason, reported_at = excluded.reported_at",
        target, r.expiresAt, r.reason ?? null, t,
      );
      return;
    }
    case "reconnect": {
      const state = await d.network.reconnect(target);
      if (state) d.db.run("UPDATE network_server SET state = ?, heartbeat_at = ? WHERE server_id = ?", state, state === "down" ? int(row(d.db.all("SELECT heartbeat_at FROM network_server WHERE server_id = ?", target)[0])["heartbeat_at"]) : t, target);
      return;
    }
    case "remove":
      await d.network.disconnect(target);
      d.db.run("DELETE FROM network_server WHERE server_id = ?", target);
      return;
    default:
      throw new Error(`unknown network command ${kind}`);
  }
}
