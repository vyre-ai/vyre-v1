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
