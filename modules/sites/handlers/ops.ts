// Site logs and metrics for the app and for agents (r42-sites-run, slice 4). The collector (ops/collect.ts) fills the tables; these handlers only read them.
//   sites.logs_read  the lines of a site: its app, its requests, a deploy's build, its jobs; search words, source, level, time, a cursor to follow it live, per deploy and per service
//   sites.metrics    one sample a minute (CPU, memory, requests, response time) for the last hour, six hours or day, drawn as at most 60 points, and the "Right now" cards
// A log is text the site printed, not Vyre content: it is returned as data and never acted on.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { fail, isNull, many, mustSite, num, one, optInt, optStr, rec, reqStr, str } from "./deploy.ts";
import { limitsOf, parseJson } from "./release.ts";
import { LOG_SOURCES, leftOut, levelOf, matches, terms } from "../ops/logs.ts";
import type { LogLevel, LogLine, LogSource } from "../ops/logs.ts";
import { MINUTE, bucketed, minuteOf, rightNow, window } from "../ops/metrics.ts";
import * as st from "../ops/store.ts";
import { accessActive } from "../ops/instance.ts";

const LEVELS: readonly string[] = ["error", "warn", "info"];
const WINDOWS: Readonly<Record<string, number>> = { "1h": 60, "6h": 360, "24h": 1440 };
const POINTS = 60;

/** A scope the page can pick: a deploy, a service or a job run, with a title a person reads. */
export interface ScopeOut {
  scope: string;
  source: LogSource;
  title: string;
  at: number;
  lines: number;
}

function titleOf(ctx: Ctx, siteId: string, scope: string, source: LogSource): string {
  if (source === "requests") return "Requests";
  const d = one(
    ctx,
    "SELECT commit_sha, branch, env FROM sites_deployment WHERE id = ? AND site_id = ?",
    scope,
    siteId,
  );
  if (d)
    return `${str(d.env) === "production" ? "Deploy" : "Preview"} ${isNull(d.commit_sha) ? "" : str(d.commit_sha).slice(0, 7)}`.trim();
  const v = st.getService(ctx.db, scope);
  if (v) return v.name;
  const r = st.getRun(ctx.db, scope);
  if (r) return `${st.getJob(ctx.db, r.jobId)?.name ?? "Job"} run`;
  return source === "app" ? "App" : source === "jobs" ? "Job run" : "Build";
}

