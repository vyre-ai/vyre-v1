// Machines: reports in, the rows and series out, the privacy rule, set, alerts, and the points' size.
import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN, DAY, GB, HOUR, IRFAD, MAYA, MIN, T0, admin, host, irfad, maya, report, world } from "../fixtures/world.ts";
import { compact } from "../projections.ts";

const SRV = "srv_berlin1";
const IRFAD_MAC = "device:dev_irfadmac";
const MAYA_AIR = "device:dev_mayaair";

function fleet(f: Parameters<typeof world>[0] = {}) {
  const w = world({
    servers: [{ serverId: SRV, name: "Berlin box" }],
    devices: [{ id: "dev_irfadmac", name: "Irfad's MacBook Pro", person: IRFAD }, { id: "dev_mayaair", name: "Maya's MacBook Air", person: MAYA }],
    ...f,
  });
  w.feed("space", "space", "Northwind server", report({ cpu: 30, mem: 55, cores: 8, can: ["claude_code", "codex", "docker"], turns: 3 }));
  w.feed(SRV, "server", "Berlin box", report({ cpu: 46, mem: 66, cores: 4, can: ["claude_code", "docker"], turns: 2 }), { ownerId: IRFAD, latencyMs: 34 });
  w.feed(IRFAD_MAC, "computer", "Irfad's MacBook Pro", report({ cpu: 58, mem: 81, turns: 4 }), { ownerId: IRFAD, latencyMs: 18 });
  w.feed(MAYA_AIR, "computer", "Maya's MacBook Air", report({ cpu: 22, mem: 58, turns: 1, vyreCpu: 5 }), { ownerId: MAYA, latencyMs: 42 });
  return w;
}

test("a report makes a row; the admin's list shows every machine with its load, what runs and what it can run", async () => {
  const w = fleet();
  const { machines, summary } = await w.call("machines.list", {}, admin);
  assert.deepEqual(machines.map((m: { machineId: string }) => m.machineId), ["space", SRV, IRFAD_MAC, MAYA_AIR]);
  const space = machines[0];
  assert.equal(space.kind, "space");
  assert.equal(space.online, true);
  assert.equal(space.cores, 8);
  assert.deepEqual(space.can, ["claude_code", "codex", "docker"]);
  assert.equal(space.load.cpuPct, 30);
  assert.equal(space.runs.turns, 3);
  assert.equal(machines[1].latencyMs, 34);
  assert.equal(machines[1].name, "Berlin box");
  assert.equal(summary.total, 4);
  assert.equal(summary.online, 4);
});

test("a report that is not one is dropped, and a machine id that is not an id is refused", () => {
  const w = world();
  assert.equal(w.feed("space", "space", "x", { ...report(), specs: { os: "", arch: "x", cores: 1, memBytes: 1, diskBytes: 1 } }), false);
  assert.equal(w.feed("../etc", "server", "x", report()), false);
  assert.equal(w.feed("space", "space", "x", { ...report(), load: { cpuPct: 900, memUsedBytes: 9e30, diskFreeBytes: -5, netInBps: 0, netOutBps: 0 } }), true);
});

test("an admin sees only name, online, capacity and Vyre's own work on a member's own computer; the member sees everything", async () => {
  const w = fleet();
  const a = (await w.call("machines.list", {}, admin)).machines.find((m: { machineId: string }) => m.machineId === MAYA_AIR);
  assert.equal(a.restricted, true);
  assert.equal(a.name, "Maya's MacBook Air");
  assert.equal(a.online, true);
  assert.equal(a.cores, 8);
  assert.equal(a.memBytes, 16 * GB);
  assert.equal(a.limits.maxTurns >= 1, true);
  assert.equal(a.runs.turns, 1);
  assert.deepEqual(a.vyreLoad, { cpuPct: 5, memBytes: 600 * 1024 * 1024 });
  for (const k of ["load", "os", "arch", "gpu", "diskBytes"]) assert.equal(k in a, false, `${k} must not reach an admin`);
  const own = (await w.call("machines.list", {}, maya)).machines.find((m: { machineId: string }) => m.machineId === MAYA_AIR);
  assert.equal(own.restricted, false);
  assert.equal(own.load.cpuPct, 22);
  assert.equal(own.os, "macOS 15.1");
  assert.equal(own.diskBytes, 500 * GB);
  assert.equal("vyreLoad" in own, false);
  // the admin's own computer is theirs in full, and a server is not a member's private machine
  const mine = (await w.call("machines.list", {}, { ...admin, id: IRFAD })).machines.find((m: { machineId: string }) => m.machineId === IRFAD_MAC);
  assert.equal(mine.restricted, false);
  assert.equal((await w.call("machines.list", {}, admin)).machines.find((m: { machineId: string }) => m.machineId === SRV).restricted, false);
});

