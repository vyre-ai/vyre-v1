// Health checks (spec 4.18, ARCH 3.5 HealthCheckDef, 7.10).
// The runner executes every manifest HealthCheckDef: it calls the check's capability (a cheap, idempotent read that answers {state, detail?}),
// measures latency, applies the def's `degradedWhen` and `downWhen` rules, honours `dependsOn`, and records the result, a history sample
// and what the check pauses. Every check carries a plain next step, shown whenever it is not healthy.
// The eight host probes (health.disk_encrypted and the rest) read what the host daemon last reported into health_probe.

import { readFileSync } from "node:fs";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { CapName, ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { evalExpr, parseExpr } from "../../../lib/expr/expr.ts";

/** The part of the host Ctx the health handlers use. The full Ctx satisfies it. */
export type HealthCtx = Pick<Ctx, "space" | "principal" | "actingFor" | "trace" | "now" | "db" | "emit" | "call">;

export type State = "healthy" | "degraded" | "down";
export type Area = "automations" | "sync" | "sends" | "campaigns";
const AREAS: readonly Area[] = ["automations", "sync", "sends", "campaigns"];
const RANK: Record<State, number> = { healthy: 0, degraded: 1, down: 2 };

export const DAY_MS = 86_400_000;
/** Samples older than this are deleted when checks run. */
export const SAMPLE_DAYS = 30;
/** health.history returns at most this many samples. */
export const HISTORY_MAX = 2_000;
/** health.history without sinceMs looks back this far. */
export const HISTORY_DEFAULT_DAYS = 7;

export const worst = (a: State, b: State): State => (RANK[a] >= RANK[b] ? a : b);
export const isState = (v: unknown): v is State => v === "healthy" || v === "degraded" || v === "down";

export interface HealthDef {
  key: string;
  title: string;
  cap: string;
  module: string;
  intervalSec: number;
  timeoutMs: number;
  states: { degradedWhen?: string; downWhen?: string };
  dependsOn?: string[];
  pauses?: Area[];
  next: string;
}

export interface CheckRow { key: string; title: string; state: State; detail?: string; checkedAt: number; module: string; next: string }

// ---- errors

const NEXT_LABEL: Record<NextStep["kind"], string> = {
  retry: "Try again", switch_model: "Use another model", use_backup_key: "Use the backup key", ask_access: "Ask for access",
  open_settings: "Open settings", reconnect: "Reconnect", edit_input: "Change what you sent", wait: "Wait a moment",
  contact_admin: "Contact an admin", report: "Report a problem",
};

/** Throw a typed error from the global catalogue with the trace id and the catalogue's next steps. */
export function failWith(traceId: string, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code, message: message ?? def.what, retryable: def.retryable, traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT_LABEL[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

// ---- small readers over untyped rows

export type Row = Record<string, unknown>;
export const asRow = (v: unknown): Row | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function mint(prefix: string): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(9));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `${prefix}_${hex}`;
}

// ---- where the check definitions come from

let provider: (() => readonly HealthDef[]) | null = null;
let cached: readonly HealthDef[] | null = null;

/** Replace where definitions come from (the host, or a test). Pass null to go back to the generated registry. */
export function setDefsProvider(fn: (() => readonly HealthDef[]) | null): void {
  provider = fn;
  cached = null;
}

/** Keep the rows that are well formed. A def without a key, capability or next step cannot run or help anyone, so it is dropped. */
export function parseDefs(raw: unknown): HealthDef[] {
  if (!Array.isArray(raw)) return [];
  const out: HealthDef[] = [];
  for (const item of raw) {
    const r = asRow(item);
    if (!r) continue;
    const key = str(r["key"]), title = str(r["title"]), cap = str(r["cap"]), next = str(r["next"]);
    if (!key || !title || !cap || !next) continue;
    const states = asRow(r["states"]) ?? {};
    const def: HealthDef = {
      key, title, cap, next, module: str(r["module"]) ?? key.split(".")[0] ?? key,
      intervalSec: num(r["intervalSec"]) ?? 60, timeoutMs: num(r["timeoutMs"]) ?? 5_000, states: {},
    };
    const degradedWhen = str(states["degradedWhen"]), downWhen = str(states["downWhen"]);
    if (degradedWhen) def.states.degradedWhen = degradedWhen;
    if (downWhen) def.states.downWhen = downWhen;
    if (Array.isArray(r["dependsOn"])) def.dependsOn = r["dependsOn"].filter((d): d is string => typeof d === "string");
    if (Array.isArray(r["pauses"])) def.pauses = r["pauses"].filter((a): a is Area => AREAS.includes(a as Area));
    out.push(def);
  }
  return out;
}

/** Every HealthCheckDef of every manifest, from the generated registry unless a provider was set. */
export function loadDefs(): readonly HealthDef[] {
  if (provider) return provider();
  if (!cached) {
    const reg = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { health?: unknown };
    cached = parseDefs(reg.health);
  }
  return cached;
}

/** Dependencies first. A dependency that is not in the list is ignored; a cycle runs in the listed order. */
export function orderDefs(defs: readonly HealthDef[]): HealthDef[] {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const out: HealthDef[] = [];
  const visit = (d: HealthDef): void => {
    if (done.has(d.key) || visiting.has(d.key)) return;
    visiting.add(d.key);
    for (const dep of d.dependsOn ?? []) { const x = byKey.get(dep); if (x) visit(x); }
    visiting.delete(d.key);
    done.add(d.key);
    out.push(d);
  };
  for (const d of defs) visit(d);
  return out;
}

// ---- host probes: the eight health.<probe> capabilities

/** Probe capability to the name the host reports it under. */
export const PROBES: Readonly<Record<string, string>> = Object.freeze({
  "health.disk_encrypted": "disk_encrypted", "health.events_db": "events_db", "health.index_db": "index_db", "health.scheduler": "scheduler",
  "health.docker": "docker", "health.caddy": "caddy", "health.disk_space": "disk_space", "health.time_skew": "time_skew",
});
/** A report older than this is stale. The scheduler ticks every few seconds, so its window is short. */
export const PROBE_MAX_AGE_MS: Readonly<Record<string, number>> = Object.freeze({ scheduler: 90_000 });
export const PROBE_DEFAULT_AGE_MS = 300_000;
/** The extra number a probe answers besides its state. */
const PROBE_EXTRA: Readonly<Record<string, string>> = Object.freeze({ disk_space: "freeBytes", time_skew: "skewMs" });

export interface ProbeOut { state: State; detail?: string; latencyMs?: number; freeBytes?: number; skewMs?: number }

export function readProbe(ctx: HealthCtx, name: string): ProbeOut {
  const r = asRow(ctx.db.all("SELECT state, detail, latency_ms, values_json, at FROM health_probe WHERE name = ?", name)[0]);
  if (!r) return { state: "degraded", detail: "The host has not reported this yet." };
  const at = num(r["at"]) ?? 0;
  const age = ctx.now() - at;
  const limit = PROBE_MAX_AGE_MS[name] ?? PROBE_DEFAULT_AGE_MS;
  if (age > limit) {
    const minutes = Math.max(1, Math.round(age / 60_000));
    return { state: name === "scheduler" ? "down" : "degraded", detail: `The host has not reported for ${minutes} minutes.` };
  }
  const out: ProbeOut = { state: isState(r["state"]) ? r["state"] : "down" };
  const detail = str(r["detail"]);
  if (detail) out.detail = detail;
  const latency = num(r["latency_ms"]);
  if (latency !== undefined) out.latencyMs = Math.trunc(latency);
  const extra = PROBE_EXTRA[name];
  if (extra && typeof r["values_json"] === "string") {
    try {
      const v = asRow(JSON.parse(r["values_json"]));
      const n = v ? num(v[extra]) : undefined;
      if (n !== undefined && (extra === "freeBytes" || extra === "skewMs")) out[extra] = Math.trunc(n);
    } catch { /* a malformed report carries no number */ }
  }
  return out;
}

/** Called by the host daemon's jobs (or a test) to publish a probe. */
export function reportProbe(ctx: Pick<HealthCtx, "db" | "now">, name: string, p: { state: State; detail?: string; latencyMs?: number; values?: Record<string, number> }): void {
  ctx.db.run(
    "INSERT OR REPLACE INTO health_probe (name, state, detail, latency_ms, values_json, at) VALUES (?, ?, ?, ?, ?, ?)",
    name, p.state, p.detail ?? null, p.latencyMs ?? null, p.values ? JSON.stringify(p.values) : null, ctx.now(),
  );
}

// ---- running a check

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError("timeout")), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e); });
  });
}

