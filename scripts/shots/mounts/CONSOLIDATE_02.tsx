// Mount for the whole Console over scripted Northwind answers (lane l-consolidate, 4 Nov): one part per page, ?part=<page id> (the ids in apps/app/src/console/shell/nav.ts).
// Each part renders ConsoleShell on that page. The data matches the approved prototype (vyre-console.html, the C object): Irfad Imtiaz owner, Maya Chen admin, Omar Haddad, Lena Ortiz, Sam Patel, Dana Whitfield,
// Elena Rivera guest; teams Everyone, Delivery, Finance, Leadership; agents Intake, Billing, Docs, Research, Scout, Bookings; AI accounts Claude, OpenAI, OpenCode Go.
// Every capability a page reads is answered in `answers` below; a capability nobody scripted logs "UNSCRIPTED <cap>" so the runner can list it.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ConsoleShell } from "../../../apps/app/src/console/shell/ConsoleShell.tsx";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { consolePageFor } from "../../../apps/app/src/shell/providers/console.tsx";
import { SettingsDataProvider } from "../../../apps/app/src/places/settings/data.tsx";
import { SpaceDefaults } from "../../../apps/app/src/places/settings/SpacePages.tsx";
import { createSampleSettings } from "../../../apps/app/src/places/settings/sample.ts";
import { permissions as REGISTRY } from "../../../generated/permissions.ts";
import type { MachineOut, MachineRow, MachinesOut, Point } from "../../../apps/app/src/machines/model.ts";

export const title = "Console, every page";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const NOW = Date.now();
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

