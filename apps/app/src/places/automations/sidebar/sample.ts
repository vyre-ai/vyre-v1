// The sample Spaces behind the Automations screen tests and screenshots: Northwind (the default Space, filled from the prototype's Automations place) and Harbor Studio.
// A fake replica holds the rows; each capability the sidebar and canvas read is registered with a resolver over those rows, and the writes they make (create, update, move,
// enable, delete, group edits, restore) change the rows, so every control in a mount really works. The real replica is SQLite behind the same surface.
import { createFakeReplica, createScreenHooks, liveQuery } from "../../../../../../client/src/index.ts";
import type { FakeReplica, LiveQuery, Row, ScreenHooks } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { AutomationsData, AutomationsNav } from "../canvas/data.tsx";
import { check, type Automation, type Definition, type Issue, type KeyChoice } from "../canvas/model.ts";
import type { AutoRow, GroupRow, JourneyRow } from "./model.ts";

export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const DAY = 86_400_000;
const at = (daysAgo: number, min = 0): number => SAMPLE_NOW - daysAgo * DAY - min * 60_000;

type Node = Definition["nodes"][number];
const n = (id: string, key: string, o: Partial<Node> & { input?: Record<string, unknown> } = {}): Node => ({ input: {}, ...o, id, key });

/** "New lead follow-up", the prototype's canvas: two triggers, a lookup, an AI draft, a Paths step with a Text lane (wait, then Did they reply) and an Otherwise Email lane. */
export const LEAD_FOLLOW_UP: Definition = {
  triggers: [
    { key: "record_change", config: { label: "A new lead is created" }, filter: { where: "Source is Meta" } },
    { key: "form_submit", config: { label: "Client intake form is submitted" } },
  ],
  start: ["find"],
  nodes: [
    n("find", "records.find", { title: "Look up the person by email", input: { summary: "type person · where email is trigger.e...", type: "person", where: "email is trigger.email" }, next: ["draft"] }),
    n("draft", "ai", { title: "Draft a personal reply from the first hello", ai: { agentId: "agt_intake", keyId: "key_claude", backupKeyId: "key_nw_openai" }, input: { prompt: "Write a short, warm first hello" }, next: ["mobile"] }),
    n("mobile", "paths", {
      title: "Does the lead have a mobile number?", input: {},
      branches: [{ label: "Has a mobile", to: "text", when: "lead.phone is not empty" }, { label: "Otherwise", to: "email" }],
    }),
    n("text", "send_sms", { title: "Text the lead a first hello", input: { summary: "Twilio · action messages.create ...", to: "{{lead.phone}}", body: "{{draft.text}}" }, next: ["wait"] }),
    n("wait", "wait", { title: "Wait until they reply, or 1 day", input: { note: "They reply by text, up to 1 day", event: { event: "sms.received" }, timeout: "1d" }, next: ["replied"] }),
    n("replied", "paths", {
      title: "Did they reply?", input: {},
      branches: [{ label: "They replied", to: "task", when: "wait.resumedBy is event" }, { label: "Otherwise", to: "nudge" }],
    }),
    n("task", "create_task", { title: "Ask Lena to call the lead", input: { title: "Call {{lead.name}}", assignee: "Lena Ortiz" } }),
    n("nudge", "send_email", { title: "Nudge by email after a day", input: { summary: "Gmail · to {{lead.email}} · subject Following up", to: "{{lead.email}}" } }),
    n("email", "send_email", { title: "Email the lead a first hello", input: { summary: "Gmail · to {{lead.email}} · subject T...", to: "{{lead.email}}" } }),
  ],
};

const INVOICES: Definition = {
  triggers: [{ key: "schedule", config: { cron: "Every Monday 9:00" } }],
  start: ["find"],
  nodes: [
    n("find", "records.find", { title: "Find invoices 30 days overdue", input: { type: "invoice", where: "overdue > 30d" }, next: ["each"] }),
    n("each", "loop", { title: "For each invoice", input: { items: "find.records" }, branches: [{ label: "Each", to: "write" }], next: ["approve"] }),
    n("write", "ai", { title: "Billing writes the reminder", ai: { agentId: "agt_billing", keyId: "key_nw_openai", backupKeyId: "key_claude" }, input: {} }),
    n("approve", "approval", { title: "Maya approves the batch", input: { title: "Send the reminders", approver: "Maya Chen", timeout: "2d" }, next: ["send"] }),
    n("send", "send_email", { title: "Send the reminders", input: { to: "{{invoice.client_email}}" } }),
  ],
};

