// Capability handlers for network (spec Networking, ARCH 5.9, 7.10). Reads come from status.ts; every change is written to the module's
// tables and queued in network_command for the host daemon, which owns Caddy, DNS and the relay connection.

import { asRow, certs, endpoints, failWith, healthProbe, hostnames, ingress, queue, readConfig, servers, statusOf, JOIN_CODE_MS } from "./status.ts";
import type { Mode, NetworkCtx } from "./status.ts";

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

export async function serverJoinCode(ctx: NetworkCtx, _input: In) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  const ch = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  const code = `VYRE-${ch.slice(0, 4)}-${ch.slice(4)}`;
  const expiresAt = ctx.now() + JOIN_CODE_MS;
  ctx.db.run("INSERT INTO network_join (code, by_principal, expires_at) VALUES (?, ?, ?)", code, ctx.principal.id, expiresAt);
  return { code, expiresAt };
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
  queue(ctx, "remove", input.serverId);
  return { removed: false };
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
  "network.server_reconnect": serverReconnect,
  "network.server_remove": serverRemove,
  "network.health": health,
};
