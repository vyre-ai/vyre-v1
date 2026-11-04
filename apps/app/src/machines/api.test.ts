// The Machines module's answers made into the page's shapes: a row, an alert, a machine's series, the waiting computers, and the calls the page makes.
import test from "node:test";
import assert from "node:assert/strict";
import { fixMachine, loadMachine, loadMachines, pinMachine, setMachine, toAlert, toRow } from "./api.ts";

const GB = 1e9;
const listRow = (o: Record<string, unknown> = {}) => ({
  machineId: "srv_box", kind: "server", name: "Berlin box", mine: false, online: true, draining: false, restricted: false, version: "1.4.1", os: "Debian 12", arch: "x64", cores: 4, memBytes: 8 * GB, diskBytes: 160 * GB, latencyMs: 34,
  load: { cpuPct: 71, memUsedBytes: 4 * GB, diskFreeBytes: 12 * GB, netInBps: 2e6, netOutBps: 1e6 }, vyreLoad: { cpuPct: 9, memBytes: 0.8 * GB },
  runs: { turns: 2, agentComputers: 0, sites: 0, automations: 0 }, can: ["claude_code"], limits: { maxTurns: 4, maxAgentComputers: 2 }, pinned: [{ agentId: "agt_scout" }], room: { score: 8, tightest: "turns" }, ...o,
});

test("a row: the page's words for the module's numbers", () => {
  const r = toRow(listRow() as never);
  assert.deepEqual([r.serverId, r.kind, r.state, r.private, r.drain, r.pins], ["srv_box", "server", "healthy", false, false, ["agt_scout"]]);
  assert.deepEqual(r.load, { cpu: 71, memPct: 50, diskPct: 92.5, diskFreeBytes: 12 * GB });
  assert.deepEqual(r.vyre, { cpu: 9, memPct: 10 });
  assert.deepEqual(r.room, { n: 8, why: "turn limit" });
  const linked = toRow(listRow({ machineId: "device:dev_maya", kind: "computer", restricted: true, online: false, load: undefined, os: undefined, diskBytes: undefined, room: { score: 0, tightest: "busy" } }) as never);
  assert.deepEqual([linked.kind, linked.private, linked.state, linked.load, linked.room.why], ["linked", true, "down", undefined, "cpu"], "busy is all a stranger's computer says about why");
});

test("an alert", () => {
  assert.deepEqual(toAlert({ alertId: "disk_low:srv_box", machineId: "srv_box", kind: "disk_low", title: "t", detail: "d" }), { alertId: "disk_low:srv_box", serverId: "srv_box", kind: "disk", title: "t", detail: "d" });
});

test("the list: machines, alerts and the computers waiting for approval", async () => {
  const calls: string[] = [];
  const out = await loadMachines(async (cap) => {
    calls.push(cap);
    if (cap === "machines.list") return { machines: [listRow(), listRow({ machineId: "device:dev_a", kind: "computer", mine: true })] };
    if (cap === "machines.alerts") return { alerts: [{ alertId: "memory_pressure:srv_box", machineId: "srv_box", kind: "memory_pressure", title: "m", detail: "d" }] };
    if (cap === "network.servers") return { servers: [{ serverId: "srv_new", name: "berlin-2", enrollment: "pending", fingerprint: "K7QD-4M2X", facts: { os: "linux", arch: "x64", docker: true, version: "1.4.2" } }, { serverId: "srv_box", name: "x", enrollment: "approved" }] };
    throw new Error(cap);
  });
  assert.deepEqual(out.machines.map((m) => m.serverId), ["srv_box", "device:dev_a"]);
  assert.equal(out.admin, true, "she sees a machine that is not hers");
  assert.deepEqual(out.waiting, [{ serverId: "srv_new", name: "berlin-2", fingerprint: "K7QD-4M2X", facts: { os: "linux", arch: "x64", docker: true, version: "1.4.2" } }]);
  assert.equal(out.alerts[0]!.kind, "memory");
  assert.ok(calls.includes("network.servers"));
});

test("a machine's page: the range cut from the series, a stranger's computer charted by Vyre's share only, the work and the last fix", async () => {
  const pt = (t: number, o: Record<string, number>) => ({ t, ...o });
  const full = await loadMachine(async () => ({
    machine: listRow(), series: { "1h": [], "24h": [pt(1, { cpuPct: 30, memPct: 40, diskFreePct: 60, netInBps: 2e6, netOutBps: 1e6 }), pt(2, {})], "7d": [], "30d": [] }, privacy: "full", alerts: [],
    findings: [{ key: "disk", state: "degraded", detail: "Disk is 92% full", next: "Clear old turn caches and logs.", fix: "clear_caches" }], work: [{ kind: "turn", agentId: "agt_scout", what: "Working on a turn", where: "In a chat", minutes: 3 }, { kind: "site", what: "Serving Intake", where: "Site", minutes: 0 }],
    lastFix: { fix: "clear_caches", at: 5, state: "done", detail: "Cleared 2 GB." },
  }), toRow(listRow() as never), "24h");
  assert.deepEqual(full.series.points, [{ t: 1, cpu: 30, mem: 40, disk: 40, netIn: 2, netOut: 1 }, { t: 2, cpu: null, mem: null, disk: null, netIn: null, netOut: null }]);
  assert.equal(full.series.step, 600_000);
  assert.deepEqual(full.work.map((w) => w.agent), ["agt_scout", "Site"]);
  assert.equal(full.lastFix?.detail, "Cleared 2 GB.");
  const theirs = await loadMachine(async () => ({ machine: listRow({ restricted: true, load: undefined }), series: { "1h": [], "24h": [pt(1, { vyreCpuPct: 7, vyreMemBytes: 0.4 * GB })], "7d": [], "30d": [] }, privacy: "vyre_only", alerts: [], findings: [], work: [] }), toRow(listRow() as never), "24h");
  assert.deepEqual(theirs.series.points[0], { t: 1, cpu: 7, mem: 5, disk: null, netIn: null, netOut: null });
  assert.equal(theirs.privacy, "vyre_only");
});

test("the calls the page makes", async () => {
  const seen: Array<[string, unknown]> = [];
  const call = async (cap: string, input: Record<string, unknown>): Promise<unknown> => { seen.push([cap, input]); return { state: "done", detail: "ok" }; };
  await setMachine(call, "srv_box", { drain: true });
  await pinMachine(call, "srv_box", "agt_scout", true);
  assert.deepEqual(await fixMachine(call, "space", "stop_idle"), { state: "done", detail: "ok" });
  assert.deepEqual(seen, [["machines.set", { machineId: "srv_box", drain: true }], ["machines.set", { machineId: "srv_box", pinAgent: { agentId: "agt_scout", pinned: true } }], ["machines.fix", { machineId: "space", fix: "stop_idle" }]]);
});