test("the room tightest cause on a restricted machine never names CPU, memory or disk", async () => {
  const w = world({ devices: [{ id: "dev_mayaair", name: "Maya's MacBook Air", person: MAYA }] });
  w.feed(MAYA_AIR, "computer", "Maya's MacBook Air", report({ cpu: 99 }), { ownerId: MAYA });
  const a = (await w.call("machines.list", {}, admin)).machines[0];
  assert.equal(a.room.tightest, "busy");
  assert.equal((await w.call("machines.list", {}, maya)).machines[0].room.tightest, "cpu");
});

test("a member sees only their own machines; the series of a member's computer for an admin carries only Vyre's share", async () => {
  const w = fleet();
  const mine = (await w.call("machines.list", {}, maya)).machines;
  assert.deepEqual(mine.map((m: { machineId: string }) => m.machineId), [MAYA_AIR]);
  await assert.rejects(w.call("machines.get", { machineId: SRV }, maya), /not in this Space/);
  const g = await w.call("machines.get", { machineId: MAYA_AIR }, admin);
  const last = g.series["1h"].at(-1);
  assert.equal(last.vyreCpuPct, 5);
  for (const k of ["cpuPct", "memPct", "diskFreePct", "netInBps", "netOutBps"]) assert.equal(k in last, false, `${k} must not reach an admin`);
  const own = await w.call("machines.get", { machineId: MAYA_AIR }, maya);
  assert.equal(own.series["1h"].at(-1).cpuPct, 22);
  assert.equal(own.series["1h"].at(-1).diskFreePct, 60);
});

test("a machine that stops reporting is offline after three missed reports, and offline has no room", async () => {
  const w = fleet();
  w.advance(60_000);
  assert.equal((await w.call("machines.list", {}, admin)).machines[2].online, true);
  w.advance(40_000);
  const m = (await w.call("machines.list", {}, admin)).machines;
  assert.equal(m[1].online, false);
  assert.equal(m[1].room.score, 0);
  assert.equal(m[1].room.tightest, "offline");
  assert.equal(m[0].online, true, "the Space server is always up to answer");
  assert.equal("load" in m[1], false, "an offline machine has no load to show");
});

test("series: 1 hour is 60 one-minute points, 24 hours 144, 7 days 168, 30 days 180; a quiet minute is a gap", async () => {
  const w = world();
  for (let i = 0; i < 120; i++) {
    if (i % 7 !== 3) w.feed("space", "space", "S", report({ cpu: i % 100 }));
    w.advance(MIN);
  }
  const g = await w.call("machines.get", { machineId: "space" });
  assert.equal(g.series["1h"].length, 60);
  assert.equal(g.series["24h"].length, 144);
  assert.equal(g.series["7d"].length, 168);
  assert.equal(g.series["30d"].length, 180);
  const withData = g.series["1h"].filter((p: { cpuPct?: number }) => p.cpuPct !== undefined);
  assert.ok(withData.length > 40 && withData.length < 60, "some minutes are gaps");
  assert.ok(g.series["1h"].some((p: { cpuPct?: number }) => p.cpuPct === undefined));
  assert.equal(g.series["1h"].at(-1).t % MIN, 0);
});