function codeOf(e: unknown): string {
  if (e instanceof TimeoutError) return "timeout";
  const err = asRow(e)?.["error"];
  const code = asRow(err)?.["code"];
  return typeof code === "string" ? code : "error";
}

/** Does the rule hold over these values? A rule that does not parse or evaluate holds nothing. */
export function ruleHolds(src: string | undefined, values: Record<string, unknown>): boolean {
  if (!src) return false;
  try { return evalExpr(parseExpr(src), { values }) === true; } catch { return false; }
}

export interface Outcome { state: State; detail?: string; latencyMs?: number }

/** Call the check's capability and turn its answer into a state. A failed or slow call is Down with the reason. */
export async function evaluate(ctx: HealthCtx, def: HealthDef): Promise<Outcome> {
  const t0 = performance.now();
  let answer: unknown;
  try {
    answer = await withTimeout(Promise.resolve(ctx.call(def.cap as CapName, {})), def.timeoutMs);
  } catch (e) {
    return { state: "down", detail: `The check could not run (${codeOf(e)}).`, latencyMs: Math.round(performance.now() - t0) };
  }
  const latency = Math.round(performance.now() - t0);
  const a = asRow(answer);
  if (!a || !isState(a["state"])) return { state: "down", detail: "The check gave an answer that is not a health state.", latencyMs: latency };
  const reported = num(a["latencyMs"]);
  const latencyMs = reported !== undefined ? Math.trunc(reported) : latency;
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") values[k] = v;
  values["latencyMs"] = latencyMs;
  let state: State = a["state"];
  if (ruleHolds(def.states.downWhen, values)) state = worst(state, "down");
  else if (ruleHolds(def.states.degradedWhen, values)) state = worst(state, "degraded");
  const out: Outcome = { state, latencyMs };
  const detail = str(a["detail"]);
  if (detail) out.detail = detail;
  return out;
}

