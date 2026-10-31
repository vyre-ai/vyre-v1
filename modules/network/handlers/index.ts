// Capability handlers for network (spec Networking, ARCH 5.9, 7.10). Reads come from status.ts; every change is written to the module's
// tables and queued in network_command for the host daemon, which owns Caddy, DNS and the relay connection.

import { asRow, certs, endpoints, failWith, healthProbe, hostnames, ingress, phoneOf, queue, readConfig, servers, statusOf, JOIN_CODE_MS } from "./status.ts";
import type { Mode, NetworkCtx } from "./status.ts";
import { approve, approveMine, decline, declineMine, enroll, enrollStatus, makeJoinCode, mine, revoke } from "./enroll.ts";

export type { NetworkCtx } from "./status.ts";

const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type In = Record<string, unknown>;

export async function status(ctx: NetworkCtx, _input: In) { return statusOf(ctx); }
export async function publicHostnames(ctx: NetworkCtx, _input: In) { return { hosts: hostnames(ctx) }; }
export async function ingressCheck(ctx: NetworkCtx, _input: In) { return ingress(ctx); }
export async function endpointList(ctx: NetworkCtx, _input: In) { return { endpoints: endpoints(ctx) }; }
export async function serverList(ctx: NetworkCtx, _input: In) { return { servers: servers(ctx) }; }

export async function health(ctx: NetworkCtx, _input: In) {
  const out: { state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number; daysToExpiry?: number } = healthProbe(ctx);
  const relay = endpoints(ctx).find((e) => e.kind === "relay");
  if (relay?.rttMs !== undefined) out.latencyMs = relay.rttMs;
  return out;
}

/** Set an own domain. The host's DNS check decides; only a passing check changes the address. */
export async function domainSet(ctx: NetworkCtx, input: { domain: string }) {
  const domain = input.domain.trim().toLowerCase();
  if (!DOMAIN.test(domain)) return failWith(ctx.trace.traceId, "validation.bad_input", "That is not a domain name.", { field: "domain" });
  const cfg = readConfig(ctx);
  const dns = asRow(ctx.db.all("SELECT ok, records_json FROM network_dns WHERE domain = ?", domain)[0]);
  let records: { type: string; name: string; value: string }[] = [];
  if (dns && typeof dns["records_json"] === "string") {
    try {
      const parsed = JSON.parse(dns["records_json"]) as unknown;
      if (Array.isArray(parsed)) for (const p of parsed) { const r = asRow(p); if (r && typeof r["type"] === "string" && typeof r["name"] === "string" && typeof r["value"] === "string") records.push({ type: r["type"], name: r["name"], value: r["value"] }); }
    } catch { records = []; }
  } else if (cfg?.relayAddress) records = [{ type: "CNAME", name: domain, value: cfg.relayAddress }];
  queue(ctx, "set_domain", domain);
  const dnsOk = dns?.["ok"] === 1;
  return { dnsOk, records };
}

/** Switch between the own domain and the relay. Devices pin the Space key, so nothing needs a new invite. */
export async function relaySet(ctx: NetworkCtx, input: { mode: Mode }) {
  const cfg = readConfig(ctx);
  if (!cfg) return failWith(ctx.trace.traceId, "validation.precondition_failed", "The server has not reported its address yet.");
  const address = input.mode === "relay" ? cfg.relayAddress : cfg.domain;
  if (!address) {
    return failWith(ctx.trace.traceId, "validation.precondition_failed", input.mode === "relay" ? "This Space has no relay address yet." : "Set an own domain first.", { mode: input.mode });
  }
  if (cfg.mode !== input.mode) {
    queue(ctx, "set_mode", input.mode);
  }
  return { address };
}

export async function certificateRenew(ctx: NetworkCtx, input: { host: string }) {
  const cert = certs(ctx).find((c) => c.host === input.host);
  if (!cert) return failWith(ctx.trace.traceId, "validation.not_found", "No certificate is known for that host.", { host: input.host });
  queue(ctx, "renew", input.host);
  return { state: cert.state };
}

export async function serverJoinCode(ctx: NetworkCtx, _input: In) { return makeJoinCode(ctx, "space"); }
export async function myComputerCode(ctx: NetworkCtx, input: In) {
  const made = makeJoinCode(ctx, "personal", typeof input["nickname"] === "string" ? input["nickname"] : undefined);
  const address = readConfig(ctx)?.address;
  return { ...made, ...(address ? { address } : {}) };
}

/** What a person sees of the computers they added. The facts (what runs there) and the fingerprint are what they compare before approving. */
export async function myComputers(ctx: NetworkCtx, _input: In) {
  return { computers: mine(ctx, servers(ctx)).map((s) => ({ serverId: s.serverId, name: s.name, state: s.state, enrollment: s.enrollment ?? "approved", ...(s.fingerprint ? { fingerprint: s.fingerprint } : {}), ...(s.lastSeenAt !== undefined ? { lastSeenAt: s.lastSeenAt } : {}), ...(s.requestedAt !== undefined ? { requestedAt: s.requestedAt } : {}), ...(s.facts ? { facts: s.facts } : {}) })) };
}