const SIMPLE: Definition = {
  triggers: [{ key: "schedule", config: { cron: "Every day 8:00" } }],
  start: ["post"],
  nodes: [n("post", "post_message", { title: "Post the morning digest", input: { channelId: "#general", text: "{{digest.text}}" } })],
};

interface Spec { id: string; name: string; kind: "personal" | "space"; owner: string; group?: string; status: AutoRow["status"]; version: number; triggers: string[]; failed: number; last?: AutoRow["lastRun"]; def?: Definition; shared?: boolean }
const run = (status: string, ago: number): NonNullable<AutoRow["lastRun"]> => ({ runId: `run_${status}_${ago}`, status, at: at(0, ago) });

export interface SampleSpace {
  id: "northwind" | "harbor";
  name: string;
  me: { id: string; name: string };
  names: Record<string, string>;
  keys: KeyChoice[];
  groups: GroupRow[];
  specs: Spec[];
  journeys: JourneyRow[];
  reasons: Record<string, string>;
}

export const northwind: SampleSpace = {
  id: "northwind", name: "Northwind", me: { id: "usr_irfad", name: "Irfad Imtiaz" },
  names: { usr_irfad: "Irfad Imtiaz", usr_maya: "Maya Chen", usr_omar: "Omar Haddad", usr_lena: "Lena Ortiz", agt_intake: "Intake", agt_billing: "Billing", agt_assistant: "Assistant", key_claude: "Your Claude sign-in", key_nw_openai: "Northwind OpenAI key" },
  keys: [{ id: "key_claude", name: "Your Claude sign-in", kind: "subscription" }, { id: "key_nw_openai", name: "Northwind OpenAI key", kind: "api" }],
  groups: [
    { id: "agr_daily", name: "Daily", count: 1, order: 0 }, { id: "agr_money", name: "Money", count: 1, order: 1 }, { id: "agr_maya", name: "Maya's reports", count: 1, order: 2 },
    { id: "agr_sales", name: "Sales", count: 5, order: 3 }, { id: "agr_billing", name: "Billing", count: 1, order: 4 }, { id: "agr_intake", name: "Intake", count: 5, order: 5 },
  ],
  specs: [
    { id: "aut_digest", name: "Morning digest", kind: "personal", owner: "usr_irfad", group: "agr_daily", status: "on", version: 2, triggers: ["Every day 8:00"], failed: 0, def: SIMPLE },
    { id: "aut_flag", name: "Flag invoices over $5k to me", kind: "personal", owner: "usr_irfad", group: "agr_money", status: "on", version: 3, triggers: ["A record changes"], failed: 1, last: run("failed", 90), def: SIMPLE },
    { id: "aut_pipeline", name: "Weekly pipeline report", kind: "space", owner: "usr_maya", group: "agr_maya", status: "on", version: 4, triggers: ["Every Monday 7:00"], failed: 0, def: SIMPLE, shared: true },
    { id: "aut_lead", name: "New lead follow-up", kind: "space", owner: "usr_irfad", group: "agr_sales", status: "paused", version: 5, triggers: ["A record changes"], failed: 1, last: run("failed", 40), def: LEAD_FOLLOW_UP },
    { id: "aut_score", name: "Lead scoring", kind: "space", owner: "usr_maya", group: "agr_sales", status: "on", version: 3, triggers: ["A record changes"], failed: 0, def: SIMPLE },
    { id: "aut_hot", name: "Hot lead alert", kind: "space", owner: "usr_maya", group: "agr_sales", status: "on", version: 2, triggers: ["A record changes"], failed: 0, def: SIMPLE },
    { id: "aut_nurture", name: "Nurture sequence", kind: "space", owner: "usr_maya", group: "agr_sales", status: "off", version: 2, triggers: ["A record changes"], failed: 0, def: SIMPLE },
    { id: "aut_demo", name: "Book the demo", kind: "space", owner: "usr_omar", group: "agr_sales", status: "on", version: 1, triggers: ["A form is submitted"], failed: 0, def: SIMPLE },
    { id: "aut_invoice", name: "Invoice reminders", kind: "space", owner: "usr_irfad", group: "agr_billing", status: "on", version: 4, triggers: ["Every Monday 9:00"], failed: 1, last: run("waiting", 25), def: INVOICES },
    { id: "aut_meeting", name: "Meeting transcript to tasks", kind: "space", owner: "usr_omar", group: "agr_intake", status: "on", version: 2, triggers: ["A meeting transcript is ready"], failed: 0, last: run("running", 1), def: SIMPLE },
    { id: "aut_intake1", name: "Intake form to record", kind: "space", owner: "usr_omar", group: "agr_intake", status: "on", version: 3, triggers: ["A form is submitted"], failed: 0, def: SIMPLE },
    { id: "aut_intake2", name: "Conflict check", kind: "space", owner: "usr_omar", group: "agr_intake", status: "on", version: 2, triggers: ["A record changes"], failed: 0, def: SIMPLE },
    { id: "aut_intake3", name: "Welcome email", kind: "space", owner: "usr_omar", group: "agr_intake", status: "on", version: 1, triggers: ["A record changes"], failed: 0, def: SIMPLE },
    { id: "aut_intake4", name: "Engagement letter", kind: "space", owner: "usr_omar", group: "agr_intake", status: "on", version: 2, triggers: ["A record changes"], failed: 0, def: SIMPLE },
    { id: "aut_loose", name: "Weekly backup check", kind: "space", owner: "usr_omar", status: "on", version: 1, triggers: ["Every Sunday 3:00"], failed: 0, def: SIMPLE },
  ],
  journeys: [
    { id: "jrn_onboard", name: "Client onboarding", subjectType: "lead", recordType: "rt_onboarding", version: 3, stages: 5, inFlight: 4, updatedAt: at(3) },
    { id: "jrn_matter", name: "Matter intake", subjectType: "person", recordType: "rt_matter", version: 2, stages: 4, inFlight: 7, updatedAt: at(9) },
  ],
  reasons: { aut_lead: "Needs the Twilio key", aut_invoice: "Waiting for Maya to approve", aut_flag: "Personal, 1 run failed" },
};