export interface Transition { key: string; from: State | null; to: State; detail?: string; paused: Area[]; resumed: boolean }
export interface RunResult { rows: CheckRow[]; transitions: Transition[] }

function stored(ctx: HealthCtx): Map<string, { state: State; since: number; title: string }> {
  const out = new Map<string, { state: State; since: number; title: string }>();
  for (const raw of ctx.db.all("SELECT check_key, title, state, since FROM health_state")) {
    const r = asRow(raw);
    const key = r ? str(r["check_key"]) : undefined;
    if (r && key && isState(r["state"])) out.set(key, { state: r["state"], since: num(r["since"]) ?? 0, title: str(r["title"]) ?? key });
  }
  return out;
}

function reasonFor(def: HealthDef, o: Outcome): string {
  const why = o.detail ? `: ${o.detail.replace(/\.+$/, "")}.` : ".";
  return `${def.title} is ${o.state === "down" ? "down" : "degraded"}${why} ${def.next}`;
}

/** Run the checks (all, or the one named), record each result, and keep the pauses in step. Dependencies run first. */
export async function runChecks(ctx: HealthCtx, defs: readonly HealthDef[], only?: string): Promise<RunResult> {
  const known = stored(ctx);
  const rows: CheckRow[] = [];
  const transitions: Transition[] = [];
  const now = ctx.now();
  for (const def of orderDefs(defs)) {
    if (only !== undefined && def.key !== only) continue;
    const blocked = (def.dependsOn ?? []).map((k) => ({ k, s: known.get(k) })).find((d) => d.s?.state === "down");
    const out: Outcome = blocked
      ? { state: "down", detail: `Waiting on ${blocked.s?.title ?? blocked.k}.` }
      : await evaluate(ctx, def);
    const prev = known.get(def.key);
    const since = prev && prev.state === out.state ? prev.since : now;
    ctx.db.run(
      "INSERT OR REPLACE INTO health_state (check_key, module, title, state, detail, latency_ms, checked_at, since, next) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      def.key, def.module, def.title, out.state, out.detail ?? null, out.latencyMs ?? null, now, since, def.next,
    );
    ctx.db.run("INSERT INTO health_sample (check_key, at, state, latency_ms, detail) VALUES (?, ?, ?, ?, ?)", def.key, now, out.state, out.latencyMs ?? null, out.detail ?? null);
    const areas = def.pauses ?? [];
    if (areas.length > 0) {
      if (out.state === "healthy") ctx.db.run("DELETE FROM health_pause WHERE check_key = ?", def.key);
      else {
        for (const area of areas) {
          const had = asRow(ctx.db.all("SELECT since FROM health_pause WHERE area = ? AND check_key = ?", area, def.key)[0]);
          ctx.db.run("INSERT OR REPLACE INTO health_pause (area, check_key, reason, since) VALUES (?, ?, ?, ?)", area, def.key, reasonFor(def, out), num(had?.["since"]) ?? now);
        }
      }
    }
    known.set(def.key, { state: out.state, since, title: def.title });
    if (!prev || prev.state !== out.state) {
      const t: Transition = { key: def.key, from: prev?.state ?? null, to: out.state, paused: out.state === "healthy" ? [] : [...areas], resumed: out.state === "healthy" && prev !== undefined && areas.length > 0 };
      if (out.detail) t.detail = out.detail;
      transitions.push(t);
    }
    const row: CheckRow = { key: def.key, title: def.title, state: out.state, checkedAt: now, module: def.module, next: def.next };
    if (out.detail) row.detail = out.detail;
    rows.push(row);
  }
  ctx.db.run("DELETE FROM health_sample WHERE at < ?", now - SAMPLE_DAYS * DAY_MS);
  return { rows, transitions };
}

