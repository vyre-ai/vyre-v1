// Network state (spec Networking, ARCH 5.9, 7.10). The host daemon reports the address, certificates, servers and endpoints into network_*;
// this file turns those reports into what Console shows. A heartbeat that stops makes a server or endpoint degraded, then down, however
// it last described itself: the list never shows a green row for something that went quiet.

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";

export type NetworkCtx = Pick<Ctx, "space" | "principal" | "actingFor" | "trace" | "now" | "db" | "emit" | "call">;
export type State = "healthy" | "degraded" | "down";
export type Mode = "own_domain" | "relay";

export const DAY_MS = 86_400_000;
/** No heartbeat for this long: degraded. */
export const HEARTBEAT_DEGRADED_MS = 60_000;
/** No heartbeat for this long: down. */
export const HEARTBEAT_DOWN_MS = 180_000;
/** A certificate with fewer days left is degraded; under one day it is down (the manifest rule for network.certificate). */
export const CERT_DEGRADED_DAYS = 14;
export const CERT_DOWN_DAYS = 1;
export const JOIN_CODE_MS = 10 * 60_000;

const RANK: Record<State, number> = { healthy: 0, degraded: 1, down: 2 };
export const worst = (a: State, b: State): State => (RANK[a] >= RANK[b] ? a : b);
export const isState = (v: unknown): v is State => v === "healthy" || v === "degraded" || v === "down";

const NEXT_LABEL: Record<NextStep["kind"], string> = {
  retry: "Try again", switch_model: "Use another model", use_backup_key: "Use the backup key", ask_access: "Ask for access",
  open_settings: "Open settings", reconnect: "Reconnect", edit_input: "Change what you sent", wait: "Wait a moment",
  contact_admin: "Contact an admin", report: "Report a problem",
};

export function failWith(traceId: string, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = { code: def.code, message: message ?? def.what, retryable: def.retryable, traceId, next: def.next.map((kind) => ({ kind, label: NEXT_LABEL[kind] })) };
  if (details) error.details = details;
  throw new VyreErr(error);
}

export type Row = Record<string, unknown>;
export const asRow = (v: unknown): Row | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The state a heartbeat allows: silence beats whatever the thing last said about itself. */
export function believed(reported: State, heartbeatAt: number | undefined, now: number): State {
  if (heartbeatAt === undefined) return "down";
  const age = now - heartbeatAt;
  if (age > HEARTBEAT_DOWN_MS) return "down";
  if (age > HEARTBEAT_DEGRADED_MS) return worst(reported, "degraded");
  return reported;
}

export interface Config { address: string; mode: Mode; domain?: string; relayAddress?: string; publicIngress: boolean; ingressDetail?: string }

export function readConfig(ctx: NetworkCtx): Config | null {
  const r = asRow(ctx.db.all("SELECT address, mode, domain, relay_address, public_ingress, ingress_detail FROM network_config WHERE id = ?", 1)[0]);
  const address = r ? str(r["address"]) : undefined;
  if (!r || address === undefined) return null;
  const c: Config = { address, mode: r["mode"] === "own_domain" ? "own_domain" : "relay", publicIngress: r["public_ingress"] === 1 };
  const domain = str(r["domain"]), relay = str(r["relay_address"]), detail = str(r["ingress_detail"]);
  if (domain) c.domain = domain;
  if (relay) c.relayAddress = relay;
  if (detail) c.ingressDetail = detail;
  return c;
}

export function writeConfig(ctx: NetworkCtx, c: Config): void {
  ctx.db.run(
    "INSERT OR REPLACE INTO network_config (id, address, mode, domain, relay_address, public_ingress, ingress_detail, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    1, c.address, c.mode, c.domain ?? null, c.relayAddress ?? null, c.publicIngress ? 1 : 0, c.ingressDetail ?? null, ctx.now(),
  );
}

export interface Cert { host: string; expiresAt?: number; state: State; reason?: string; daysToExpiry?: number }

/** Certificate state from the expiry the host reported: under 14 days degraded, under 1 day or a failure with nothing issued down, none yet degraded. */
export function certOf(row: Row, now: number): Cert | null {
  const host = str(row["host"]);
  if (!host) return null;
  const c: Cert = { host, state: "healthy" };
  const exp = num(row["expires_at"]);
  const reason = str(row["reason"]);
  if (reason) c.reason = reason;
  if (exp === undefined) c.state = reason ? "down" : "degraded";
  else {
    c.expiresAt = exp;
    const days = (exp - now) / DAY_MS;
    c.daysToExpiry = Math.floor(days);
    c.state = days < CERT_DOWN_DAYS ? "down" : days < CERT_DEGRADED_DAYS ? "degraded" : "healthy";
    if (reason) c.state = worst(c.state, "degraded");
  }
  return c;
}

export function certs(ctx: NetworkCtx): Cert[] {
  const out: Cert[] = [];
  for (const raw of ctx.db.all("SELECT host, expires_at, reason FROM network_cert ORDER BY host")) {
    const r = asRow(raw);
    const c = r ? certOf(r, ctx.now()) : null;
    if (c) out.push(c);
  }
  return out;
}