export const harbor: SampleSpace = {
  id: "harbor", name: "Harbor Studio", me: { id: "usr_june", name: "June Okafor" },
  names: { usr_june: "June Okafor", usr_ines: "Ines Costa", agt_assistant: "Assistant", agt_scheduler: "Scheduler", key_claude: "Your Claude sign-in" },
  keys: [{ id: "key_claude", name: "Your Claude sign-in", kind: "subscription" }],
  groups: [{ id: "agr_studio", name: "Studio", count: 2, order: 0 }],
  specs: [
    { id: "aut_h1", name: "Brief to project", kind: "space", owner: "usr_ines", group: "agr_studio", status: "on", version: 2, triggers: ["A form is submitted"], failed: 0, def: SIMPLE },
    { id: "aut_h2", name: "Friday wrap-up", kind: "space", owner: "usr_ines", group: "agr_studio", status: "on", version: 1, triggers: ["Every Friday 16:00"], failed: 0, def: SIMPLE },
    { id: "aut_h3", name: "My reading list", kind: "personal", owner: "usr_june", status: "on", version: 1, triggers: ["Every day 7:30"], failed: 0, def: SIMPLE },
  ],
  journeys: [{ id: "jrn_h", name: "Client project", subjectType: "client", recordType: "rt_project", version: 1, stages: 4, inFlight: 2, updatedAt: at(5) }],
  reasons: {},
};

export interface SampleAutomations {
  data: AutomationsData;
  replica: FakeReplica;
  space: SampleSpace;
  calls: { cap: string; input: unknown }[];
  opened: string[];
  shared: ReadonlySet<string>;
  failNext(cap: string): void;
}

const rowOf = (s: Spec, space: SampleSpace): Row => ({
  id: s.id, name: s.name, kind: s.kind, ownerId: s.owner, status: s.status, version: s.version, triggers: s.triggers, updatedAt: at(1), failedRuns: s.failed,
  ...(s.group ? { groupId: s.group } : {}), ...(s.last ? { lastRun: s.last } : {}), ...(s.status === "paused" && space.reasons[s.id] ? { pausedReason: space.reasons[s.id] } : {}), definition: s.def ?? SIMPLE, createdAt: at(30), followers: [],
  alerts: { who: [{ kind: "person", id: space.me.id }], when: { mode: "every" }, where: { needsYou: true, dm: false }, escalation: [] },
});

/** The server's check of a definition against the live catalogue: here, a Twilio step with no connection. */
function serverIssues(def: Definition): Issue[] {
  const out: Issue[] = [];
  for (const node of def.nodes) if (node.key === "send_sms") out.push({ nodeId: node.id, severity: "warning", message: "Needs the Twilio key" });
  return out;
}

