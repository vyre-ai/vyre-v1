// Mount for the Settings and Console consolidation (lane l-consolidate, owner ask of 4 Nov), over scripted answers. ?part=
//   machines          Console > Machines: the health strip, alerts, the table of every machine, Where work runs
//   machine           one machine's page: four charts over 24 h, what runs, what it can run, limits, Drain, pinned agents
//   machine-7d        the same over 7 days with the crosshair on
//   machine-private   another person's computer as an admin sees it: Vyre's share only
//   people            Console > People and access: the underline tab strip
//   permissions       Console > People and access > Permissions with its text switch (Permissions, Roles, Grants, Check access)
//   add-server        the Add a server sheet at the fingerprint step
//   device            Settings > This device: my own machines
//   device-machine    my own MacBook in full: load, everything using memory is the daemon's, here its limits
//   you               Settings > You
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ConsoleShell } from "../../../apps/app/src/console/shell/ConsoleShell.tsx";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { consolePageFor } from "../../../apps/app/src/shell/providers/console.tsx";
import { SettingsPlace } from "../../../apps/app/src/places/settings/SettingsPlace.tsx";
import { SettingsDataProvider } from "../../../apps/app/src/places/settings/data.tsx";
import { createSampleSettings } from "../../../apps/app/src/places/settings/sample.ts";
import { MachineDetail, MachineList } from "../../../apps/app/src/machines/MachinesView.tsx";
import { AddServerSheet } from "../../../apps/app/src/machines/AddServer.tsx";
import { emptySheet } from "../../../apps/app/src/places/settings/computers-model.ts";
import type { MachineOut, MachineRow, MachinesOut, Point } from "../../../apps/app/src/machines/model.ts";

export const title = "Settings and Console consolidation";

const NOW = 1_760_000_000_000;
const row = (o: Partial<MachineRow> & { serverId: string; name: string }): MachineRow => ({
  kind: "server", mine: false, state: "healthy", online: true, private: false, runs: { turns: 1, agentComputers: 0, sites: 0, automations: 0 }, can: ["claude_code", "docker"], room: { n: 60, why: "cpu" },
  limits: { maxTurns: null, maxAgentComputers: null }, drain: false, pins: [], version: "1.4.1", os: "Debian 12, x64", arch: "x64", cores: 4, memBytes: 8e9, diskBytes: 160e9, latencyMs: 34,
  load: { cpu: 21.4, memPct: 51, diskPct: 40, diskFreeBytes: 96e9 }, ...o,
}) as MachineRow;
const space = row({ serverId: "srv_local", name: "Northwind server", kind: "space", os: "Ubuntu 24.04", cores: 8, memBytes: 32e9, diskBytes: 640e9, latencyMs: undefined as never, load: { cpu: 22, memPct: 51, diskPct: 41, diskFreeBytes: 378e9 }, runs: { turns: 3, agentComputers: 2, sites: 2, automations: 6 }, can: ["claude_code", "codex", "docker"], room: { n: 53, why: "cpu" }, pins: ["Billing"] });
const berlin = row({ serverId: "srv_box", name: "Berlin box", nickname: "Berlin box", owner: "usr_irfad", mine: true, runs: { turns: 2, agentComputers: 1, sites: 0, automations: 0 }, load: { cpu: 71, memPct: 64, diskPct: 92, diskFreeBytes: 12e9 }, room: { n: 8, why: "disk" }, limits: { maxTurns: 4, maxAgentComputers: 2 }, lastSeenAt: NOW });
const mbp = row({ serverId: "srv_dev_mbp", name: "Irfad's MacBook Pro", kind: "linked", mine: true, owner: "usr_irfad", os: "macOS 15.1", arch: "arm64", cores: 10, memBytes: 32e9, diskBytes: 994e9, latencyMs: 18, load: { cpu: 76, memPct: 87, diskPct: 63, diskFreeBytes: 366e9 }, runs: { turns: 4, agentComputers: 0, sites: 0, automations: 0 }, can: ["claude_code", "codex", "chrome"], room: { n: 0, why: "turn limit" }, limits: { maxTurns: 4, maxAgentComputers: null } });
const mini = row({ serverId: "srv_dev_mini", name: "Irfad's Mac mini", kind: "linked", mine: true, owner: "usr_irfad", os: "macOS 15.0", arch: "arm64", cores: 8, memBytes: 16e9, diskBytes: 494e9, latencyMs: 22, load: { cpu: 8, memPct: 43, diskPct: 38, diskFreeBytes: 305e9 }, can: ["claude_code", "docker"], room: { n: 61, why: "cpu" } });
const maya = row({ serverId: "srv_dev_maya", name: "Maya's MacBook Air", kind: "linked", owner: "usr_maya", private: true, load: undefined as never, vyre: { cpu: 7, memPct: 15 }, os: "macOS 15.1", cores: 8, memBytes: 16e9, diskBytes: 494e9, latencyMs: 42, can: ["claude_code", "chrome"], room: { n: 49, why: "cpu" } });
const omar = row({ serverId: "srv_dev_omar", name: "Omar's iMac", kind: "linked", owner: "usr_omar", private: true, load: undefined as never, online: false, state: "down", lastSeenAt: NOW - 125 * 60_000, pins: ["Scout"], room: { n: 0, why: "offline" }, cores: 6, memBytes: 16e9, diskBytes: 994e9, can: ["claude_code"] });
const ALERTS: MachinesOut["alerts"] = [
  { alertId: "disk:srv_box", serverId: "srv_box", kind: "disk", title: "Berlin box has 8% disk left", detail: "12 GB of 160 GB free" },
  { alertId: "memory:srv_dev_mbp", serverId: "srv_dev_mbp", kind: "memory", title: "Irfad's MacBook Pro is short of memory", detail: "87% in use" },
  { alertId: "offline:srv_dev_omar", serverId: "srv_dev_omar", kind: "offline", title: "Omar's iMac is offline and Scout is pinned to it", detail: "Last seen 125 minutes ago. The pinned work waits until it is back" },
];
const WHO: Record<string, string> = { usr_irfad: "Irfad Imtiaz", usr_maya: "Maya Chen", usr_omar: "Omar Haddad" };
const who = (id: string): string => WHO[id] ?? id;
const ALL = [space, berlin, mbp, mini, maya, omar];
const answer = (ms: MachineRow[], alerts: MachinesOut["alerts"]): MachinesOut => ({ machines: ms, waiting: [], alerts, admin: true, now: NOW, spaceRoom: { n: 53, why: "cpu", turns: 3, maxTurns: null } });

