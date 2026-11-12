// Machines page drawn from the capability answers: the list for an admin, the page of a machine in full and of another person's computer, the chart with its hover, and the placement order.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Chart } from "./Chart.tsx";
import { MachineDetail, MachineList, placementOrder, removeMessage } from "./MachinesView.tsx";
import { CHARTS } from "./model.ts";
import type { MachineOut, MachineRow, MachinesOut, Point } from "./model.ts";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el).replaceAll("<!-- -->", "");
const noop = (): void => undefined;
const NOW = 1_760_000_000_000;
const who = (id: string): string => ({ usr_maya: "Maya Chen", usr_me: "Irfad Imtiaz" })[id] ?? id;

const row = (o: Partial<MachineRow> & { serverId: string; name: string }): MachineRow => ({
  kind: "server", mine: false, state: "healthy", online: true, private: false, runs: { turns: 1, agentComputers: 0, sites: 0, automations: 0 }, can: ["claude_code", "docker"], room: { n: 60, why: "cpu" },
  limits: { maxTurns: null, maxAgentComputers: null }, drain: false, pins: [], version: "1.4.1", os: "Debian 12", arch: "x64", cores: 4, memBytes: 8e9, diskBytes: 160e9, latencyMs: 34,
  load: { cpu: 21.4, memPct: 51, diskPct: 40, diskFreeBytes: 96e9 }, ...o,
}) as MachineRow;

const space = row({ serverId: "srv_local", name: "Northwind server", kind: "space", latencyMs: undefined as never, runs: { turns: 3, agentComputers: 2, sites: 2, automations: 6 }, room: { n: 53, why: "cpu" } });
const berlin = row({ serverId: "srv_box", name: "Berlin box", nickname: "Berlin", load: { cpu: 71, memPct: 64, diskPct: 92, diskFreeBytes: 12e9 }, room: { n: 8, why: "disk" } });
const mine = row({ serverId: "srv_dev_mbp", name: "Irfad's MacBook Pro", kind: "linked", mine: true, owner: "usr_me", room: { n: 0, why: "turn limit" }, limits: { maxTurns: 4, maxAgentComputers: null }, runs: { turns: 4, agentComputers: 0, sites: 0, automations: 0 } });
const maya = row({ serverId: "srv_dev_maya", name: "Maya's MacBook Air", kind: "linked", owner: "usr_maya", private: true, load: undefined as never, vyre: { cpu: 7, memPct: 15 }, room: { n: 49, why: "cpu" } });
const off = row({ serverId: "srv_dev_omar", name: "Omar's iMac", kind: "linked", owner: "usr_omar", private: true, load: undefined as never, online: false, state: "down", lastSeenAt: NOW - 125 * 60_000, pins: ["Scout"], room: { n: 0, why: "offline" } });
const data = (ms: MachineRow[], alerts: MachinesOut["alerts"] = [], waiting: MachinesOut["waiting"] = []): MachinesOut => ({ machines: ms, waiting, alerts, admin: true, now: NOW });

test("the list: a strip, the alerts with Open, one row per machine and what an admin may see of another person's computer", () => {
  const alerts: MachinesOut["alerts"] = [{ alertId: "disk:srv_box", serverId: "srv_box", kind: "disk", title: "Berlin has 8% disk left", detail: "12 GB of 160 GB free" }, { alertId: "offline:srv_dev_omar", serverId: "srv_dev_omar", kind: "offline", title: "Omar's iMac is offline and Scout is pinned to it", detail: "Last seen 125 minutes ago" }];
  const out = html(<MachineList data={data([space, berlin, mine, maya, off], alerts)} who={who} narrow={false} now={NOW} onOpen={noop} onAdd={noop} scope="space" />);
  assert.ok(out.includes("4 of 5 online") && out.includes("1 offline"), "the strip");
  assert.ok(out.includes('data-testid="machines-head"') && out.includes(">Room left<"), "column headings on a wide screen");
  assert.ok(out.includes("Berlin has 8% disk left") && out.includes('data-testid="alert-open-srv_box"'), "an alert with its way in");
  const at = (id: string): number => out.indexOf(`data-testid="machine-${id}"`);
  assert.ok(at("srv_local") >= 0 && at("srv_local") < at("srv_box") && at("srv_box") < at("srv_dev_mbp"), "the Space server, then servers, then computers");
  assert.ok(out.includes("Space server") && out.includes("Linked computer \u00b7 Maya Chen"), "kind and whose");
  assert.ok(out.includes("Vyre 7%") && out.includes("Private"), "another person's computer: Vyre's share only");
  assert.ok(out.includes("Seen 2 h ago") && out.includes("No data"), "an offline machine says when it was seen");
  assert.ok(out.includes('data-testid="machines-add"') && out.includes("Add a server"));
  assert.ok(out.includes("Your desktop: Irfad&#x27;s MacBook Pro") && out.includes("Skipped. Busy. Its turn limit is reached"), "the order: the busy desktop is skipped");
  assert.ok(out.includes("The Space server: Northwind server"));
});