function machinesCall(): (cap: string, input: unknown) => Promise<unknown> {
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


// ---------------------------------------------------------------- the Northwind data
const T = Date.now();
const ago = (ms: number): number => T - ms;
const PEOPLE = [
  { id: "usr_irfad", name: "Irfad Imtiaz", role: "rol_owner", title: "Owner", groups: ["grp_everyone", "grp_leadership"], seen: 0 },
  { id: "usr_maya", name: "Maya Chen", role: "rol_admin", title: "Operations lead", groups: ["grp_everyone", "grp_leadership", "grp_delivery"], seen: 12 * MIN },
  { id: "usr_omar", name: "Omar Haddad", role: "rol_member", title: "Finance", groups: ["grp_everyone", "grp_finance"], seen: 3 * HOUR },
  { id: "usr_lena", name: "Lena Ortiz", role: "rol_member", title: "Client delivery", groups: ["grp_everyone", "grp_delivery"], seen: 2 * HOUR },
  { id: "usr_sam", name: "Sam Patel", role: "rol_developer", title: "Developer", groups: ["grp_everyone"], seen: DAY },
  { id: "usr_dana", name: "Dana Whitfield", role: "rol_member", title: "Intake", groups: ["grp_everyone", "grp_delivery"], seen: 20 * MIN },
  { id: "usr_elena", name: "Elena Rivera", role: "rol_guest", title: "Client (guest)", groups: [], seen: 2 * DAY },
];
const AGENTS = [
  { id: "agt_intake", name: "Intake", owner: "usr_lena", status: "working", role: "Qualifies new leads", spend: 62, limit: 75 },
  { id: "agt_billing", name: "Billing", owner: "usr_omar", status: "working", role: "Sends invoice reminders", spend: 112, limit: 100 },
  { id: "agt_docs", name: "Docs", owner: "usr_maya", status: "working", role: "Drafts guides and templates", spend: 22, limit: 50 },
  { id: "agt_research", name: "Research", owner: "usr_irfad", status: "awake", role: "Market scans", spend: 30, limit: 75 },
  { id: "agt_scout", name: "Scout", owner: "usr_irfad", status: "awake", role: "Watches competitors", spend: 18, limit: 50 },
  { id: "agt_bookings", name: "Bookings", owner: "usr_dana", status: "paused", role: "Books consults", spend: 9, limit: 50 },
];
const NAME: Record<string, string> = { ...Object.fromEntries(PEOPLE.map((p) => [p.id, p.name])), ...Object.fromEntries(AGENTS.map((a) => [a.id, a.name])), svc_gate: "Approvals", svc_vyre: "Vyre", usr_jordan: "Jordan Ellis", fld_rivera_docs: "Rivera documents", rec_rivera: "Rivera engagement", rec_inv_2041: "Invoice 2041", rec_guide_7: "Onboarding guide", con_slack: "Slack, Maya", svc_backup: "Backups", northwind: "Northwind", prj_rivera: "Rivera engagement", mbx_billing: "billing@northwind.example", vlt_dev: "Developer keys" };
const micros = (usd: number): number => Math.round(usd * 1_000_000);
const ALL_PERMS = REGISTRY.map((p) => p.key as string);
const defaultsFor = (role: string): string[] => REGISTRY.filter((p) => (p.defaults as Record<string, boolean>)[role]).map((p) => p.key as string);

const principals = [
  ...PEOPLE.map((p) => ({ id: p.id, kind: "person", name: p.name, status: "active", roles: [p.role], groups: p.groups, title: p.title, createdAt: ago(60 * DAY) })),
  { id: "usr_jordan", kind: "person", name: "Jordan Ellis", status: "invited", roles: ["rol_member"], groups: [], title: "Invited", createdAt: ago(6 * DAY) },
  ...AGENTS.map((a) => ({ id: a.id, kind: "agent", name: a.name, owner: a.owner, status: "active", roles: [], groups: ["grp_everyone"], title: a.role, createdAt: ago(40 * DAY) })),
];
const ROLES = [
  { id: "rol_owner", name: "Owner", builtIn: true, clearance: "restricted", assignableToAgents: false, permissions: ALL_PERMS, holders: 1 },
  { id: "rol_admin", name: "Admin", builtIn: true, clearance: "confidential", assignableToAgents: false, permissions: defaultsFor("admin"), holders: 1 },
  { id: "rol_developer", name: "Developer", builtIn: true, clearance: "internal", assignableToAgents: true, permissions: defaultsFor("developer"), holders: 1 },
  { id: "rol_member", name: "Member", builtIn: true, clearance: "internal", assignableToAgents: true, permissions: defaultsFor("member"), holders: 3 },
  { id: "rol_guest", name: "Guest", builtIn: true, clearance: "public", assignableToAgents: false, permissions: defaultsFor("guest"), holders: 1 },
  { id: "rol_finance", name: "Finance reviewer", builtIn: false, clearance: "confidential", assignableToAgents: false, permissions: ["console.access", "ai.spend", "audit.read"], holders: 1 },
];
const GROUPS = [
  { id: "grp_everyone", name: "Everyone", members: PEOPLE.filter((p) => p.groups.includes("grp_everyone")).map((p) => ({ kind: "person", id: p.id })), managers: [{ kind: "person", id: "usr_irfad" }], builtIn: true },
  { id: "grp_delivery", name: "Delivery", members: [{ kind: "person", id: "usr_maya" }, { kind: "person", id: "usr_lena" }, { kind: "person", id: "usr_dana" }, { kind: "agent", id: "agt_intake" }, { kind: "agent", id: "agt_docs" }], managers: [{ kind: "person", id: "usr_maya" }], builtIn: false },
  { id: "grp_finance", name: "Finance", members: [{ kind: "person", id: "usr_omar" }, { kind: "agent", id: "agt_billing" }], managers: [{ kind: "person", id: "usr_omar" }], builtIn: false },
  { id: "grp_leadership", name: "Leadership", members: [{ kind: "person", id: "usr_irfad" }, { kind: "person", id: "usr_maya" }], managers: [{ kind: "person", id: "usr_irfad" }], builtIn: false },
];
const GRANTS = [
  { id: "gnt_1", subject: { kind: "group", id: "grp_delivery" }, resource: { type: "project", id: "prj_rivera" }, level: "edit", conditions: {}, by: "usr_maya", createdAt: ago(9 * DAY) },
  { id: "gnt_2", subject: { kind: "person", id: "usr_elena" }, resource: { type: "folder", id: "fld_rivera_docs" }, level: "view", conditions: { expiresAt: T + 21 * DAY, export: false }, by: "usr_lena", createdAt: ago(4 * DAY) },
  { id: "gnt_3", subject: { kind: "group", id: "grp_finance" }, resource: { type: "record_type", id: "invoice" }, level: "manage", conditions: { labelCeiling: "confidential" }, by: "usr_irfad", createdAt: ago(30 * DAY) },
  { id: "gnt_4", subject: { kind: "agent", id: "agt_billing" }, resource: { type: "mailbox", id: "mbx_billing" }, level: "use", conditions: {}, by: "usr_omar", createdAt: ago(18 * DAY) },
  { id: "gnt_5", subject: { kind: "person", id: "usr_sam" }, resource: { type: "vault_folder", id: "vlt_dev" }, level: "view", conditions: { window: { from: ago(2 * DAY), to: T + 5 * DAY } }, by: "usr_irfad", createdAt: ago(2 * DAY) },
];
const spendRows = AGENTS.map((a) => ({ key: a.id, title: a.name, totals: { turns: Math.round(a.spend * 3.1), tokensIn: a.spend * 41_000, tokensOut: a.spend * 6_200, costMicros: micros(a.spend) } }));
const usageTotals = spendRows.reduce((t, r) => ({ turns: t.turns + r.totals.turns, tokensIn: t.tokensIn + r.totals.tokensIn, tokensOut: t.tokensOut + r.totals.tokensOut, costMicros: t.costMicros + r.totals.costMicros }), { turns: 0, tokensIn: 0, tokensOut: 0, costMicros: 0 });
const AUDIT = [
  ["person", "usr_maya", "role.changed", "admin", "space", "usr_omar", 6 * MIN], ["person", "usr_irfad", "invite.created", "admin", "space", "usr_jordan", 22 * MIN],
  ["agent", "agt_intake", "record.revealed", "sensitive", "record", "rec_rivera", 41 * MIN], ["person", "usr_omar", "file.opened", "deny", "folder", "fld_rivera_docs", 2 * HOUR],
  ["person", "usr_irfad", "gate.rule.changed", "admin", "space", "svc_gate", 3 * HOUR], ["agent", "agt_billing", "record.updated", "change", "record", "rec_inv_2041", 5 * HOUR],
  ["person", "usr_lena", "signed.in", "sign_in", "", "", 9 * HOUR], ["person", "usr_maya", "export.created", "admin", "space", "svc_gate", 20 * HOUR],
  ["agent", "agt_docs", "record.created", "change", "record", "rec_guide_7", DAY], ["person", "usr_dana", "signed.in", "sign_in", "", "", 26 * HOUR],
  ["person", "usr_maya", "connection.added", "admin", "connection", "con_slack", 3 * DAY], ["person", "usr_irfad", "backup.run", "admin", "space", "svc_backup", 4 * DAY],
].map((r, i) => ({ id: `aud_${i + 1}`, at: ago(r[6] as number), actor: { kind: r[0], id: r[1] }, action: r[2], class: r[3], ...(r[4] ? { resource: { type: r[4], id: r[5] } } : {}), traceId: `trc_${i + 1}`, seq: 1000 - i }));

const accounts = [
  { ref: "acc_claude", driver: "claude_code", kind: "subscription", title: "Claude", name: "Claude Max", mine: false, status: "ok", lastProbeAt: ago(2 * MIN), spaceKey: true, usable: true, models: ["claude-sonnet-4-5", "claude-opus-4-1"], uses: { teamChats: { who: "everyone" }, automations: true, agentWork: { which: "all" } } },
  { ref: "acc_openai", driver: "openai", kind: "api_key", title: "OpenAI", name: "OpenAI API key", mine: false, status: "expired", lastProbeAt: ago(3 * HOUR), spaceKey: true, usable: false, code: "expired", why: "The key was rejected. Add a new one.", models: ["gpt-5"], uses: { automations: true } },
  { ref: "acc_opencode", driver: "opencode_go", kind: "subscription", title: "OpenCode Go", name: "OpenCode Go", mine: true, ownerId: "usr_irfad", status: "ok", lastProbeAt: ago(12 * MIN), usable: true, models: ["glm-4.6", "kimi-k2"], uses: { goals: true } },
];
const providersList = accounts.map((a, i) => ({ id: `prv_${i}`, providerKey: a.driver, name: a.title, connection: a.kind === "api_key" ? "api_key" : "subscription", via: a.driver === "claude_code" ? "Claude Code" : a.title, scope: a.mine ? "mine" : "shared", itemId: `itm_${i}`, agentsUsing: a.ref === "acc_claude" ? ["agt_intake", "agt_docs", "agt_research"] : [], usage: { tokens: [18_400_000, 2_100_000, 640_000][i]!, costCents: [28400, 2900, 800][i]!, periodStart: ago(12 * DAY) }, engine: a.driver, spaceMayUse: !a.mine, state: a.status === "ok" ? "ok" : "needs_sign_in", models: a.models }));
const DRIVERS = [["anthropic", "Anthropic", "api"], ["openai", "OpenAI", "api"], ["openrouter", "OpenRouter", "api"], ["google", "Google", "api"], ["claude_code", "Claude Code", "cli"], ["codex", "Codex", "cli"], ["opencode_go", "OpenCode Go", "api"]];
const MODELS = [
  { provider: "claude_code", model: "claude-sonnet-4-5", title: "Claude Sonnet 4.5", driver: "claude_code", contextTokens: 200000, allowed: true, isDefault: true },
  { provider: "claude_code", model: "claude-opus-4-1", title: "Claude Opus 4.1", driver: "claude_code", contextTokens: 200000, allowed: true },
  { provider: "claude_code", model: "claude-haiku-4-5", title: "Claude Haiku 4.5", driver: "claude_code", contextTokens: 200000, allowed: true },
  { provider: "openai", model: "gpt-5", title: "GPT-5", driver: "openai", contextTokens: 400000, allowed: false, reason: "not_connected" },
  { provider: "opencode_go", model: "glm-4.6", title: "GLM 4.6", driver: "opencode_go", contextTokens: 200000, allowed: true },
  { provider: "opencode_go", model: "kimi-k2", title: "Kimi K2", driver: "opencode_go", contextTokens: 256000, allowed: false, reason: "label_provider" },
];
const SCHEMA = [
  ["contact", "Contact", "Contacts", "people", "internal", 214, 11], ["matter", "Matter", "Matters", "briefcase", "confidential", 63, 14], ["invoice", "Invoice", "Invoices", "receipt", "confidential", 148, 9],
  ["task", "Task", "Tasks", "check", "internal", 392, 8], ["document", "Document", "Documents", "doc", "internal", 520, 7], ["note", "Note", "Notes", "pen", "internal", 87, 5],
].map(([key, title, plural, icon, label, rowCount, fieldCount]) => ({ key, title, plural, icon, label, system: false, group: "Firm", rowCount, fieldCount }));
const DESCRIBE = SCHEMA.map((t) => ({ key: t.key, title: t.title, plural: t.plural, icon: t.icon, label: t.label, system: false, group: "Firm", titleField: "name", fields: [
  { key: "name", type: "text", title: "Name", required: true }, { key: "status", type: "select", title: "Status", options: { choices: ["Open", "Waiting", "Done"] } }, { key: "owner", type: "person", title: "Owner" },
  { key: "amount", type: "money", title: "Amount", label: "confidential" }, { key: "due", type: "date", title: "Due" }], version: 3 }));
const CONNECTORS = [
  { key: "hubspot", title: "HubSpot", mode: "oauth_app", scope: "space", builtin: true, version: "2.4.0", state: "live", domains: ["api.hubapi.com"], secrets: [], connections: 1, syncedTypes: ["contact", "matter"], actions: ["contact.create", "deal.update"], sources: [] },
  { key: "lawmatics", title: "Lawmatics", mode: "api", scope: "space", builtin: true, version: "1.2.1", state: "live", domains: ["api.lawmatics.com"], secrets: [{ name: "api_key", description: "Lawmatics API key" }], connections: 0, syncedTypes: ["matter"], actions: [], sources: [] },
  { key: "documenso", title: "Documenso", mode: "api", scope: "space", builtin: true, version: "1.0.3", state: "live", domains: ["app.documenso.com"], secrets: [], connections: 1, syncedTypes: [], actions: ["document.send"], sources: [] },
  { key: "stripe", title: "Stripe", mode: "api", scope: "space", builtin: true, version: "3.1.0", state: "live", domains: ["api.stripe.com"], secrets: [], connections: 1, syncedTypes: ["invoice"], actions: ["invoice.create"], sources: [] },
  { key: "slack", title: "Slack", mode: "oauth_app", scope: "person", builtin: true, version: "2.0.2", state: "live", domains: ["slack.com"], secrets: [], connections: 1, syncedTypes: [], actions: ["message.post"], sources: [] },
  { key: "github", title: "GitHub", mode: "oauth_app", scope: "person", builtin: true, version: "1.8.0", state: "live", domains: ["api.github.com"], secrets: [], connections: 1, syncedTypes: [], actions: [], sources: [] },
];
const CONNECTIONS = [
  { connectionId: "con_hubspot", connector: "hubspot", title: "HubSpot, portal 4821190", owner: { kind: "space", id: "northwind" }, state: "active", scopes: ["contacts", "deals"], lastSyncAt: ago(8 * MIN), createdAt: ago(80 * DAY), handles: [], filled: [] },
  { connectionId: "con_stripe", connector: "stripe", title: "Stripe", owner: { kind: "space", id: "northwind" }, state: "active", scopes: ["invoices"], lastSyncAt: ago(30 * MIN), createdAt: ago(60 * DAY), handles: [], filled: [] },
  { connectionId: "con_documenso", connector: "documenso", title: "Documenso", owner: { kind: "space", id: "northwind" }, state: "needs_reconnect", scopes: [], createdAt: ago(40 * DAY), handles: [], filled: [] },
  { connectionId: "con_slack", connector: "slack", title: "Slack, Maya", owner: { kind: "person", id: "usr_maya" }, state: "active", scopes: ["chat"], lastSyncAt: ago(4 * MIN), createdAt: ago(30 * DAY), handles: [], filled: [] },
  { connectionId: "con_github", connector: "github", title: "GitHub, Irfad", owner: { kind: "person", id: "usr_irfad" }, state: "active", scopes: ["repo"], lastSyncAt: ago(HOUR), createdAt: ago(20 * DAY), handles: [], filled: [] },
];
const health = (k: string, title: string, detail: string, state = "healthy") => ({ key: k, title, state, detail, checkedAt: ago(90_000), module: k, next: "" });
const SERVERS = [
  { serverId: "srv_local", name: "Northwind server", state: "healthy", role: "space", lastSeenAt: T, facts: { os: "Ubuntu 24.04", arch: "x64", docker: true, version: "1.4.1" } },
  { serverId: "srv_box", name: "Berlin box", state: "degraded", role: "compute", lastSeenAt: ago(MIN), owner: "usr_irfad", facts: { os: "Debian 12", arch: "x64", docker: true, version: "1.4.1" } },
  { serverId: "srv_pending", name: "berlin-2", state: "down", role: "compute", enrollment: "pending", fingerprint: "3F:9A:0C:71:B2:D4", requestedAt: ago(20 * MIN), facts: { os: "Debian 12", arch: "x64", docker: true, version: "1.4.1" } },
];
const COMPUTERS = [["agt_intake", "working", "Qualifying 3 new leads"], ["agt_billing", "working", "Sending invoice reminders"], ["agt_docs", "asleep", "Drafting the onboarding guide"]].map(([agentId, state, caption], i) => ({ computerId: `cmp_${i + 1}`, agentId, state, caption, tabs: i + 2, tabLimit: 8, host: i === 2 ? "vm" : "server", diskBytes: (12 + i * 5) * 1e9, lastActiveAt: ago((i + 1) * 4 * MIN), recording: false }));

const REQUESTS = [
  { id: "req_1", requester: "usr_elena", resource: { type: "folder", id: "fld_rivera_docs" }, level: "view", note: "I need the signed engagement letter", state: "waiting", taskId: "tsk_req_1", at: ago(5 * HOUR) },
  { id: "req_2", requester: "usr_dana", resource: { type: "record_type", id: "invoice" }, level: "view", state: "waiting", taskId: "tsk_req_2", at: ago(DAY) },
];
const INVITES = [
  { id: "inv_1", role: "rol_member", groups: ["grp_delivery"], agents: [], projects: [], channels: [], email: "jordan@northwind.example", expiresAt: T + 6 * DAY, createdBy: "usr_irfad", state: "open", createdAt: ago(DAY) },
  { id: "inv_2", role: "rol_guest", groups: [], agents: [], projects: [], channels: [], expiresAt: T + 3 * DAY, createdBy: "usr_maya", state: "open", createdAt: ago(4 * DAY) },
];
const RUNS = [
  ["agt_intake", "Qualify new leads", "running", "Qualifying 3 new leads", 4], ["agt_billing", "Send invoice reminders", "waiting", "Waiting for an approval to send 9 reminders", 18], ["agt_docs", "Draft onboarding guide", "running", "Drafting the onboarding guide", 31],
  ["agt_research", "Market scan for the Q4 plan", "succeeded", "Found 14 sources and wrote the summary", 95], ["agt_scout", "Weekly competitor watch", "failed", "Could not open two sites", 190], ["agt_billing", "Reconcile March invoices", "succeeded", "Matched 41 of 41", 400],
].map(([who, name, status, summary, min], i) => ({ id: `run_${i + 1}`, kind: "routine", name, owner: NAME[who as string]!.length ? PEOPLE.find((p) => p.id === AGENTS.find((a) => a.id === who)!.owner)!.id : "usr_irfad", startedBy: who, status, ...(status === "waiting" ? { waitReason: "approval" } : {}), costMicros: micros(0.4 + i * 0.3), startedAt: ago((min as number) * MIN), ...(status === "running" || status === "waiting" ? {} : { endedAt: ago((min as number) * MIN - 6 * MIN) }), traceId: `trc_run_${i}`, summary }));
const SKILLS = [
  ["writing-style", "Write in the firm's voice: short, plain, no filler", "space", true, 2400], ["intake-checklist", "The questions to ask a new client and how to log the answers", "space", true, 3100], ["invoice-format", "How Northwind lays out an invoice", "space", true, 1700],
  ["meeting-notes", "Turn a meeting transcript into notes and tasks", "builtin", true, 1200], ["search-the-web", "Search and cite sources", "builtin", true, 900], ["conflict-check", "Check a new matter for conflicts", "agent", false, 2200],
].map(([name, description, tier, enabled, bytes]) => ({ name, description, tier, source: tier === "builtin" ? "Vyre" : "Northwind", system: tier === "builtin", enabled, bytes, updatedAt: ago(9 * DAY), ...(tier === "agent" ? { agentId: "agt_intake" } : {}) }));
const PLUGINS = [
  { pluginId: "plg_1", name: "Office documents", marketplace: "Vyre plugins", marketplaceId: "mkt_vyre", scope: "space", version: "1.3.0", description: "Read and write Word, Excel and PDF files", enabled: true, parts: { skills: ["docx", "xlsx"], commands: [], agents: [], hooks: 0, mcpServers: [] }, userConfig: [], config: {}, configured: true, warnings: [], installedAt: ago(30 * DAY) },
  { pluginId: "plg_2", name: "Deep research", marketplace: "Vyre plugins", marketplaceId: "mkt_vyre", scope: "agent", agentId: "agt_research", version: "0.9.2", description: "Search, read and cite many sources", enabled: true, parts: { skills: ["research"], commands: ["/scan"], agents: [], hooks: 1, mcpServers: ["search"] }, userConfig: [], config: {}, configured: true, warnings: [], installedAt: ago(12 * DAY) },
];
const HOURS = { zone: "America/Los_Angeles", weekly: [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "17:00" })), outsideHours: "voicemail" };
const NUMBERS = [["num_1", "+1 415 555 0140", "Support line", "agent", "agt_intake"], ["num_2", "+1 415 555 0141", "Billing", "person", "usr_omar"]].map(([id, e164, title, kind, who]) => ({ id, e164, title, capabilities: ["voice", "sms"], assigneeKind: kind, assigneeId: who, route: { ring: [{ kind, id: who }], ringSeconds: 20, voicemail: true, voicemailTranscript: true }, hours: HOURS, recording: "announce", a2p: id === "num_1" ? "approved" : "pending", state: "active" }));
const MAILBOXES = [["mbx_support", "support@northwind.example", "Support", "shared", "space"], ["mbx_billing", "billing@northwind.example", "Billing", "shared", "people"], ["mbx_hello", "hello@northwind.example", "Hello", "shared", "space"]].map(([id, address, title, kind, privacy]) => ({ id, kind, address, title, provider: "inbound_only", privacy, state: "syncing", lastSyncAt: ago(3 * MIN) }));
const WEBHOOKS = [
  { id: "whk_1", name: "Invoices to the accounting system", url: "https://hooks.northwind.example/invoices", eventTypes: ["record.created", "record.updated"], active: true, secretHint: "whsec_...9Ps5", createdBy: "usr_sam", createdAt: ago(50 * DAY), lastDeliveryAt: ago(14 * MIN), failureStreak: 0 },
  { id: "whk_2", name: "New leads to Slack", url: "https://hooks.slack.com/services/T0/B0/xxxx", eventTypes: ["record.created"], active: true, secretHint: "whsec_...c41f", createdBy: "usr_maya", createdAt: ago(20 * DAY), lastDeliveryAt: ago(3 * HOUR), failureStreak: 2 },
];
const DELIVERIES = [["delivered", 200, 14], ["delivered", 200, 55], ["failed", 502, 180], ["retrying", 504, 4]].map(([state, httpStatus, min], i) => ({ id: `dlv_${i}`, webhookId: "whk_1", eventId: `evt_${i}`, eventType: "record.created", state, attempts: state === "delivered" ? 1 : 3, httpStatus, at: ago((min as number) * MIN), durationMs: 180 + i * 90 }));
const KEYS = [{ sessionId: "mcs_1", kind: "outside", principal: "usr_sam", name: "Zapier", startedAt: ago(40 * DAY), lastCallAt: ago(3 * MIN), calls: 18420 }, { sessionId: "mcs_2", kind: "driver", principal: "usr_maya", name: "Claude Desktop", startedAt: ago(9 * DAY), lastCallAt: ago(2 * HOUR), calls: 612 }];
const POLICIES = [
  { key: "sign_in.floor", scope: "space", kind: "sign_in", value: { floor: "app_or_passkey" }, updatedAt: ago(30 * DAY) }, { key: "sharing.links", scope: "space", kind: "sharing", value: { publicLinks: true }, updatedAt: ago(30 * DAY) },
  { key: "gate.wait", scope: "space", kind: "gate", value: { hours: 4 }, updatedAt: ago(30 * DAY) },
];
const DEVICES = [["dev_1", "usr_irfad", "Irfad's MacBook Pro", "desktop", "San Francisco", 0], ["dev_2", "usr_irfad", "Irfad's iPhone", "phone", "San Francisco", 40 * MIN], ["dev_3", "usr_maya", "Maya's MacBook Air", "desktop", "Austin", 12 * MIN], ["dev_4", "usr_omar", "Omar's iMac", "desktop", "Dallas", 2 * HOUR], ["dev_5", "usr_lena", "Chrome on Windows", "web", "Denver", 3 * HOUR]].map(([id, person, name, cls, location, seen], i) => ({ id, person, name, class: cls, epoch: 1, lastSeenAt: ago(seen as number), location, ...(i === 0 ? { current: true } : {}) }));
const ISO_SPACE = { id: "northwind", name: "Northwind", legalName: "Northwind Advisory LLC", kind: "team", owner: "usr_irfad", fingerprint: "7F:3A:91:0C", address: { mode: "relay", host: "northwind.vyre.run" }, hostedOn: "Northwind server", defaults: { timezone: "America/Los_Angeles" }, createdAt: ago(210 * DAY) };
const SETTINGS: Record<string, unknown> = {
  "engine.review_sampling": { percent: 5, labels: ["confidential", "restricted"] }, "engine.egress": { mode: "providers", hosts: [] }, "backup.encrypt": true,
  "send.cap": 2000, "send.window": "8-20", "send.throttle": 20,
};