const wave = (i: number, k: number, base: number, amp: number): number => Math.max(1, Math.min(99, base + amp * Math.sin(((i + k) / 144) * 2 * Math.PI * 7 - 2) + ((i * 37 + k * 11) % 9) - 4));
const points = (n: number, step: number, o: { cpu: number; mem: number; disk: number }): Point[] => Array.from({ length: n }, (_, i) => ({ t: NOW - (n - 1 - i) * step, cpu: Math.round(wave(i, 1, o.cpu, 14) * 10) / 10, mem: Math.round(wave(i, 5, o.mem, 3) * 10) / 10, disk: o.disk + i * 0.01, netIn: Math.round((2 + 2 * Math.abs(Math.sin(i / 5)) + (i % 17 === 0 ? 8 : 0)) * 10) / 10, netOut: Math.round((1 + Math.abs(Math.sin(i / 7))) * 10) / 10 }));
const WORK = [{ agent: "Research", what: "Market scan for the Q4 plan", where: "Research run #419", cpu: 14 }, { agent: "Billing", what: "Sending invoice reminders", where: "Billing run #418", cpu: 9 }];
const detailOf = (m: MachineRow, range: "24h" | "7d", privacy: MachineOut["privacy"] = "full"): MachineOut => ({
  machine: m, series: { range, step: range === "24h" ? 600_000 : 3_600_000, points: points(range === "24h" ? 144 : 168, range === "24h" ? 600_000 : 3_600_000, { cpu: m.load?.cpu ?? 12, mem: m.load?.memPct ?? 20, disk: m.load?.diskPct ?? 50 }) },
  findings: privacy === "vyre_only" ? [] : [{ key: "disk", state: m.load && m.load.diskPct > 90 ? "down" : "healthy", detail: `Disk is ${Math.round(m.load?.diskPct ?? 40)}% full`, next: m.load && m.load.diskPct > 90 ? "Clear old turn caches and logs." : "No action needed.", fix: m.load && m.load.diskPct > 90 ? "clear_caches" : null }, { key: "version", state: "degraded", detail: `Vyre ${m.version} is behind 1.4.2`, next: "Update it from this page.", fix: "update" }, { key: "docker", state: "healthy", detail: "Docker answers", next: "No action needed.", fix: null }],
  work: privacy === "full" ? WORK : [], alerts: [], privacy,
});

