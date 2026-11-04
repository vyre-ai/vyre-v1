// The report a daemon sends about its own computer (lane l-machines): the sampler over the real machine, what Vyre runs on it now (the daemon says), what it can run, its version. One reporter per
// daemon: the Space server reads it for its own row, a person's device link and an added server send it over their socket every 30 seconds.
import { execFile } from "node:child_process";
import os from "node:os";
import type { Can, Report, Runs } from "./report.ts";
import { buildReport, createSampler, realDeps } from "./sample.ts";
import type { SampleDeps } from "./sample.ts";

export interface ReporterOpts {
  /** The folder whose disk is reported (the data directory). */
  dataDir: string;
  version: string;
  /** What Vyre runs on this computer right now. */
  runs(): Runs;
  /** The CLI engines this computer runs (driver ids: claude_code, codex, grok). */
  engines(): readonly string[];
  /** A Chrome connected to Vyre on this computer. */
  chrome?(): boolean;
  /** Replace the machine (tests). */
  deps?: SampleDeps;
  /** Replace the Docker question (tests). */
  docker?(): boolean;
}

let dockerAt = 0, dockerUp = false, dockerBusy = false;
/** Whether Docker answers, asked at most every five minutes and never waited for: the first report says no, the next says yes. */
function dockerNow(now: number): boolean {
  if (!dockerBusy && now - dockerAt > 5 * 60_000) {
    dockerBusy = true; dockerAt = now;
    execFile("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 4000 }, (e) => { dockerUp = !e; dockerBusy = false; });
  }
  return dockerUp;
}

export interface Reporter { report(over?: Partial<Runs>): Report; name(): string }

export function createReporter(o: ReporterOpts): Reporter {
  const can = (): Can[] => {
    const out: Can[] = [];
    const e = o.engines();
    if (e.includes("claude_code")) out.push("claude_code");
    if (e.includes("codex")) out.push("codex");
    if (o.docker ? o.docker() : dockerNow(Date.now())) out.push("docker");
    if (o.chrome?.()) out.push("chrome");
    return out;
  };
  const sampler = createSampler(o.deps ?? realDeps({ dataDir: o.dataDir, can }));
  return { report: (over) => buildReport(sampler, { runs: { ...o.runs(), ...(over ?? {}) }, can: can(), version: o.version }), name: () => os.hostname() };
}