function wrap(items: unknown[], key: string, extra: Record<string, unknown> = {}): Record<string, unknown> { return { [key]: items, total: items.length, ...extra }; }

type Handler = (input: Record<string, unknown>) => unknown;
const answers: Record<string, Handler> = {
  "access.principals.list": (i) => { const k = i.kind as string | undefined; const rows = k ? principals.filter((p) => p.kind === k) : principals; return wrap(rows, "principals"); },
  "access.principals.get": (i) => ({ principal: principals.find((p) => p.id === (i.principal as { id?: string } | undefined)?.id) ?? principals[0] }),
  "access.principals.effective": () => ({ permissions: ALL_PERMS, roles: ["rol_owner"], grants: GRANTS.slice(0, 2), owns: [{ type: "project", id: "prj_rivera" }] }),
  "access.roles.list": () => wrap(ROLES, "roles"),
  "access.roles.get": (i) => { const r = ROLES.find((x) => x.id === i.roleId || x.id === i.id) ?? ROLES[0]!; return { role: r, holders: PEOPLE.filter((p) => p.role === r.id).map((p) => ({ kind: "person", id: p.id })) }; },
  "access.roles.preview": () => ({ gains: [], loses: [], affected: 0 }),
  "access.groups.list": () => wrap(GROUPS, "groups"),
  "access.groups.get": (i) => ({ group: GROUPS.find((g) => g.id === i.groupId || g.id === i.id) ?? GROUPS[0], roles: ["rol_member"], grants: GRANTS.slice(0, 1) }),
  "access.groups.defaults_get": (i) => ({ groupId: i.groupId ?? "grp_everyone", grants: [] }),
  "access.grants.list": () => wrap(GRANTS, "grants"),
  "access.requests.list": () => wrap(REQUESTS, "requests"),
  "access.exceptions.list": () => ({ exceptions: [{ exceptionId: "exc_1", subject: { kind: "person", id: "usr_dana", name: "Dana Whitfield" }, perms: ["records.export"], effect: "deny", why: "Joined today; export waits for training", by: { id: "usr_irfad", name: "Irfad Imtiaz" }, at: ago(HOUR) }] }),
  "access.labels.list": () => ({ labels: [{ label: "public", rank: 0, providers: "any", syncToLaptop: true }, { label: "internal", rank: 1, providers: "any", syncToLaptop: true }, { label: "confidential", rank: 2, providers: "approved", syncToLaptop: true }, { label: "restricted", rank: 3, providers: "none", syncToLaptop: false }] }),
  "access.lists": () => ({}),
  "access.policies.list": () => ({ policies: POLICIES }),
  "access.reviews.list": () => wrap([{ id: "rev_1", state: "open", openedAt: ago(10 * DAY), items: 5, decided: 2 }, { id: "rev_0", state: "closed", openedAt: ago(100 * DAY), closedAt: ago(92 * DAY), items: 6, decided: 6 }], "reviews"),
  "access.reviews.get": () => ({ review: { id: "rev_1", state: "open", openedAt: ago(10 * DAY), items: 5, decided: 2 }, items: GRANTS.map((g, i) => ({ grant: g, reviewer: "usr_maya", lastUsedAt: ago((i + 1) * 3 * DAY), ...(i < 2 ? { decision: "keep" } : {}) })) }),
  "access.shares_of": () => ({ shares: [], audience: "space", can: { manage: true, share: true, export: true } }),
  "access.actors.list": () => wrap([{ id: "act_zapier", name: "Zapier", owner: "usr_sam", provider: "mcp", roles: ["rol_developer"], status: "active", engineerMcp: false, lastSeenAt: ago(3 * MIN) }, { id: "act_claude", name: "Claude Desktop", owner: "usr_maya", provider: "claude", roles: ["rol_member"], status: "active", engineerMcp: false, lastSeenAt: ago(2 * HOUR) }, { id: "act_ci", name: "Release bot", owner: "usr_sam", provider: "github", roles: ["rol_developer"], status: "pending", engineerMcp: true }], "actors"),
  "members.invites.list": () => wrap(INVITES, "invites"),
  "agents.list": () => wrap(AGENTS.map((a) => ({ agentId: a.id, name: a.name, kind: "agent", runtime: "vyre", face: a.name[0]!, role: a.role, status: a.status, ownerId: a.owner, folderId: `fld_${a.id}`, model: "claude-sonnet-4-5", accountPolicy: "asker", accountFallback: [], toolsAllowed: [], toolsDenied: [], vaultKeys: [], limits: { monthCostMicros: micros(a.limit) }, captureMode: "propose", hasComputer: ["agt_intake", "agt_billing", "agt_docs"].includes(a.id), templateVersion: a.id === "agt_scout" ? 12 : 14, createdAt: ago(40 * DAY), lastActiveAt: ago(5 * MIN) })), "agents"),
  "agents.people_summary": () => ({ people: PEOPLE.map((p) => ({ personId: p.id, assistant: true, privateAgents: AGENTS.filter((a) => a.owner === p.id).length, spendMonthMicros: micros(AGENTS.filter((a) => a.owner === p.id).reduce((s, a) => s + a.spend, 0)), paused: false })) }),
  "agents.template.get": () => ({ version: 14, files: ["AGENT.md", "style.md", "safety.md"], mode: "suggest", agents: 6 }),
  "agents.suggestions.list": () => wrap([{ suggestionId: "sug_1", agentId: "agt_scout", kind: "template", file: "safety.md", diff: "+ Ask before opening a site that needs a login.", reason: "Template v14 added this line", widening: false, state: "open", proposedBy: "svc_vyre", proposedAt: ago(2 * DAY) }, { suggestionId: "sug_2", agentId: "agt_bookings", kind: "template", file: "style.md", diff: "+ Keep replies under 120 words.", widening: false, state: "open", proposedBy: "svc_vyre", proposedAt: ago(2 * DAY) }], "suggestions"),
  "runs.list": () => wrap(RUNS, "runs"),
  "runs.people_counts": () => ({ people: PEOPLE.slice(0, 4).map((p, i) => ({ person: p.id, runs: 14 - i * 3 })) }),
  "skills.list": () => ({ skills: SKILLS }),
  "plugins.list": () => ({ plugins: PLUGINS }),
  "plugins.browse": () => wrap([{ marketplaceId: "mkt_vyre", marketplace: "Vyre plugins", name: "Calendar tools", description: "Find times and book rooms", version: "1.0.0", category: "Productivity", source: "vyre/calendar", allowed: true, installed: [] }], "plugins"),
  "plugins.marketplaces.list": () => ({ marketplaces: [{ marketplaceId: "mkt_vyre", name: "Vyre plugins", kind: "git", source: "github.com/vyre/plugins", owner: "svc_vyre", plugins: 12, allowed: true, warnings: [], updatedAt: ago(DAY) }] }),
  "plugins.connections.list": () => ({ connections: [{ connectionId: "mcc_1", name: "Docs search", scope: "space", transport: "http", url: "https://mcp.northwind.example", args: [], env: {}, headers: {}, enabled: true, createdAt: ago(30 * DAY) }] }),
  "mcp.connected.list": () => ({ agents: [{ agentId: "mca_1", clientName: "Claude Desktop", redirectHost: "claude.ai", connectedAt: ago(9 * DAY), lastSeenAt: ago(2 * HOUR), calls: 612, person: "usr_maya" }] }),
  "mcp.sessions.list": () => wrap(KEYS, "sessions"),
  "engine.accounts.list": () => ({ accounts }),
  "providers.list": () => ({ providers: providersList }),
  "providers.catalog": () => ({ providers: DRIVERS.filter(([, , kind]) => kind === "api").map(([key, name]) => ({ key, name, connections: ["api_key"], modelsSource: "live", engine: key })) }),
  "engine.policy.get": () => ({ allowedAccounts: "any", allowedModels: [], allowedProviders: ["claude_code", "opencode_go"], labelProviders: { public: ["claude_code", "opencode_go", "openai"], internal: ["claude_code", "opencode_go"], confidential: ["claude_code"], restricted: [] }, hops: { agentHops: 4, reviewLoops: 2, ciFixLoops: 3 } }),
  "engine.providers.list": () => ({ providers: DRIVERS.map(([driver, title, kind]) => ({ driver, kind, title, connected: ["claude_code", "opencode_go", "openai"].includes(driver!), allowed: driver !== "openai" })) }),
  "engine.models.list": () => ({ models: MODELS, listed: { source: "live", updatedAt: ago(HOUR), refreshing: false, failed: false } }),
  "engine.spend.get": () => ({ caps: { dayMicros: micros(60), monthMicros: micros(600), turnsPerDay: 400 }, todayMicros: micros(21.4), monthMicros: micros(253), turnsToday: 188, paused: false }),
  "engine.usage.query": () => ({ rows: spendRows, totals: usageTotals }),
  "engine.review.list": () => wrap([["trn_1", "agt_intake", "waiting", 20], ["trn_2", "agt_billing", "ok", 95], ["trn_3", "agt_docs", "flagged", 180], ["trn_4", "agt_research", "ok", 300]].map(([turnId, agentId, state, m]) => ({ turnId, threadId: `thr_${turnId}`, agentId, sampledAt: ago((m as number) * MIN), state })), "items"),
  "engine.incidents.list": () => wrap([
    { incidentId: "inc_1", kind: "runaway_spend", title: "Billing went over its monthly limit", state: "open", agentId: "agt_billing", openedAt: ago(5 * HOUR), notes: [] },
    { incidentId: "inc_2", kind: "label_denied", title: "Scout asked an outside provider to read a restricted file", state: "assigned", ownerId: "usr_maya", agentId: "agt_scout", openedAt: ago(2 * DAY), notes: [{ by: "usr_maya", at: ago(DAY), text: "Looking at what Scout was asked to do." }] },
    { incidentId: "inc_3", kind: "repeated_failure", title: "Docs failed the same step four times", state: "resolved", agentId: "agt_docs", openedAt: ago(9 * DAY), resolvedAt: ago(8 * DAY), notes: [] }], "incidents"),
  "engine.use_policy.export": () => ({ fileId: "fil_policy" }),
  "engine.now": () => ({ turns: [] }),
  "voice.status": () => ({ set: true, on: true, own: 2, who: "Irfad", checkedAt: ago(4 * MIN) }),
  "memory.learning.today": () => ({ day: "2025-10-24", passes: 31, tokensIn: 410_000, tokensOut: 52_000, rulePasses: 20, capPasses: 80, capTokens: 2_000_000, resetsAt: T + 9 * HOUR, timezone: "America/Los_Angeles", state: "learning" }),
  "gate.rules.list": () => ({ rules: [["send", "hold"], ["post", "hold"], ["pay", "hold"], ["delete", "allow"]].map(([act, mode]) => ({ act, mode, approvers: "admins", peopleOnly: false, afterHours: 4, onTimeout: "escalate", escalateTo: "role", emailBackstopHours: 4, scope: "space" })) }),
  "gate.acts.list": () => ({ acts: [["send", "Send a message", "medium"], ["post", "Post to a channel", "low"], ["pay", "Pay or spend money", "high"], ["delete", "Delete", "medium"]].map(([key, title, risk]) => ({ key, title, risk, humanToo: false, peopleOnly: false })) }),
  "schema.types.list": () => wrap(SCHEMA, "types"),
  "schema.describe": () => ({ types: DESCRIBE }),
  "schema.changes.list": () => wrap([{ changeId: "chg_1", at: ago(3 * DAY), by: "usr_sam", summary: "Added Due date to Task", destructive: false, types: ["task"] }, { changeId: "chg_2", at: ago(12 * DAY), by: "usr_maya", summary: "Renamed Client to Contact", destructive: false, types: ["contact"] }], "changes"),
  "schema.trash.list": () => ({ items: [] }),
  "schema.field_types": () => ({ fieldTypes: ["text", "select", "person", "money", "date"].map((key) => ({ key, title: key[0]!.toUpperCase() + key.slice(1), filterOps: ["is"], sortable: true, groupable: true, sealed: false })) }),
  "schema.sensitivity.scan": () => ({ suggestions: [{ field: "amount", kind: "bank", matches: 12, suggestedLabel: "confidential", seal: false }] }),
  "schema.types.get": (i) => ({ type: DESCRIBE.find((t) => t.key === i.type) ?? DESCRIBE[0] }),
  "governance.retention.get": () => ({ kinds: [["trash", "Trash", "30 days", "90 days", true], ["run_logs", "Run logs", "90 days", "90 days", false], ["transcripts", "Chat history", "forever", "forever", false], ["audit", "Audit log", "2 years", "2 years", false], ["file_versions", "File versions", "1 year", "1 year", false]].map(([key, title, d, v, o]) => ({ key, title, default: d, value: v, overridden: o, holdable: true, tombstone: false })) }),
  "governance.jobs.list": () => ({ jobs: [{ kind: "trash", lastRunAt: ago(6 * HOUR), nextRunAt: T + 18 * HOUR, lastRemoved: 14, lastSkippedOnHold: 2, state: "idle" }] }),
  "governance.holds.list": () => wrap([{ target: { kind: "folder", id: "fld_rivera_docs" }, title: "Rivera engagement", reason: "Open matter, possible dispute", by: "usr_maya", at: ago(20 * DAY) }, { target: { kind: "person", id: "usr_elena" }, title: "Elena Rivera", reason: "Client records", by: "usr_irfad", at: ago(9 * DAY) }], "holds"),
  "governance.erase.list": () => wrap([{ findingId: "ers_1", by: "usr_irfad", at: ago(40 * DAY), kinds: ["records", "chats", "mail"], tombstones: 3 }], "erasures"),
  "backup.list": () => wrap([[26 * HOUR, 4.1, "scheduled", true], [50 * HOUR, 4.0, "scheduled", true], [74 * HOUR, 4.0, "scheduled", true], [6 * DAY, 3.9, "manual", true], [9 * DAY, 3.8, "scheduled", false], [16 * DAY, 3.6, "scheduled", true]].map(([a, g, kind, ok], i) => ({ backupId: `bak_${i + 1}`, at: ago(a as number), sizeBytes: (g as number) * 1e9, seq: 60 - i, kind, verified: ok, target: "Northwind server" })), "backups"),
  "backup.config_get": () => ({ target: { kind: "s3", bucket: "northwind-backups", region: "us-west-2" }, schedule: "Every day at 03:00", enabled: true, encrypted: true, lastBackupAt: ago(26 * HOUR) }),
  "backup.health": () => ({ state: "healthy", ageHours: 26 }),
  "backup.export_status": () => ({ runId: "run_exp", state: "ready", fileId: "fil_export", name: "northwind-export.zip", sizeBytes: 4.1e9, expiresAt: T + 6 * DAY }),
  "mail.domain.list": () => wrap([{ id: "dom_1", name: "updates.northwind.example", provider: "resend", spf: "pass", dkim: "pass", dmarc: "pass", verified: true, isDefault: true, checkedAt: ago(HOUR) }, { id: "dom_2", name: "mail.northwind.example", provider: "resend", spf: "pass", dkim: "fail", dmarc: "pending", verified: false, isDefault: false, checkedAt: ago(2 * HOUR) }], "domains"),
  "mail.mailbox.list": () => wrap(MAILBOXES, "mailboxes"),
  "mail.mailbox.get": (i) => ({ mailbox: MAILBOXES.find((m) => m.id === i.mailboxId || m.id === i.id) ?? MAILBOXES[0] }),
  "mail.route.list": () => wrap(MAILBOXES.map((m, i) => ({ id: `rt_${i}`, domainId: "dom_1", localPart: m.address.split("@")[0], mailboxId: m.id, provider: "resend" })), "routes"),
  "telephony.number.list": () => wrap(NUMBERS, "numbers"),
  "telephony.registration.get": () => ({ registration: { id: "reg_1", legalName: "Northwind Advisory LLC", ein: "12-3456789", website: "https://northwind.example", contactName: "Irfad Imtiaz", contactEmail: "irfad@northwind.example", useCase: "Appointment reminders and client updates", sampleMessages: ["Hi Dana, your consult is tomorrow at 10:00. Reply C to confirm."], state: "in_review", submittedAt: ago(DAY) } }),
  "contacts.suppression.list": () => wrap([["email", "ex-client@example.com", "unsubscribe", 5], ["sms", "+1 415 555 0199", "stop", 12], ["email", "old-lead@example.org", "bounce_hard", 30]].map(([channel, address, reason, d], i) => ({ id: `sup_${i}`, channel, address, reason, source: "Replies", addedAt: ago((d as number) * DAY), addedBy: "svc_vyre" })), "rows"),
  "connectors.list": () => wrap(CONNECTORS, "connectors"),
  "connectors.get": (i) => ({ connector: CONNECTORS.find((c) => c.key === i.key) ?? CONNECTORS[0] }),
  "connections.list": () => wrap(CONNECTIONS, "connections"),
  "google.dwd.status": () => ({ configured: true, adminEmail: "irfad@northwind.example", domain: "northwind.example", lastProbeAt: ago(2 * HOUR), lastProbeOk: true, autoConnect: true, mappedMembers: 5, excluded: [], data: { mail: true, calendar: true, files: true }, keyStored: true, clientId: "1049...apps.googleusercontent.com" }),
  "google.dwd.members": () => wrap(PEOPLE.map((p) => ({ email: `${p.name.split(" ")[0]!.toLowerCase()}@northwind.example`, userId: p.id, mapped: p.id !== "usr_elena", excluded: false, mailboxState: "syncing" })), "members"),
  "google.dwd.scopes": () => ({ scopes: [] }),
  "ms.consent.status": () => ({ configured: false, consentGiven: false, policyConfirmed: false, autoConnect: false, mappedMembers: 0, excluded: [], data: { mail: false, calendar: false, files: false }, appStored: false, permissions: [], exchangeRoles: [] }),
  "ms.consent.members": () => wrap([], "members"),
  "company.status": () => ({ configured: true, provider: "google", state: "connected", domain: "northwind.example" }),
  "members.sign_in_policy.get": () => ({ policy: { secondFactor: "required", requireSso: false, allowPassword: true, allowGithub: false }, capabilities: { password: true, github: false, sso: ["google"], newMemberMfaEnrollment: true, ownerHasSecondFactor: true, currentHasSecondFactor: true } }),
  "members.sso.list": () => ({ providers: [{ key: "google", title: "Google", issuer: "https://accounts.google.com", clientId: "1049...apps.googleusercontent.com", clientSecretHandle: "vault:sso_google", enabled: true, domainHint: "northwind.example" }] }),
  "members.sign_in_github.get": () => ({ github: { secretSet: false, source: "none", callbackUrl: "https://northwind.vyre.run/auth/github", createUrl: "https://github.com/settings/applications/new" } }),
  "webhooks.list": () => wrap(WEBHOOKS, "webhooks"),
  "webhooks.get": (i) => ({ webhook: WEBHOOKS.find((w) => w.id === i.webhookId) ?? WEBHOOKS[0] }),
  "webhooks.deliveries": () => wrap(DELIVERIES, "deliveries"),
  "events.types": () => ({ types: [["record.created", "A record was created"], ["record.updated", "A record changed"], ["invite.accepted", "Someone joined"]].map(([name, summary]) => ({ name, sv: 1, summary, payload: {}, trigger: true })) }),
  "devices.list": () => wrap(DEVICES, "devices"),
  "devices.get": (i) => ({ device: DEVICES.find((d) => d.id === i.deviceId || d.id === i.id) ?? DEVICES[0], sessions: [{ id: "ses_1", principal: { kind: "person", id: "usr_irfad" }, deviceId: "dev_1", kind: "device", startedAt: ago(2 * DAY), lastSeenAt: ago(MIN), location: "San Francisco", current: true }] }),
  "devices.presence": () => ({ people: [] }),
  "sessions.list": () => ({ sessions: [] }),
  "audit.list": (i) => { const q = String(i.q ?? "").toLowerCase(); const rows = AUDIT.filter((r) => (!i.class || r.class === i.class) && (!q || `${NAME[r.actor.id]} ${r.action}`.toLowerCase().includes(q))); return { rows, total: rows.length }; },
  "audit.get": (i) => ({ row: AUDIT.find((r) => r.id === i.auditId) ?? AUDIT[0] }),
  "audit.verify": () => ({ ok: true, checked: 1012 }),
  "console.overview": () => ({ health: "degraded", attention: [{ kind: "failing_check", title: "Disk space on Berlin box is under 10 percent", ref: "chk_disk", since: ago(3 * HOUR), next: "Open Machines" }, { kind: "expiring_certificate", title: "The certificate for northwind.vyre.run renews in 12 days", ref: "crt_main", since: ago(DAY), next: "Open Servers" }, { kind: "access_review_due", title: "The quarterly access review is due", since: ago(2 * DAY), next: "Start the review" }], activity: AUDIT.filter((r) => r.class === "admin").slice(0, 5).map((r) => ({ at: r.at, actor: r.actor.id, action: r.action, ...(r.resource ? { resource: r.resource.id } : {}) })), usage: { turnsToday: 188, costMicrosMonth: micros(253), members: 7, agents: 6 }, machine: { cpuPercent: 23, memoryUsedBytes: 19.5e9, memoryTotalBytes: 32e9, diskFreeBytes: 378e9, diskTotalBytes: 640e9 }, lastBackup: { at: ago(26 * HOUR), result: "verified" } }),
  "console.usage": () => ({ rows: AGENTS.map((a) => ({ key: a.id, name: a.name, turns: Math.round(a.spend * 3.1), tokensIn: a.spend * 41_000, tokensOut: a.spend * 6_200, costMicros: micros(a.spend) })), note: "Turns and spend this month" }),
  "console.speed": () => ({ rows: [["Open a page", "ms", 120, 310, 400], ["Send a message", "ms", 90, 240, 300], ["Search", "ms", 160, 520, 500], ["Start an agent turn", "ms", 700, 1900, 2500]].map(([b, unit, p50, p95, budgetP95]) => ({ budgetId: b, unit, sense: "max", p50, p95, budgetP95, over: (p95 as number) > (budgetP95 as number) })) }),
  "health.status": () => ({ overall: "degraded", checks: [health("disk", "Disk space", "378 GB free of 640 GB"), health("records", "Records store", "Running 18 days"), health("relay", "Relay", "Connected"), health("backup", "Backups", "Last backup 26 hours ago"), health("agents", "Agent runtime", "6 agents ready"), health("cert", "Certificate", "Renews in 12 days", "degraded")] }),
  "health.services": () => ({ services: [["Records store", 18 * DAY], ["Search index", 18 * DAY], ["Relay", 4 * DAY], ["Agent runtime", 9 * DAY], ["Mail", 18 * DAY], ["Voice", 18 * DAY]].map(([name, up]) => ({ name, state: "healthy", uptimeSeconds: (up as number) / 1000, restarts: 0 })) }),
  "health.history": () => ({ samples: Array.from({ length: 24 }, (_, i) => ({ at: ago((24 - i) * HOUR), state: "healthy", latencyMs: 40 + (i * 7) % 30 })) }),
  "health.doctor": () => ({ ok: true, findings: [] }),
  "health.machine": () => ({ state: "healthy", machine: { cpuPercent: 23, memoryUsedBytes: 19.5e9, memoryTotalBytes: 32e9, diskFreeBytes: 378e9, diskTotalBytes: 640e9 } }),
  "health.disk_space": () => ({ state: "healthy", freeBytes: 378e9 }),
  "health.disk_encrypted": () => ({ state: "healthy", detail: "Encrypted" }),
  "kits.list": () => wrap([], "kits"),
  "kits.health": () => ({ state: "healthy", denials: 0 }),
  "logs.query": () => wrap([["info", "Backup finished", 26 * HOUR], ["info", "Agent Intake started a turn", 4 * MIN], ["warn", "Berlin box disk is 92% full", 3 * HOUR], ["info", "Maya Chen signed in", 12 * MIN], ["error", "Webhook delivery to hooks.slack.com failed (502)", 3 * HOUR], ["info", "Certificate check passed", 6 * HOUR]].map(([level, msg, a], i) => ({ id: i + 1, at: ago(a as number), level, msg, place: "server" })), "rows"),
  "network.status": () => ({ address: "northwind.vyre.run", mode: "relay", certificate: { host: "northwind.vyre.run", expiresAt: T + 12 * DAY, state: "degraded" }, publicIngress: true, commands: [] }),
  "network.endpoints": () => ({ endpoints: [{ kind: "relay", url: "https://northwind.vyre.run", health: "healthy", rttMs: 38 }, { kind: "direct", url: "https://203.0.113.20:8443", health: "healthy", rttMs: 12 }] }),
  "network.public_hostnames": () => ({ hosts: [["northwind.vyre.run", "app"], ["forms.northwind.vyre.run", "form"], ["book.northwind.vyre.run", "booking"], ["hooks.northwind.vyre.run", "hook"]].map(([host, kind]) => ({ host, kind, certificate: "healthy" })) }),
  "network.servers": () => ({ servers: SERVERS }),
  "updates.status": () => ({ current: "1.4.1", channel: "stable", available: "1.4.2", lastResult: "ok" }),
  "updates.history": () => ({ updates: [{ from: "1.4.0", to: "1.4.1", at: ago(18 * DAY), result: "ok", seconds: 94 }, { from: "1.3.9", to: "1.4.0", at: ago(40 * DAY), result: "ok", seconds: 101 }] }),
  "computers.list": () => wrap(COMPUTERS, "computers"),
  "computers.health": () => ({ state: "healthy", runtime: "ready", awake: 2, asleep: 1 }),
  "spaces.get": () => ({ space: ISO_SPACE }),
  "settings.get": (i) => { const key = String(i.key); return { row: { key, scope: "space", page: "console", title: key, value: SETTINGS[key] ?? null, default: SETTINGS[key] ?? null, source: "space", floorable: false } }; },
  "settings.list": () => ({ rows: [] }),
  "files.list": (i) => i.folderId === "fld_template" ? { files: [["AGENT.md", 2.1], ["style.md", 1.2], ["safety.md", 0.9]].map(([name, kb], n) => ({ fileId: `fil_tpl_${n}`, folderId: "fld_template", name, kind: "markdown", mime: "text/markdown", size: (kb as number) * 1000, version: 3, label: 1, ownerId: "usr_irfad", createdAt: ago(40 * DAY), updatedAt: ago(9 * DAY), updatedBy: "usr_maya", thumb: false, holds: 0 })), folders: [], total: 3 } : { files: [], folders: [], total: 0 },
  "channels.home": () => ({ channel: { channelId: "chn_home", name: "Home", mainThreadId: "thr_home", legacy: false } }),
  "channels.list": () => ({ channels: [] }),
  "projects.list": () => ({ projects: [] }),
  "identity.whoami": () => ({ id: "usr_irfad", name: "Irfad Imtiaz" }),
  "search.query": () => ({ results: [] }),
  "search.resolve": () => ({ results: [] }),
  "vault.folders.list": () => ({ folders: [] }),
  "vault.items.list": () => ({ items: [{ id: "vit_do", name: "DigitalOcean, Northwind", handle: "#Northwind_DO", kind: "secret", updatedAt: ago(DAY) }], counts: {} }),
  // People > Requests: the join link and who is waiting
  "members.join_link.get": () => ({ link: { on: true, role: "rol_member", waiting: 2, total: 7, address: "https://northwind.vyre.run/join/NW7K-4QPD", createdAt: ago(20 * DAY) } }),
  "members.join_requests.list": () => ({ requests: [{ id: "jrq_1", name: "Priya Nair", email: "priya@northwind.example", note: "Joining the Finance team", role: "rol_member", state: "waiting", at: ago(3 * HOUR) }, { id: "jrq_2", name: "Tom Becker", email: "tom@northwind.example", role: "rol_member", state: "waiting", at: ago(DAY) }], total: 2 }),
  // AI > AI accounts: people who run on their own sign-ins
  "providers.own_people": () => ({ people: [{ personId: "usr_maya", accounts: 1 }, { personId: "usr_sam", accounts: 2 }] }),
  // Space > Transfer or delete: the last export
  "spaces.export_latest": () => ({ at: ago(9 * DAY) }),
  // AI > Voice
  // voice: Deepgram on (the prototype); voice_new: no key yet; voice_eleven: ElevenLabs in use with a Deepgram key already stored; voice_failing: the key stopped working
  "talk.space.status": () => part.variant === "new" ? { set: false, on: false } : part.variant === "eleven" ? { set: true, on: true, provider: "elevenlabs", keyed: ["elevenlabs", "deepgram"], itemId: "vit_voice", setBy: "usr_irfad", checkedAt: ago(HOUR), state: "ok", peopleOwnKey: 1 } : { set: true, on: true, provider: "deepgram", keyed: ["deepgram"], itemId: "vit_voice", setBy: "usr_irfad", checkedAt: ago(4 * MIN), state: part.variant === "failing" ? "failing" : "ok", peopleOwnKey: 2 },
  "talk.status": () => ({ on: true, provider: part.variant === "eleven" ? "elevenlabs" : "deepgram", language: "en", model: "eleven_flash_v2_5", source: "space", spaceOn: true, mayManage: true, providers: [{ key: "elevenlabs", name: "ElevenLabs", keyUrl: "https://elevenlabs.io/app/settings/api-keys", models: [{ id: "eleven_flash_v2_5", label: "Flash" }, { id: "eleven_multilingual_v2", label: "Multilingual" }], languages: [{ id: "en", label: "English" }, { id: "es", label: "Spanish" }] }, { key: "deepgram", name: "Deepgram", keyUrl: "https://console.deepgram.com", models: [{ id: "nova-3", label: "Nova 3" }], languages: [{ id: "en", label: "English" }] }] }),
  // Computers > CI runners: off by default; _on = on with the month's cost and runs; _paused = on and at the cap
  "ci.settings.get": () => ({ settings: { enabled: part.variant !== "", provider: "digitalocean", vaultKeyRef: "#Northwind_DO", region: "nyc3", size: "s-4vcpu-8gb", image: "ubuntu-24-04-x64", maxConcurrent: 3, monthlyCapUsd: 50, maxJobMinutes: 30, labels: ["vyre"] }, keyReady: true, githubApp: part.variant === "" ? { ready: false, installed: false, missing: [], acceptUrl: null, orgAcceptUrl: null } : { ready: true, installed: true, missing: [], acceptUrl: null, orgAcceptUrl: null } }),
  "ci.cost.month": () => part.variant === "paused" ? { month: "2026-11", spentUsd: 50, capUsd: 50, leftUsd: 0, runs: 1320, paused: true, byRepo: [{ repo: "northwind/website", runs: 980, costUsd: 36.4 }, { repo: "northwind/portal", runs: 340, costUsd: 13.6 }] } : { month: "2026-11", spentUsd: 4.12, capUsd: 50, leftUsd: 45.88, runs: 212, paused: false, byRepo: [{ repo: "northwind/website", runs: 150, costUsd: 2.9 }, { repo: "northwind/portal", runs: 62, costUsd: 1.22 }] },
  "ci.runs.list": (i) => {
    // today = since UTC midnight; "early" rows are from before it, so the day's tiles count only part of the list
    const sod = T - (T % DAY), into = T - sod;
    const today = (m: number): number => Math.min(m * MIN, Math.max(MIN, into - MIN));
    const early = (m: number): number => into + m * MIN;
    const mk = (id: string, repo: string, job: string, state: string, conclusion: string | null, queued: number, len: number, cost: number, note: string | null) => ({ runId: id, jobId: 11, workflowRunId: 99, repo, jobName: job, projectId: null, state, dropletId: "d1", size: "s-4vcpu-8gb", queuedAt: ago(queued), startedAt: ago(queued), endedAt: state === "running" ? null : ago(queued - len * MIN), conclusion, costUsd: cost, note });
    const all = [mk("cir_1", "northwind/website", "Checks / tests", "finished", "failure", today(12), 3.8, 0.01, "3 tests failing"), mk("cir_2", "northwind/website", "Checks / lint", "finished", "success", today(14), 1.03, 0.01, null), mk("cir_3", "northwind/portal", "Build / preview site", "running", null, today(3), 0, 0, null), mk("cir_6", "northwind/website", "Checks / tests", "finished", "failure", today(49), 3.5, 0.01, "3 tests failing"), mk("cir_7", "northwind/website", "Checks / lint", "finished", "success", today(49), 0.97, 0.01, null), mk("cir_8", "northwind/portal", "Checks / end-to-end", "finished", "success", today(300), 27.7, 0.32, null), mk("cir_4", "northwind/portal", "Checks / end-to-end", "swept", null, early(40), 30, 0.04, "Removed 1 machine left running"), mk("cir_5", "northwind/website", "Checks / tests", "finished", "success", early(240), 3, 0.01, null)];
    return { runs: all.filter((r) => r.repo === i.repo) };
  },
  // Apps > GitHub: _own = the Space has its own app and an install
  "github.app.get": () => { if (part.variant !== "own") throw new Error("no app"); return { id: 982114, slug: "northwind-vyre", name: "Northwind Vyre", permissions: { contents: "write", pull_requests: "write", actions: "read", checks: "write", metadata: "read" }, events: ["push", "pull_request", "workflow_job"] }; },
  "github.installations.list": () => ({ installations: part.variant === "own" ? [{ id: 5512, account: "northwind", repositorySelection: "all" }, { id: 5513, account: "northwind-labs", repositorySelection: "selected" }] : [] }),
  // Agents > Skills and plugins: Installed for the Space
  "install.list": () => ({ installs: [
    { installId: "ins_1", kind: "skill", name: "contract-review", repo: "northwind/vyre-skills", commit: "a41c9e07d2", url: "https://github.com/northwind/vyre-skills", by: "usr_maya", at: ago(12 * DAY), installed: { for: "space", version: "1.2.0" } },
    { installId: "ins_2", kind: "mcp_remote", name: "Linear", repo: "linear/mcp", commit: "7be03a1c55", url: "https://github.com/linear/mcp", by: "usr_sam", at: ago(5 * DAY), installed: { for: "agent", agentId: "agt_scout" } },
    { installId: "ins_3", kind: "plugin", name: "invoice-tools", repo: "northwind/plugins", commit: "0c9d44e8b1", url: "https://github.com/northwind/plugins", by: "usr_irfad", at: ago(21 * DAY), installed: { for: "space", version: "0.9.4" } },
    { installId: "ins_4", kind: "site", name: "client-portal", repo: "northwind/portal-site", commit: "93ffa210ce", url: "https://github.com/northwind/portal-site", by: "usr_lena", at: ago(2 * DAY), installed: { for: "me" } },
  ] }),
  "install.check_update": (i) => i.installId === "ins_3" ? { changed: true, plan: { planId: "pln_1", version: "1.0.0", state: "planned", kind: "plugin", name: "invoice-tools", summary: "Invoice helpers.", repo: "northwind/plugins", commit: "5d11b7a3f0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", url: "https://github.com/northwind/plugins", needs: { domains: ["api.stripe.com"], vaultKeys: [], files: [] }, skills: [], problems: [], who: [{ key: "me", label: "Just you", allowed: true }, { key: "space", label: "Everyone in the Space", allowed: true }], card: { name: "invoice-tools", kind: "plugin", summary: "Invoice helpers.", commit: "5d11b7a3f0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", needs: { domains: ["api.stripe.com"], vaultKeys: [], files: [] } }, diff: { from: "0c9d44e8b1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", to: "5d11b7a3f0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", added: [], removed: [], changed: [{ path: "plugin.json", plus: ["new"], minus: ["old"] }] } } } : { changed: false },
  "skills.page": () => {
    const perms = { scripts: [], mcpServers: [], network: [], vaultKeys: [] };
    const item = (name: string, description: string) => ({ skillId: `skl_${name}`, name, description, source: "Northwind", origin: "space", version: "1.0", enabled: true, perms, setup: {}, needs: [], updatedAt: ago(9 * DAY) });
    return {
      waiting: [{ ...item("client-letters", "Draft a client letter in the firm's layout"), sharer: "usr_lena", sharerName: "Lena Ortiz", toSpace: true, state: "waiting", growth: [], agents: [] }],
      mine: [{ ...item("my-weekly-report", "How I like the weekly report written"), agents: ["agt_research"], sharedWith: [] }],
      shared: [], space: [item("writing-style", "Write in the firm's voice: short, plain, no filler"), item("intake-checklist", "The questions to ask a new client and how to log the answers"), item("invoice-format", "How Northwind lays out an invoice")],
      builtin: [{ name: "meeting-notes", description: "Turn a meeting transcript into notes and tasks" }, { name: "search-the-web", description: "Search and cite sources" }],
      agents: AGENTS.map((a) => ({ agentId: a.id, name: a.name })), policy: { scriptsAdminOnly: true }, admin: true, me: "usr_irfad",
    };
  },
  "skills.members": () => ({ skills: [{ owner: "usr_lena", ownerName: "Lena Ortiz", name: "client-letters", shared: false, toSpace: false }] }),
  "files.tree": () => ({ roots: [{ key: "agent_template", title: "Agent template", kind: "folder", folderId: "fld_template", count: 3 }] }),
  "files.folder.get": () => ({ folder: { folderId: "fld_rivera_docs", name: "Rivera engagement", path: "/Rivera engagement", fileCount: 18, folderCount: 2, scope: "space", label: 2, git: false, reviewChanges: false } }),
  "projects.get": () => ({ project: { projectId: "prj_rivera", recordId: "rec_rivera", type: "matter", title: "Rivera engagement", status: "Open", lead: "usr_lena", channelId: "chn_rivera", folderId: "fld_rivera_docs", memberCount: 5, openTasks: 7, lateTasks: 1 } }),
  "providers.space_key.get": () => ({ set: true, providerKey: "anthropic", name: "Northwind Anthropic key", models: ["claude-sonnet-4-5"], state: "ok", setBy: "usr_irfad", setAt: ago(30 * DAY), checkedAt: ago(HOUR), mayManage: true }),
  "spaces.image": () => ({}),
  "tasks.get": () => ({}),
};

