// console-views: the aggregate reads behind the Console Overview and Speed pages (spec 3.10, ARCH 7.10 and 9).
// The module owns no tables. Every number comes from another module's capability through ctx.call, as the signed-in caller, so a source the
// caller may not read (no server.network, no audit.read) drops out of the page instead of failing it. Nothing here is cached: each call reads fresh.

import { readFileSync } from "node:fs";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import { ERROR_CODES, VyreErr } from "../../packages/contracts/src/errors.ts";
import type { CapName, ErrorCode, VyreError } from "../../packages/contracts/src/types.ts";

/** The part of the host Ctx these handlers use. The full Ctx satisfies it. */
export type ViewCtx = Pick<Ctx, "space" | "principal" | "trace" | "now" | "call" | "authorize">;

export type State = "healthy" | "degraded" | "down";
export type AttentionKind = "failing_check" | "expiring_certificate" | "failed_run" | "stuck_update" | "limit_hit" | "access_review_due";
export interface Attention { kind: AttentionKind; title: string; ref?: string; since: number; next: string }
export interface ActivityRow { at: number; actor: string; action: string; resource?: string }

export const DAY_MS = 86_400_000;
/** A certificate this close to expiry (or past it) needs attention. */
export const CERT_WARN_DAYS = 14;
/** Failed runs older than this are history, not attention. */
export const FAILED_RUN_DAYS = 7;
/** The Overview lists at most this many attention items. */
export const ATTENTION_MAX = 50;
/** console.activity without a limit returns this many rows. */
export const ACTIVITY_DEFAULT = 20;
/** The Overview shows this many activity rows. */
export const OVERVIEW_ACTIVITY = 8;
/** Pages of spans read per budget id, 500 each. */
export const SPAN_PAGES = 10;
export const SPAN_PAGE = 500;
export const DESIGN_BETA = "Vyre is in design beta. Contact Clearfield Labs for more information on plans and pricing.";

export function failWith(traceId: string, code: ErrorCode, message?: string): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = { code: def.code, message: message ?? def.what, retryable: def.retryable, traceId, next: def.next.map((kind) => ({ kind, label: kind })) };
  throw new VyreErr(error);
}

// ---- reading what other modules answered

export function asRow(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
export function asList(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.map(asRow).filter((r): r is Record<string, unknown> => r !== null) : [];
}
export const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const isState = (v: unknown): v is State => v === "healthy" || v === "degraded" || v === "down";
const RANK: Record<State, number> = { healthy: 0, degraded: 1, down: 2 };

/** Call a capability; a refusal or a failure is null, so one unreadable source never takes the page down. */
export async function ask(ctx: ViewCtx, cap: string, input: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    return asRow(await ctx.call(cap as CapName, input));
  } catch {
    return null;
  }
}

// ---- attention

const KIND_ORDER: Record<AttentionKind, number> = { failing_check: 0, expiring_certificate: 1, stuck_update: 2, failed_run: 3, limit_hit: 4, access_review_due: 5 };

function checkItems(health: Record<string, unknown> | null, now: number): Attention[] {
  const found: { item: Attention; state: State }[] = [];
  for (const c of asList(health?.["checks"])) {
    const state = c["state"];
    if (!isState(state) || state === "healthy") continue;
    const key = str(c["key"]);
    found.push({
      state, item: {
        kind: "failing_check", title: `${str(c["title"]) ?? key ?? "A health check"} is ${state}`,
        ...(key ? { ref: key } : {}), since: num(c["checkedAt"]) ?? now, next: str(c["next"]) ?? "Open Diagnostics and run the check again.",
      },
    });
  }
  // down before degraded, then the longest-failing first
  return found.sort((a, b) => RANK[b.state] - RANK[a.state] || a.item.since - b.item.since).map((f) => f.item);
}

function certItems(net: Record<string, unknown> | null, now: number): Attention[] {
  const cert = asRow(net?.["certificate"]);
  if (!cert) return [];
  const host = str(cert["host"]) ?? "the server address";
  const expiresAt = num(cert["expiresAt"]);
  const state = cert["state"];
  const soon = expiresAt !== undefined && expiresAt - now < CERT_WARN_DAYS * DAY_MS;
  if (!soon && (state === undefined || state === "healthy")) return [];
  const gone = expiresAt !== undefined && expiresAt <= now;
  return [{
    kind: "expiring_certificate", title: gone ? `The certificate for ${host} has expired` : `The certificate for ${host} expires soon`,
    ref: host, since: expiresAt ?? now, next: "Open Network and renew the certificate.",
  }];
}

