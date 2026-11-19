// What the Logs tab and the Overview numbers show, as plain functions: a log line as a row, the lines kept while following, the words of a card, the path of a chart. No view code here, so
// each rule is tested alone (r42-sites-run, slice 4).
import { partsIn } from "../../../../../../../lib/zones.ts";

export type Source = "app" | "requests" | "build" | "jobs";
export type Level = "error" | "warn" | "info";
export interface LogLine {
  seq: number;
  at: number;
  source: Source;
  scope: string;
  text: string;
  level: Level;
}

export const SOURCE_CHOICES = [
  { key: "all", title: "All sources" },
  { key: "app", title: "App" },
  { key: "requests", title: "Requests" },
  { key: "build", title: "Build" },
  { key: "jobs", title: "Jobs" },
] as const;
export const LEVEL_CHOICES = [
  { key: "all", title: "Everything" },
  { key: "error", title: "Errors" },
  { key: "warn", title: "Warnings" },
] as const;
export const WINDOW_CHOICES = [
  { key: "live", title: "Live" },
  { key: "1h", title: "Last hour" },
  { key: "6h", title: "Last 6 hours" },
  { key: "24h", title: "Last day" },
] as const;
const HOUR = 3_600_000;
export const WINDOW_MS: Readonly<Record<string, number>> = { "1h": HOUR, "6h": 6 * HOUR, "24h": 24 * HOUR };

/** The most lines kept on the page while following; older ones leave the top, as they leave the store's cap. */
export const KEEP = 1000;

export interface Filters {
  q: string;
  source: string;
  level: string;
  /** a deploy, a service or a job run; "" for all */
  scope: string;
  window: string;
}
export const NO_FILTER: Filters = { q: "", source: "all", level: "all", scope: "", window: "live" };

/** The input of sites.logs_read for a filter. `after` is set only while following and nothing else changed. */
export function readInput(siteId: string, f: Filters, now: number, after?: number): Record<string, unknown> {
  const w = WINDOW_MS[f.window];
  return {
    siteId,
    limit: 500,
    ...(f.q.trim() ? { q: f.q.trim() } : {}),
    ...(f.source !== "all" ? { source: f.source } : {}),
    ...(f.level !== "all" ? { level: f.level } : {}),
    ...(f.scope ? { scope: f.scope } : {}),
    ...(w !== undefined ? { from: now - w } : {}),
    ...(after !== undefined ? { after } : {}),
  };
}

/** A search or a time window is a look at the past, not a follow: only Live with an empty box follows new lines. */
export const following = (f: Filters, paused: boolean): boolean => !paused && f.window === "live" && f.q.trim() === "";

/** New lines added to the ones shown: none twice, in order, the oldest dropped past KEEP. */
export function merge(shown: readonly LogLine[], fresh: readonly LogLine[], keep: number = KEEP): LogLine[] {
  if (fresh.length === 0) return shown as LogLine[];
  const have = new Set(shown.map((l) => l.seq));
  const add = fresh.filter((l) => !have.has(l.seq));
  if (add.length === 0) return shown as LogLine[];
  const all = [...shown, ...add].sort((a, b) => a.seq - b.seq);
  return all.length > keep ? all.slice(all.length - keep) : all;
}

export interface Request {
  method: string;
  path: string;
  status: number;
  ms: number;
}
/** "GET /api/cart 200 12ms" as its parts; null for any other line. */
export function parseRequest(text: string): Request | null {
  const m = /^([A-Z]{3,7}) (\S+) (\d{3}) (\d+)ms$/.exec(text);
  return m ? { method: m[1] as string, path: m[2] as string, status: Number(m[3]), ms: Number(m[4]) } : null;
}

export interface Row {
  seq: number;
  time: string;
  tag: "req" | "app" | "job" | "build";
  text: string;
  status?: number;
  ms?: string;
  tone: "error" | "warn" | "plain";
  /** a second line of a stack ("at charge (...)") reads as part of the one above it */
  more: boolean;
}
const TAG: Readonly<Record<Source, Row["tag"]>> = { app: "app", requests: "req", jobs: "job", build: "build" };

