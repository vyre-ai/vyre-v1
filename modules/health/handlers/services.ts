// Server services and the support bundle (spec 4.18, 3.10; ARCH 7.10).
// The supervisor in the host daemon keeps health_service up to date. A restart asked for in Console is written to health_restart,
// which the supervisor reads, and the service row shows the restart at once: a new start time and one more restart.
// The support bundle holds ids, versions, health, services and log metadata. It never holds content.

import type { CapName } from "../../../packages/contracts/src/types.ts";
import { asRow, failWith, isState, mint, pausedOf, statusOf } from "./checks.ts";
import type { HealthCtx, State } from "./checks.ts";

export interface ServiceRow { name: string; state: State; uptimeSeconds: number; restarts: number }

/** Bundles hold at most this many traces. */
export const BUNDLE_TRACES = 10;
/** And this many recent warn and error log rows. */
export const BUNDLE_RECENT = 100;

function int(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0;
}

/** Every service with its state, how long it has been up, and how often it restarted. */
export function listServices(ctx: HealthCtx): ServiceRow[] {
  const now = ctx.now();
  const out: ServiceRow[] = [];
  for (const raw of ctx.db.all("SELECT name, state, started_at, restarts FROM health_service ORDER BY name")) {
    const r = asRow(raw);
    if (!r || typeof r["name"] !== "string" || !isState(r["state"])) continue;
    out.push({ name: r["name"], state: r["state"], uptimeSeconds: Math.max(0, Math.floor((now - int(r["started_at"])) / 1000)), restarts: int(r["restarts"]) });
  }
  return out;
}

/** Called by the supervisor (or a test) to publish a service's state. */
export function reportService(ctx: Pick<HealthCtx, "db" | "now">, name: string, p: { state: State; startedAt?: number; restarts?: number }): void {
  const had = asRow(ctx.db.all("SELECT started_at, restarts FROM health_service WHERE name = ?", name)[0]);
  ctx.db.run(
    "INSERT OR REPLACE INTO health_service (name, state, started_at, restarts) VALUES (?, ?, ?, ?)",
    name, p.state, p.startedAt ?? (had ? int(had["started_at"]) : ctx.now()), p.restarts ?? (had ? int(had["restarts"]) : 0),
  );
}

/** Ask the supervisor to restart a service. The queue row is the durable ask; the service row shows the restart now. */
export function restartService(ctx: HealthCtx, input: { service: string }): { state: State } {
  const row = asRow(ctx.db.all("SELECT state, started_at, restarts FROM health_service WHERE name = ?", input.service)[0]);
  if (!row) return failWith(ctx.trace.traceId, "validation.not_found", "That service does not exist on this server.", { service: input.service });
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO health_restart (id, service, by_principal, on_behalf, at, done_at) VALUES (?, ?, ?, ?, ?, ?)",
    mint("rst"), input.service, ctx.principal.id, ctx.actingFor ?? null, now, null,
  );
  ctx.db.run("UPDATE health_service SET state = ?, started_at = ?, restarts = ? WHERE name = ?", "healthy", now, int(row["restarts"]) + 1, input.service);
  ctx.emit("service.restarted", `entity/${input.service}`, { service: input.service });
  return { state: "healthy" };
}

type Part = { name: string; value: unknown } | { name: string; error: string };

async function part(ctx: HealthCtx, name: string, cap: CapName, input: unknown): Promise<Part> {
  try {
    return { name, value: await ctx.call(cap, input) };
  } catch (e) {
    const code = asRow(asRow(e)?.["error"])?.["code"];
    return { name, error: typeof code === "string" ? code : "error" };
  }
}

/**
 * Make a support bundle: versions, health, services, the traces asked for and recent warnings and errors (log metadata only).
 * A part that cannot be read is recorded as such and the bundle still gets made: a broken server is exactly when it is needed.
 */
export async function supportBundle(ctx: HealthCtx, input: { traceIds?: string[] }): Promise<{ bundleId: string; fileId: string }> {
  const bundleId = mint("bnd");
  const now = ctx.now();
  const traceIds = (input.traceIds ?? []).slice(0, BUNDLE_TRACES);
  const parts: Part[] = [
    await part(ctx, "versions", "updates.status", {}),
    await part(ctx, "recent", "logs.query", { level: "warn", limit: BUNDLE_RECENT }),
  ];
  for (const traceId of traceIds) parts.push(await part(ctx, `trace:${traceId}`, "logs.trace", { traceId }));
  const body = {
    bundleId, createdAt: now, space: ctx.space, by: ctx.principal.id,
    health: statusOf(ctx), paused: pausedOf(ctx), services: listServices(ctx),
    parts: Object.fromEntries(parts.map((p) => [p.name, "error" in p ? { error: p.error } : p.value])),
    missing: parts.filter((p) => "error" in p).map((p) => p.name),
  };
  if(!ctx.exports)return failWith(ctx.trace.traceId,"internal.unavailable","Private support-bundle storage is unavailable.");
  const fileId=await ctx.exports.support(body);
  const text = JSON.stringify(body);
  const sizeBytes = new TextEncoder().encode(text).length;
  ctx.db.run("INSERT INTO health_bundle (id, file_id, by_principal, at, size_bytes, body) VALUES (?, ?, ?, ?, ?, ?)", bundleId, fileId, ctx.principal.id, now, sizeBytes, text);
  ctx.emit("support_bundle.created", `entity/${bundleId}`, { bundleId, sizeBytes });
  return { bundleId, fileId };
}
