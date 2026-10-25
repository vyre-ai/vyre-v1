// `vyre-server doctor` with the server down: it reads events.db read-only and the log files, writes nothing, and says what is wrong and what to do next.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { formatDoctor, runDoctor, verifyChainReadOnly } from "../src/daemon/doctor.ts";
import { writeInfo } from "../src/daemon/config.ts";
import { pathsFor } from "../src/daemon/config.ts";
import { openDb } from "../src/daemon/sqlite.ts";
import { LogSink } from "../src/logsink/index.ts";
import { main } from "../src/cli/index.ts";
import type { CliIo } from "../src/cli/index.ts";

/** A data directory with only the two files a dead server leaves behind: events.db (the seeded core Space) and logs.db. */
function deadServerDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-doctor-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const sink = new LogSink({ path: path.join(dir, "logs.db"), batchMs: 0 });
  sink.log({ space: "spc_core", level: 20, msg: "daemon.started" });
  sink.close();
  return dir;
}

const machine = (dir: string, o: { encrypted?: boolean; docker?: boolean; free?: number } = {}) => fakePlatform({
  os: "linux", free: o.free ?? 60e9,
  commands: {
    [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
    "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: o.encrypted === false ? "part\ndisk\n" : "crypt\ndisk\n" },
    ...(o.docker === false ? {} : { "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } }),
  },
});
const caddyOk: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const caddyDown: FetchFn = () => Promise.reject(new Error("ECONNREFUSED"));
const by = (r: Awaited<ReturnType<typeof runDoctor>>, key: string) => r.findings.find((f) => f.key === key)!;
const snapshot = (dir: string): string => fs.readdirSync(dir).sort().map((f) => { const s = fs.statSync(path.join(dir, f)); return `${f}:${s.size}:${s.mtimeMs}`; }).join("|");

test("doctor runs with only events.db and logs.db: it verifies the chain, reads the log, writes nothing, and says the daemon is not running", async () => {
  const dir = deadServerDir();
  try {
    const before = snapshot(dir);
    assert.deepEqual(fs.readdirSync(dir).sort(), ["events.db", "logs.db"], "no pid file, no modules.db, no token: a dead server");
    const r = await runDoctor({ dataDir: dir, platform: machine(dir), fetch: caddyOk });
    assert.equal(by(r, "kernel.events_db").state, "healthy");
    assert.match(by(r, "kernel.events_db").detail, /Chain verifies through event \d+/);
    assert.equal(by(r, "logs.errors").state, "healthy");
    assert.equal(by(r, "host.disk_encrypted").state, "healthy");
    assert.equal(by(r, "host.disk_space").state, "healthy");
    assert.equal(by(r, "host.docker").state, "healthy");
    assert.equal(by(r, "host.caddy").state, "healthy");
    const proc = by(r, "daemon.process");
    assert.equal(proc.state, "degraded");
    assert.match(proc.next, /vyre server start/);
    assert.equal(r.ok, false, "a stopped server is not everything checking out");
    assert.equal(snapshot(dir), before, "doctor changed nothing in the data directory");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a live pid file makes the process check healthy and the whole report ok", async () => {
  const dir = deadServerDir();
  try {
    writeInfo(pathsFor(dir), { pid: process.pid, url: "http://127.0.0.1:1", port: 1, roles: ["space"], space: "spc_core", version: "1", startedAt: 1 });
    const r = await runDoctor({ dataDir: dir, platform: machine(dir), fetch: caddyOk });
    assert.equal(by(r, "daemon.process").state, "healthy");
    assert.equal(r.ok, true);
    assert.match(formatDoctor(r), /Everything checks out/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("an edited event fails the chain and the finding names the restore", async () => {
  const dir = deadServerDir();
  try {
    const db = openDb(path.join(dir, "events.db"));
    db.run("UPDATE events SET event = replace(event, '\"actor\":\"svc_seed\"', '\"actor\":\"svc_evil\"') WHERE seq = 4");
    db.close();
    const r = await runDoctor({ dataDir: dir, platform: machine(dir), fetch: caddyOk });
    const f = by(r, "kernel.events_db");
    assert.equal(f.state, "down");
    assert.match(f.detail, /event 4 was changed after it was written/);
    assert.match(f.next, /Restore from the last backup/);
    assert.match(formatDoctor(r), /Next: Restore from the last backup/);
    assert.equal(verifyChainReadOnly(path.join(dir, "events.db")).ok, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a log cut short at the end is caught by the head the last commit recorded", async () => {
  const dir = deadServerDir();
  try {
    const db = openDb(path.join(dir, "events.db"));
    const last = (db.all("SELECT MAX(seq) AS n FROM events")[0] as { n: number }).n;
    db.run("DELETE FROM events WHERE seq = ?", last);
    db.close();
    const r = verifyChainReadOnly(path.join(dir, "events.db"));
    assert.equal(r.ok, false);
    assert.match(r.why ?? "", /events but \d+ were recorded/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a gap in the sequence, a broken prev link and a file that is not an event log are each reported", () => {
  const dir = deadServerDir();
  try {
    const file = path.join(dir, "events.db");
    const db = openDb(file);
    db.run("DELETE FROM events WHERE seq = 5");
    db.close();
    const gap = verifyChainReadOnly(file);
    assert.equal(gap.ok, false);
    assert.match(gap.why ?? "", /not contiguous/);
    const other = path.join(dir, "other.db");
    const o = openDb(other);
    o.exec("CREATE TABLE log_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE events (seq INTEGER PRIMARY KEY, event TEXT, payload BLOB)");
    o.close();
    assert.match(verifyChainReadOnly(other).why ?? "", /no Space id/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("errors in the last day are counted by message; old ones are not", async () => {
  const dir = deadServerDir();
  try {
    const sink = new LogSink({ path: path.join(dir, "logs.db"), batchMs: 0 });
    for (let i = 0; i < 3; i++) sink.log({ space: "spc_core", level: 40, msg: "provider.timeout" });
    sink.log({ space: "spc_core", level: 40, msg: "disk.write_failed" });
    sink.log({ space: "spc_core", level: 30, msg: "just a warning" });
    sink.db.prepare("INSERT INTO logs (at, level, space, msg) VALUES (?, 40, 'spc_core', 'ancient')").run(Date.now() - 3 * 86_400_000);
    sink.close();
    const r = await runDoctor({ dataDir: dir, platform: machine(dir), fetch: caddyOk });
    const f = by(r, "logs.errors");
    assert.equal(f.state, "degraded");
    assert.match(f.detail, /4 errors in the last 24 hours \(provider\.timeout x3, disk\.write_failed x1\)/);
    assert.ok(!f.detail.includes("ancient"));
    assert.match(f.next, /vyre logs --level error/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("an unencrypted volume, a full disk, no Docker and no Caddy are down, each with its own next step", async () => {
  const dir = deadServerDir();
  try {
    const r = await runDoctor({ dataDir: dir, platform: machine(dir, { encrypted: false, docker: false, free: 3e8 }), fetch: caddyDown });
    assert.equal(by(r, "host.disk_encrypted").state, "down");
    assert.match(by(r, "host.disk_encrypted").next, /FileVault or LUKS/);
    assert.equal(by(r, "host.disk_space").state, "down");
    assert.match(by(r, "host.disk_space").next, /Free disk space/);
    assert.equal(by(r, "host.docker").state, "down");
    assert.match(by(r, "host.docker").next, /Start Docker or Colima/);
    assert.equal(by(r, "host.caddy").state, "down");
    assert.match(by(r, "host.caddy").next, /Restart Caddy/);
    assert.equal(r.ok, false);
    const text = formatDoctor(r);
    assert.match(text, /down\s+host\.disk_encrypted/);
    assert.match(text, /Some checks need attention\./);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a custom disk check replaces the default one", async () => {
  const dir = deadServerDir();
  try {
    const r = await runDoctor({ dataDir: dir, platform: machine(dir, { encrypted: false }), fetch: caddyOk, diskEncrypted: () => Promise.resolve({ state: "healthy", detail: "recorded output says encrypted" }) });
    assert.equal(by(r, "host.disk_encrypted").detail, "recorded output says encrypted");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a data directory with no event log yet is degraded with a plain next step; the device role skips the Space checks", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-doctor-empty-"));
  try {
    const space = await runDoctor({ dataDir: dir, platform: machine(dir), fetch: caddyOk });
    assert.equal(by(space, "kernel.events_db").state, "degraded");
    assert.match(by(space, "kernel.events_db").detail, /no event log/);
    const device = await runDoctor({ dataDir: dir, role: "device", platform: machine(dir) });
    assert.deepEqual(device.findings.map((f) => f.key), ["daemon.process", "host.disk_encrypted", "host.disk_space", "logs.errors"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- through the CLI

function cliIo(dir: string, platform = machine(dir)) {
  let out = "", err = "";
  const io: CliIo = {
    out: (t) => { out += t; }, err: (t) => { err += t; }, env: { VYRE_DATA_DIR: dir }, cwd: dir, platform, tty: false, now: Date.now,
    fetch: (url) => (url.includes("2019") ? Promise.resolve({ status: 200, ok: true, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{}}') }) : Promise.reject(new Error("ECONNREFUSED"))),
    sleep: () => Promise.resolve(),
  };
  return { io, out: () => out, err: () => err };
}

test("`vyre-server doctor` and `vyre doctor --offline` print the local report and exit 1 while the server is stopped", async () => {
  const dir = deadServerDir();
  try {
    const a = cliIo(dir);
    assert.equal(await main(["doctor"], a.io, "vyre-server"), 1);
    assert.match(a.out(), /kernel\.events_db\s+Chain verifies/);
    assert.match(a.out(), /Next: Start it with vyre server start\./);
    const b = cliIo(dir);
    assert.equal(await main(["doctor", "--offline", "--json"], b.io), 1);
    const report = JSON.parse(b.out()) as { ok: boolean; findings: { key: string }[] };
    assert.equal(report.ok, false);
    assert.ok(report.findings.some((f) => f.key === "kernel.events_db"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("`vyre doctor` with no reachable server falls back to the local doctor and says so", async () => {
  const dir = deadServerDir();
  try {
    fs.writeFileSync(path.join(dir, "admin.token"), "tok\n");
    writeInfo(pathsFor(dir), { pid: 999_999_999, url: "http://127.0.0.1:1", port: 1, roles: ["space"], space: "spc_core", version: "1", startedAt: 1 });
    const c = cliIo(dir);
    assert.equal(await main(["doctor"], c.io), 1);
    assert.match(c.err(), /The server does not answer\. Running the local doctor instead\./);
    assert.match(c.out(), /kernel\.events_db/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