/** The clock in the Space's time: 10:41:27, with the seconds a log needs. */
export function clock(at: number, zone: string): string {
  const p = partsIn(at, zone);
  return [p.hour, p.minute, p.second].map((n) => String(n).padStart(2, "0")).join(":");
}

export function rowOf(l: LogLine, zone: string): Row {
  const r = l.source === "requests" ? parseRequest(l.text) : null;
  const tone: Row["tone"] = r
    ? r.status >= 500
      ? "error"
      : "plain"
    : l.level === "error"
      ? "error"
      : l.level === "warn"
        ? "warn"
        : "plain";
  return {
    seq: l.seq,
    time: clock(l.at, zone),
    tag: TAG[l.source],
    text: r ? `${r.method} ${r.path}` : l.text,
    ...(r ? { status: r.status, ms: `${r.ms} ms` } : {}),
    tone,
    more: /^\s+at\s/.test(l.text),
  };
}

/** A stack line takes the tone of the error above it, so the whole trace is one red block. */
export function rows(lines: readonly LogLine[], zone: string): Row[] {
  const out: Row[] = [];
  for (const l of lines) {
    const r = rowOf(l, zone);
    const prev = out.at(-1);
    if (r.more && prev && prev.tone === "error") r.tone = "error";
    out.push(r);
  }
  return out;
}

/** The text a Copy button puts on the clipboard: what is shown, one line each, with its time. */
export const asText = (lines: readonly LogLine[], zone: string): string =>
  lines.map((l) => `${clock(l.at, zone)} ${l.text}`).join("\n");

export const countWord = (n: number): string => `${n.toLocaleString("en-US")} ${n === 1 ? "line" : "lines"}`;

// ---- the numbers of Overview

export interface Sample {
  at: number;
  cpu: number;
  memMb: number;
  requests: number;
  errors: number;
  p50: number;
  p95: number;
}
export interface Metrics {
  window: string;
  samples: (Sample | null)[];
  now: {
    cpu: { value: number; of: number };
    mem: { valueMb: number; ofMb: number };
    requestsPerMin: number;
    p95: number;
    errorRate: number;
  };
  measured: boolean;
  requests: boolean;
}

export const memText = (mb: number): string =>
  mb >= 1024 ? `${(Math.round((mb / 1024) * 10) / 10).toString()} GB` : `${Math.round(mb)} MB`;
export const msText = (ms: number): string =>
  ms >= 1000 ? `${(Math.round(ms / 100) / 10).toString()} s` : `${Math.round(ms)} ms`;
export const cpuOf = (cpus: number): string => (cpus === 0.5 ? "half a CPU" : cpus === 1 ? "1 CPU" : `${cpus} CPUs`);

export type CardKey = "cpu" | "memory" | "requests" | "response";
export interface Card {
  key: CardKey;
  title: string;
  value: string;
  sub: string;
  series: (number | null)[];
  /** shown in the pane: how to say a number of this kind */
  say(n: number): string;
}

/** The four cards. A site that has not been measured says so instead of showing zeros that read as "all quiet". */
export function cards(m: Metrics | null): Card[] {
  const series = (f: (s: Sample) => number): (number | null)[] => (m?.samples ?? []).map((s) => (s ? f(s) : null));
  const waiting = !m || !m.measured;
  const of = m ? m.now.cpu.of / 100 : 1;
  const pct = (n: number): number => (of > 0 ? Math.round((n / (of * 100)) * 100) : 0);
  return [
    {
      key: "cpu",
      title: "CPU",
      value: waiting ? "Measuring" : `${pct(m.now.cpu.value)}%`,
      sub: waiting ? "" : `of ${cpuOf(of)}`,
      series: series((s) => s.cpu),
      say: (n) => `${pct(n)}%`,
    },
    {
      key: "memory",
      title: "Memory",
      value: waiting ? "Measuring" : memText(m.now.mem.valueMb),
      sub: waiting ? "" : `of ${memText(m.now.mem.ofMb)}`,
      series: series((s) => s.memMb),
      say: memText,
    },
    {
      key: "requests",
      title: "Requests",
      value: waiting || !m.requests ? (waiting ? "Measuring" : "None yet") : String(m.now.requestsPerMin),
      sub: waiting || !m.requests ? "" : "a minute",
      series: series((s) => s.requests),
      say: (n) => `${Math.round(n)} a minute`,
    },
    {
      key: "response",
      title: "Response",
      value: waiting || !m.requests ? (waiting ? "Measuring" : "None yet") : msText(m.now.p95),
      sub: waiting || !m.requests ? "" : "95 in 100 are faster",
      series: series((s) => s.p95),
      say: msText,
    },
  ];
}