/** The sample machines as machines.list answers them (the fixtures above are in the shape the page draws). */
const apiRow = (m: MachineRow): Record<string, unknown> => ({
  machineId: m.serverId, kind: m.kind === "linked" ? "computer" : m.kind, name: m.name, ...(m.nickname ? { nickname: m.nickname } : {}), ...(m.owner ? { ownerId: m.owner } : {}), mine: m.mine, online: m.online, draining: m.drain, restricted: m.private,
  ...(m.lastSeenAt ? { lastSeenAt: m.lastSeenAt } : {}), ...(m.latencyMs ? { latencyMs: m.latencyMs } : {}), ...(m.version ? { version: m.version } : {}), ...(m.private ? {} : { os: m.os, arch: m.arch, diskBytes: m.diskBytes }), cores: m.cores, memBytes: m.memBytes,
  ...(m.load && m.memBytes && m.diskBytes ? { load: { cpuPct: m.load.cpu, memUsedBytes: (m.load.memPct / 100) * m.memBytes, diskFreeBytes: m.load.diskFreeBytes, netInBps: 0, netOutBps: 0 } } : {}),
  ...(m.vyre && m.memBytes ? { vyreLoad: { cpuPct: m.vyre.cpu, memBytes: (m.vyre.memPct / 100) * m.memBytes } } : {}),
  runs: m.runs, can: m.can, limits: { maxTurns: m.limits.maxTurns ?? 4, maxAgentComputers: m.limits.maxAgentComputers ?? 2 }, pinned: m.pins.map((agentId) => ({ agentId })),
  room: { score: m.room.n, tightest: m.room.why === "turn limit" ? "turns" : m.room.why }, alerts: 0, agentComputers: [],
});
const KIND = { disk: "disk_low", memory: "memory_pressure", offline: "offline_pinned", update: "update_waiting", backup: "backup_failed" } as const;

function call(): (cap: string, input: unknown) => Promise<unknown> {
  return async (cap, input) => {
    const i = input as { serverId?: string; machineId?: string; range?: string };
    if (cap === "machines.list") return { machines: ALL.map(apiRow), summary: { online: ALL.length, total: ALL.length, agentComputers: 0, roomAvg: 50 } };
    if (cap === "machines.alerts") return { alerts: ALERTS.map((a) => ({ alertId: a.alertId, machineId: a.serverId, kind: KIND[a.kind], severity: "warn", title: a.title, detail: a.detail, next: "" })) };
    if (cap === "network.servers") return { servers: [] };
    if (cap === "machines.get") {
      const m = ALL.find((x) => x.serverId === i.machineId) ?? berlin, d = detailOf(m, "24h", m.private ? "vyre_only" : "full"), pts = (r: "24h" | "7d") => detailOf(m, r, m.private ? "vyre_only" : "full").series.points.map((p) => ({ t: p.t, ...(m.private ? { vyreCpuPct: p.cpu ?? 0, vyreMemBytes: ((p.mem ?? 0) / 100) * (m.memBytes ?? 0) } : { cpuPct: p.cpu ?? 0, memPct: p.mem ?? 0, diskFreePct: 100 - (p.disk ?? 0), netInBps: (p.netIn ?? 0) * 1e6, netOutBps: (p.netOut ?? 0) * 1e6 }) }));
      return { machine: apiRow(m), series: { "1h": pts("24h").slice(0, 60), "24h": pts("24h"), "7d": pts("7d"), "30d": pts("7d") }, findings: d.findings, alerts: [], privacy: d.privacy, work: d.work.map((w) => ({ kind: "turn", agentId: "agt_scout", what: w.what, where: w.where, minutes: 3 })) };
    }
    if (cap === "computers.hosts") return { available: true, hosts: [] };
    if (cap === "computers.list") return { computers: [] };
    if (cap === "agents.list") return { agents: [{ id: "agt_scout", name: "Scout" }, { id: "agt_billing", name: "Billing" }] };
    return {};
  };
}

