// lib/machines.ts: a report off the wire made safe, the room score, placement and the words that say a turn moved.
import test from "node:test";
import assert from "node:assert/strict";
import { BUSY_BELOW, alertsOf, cleanReport, diskPct, findingsOf, memPct, movedLine, place, roomOf } from "./machines.ts";
import type { Candidate } from "./machines.ts";

test("a report off the wire is cut to size and a nonsense one is refused", () => {
  assert.equal(cleanReport(null), null);
  assert.equal(cleanReport({ specs: {} }), null);
  const r = cleanReport({ specs: { os: "x".repeat(200), cores: 99999, memBytes: 8e9, diskBytes: 1e11, version: "1.4.2" }, load: { cpu: 400, memUsedBytes: 4e9, diskFreeBytes: 5e10, netInBps: -5, netOutBps: 1 }, runs: { turns: 2.6, work: [{ agent: "A", cpu: 900 }, "bad"] }, can: ["docker", 5] })!;
  assert.equal(r.specs.os.length, 60);
  assert.equal(r.specs.cores, 4096);
  assert.equal(r.load.cpu, 100);
  assert.equal(r.load.netInBps, 0);
  assert.equal(r.runs.turns, 3);
  assert.deepEqual(r.runs.work, [{ agent: "A", what: "", where: "", cpu: 100 }]);
  assert.deepEqual(r.can, ["docker"]);
  assert.equal(memPct(r.specs, r.load), 50);
  assert.equal(diskPct(r.specs, r.load), 50);
});

test("room left is what the tightest limit leaves, and nothing when offline or draining", () => {
  const base = { online: true, drain: false, cpu: 30, memPct: 10, diskPct: 50, turns: 1, maxTurns: 4 };
  assert.deepEqual(roomOf(base), { n: 70, why: "cpu" });
  assert.deepEqual(roomOf({ ...base, turns: 3 }), { n: 25, why: "turn limit" });
  assert.equal(roomOf({ ...base, memPct: 95 }).why, "memory");
  assert.deepEqual(roomOf({ ...base, diskPct: 95 }), { n: 5, why: "disk" });
  assert.deepEqual(roomOf({ ...base, drain: true }), { n: 0, why: "draining" });
  assert.deepEqual(roomOf({ ...base, online: false }), { n: 0, why: "offline" });
  assert.equal(roomOf({ ...base, maxTurns: null, turns: 50 }).n, 70, "no limit set: the turn count does not matter");
});

const cand = (serverId: string, name: string, n: number, why: Candidate["room"]["why"] = "cpu", turns = 0, maxTurns: number | null = null): Candidate => ({ serverId, name, room: { n, why }, turns, maxTurns });

test("the first machine with room takes the turn; a busy one is skipped and the line says why", () => {
  const p = place([cand("a", "Desk", 0, "turn limit", 4, 4), cand("b", "Mini", 61), cand("c", "Server", 53)]);
  assert.equal(p.chosen?.serverId, "b");
  assert.equal(movedLine(p), "Moved from Desk because it was busy, 4 of 4 turns running");
  assert.equal(movedLine(place([cand("b", "Mini", 61)])), null);
  const off = place([cand("a", "Desk", 0, "offline"), cand("b", "Mini", 61)]);
  assert.equal(movedLine(off), "Moved from Desk because it is offline");
  assert.ok(BUSY_BELOW > 0);
});

test("when every machine is busy the first one that is up takes it, queued; none up means none", () => {
  const p = place([cand("a", "Desk", 5, "memory"), cand("b", "Mini", 10, "cpu")]);
  assert.equal(p.chosen?.serverId, "a");
  assert.deepEqual(p.skipped, []);
  assert.equal(place([cand("a", "Desk", 0, "offline"), cand("b", "Mini", 0, "draining")]).chosen, null);
});

test("alerts and findings use the same limits", () => {
  const m = { serverId: "s1", name: "Berlin", online: true, personal: false, version: "1.4.1", memPct: 88, diskPct: 92, diskBytes: 160e9, pins: [], seenAt: 0 };
  const a = alertsOf([m, { ...m, serverId: "s2", name: "Omar's iMac", online: false, pins: ["Scout"], memPct: null, diskPct: null, seenAt: 1_000_000 }], "1.4.2", "disk full", 1_000_000 + 125 * 60_000);
  assert.deepEqual(a.map((x) => x.alertId), ["disk:s1", "memory:s1", "offline:s2", "update:space", "backup:space"]);
  assert.match(a[2]!.detail, /125 minutes/);
  const f = findingsOf({ os: "x", arch: "x", cores: 4, memBytes: 8e9, diskBytes: 160e9, version: "1.4.1" }, { cpu: 1, memUsedBytes: 7.2e9, diskFreeBytes: 10e9, netInBps: 0, netOutBps: 0 }, "1.4.2", [], false);
  assert.deepEqual(f.map((x) => [x.key, x.fix]), [["disk", "clear_caches"], ["memory", "stop_idle"], ["version", "update"], ["docker", null]]);
  assert.equal(findingsOf(null, null, null, [], false)[0]!.key, "report");
});