export function createSampleAutomations(space: SampleSpace = northwind): SampleAutomations {
  const replica = createFakeReplica(space.id);
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const failing = new Set<string>();
  replica.put("automations", space.specs.map((s) => rowOf(s, space)));
  replica.put("groups", space.groups.map((g) => ({ ...g })));
  replica.put("journeys", space.journeys.map((j) => ({ ...j })));
  replica.put("runs", [
    { id: "run_a", automationId: "aut_lead", status: "failed", summary: "Text the lead failed: no Twilio key", startedAt: at(0, 40), definitionVersion: 5 },
    { id: "run_b", automationId: "aut_lead", status: "succeeded", summary: "Lead from Meta: Marcus Pruitt", startedAt: at(1, 20), definitionVersion: 5 },
    { id: "run_c", automationId: "aut_lead", status: "succeeded", summary: "Lead from the intake form: Dana Whitfield", startedAt: at(2, 5), definitionVersion: 4 },
  ]);
  replica.put("versions", [
    { id: "ver_5", automationId: "aut_lead", versionId: "ver_5", n: 5, by: "usr_maya", at: at(3, 100), reason: "Added the text branch for leads with a mobile number" },
    { id: "ver_4", automationId: "aut_lead", versionId: "ver_4", n: 4, by: "usr_maya", at: at(6, 320), reason: "Intake now writes the reply, Omar reviews it" },
    { id: "ver_3", automationId: "aut_lead", versionId: "ver_3", n: 3, by: space.me.id, at: at(8, 55), reason: "Waits up to 2 days for a reply, then asks Lena to call" },
  ]);

  const autos = (): Row[] => replica.rows("automations");
  const sharedIds = new Set(space.specs.filter((s) => s.shared).map((s) => s.id));
  const asList = (r: Row): AutoRow => {
    const { id, name, kind, groupId, ownerId, status, version, triggers, updatedAt, lastRun, failedRuns } = r as unknown as AutoRow & { failedRuns: number };
    return { id, name, kind, ...(groupId ? { groupId } : {}), ownerId, status, version, triggers, updatedAt, ...(lastRun ? { lastRun } : {}), failedRuns };
  };

  replica.resolve("automations.list", () => ({ automations: autos().map(asList), total: autos().length }) as CapMap["automations.list"]["out"]);
  // a Group's count is the Automations in it, so a move or a delete shows at once
  replica.resolve("automations.groups.list", () => ({ groups: (replica.rows("groups") as unknown as GroupRow[]).map((g) => ({ ...g, count: autos().filter((a) => a["groupId"] === g.id).length })) }) as CapMap["automations.groups.list"]["out"]);
  replica.resolve("journeys.list", () => ({ journeys: replica.rows("journeys") as unknown as JourneyRow[], total: replica.rows("journeys").length }) as CapMap["journeys.list"]["out"]);
  replica.resolve("automations.get", (_t, input) => {
    const r = autos().find((x) => x.id === input.automationId);
    // a deleted Automation reads as absent; the canvas then says it is not available
    return { automation: r as unknown as Automation };
  });
  replica.resolve("runs.list", (_t, input) => {
    const id = input.subject?.id;
    const rows = (replica.rows("runs") as unknown as Row[]).filter((r) => (id ? r["automationId"] === id : true) && (input.statuses ? (input.statuses as string[]).includes(String(r["status"])) : true));
    return {
      runs: rows.map((r) => ({ id: r.id, kind: "automation", owner: space.me.id, startedBy: space.me.id, status: r["status"], costMicros: 0, startedAt: r["startedAt"], traceId: `trc_${r.id}`, summary: r["summary"], definitionVersion: r["definitionVersion"] })),
      total: rows.length,
    } as unknown as CapMap["runs.list"]["out"];
  });
  replica.resolve("automations.versions", (_t, input) => ({
    versions: (replica.rows("versions") as unknown as Row[]).filter((v) => v["automationId"] === input.automationId).map((v) => ({ versionId: String(v["versionId"]), n: Number(v["n"]), by: String(v["by"]), at: Number(v["at"]), reason: String(v["reason"]) })),
  }) as CapMap["automations.versions"]["out"]);

  const patch = (id: string, p: Record<string, unknown>): Row => {
    const cur = autos().find((x) => x.id === id);
    if (!cur) throw new Error("no such automation");
    const next = { ...cur, ...p, updatedAt: SAMPLE_NOW } as Row;
    replica.put("automations", [next]);
    return next;
  };
  const writes: Record<string, (input: any) => unknown> = {
    "automations.update": (i: { automationId: string; name?: string; definition?: Definition; expectedVersion?: number }) => {
      const cur = autos().find((x) => x.id === i.automationId);
      if (!cur) throw new Error("no such automation");
      if (i.expectedVersion !== undefined && i.expectedVersion !== cur["version"]) throw new Error("Someone else saved a newer version. Reload to see it.");
      const bump = i.definition ? { version: Number(cur["version"]) + 1, definition: i.definition } : {};
      return { automation: patch(i.automationId, { ...(i.name ? { name: i.name } : {}), ...bump }) };
    },
    "automations.validate": (i: { definition: Definition; kind?: "personal" | "space" }) => {
      const issues = [...check(i.definition, i.kind ?? "space"), ...serverIssues(i.definition)];
      return { ok: !issues.some((x) => x.severity === "error"), issues };
    },
    "automations.set_enabled": (i: { automationId: string; enabled: boolean }) => ({ automation: patch(i.automationId, { status: i.enabled ? "on" : "off" }) }),
    "automations.test": () => ({ runId: "run_test" }),
    "automations.create": (i: { name: string; groupId?: string }) => {
      const id = `aut_new${autos().length + 1}`;
      const row = rowOf({ id, name: i.name, kind: "personal", owner: space.me.id, ...(i.groupId ? { group: i.groupId } : {}), status: "draft", version: 1, triggers: [], failed: 0, def: { triggers: [], nodes: [] } }, space);
      replica.put("automations", [row]);
      return { automation: row };
    },
    "automations.move": (i: { automationId: string; groupId?: string }) => {
      const cur = autos().find((x) => x.id === i.automationId);
      if (!cur) throw new Error("no such automation");
      const next = { ...cur } as Record<string, unknown>;
      if (i.groupId) next["groupId"] = i.groupId; else delete next["groupId"];
      replica.put("automations", [next as Row]);
      return { ok: true };
    },
    "automations.delete": (i: { automationId: string }) => { replica.remove("automations", [i.automationId]); return { ok: true }; },
    "automations.groups.create": (i: { name: string }) => { const id = `agr_new${replica.rows("groups").length + 1}`; replica.put("groups", [{ id, name: i.name, count: 0, order: replica.rows("groups").length }]); return { group: { id } }; },
    "automations.groups.rename": (i: { groupId: string; name: string }) => { const g = replica.rows("groups").find((x) => x.id === i.groupId); if (g) replica.put("groups", [{ ...g, name: i.name }]); return { ok: true }; },
    "automations.groups.delete": (i: { groupId: string }) => {
      replica.remove("groups", [i.groupId]);
      for (const a of autos()) if (a["groupId"] === i.groupId) { const next = { ...a } as Record<string, unknown>; delete next["groupId"]; replica.put("automations", [next as Row]); }
      return { ok: true };
    },
    "automations.restore_version": () => ({ ok: true }),
    "automations.make_personal_copy": () => ({ ok: true }),
  };

  const base = createScreenHooks(replica, screensById);
  // the generated screen queries read route parameters ("/route/automationId"); the fake hooks only resolve "/state/...", so these three are opened here with the id they were given
  const screens: ScreenHooks = {
    query(screenId, name, state = {}) {
      if (name === "automation") return liveQuery(replica, "automations.get", { automationId: String(state["automationId"] ?? "") }) as LiveQuery<unknown>;
      if (name === "versions") return liveQuery(replica, "automations.versions", { automationId: String(state["automationId"] ?? "") }) as LiveQuery<unknown>;
      if (name === "runs") return liveQuery(replica, "runs.list", { scope: "subject", ...(state["subject"] ? { subject: state["subject"] } : {}), ...(state["statuses"] ? { statuses: state["statuses"] } : {}) } as CapMap["runs.list"]["in"]) as LiveQuery<unknown>;
      return base.query(screenId, name, state);
    },
  };
  const nav: AutomationsNav = {
    openAutomation: (id) => void opened.push(`automation:${id}`), openJourney: (id) => void opened.push(`journey:${id}`), newJourney: () => void opened.push("new-journey"), openFailedRuns: () => void opened.push("failed"),
    openRun: (id) => void opened.push(`run:${id}`), ask: (id) => void opened.push(`ask:${id}`), connect: (s) => void opened.push(`connect:${s}`),
  };
  const data: AutomationsData = {
    screens,
    async call(cap, input) {
      calls.push({ cap, input });
      if (failing.delete(cap)) throw new Error(`${cap} failed`);
      const w = writes[cap];
      if (!w) throw new Error(`no write for ${cap}`);
      return w(input);
    },
    me: space.me,
    name: (id) => space.names[id] ?? id,
    keys: space.keys,
    nav,
    clock: () => ({ now: SAMPLE_NOW }),
  };
  return { data, replica, space, calls, opened, shared: sharedIds, failNext: (cap) => void failing.add(cap) };
}
