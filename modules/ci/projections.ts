// CI runners: the context subset, the host seam (the cloud key stays in the host), the schema, the settings, and the plain readers every handler shares (lane l-ci-runners).
// Every statement names only ci_* tables (ctx.db refuses anything else, ARCH B2).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";
import { isHostService } from "../../lib/trust.ts";

export interface Db { all(sql: string, ...args: unknown[]): unknown[]; run(sql: string, ...args: unknown[]): { changes: number } }
export interface CiCtx {
  space: string;
  principal: { kind: string; id: string };
  actingFor?: string;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  authorize?(action: { perm: string | null; level: string }, resource: { type: string; id: string | null }): { effect: string };
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}
export type Row = Record<string, unknown>;

// ---- host seam

export interface CloudReq { method: "GET" | "POST" | "DELETE"; path: string; query?: Record<string, string | number> | undefined; body?: unknown }
export interface CiHost {
  /** One call to the cloud provider's API with the Space's key (the Vault item named by handle). The key never leaves the host. */
  cloud(ctx: CiCtx, handle: string, req: CloudReq): Promise<{ status: number; text: string }>;
}
let host: CiHost | null = null;
/** The host registers its half once at boot (host/src/seams/ci.ts). */
export function setCiHost(h: CiHost | null): void { host = h; }
export function needHost(ctx: Pick<CiCtx, "trace">): CiHost {
  if (!host) throw fail("internal.unavailable", ctx.trace.traceId, { message: "Cloud runners are not set up on this server." });
  return host;
}

type Code = Parameters<typeof fail>[0];
export function raise(ctx: Pick<CiCtx, "trace">, code: Code, message: string): never { throw fail(code, ctx.trace.traceId, { message }); }

// ---- schema

function statements(sql: string): string[] {
  return sql.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter((s) => s.length > 0);
}
const SCHEMA = statements(readFileSync(fileURLToPath(new URL("./migrations/0001_ci.sql", import.meta.url)), "utf8"));
const ready = new WeakSet<object>();
export function ensure(ctx: Pick<CiCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try { ctx.db.all(`SELECT "run_id" FROM ci_run WHERE "run_id" = ?`, "probe"); ctx.db.all(`SELECT "key" FROM ci_meta WHERE "key" = ?`, "probe"); ctx.db.all(`SELECT "key" FROM ci_settings WHERE "key" = ?`, "probe"); }
  catch { for (const s of SCHEMA) ctx.db.run(s); }
  ready.add(ctx.db);
}

// ---- settings

export interface Settings {
  enabled: boolean; provider: "digitalocean"; vaultKeyRef: string | null; region: string; size: string; image: string;
  maxConcurrent: number; monthlyCapUsd: number; maxJobMinutes: number; labels: string[];
}
export const DEFAULTS: Settings = { enabled: false, provider: "digitalocean", vaultKeyRef: null, region: "fra1", size: "s-2vcpu-4gb", image: "ubuntu-24-04-x64", maxConcurrent: 3, monthlyCapUsd: 0, maxJobMinutes: 60, labels: ["vyre"] };

export function readSettings(ctx: CiCtx): Settings {
  ensure(ctx);
  const r = ctx.db.all(`SELECT "value" FROM ci_settings WHERE "key" = ?`, "settings")[0] as Row | undefined;
  if (!r || typeof r["value"] !== "string") return { ...DEFAULTS, labels: [...DEFAULTS.labels] };
  try { return { ...DEFAULTS, ...(JSON.parse(r["value"]) as Partial<Settings>) }; } catch { return { ...DEFAULTS, labels: [...DEFAULTS.labels] }; }
}
export function writeSettings(ctx: CiCtx, s: Settings): void {
  ensure(ctx);
  ctx.db.run(`INSERT INTO ci_settings ("key", "value") VALUES (?, ?) ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value"`, "settings", JSON.stringify(s));
}

/** An admin: the host itself, or a person who may manage connectors. */
export function isAdmin(ctx: CiCtx): boolean {
  return isHostService(ctx.principal) || ctx.authorize?.({ perm: "connectors.manage", level: "manage" }, { type: "space", id: ctx.space })?.effect === "allow";
}

export function metaGet(ctx: CiCtx, key: string): string | null {
  const r = ctx.db.all(`SELECT "value" FROM ci_meta WHERE "key" = ?`, key)[0] as Row | undefined;
  return r && typeof r["value"] === "string" ? r["value"] : null;
}
export function metaSet(ctx: CiCtx, key: string, value: string): void {
  ctx.db.run(`INSERT INTO ci_meta ("key", "value") VALUES (?, ?) ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value"`, key, value);
}

// ---- runs

export type State = "queued" | "starting" | "running" | "finished" | "failed" | "swept" | "refused";
export interface Run {
  runId: string; jobId: number; workflowRunId: number; repo: string; jobName: string; projectId: string | null; state: State; dropletId: string | null; runnerId: number | null;
  size: string | null; priceHourly: number | null; queuedAt: number; startedAt: number | null; endedAt: number | null; conclusion: string | null; costUsd: number; note: string | null;
}
const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
const n = (v: unknown): number | null => (typeof v === "number" ? v : null);
export function runOf(r: Row): Run {
  return {
    runId: String(r["run_id"]), jobId: Number(r["job_id"]), workflowRunId: Number(r["workflow_run_id"]), repo: String(r["repo"]), jobName: String(r["job_name"]), projectId: s(r["project_id"]),
    state: String(r["state"]) as State, dropletId: s(r["droplet_id"]), runnerId: n(r["runner_id"]), size: s(r["size"]), priceHourly: n(r["price_hourly"]), queuedAt: Number(r["queued_at"]),
    startedAt: n(r["started_at"]), endedAt: n(r["ended_at"]), conclusion: s(r["conclusion"]), costUsd: Number(r["cost_usd"] ?? 0), note: s(r["note"]),
  };
}
export const RUN_COLS = `"run_id", "job_id", "workflow_run_id", "repo", "job_name", "project_id", "state", "droplet_id", "runner_id", "size", "price_hourly", "queued_at", "started_at", "ended_at", "conclusion", "cost_usd", "note"`;
export function runBy(ctx: CiCtx, col: "run_id" | "job_id" | "droplet_id", value: string | number): Run | null {
  ensure(ctx);
  const r = ctx.db.all(`SELECT ${RUN_COLS} FROM ci_run WHERE "${col}" = ? ORDER BY "queued_at" DESC LIMIT 1`, value)[0] as Row | undefined;
  return r ? runOf(r) : null;
}
export function runsIn(ctx: CiCtx, states: State[]): Run[] {
  ensure(ctx);
  return (ctx.db.all(`SELECT ${RUN_COLS} FROM ci_run WHERE "state" IN (${states.map(() => "?").join(", ")}) ORDER BY "queued_at" ASC`, ...states) as Row[]).map(runOf);
}
export function patchRun(ctx: CiCtx, runId: string, patch: Partial<Record<"state" | "droplet_id" | "runner_id" | "size" | "price_hourly" | "started_at" | "ended_at" | "conclusion" | "cost_usd" | "note" | "project_id", string | number | null>>): void {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  ctx.db.run(`UPDATE ci_run SET ${keys.map((k) => `"${k}" = ?`).join(", ")} WHERE "run_id" = ?`, ...keys.map((k) => patch[k as keyof typeof patch] ?? null), runId);
}

/** 2026-11 for a time, in UTC (the cap is for the calendar month, as the provider bills it). */
export const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);
export const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;
