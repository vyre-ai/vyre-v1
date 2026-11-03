// Shared by the server probe files in this directory (they were one file, perf/server/server.test.ts, which passed its 120 s watchdog at full scale). Not a test file.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cacheDir } from "../../fixtures/seed/core/index.ts";
import { loadBudgets } from "../harness/index.ts";
import type { PerfScale } from "../../fixtures/seed/perf/build.ts";
import { issueSessionToken } from "../../host/src/daemon/session.ts";
import { routes } from "../../generated/routes.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";

export const FULL = process.env["VYRE_PERF_FULL"] === "1";
export const SCALE: PerfScale = FULL ? "full" : "ci";
export const scratch = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "perf-server-"));
// The perf template is built once per host and key and shared by every file of this directory: the seed cache (VYRE_SEED_CACHE, else the runner's /var/lib/ci-run/seed-cache-v1, else the OS temp dir).
// Building it at full scale (100k contacts) is most of a cold run, so a file that finds it there only loads it.
export const cache = cacheDir();
export const budget = (id: string) => {
  const b = loadBudgets().find((x) => x.id === id);
  assert.ok(b, `perf/budgets.json has ${id}`);
  return b;
};
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const post = (d: Daemon, cap: string, body: unknown, token = d.token): Promise<Response> => {
  const route = routes.find((r) => r.cap === cap);
  if (!route) throw new Error(`no route for ${cap}`);
  return fetch(`${d.url}${route.path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
};

/** A device session for a person the seed has (what sign-in writes), and its bearer token. */
export function signedIn(d: Daemon, person: string, device: string): string {
  const now = Date.now(), session = `ses_${device.slice(4)}`;
  d.db!.run(`INSERT OR IGNORE INTO devices_device (id, person, name, class, epoch, lastSeenAt, location, revokedAt, version, updated_at, deleted_at) VALUES (?, ?, ?, 'desktop', 0, ?, NULL, NULL, 0, ?, NULL)`, device, person, `${person} laptop`, now, now);
  d.db!.run(`INSERT OR IGNORE INTO devices_session (id, person, kind, principal_kind, device_id, started_at, last_seen_at, location, revoked_at) VALUES (?, ?, 'device', 'person', ?, ?, ?, NULL, NULL)`, session, person, device, now, now);
  return issueSessionToken(d.db!, session);
}

