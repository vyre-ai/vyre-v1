// Machines through the real handlers: the list and what each person may see of it, a machine's history and findings, nickname, limits, Drain and pins, placement and the alerts sent once.
// @reads ../migrations/0007_machines.sql
// @reads ../migrations/0008_machine_moves.sql

import test from "node:test";
import assert from "node:assert/strict";
import { harness, NOW } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { machine, machineAlerts, machineAlertsNotify, machineFix, machineMoveRecord, machineMoves, machinePin, machinePlace, machineSet, machines } from "../handlers/index.ts";
import { DAY, MINUTE, recordReport } from "../../../lib/machines.ts";
import type { Report } from "../../../lib/machines.ts";

const GB = 1e9;
const report = (o: { cpu?: number; mem?: number; diskFree?: number; turns?: number; version?: string; can?: string[]; vyreCpu?: number } = {}): Report => ({
  specs: { os: "Debian 12", arch: "x64", cores: 4, memBytes: 8 * GB, diskBytes: 160 * GB, version: o.version ?? "1.4.2" },
  load: { cpu: o.cpu ?? 20, memUsedBytes: (o.mem ?? 40) / 100 * 8 * GB, diskFreeBytes: o.diskFree ?? 100 * GB, netInBps: 2e6, netOutBps: 1e6, vyreCpu: o.vyreCpu ?? 5, vyreMemBytes: 0.5 * GB },
  runs: { turns: o.turns ?? 1, agentComputers: 0, sites: 0, automations: 0, work: [{ agent: "Research", what: "Market scan", where: "Research run #419", cpu: 14 }] },
  can: o.can ?? ["claude_code", "docker"],
  latencyMs: 30,
});
const server = (h: Harness, id: string, name: string, role: string, owner: string | null, beat: number | null = NOW): void => {
  h.raw.run("INSERT OR REPLACE INTO network_server (server_id, name, role, state, heartbeat_at, enrollment, owner) VALUES (?, ?, ?, ?, ?, ?, ?)", id, name, role, "healthy", beat, "approved", owner);
};
function space(h: Harness): void {
  server(h, "srv_local", "Northwind server", "space", null);
  server(h, "srv_box", "Berlin box", "compute", null);
  server(h, "srv_dev_mbp", "Maya's MacBook", "compute", "usr_maya");
  recordReport(h.raw, "srv_local", report({ cpu: 30 }), NOW);
  recordReport(h.raw, "srv_box", report({ cpu: 40, diskFree: 12 * GB }), NOW);
  recordReport(h.raw, "srv_dev_mbp", report({ cpu: 70, mem: 60, vyreCpu: 9 }), NOW);
}

test("an admin sees every machine, a member's own computer only as name, online, capacity and Vyre's work", async () => {
  const h = harness(); space(h);
  const out = await machines(h.ctx, {});
  assert.deepEqual(out.machines.map((m) => m.serverId).sort(), ["srv_box", "srv_dev_mbp", "srv_local"]);
  const mbp = out.machines.find((m) => m.serverId === "srv_dev_mbp")!;
  assert.equal(mbp.private, true);
  assert.equal(mbp.load, undefined, "no whole-machine load");
  assert.equal(mbp.cores, 4);
  assert.equal(mbp.vyre?.cpu, 9, "Vyre's own share is there");
  assert.ok(out.machines.find((m) => m.serverId === "srv_box")!.load, "a server the Space holds shows its load");
});

test("a member sees only their own machines, in full", async () => {
  const h = harness({ principal: "usr_maya", admin: false }); space(h);
  const out = await machines(h.ctx, {});
  assert.deepEqual(out.machines.map((m) => m.serverId), ["srv_dev_mbp"]);
  assert.equal(out.machines[0]!.mine, true);
  assert.equal(out.machines[0]!.load?.cpu, 70);
  const other = harness({ principal: "usr_omar", admin: false }); space(other);
  assert.deepEqual((await machines(other.ctx, {})).machines, []);
});