export function summary(series: readonly (number | null)[]): { low: number; avg: number; high: number } | null {
  const v = series.filter((x): x is number => x !== null);
  if (v.length === 0) return null;
  return { low: Math.min(...v), avg: v.reduce((a, b) => a + b, 0) / v.length, high: Math.max(...v) };
}

/** The line and the area under it of a series, in a box `w` by `h`. A missing point breaks the line: a quiet hour is drawn as quiet. */
export function paths(
  series: readonly (number | null)[],
  w: number,
  h: number,
  pad = 2,
): { line: string; area: string } {
  const v = series.filter((x): x is number => x !== null);
  if (v.length === 0 || series.length < 2) return { line: "", area: "" };
  const lo = Math.min(...v, 0);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  const step = w / (series.length - 1);
  const y = (n: number): number => Math.round((h - pad - ((n - lo) / span) * (h - 2 * pad)) * 10) / 10;
  const x = (i: number): number => Math.round(i * step * 10) / 10;
  let line = "";
  let area = "";
  let run: [number, number][] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const first = run[0] as [number, number];
    const last = run.at(-1) as [number, number];
    line +=
      `M${first[0]} ${first[1]}` +
      run
        .slice(1)
        .map(([a, b]) => `L${a} ${b}`)
        .join("");
    area +=
      `M${first[0]} ${h}L${first[0]} ${first[1]}` +
      run
        .slice(1)
        .map(([a, b]) => `L${a} ${b}`)
        .join("") +
      `L${last[0]} ${h}Z`;
    run = [];
  };
  series.forEach((n, i) => {
    if (n === null) flush();
    else run.push([x(i), y(n)]);
  });
  flush();
  return { line, area };
}

/** The first and last labels under a chart, in the Space's time: the start of the window and "Now". */
export function edgeLabels(now: number, windowKey: string, zone: string): { from: string; to: string } {
  const ms = WINDOW_MS[windowKey] ?? HOUR;
  const p = partsIn(now - ms, zone);
  return { from: `${p.hour}:${String(p.minute).padStart(2, "0")}`, to: "Now" };
}

// ---- jobs, workers and backups

export type RunState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "canceled"
  | "skipped"
  | "interrupted";
export interface JobRun {
  runId: string;
  jobId: string;
  state: RunState;
  at: number;
  startedAt?: number;
  endedAt?: number;
  exitCode?: number;
  note?: string;
  by: "schedule" | "person";
}
export interface JobOut {
  jobId: string;
  siteId: string;
  name: string;
  schedule: string;
  when: string;
  command: string;
  zone: string;
  enabled: boolean;
  timeoutSec: number;
  nextAt?: number;
  last?: JobRun;
}
export type ServiceState = "stopped" | "starting" | "running" | "backoff" | "failed";
export interface ServiceOut {
  serviceId: string;
  siteId: string;
  name: string;
  kind: string;
  command: string;
  state: ServiceState;
  note?: string;
  startedAt?: number;
  restartAt?: number;
}
export interface BackupOut {
  backupId: string;
  siteId: string;
  state: "queued" | "running" | "ready" | "failed";
  by: string;
  at: number;
  endedAt?: number;
  bytes?: number;
  note?: string;
  pinned?: boolean;
  keepUntil?: number;
}

