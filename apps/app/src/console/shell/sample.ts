// The sample Space behind the Console screen tests and screenshots: Northwind, seen by an Owner, a Developer, or a Member with no console access. A fake replica holds the rows; every
// capability a page reads is registered with a resolver over them, and the writes (verify, export) answer from the same rows, so each control in a mount works. The real replica is
// SQLite behind the same surface.
import { createFakeReplica, createScreenHooks } from "../../../../../client/src/index.ts";
import type { FakeReplica } from "../../../../../client/src/index.ts";
import { screensById } from "../../../../../generated/screens.ts";
import type { CapMap } from "../../../../../generated/types.ts";
import type { ConsoleData } from "./data.tsx";
import { actionPhrase } from "./format.ts";

export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export type Viewer = "owner" | "developer" | "member";

const PERMS: Readonly<Record<Viewer, readonly string[]>> = {
  owner: ["console.access", "audit.read", "access.manage", "policy.manage", "members.invite", "members.remove", "agents.manage", "computers.use", "schema.manage", "records.hold", "records.export", "server.backups", "server.update", "server.logs", "server.network", "ai.models", "ai.spend", "ai.incidents", "comms.domains", "comms.numbers", "comms.shared_send", "engineer.mcp"],
  developer: ["console.access", "schema.manage", "server.logs", "engineer.mcp", "audit.read"],
  member: [],
};

export const NAMES: Readonly<Record<string, string>> = {
  usr_irfad: "Irfad Imtiaz", usr_priya: "Priya Raman", usr_omar: "Omar Haddad", usr_lena: "Lena Berg", agt_intake: "Intake", agt_docs: "Docs", agt_billing: "Billing",
  rec_rivera: "Rivera engagement", rol_delivery: "Delivery role", con_gmail: "Gmail connection", num_main: "main number", dom_northwind: "northwind.example", svc_gate: "Gate",
};

type OverviewOut = CapMap["console.overview"]["out"];
type AuditRow = CapMap["audit.list"]["out"]["rows"][number];

const ev = (n: number, ago: number, actor: AuditRow["actor"], action: string, cls: AuditRow["class"], extra: Partial<AuditRow> = {}): AuditRow => ({
  id: `aud_${String(n).padStart(3, "0")}`, at: SAMPLE_NOW - ago, actor, action, class: cls, traceId: `trc_${String(Math.ceil(n / 2)).padStart(4, "0")}`, seq: 1000 - n, ...extra,
});
const person = (id: string): AuditRow["actor"] => ({ kind: "person", id });
const agent = (id: string): AuditRow["actor"] => ({ kind: "agent", id });

export const AUDIT: readonly AuditRow[] = [
  ev(1, 6 * MIN, person("usr_priya"), "role.changed", "admin", { resource: { type: "space", id: "usr_omar" }, before: { role: "Member" }, after: { role: "Developer" } }),
  ev(2, 22 * MIN, person("usr_irfad"), "invite.created", "admin", { resource: { type: "space", id: "usr_lena" }, after: { role: "Member", expires: "7 days" } }),
  ev(3, 41 * MIN, agent("agt_intake"), "record.revealed", "sensitive", { resource: { type: "record", id: "rec_rivera" }, onBehalfOf: person("usr_priya") }),
  ev(4, 2 * HOUR, person("usr_omar"), "file.opened", "deny", { resource: { type: "folder", id: "rec_rivera" } }),
  ev(5, 3 * HOUR, person("usr_irfad"), "gate.rule.changed", "admin", { resource: { type: "space", id: "svc_gate" }, before: { send: "ask" }, after: { send: "approve" } }),
  ev(6, 5 * HOUR, agent("agt_billing"), "record.updated", "change", { resource: { type: "record", id: "rec_rivera" }, onBehalfOf: person("usr_lena"), before: { status: "Draft" }, after: { status: "Sent" } }),
  ev(7, 9 * HOUR, person("usr_lena"), "signed.in", "sign_in"),
  ev(8, 20 * HOUR, person("usr_priya"), "export.created", "admin", { resource: { type: "space", id: "svc_gate" } }),
  ev(9, 1 * DAY, agent("agt_docs"), "record.created", "change", { resource: { type: "record", id: "rec_rivera" }, onBehalfOf: person("usr_omar") }),
  ev(10, 2 * DAY, person("usr_irfad"), "person.erased", "erase", { resource: { type: "space", id: "usr_lena" } }),
  ev(11, 3 * DAY, person("usr_omar"), "signed.in", "sign_in"),
  ev(12, 4 * DAY, person("usr_priya"), "connection.added", "admin", { resource: { type: "connection", id: "con_gmail" } }),
];