test("a computer waiting for approval is listed with its fingerprint, Approve and Decline", () => {
  const out = html(<MachineList data={data([space], [], [{ serverId: "srv_new", name: "berlin-2", fingerprint: "K7QD-4M2X", facts: { os: "linux", arch: "x64", docker: true, version: "1.4.2" } }])} who={who} narrow={false} now={NOW} onOpen={noop} onAdd={noop} onApprove={noop} onDecline={noop} scope="space" />);
  assert.ok(out.includes("Waiting for approval") && out.includes("Fingerprint K7QD-4M2X") && out.includes("linux x64, Docker"));
  assert.ok(out.includes('data-testid="waiting-approve-srv_new"') && out.includes('data-testid="waiting-decline-srv_new"'));
});

test("Settings, This device lists my own machines under their own title", () => {
  const out = html(<MachineList data={data([mine, berlin])} who={who} narrow={true} now={NOW} onOpen={noop} onAdd={noop} scope="mine" />);
  assert.ok(out.includes("My computers and servers") && !out.includes("All computers"));
  assert.ok(out.includes("Add a server"));
});

const points = (n: number): Point[] => Array.from({ length: n }, (_, i) => ({ t: NOW - (n - i) * 600_000, cpu: 30 + (i % 20), mem: 50, disk: 40, netIn: 2.5, netOut: 1 }));
const detail = (m: MachineRow, privacy: MachineOut["privacy"] = "full"): MachineOut => ({
  machine: m, series: { range: "24h", step: 600_000, points: points(144) }, findings: [{ key: "disk", state: "degraded", detail: "Disk is 92% full", next: "Clear old turn caches and logs.", fix: "clear_caches" }, { key: "version", state: "degraded", detail: "Vyre 1.4.1 is behind 1.4.2", next: "Update it from this page.", fix: "update" }, { key: "docker", state: "healthy", detail: "Docker answers", next: "No action needed.", fix: null }],
  work: privacy === "full" ? [{ agent: "Research", what: "Market scan for the Q4 plan", where: "Research run #419", cpu: 14 }] : [], alerts: [], privacy,
});
const page = (m: MachineRow, d: MachineOut | null, extra: Partial<Parameters<typeof MachineDetail>[0]> = {}): string => html(
  <MachineDetail m={m} detail={d} own={d ? d.privacy === "full" : true} range="24h" tab="overview" hover={null} chartW={300} narrow={false} who={who} now={NOW} goto={noop} onRange={noop} onTab={noop} onHover={noop} onBack={noop} placement={<span data-testid="placement-slot" />} {...extra} />,
);

test("a machine page: name with its own name behind a nickname, the facts, four charts, what runs by agent and chat, what it can run", () => {
  const out = page(berlin, detail(berlin));
  assert.ok(out.includes("Berlin") && out.includes("(Berlin box)"), "the nickname leads");
  assert.ok(out.includes("Debian 12") && out.includes("1.4.1") && out.includes("4 cores") && out.includes("8 GB") && out.includes("160 GB") && out.includes("34 ms"));
  for (const c of CHARTS) assert.ok(out.includes(`data-testid="chart-${c.key}"`), c.key);
  assert.ok(out.includes("Alert at 10% free"), "the disk chart's alert line");
  assert.ok(out.includes("Downsampled after 24 hours") === false && out.includes("10-minute points") && out.includes("History is kept 30 days"));
  for (const r of ["1\u00a0h", "24\u00a0h", "7\u00a0d", "30\u00a0d"]) assert.ok(out.includes(r), r);
  assert.ok(out.includes("Research") && out.includes("Market scan for the Q4 plan") && out.includes("14% CPU"));
  assert.ok(out.includes("\u2713 Claude Code") && out.includes("\u2713 Docker") && out.includes("Codex") && out.includes("Names only."));
  assert.ok(out.includes('data-testid="placement-slot"'));
  assert.ok(out.includes("Health 2"), "the tab counts what needs a look");
});