/** The words a run is called by. */
export const RUN_WORD: Readonly<Record<RunState, string>> = {
  queued: "Waiting",
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
  timed_out: "Timed out",
  canceled: "Canceled",
  skipped: "Skipped",
  interrupted: "Cut short",
};
export type Mark = "ok" | "failed" | "running" | "waiting" | "skipped";
export const runMark = (s: RunState): Mark =>
  s === "succeeded"
    ? "ok"
    : s === "failed" || s === "timed_out" || s === "interrupted"
      ? "failed"
      : s === "running" || s === "queued"
        ? "running"
        : "skipped";

export const SERVICE_WORD: Readonly<Record<ServiceState, string>> = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  backoff: "Restarting",
  failed: "Stopped after crashing",
};
export const serviceMark = (s: ServiceState): Mark =>
  s === "running" ? "ok" : s === "failed" ? "failed" : s === "stopped" ? "skipped" : "running";

/** How long a run took, in the words a person says: 38 s, 4 min 2 s, 1 h 5 min. Nothing for a run that has not both started and ended. */
export function took(r: Pick<JobRun, "startedAt" | "endedAt">): string {
  if (r.startedAt === undefined || r.endedAt === undefined) return "";
  const s = Math.max(0, Math.round((r.endedAt - r.startedAt) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 === 0 ? `${m} min` : `${m} min ${s % 60} s`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
}

export const SCHEDULE_PRESETS = [
  { key: "@hourly", title: "Every hour" },
  { key: "*/15 * * * *", title: "Every 15 minutes" },
  { key: "@daily", title: "Every day at midnight" },
  { key: "0 2 * * *", title: "Every day at 2:00 am" },
  { key: "0 9 * * 1", title: "Every Monday at 9:00 am" },
  { key: "custom", title: "Another schedule" },
] as const;
/** The picker's key for a schedule: a preset when it is one, else Custom. */
export const presetOf = (schedule: string): string =>
  SCHEDULE_PRESETS.some((p) => p.key === schedule && p.key !== "custom") ? schedule : "custom";

/** What a worker row says under its name. */
export function serviceNote(v: ServiceOut): string {
  return v.note ? v.note : SERVICE_WORD[v.state];
}

/** The size of a dump or a database: 48 MB, 1.2 GB. */
export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return memText(bytes / (1024 * 1024));
}

/** The form's check before it asks the server, in one plain sentence; null when it is fine. */
export function jobProblem(f: { name: string; schedule: string; command: string }): string | null {
  if (f.name.trim() === "") return "Give the job a name.";
  if (f.schedule.trim() === "") return "Say when it runs.";
  if (f.command.trim() === "") return "Give the command to run.";
  return null;
}

/** The sentence the restore confirmation puts above the name field: which backup, how big, and what happens first. */
export function restoreSentence(when: string, bytes: number | undefined): string {
  return `Put back the backup from ${when}${bytes !== undefined ? ` (${sizeText(bytes)})` : ""}? A copy of what is in the database now is made first and kept for 7 days. The site's connections drop for a moment while the new database is switched in.`;
}

/** The name typed to confirm matches the site's name (capitals and spaces at the ends do not matter). */
export const confirmOk = (typed: string, siteName: string): boolean =>
  siteName.trim() !== "" && typed.trim().toLowerCase() === siteName.trim().toLowerCase();

export interface DbOut {
  bytes?: number;
  replacedBytes?: number;
}
/** What the Backups header says under its title. */
export function databaseLine(db: DbOut | undefined, hasReady: boolean): string {
  const parts: string[] = [];
  if (db?.bytes !== undefined) parts.push(`The database is ${sizeText(db.bytes)}.`);
  parts.push(hasReady ? "Kept on this server." : "None yet.");
  if (db?.replacedBytes !== undefined)
    parts.push(
      `The database before the last restore (${sizeText(db.replacedBytes)}) is kept until its backup expires.`,
    );
  return parts.join(" ");
}
