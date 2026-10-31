// The two queues the Console writes for the daemon (rows in the module tables, because a module only has ctx.db):
//   health_restart   a person asked to restart a service      -> the supervisor restarts it, the row gets done_at
//   network_command  set_domain, set_mode, renew, reconnect, remove, phone_claim, phone_release -> the NetworkPort does it, the result lands in network_dns / network_cert / network_server / network_config
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
  /** Observe a managed local HTTPS certificate without requesting another change. */
  certificate?(host: string): Promise<{ expiresAt: number | null; reason?: string }>;
}

/** The phone address (<name>.vyre.run) over the relay link. `claim` brings the link up when it is not (a computer with no relay configured dials the public one for this). */
export interface PhonePort {
  claim(name: string, nickname: string): Promise<{ status: string; boxKey?: string }>;
  release(): Promise<{ status: string }>;
}
/** What a person is told for each answer the relay gives to a claim. */
const PHONE_SAY: Record<string, string> = {
  taken: "That name is taken. Try another.",
  reserved: "That name is reserved. Try another.",
  invalid: "That name cannot be used. Use letters, digits and dashes.",
  has_name: "This computer already has a phone address. Release it first.",
  limited: "Too many tries today. Try again tomorrow.",
  unavailable: "Could not reach the relay. Check the connection and try again.",
};

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
  /** Phone access; absent where the daemon has no relay to dial (tests, a build without one) */
  phone?: PhonePort | undefined;
  now: () => number;
  log?: Logger | undefined;
  observed?(event: { id: string; type: 'network.domain_changed' | 'network.server_removed' | 'network.certificate_renewed'; actor: string; target: string; payload: Record<string, unknown> }): Promise<void>;
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
  for (const raw of d.db.all("SELECT id, kind, target, by_principal FROM network_command WHERE done_at IS NULL ORDER BY at, id")) {
    const r = row(raw);
    const id = r["id"] as number, kind = text(r["kind"]), target = text(r["target"]);
    let state = 'applied';
    let detail: string | null = null;
    try {
      state = (await runNetwork(d, kind, target)) ?? 'applied';
      if (state === 'applied' && d.observed) {
        const identity = { id: `evt_network_command_${id}`, actor: text(r['by_principal']), target };
        if (kind === 'set_domain' || kind === 'set_mode') {
          const cfg = row(d.db.all("SELECT address, mode FROM network_config WHERE id = 1")[0]);
          await d.observed({ ...identity, type: 'network.domain_changed', target: text(cfg['address']), payload: { address: text(cfg['address']), mode: text(cfg['mode']) } });
        } else if (kind === 'remove') await d.observed({ ...identity, type: 'network.server_removed', payload: { serverId: target } });
        else if (kind === 'renew') {
          const certificate = row(d.db.all("SELECT expires_at FROM network_cert WHERE host = ?", target)[0]);
          await d.observed({ ...identity, type: 'network.certificate_renewed', payload: { host: target, expiresAt: certificate['expires_at'] } });
        }
      }
    }
    catch (e) {
      state = 'failed';
      // Driver errors may contain configuration. Only this fixed guidance is public.
      detail = 'The host could not complete this network change. Check server logs and retry.';
      d.log?.error("command.network_failed", { kind, target, error: e instanceof Error ? e.message : String(e) });
    }
    d.db.run("INSERT OR REPLACE INTO network_result (id, kind, target, state, detail, at) VALUES (?, ?, ?, ?, ?, ?)", id, kind, target, state, detail, d.now());
    d.db.run("DELETE FROM network_result WHERE id NOT IN (SELECT id FROM network_result ORDER BY at DESC, id DESC LIMIT 100)");
    d.db.run("UPDATE network_command SET done_at = ? WHERE id = ?", d.now(), id);
    n++;
  }
  return n;
}

