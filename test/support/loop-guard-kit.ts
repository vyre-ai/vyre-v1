// The event-loop guard (24 Nov 2026, the Mac-hosted freeze): a sampler that says how late a 10 ms timer fired and, for every block over the bound, who held the loop: the scheduler jobs, hooks and requests that
// were running in that interval and the SQLite statements that took long in it. Everything is measured in the test's own process, where the daemon runs. Nothing here changes the daemon: jobs are wrapped
// from outside (the scheduler's own job table), statements through the node:sqlite prototypes, requests by the driver that makes them.
import { DatabaseSync, StatementSync } from "node:sqlite";
import type { Daemon } from "../../host/src/daemon/daemon.ts";

export interface Span {
  name: string;
  start: number;
  end: number;
}
export interface Block {
  at: number;
  ms: number;
  jobs: string[];
  requests: string[];
  statements: { sql: string; ms: number }[];
  phase: string;
}
export interface Guard {
  blocks: Block[];
  /** a label for the phase the test is in (start-up, requests, tick 1 ...) */
  phase(label: string): void;
  /** time a request as one span: its handler, or what the loop did while the driver waited for its answer */
  request<T>(name: string, run: () => Promise<T>): Promise<T>;
  wrapJobs(d: Daemon): void;
  worst(): { name: string; ms: number }[];
  report(): string;
  stop(): void;
}

const SQL_KEEP_MS = 15;

export function startGuard(boundMs = 100, sampleMs = 10): Guard {
  const t0 = performance.now();
  const blocks: Block[] = [];
  const jobs: Span[] = [];
  const requests: Span[] = [];
  const statements: { sql: string; ms: number; start: number; end: number }[] = [];
  let phaseNow = "start";
  // the statements: every call that took long, with its text, from the node:sqlite prototypes
  const sp = StatementSync.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const dp = DatabaseSync.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const restore: (() => void)[] = [];
  const norm = (s: string): string => s.replace(/\s+/g, " ").replace(/\b\d{3,}\b/g, "N").slice(0, 160);
  for (const m of ["run", "all", "get"]) {
    const orig = sp[m]!;
    sp[m] = function (this: { sourceSQL?: string }, ...a: unknown[]) {
      const s = performance.now();
      try {
        return orig.apply(this, a);
      } finally {
        const e = performance.now();
        if (e - s >= SQL_KEEP_MS) statements.push({ sql: norm(this.sourceSQL ?? "?"), ms: e - s, start: s, end: e });
      }
    };
    restore.push(() => void (sp[m] = orig));
  }
  const oe = dp["exec"]!;
  dp["exec"] = function (this: unknown, sql: unknown) {
    const s = performance.now();
    try {
      return oe.call(this, sql);
    } finally {
      const e = performance.now();
      if (e - s >= SQL_KEEP_MS) statements.push({ sql: norm(String(sql)), ms: e - s, start: s, end: e });
    }
  };
  restore.push(() => void (dp["exec"] = oe));

  let last = performance.now();
  const timer = setInterval(() => {
    const at = performance.now();
    const lag = at - last - sampleMs;
    if (lag > boundMs) {
      const from = last;
      const over = <T extends { start: number; end: number }>(xs: T[]): T[] => xs.filter((x) => x.start < at && x.end > from);
      blocks.push({
        at: Math.round(at - t0),
        ms: Math.round(lag),
        jobs: over(jobs).map((j) => `${j.name} (${Math.round(j.end - j.start)} ms)`),
        requests: over(requests).map((r) => `${r.name} (${Math.round(r.end - r.start)} ms)`),
        statements: over(statements)
          .sort((a, b) => b.ms - a.ms)
          .slice(0, 3)
          .map((x) => ({ sql: x.sql, ms: Math.round(x.ms) })),
        phase: phaseNow,
      });
    }
    last = at;
    // spans that ended before the earliest interval anyone can still ask about are dropped
    const cut = at - 60_000;
    for (const xs of [jobs, requests] as Span[][]) while (xs.length && xs[0]!.end < cut) xs.shift();
    while (statements.length && statements[0]!.end < cut) statements.shift();
  }, sampleMs);

  const wrapped = new WeakSet<object>();
  return {
    blocks,
    phase: (l) => void (phaseNow = l),
    async request(name, run) {
      const start = performance.now();
      try {
        return await run();
      } finally {
        requests.push({ name, start, end: performance.now() });
      }
    },
    wrapJobs(d) {
      // the scheduler's own table: every job's run() is timed from outside, as the span it was in flight
      const table = (d.scheduler as unknown as { jobs: Map<string, { spec: { name: string; run(): unknown } }> }).jobs;
      for (const job of table.values()) {
        if (wrapped.has(job.spec)) continue;
        wrapped.add(job.spec);
        const run = job.spec.run.bind(job.spec);
        job.spec.run = async () => {
          const start = performance.now();
          // an open span while the job runs: a block noticed later still finds it
          const span: Span = { name: job.spec.name, start, end: Number.POSITIVE_INFINITY };
          jobs.push(span);
          try {
            await run();
          } finally {
            span.end = performance.now();
          }
        };
      }
    },
    worst() {
      const by = new Map<string, number>();
      for (const b of blocks) for (const n of [...b.jobs, ...b.requests]) by.set(n.replace(/ \(\d+ ms\)$/, ""), Math.max(by.get(n.replace(/ \(\d+ ms\)$/, "")) ?? 0, b.ms));
      return [...by.entries()].map(([name, ms]) => ({ name, ms })).sort((a, b) => b.ms - a.ms);
    },
    report() {
      return blocks
        .map(
          (b) =>
            `block ${b.ms} ms at +${(b.at / 1000).toFixed(1)} s [${b.phase}] jobs: ${b.jobs.join(", ") || "-"} | requests: ${b.requests.join(", ") || "-"} | statements: ${b.statements.map((s) => `${s.ms} ms ${s.sql}`).join(" ; ") || "-"}`,
        )
        .join("\n");
    },
    stop() {
      clearInterval(timer);
      for (const r of restore) r();
    },
  };
}