test("alerts: a nearly full disk, memory pressure, an offline machine with pinned work; another person's disk is not the admin's business", async () => {
  const h = harness(); space(h);
  recordReport(h.raw, "srv_dev_mbp", report({ diskFree: 5 * GB, mem: 92 }), NOW);
  await machinePin(h.ctx, { serverId: "srv_box", agentId: "agt_scout", pinned: true });
  const first = (await machineAlerts(h.ctx, {})).alerts.map((a) => a.alertId);
  assert.ok(first.includes("disk:srv_box"));
  assert.ok(!first.some((k) => k.endsWith("srv_dev_mbp")), "Maya's disk and memory are hers");
  h.setNow(NOW + 10 * 60_000);
  const kinds = (await machineAlerts(h.ctx, {})).alerts.map((a) => a.alertId);
  assert.ok(kinds.includes("offline:srv_box"), "no report for ten minutes: the server is down with Scout pinned to it");
  const mine = harness({ principal: "usr_maya", admin: false }); space(mine);
  recordReport(mine.raw, "srv_dev_mbp", report({ diskFree: 5 * GB, mem: 92 }), NOW);
  assert.deepEqual((await machineAlerts(mine.ctx, {})).alerts.map((a) => a.kind).sort(), ["disk", "memory"], "she hears of her own");
});

test("a machine page: history by range, findings with a fix, privacy for another person's computer", async () => {
  const h = harness(); space(h);
  for (let i = 1; i <= 90; i++) recordReport(h.raw, "srv_box", report({ cpu: 40 + (i % 10), diskFree: 12 * GB }), NOW + i * MINUTE);
  h.setNow(NOW + 90 * MINUTE);
  const one = await machine(h.ctx, { serverId: "srv_box", range: "1h" });
  assert.equal(one.series.points.length, 60);
  assert.ok(one.series.points[59]!.cpu !== null);
  assert.ok(one.findings.some((f) => f.key === "disk" && f.fix === "clear_caches"), "disk 92% full has a fix");
  const day = await machine(h.ctx, { serverId: "srv_box", range: "30d" });
  assert.equal(day.series.points.length, 180);
  const theirs = await machine(h.ctx, { serverId: "srv_dev_mbp", range: "1h" });
  assert.equal(theirs.privacy, "vyre_only");
  assert.deepEqual(theirs.findings, []);
  assert.deepEqual(theirs.work, []);
  assert.ok(theirs.series.points.every((p) => p.disk === null && p.netIn === null), "only Vyre's share is charted");
  await assert.rejects(() => machine(h.ctx, { serverId: "srv_nope" }), /not here/);
});

test("history: a minute point for a day, ten-minute points after, nothing after 30 days", async () => {
  const h = harness(); server(h, "srv_box", "Berlin box", "compute", null);
  const t0 = NOW - 40 * DAY;
  recordReport(h.raw, "srv_box", report(), t0);
  const day2 = NOW - 2 * DAY - 7 * MINUTE;
  for (let i = 0; i < 20; i++) recordReport(h.raw, "srv_box", report({ cpu: 10 + i }), day2 + i * MINUTE);
  recordReport(h.raw, "srv_box", report(), NOW - NOW % (10 * MINUTE));   // a ten-minute boundary folds the old points
  const steps = h.raw.rows("network_machine_point").map((r) => `${r["step"]}`);
  assert.ok(steps.includes(String(10 * MINUTE)), "old minutes were folded into ten-minute points");
  assert.ok(h.raw.rows("network_machine_point").every((r) => Number(r["t"]) >= NOW - 30 * DAY), "nothing older than 30 days is kept");
  const week = await machine(harness().ctx, { serverId: "srv_none" }).catch((e: Error) => e.message);
  assert.match(String(week), /not here/);
});

test("nickname, limits, Drain and pins: an admin changes the Space's, only the owner changes a member's own computer", async () => {
  const h = harness(); space(h);
  const set = await machineSet(h.ctx, { serverId: "srv_box", nickname: "  Berlin  ", maxTurns: 4, maxAgentComputers: 2, drain: true });
  assert.equal(set.machine.nickname, "Berlin");
  assert.deepEqual(set.machine.limits, { maxTurns: 4, maxAgentComputers: 2 });
  assert.equal(set.machine.room.n, 0, "drained: no room");
  assert.equal(set.machine.room.why, "draining");
  await assert.rejects(() => machineSet(h.ctx, { serverId: "srv_box", maxTurns: 1000 }), /whole number/);
  await assert.rejects(() => machineSet(h.ctx, { serverId: "srv_dev_mbp", nickname: "Mine now" }), /Only the person/);
  const maya = harness({ principal: "usr_maya", admin: false }); space(maya);
  assert.equal((await machineSet(maya.ctx, { serverId: "srv_dev_mbp", nickname: "Desk" })).machine.nickname, "Desk");
  await assert.rejects(() => machineSet(maya.ctx, { serverId: "srv_box", drain: true }), /network permission/);
  const pinned = await machinePin(h.ctx, { serverId: "srv_box", agentId: "agt_scout", pinned: true });
  assert.deepEqual(pinned.machine.pins, ["agt_scout"]);
  await machinePin(h.ctx, { serverId: "srv_local", agentId: "agt_scout", pinned: true });
  assert.deepEqual((await machines(h.ctx, {})).machines.find((m) => m.serverId === "srv_box")!.pins, [], "an agent is pinned to one machine at a time");
});