function updateItems(up: Record<string, unknown> | null, now: number): Attention[] {
  const last = up?.["lastResult"];
  if (last !== "failed" && last !== "rolled_back") return [];
  const current = str(up?.["current"]);
  return [{
    kind: "stuck_update", title: last === "failed" ? "The last update failed" : "The last update was rolled back",
    ...(current ? { ref: current } : {}), since: now, next: "Open Updates, read the result and try again after a backup.",
  }];
}

function runItems(runs: Record<string, unknown> | null): Attention[] {
  return asList(runs?.["runs"]).flatMap((r): Attention[] => {
    const id = str(r["id"]);
    const at = num(r["endedAt"]) ?? num(r["startedAt"]);
    if (!id || at === undefined) return [];
    return [{ kind: "failed_run", title: `${str(r["name"]) ?? str(r["kind"]) ?? "A run"} failed`, ref: id, since: at, next: str(r["summary"]) ?? "Open the run and read the first failed step." }];
  });
}

function reviewItems(reviews: Record<string, unknown> | null): Attention[] {
  return asList(reviews?.["reviews"]).flatMap((r): Attention[] => {
    const id = str(r["id"]);
    const at = num(r["openedAt"]);
    if (!id || at === undefined) return [];
    const left = Math.max(0, (num(r["items"]) ?? 0) - (num(r["decided"]) ?? 0));
    return [{ kind: "access_review_due", title: "An access review is open", ref: id, since: at, next: left > 0 ? `Decide the ${left} grant${left === 1 ? "" : "s"} still waiting.` : "Close the review." }];
  });
}

export interface Gathered { health: State; attention: Attention[] }

/** Health and attention in one pass, so the Overview and console.attention agree. */
export async function gather(ctx: ViewCtx): Promise<Gathered> {
  const now = ctx.now();
  const [health, net, up, runs, reviews] = await Promise.all([
    ask(ctx, "health.status", {}),
    ask(ctx, "network.status", {}),
    ask(ctx, "updates.status", {}),
    ask(ctx, "runs.list", { scope: "all", statuses: ["failed"], since: now - FAILED_RUN_DAYS * DAY_MS, limit: 50 }),
    ask(ctx, "access.reviews.list", { state: "open", limit: 20 }),
  ]);
  const overall = health?.["overall"];
  // health.status unreadable is itself a reason to look: degraded, never silently healthy
  const state: State = isState(overall) ? overall : "degraded";
  const items = [...checkItems(health, now), ...certItems(net, now), ...updateItems(up, now), ...runItems(runs), ...reviewItems(reviews)];
  const rank = (a: Attention): number => KIND_ORDER[a.kind];
  const attention = items.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map((x) => x.a).slice(0, ATTENTION_MAX);
  if (!health) attention.unshift({ kind: "failing_check", title: "Health could not be read", since: now, next: "Open Diagnostics and run the checks." });
  return { health: state, attention };
}

// ---- activity and usage

const actorOf = (v: unknown): string => {
  const r = asRow(v);
  return str(r?.["id"]) ?? "unknown";
};
const resourceOf = (v: unknown): string | undefined => {
  const r = asRow(v);
  const type = str(r?.["type"]);
  return type ? `${type}/${str(r?.["id"]) ?? ""}`.replace(/\/$/, "") : undefined;
};

export async function recentActivity(ctx: ViewCtx, limit: number): Promise<ActivityRow[]> {
  const out = await ask(ctx, "audit.list", { limit });
  const rows = asList(out?.["rows"]).flatMap((r): ActivityRow[] => {
    const at = num(r["at"]);
    const action = str(r["action"]);
    if (at === undefined || !action) return [];
    const resource = resourceOf(r["resource"]);
    return [{ at, actor: actorOf(r["actor"]), action, ...(resource ? { resource } : {}) }];
  });
  return rows.sort((a, b) => b.at - a.at).slice(0, limit);
}

const dayStart = (t: number): number => Math.floor(t / DAY_MS) * DAY_MS;
const monthStart = (t: number): number => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const totalsOf = (out: Record<string, unknown> | null): { turns: number; tokensIn: number; tokensOut: number; costMicros: number } => {
  const t = asRow(out?.["totals"]);
  return { turns: num(t?.["turns"]) ?? 0, tokensIn: num(t?.["tokensIn"]) ?? 0, tokensOut: num(t?.["tokensOut"]) ?? 0, costMicros: num(t?.["costMicros"]) ?? 0 };
};

