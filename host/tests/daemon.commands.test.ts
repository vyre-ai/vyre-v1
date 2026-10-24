// Host probes against recorded command output, the two command queues (health_restart, network_command), the default network port, and the host tables against the module migrations.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fakePlatform } from "../src/platform/index.ts";
import * as probes from "../src/platform/probes.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { Supervisor } from "../src/supervisor/index.ts";
import type { UnitExit } from "../src/supervisor/index.ts";
import { defaultNetworkPort, pollCommands } from "../src/daemon/commands.ts";
import type { NetworkPort } from "../src/daemon/commands.ts";
import { HOST_TABLES, migrate } from "../src/daemon/hosttables.ts";
import { openDb } from "../src/daemon/sqlite.ts";
import type { HostDb } from "../src/daemon/sqlite.ts";
import { coerceQuery } from "../src/daemon/query.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-daemon-cmd-"));

// ---- probes

test("disk_encrypted on a Mac reads fdesetup: on is healthy, off is down, an unreadable answer is degraded", async () => {
  const mac = (stdout: string, code = 0) => fakePlatform({ os: "darwin", commands: { "fdesetup status": { stdout, code } } });
  assert.equal((await probes.diskEncrypted(mac("FileVault is On.\n"), "/d")).state, "healthy");
  const off = await probes.diskEncrypted(mac("FileVault is Off.\n"), "/d");
  assert.equal(off.state, "down");
  assert.match(off.detail ?? "", /System Settings/);
  assert.equal((await probes.diskEncrypted(mac("", 127), "/d")).state, "degraded");
});

