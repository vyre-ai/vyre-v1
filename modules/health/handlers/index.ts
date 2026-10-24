// Capability handlers for health (spec 4.18, ARCH 7.10). Checks and probes live in checks.ts, services and the support bundle in services.ts.
// Reading health is open to console.access; restarting a service needs server.services at manage level and is audited by the invoke pipeline.

import { doctor, failWith, historyOf, loadDefs, pausedOf, readProbe, runChecks, statusOf } from "./checks.ts";
import type { HealthCtx } from "./checks.ts";
import { listServices, restartService, supportBundle } from "./services.ts";

export type { HealthCtx } from "./checks.ts";

export async function status(ctx: HealthCtx, _input: Record<string, unknown>) {
  return statusOf(ctx);
}

/** Run one check (and what it waits on is read from its last result) or all of them. */
export async function run(ctx: HealthCtx, input: { key?: string }) {
  const defs = loadDefs();
  if (input.key !== undefined && !defs.some((d) => d.key === input.key)) {
    return failWith(ctx.trace.traceId, "validation.not_found", "There is no health check with that key.", { key: input.key });
  }
  const { rows } = await runChecks(ctx, defs, input.key);
  return { checks: rows };
}

export async function history(ctx: HealthCtx, input: { key: string; sinceMs?: number }) {
  return { samples: historyOf(ctx, input.key, input.sinceMs) };
}

export async function doctorRun(ctx: HealthCtx, _input: Record<string, unknown>) {
  return doctor(ctx, loadDefs());
}

export async function pausedReasons(ctx: HealthCtx, _input: Record<string, unknown>) {
  return { paused: pausedOf(ctx) };
}

export async function services(ctx: HealthCtx, _input: Record<string, unknown>) {
  return { services: listServices(ctx) };
}

export async function serviceRestart(ctx: HealthCtx, input: { service: string }) {
  return restartService(ctx, input);
}

export async function bundle(ctx: HealthCtx, input: { traceIds?: string[] }) {
  return supportBundle(ctx, input);
}

const probe = (name: string) => async (ctx: HealthCtx, _input: Record<string, unknown>) => readProbe(ctx, name);

export const handlers = {
  "health.status": status,
  "health.run": run,
  "health.history": history,
  "health.doctor": doctorRun,
  "health.paused_reasons": pausedReasons,
  "health.services": services,
  "health.service_restart": serviceRestart,
  "health.support_bundle": bundle,
  "health.disk_encrypted": probe("disk_encrypted"),
  "health.events_db": probe("events_db"),
  "health.index_db": probe("index_db"),
  "health.scheduler": probe("scheduler"),
  "health.docker": probe("docker"),
  "health.caddy": probe("caddy"),
  "health.disk_space": probe("disk_space"),
  "health.time_skew": probe("time_skew"),
};