/** A deploy's build log, kept on the deployment (it carries no times, so every line takes the deploy's time and its place in the log is its number). */
function buildLines(ctx: Ctx, siteId: string, deploymentId: string | undefined): LogLine[] {
  const d = deploymentId
    ? one(ctx, "SELECT * FROM sites_deployment WHERE id = ? AND site_id = ?", deploymentId, siteId)
    : one(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? ORDER BY at DESC", siteId, "production");
  if (!d) return [];
  return parseJson<string[]>(d.log, []).map((text, i) => ({
    seq: i + 1,
    at: num(d.at),
    source: "build" as const,
    scope: str(d.id),
    text,
    level: levelOf(text),
  }));
}

export async function logsRead(
  ctx: Ctx,
  input: unknown,
): Promise<{ lines: LogLine[]; leftOut?: string; lastSeq: number; scopes: ScopeOut[] }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const siteId = str(site.id);
  const source = optStr(ctx, o, "source");
  if (source !== undefined && !LOG_SOURCES.includes(source as LogSource))
    fail(ctx, "validation.bad_input", "Pick App, Requests, Build or Jobs.", { field: "source" });
  const level = optStr(ctx, o, "level");
  if (level !== undefined && !LEVELS.includes(level))
    fail(ctx, "validation.bad_input", "Pick Error, Warning or Info.", { field: "level" });
  const limit = optInt(ctx, o, "limit");
  if (limit !== undefined && (limit < 1 || limit > 1000))
    fail(ctx, "validation.bad_input", "A read is between 1 and 1000 lines.", { field: "limit" });
  const q = optStr(ctx, o, "q");
  if (q !== undefined && q.length > 200)
    fail(ctx, "validation.bad_input", "A search is at most 200 characters.", { field: "q" });
  const scope = optStr(ctx, o, "scope");
  const query = {
    ...(q !== undefined ? { q } : {}),
    ...(source !== undefined ? { source: source as LogSource } : {}),
    ...(scope !== undefined ? { scope } : {}),
    ...(level !== undefined ? { level: level as LogLevel } : {}),
    ...(optInt(ctx, o, "from") !== undefined ? { from: optInt(ctx, o, "from") as number } : {}),
    ...(optInt(ctx, o, "to") !== undefined ? { to: optInt(ctx, o, "to") as number } : {}),
    ...(optInt(ctx, o, "after") !== undefined ? { after: optInt(ctx, o, "after") as number } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
  const scopes = scopeList(ctx, siteId);
  if (source === "build") {
    const ts = terms(q);
    const lines = buildLines(ctx, siteId, scope).filter((l) => matches(l, query, ts));
    const want = limit ?? 200;
    return { lines: lines.slice(-want), lastSeq: lines.at(-1)?.seq ?? 0, scopes };
  }
  const r = st.readLogs(ctx.db, siteId, query);
  const note = leftOut(r.dropped);
  return { lines: r.lines, ...(note ? { leftOut: note } : {}), lastSeq: r.lastSeq, scopes };
}

function scopeList(ctx: Ctx, siteId: string): ScopeOut[] {
  const out: ScopeOut[] = st.logScopes(ctx.db, siteId).map((s) => ({
    scope: s.scope,
    source: s.source,
    title: titleOf(ctx, siteId, s.scope, s.source),
    at: s.lastAt,
    lines: s.lines,
  }));
  // every deploy has a build log, even when its app printed nothing
  for (const d of many(
    ctx,
    "SELECT id, at, log FROM sites_deployment WHERE site_id = ? ORDER BY at DESC LIMIT 20",
    siteId,
  ))
    out.push({
      scope: str(d.id),
      source: "build",
      title: titleOf(ctx, siteId, str(d.id), "build"),
      at: num(d.at),
      lines: parseJson<string[]>(d.log, []).length,
    });
  return out.sort((a, b) => b.at - a.at);
}

export interface MetricsOut {
  window: string;
  samples: ({
    at: number;
    cpu: number;
    memMb: number;
    requests: number;
    errors: number;
    p50: number;
    p95: number;
  } | null)[];
  now: ReturnType<typeof rightNow>;
  /** whether anything has been measured yet, so the page can say "Measuring" instead of showing zero */
  measured: boolean;
  /** whether the ingress reports requests; without it the request charts say so instead of showing a flat line */
  requests: boolean;
}

export async function metricsRead(ctx: Ctx, input: unknown): Promise<MetricsOut> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const w = optStr(ctx, o, "window") ?? "1h";
  const minutes = WINDOWS[w];
  if (minutes === undefined) fail(ctx, "validation.bad_input", "Pick 1h, 6h or 24h.", { field: "window" });
  const now = ctx.now();
  const end = minuteOf(now);
  const from = end - (minutes - 1) * MINUTE;
  const got = st.readSamples(ctx.db, str(site.id), from, end);
  const lim = limitsOf(site);
  const latest = got.filter((s) => s.cpu > 0 || s.memMb > 0).at(-1) ?? got.at(-1) ?? null;
  return {
    window: w,
    samples: bucketed(window(got, now, minutes), POINTS),
    now: rightNow(latest && now - latest.at <= 3 * MINUTE ? latest : null, { cpus: lim.cpus, memoryMb: lim.memoryMb }),
    measured: got.length > 0,
    requests: accessActive(ctx.now()) || got.some((s) => s.requests > 0),
  };
}

export const opsHandlers = {
  "sites.logs_read": (ctx: Ctx, input: unknown) => logsRead(ctx, input),
  "sites.metrics": (ctx: Ctx, input: unknown) => metricsRead(ctx, input),
};