function consoleData(): ReturnType<typeof createSampleConsole>["data"] {
  const base = createSampleConsole().data, c = call();
  return { ...base, call: async (cap: string, input: Record<string, unknown>) => (cap.startsWith("machines.") || cap === "network.servers" || cap.startsWith("computers.") || cap === "agents.list" ? c(cap, input) : (base.call as never as (a: string, b: unknown) => Promise<unknown>)(cap, input)) as never, name: who };
}

const noop = (): void => undefined;

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "machines"), []);
  const cons = useMemo(() => consoleData(), []);
  const settings = useMemo(() => { const s = createSampleSettings(); const c = call(); return { ...s.data, call: (cap: string, input: unknown) => (cap.startsWith("machines.") || cap === "network.servers" || cap === "computers.hosts" || cap === "agents.list" ? c(cap, input) : s.data.call(cap, input)) }; }, []);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const frame = (children: ReactNode): ReactNode => <View style={{ flex: 1, minHeight: 900, backgroundColor: "var(--win)" as string, padding: 24, alignItems: "center" }}><View style={{ width: "100%", maxWidth: 1200 }}>{children}</View></View>;
  const detailPart = (m: MachineRow, range: "24h" | "7d", hover: number | null, privacy: MachineOut["privacy"] = "full"): ReactNode => frame(<MachineDetail m={m} detail={detailOf(m, range, privacy)} own={privacy === "full"} range={range} tab="overview" hover={hover} chartW={Math.floor((Math.min(1200, (globalThis as { innerWidth?: number }).innerWidth ?? 1200) - 56 - 14) / 2) - 28} narrow={((globalThis as { innerWidth?: number }).innerWidth ?? 1200) < 760} who={who} now={NOW} goto={noop} onRange={noop} onTab={noop} onHover={noop} onBack={noop} placement={null} />);
  switch (part) {
    case "machines": return <ConsoleDataProvider value={cons}><View style={{ flex: 1, minHeight: 1100 }}><ConsoleShell embedded initialPage="machines" renderPage={(id, state) => consolePageFor(id, state as Record<string, string | undefined>)} /></View></ConsoleDataProvider>;
    case "machine": return detailPart(berlin, "24h", null);
    case "machine-7d": return detailPart(berlin, "7d", 0.62);
    case "machine-private": return detailPart(maya, "24h", 0.4, "vyre_only");
    case "people": return <ConsoleDataProvider value={cons}><View style={{ flex: 1, minHeight: 900 }}><ConsoleShell embedded initialPage="people" renderPage={(id, state) => consolePageFor(id, state as Record<string, string | undefined>)} /></View></ConsoleDataProvider>;
    case "permissions": return <ConsoleDataProvider value={cons}><View style={{ flex: 1, minHeight: 900 }}><ConsoleShell embedded initialPage="roles" renderPage={(id, state) => consolePageFor(id, state as Record<string, string | undefined>)} /></View></ConsoleDataProvider>;
    case "add-server": return frame(<><MachineList data={answer(ALL, ALERTS)} who={who} narrow={false} now={NOW} onOpen={noop} onAdd={noop} scope="space" /><AddServerSheet sheet={{ ...emptySheet(), nickname: "berlin-2", code: "VYRE-AB12-CD34", expiresAt: NOW + 8 * 60_000, address: "https://northwind.vyre.run" }} servers={[{ serverId: "srv_new", name: "berlin-2", state: "down", enrollment: "pending", fingerprint: "K7QD-4M2X", facts: { os: "linux", arch: "x64", docker: true, version: "1.4.2" } }]} busy={false} error="" now={NOW} onNickname={noop} onMake={noop} onApprove={noop} onDecline={noop} onCopy={noop} onClose={noop} /></>);
    case "device": return <SettingsDataProvider value={settings}><View style={{ flex: 1, minHeight: 900 }}><SettingsPlace initialPage="computer" /></View></SettingsDataProvider>;
    case "you": return <SettingsDataProvider value={settings}><View style={{ flex: 1, minHeight: 900 }}><SettingsPlace initialPage="profile" /></View></SettingsDataProvider>;
    case "device-machine": return frame(<MachineDetail m={mbp} detail={detailOf(mbp, "24h")} own range="24h" tab="overview" hover={0.55} chartW={300} narrow={false} who={who} now={NOW} goto={noop} onRange={noop} onTab={noop} onHover={noop} onBack={noop} placement={null} />);
    default: return <View />;
  }
}