test("placement keeps the person's order but skips a busy machine for the next with room, and says why", async () => {
  const h = harness(); space(h);
  h.raw.run("INSERT OR REPLACE INTO network_machine (server_id, nickname, max_turns, max_pcs, drain, pins_json, specs_json, load_json, run_json, can_json, latency_ms, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", "srv_dev_mbp", "Desk", 4, null, 0, "[]", JSON.stringify(report().specs), JSON.stringify(report({ cpu: 20 }).load), JSON.stringify({ ...report({ turns: 4 }).runs }), JSON.stringify(["claude_code"]), 20, NOW);
  const p = await machinePlace(h.ctx, { order: ["srv_dev_mbp", "srv_box", "srv_local"] });
  assert.equal(p.serverId, "srv_local", "the server is at 92% disk, so it is skipped too");
  assert.deepEqual(p.skipped.map((s) => s.serverId), ["srv_dev_mbp", "srv_box"]);
  assert.equal(p.moved, true);
  assert.equal(p.line, "Moved from Desk because it was busy, 4 of 4 turns running");
  const calm = await machinePlace(h.ctx, { order: ["srv_local", "srv_box"] });
  assert.equal(calm.serverId, "srv_local");
  assert.equal(calm.line, null);
});

test("each new alert reaches the Inbox once while it lasts, and rings again after it cleared", async () => {
  const h = harness({ kind: "service", principal: "svc_host" }); space(h);
  recordReport(h.raw, "srv_box", report({ diskFree: 5 * GB }), NOW);
  assert.equal((await machineAlertsNotify(h.ctx, {})).sent, 1);
  assert.equal(h.events.filter((e) => e.name === "network.machine_alert").length, 1);
  assert.equal((await machineAlertsNotify(h.ctx, {})).sent, 0, "not sent twice");
  recordReport(h.raw, "srv_box", report({ diskFree: 100 * GB }), NOW + MINUTE);
  await machineAlertsNotify(h.ctx, {});
  recordReport(h.raw, "srv_box", report({ diskFree: 5 * GB }), NOW + 2 * MINUTE);
  assert.equal((await machineAlertsNotify(h.ctx, {})).sent, 1, "back after it cleared");
  await assert.rejects(() => machineAlertsNotify(harness().ctx, {}), /Only the host/);
});

test("Recent moves: the engine records each move; an admin reads all of them, a member their own; a person cannot write one", async () => {
  const h = harness(); space(h);
  const svc = harness({ kind: "service", principal: "svc_host" });
  const sys = (x: typeof h) => Object.assign(x.ctx, { depth: 1 });
  void svc;
  await machineMoveRecord(sys(h), { turnId: "trn_1", asker: "usr_maya", agentId: "agt_scout", threadId: "thr_1", from: "Maya's MacBook", to: "Berlin box", why: "busy, 4 of 4 turns running" });
  h.setNow(NOW + MINUTE);
  await machineMoveRecord(sys(h), { asker: "usr_omar", from: "Omar's iMac", to: "Northwind server", why: "it is offline" });
  Object.assign(h.ctx, { depth: 0 });
  const all = (await machineMoves(h.ctx, {})).moves;
  assert.deepEqual(all.map((m) => `${m.from} > ${m.to}`), ["Omar's iMac > Northwind server", "Maya's MacBook > Berlin box"], "newest first");
  assert.equal(all[1]!.why, "busy, 4 of 4 turns running");
  const mine = harness({ principal: "usr_maya", admin: false }); space(mine);
  mine.raw.run("INSERT INTO network_machine_move (at, asker, from_name, to_name, why) VALUES (?, ?, ?, ?, ?)", NOW, "usr_maya", "A", "B", "w");
  mine.raw.run("INSERT INTO network_machine_move (at, asker, from_name, to_name, why) VALUES (?, ?, ?, ?, ?)", NOW, "usr_omar", "C", "D", "w");
  assert.deepEqual((await machineMoves(mine.ctx, {})).moves.map((m) => m.from), ["A"]);
  await assert.rejects(() => machineMoveRecord(mine.ctx, { from: "x", to: "y", why: "z" }), /Only the engine/);
});