export function statusOf(ctx: NetworkCtx) {
  const cfg = readConfig(ctx);
  const host = cfg?.address ?? "";
  const cert = certs(ctx).find((c) => c.host === host);
  const certificate: { host: string; expiresAt?: number; state: State } = { host, state: cert?.state ?? "degraded" };
  if (cert?.expiresAt !== undefined) certificate.expiresAt = cert.expiresAt;
  const commands = ctx.db.all("SELECT kind, target, state, detail, at FROM network_result ORDER BY at DESC, id DESC LIMIT 10").map((raw) => {
    const row = asRow(raw)!;
    return { kind: String(row["kind"]), target: String(row["target"]), state: row["state"] as "pending" | "applied" | "failed", at: Number(row["at"]), ...(typeof row["detail"] === "string" ? { detail: row["detail"] } : {}) };
  });
  const pending = ctx.db.all("SELECT kind, target, at FROM network_command WHERE done_at IS NULL ORDER BY at DESC, id DESC LIMIT 10").map((raw) => {
    const row = asRow(raw)!;
    return { kind: String(row['kind']), target: String(row['target']), state: 'pending' as const, at: Number(row['at']) };
  });
  const recent = [...pending, ...commands].sort((a, b) => b.at - a.at).slice(0, 10);
  return { address: host, mode: cfg?.mode ?? "relay", certificate, publicIngress: cfg?.publicIngress ?? false, commands: recent };
}

export function hostnames(ctx: NetworkCtx) {
  const byHost = new Map(certs(ctx).map((c) => [c.host, c.state] as const));
  const out: { host: string; kind: "app" | "console" | "site" | "form" | "booking" | "hook"; certificate: State }[] = [];
  for (const raw of ctx.db.all("SELECT host, kind FROM network_host ORDER BY host")) {
    const r = asRow(raw);
    const host = r ? str(r["host"]) : undefined;
    const kind = r?.["kind"];
    if (host && (kind === "app" || kind === "console" || kind === "site" || kind === "form" || kind === "booking" || kind === "hook")) out.push({ host, kind, certificate: byHost.get(host) ?? "degraded" });
  }
  return out;
}

export function ingress(ctx: NetworkCtx): { reachable: boolean; detail?: string } {
  const cfg = readConfig(ctx);
  if (!cfg) return { reachable: false, detail: "The host has not reported its address yet." };
  const out: { reachable: boolean; detail?: string } = { reachable: cfg.publicIngress };
  if (cfg.ingressDetail) out.detail = cfg.ingressDetail;
  else if (!cfg.publicIngress) out.detail = "Forms and webhooks cannot reach this Space from outside.";
  return out;
}

const ORDER: Record<string, number> = { direct: 0, relay: 1, tunnel: 2 };
type EndpointKind = "direct" | "relay" | "tunnel";
export interface EndpointRow { kind: EndpointKind; url: string; health: State; rttMs?: number }

/** Endpoints for the connection manager, direct first. Health follows the heartbeat, so a dead direct path reads down and the relay row carries the failover. */
export function endpoints(ctx: NetworkCtx): EndpointRow[] {
  const out: EndpointRow[] = [];
  for (const raw of ctx.db.all("SELECT kind, url, state, rtt_ms, heartbeat_at FROM network_endpoint ORDER BY kind, url")) {
    const r = asRow(raw);
    const kind = r?.["kind"], url = r ? str(r["url"]) : undefined;
    if (!r || !url || (kind !== "direct" && kind !== "relay" && kind !== "tunnel")) continue;
    const e: EndpointRow = { kind, url, health: believed(isState(r["state"]) ? r["state"] : "down", num(r["heartbeat_at"]), ctx.now()) };
    const rtt = num(r["rtt_ms"]);
    if (rtt !== undefined) e.rttMs = Math.trunc(rtt);
    out.push(e);
  }
  return out.sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9));
}

export interface ServerRow { serverId: string; name: string; state: State; role: "space" | "compute"; lastSeenAt?: number }

export function servers(ctx: NetworkCtx): ServerRow[] {
  const out: ServerRow[] = [];
  for (const raw of ctx.db.all("SELECT server_id, name, role, state, heartbeat_at FROM network_server ORDER BY name, server_id")) {
    const r = asRow(raw);
    const serverId = r ? str(r["server_id"]) : undefined, name = r ? str(r["name"]) : undefined;
    if (!r || !serverId || !name) continue;
    const beat = num(r["heartbeat_at"]);
    const s: ServerRow = { serverId, name, role: r["role"] === "space" ? "space" : "compute", state: believed(isState(r["state"]) ? r["state"] : "down", beat, ctx.now()) };
    if (beat !== undefined) s.lastSeenAt = beat;
    out.push(s);
  }
  return out;
}

/** The probe behind both manifest health checks: certificate expiry and relay reachability. */
export function healthProbe(ctx: NetworkCtx): { state: State; detail?: string; daysToExpiry?: number } {
  const cfg = readConfig(ctx);
  if (!cfg) return { state: "degraded", detail: "The host has not reported its address yet." };
  const cert = certs(ctx).find((c) => c.host === cfg.address);
  const relay = endpoints(ctx).find((e) => e.kind === "relay");
  let state: State = cert?.state ?? "degraded";
  let detail: string | undefined = cert ? (cert.state === "healthy" ? undefined : cert.reason ?? `The certificate for ${cert.host} expires in ${cert.daysToExpiry} days.`) : `No certificate reported for ${cfg.address}.`;
  if (cfg.mode === "relay" && (!relay || relay.health !== "healthy")) {
    state = worst(state, relay ? relay.health : "degraded");
    detail = detail ?? (relay ? "The relay is not answering." : "No relay endpoint reported.");
  }
  const out: { state: State; detail?: string; daysToExpiry?: number } = { state };
  if (detail) out.detail = detail;
  if (cert?.daysToExpiry !== undefined) out.daysToExpiry = cert.daysToExpiry;
  return out;
}

export function queue(ctx: NetworkCtx, kind: string, target: string): void {
  ctx.db.run("INSERT INTO network_command (kind, target, by_principal, at, done_at) VALUES (?, ?, ?, ?, ?)", kind, target, ctx.principal.id, ctx.now(), null);
}