test("disk_encrypted on Linux follows the mount to its device and looks for a crypt layer", async () => {
  const linux = (types: string) => fakePlatform({ os: "linux", commands: { "findmnt -n -o SOURCE --target /srv/vyre": { stdout: "/dev/mapper/vyre-data\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre-data": { stdout: types } } });
  assert.equal((await probes.diskEncrypted(linux("crypt\nlvm\ndisk\n"), "/srv/vyre")).state, "healthy");
  const plain = await probes.diskEncrypted(linux("part\ndisk\n"), "/srv/vyre");
  assert.equal(plain.state, "down");
  assert.match(plain.detail ?? "", /not encrypted/);
  assert.equal((await probes.diskEncrypted(fakePlatform({ os: "linux" }), "/srv/vyre")).state, "degraded", "findmnt missing");
  assert.equal((await probes.diskEncrypted(fakePlatform({ os: "win32" }), "C:\\vyre")).state, "degraded", "not checkable");
  assert.equal(probes.stackIsEncrypted("disk\n crypt \n"), true);
  assert.equal(probes.parseFdesetup("FileVault is On.\nEnabled for the current user."), true);
  assert.equal(probes.parseFdesetup("???"), null);
});

test("disk_space reports bytes and crosses the degraded and down lines", () => {
  const at = (free: number | null) => probes.diskSpace(fakePlatform({ free }), "/d");
  assert.equal(at(50e9).state, "healthy");
  assert.deepEqual(at(50e9).values, { freeBytes: 50e9 });
  assert.equal(at(4.9e9).state, "degraded");
  assert.equal(at(4.9e8).state, "down");
  assert.equal(at(null).state, "degraded");
});

test("docker: running, not running, not installed, timed out", async () => {
  const run = (code: number, stdout = "") => probes.docker(fakePlatform({ commands: { "docker info --format {{.ServerVersion}}": { code, stdout } } }));
  assert.equal((await run(0, "27.1\n")).state, "healthy");
  assert.match((await run(1)).detail ?? "", /not running/);
  assert.match((await probes.docker(fakePlatform())).detail ?? "", /not installed/);
  assert.match((await run(124)).detail ?? "", /did not answer/);
});

test("caddy: routes loaded, no routes, a bad status, no answer", async () => {
  const fx = (r: { ok: boolean; status: number; body: string } | Error): FetchFn => () => (r instanceof Error ? Promise.reject(r) : Promise.resolve({ ok: r.ok, status: r.status, headers: { get: () => null }, text: () => Promise.resolve(r.body) }));
  const now = () => 0;
  assert.equal((await probes.caddy(fx({ ok: true, status: 200, body: '{"apps":{}}' }), "http://x:2019/", now)).state, "healthy");
  assert.equal((await probes.caddy(fx({ ok: true, status: 200, body: "null" }), "http://x:2019", now)).state, "degraded");
  assert.equal((await probes.caddy(fx({ ok: false, status: 500, body: "" }), "http://x:2019", now)).state, "down");
  assert.equal((await probes.caddy(fx(new Error("ECONNREFUSED")), "http://x:2019", now)).state, "down");
});

test("scheduler, events, index and clock probes", async () => {
  assert.equal(probes.schedulerTick(null, 1000).state, "down");
  assert.equal(probes.schedulerTick(1000, 31_000).state, "healthy");
  assert.equal(probes.schedulerTick(1000, 90_000).state, "down");
  assert.equal(probes.eventsDb({ ok: true, seq: 12, latencyMs: 3 }).state, "healthy");
  assert.equal(probes.eventsDb({ ok: true, seq: 12, queue: 500 }).state, "degraded");
  const broken = probes.eventsDb({ ok: false, seq: 7, why: "hash does not match at event 8" });
  assert.equal(broken.state, "down");
  assert.match(broken.detail ?? "", /hash does not match/);
  assert.equal(probes.indexLag(null).state, "healthy");
  assert.equal(probes.indexLag(5).state, "healthy");
  assert.equal(probes.indexLag(500).state, "degraded");
  assert.equal(probes.indexLag(50_000).state, "down");
  assert.equal((await probes.timeSkew(null, null, () => 0)).state, "healthy", "nothing to compare against");
  const date = (ms: number): FetchFn => () => Promise.resolve({ ok: true, status: 200, headers: { get: (n: string) => (n === "date" ? new Date(ms).toUTCString() : null) }, text: () => Promise.resolve("") });
  const t = Date.UTC(2026, 9, 25, 12, 0, 0);
  assert.equal((await probes.timeSkew(date(t), "https://relay", () => t)).state, "healthy");
  const late = await probes.timeSkew(date(t + 120_000), "https://relay", () => t);
  assert.equal(late.state, "degraded");
  assert.ok((late.values?.["skewMs"] ?? 0) >= 119_000);
  assert.equal((await probes.timeSkew(date(t + 400_000), "https://relay", () => t)).state, "down");
  assert.equal((await probes.timeSkew(() => Promise.reject(new Error("offline")), "https://relay", () => t)).state, "degraded");
});

// ---- the queues

function rig() {
  const dir = tmp();
  const db = openDb(path.join(dir, "modules.db"));
  db.exec(HOST_TABLES);
  let t = 5_000;
  const restarted: string[] = [];
  const sup = new Supervisor({ sleep: () => Promise.resolve() });
  for (const name of ["gateway", "scheduler"]) sup.add({ name, start: () => { restarted.push(name); return Promise.resolve({ exited: new Promise<UnitExit>(() => {}), stop: () => Promise.resolve() }); } });
  const calls: string[] = [];
  const network: NetworkPort = {
    checkDns: (d, expected) => { calls.push(`dns ${d} ${expected ?? "-"}`); return Promise.resolve({ ok: d === "space.good.example", records: [{ type: "CNAME", name: d, value: expected ?? "relay.vyre.run" }] }); },
    applyAddress: (a) => { calls.push(`apply ${a.mode} ${a.address}`); return Promise.resolve(); },
    renew: (h) => { calls.push(`renew ${h}`); return Promise.resolve(h === "fail.example" ? { expiresAt: null, reason: "ACME refused" } : { expiresAt: 9_999 }); },
    reconnect: (id) => { calls.push(`reconnect ${id}`); return Promise.resolve(id === "srv_up" ? ("healthy" as const) : ("down" as const)); },
    disconnect: (id) => { calls.push(`disconnect ${id}`); return Promise.resolve(); },
  };
  const deps = { db, supervisor: sup, network, now: () => t };
  const close = () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { db, sup, network, calls, restarted, deps, close, setNow: (n: number) => { t = n; } };
}

const one = (db: HostDb, sql: string, ...a: unknown[]): Record<string, unknown> => (db.all(sql, ...a)[0] ?? {}) as Record<string, unknown>;

test("health_restart: the service is restarted, the row is closed, an unknown service is closed without a restart", async () => {
  const r = rig();
  try {
    await r.sup.startAll();
    r.restarted.length = 0;
    r.db.run("INSERT INTO health_restart (id, service, by_principal, on_behalf, at, done_at) VALUES ('rst_1', 'gateway', 'usr_a', NULL, 10, NULL)");
    r.db.run("INSERT INTO health_restart (id, service, by_principal, on_behalf, at, done_at) VALUES ('rst_2', 'nope', 'usr_a', NULL, 11, NULL)");
    r.db.run("INSERT INTO health_restart (id, service, by_principal, on_behalf, at, done_at) VALUES ('rst_0', 'scheduler', 'usr_a', NULL, 5, 6)");
    assert.equal(await pollCommands(r.deps), 2);
    assert.deepEqual(r.restarted, ["gateway"], "only the open row for a known service restarted something");
    assert.equal(r.sup.status("gateway")[0]?.restarts, 1);
    assert.equal(one(r.db, "SELECT done_at FROM health_restart WHERE id = 'rst_1'")["done_at"], 5_000);
    assert.equal(one(r.db, "SELECT done_at FROM health_restart WHERE id = 'rst_2'")["done_at"], 5_000);
    assert.equal(one(r.db, "SELECT done_at FROM health_restart WHERE id = 'rst_0'")["done_at"], 6, "a closed row is left alone");
    assert.equal(await pollCommands(r.deps), 0, "nothing open the second time");
  } finally { r.close(); }
});

test("network_command set_domain: the DNS check lands in network_dns and only a pass is applied", async () => {
  const r = rig();
  try {
    r.db.run("INSERT INTO network_config (id, address, mode, domain, relay_address, public_ingress, ingress_detail, reported_at) VALUES (1, 'x.vyre.run', 'relay', NULL, 'x.relay.vyre.run', 1, NULL, 1)");
    r.db.run("INSERT INTO network_command (kind, target, by_principal, at, done_at) VALUES ('set_domain', 'space.bad.example', 'usr_a', 1, NULL)");
    r.db.run("INSERT INTO network_command (kind, target, by_principal, at, done_at) VALUES ('set_domain', 'space.good.example', 'usr_a', 2, NULL)");
    assert.equal(await pollCommands(r.deps), 2);
    assert.deepEqual(r.calls, ["dns space.bad.example x.relay.vyre.run", "dns space.good.example x.relay.vyre.run", "apply own_domain space.good.example"]);
    assert.equal(one(r.db, "SELECT ok FROM network_dns WHERE domain = 'space.bad.example'")["ok"], 0);
    assert.equal(one(r.db, "SELECT ok FROM network_dns WHERE domain = 'space.good.example'")["ok"], 1);
    assert.deepEqual(JSON.parse(String(one(r.db, "SELECT records_json FROM network_dns WHERE domain = 'space.bad.example'")["records_json"])), [{ type: "CNAME", name: "space.bad.example", value: "x.relay.vyre.run" }]);
    assert.equal(r.db.all("SELECT 1 FROM network_command WHERE done_at IS NULL").length, 0);
  } finally { r.close(); }
});

test("network_command set_mode, renew, reconnect and remove", async () => {
  const r = rig();
  try {
    r.setNow(7_000);
    r.db.run("INSERT INTO network_config (id, address, mode, domain, relay_address, public_ingress, ingress_detail, reported_at) VALUES (1, 'x.vyre.run', 'relay', NULL, NULL, 1, NULL, 1)");
    r.db.run("INSERT INTO network_cert (host, expires_at, reason, reported_at) VALUES ('fail.example', 4000, NULL, 1)");
    r.db.run("INSERT INTO network_server (server_id, name, role, state, heartbeat_at) VALUES ('srv_up', 'Office Mac', 'compute', 'down', 100)");
    r.db.run("INSERT INTO network_server (server_id, name, role, state, heartbeat_at) VALUES ('srv_dead', 'Old box', 'compute', 'down', 100)");
    r.db.run("INSERT INTO network_server (server_id, name, role, state, heartbeat_at) VALUES ('srv_gone', 'Gone', 'compute', 'down', 100)");
    for (const [i, [kind, target]] of ([["set_mode", "own_domain"], ["renew", "ok.example"], ["renew", "fail.example"], ["reconnect", "srv_up"], ["reconnect", "srv_dead"], ["remove", "srv_gone"]] as const).entries()) {
      r.db.run("INSERT INTO network_command (kind, target, by_principal, at, done_at) VALUES (?, ?, 'usr_a', ?, NULL)", kind, target, i + 1);
    }
    assert.equal(await pollCommands(r.deps), 6);
    assert.deepEqual(r.calls, ["apply own_domain x.vyre.run", "renew ok.example", "renew fail.example", "reconnect srv_up", "reconnect srv_dead", "disconnect srv_gone"]);
    assert.equal(one(r.db, "SELECT expires_at FROM network_cert WHERE host = 'ok.example'")["expires_at"], 9_999);
    const failed = one(r.db, "SELECT expires_at, reason FROM network_cert WHERE host = 'fail.example'");
    assert.equal(failed["expires_at"], 4000, "a failed renewal keeps the old expiry");
    assert.equal(failed["reason"], "ACME refused");
    const up = one(r.db, "SELECT state, heartbeat_at FROM network_server WHERE server_id = 'srv_up'");
    assert.deepEqual([up["state"], up["heartbeat_at"]], ["healthy", 7_000]);
    const dead = one(r.db, "SELECT state, heartbeat_at FROM network_server WHERE server_id = 'srv_dead'");
    assert.deepEqual([dead["state"], dead["heartbeat_at"]], ["down", 100], "still down keeps its last heartbeat");
    assert.equal(r.db.all("SELECT 1 FROM network_server WHERE server_id = 'srv_gone'").length, 0);
  } finally { r.close(); }
});

test("a command that throws is closed so it never loops; an unknown kind too", async () => {
  const r = rig();
  try {
    const logged: string[] = [];
    const deps = { ...r.deps, network: { ...r.network, renew: () => Promise.reject(new Error("socket closed")) }, log: { debug() {}, info() {}, warn() {}, error: (m: string) => { logged.push(m); } } };
    r.db.run("INSERT INTO network_command (kind, target, by_principal, at, done_at) VALUES ('renew', 'a.example', 'usr_a', 1, NULL)");
    r.db.run("INSERT INTO network_command (kind, target, by_principal, at, done_at) VALUES ('teleport', 'x', 'usr_a', 2, NULL)");
    assert.equal(await pollCommands(deps), 2);
    assert.deepEqual(logged, ["command.network_failed", "command.network_failed"]);
    assert.equal(await pollCommands(deps), 0);
  } finally { r.close(); }
});

test("the default network port checks a CNAME, then equal A records, then any A record", async () => {
  const resolver = (cname: Record<string, string[]>, addr: Record<string, string[]>) => ({ cname: (d: string) => Promise.resolve(cname[d] ?? []), address: (d: string) => Promise.resolve(addr[d] ?? []) });
  const p = defaultNetworkPort({ resolver: resolver({ "a.example": ["Relay.Vyre.Run."] }, {}) });
  assert.deepEqual(await p.checkDns("a.example", "relay.vyre.run"), { ok: true, records: [{ type: "CNAME", name: "a.example", value: "relay.vyre.run" }] });
  const byAddress = defaultNetworkPort({ resolver: resolver({}, { "b.example": ["1.2.3.4"], "relay.vyre.run": ["1.2.3.4", "5.6.7.8"] }) });
  assert.equal((await byAddress.checkDns("b.example", "relay.vyre.run")).ok, true);
  assert.equal((await byAddress.checkDns("c.example", "relay.vyre.run")).ok, false, "does not resolve");
  const elsewhere = defaultNetworkPort({ resolver: resolver({}, { "d.example": ["9.9.9.9"], "relay.vyre.run": ["1.2.3.4"] }) });
  assert.equal((await elsewhere.checkDns("d.example", "relay.vyre.run")).ok, false, "points somewhere else");
  assert.equal((await byAddress.checkDns("b.example", null)).ok, true, "no relay to compare with: any address will do");
  assert.deepEqual((await byAddress.checkDns("b.example", null)).records, []);
  const renewed = await p.renew("a.example");
  assert.equal(renewed.expiresAt, null);
  assert.match(renewed.reason ?? "", /No certificate manager/);
  assert.equal(await p.reconnect("srv_x"), null);
});

// ---- the host tables

test("the host creates its tables and runs each module's migrations once", () => {
  const dir = tmp();
  const db = openDb(path.join(dir, "modules.db"));
  try {
    const first = migrate(db, ROOT, () => 1);
    const files = first.map((m) => `${m.module}/${m.file}`);
    for (const f of fs.readdirSync(path.join(ROOT, "modules")).flatMap((m) => (fs.existsSync(path.join(ROOT, "modules", m, "migrations")) ? fs.readdirSync(path.join(ROOT, "modules", m, "migrations")).filter((x) => x.endsWith(".sql")).map((x) => `${m}/${x}`) : []))) {
      assert.ok(files.includes(f), `${f} ran`);
    }
    assert.deepEqual(migrate(db, ROOT, () => 2), [], "the second boot runs nothing");
    for (const t of ["health_probe", "health_service", "health_restart", "network_command", "network_config"]) assert.ok(db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", t).length, `${t} exists`);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the daemon's copy of a table matches the module's own migration column for column, whenever that migration exists", () => {
  const mine = openDb(":memory:");
  mine.exec(HOST_TABLES);
  let compared = 0;
  for (const [module, tables] of [["health", ["health_probe", "health_service", "health_restart"]], ["network", ["network_config", "network_cert", "network_dns", "network_server", "network_endpoint", "network_command"]]] as const) {
    const dir = path.join(ROOT, "modules", module, "migrations");
    if (!fs.existsSync(dir)) continue;
    const theirs = openDb(":memory:");
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) theirs.exec(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const t of tables) {
      const cols = (db: HostDb) => (db.all(`PRAGMA table_info(${t})`) as { name: string; type: string; notnull: number; pk: number }[]).map((c) => `${c.name} ${c.type} ${c.notnull} ${c.pk}`);
      assert.deepEqual(cols(mine), cols(theirs), `${t} drifted from modules/${module}/migrations`);
      compared++;
    }
    theirs.close();
  }
  mine.close();
  assert.ok(compared >= 0);
});

// ---- query typing

test("GET query values are typed by the capability schema", () => {
  const props = { limit: { type: "integer" }, dry: { type: "boolean" }, name: { type: "string" }, ids: { type: "array" }, filter: {}, ratio: { type: "number" } };
  assert.deepEqual(
    coerceQuery({ limit: "25", dry: "true", name: "007", ids: '["a","b"]', filter: '{"a":1}', ratio: "0.5", extra: "x" }, props),
    { limit: 25, dry: true, name: "007", ids: ["a", "b"], filter: { a: 1 }, ratio: 0.5, extra: "x" },
  );
  assert.deepEqual(coerceQuery({ limit: "many", dry: "maybe", ids: "not json" }, props), { limit: "many", dry: "maybe", ids: "not json" }, "what does not parse is left for the validator to refuse");
  assert.deepEqual(coerceQuery({ a: "1" }, undefined), { a: "1" });
});