test("a change that moves the next turn emits network.machine_changed: Drain, limits, running out of room and having room again", async () => {
  const h = harness(); space(h);
  await machineSet(h.ctx, { serverId: "srv_box", nickname: "Berlin" });
  assert.equal(h.events.filter((e) => e.name === "network.machine_changed").length, 0, "a new name moves nothing");
  await machineSet(h.ctx, { serverId: "srv_box", drain: true });
  await machineSet(h.ctx, { serverId: "srv_box", drain: true });
  await machineSet(h.ctx, { serverId: "srv_box", maxTurns: 2 });
  const ev = h.events.filter((e) => e.name === "network.machine_changed").map((e) => (e.payload as { what: string[] }).what.join());
  assert.deepEqual(ev, ["drain", "limits"], "only a real change is told");
  await machineSet(h.ctx, { serverId: "srv_box", drain: false });
  const host = harness({ kind: "service", principal: "svc_host" }); space(host);
  recordReport(host.raw, "srv_box", report({ cpu: 95, turns: 1 }), NOW);
  await machineAlertsNotify(host.ctx, {});
  await machineAlertsNotify(host.ctx, {});
  assert.deepEqual(host.events.filter((e) => e.name === "network.machine_changed").map((e) => (e.payload as { what: string[] }).what.join()), ["full"], "told once when the room runs out");
  recordReport(host.raw, "srv_box", report({ cpu: 20 }), NOW + MINUTE);
  await machineAlertsNotify(host.ctx, {});
  assert.deepEqual(host.events.filter((e) => e.name === "network.machine_changed").map((e) => (e.payload as { what: string[] }).what.join()), ["full", "room"]);
});

test("Fix: an admin queues one on the Space server or a server; only the owner on a member's computer; a bad one and an offline machine are refused", async () => {
  const h = harness(); space(h);
  const q = await machineFix(h.ctx, { serverId: "srv_box", fix: "clear_caches" }) as { queued: boolean; commandId: number };
  assert.equal(q.queued, true);
  assert.deepEqual(h.raw.rows("network_command").map((r) => [r["kind"], r["target"]]).at(-1), ["machine_fix", "srv_box:clear_caches"]);
  await machineFix(h.ctx, { serverId: "srv_local", fix: "restart_service", service: "caddy" });
  assert.equal(String(h.raw.rows("network_command").at(-1)!["target"]), "srv_local:restart_service:caddy");
  await assert.rejects(() => machineFix(h.ctx, { serverId: "srv_dev_mbp", fix: "stop_idle" }), /Only the person/);
  await assert.rejects(() => machineFix(h.ctx, { serverId: "srv_local", fix: "restart_service", service: "../etc" }), /Name the service/);
  await assert.rejects(() => machineFix(h.ctx, { serverId: "srv_local", fix: "format_disk" as never }), /not one Vyre knows/);
  const maya = harness({ principal: "usr_maya", admin: false }); space(maya);
  assert.equal(((await machineFix(maya.ctx, { serverId: "srv_dev_mbp", fix: "stop_idle" })) as { queued: boolean }).queued, true);
  await assert.rejects(() => machineFix(maya.ctx, { serverId: "srv_box", fix: "stop_idle" }), /network permission/);
  h.setNow(NOW + 20 * MINUTE);
  await assert.rejects(() => machineFix(h.ctx, { serverId: "srv_box", fix: "stop_idle" }), /offline/);
  // its outcome shows on the machine page once the host has run it
  const id = Number(h.raw.rows("network_command").find((r) => String(r["target"]) === "srv_box:clear_caches")!["id"]);
  h.raw.run("UPDATE network_command SET done_at = ? WHERE id = ?", NOW, id);
  h.raw.run("INSERT INTO network_result (id, kind, target, state, detail, at) VALUES (?, ?, ?, ?, ?, ?)", id, "machine_fix", "srv_box:clear_caches", "applied", "Cleared 2 GB of caches and temporary files.", NOW);
  const page = await machine(h.ctx, { serverId: "srv_local" });
  assert.deepEqual(page.lastFix, { fix: "restart_service", at: NOW, state: "queued" }, "the Space server's fix is waiting for the host");
  recordReport(h.raw, "srv_box", report(), NOW + 20 * MINUTE);
  const box = await machine(h.ctx, { serverId: "srv_box" });
  assert.deepEqual(box.lastFix, { fix: "clear_caches", at: box.lastFix!.at, state: "done", detail: "Cleared 2 GB of caches and temporary files." });
});