export async function usageGlance(ctx: ViewCtx) {
  const now = ctx.now();
  const [today, month, people, agents] = await Promise.all([
    ask(ctx, "engine.usage.query", { by: "day", from: dayStart(now), to: now }),
    ask(ctx, "engine.usage.query", { by: "day", from: monthStart(now), to: now }),
    ask(ctx, "access.principals.list", { kind: "person", status: "active", limit: 1 }),
    ask(ctx, "access.principals.list", { kind: "agent", status: "active", limit: 1 }),
  ]);
  const count = (o: Record<string, unknown> | null): number => num(o?.["total"]) ?? asList(o?.["principals"]).length;
  return { turnsToday: totalsOf(today).turns, costMicrosMonth: totalsOf(month).costMicros, members: count(people), agents: count(agents) };
}

const PERIOD_MS = { day: DAY_MS, week: 7 * DAY_MS, month: 30 * DAY_MS } as const;
export async function usageRows(ctx: ViewCtx, period: keyof typeof PERIOD_MS, by: "agent" | "person" | "model") {
  const now = ctx.now();
  const out = await ask(ctx, "engine.usage.query", { by, from: now - PERIOD_MS[period], to: now });
  const rows = asList(out?.["rows"]).flatMap((r) => {
    const key = str(r["key"]);
    if (!key) return [];
    const t = totalsOf({ totals: r["totals"] });
    return [{ key, name: str(r["title"]) ?? key, ...t }];
  });
  return rows.sort((a, b) => b.costMicros - a.costMicros || a.name.localeCompare(b.name));
}

// ---- navigation, pruned by permission

interface NavPage { key: string; title: string; perm: string }
interface NavGroup { key: string; title: string; pages: NavPage[] }
const C = "console.access";
export const NAV: readonly NavGroup[] = [
  { key: "overview", title: "Overview", pages: [{ key: "console.overview", title: "Overview", perm: C }, { key: "console.usage", title: "Usage", perm: C }] },
  { key: "access", title: "Access", pages: [
    { key: "access.people", title: "People", perm: "access.manage" }, { key: "access.groups", title: "Groups", perm: "access.manage" }, { key: "access.roles", title: "Roles", perm: "access.manage" },
    { key: "access.grants", title: "Grants", perm: "access.manage" }, { key: "access.policies", title: "Policies", perm: "policy.manage" }, { key: "access.checker", title: "Access checker", perm: "access.manage" },
    { key: "access.reviews", title: "Access reviews", perm: "access.manage" }, { key: "devices.sessions", title: "Sessions and devices", perm: "access.manage" },
  ] },
  { key: "agents", title: "Agents and actors", pages: [
    { key: "console.agents-register", title: "Agents", perm: C }, { key: "console.outside-actors", title: "Outside actors", perm: "access.manage" },
    { key: "console.agent-computers", title: "Agent computers", perm: C }, { key: "console.agent-template", title: "Agent template", perm: "agents.manage" },
  ] },
  { key: "data", title: "Data", pages: [
    { key: "console.schema", title: "Schema", perm: "schema.manage" }, { key: "console.labels", title: "Sensitivity labels", perm: "policy.manage" },
    { key: "governance.retention", title: "Retention", perm: "policy.manage" }, { key: "governance.holds", title: "Holds", perm: "records.hold" },
    { key: "governance.erase", title: "Erase a person", perm: "policy.manage" }, { key: "console.backups", title: "Backups", perm: "server.backups" },
  ] },
  { key: "ai", title: "AI", pages: [
    { key: "console.ai-models", title: "Models and providers", perm: "ai.models" }, { key: "gate.rules", title: "Gate rules", perm: "policy.manage" },
    { key: "console.ai-spend", title: "Spend and limits", perm: "ai.spend" }, { key: "console.logging", title: "Logging", perm: "server.logs" },
    { key: "console.ai-review", title: "Review sampling", perm: "ai.incidents" }, { key: "console.ai-incidents", title: "Incidents", perm: "ai.incidents" },
  ] },
  { key: "comms", title: "Comms", pages: [
    { key: "mail.domains", title: "Sending domains", perm: "comms.domains" }, { key: "telephony.numbers", title: "Numbers", perm: "comms.numbers" },
    { key: "mail.shared-inboxes", title: "Shared inboxes", perm: "comms.shared_send" }, { key: "telephony.registration", title: "Texting registration", perm: "comms.numbers" },
  ] },
  { key: "integrations", title: "Integrations", pages: [
    { key: "console.integrations", title: "Connectors and connections", perm: "connectors.manage" }, { key: "events.webhooks", title: "Webhooks", perm: "connectors.manage" },
    { key: "console.mcp-sessions", title: "API keys", perm: "access.manage" },
  ] },
  { key: "infrastructure", title: "Infrastructure", pages: [
    { key: "console.network", title: "Network", perm: "server.network" }, { key: "console.server-updates", title: "Updates", perm: "server.update" },
    { key: "console.server-logs", title: "Logs", perm: "server.logs" }, { key: "console.diagnostics", title: "Diagnostics", perm: C },
    { key: "console.support-bundle", title: "Support bundle", perm: "server.logs" }, { key: "console.speed", title: "Speed", perm: C },
  ] },
  { key: "audit", title: "Audit log", pages: [{ key: "audit.log", title: "Audit log", perm: "audit.read" }] },
  { key: "space", title: "Space", pages: [{ key: "spaces.console", title: "Space settings", perm: "policy.manage" }] },
];