answers["computers.hosts"] = () => ({ available: true, hosts: [{ hostId: "this", kind: "space", name: "Northwind server", online: true, canRun: true, runs: 3 }, { hostId: "srv_box", kind: "server", name: "Berlin box", online: true, canRun: true, runs: 1 }] });

// Agents > Hooks: four hooks (an admin's command, one an agent made, a paused one, one that stopped an email lately); hooks_empty has none
const hook = (id: string, o: Record<string, unknown>): Record<string, unknown> => ({ id, scope: "space", matcher: "", paused: false, madeBy: "usr_maya", madeByKind: "admin", helpers: false, timeoutSec: 10, createdAt: ago(20 * DAY), updatedAt: ago(20 * DAY), mine: false, canChange: true, ...o });
const HOOKS = [
  hook("hk_fmt", { event: "tool.after", kind: "command", line: "After a tool edits a file, run the formatter", spec: { command: "npm run format" }, matcher: "files.write" }),
  hook("hk_files", { event: "outward.before", kind: "check", paused: true, madeBy: "usr_irfad", line: "Before a file leaves the Space, check it is not marked private", spec: { instruction: "Confirm the file is not marked private" }, matcher: "files.*" }),
  hook("hk_mail", { event: "outward.before", kind: "check", line: "Before an email goes to a client, check the address is in Contacts", spec: { instruction: "Check the address is in Contacts" }, matcher: "email.send" }),
];
const AGENT_HOOKS = [hook("hk_notes", { scope: "agent", agentId: "agt_docs", madeBy: "agt_docs", madeByKind: "agent", event: "turn.end", kind: "action", line: "After a turn ends, Docs adds a line to the weekly notes", spec: { cap: "notes.add", input: {} } })];
const hookRun = (id: number, hookId: string, outcome: string, at: number, detail?: string): Record<string, unknown> => ({ id, hookId, event: "tool.after", outcome, ms: 40, at, ...(detail ? { detail } : {}) });
answers["hooks.list"] = (i) => ({ hooks: part.variant === "empty" ? [] : i["scope"] === "agent" ? (i["agentId"] === "agt_docs" ? AGENT_HOOKS : []) : HOOKS, agentHooks: true });
answers["hooks.policy.get"] = () => ({ agentHooks: true });
answers["hooks.runs.list"] = (i) => {
  const all = [hookRun(1, "hk_fmt", "ok", ago(3 * MIN)), hookRun(2, "hk_mail", "blocked", ago(2 * HOUR), "The address is not in Contacts"), hookRun(3, "hk_notes", "ok", ago(DAY)), hookRun(4, "hk_mail", "ok", ago(3 * DAY))];
  const outcomes = i["outcomes"] as string[] | undefined;
  return { runs: part.variant === "empty" ? [] : all.filter((r) => (outcomes ? outcomes.includes(String(r["outcome"])) : true) && (typeof i["since"] === "number" ? Number(r["at"]) >= i["since"] : true)) };
};

