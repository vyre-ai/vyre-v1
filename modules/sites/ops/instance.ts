// The one collector of a server (r42-sites-run): created on the first tick with what the host gives it, and fed access lines by the ingress.
// The host calls `opsTick` from its scheduler and `accessLine` for each line of the ingress's access log; the handlers ask `accessActive` to know whether request charts can be trusted.
import { mintUuid } from "../../../lib/ids.ts";
import { Collector } from "./collect.ts";
import type { CollectRunner } from "./collect.ts";
import { Supervisor } from "./supervisor.ts";
import type { SuperRunner } from "./supervisor.ts";
import type { OpsDb } from "./store.ts";

export interface OpsHost {
  runner(): (CollectRunner & SuperRunner) | null;
  siteOfHost(db: OpsDb, host: string): string | null;
}

let col: { c: Collector; s: Supervisor; db: OpsDb } | null = null;
let lastAccess = 0;
/** The ingress counts as reporting while a line came in the last ten minutes (a quiet site sends none, and its charts then say nothing is wrong either). */
const ACCESS_FRESH_MS = 10 * 60_000;
let seenEver = false;

function parts(db: OpsDb, host: OpsHost): { c: Collector; s: Supervisor } {
  if (col && col.db === db) return col;
  const c = new Collector({
    db,
    runner: () => host.runner(),
    now: () => Date.now(),
    siteOfHost: (h) => host.siteOfHost(db, h),
  });
  const s = new Supervisor({
    db,
    runner: () => host.runner(),
    now: () => Date.now(),
    drain: (t) => c.drain(t),
    id: (prefix) => `${prefix}_${mintUuid(Date.now()).replaceAll("-", "")}`,
  });
  col = { c, s, db };
  return col;
}

export async function opsTick(db: OpsDb, host: OpsHost): Promise<void> {
  const p = parts(db, host);
  await p.c.tick();
  await p.s.tick();
}

export function accessLine(db: OpsDb, host: OpsHost, line: string): void {
  seenEver = true;
  lastAccess = Date.now();
  parts(db, host).c.access(line);
}

export function accessActive(now: number): boolean {
  return seenEver && now - lastAccess < ACCESS_FRESH_MS;
}

/** For tests: forget the collector and what was seen. */
export function resetOps(): void {
  col = null;
  lastAccess = 0;
  seenEver = false;
}