async function runNetwork(d: CommandDeps, kind: string, target: string): Promise<"pending" | void> {
  const t = d.now();
  switch (kind) {
    case "set_domain": {
      const cfg = row(d.db.all("SELECT relay_address FROM network_config WHERE id = 1")[0]);
      const r = await d.network.checkDns(target, text(cfg["relay_address"]) || null);
      d.db.run(
        "INSERT INTO network_dns (domain, ok, records_json, checked_at) VALUES (?, ?, ?, ?) ON CONFLICT(domain) DO UPDATE SET ok = excluded.ok, records_json = excluded.records_json, checked_at = excluded.checked_at",
        target, r.ok ? 1 : 0, JSON.stringify(r.records), t,
      );
      if (!r.ok) throw new Error('DNS verification failed.');
      if (r.ok) {
        await d.network.applyAddress({ mode: "own_domain", address: target });
        // Only acknowledge the new address after the driver accepted it. DNS alone
        // does not establish that the host has installed the ingress route.
        d.db.run("UPDATE network_config SET address = ?, mode = 'own_domain', domain = ?, reported_at = ? WHERE id = 1", target, target, d.now());
      }
      return;
    }
    case "set_mode": {
      const mode = target === "relay" ? "relay" : "own_domain";
      const cfg = row(d.db.all("SELECT address, domain, relay_address FROM network_config WHERE id = 1")[0]);
      const address = text(cfg[mode === 'relay' ? 'relay_address' : 'domain']);
      if (!address) throw new Error('No address is configured for this mode.');
      await d.network.applyAddress({ mode, address });
      d.db.run("UPDATE network_config SET address = ?, mode = ?, reported_at = ? WHERE id = 1", address, mode, d.now());
      return;
    }
    case "renew": {
      const r = await d.network.renew(target);
      d.db.run(
        "INSERT INTO network_cert (host, expires_at, reason, reported_at) VALUES (?, ?, ?, ?) ON CONFLICT(host) DO UPDATE SET expires_at = COALESCE(excluded.expires_at, network_cert.expires_at), reason = excluded.reason, reported_at = excluded.reported_at",
        target, r.expiresAt, r.reason ?? null, t,
      );
      if (r.expiresAt === null) return 'pending';
      return;
    }
    case "reconnect": {
      const state = await d.network.reconnect(target);
      if (!state) throw new Error('No server connection manager answered this reconnect.');
      if (state) d.db.run("UPDATE network_server SET state = ?, heartbeat_at = ? WHERE server_id = ?", state, state === "down" ? int(row(d.db.all("SELECT heartbeat_at FROM network_server WHERE server_id = ?", target)[0])["heartbeat_at"]) : t, target);
      return;
    }
    case "remove":
      await d.network.disconnect(target);
      d.db.run("DELETE FROM network_server WHERE server_id = ?", target);
      return;
    case "phone_claim": {
      let ask: { name?: unknown; nickname?: unknown } = {};
      try { ask = JSON.parse(target) as typeof ask; } catch { /* closed below */ }
      const name = text(ask.name), nickname = text(ask.nickname);
      const set = (state: string, detail: string | null, key?: string): void => {
        d.db.run("UPDATE network_phone SET state = ?, detail = ?, box_key = COALESCE(?, box_key), reported_at = ? WHERE id = 1", state, detail, key ?? null, t);
      };
      if (!name) { set("failed", PHONE_SAY["invalid"] ?? null); return; }
      if (!d.phone) { set("failed", "Phone access is not available on this computer."); return; }
      const r = await d.phone.claim(name, nickname);
      if (r.status === "claimed") set("claimed", null, r.boxKey);
      else set("failed", PHONE_SAY[r.status] ?? PHONE_SAY["unavailable"] ?? null);
      return;
    }
    case "phone_release": {
      if (!d.phone) { d.db.run("UPDATE network_phone SET state = 'none', name = NULL, detail = NULL, reported_at = ? WHERE id = 1", t); return; }
      const r = await d.phone.release();
      if (r.status === "released" || r.status === "none") d.db.run("UPDATE network_phone SET state = 'none', name = NULL, detail = NULL, reported_at = ? WHERE id = 1", t);
      else d.db.run("UPDATE network_phone SET state = 'claimed', detail = ?, reported_at = ? WHERE id = 1", PHONE_SAY["unavailable"] ?? null, t);
      return;
    }
    default:
      throw new Error(`unknown network command ${kind}`);
  }
}