const machines = machinesCall();
const part = { current: "", variant: "" };
async function call(cap: string, input: unknown): Promise<unknown> {
  const i = (input ?? {}) as Record<string, unknown>;
  const log = (tag: string): void => console.log(`${tag} ${part.current} ${cap} ${JSON.stringify(i).slice(0, 140)}`);
  if (cap.startsWith("machines.")) { log("CAP"); return machines(cap, input); }
  const h = answers[cap];
  if (h) { log("CAP"); return h(i); }
  log("UNSCRIPTED");
  return {};
}

function consoleData(): ReturnType<typeof createSampleConsole>["data"] {
  const sample = createSampleConsole();
  const base = sample.data;
  sample.replica.put("audit", AUDIT.map((r) => ({ ...r }) as never));
  sample.replica.resolve("console.overview", () => (answers["console.overview"] as Handler)({}) as never);
  sample.replica.resolve("audit.list", (_t, input) => (answers["audit.list"] as Handler)(input as Record<string, unknown>) as never);
  sample.replica.resolve("audit.get", (_t, input) => (answers["audit.get"] as Handler)(input as Record<string, unknown>) as never);
  return {
    ...base, call, me: { id: "usr_irfad", name: "Irfad Imtiaz", role: "Owner" }, space: { id: "northwind", name: "Northwind", address: "northwind.vyre.run" },
    can: () => true, name: (id: string) => NAME[id] ?? id, agentName: (id: string) => NAME[id], clock: () => ({ now: T }),
  };
}