test("two reports in one minute average; the points thin to ten minutes after a day and go after 30 days", async () => {
  const w = world();
  w.feed("space", "space", "S", report({ cpu: 10 }));
  w.advance(30_000);
  w.feed("space", "space", "S", report({ cpu: 30 }));
  assert.equal((await w.call("machines.get", { machineId: "space" })).series["1h"].at(-1).cpuPct, 20);
  w.advance(DAY + HOUR);
  assert.ok(compact(w.ctxFor(host)) >= 1);
  const rows = JSON.parse(JSON.stringify(w.db.all("SELECT res, n, cpu FROM machines_point"))) as Array<{ res: number; n: number; cpu: number }>;
  assert.deepEqual(rows, [{ res: 10, n: 2, cpu: 20 }]);
  assert.equal((await w.call("machines.get", { machineId: "space" })).series["30d"].some((p: { cpuPct?: number }) => p.cpuPct === 20), true);
  w.advance(31 * DAY);
  compact(w.ctxFor(host));
  assert.equal(w.db.all("SELECT 1 AS x FROM machines_point").length, 0);
});

test("size budget: a machine reporting every 30 seconds for 30 days keeps under 5700 points and under 700 KB", async () => {
  const { mkdtempSync, rmSync, statSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(`${tmpdir()}/machines-`);
  try {
    const w = world({}, `${dir}/m.db`, true);
    const ctx = w.ctxFor(host);
    w.sqlite.exec("BEGIN");
    for (let i = 0; i < 30 * 24 * 60; i++) {   // a report a minute (a 30-second pair shares a minute point, so the rows are the same)
      w.feed("space", "space", "S", report({ cpu: 20 + ((i * 7) % 50), mem: 40 + ((i * 3) % 30), diskFree: 60 - (i % 20) / 10 }));
      w.advance(60_000);
      if (i % 120 === 0) compact(ctx);
    }
    compact(ctx);
    w.sqlite.exec("COMMIT");
    const n = (w.db.all("SELECT COUNT(*) AS n FROM machines_point")[0] as { n: number }).n;
    assert.ok(n <= 1440 + 29 * 144 + 150, `${n} points`);
    w.sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const bytes = statSync(`${dir}/m.db`).size;
    assert.ok(bytes < 700 * 1024, `${bytes} bytes`);
    w.sqlite.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("machines.set: the owner names and limits their server, an admin may drain a member's computer but not name it, a member cannot touch another's", async () => {
  const w = fleet();
  const r1 = await w.call("machines.set", { machineId: SRV, nickname: "Berlin", maxTurns: 6, maxAgentComputers: 3 }, { ...irfad });
  assert.equal(r1.machine.name, "Berlin");
  assert.equal(r1.machine.limits.maxTurns, 6);
  assert.equal(r1.machine.limits.maxAgentComputers, 3);
  const d = await w.call("machines.set", { machineId: MAYA_AIR, drain: true }, admin);
  assert.equal(d.machine.draining, true);
  assert.equal(d.machine.room.score, 0);
  await assert.rejects(w.call("machines.set", { machineId: MAYA_AIR, nickname: "Hers" }, admin), /Only the person it belongs to/);
  await assert.rejects(w.call("machines.set", { machineId: MAYA_AIR, maxTurns: 9 }, admin), /Only the person it belongs to/);
  await assert.rejects(w.call("machines.set", { machineId: MAYA_AIR, drain: false }, irfad), /not in this Space/);
  await assert.rejects(w.call("machines.set", { machineId: "space", drain: true }, maya), /not in this Space/);
  const ok = await w.call("machines.set", { machineId: MAYA_AIR, nickname: "Air", pinAgent: { agentId: "agt_billing", pinned: true } }, maya);
  assert.equal(ok.machine.nickname, "Air");
  assert.deepEqual(ok.machine.pinned, [{ agentId: "agt_billing" }]);
  assert.ok(w.state.events.some((e) => e.name === "machine.changed" && e.subject === MAYA_AIR));
  await w.call("machines.set", { machineId: MAYA_AIR, nickname: null, pinAgent: { agentId: "agt_billing", pinned: false } }, maya);
  const back = (await w.call("machines.list", {}, maya)).machines[0];
  assert.equal(back.name, "Maya's MacBook Air");
  assert.deepEqual(back.pinned, []);
  await assert.rejects(w.call("machines.set", { machineId: SRV, nickname: "x".repeat(41) }, admin), /40 characters/);
});

test("alerts: disk under 10%, memory pressure with yesterday's number, offline with pinned work, update waiting, backup failed", async () => {
  const w = fleet({ updates: { current: "1.4.1", available: "1.4.2" }, backup: { state: "down" } });
  w.advance(MIN);
  w.feed(SRV, "server", "Berlin box", report({ diskFree: 6, mem: 40 }), { ownerId: IRFAD });
  w.advance(DAY);
  w.feed(SRV, "server", "Berlin box", report({ diskFree: 6, mem: 90, version: "1.4.0" }), { ownerId: IRFAD });
  w.feed("space", "space", "Northwind server", report({ version: "1.4.1" }));
  w.feed(MAYA_AIR, "computer", "Maya's MacBook Air", report({ diskFree: 3, mem: 95 }), { ownerId: MAYA });
  await w.call("machines.set", { machineId: IRFAD_MAC, pinAgent: { agentId: "agt_scout", pinned: true } }, irfad);
  const kinds = (a: Array<{ kind: string; machineId: string }>) => a.map((x) => `${x.kind}:${x.machineId}`).sort();
  const adminAlerts = (await w.call("machines.alerts", {}, admin)).alerts;
  assert.deepEqual(kinds(adminAlerts), [
    `backup_failed:space`, `disk_low:${SRV}`, `memory_pressure:${SRV}`, `offline_pinned:${IRFAD_MAC}`, `update_waiting:${SRV}`, `update_waiting:space`,
  ].sort());
  const mem = adminAlerts.find((a: { kind: string }) => a.kind === "memory_pressure");
  assert.match(mem.detail, /90% in use, up from 40% yesterday/);
  assert.match(adminAlerts.find((a: { kind: string }) => a.kind === "disk_low").next, /Free disk space/);
  // Maya's disk and memory are hers: an admin gets no alert about them, Maya does
  assert.equal(adminAlerts.some((a: { machineId: string }) => a.machineId === MAYA_AIR), false);
  const mine = (await w.call("machines.alerts", {}, maya)).alerts;
  assert.deepEqual(kinds(mine), [`disk_low:${MAYA_AIR}`, `memory_pressure:${MAYA_AIR}`]);
});

test("machines.rooms: the score the Machines page shows is the score placement gets, with the words for why", async () => {
  const w = fleet();
  const r = await w.rooms();
  assert.equal(r[IRFAD_MAC]!.score, 0);
  assert.equal(r[IRFAD_MAC]!.why, "4 of 4 turns");
  assert.equal(r["space"]!.score > 0, true);
  const list = (await w.call("machines.list", {}, admin)).machines;
  for (const m of list) assert.equal(m.room.score, r[m.machineId]!.score);
  w.bind({ turns: (id) => (id === "space" ? 12 : undefined) });
  assert.equal((await w.rooms())["space"]!.why, "12 of 4 turns");
  w.bind(null);
});

test("a removed server or a signed-out computer leaves the list", async () => {
  const w = fleet();
  w.state.fakes.servers = [];
  w.state.fakes.devices = [{ id: "dev_irfadmac", name: "x", person: IRFAD, revokedAt: T0 }, { id: "dev_mayaair", name: "Maya's MacBook Air", person: MAYA }];
  const ids = (await w.call("machines.list", {}, admin)).machines.map((m: { machineId: string }) => m.machineId);
  assert.deepEqual(ids, ["space", MAYA_AIR]);
});

test("agent computers sit under their host", async () => {
  const w = fleet({ computers: [{ computerId: "cmt_a1", agentId: "agt_billing", state: "working", tabs: 2, tabLimit: 8 }, { computerId: "cmt_a3", agentId: "agt_scout", state: "asleep", tabs: 0, tabLimit: 8, nodeId: SRV }] });
  const m = (await w.call("machines.list", {}, admin)).machines;
  assert.deepEqual(m[0].agentComputers.map((c: { computerId: string }) => c.computerId), ["cmt_a1"]);
  assert.deepEqual(m[1].agentComputers.map((c: { computerId: string }) => c.computerId), ["cmt_a3"]);
  assert.equal(m[0].runs.agentComputers, 1);
});
void ADMIN;

test("machines.rooms: a person asks for their own machines and the Space's and gets no words about another person's CPU or disk", async () => {
  const w = fleet();
  w.feed(MAYA_AIR, "computer", "Maya's MacBook Air", report({ cpu: 99 }), { ownerId: MAYA });
  const mine = await w.rooms(irfad);
  assert.equal(mine[IRFAD_MAC]!.why, "4 of 4 turns");
  assert.equal(mine[MAYA_AIR], undefined, "another member's computer is not one to place on, and not one to ask about");
  const asAdmin = await w.rooms(admin);
  assert.equal(asAdmin[MAYA_AIR]!.why, "busy", "an admin sees that it is busy and not why");
  const hers = await w.rooms(maya);
  assert.match(hers[MAYA_AIR]!.why, /CPU at 99%/);
});

test("a machine's page: its findings with the Fix to press, the work on it, and nothing of either on another person's computer", async () => {
  const w = fleet({ updates: { current: "1.4.2" }, turns: [
    { agentId: "agt_scout", asker: IRFAD, startedAt: T0 - 5 * MIN, where: { kind: "computer", name: "Irfad's MacBook Pro", nodeId: IRFAD_MAC } },
    { agentId: "agt_billing", asker: IRFAD, startedAt: T0 - 9 * MIN, where: { kind: "space", name: "the Space's server" } },
    { agentId: "agt_helper", asker: MAYA, startedAt: T0, where: { kind: "computer", name: "Maya's MacBook Air", nodeId: MAYA_AIR } },
  ], sites: [{ name: "Intake form", live: true }, { name: "Old demo", live: false }, { name: "On a computer", live: true, computerId: "cmt_x" }], automations: [{ name: "Invoice reminders" }] });
  w.feed(SRV, "server", "Berlin box", report({ diskFree: 6, mem: 90, version: "1.4.0" }), { ownerId: IRFAD });
  const box = await w.call("machines.get", { machineId: SRV }, admin);
  const fixOf = (g: { findings: Array<{ key: string; fix: string | null; state: string }> }, key: string) => g.findings.find((f) => f.key === key);
  assert.equal(fixOf(box, "disk")!.fix, "clear_caches");
  assert.equal(fixOf(box, "disk")!.state, "down");
  assert.equal(fixOf(box, "memory")!.fix, "stop_idle");
  assert.equal(fixOf(box, "version")!.fix, "update");
  assert.equal(box.privacy, "full");
  const space = await w.call("machines.get", { machineId: "space" }, admin);
  assert.deepEqual(space.work.map((x: { kind: string; what: string; agentId?: string }) => [x.kind, x.agentId ?? x.what]), [["turn", "agt_billing"], ["site", "Serving Intake form"], ["automation", "Automation Invoice reminders is on"]], "live turns, live sites on the server (not on an agent computer, not stopped ones) and automations that are on");
  const mac = await w.call("machines.get", { machineId: IRFAD_MAC }, irfad);
  assert.deepEqual(mac.work.map((x: { agentId?: string }) => x.agentId), ["agt_scout"]);
  const theirs = await w.call("machines.get", { machineId: MAYA_AIR }, admin);
  assert.deepEqual(theirs.findings, [], "health checks of a member's computer stay on it");
  assert.equal(theirs.privacy, "vyre_only");
  assert.deepEqual(theirs.work.map((x: { agentId?: string; what: string }) => [x.agentId, x.what]), [["agt_helper", "Working on a turn"]], "Vyre's own work, no chat, no title");
});

test("Fix: the host runs it and the outcome is kept; an admin cannot fix a member's computer; a bad fix, an offline machine and a made-up service are refused", async () => {
  const w = fleet();
  const ran: string[] = [];
  w.bind({ fix: async (id, fix, service) => { ran.push(`${id}:${fix}${service ? `:${service}` : ""}`); if (fix === "stop_idle") throw new Error("The engine did not answer."); return "Cleared 2 GB of caches and temporary files."; } });
  const ok = await w.call("machines.fix", { machineId: "space", fix: "clear_caches" }, admin);
  assert.deepEqual(ok, { state: "done", detail: "Cleared 2 GB of caches and temporary files." });
  assert.equal((await w.call("machines.get", { machineId: "space" }, admin)).lastFix.detail, ok.detail);
  const failed = await w.call("machines.fix", { machineId: SRV, fix: "stop_idle" }, admin);
  assert.deepEqual(failed, { state: "failed", detail: "The engine did not answer." });
  await w.call("machines.fix", { machineId: "space", fix: "restart_service", service: "caddy" }, admin);
  assert.deepEqual(ran, ["space:clear_caches", `${SRV}:stop_idle`, "space:restart_service:caddy"]);
  await assert.rejects(w.call("machines.fix", { machineId: MAYA_AIR, fix: "clear_caches" }, admin), /Only the person/);
  assert.equal((await w.call("machines.fix", { machineId: MAYA_AIR, fix: "clear_caches" }, maya)).state, "done");
  await assert.rejects(w.call("machines.fix", { machineId: "space", fix: "restart_service", service: "../etc" }, admin), /Name the service/);
  await assert.rejects(w.call("machines.fix", { machineId: "space", fix: "format_disk" }, admin), /not one Vyre knows/);
  await assert.rejects(w.call("machines.fix", { machineId: SRV, fix: "clear_caches" }, maya), /not in this Space/);
  w.advance(5 * MIN);
  await assert.rejects(w.call("machines.fix", { machineId: SRV, fix: "clear_caches" }, admin), /offline/);
  w.bind(null);
});

test("Recent moves: the engine records each move; an admin reads all of them, a member their own; a person cannot write one", async () => {
  const w = fleet();
  await w.call("machines.move_record", { turnId: "trn_1", asker: MAYA, agentId: "agt_scout", from: "Maya's MacBook Air", to: "Berlin box", why: "it was busy, 4 of 4 turns running" }, host);
  w.advance(MIN);
  await w.call("machines.move_record", { asker: IRFAD, from: "Irfad's MacBook Pro", to: "Northwind server", why: "it is draining" }, host);
  assert.deepEqual((await w.call("machines.moves", {}, admin)).moves.map((m: { from: string; to: string }) => `${m.from} > ${m.to}`), ["Irfad's MacBook Pro > Northwind server", "Maya's MacBook Air > Berlin box"], "newest first");
  assert.deepEqual((await w.call("machines.moves", {}, maya)).moves.map((m: { from: string }) => m.from), ["Maya's MacBook Air"]);
  await assert.rejects(w.call("machines.move_record", { from: "x", to: "y", why: "z" }, maya), /Only the engine/);
  for (let i = 0; i < 230; i++) await w.call("machines.move_record", { from: `A${i}`, to: "B", why: "w" }, host);
  assert.equal((await w.call("machines.moves", { limit: 200 }, admin)).moves.length, 200, "kept to the last 200");
});

test("machine.changed: drain, limits, running out of room and having room again, each told once", async () => {
  const w = fleet();
  const told = () => w.state.events.filter((e) => e.name === "machine.changed").map((e) => `${e.subject}:${(e.payload.what as string[]).join()}`);
  await w.call("machines.set", { machineId: SRV, nickname: "Berlin" }, admin);
  await w.call("machines.set", { machineId: SRV, drain: true }, admin);
  await w.call("machines.set", { machineId: SRV, drain: true }, admin);
  await w.call("machines.set", { machineId: SRV, maxTurns: 2 }, admin);
  await w.call("machines.set", { machineId: SRV, maxTurns: 2 }, admin);
  assert.deepEqual(told().filter((x) => !x.endsWith("nickname")), [`${SRV}:drain`, `${SRV}:limits`], "only a real change");
  await w.call("machines.set", { machineId: SRV, drain: false }, admin);
  w.state.events.length = 0;
  await w.call("machines.alerts_notify", {}, host);
  await w.call("machines.alerts_notify", {}, host);
  assert.deepEqual(told(), [`${SRV}:full`, `${IRFAD_MAC}:full`], "Berlin box (2 of 2 turns, as limited above) and Irfad's computer (4 of 4) are full: told once");
  w.feed(IRFAD_MAC, "computer", "Irfad's MacBook Pro", report({ cpu: 20, mem: 40, turns: 0 }), { ownerId: IRFAD });
  w.state.events.length = 0;
  await w.call("machines.alerts_notify", {}, host);
  assert.deepEqual(told(), [`${IRFAD_MAC}:room`]);
  await assert.rejects(w.call("machines.alerts_notify", {}, admin), /Only the host/);
});

test("alerts reach the Inbox once while they last, and again after they cleared", async () => {
  const w = fleet({ backup: { state: "down" } });
  const sent = () => w.state.events.filter((e) => e.name === "machine.alert").length;
  w.feed(SRV, "server", "Berlin box", report({ diskFree: 5 }), { ownerId: IRFAD });
  assert.equal((await w.call("machines.alerts_notify", {}, host)).sent, 2, "the disk and the failed backup");
  assert.equal((await w.call("machines.alerts_notify", {}, host)).sent, 0);
  assert.equal(sent(), 2);
  w.feed(SRV, "server", "Berlin box", report({ diskFree: 60 }), { ownerId: IRFAD });
  await w.call("machines.alerts_notify", {}, host);
  w.advance(MIN);
  w.feed(SRV, "server", "Berlin box", report({ diskFree: 5 }), { ownerId: IRFAD });
  assert.equal((await w.call("machines.alerts_notify", {}, host)).sent, 1, "rings again");
});

test("an agent is pinned to one machine at a time, and machines.rooms names the pin among the machines asked about", async () => {
  const w = fleet();
  await w.call("machines.set", { machineId: SRV, pinAgent: { agentId: "agt_scout", pinned: true } }, admin);
  await w.call("machines.set", { machineId: "space", pinAgent: { agentId: "agt_scout", pinned: true } }, admin);
  assert.deepEqual((await w.call("machines.list", {}, admin)).machines.map((m: { machineId: string; pinned: unknown[] }) => [m.machineId, m.pinned.length]).filter((x: [string, number]) => x[1]), [["space", 1]]);
  assert.equal((await w.call("machines.rooms", { ids: ["space", SRV], agentId: "agt_scout" }, irfad)).pinnedTo, "space");
  assert.equal((await w.call("machines.rooms", { ids: [SRV], agentId: "agt_scout" }, irfad)).pinnedTo, undefined, "a pin on a machine not asked about is not a pin for this turn");
});

test("the Space server's sites and automations are counted from their modules", async () => {
  const w = fleet({ sites: [{ name: "a", live: true }, { name: "b", live: true, computerId: "cmt_1" }], automations: [{ name: "x" }, { name: "y" }] });
  const { periodic } = await import("../impl.ts");
  w.bind({ own: async () => ({ name: "Northwind", report: report() }) });
  await periodic["machines.sample"].run(w.ctxFor(host));
  const space = (await w.call("machines.list", {}, admin)).machines[0];
  assert.deepEqual([space.runs.sites, space.runs.automations], [1, 2]);
  w.bind(null);
});

test("machines.sync: the host calls it when a turn starts or ends on a machine, and the machine's filling up or freeing is told at once", async () => {
  const { hostCalls } = await import("../impl.ts");
  const w = fleet();
  let live = 1;
  w.bind({ turns: (id) => (id === IRFAD_MAC ? live : undefined) });
  const sync = async () => { await hostCalls["machines.sync"](w.ctxFor(host)); };
  const told = () => w.state.events.filter((e) => e.name === "machine.changed").map((e) => `${e.subject}:${(e.payload.what as string[]).join()}`);
  await sync();
  assert.deepEqual(told(), [`${SRV}:full`], "Berlin box runs 2 of 2 turns already; Irfad's computer, 1 of 4, has room");
  live = 4;
  await sync(); await sync();
  assert.deepEqual(told(), [`${SRV}:full`, `${IRFAD_MAC}:full`], "the fourth turn started: full, told once");
  live = 3;
  await sync();
  assert.deepEqual(told(), [`${SRV}:full`, `${IRFAD_MAC}:full`, `${IRFAD_MAC}:room`], "one ended: room again");
  w.bind(null);
});

test("stop idle sessions: the Space server's is Space-wide; on a member's own computer only that member's, and the page says how many", async () => {
  const w = fleet();
  const calls: Array<[string, string | undefined]> = [];
  w.bind({ fix: async (id, _f, _s, person) => { calls.push([id, person]); return "ok"; }, idle: (id, person) => (id === "space" ? 7 : person === MAYA ? 2 : 0) });
  await w.call("machines.fix", { machineId: "space", fix: "stop_idle" }, admin);
  await w.call("machines.fix", { machineId: MAYA_AIR, fix: "stop_idle" }, maya);
  await w.call("machines.fix", { machineId: SRV, fix: "stop_idle" }, admin);
  assert.deepEqual(calls, [["space", undefined], [MAYA_AIR, MAYA], [SRV, IRFAD]], "the Space is asked for everyone's; a computer or a server for its owner's");
  assert.equal((await w.call("machines.get", { machineId: "space" }, admin)).idleSessions, 7);
  assert.equal((await w.call("machines.get", { machineId: MAYA_AIR }, maya)).idleSessions, 2);
  assert.equal((await w.call("machines.get", { machineId: MAYA_AIR }, admin)).idleSessions, 0, "an admin is told nothing of a member's own sessions");
  w.bind(null);
});

test("a server the Space approved that has not reported yet is listed offline and opens, so an admin can remove it; a member does not see it", async () => {
  const w = world({ servers: [{ serverId: "srv_quiet1", name: "Office Linux box" }, { serverId: "srv_asking1", name: "Stranger", enrollment: "pending" }] });
  w.feed("space", "space", "Northwind server", report({ cpu: 30, mem: 55, cores: 8, can: ["docker"], turns: 0 }));
  const list = await w.call("machines.list", {}, admin);
  const quiet = list.machines.find((m: any) => m.machineId === "srv_quiet1");
  assert.ok(quiet, "listed");
  assert.equal(quiet.online, false);
  assert.equal(list.machines.some((m: any) => m.machineId === "srv_asking1"), false, "a computer still asking to join is not a machine yet");
  const one = await w.call("machines.get", { machineId: "srv_quiet1" }, admin);
  assert.equal(one.machine.name, "Office Linux box");
  const mine = await w.call("machines.list", {}, maya);
  assert.equal(mine.machines.some((m: any) => m.machineId === "srv_quiet1"), false);
});

test("machines.rooms carries the most agent computers a machine runs, the same number the list shows, and the Space server's reaches a member", async () => {
  const w = fleet();
  const list = (await w.call("machines.list", {}, admin)).machines;
  const asked = await w.call("machines.rooms", { ids: ["space"] }, { ...admin, id: IRFAD });
  const room = asked.rooms.find((x: { machineId: string }) => x.machineId === "space");
  assert.equal(typeof room.maxAgentComputers, "number");
  assert.equal(room.maxAgentComputers, list.find((m: { machineId: string }) => m.machineId === "space").limits.maxAgentComputers);
});
