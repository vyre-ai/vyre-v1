// A second daemon that boots and stops in the same process must leave the first daemon's module seams as they were (the tests that boot two computers). Before, stopping the second one cleared the
// Space store seam the first one still needed: a type made with schema.apply on the first daemon answered "no type" to records.create, because the records module had been left with a private empty store.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { wireSeams } from "../src/seams/index.ts";
import type { SeamDeps, SeamSetters } from "../src/seams/index.ts";

const OWNER = "tok-usr_olivia";
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-two-daemons-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}
const boot = (dir: string): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({ os: "linux", hostname: "two", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
  fetch: caddyFetch,
  session: (h) => (/^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "two" } : null),
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
} as never);
let n = 0;
async function post(d: Daemon, cap: string, body: Record<string, unknown>): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: JSON.stringify({ idempotencyKey: `two-${++n}`, ...body }) });
  const json = (await r.json()) as { data?: unknown };
  return { status: r.status, data: json.data ?? json };
}

test("a daemon that is already serving keeps its record store when a second daemon boots and stops in the same process", async () => {
  const first = await boot(seededDir());
  try {
    assert.equal((await post(first, "schema.types.list", {})).status, 200, "the first daemon has served work");
    assert.equal((await post(first, "records.create", { type: "contact", fields: { name: "Before", email: "before@x.test" } })).status, 200);
    const second = await boot(seededDir());
    await second.stop();
    const typed = await post(first, "schema.apply", { ops: [{ op: "type.create", type: "rt_client", def: { title: "Client", plural: "Clients", icon: "user", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }] } }] });
    assert.equal(typed.status, 200, JSON.stringify(typed.data));
    const rec = await post(first, "records.create", { type: "rt_client", fields: { name: "Pat Client" } });
    assert.equal(rec.status, 200, `a type made by schema.apply is found by records.create: ${JSON.stringify(rec.data)}`);
  } finally { await first.stop(); }
});

test("seams: when the later daemon stops, the earlier one that is still running gets its own driver back; the last one out clears it", () => {
  let held: unknown = "unset";
  const setters = { setEngineHost: (h: unknown) => { held = h; } } as unknown as SeamSetters;
  const deps = (tag: string): SeamDeps => ({ vault: {}, files: {}, blobs: {}, members: { emails: () => Promise.resolve([]) }, space: "spc_t", tag, drivers: { setEngineHost: () => ({ tag }) } } as unknown as SeamDeps);
  const a = wireSeams(setters, deps("A"));
  const b = wireSeams(setters, deps("B"));
  assert.deepEqual(held, { tag: "B" });
  b.unwire();
  assert.deepEqual(held, { tag: "A" }, "A is wired again, not left with nothing");
  assert.equal(a.owns("setEngineHost"), true);
  a.unwire();
  assert.equal(held, null);
  // the earlier one stopping first leaves the later one's driver, and nothing is restored when it stops
  const c = wireSeams(setters, deps("C"));
  const d = wireSeams(setters, deps("D"));
  c.unwire();
  assert.deepEqual(held, { tag: "D" });
  d.unwire();
  assert.equal(held, null);
});