/** The Space defaults the real Console draws through the Settings rows (shell/providers/console.tsx DEFAULTS). */
const DEFAULTS: Record<string, string> = { memlearn: "memlearn", "def-access": "people", "def-agents": "agents", "def-memory": "memory", "def-data": "data", "def-apps": "apps", "def-advanced": "advanced" };

export default function Mount(): ReactNode {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { const raw = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "overview"; const [p, v] = raw.split("_"); part.current = p!; part.variant = v ?? ""; setId(p!); }, []);
  // hooks_add: the Add a hook sheet open over the page. hooks_only: the same sheet, then the Only for picker pressed so its menu is open.
  useEffect(() => {
    if (id !== "hooks" || (part.variant !== "add" && part.variant !== "only")) return undefined;
    const doc = (globalThis as { document?: { querySelector(s: string): { click(): void } | null } }).document;
    const t = setTimeout(() => doc?.querySelector("[data-testid='hooks-add']")?.click(), 900);
    const t2 = part.variant === "only" ? setTimeout(() => doc?.querySelector("[aria-label='Only for']")?.click(), 1800) : undefined;
    return () => { clearTimeout(t); if (t2) clearTimeout(t2); };
  }, [id]);
  const data = useMemo(() => consoleData(), []);
  const settings = useMemo(() => createSampleSettings().data, []);
  if (id === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return <ConsoleDataProvider value={data}><View style={{ flex: 1, minHeight: 1000 }}><ConsoleShell key={id} embedded initialPage={id} renderPage={(pid, state) => DEFAULTS[pid] ? <SettingsDataProvider value={settings}><SpaceDefaults page={DEFAULTS[pid] as never} flush={state['extra'] === true} /></SettingsDataProvider> : consolePageFor(pid, state as Record<string, string | undefined>)} /></View></ConsoleDataProvider>;
}
