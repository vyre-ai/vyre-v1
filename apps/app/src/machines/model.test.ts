// Machines page: what a row says, what a person may see of another's computer, and the chart geometry and hover.
import test from "node:test";
import assert from "node:assert/strict";
import { CHARTS, canNames, chartsFor, displayName, geometry, hoverAt, kindLine, latestText, loadCells, niceMax, orderLines, ordered, runsLines, statusOf, strip, timeLabel } from "./model.ts";
import type { MachineAlert, MachineRow, Point } from "./model.ts";

const row = (o: Partial<MachineRow> & { serverId: string }): MachineRow => ({
  name: o.serverId, kind: "server", mine: false, state: "healthy", online: true, private: false, runs: { turns: 1, agentComputers: 0, sites: 0, automations: 0 }, can: ["claude_code", "docker"], room: { n: 60, why: "cpu" },
  limits: { maxTurns: null, maxAgentComputers: null }, drain: false, pins: [], load: { cpu: 21.4, memPct: 51, diskPct: 40, diskFreeBytes: 96e9 }, diskBytes: 160e9, ...o,
}) as MachineRow;

test("a row says what the machine is, whose it is and how it is doing", () => {
  const who = (id: string): string => (id === "usr_maya" ? "Maya Chen" : id);
  assert.equal(kindLine(row({ serverId: "a", kind: "space", version: "1.4.1" }), who), "Space server \u00b7 v1.4.1");
  assert.equal(kindLine(row({ serverId: "b", kind: "linked", owner: "usr_maya", version: "1.4.0" }), who), "Linked computer \u00b7 Maya Chen \u00b7 v1.4.0");
  assert.equal(kindLine(row({ serverId: "c", kind: "linked", owner: "usr_me", mine: true }), who), "Linked computer", "your own are not labelled with your name");
  assert.equal(displayName(row({ serverId: "d", name: "srv", nickname: "Berlin" })), "Berlin");
  assert.deepEqual(statusOf(row({ serverId: "e", latencyMs: 34 }), 0), { word: "Online", tone: "ok", sub: "34 ms" });
  assert.deepEqual(statusOf(row({ serverId: "f", drain: true }), 0).word, "Draining");
  assert.deepEqual(statusOf(row({ serverId: "g", online: false, lastSeenAt: 1 }), 125 * 60_000 + 1), { word: "Offline", tone: "off", sub: "Seen 2 h ago" });
  assert.deepEqual(canNames(["claude_code", "codex", "docker", "chrome"]), ["Claude Code", "Codex", "Docker", "Chrome"]);
  assert.deepEqual(runsLines(row({ serverId: "h", runs: { turns: 3, agentComputers: 2, sites: 0, automations: 6 } })), ["3 turns", "2 agent computers", "6 automations"]);
  assert.deepEqual(runsLines(row({ serverId: "i", online: false })), ["0 turns"]);
});

test("load cells: the whole machine for its owner and a server, Vyre's share and nothing else for another person's computer", () => {
  assert.deepEqual(loadCells(row({ serverId: "a" })), { cpu: "21%", mem: "51%", disk: "96 GB free", cpuPct: 21.4, memPct: 51, diskPct: 40, private: false });
  const theirs = loadCells(row({ serverId: "b", private: true, load: undefined as never, vyre: { cpu: 9.2, memPct: 12.4 } }));
  assert.deepEqual([theirs.cpu, theirs.mem, theirs.disk, theirs.private, theirs.cpuPct], ["Vyre 9%", "Vyre 12%", "Private", true, null]);
  assert.equal(loadCells(row({ serverId: "c", online: false })).cpu, "No data");
});