export function overviewFor(busy: boolean): OverviewOut {
  return {
    health: busy ? "degraded" : "healthy",
    attention: busy ? [
      { kind: "failing_check", title: "Disk space on the server is under 15 percent", ref: "chk_disk", since: SAMPLE_NOW - 3 * HOUR, next: "Open Server" },
      { kind: "expiring_certificate", title: "The certificate for northwind.vyre.run expires in 9 days", ref: "crt_main", since: SAMPLE_NOW - DAY, next: "Open Network" },
      { kind: "access_review_due", title: "The quarterly access review is due", since: SAMPLE_NOW - 2 * DAY, next: "Start the review" },
    ] : [],
    activity: AUDIT.filter((e) => e.class === "admin").slice(0, 5).map((e) => ({ at: e.at, actor: e.actor.id, action: e.action, ...(e.resource ? { resource: e.resource.id } : {}) })),
    usage: { turnsToday: 1284, costMicrosMonth: 412_000_000, members: 14, agents: 6 },
  };
}

export interface SampleConsole {
  data: ConsoleData;
  replica: FakeReplica;
  calls: { cap: string; input: unknown }[];
  opened: string[];
  failNext(cap: string): void;
}

export function createSampleConsole(o: { viewer?: Viewer; busy?: boolean } = {}): SampleConsole {
  const viewer = o.viewer ?? "owner";
  const replica = createFakeReplica("northwind");
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const failing = new Set<string>();
  const perms = new Set(PERMS[viewer]);

  replica.put("audit", AUDIT.map((r) => ({ id: r.id, ...r }) as never));
  replica.resolve("console.overview", () => overviewFor(o.busy ?? true));
  replica.resolve("audit.list", (_t, input) => {
    const q = (input.q ?? "").toLowerCase();
    const rows = AUDIT.filter((r) => (!input.class || r.class === input.class) && (!input.traceId || r.traceId === input.traceId)
      && (!q || `${NAMES[r.actor.id] ?? r.actor.id} ${actionPhrase(r.action)}`.toLowerCase().includes(q)));
    return { rows: [...rows], total: rows.length };
  });
  replica.resolve("audit.get", (_t, input) => {
    const row = AUDIT.find((r) => r.id === input.auditId);
    if (!row) throw new Error(`no such audit event ${input.auditId}`);
    return { row };
  });
  replica.resolve("audit.verify", () => ({ ok: true, checked: 1012 }));
  replica.resolve("audit.export", () => ({ fileId: "fil_audit_export", rows: AUDIT.length }));

  const writes: Record<string, (input: unknown) => unknown> = {
    "audit.verify": () => ({ ok: true, checked: 1012 }),
    "audit.export": () => ({ fileId: "fil_audit_export", rows: AUDIT.length }),
  };
  const data: ConsoleData = {
    screens: createScreenHooks(replica, screensById),
    async call(cap, input) {
      calls.push({ cap, input });
      if (failing.delete(cap)) throw new Error(`${cap} failed`);
      const w = writes[cap];
      if (w) return w(input);
      throw new Error(`no handler for ${cap}`);
    },
    me: viewer === "owner" ? { id: "usr_irfad", name: "Irfad Imtiaz", role: "Owner" } : viewer === "developer" ? { id: "usr_omar", name: "Omar Haddad", role: "Developer" } : { id: "usr_lena", name: "Lena Berg", role: "Member" },
    space: { id: "northwind", name: "Northwind", address: "northwind.vyre.run" },
    can: (perm) => perms.has(perm),
    name: (id) => NAMES[id] ?? id,
    nav: { openPage: (id) => void opened.push(`page:${id}`), openApp: () => void opened.push("app") },
    clock: () => ({ now: SAMPLE_NOW }),
  };
  return { data, replica, calls, opened, failNext: (cap) => void failing.add(cap) };
}