// ---- reading what was recorded

function toRow(r: Row): CheckRow | null {
  const key = str(r["check_key"]), title = str(r["title"]), module = str(r["module"]), next = str(r["next"]), at = num(r["checked_at"]);
  if (!key || !title || !module || !next || at === undefined || !isState(r["state"])) return null;
  const row: CheckRow = { key, title, state: r["state"], checkedAt: at, module, next };
  const detail = str(r["detail"]);
  if (detail) row.detail = detail;
  return row;
}

/** Latest state of every check, grouped by module, and the worst of them. */
export function statusOf(ctx: HealthCtx): { overall: State; checks: CheckRow[] } {
  const checks: CheckRow[] = [];
  for (const raw of ctx.db.all("SELECT check_key, module, title, state, detail, checked_at, next FROM health_state ORDER BY module, check_key")) {
    const r = asRow(raw);
    const row = r ? toRow(r) : null;
    if (row) checks.push(row);
  }
  let overall: State = "healthy";
  for (const c of checks) overall = worst(overall, c.state);
  return { overall, checks };
}

export function historyOf(ctx: HealthCtx, key: string, sinceMs?: number): { at: number; state: State; latencyMs?: number; detail?: string }[] {
  const since = sinceMs ?? ctx.now() - HISTORY_DEFAULT_DAYS * DAY_MS;
  const out: { at: number; state: State; latencyMs?: number; detail?: string }[] = [];
  for (const raw of ctx.db.all("SELECT at, state, latency_ms, detail FROM health_sample WHERE check_key = ? AND at >= ? ORDER BY at, id LIMIT ?", key, since, HISTORY_MAX)) {
    const r = asRow(raw);
    const at = r ? num(r["at"]) : undefined;
    if (!r || at === undefined || !isState(r["state"])) continue;
    const s: { at: number; state: State; latencyMs?: number; detail?: string } = { at, state: r["state"] };
    const latency = num(r["latency_ms"]);
    if (latency !== undefined) s.latencyMs = latency;
    const detail = str(r["detail"]);
    if (detail) s.detail = detail;
    out.push(s);
  }
  return out;
}

export function pausedOf(ctx: HealthCtx): { area: Area; key: string; reason: string }[] {
  const out: { area: Area; key: string; reason: string }[] = [];
  for (const raw of ctx.db.all("SELECT area, check_key, reason FROM health_pause ORDER BY area, check_key")) {
    const r = asRow(raw);
    const key = r ? str(r["check_key"]) : undefined, reason = r ? str(r["reason"]) : undefined;
    if (r && key && reason && AREAS.includes(r["area"] as Area)) out.push({ area: r["area"] as Area, key, reason });
  }
  return out;
}

/** Run every check now and list the ones that are not healthy, each with its next step: the output of `vyre-server doctor`. */
export async function doctor(ctx: HealthCtx, defs: readonly HealthDef[]): Promise<{ ok: boolean; findings: { key: string; state: State; next: string }[] }> {
  const { rows } = await runChecks(ctx, defs);
  const findings = rows.filter((r) => r.state !== "healthy").map((r) => ({ key: r.key, state: r.state, next: r.next }));
  return { ok: findings.length === 0, findings };
}