test("the health strip counts what is up, what needs a look and the room left across machines that take work", () => {
  const ms = [row({ serverId: "a", room: { n: 50, why: "cpu" } }), row({ serverId: "b", room: { n: 30, why: "cpu" }, drain: true }), row({ serverId: "c", online: false, room: { n: 0, why: "offline" } }), row({ serverId: "d", room: { n: 70, why: "cpu" }, runs: { turns: 2, agentComputers: 1, sites: 0, automations: 3 } })];
  const alerts: MachineAlert[] = [{ alertId: "disk:a", serverId: "a", kind: "disk", title: "x", detail: "" }, { alertId: "offline:c", serverId: "c", kind: "offline", title: "y", detail: "" }];
  assert.deepEqual(strip(ms, alerts), { online: "3 of 4 online", offline: "1 offline", attention: 2, attentionWords: "disk, offline", turns: "4 turns, 1 agent computer, 3 automations", room: 60, takingWork: 2 });
  assert.equal(strip([], []).attentionWords, "All clear");
  assert.deepEqual(ordered([row({ serverId: "z", kind: "linked", name: "Zed" }), row({ serverId: "b", kind: "server", name: "Box" }), row({ serverId: "s", kind: "space", name: "Space" })]).map((m) => m.serverId), ["s", "b", "z"]);
});

const pts = (n: number, f: (i: number) => number | null): Point[] => Array.from({ length: n }, (_, i) => ({ t: 1_760_000_000_000 + i * 600_000, cpu: f(i), mem: 40, disk: 92, netIn: 2, netOut: 1 }));

test("a chart: a line per run of points, broken where the machine said nothing, the right rules and a hover that reads the point under the pointer", () => {
  const cpu = CHARTS[0]!, p = pts(10, (i) => (i === 4 ? null : 10 + i));
  const g = geometry(cpu, p, "24h", 340);
  assert.equal(g.max, 100);
  assert.equal((g.line.match(/M/g) ?? []).length, 2, "one gap, two runs");
  assert.match(g.area, /Z/);
  assert.deepEqual(g.rules.map((r) => r.label), ["0%", "50%", "100%"]);
  assert.equal(g.ticks.length, 5);
  assert.equal(g.indexAt(g.xOf(7)), 7);
  assert.equal(g.indexAt(-50), 0);
  assert.equal(g.indexAt(9999), 9);
  assert.equal(geometry(CHARTS[2]!, p, "24h", 340).alertY !== null, true, "the disk chart carries the alert line");
  assert.equal(geometry(cpu, p, "24h", 340).alertY, null);
  const net = geometry(CHARTS[3]!, p, "24h", 340);
  assert.equal(net.max, 5, "the network scale fits its data: the largest of in and out with a tenth over, rounded up");
  assert.ok(net.out.startsWith("M"), "the outgoing line is drawn");
  const h = hoverAt(cpu, p, 7, "24h");
  assert.equal(h.value, "17%");
  assert.match(h.time, /^\d\d:\d\d$/);
  assert.equal(hoverAt(cpu, p, 4, "24h").value, "No data");
  assert.equal(hoverAt(CHARTS[3]!, p, 2, "24h").out, "out 1.0 MB/s");
  assert.equal(latestText(cpu, p), "19%");
  assert.equal(latestText(cpu, pts(3, () => null)), "No data");
  assert.deepEqual([niceMax(0), niceMax(3.2), niceMax(11)], [1, 5, 20]);
});

test("time labels: a clock for a day, a day for a week or a month; Vyre's share only for another person's computer", () => {
  const t = new Date(2025, 9, 14, 17, 56).getTime();
  assert.equal(timeLabel(t, "1h"), "17:56");
  assert.match(timeLabel(t, "30d"), /Oct 14/);
  assert.match(timeLabel(t, "7d"), /Oct 14, 17:00/);
  assert.match(timeLabel(t, "7d", true), /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
  assert.deepEqual(chartsFor("vyre_only").map((c) => c.key), ["cpu", "mem"]);
  assert.equal(chartsFor("full").length, 4);
});

test("Where work runs: the order is kept, a busy machine is skipped and the first with room is named", () => {
  const lines = orderLines([
    { name: "MacBook Pro", label: "Your desktop", roomN: 0, why: "turn limit", online: true, drain: false },
    { name: "Mac mini", label: "Your other computers", roomN: 61, why: "cpu", online: true, drain: false },
    { name: "Berlin box", label: "Your server", roomN: 8, why: "disk", online: true, drain: false },
    { name: "Northwind server", label: "The Space server", roomN: 53, why: "cpu", online: true, drain: false },
  ]);
  assert.deepEqual(lines.map((l) => [l.use, l.note]), [[false, "Skipped. Busy. Its turn limit is reached"], [true, "Next turn runs here"], [false, "Skipped. Busy. Disk is nearly full"], [false, "Has room, not needed"]]);
});