test("another person's computer: the privacy note, Vyre's share in two charts, and none of their work or health", () => {
  const d = detail(maya, "vyre_only");
  const out = page(maya, d, { own: false });
  assert.ok(out.includes("This is Maya Chen&#x27;s own computer") && out.includes("Files and processes stay private to Maya."));
  assert.ok(out.includes("Vyre&#x27;s share of this computer"));
  assert.ok(out.includes('data-testid="chart-cpu"') && out.includes('data-testid="chart-mem"') && !out.includes('data-testid="chart-disk"') && !out.includes('data-testid="chart-net"'));
  assert.ok(out.includes("Vyre&#x27;s work only") && out.includes("Nothing is running here"));
  const health = page(maya, d, { own: false, tab: "health" });
  assert.ok(health.includes("stay on that computer"), "no health findings of someone else's computer");
});

test("the Health tab lists the findings with their next step and Update where it is the fix; the Space server also opens its logs and diagnostics", () => {
  const out = page(space, detail(space), { tab: "health" });
  assert.ok(out.includes("Disk is 92% full") && out.includes("Clear old turn caches and logs.") && out.includes('data-testid="finding-fix-update"'));
  assert.ok(out.includes("Server logs") && out.includes("Diagnostics") && out.includes("Support bundle"));
  const other = page(berlin, detail(berlin), { tab: "health" });
  assert.ok(!other.includes("Server logs"), "only the Space server has them");
  const updates = page(maya, detail(maya, "vyre_only"), { tab: "updates" });
  assert.ok(updates.includes("The person updates it in Settings"));
});

test("the chart reads the point under the pointer: a crosshair, a dot, a tooltip with the value and the time, and the figure follows", () => {
  const cpu = CHARTS[0]!, p = points(144);
  const quiet = html(<Chart def={cpu} points={p} range="24h" width={300} hover={null} onHover={noop} />);
  assert.ok(!quiet.includes("chart-cpu-tip") && quiet.includes('data-testid="chart-cpu-now"'));
  assert.ok(quiet.includes("<path") && quiet.includes('aria-label="CPU over 24h"'));
  const at = html(<Chart def={cpu} points={p} range="24h" width={300} hover={0.5} onHover={noop} />);
  assert.ok(at.includes("chart-cpu-tip") && at.includes("<circle") && /\d\d:\d\d/.test(at));
  const net = html(<Chart def={CHARTS[3]!} points={p} range="24h" width={300} hover={0.5} onHover={noop} />);
  assert.ok(net.includes("out 1.0 MB/s") && net.includes("2.5 MB/s"));
});

test("the placement order lists the person's computers, their servers, then the Space server", () => {
  const order = placementOrder([berlin, space, mine, { ...mine, serverId: "srv_dev_mini", name: "Irfad's Mac mini" } as MachineRow, maya]);
  assert.deepEqual(order.map((o) => o.label), ["Your desktop", "Your other computers", "The Space server"], "Berlin is the Space's, not mine; Maya's is hers");
  assert.equal(order[0]!.roomN, 0);
});

test("an added server's page ends with the danger row, and the confirm counts the agent computers (the clause is left out when there are none)", () => {
  assert.equal(removeMessage("Berlin box", 2), "Remove Berlin box? 2 agent computers on it stop and their local data is wiped. Its access ends at once.");
  assert.equal(removeMessage("Berlin box", 1), "Remove Berlin box? 1 agent computer on it stop and their local data is wiped. Its access ends at once.");
  assert.equal(removeMessage("Berlin box", 0), "Remove Berlin box? Its access ends at once.");
  const out = page(berlin, null, { removal: { word: "Remove this server", pcs: 0, run: async () => undefined } });
  assert.ok(out.includes("Remove this server…") && out.includes("Its agent computers stop and their local data is wiped. Its access ends at once."), "the danger row with its quiet line");
  assert.ok(!out.includes("machine-remove-confirm"), "the confirm card waits until it is asked for");
});