export function navFor(ctx: ViewCtx): { key: string; title: string; pages: { key: string; title: string }[] }[] {
  const allowed = new Map<string, boolean>();
  const may = (perm: string): boolean => {
    let ok = allowed.get(perm);
    if (ok === undefined) {
      ok = ctx.authorize({ perm, level: "view" }, { type: "space", id: ctx.space }).effect === "allow";
      allowed.set(perm, ok);
    }
    return ok;
  };
  return NAV.map((g) => ({ key: g.key, title: g.title, pages: g.pages.filter((p) => may(p.perm)).map((p) => ({ key: p.key, title: p.title })) })).filter((g) => g.pages.length > 0);
}

// ---- speed

export interface Budget { id: string; p50: number; p95: number; sense: "max" | "min" | "exact"; unit: string }
let provider: (() => Budget[]) | null = null;
/** Tests replace where the budgets come from; null restores perf/budgets.json. */
export function setBudgetsProvider(p: (() => Budget[]) | null): void { provider = p; }

let cached: Budget[] | null = null;
export function loadBudgets(): Budget[] {
  if (provider) return provider();
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(new URL("../../perf/budgets.json", import.meta.url), "utf8")) as { budgets?: unknown };
  cached = asList(raw.budgets).flatMap((b): Budget[] => {
    const id = str(b["id"]);
    const p95 = num(b["p95"]);
    if (!id || p95 === undefined) return [];
    const sense = b["sense"] === "min" || b["sense"] === "exact" ? b["sense"] : "max";
    return [{ id, p50: num(b["p50"]) ?? p95, p95, sense, unit: str(b["unit"]) ?? "ms" }];
  });
  return cached;
}

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1]!;
}
const round = (n: number): number => Math.round(n * 100) / 100;

export interface SpeedRow { budgetId: string; p50: number; p95: number; budgetP95: number; worstTraceId?: string; over: boolean }
interface Sample { value: number; traceId?: string }

async function samplesOf(ctx: ViewCtx, b: Budget, since: number): Promise<Sample[]> {
  const out: Sample[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < SPAN_PAGES; page++) {
    const res = await ask(ctx, "logs.spans", { name: b.id, limit: SPAN_PAGE, ...(cursor ? { cursor } : {}) });
    for (const s of asList(res?.["spans"])) {
      const at = num(s["at"]);
      if (at === undefined || at < since) continue;
      const attrs = asRow(s["attrs"]);
      const value = b.unit === "ms" ? (num(s["durUs"]) ?? 0) / 1000 : num(attrs?.["value"]) ?? num(attrs?.["count"]);
      if (value === undefined) continue;
      const traceId = str(s["traceId"]);
      out.push({ value, ...(traceId ? { traceId } : {}) });
    }
    cursor = str(res?.["next"]);
    if (!cursor) break;
  }
  return out;
}

/**
 * One row per budget id that has samples. p95 is the bad end of the spread: the 95th percentile when more is worse (max), the 5th when less is worse (min).
 * The worst trace is the sample furthest on the bad side, so the page can link straight to its waterfall.
 */
export function rollUp(b: Budget, samples: readonly Sample[]): SpeedRow | null {
  if (samples.length === 0) return null;
  const values = samples.map((s) => s.value).sort((x, y) => x - y);
  const low = b.sense === "min";
  const tail = low ? percentile(values, 5) : percentile(values, 95);
  const worst = samples.reduce((w, s) => (low ? s.value < w.value : s.value > w.value) ? s : w);
  const over = b.sense === "exact" ? values.some((v) => v !== b.p95) : low ? tail < b.p95 : tail > b.p95;
  return { budgetId: b.id, p50: round(percentile(values, 50)), p95: round(tail), budgetP95: b.p95, ...(worst.traceId ? { worstTraceId: worst.traceId } : {}), over };
}

export async function speedRows(ctx: ViewCtx, windowMinutes: number | undefined): Promise<SpeedRow[]> {
  const since = windowMinutes === undefined ? 0 : ctx.now() - windowMinutes * 60_000;
  const rows = await Promise.all(loadBudgets().map(async (b) => rollUp(b, await samplesOf(ctx, b, since))));
  return rows.filter((r): r is SpeedRow => r !== null);
}