export async function myComputerRemove(ctx: NetworkCtx, input: { serverId: string }) {
  if (!mine(ctx, servers(ctx)).some((s) => s.serverId === input.serverId)) return failWith(ctx.trace.traceId, "validation.not_found", "That computer is not yours.", { serverId: input.serverId });
  revoke(ctx, input.serverId);
  return { removed: true };
}

/** A name for the phone address: letters, digits and single dashes, three to 32 characters, starting with a letter. The relay and the names directory apply their own, stricter rules. */
const PHONE_NAME = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const PHONE_INFRA = new Set(["names", "app", "api", "www", "relay", "acme", "mail", "docs", "status", "web", "reports", "escrow", "edge", "vyre", "phone", "setup"]);

export async function phone(ctx: NetworkCtx, _input: In) { return phoneOf(ctx); }

/** Claim <name>.vyre.run for this computer. The host does it over its relay link and writes the outcome to network_phone; the phone read shows "claiming" until it has. */
export async function phoneClaim(ctx: NetworkCtx, input: { name: string; nickname?: string }) {
  const name = String(input.name ?? "").trim().toLowerCase().replace(/\.vyre\.run$/, "");
  if (!PHONE_NAME.test(name) || PHONE_INFRA.has(name)) {
    return failWith(ctx.trace.traceId, "validation.bad_input", "Choose a name of letters, digits and dashes, three to 32 characters, starting with a letter.", { field: "name" });
  }
  const held = phoneOf(ctx);
  if (held.state === "claimed" && held.name !== name) return failWith(ctx.trace.traceId, "validation.precondition_failed", "This computer already has a phone address. Release it first.", { name: held.name });
  const nickname = typeof input.nickname === "string" ? input.nickname.trim().slice(0, 40) : "";
  const key = asRow(ctx.db.all("SELECT box_key FROM network_phone WHERE id = 1")[0])?.["box_key"];
  ctx.db.run("INSERT OR REPLACE INTO network_phone (id, name, nickname, state, detail, box_key, reported_at) VALUES (1, ?, ?, 'claiming', ?, ?, ?)", name, nickname || null, null, typeof key === "string" ? key : null, ctx.now());
  queue(ctx, "phone_claim", JSON.stringify({ name, nickname }));
  return { state: "claiming" as const };
}

/** Give the phone address up. The name stays reserved to this computer: nobody else gets it. */
export async function phoneRelease(ctx: NetworkCtx, _input: In) {
  const held = phoneOf(ctx);
  if (held.state === "none") return { state: "none" as const };
  ctx.db.run("UPDATE network_phone SET state = 'releasing', detail = ?, reported_at = ? WHERE id = 1", null, ctx.now());
  queue(ctx, "phone_release", held.name ?? "");
  return { state: "releasing" as const };
}

export async function serverReconnect(ctx: NetworkCtx, input: { serverId: string }) {
  const s = servers(ctx).find((x) => x.serverId === input.serverId);
  if (!s) return failWith(ctx.trace.traceId, "validation.not_found", "That server is not in this Space.", { serverId: input.serverId });
  queue(ctx, "reconnect", input.serverId);
  return { state: s.state };
}

export async function serverRemove(ctx: NetworkCtx, input: { serverId: string }) {
  const s = servers(ctx).find((x) => x.serverId === input.serverId);
  if (!s) return { removed: false };
  if (s.role === "space") return failWith(ctx.trace.traceId, "validation.precondition_failed", "The Space server cannot be removed.", { serverId: input.serverId });
  // a computer that joined for compute is taken out here and now: its credential stops working at once
  revoke(ctx, input.serverId);
  return { removed: true };
}

export const handlers = {
  "network.status": status,
  "network.domain_set": domainSet,
  "network.relay_set": relaySet,
  "network.certificate_renew": certificateRenew,
  "network.public_hostnames": publicHostnames,
  "network.ingress_check": ingressCheck,
  "network.endpoints": endpointList,
  "network.servers": serverList,
  "network.server_join_code": serverJoinCode,
  "network.my_computer_code": myComputerCode,
  "network.enroll": enroll,
  "network.enroll_status": enrollStatus,
  "network.server_approve": approve,
  "network.server_decline": decline,
  "network.my_computers": myComputers,
  "network.my_computer_remove": myComputerRemove,
  "network.my_computer_approve": approveMine,
  "network.my_computer_decline": declineMine,
  "network.phone": phone,
  "network.phone_claim": phoneClaim,
  "network.phone_release": phoneRelease,
  "network.server_reconnect": serverReconnect,
  "network.server_remove": serverRemove,
  "network.health": health,
};
