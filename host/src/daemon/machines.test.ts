// The machine sampler against a fake operating system, and a report stored from a link.
import test from "node:test";
import assert from "node:assert/strict";
import { createReporter, createSampler, recordLinkedReport, recordSpaceReport } from "./machines.ts";
import type { OsLike } from "./machines.ts";
import { readSeries, readStored } from "../../../lib/machines.ts";
import type { Db } from "../../../lib/machines.ts";
import { openDb } from "./sqlite.ts";
import { readFileSync } from "node:fs";

const fake = (): { os: OsLike; tick(busy: number, idle: number): void } => {
  let user = 0, idle = 0;
  return {
    os: { cpus: () => [{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }, { times: { user, nice: 0, sys: 0, idle, irq: 0 } }], totalmem: () => 8e9, freemem: () => 2e9, platform: () => "linux", arch: () => "x64", release: () => "6.1", type: () => "Linux" },
    tick(b, i) { user += b; idle += i; },
  };
};

test("CPU and network are measured between two samples, memory and disk at once", () => {
  const f = fake(); let t = 1_000_000, rx = 0;
  const s = createSampler({ os: f.os, dir: "/d", version: "1.4.2", now: () => t, disk: () => ({ free: 40e9, total: 160e9 }), net: () => ({ rx, tx: rx / 2 }), self: () => ({ cpuUs: t * 10, rss: 3e8 }) });
  const a = s.sample();
  assert.equal(a.load.cpu, 0, "the first sample has nothing to compare with");
  assert.equal(a.specs.cores, 2);
  assert.equal(a.load.memUsedBytes, 6e9);
  assert.equal(a.load.diskFreeBytes, 40e9);
  f.tick(300, 700); t += 30_000; rx = 60e6;
  const b = s.sample();
  assert.equal(Math.round(b.load.cpu), 30);
  assert.equal(Math.round(b.load.netInBps), 2e6);
  assert.equal(Math.round(b.load.netOutBps), 1e6);
  assert.equal(b.load.vyreMemBytes, 3e8);
});

const migrated = (): Db => {
  const raw = openDb(":memory:", {});
  raw.exec("CREATE TABLE network_server (server_id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, state TEXT NOT NULL, heartbeat_at INTEGER, enrollment TEXT NOT NULL DEFAULT 'approved', owner TEXT, requested_at INTEGER)");
  raw.exec(readFileSync(new URL("../../../modules/network/migrations/0007_machines.sql", import.meta.url), "utf8"));
  return raw as unknown as Db;
};

test("the Space server's report and a person's own computer's report are stored, and the computer gets its own row once", () => {
  const db = migrated(), f = fake();
  const r = createReporter({ os: f.os, dir: "/d", version: "1.4.2", disk: () => ({ free: 40e9, total: 160e9 }), net: () => null, self: () => ({ cpuUs: 0, rss: 1e8 }), runs: () => ({ turns: 2 }), can: () => ["claude_code"], latencyMs: () => 18 });
  db.run("INSERT INTO network_server (server_id, name, role, state, heartbeat_at) VALUES ('srv_local', 'Northwind', 'space', 'healthy', 0)");
  const rep = r.report();
  recordSpaceReport(db, rep, 1_760_000_000_000);
  assert.equal(readStored(db, "srv_local").runs?.turns, 2);
  assert.deepEqual(readStored(db, "srv_local").can, ["claude_code"]);
  const id = recordLinkedReport(db, { device: { deviceId: "dev_ab12", person: "usr_maya", name: "Maya's MacBook" } }, rep, 1_760_000_030_000);
  assert.equal(id, "srv_dev_ab12");
  assert.equal(recordLinkedReport(db, { device: { deviceId: "dev_ab12", person: "usr_maya", name: "Maya's MacBook" } }, rep, 1_760_000_060_000), id, "the same computer, the same row");
  assert.equal((db.all("SELECT server_id FROM network_server WHERE owner = 'usr_maya'") as unknown[]).length, 1);
  assert.equal(recordLinkedReport(db, { device: { deviceId: "dev_ab12", person: "usr_maya" } }, { nonsense: true }, 1), null, "a report that is not one stores nothing");
  assert.equal(readSeries(db, id!, "1h", 1_760_000_060_000).points.filter((p) => p.cpu !== null).length, 2);
});
