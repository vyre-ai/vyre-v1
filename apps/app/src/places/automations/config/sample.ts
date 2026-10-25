// The sample Spaces behind the config pane and Journey designer tests and screenshots: the Automations sample (Northwind, and Harbor Studio) with what these screens add. "New lead follow-up"
// has an alert rule with an escalation chain, followers and access; "My morning briefing" is a Personal Automation with an AI step on a subscription sign-in, so Promote to Space has a key
// to replace; the Journeys come from journeys/sample.ts. The fake replica takes the new resolvers and the writes change its rows, so every control in a mount really works.
import { liveQuery } from "../../../../../../client/src/index.ts";
import type { LiveQuery, Row, ScreenHooks } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { AutomationsData } from "../canvas/data.tsx";
import type { Definition } from "../canvas/model.ts";
import { createSampleAutomations, harbor, northwind, SAMPLE_NOW } from "../sidebar/sample.ts";
import type { SampleAutomations, SampleSpace } from "../sidebar/sample.ts";
import { attachJourneys } from "../journeys/sample.ts";
import type { ConfigDirectory, ConfigExtras, FieldEntry, RecordFields } from "./data.tsx";
import type { Alerts } from "./model.ts";

export { SAMPLE_NOW };

const BRIEF: Definition = {
  triggers: [{ key: "schedule", config: { cron: "Weekdays 07:30" } }],
  start: ["cal"],
  nodes: [
    { id: "cal", key: "records.find", title: "Look up today's calendar", input: { type: "event", where: "today" }, next: ["due"] },
    { id: "due", key: "records.find", title: "Look up what is due and waiting on me", input: { type: "task", where: "assigned to me and due today" }, next: ["brief"] },
    { id: "brief", key: "ai", title: "Write the briefing", input: { prompt: "Four lines. The day's meetings, then what is due, then what is waiting on me." }, ai: { agentId: "agt_assistant", keyId: "key_claude" }, next: ["send"] },
    { id: "send", key: "post_message", title: "Send it to me in chat", input: { channelId: "dm:me", text: "{{brief.text}}" } },
  ],
};

const TEMPLATE_FIELDS: readonly FieldEntry[] = [
  { name: "Lead", type: "person" }, { name: "Client", type: "rel" }, { name: "Start date", type: "date" }, { name: "Due date", type: "date" },
  { name: "Health", type: "choice" }, { name: "Budget", type: "num" }, { name: "Stage", type: "choice" },
];
/** The fields of each Journey's record type as the prototype draws them: the Projects template's seven, then the type's own. */
export const RECORD_FIELDS: Record<string, RecordFields> = {
  "Client onboarding": { template: "Projects", inherited: TEMPLATE_FIELDS, own: [{ name: "Matter type", type: "choice" }, { name: "Referral source", type: "choice" }, { name: "Engagement signed", type: "date" }, { name: "ID verified", type: "check" }] },
  "Matter intake": { template: "Projects", inherited: TEMPLATE_FIELDS, own: [{ name: "Practice area", type: "choice" }, { name: "Opposing party", type: "text" }] },
  rt_project: { template: "Projects", inherited: TEMPLATE_FIELDS, own: [{ name: "Shoot date", type: "date" }, { name: "Deliverables", type: "num" }] },
};

export const DIRECTORY: Record<SampleSpace["id"], ConfigDirectory> = {
  northwind: {
    people: [{ id: "usr_irfad", name: "Irfad Imtiaz" }, { id: "usr_maya", name: "Maya Chen" }, { id: "usr_omar", name: "Omar Haddad" }, { id: "usr_lena", name: "Lena Ortiz" }],
    groups: [{ id: "grp_admins", name: "Admins" }, { id: "grp_sales", name: "Sales team" }],
    roles: [{ id: "rol_ops", name: "Ops leads" }, { id: "rol_owner", name: "Owner" }],
    agents: [{ id: "agt_intake", name: "Intake" }, { id: "agt_billing", name: "Billing" }, { id: "agt_assistant", name: "Assistant" }, { id: "agt_research", name: "Research" }, { id: "agt_docs", name: "Docs" }],
    channels: [{ id: "chn_sales", name: "#sales" }, { id: "chn_ops", name: "#ops-alerts" }],
    automations: [{ id: "aut_intake1", name: "Send intake form" }, { id: "aut_intake3", name: "Welcome and handover" }, { id: "aut_lead", name: "New lead follow-up" }, { id: "aut_score", name: "Lead scoring" }],
  },
  harbor: {
    people: [{ id: "usr_june", name: "June Okafor" }, { id: "usr_ines", name: "Ines Costa" }],
    groups: [{ id: "grp_studio", name: "Studio" }],
    roles: [{ id: "rol_lead", name: "Studio leads" }],
    agents: [{ id: "agt_scheduler", name: "Scheduler" }, { id: "agt_assistant", name: "Assistant" }],
    channels: [{ id: "chn_studio", name: "#studio" }],
    automations: [{ id: "aut_h1", name: "Brief to project" }, { id: "aut_h2", name: "Friday wrap-up" }],
  },
};

const EXTRA_NAMES: Record<string, string> = {
  agt_research: "Research", agt_docs: "Docs", agt_automation: "Automation", grp_admins: "Admins", grp_sales: "Sales team", rol_ops: "Ops leads", rol_owner: "Owner", chn_sales: "#sales", chn_ops: "#ops-alerts",
  grp_studio: "Studio", rol_lead: "Studio leads", chn_studio: "#studio", aut_brief: "My morning briefing", aut_intake1: "Send intake form", aut_intake3: "Welcome and handover",
};

export interface ConfigSample extends SampleAutomations {
  extras: ConfigExtras;
}

export function createConfigSample(space: SampleSpace = northwind): ConfigSample {
  const base = createSampleAutomations(space);
  const { replica } = base;
  const me = space.me.id;
  const patchAuto = (id: string, p: Record<string, unknown>): Row => {
    const cur = replica.rows("automations").find((r) => r.id === id);
    if (!cur) throw new Error("no such automation");
    const next = { ...cur, ...p } as Row;
    replica.put("automations", [next]);
    return next;
  };
  const alertsOf = (id: string): Alerts => replica.rows("automations").find((r) => r.id === id)?.["alerts"] as Alerts;

  if (space.id === "northwind") {
    patchAuto("aut_lead", {
      followers: ["usr_maya"],
      alerts: { who: [{ kind: "person", id: "usr_irfad" }, { kind: "person", id: "usr_maya" }], when: { mode: "every" }, where: { needsYou: true, dm: false, channelId: "chn_sales" }, escalation: [{ to: { kind: "role", id: "rol_ops" }, afterHours: 4 }] },
    });
    patchAuto("aut_invoice", { followers: ["usr_omar"], alerts: { who: [{ kind: "person", id: "usr_irfad" }], when: { mode: "after_n", n: 3 }, where: { needsYou: true, dm: true }, escalation: [{ to: { kind: "group", id: "grp_admins" }, afterHours: 2 }] } });
    patchAuto("aut_intake1", { name: "Send intake form" });
    patchAuto("aut_intake3", { name: "Welcome and handover" });
    replica.put("automations", [{
      id: "aut_brief", name: "My morning briefing", kind: "personal", ownerId: me, status: "on", version: 2, triggers: ["Weekdays at 07:30"], updatedAt: SAMPLE_NOW - 3 * 86_400_000, failedRuns: 0,
      definition: BRIEF, createdAt: SAMPLE_NOW - 12 * 86_400_000, followers: [], alerts: { who: [{ kind: "person", id: me }], when: { mode: "every" }, where: { needsYou: true, dm: false }, escalation: [] },
    } as Row]);
  }

  // shares: the owner, direct grants, and what comes through a role
  replica.put("shares", space.id === "northwind" ? [
    { id: "s1", resourceId: "aut_lead", subject: { kind: "person", id: "usr_irfad" }, level: "manage", through: "owner" },
    { id: "s2", resourceId: "aut_lead", subject: { kind: "person", id: "usr_maya" }, level: "edit", through: "direct" },
    { id: "s3", resourceId: "aut_lead", subject: { kind: "person", id: "usr_omar" }, level: "view", through: "direct" },
    { id: "s4", resourceId: "aut_lead", subject: { kind: "agent", id: "agt_intake" }, level: "use", through: "direct" },
    { id: "s5", resourceId: "aut_lead", subject: { kind: "group", id: "grp_admins" }, level: "view", through: "group" },
  ] as Row[] : [{ id: "s1", resourceId: "aut_h1", subject: { kind: "person", id: "usr_ines" }, level: "manage", through: "owner" }] as Row[]);
  replica.put("webhooks", [{ id: "aut_lead", url: "https://northwind.vyre.run/hooks/aut_lead/7f3a91" } as Row]);

  replica.resolve("automations.alerts.get", (_t, input) => ({ alerts: alertsOf(input.automationId) }) as CapMap["automations.alerts.get"]["out"]);
  replica.resolve("access.shares_of", (_t, input) => ({
    shares: replica.rows("shares").filter((s) => s["resourceId"] === input.resource.id).map((s) => ({
      grant: { id: s.id, subject: s["subject"], resource: input.resource, level: s["level"], conditions: {}, by: me, createdAt: SAMPLE_NOW }, through: s["through"],
    })),
  }) as unknown as CapMap["access.shares_of"]["out"]);
  replica.resolve("automations.webhook_url.get", (_t, input) => ({ url: (replica.rows("webhooks").find((w) => w.id === input.automationId)?.["url"] as string | undefined) ?? "https://northwind.vyre.run/hooks/none", method: "POST" }) as CapMap["automations.webhook_url.get"]["out"]);
  replica.resolve("automations.preview_promote", (_t, input): CapMap["automations.preview_promote"]["out"] => {
    if (input.automationId === "aut_brief") {
      return {
        ready: false,
        diff: {
          grants: [{ resource: "Calendar events", level: "view", via: "owner_access" }, { resource: "Tasks", level: "view", via: "owner_access" }, { resource: "Calendar events", level: "view", via: "new_grant" }, { resource: "Tasks", level: "view", via: "new_grant" }],
          vaultNames: ["#Google_Calendar"], connections: ["Google Calendar"],
          keysToReplace: [{ stepId: "brief", keyId: "key_claude", reason: "Your Claude sign-in is a subscription. It stays yours and cannot be shared." }],
        },
      };
    }
    return { ready: true, diff: { grants: [{ resource: "Records", level: "edit", via: "new_grant" }], vaultNames: [], connections: [], keysToReplace: [] } };
  });

  let rotations = 0;
  const writes: Record<string, (input: never) => unknown> = {
    "automations.alerts.set": (i: { automationId: string; alerts: Alerts }) => { patchAuto(i.automationId, { alerts: i.alerts }); return { alerts: i.alerts }; },
    "automations.followers.add": (i: { automationId: string; follower: string }) => {
      const cur = ((replica.rows("automations").find((r) => r.id === i.automationId)?.["followers"] ?? []) as string[]);
      const next = cur.includes(i.follower) ? cur : [...cur, i.follower];
      patchAuto(i.automationId, { followers: next });
      return { followers: next };
    },
    "automations.followers.remove": (i: { automationId: string; follower: string }) => {
      const next = ((replica.rows("automations").find((r) => r.id === i.automationId)?.["followers"] ?? []) as string[]).filter((f) => f !== i.follower);
      patchAuto(i.automationId, { followers: next });
      return { followers: next };
    },
    "access.share": (i: { resource: { id: string }; subject: { kind: string; id: string }; level: string }) => {
      const id = `${i.resource.id}:${i.subject.kind}:${i.subject.id}`;
      replica.put("shares", [{ id, resourceId: i.resource.id, subject: i.subject, level: i.level, through: "direct" } as Row]);
      return { ok: true };
    },
    "access.unshare": (i: { resource: { id: string }; subject: { kind: string; id: string } }) => {
      const gone = replica.rows("shares").filter((s) => s["resourceId"] === i.resource.id && (s["subject"] as { kind: string; id: string }).id === i.subject.id && s["through"] === "direct").map((s) => s.id);
      replica.remove("shares", gone);
      return { ok: true };
    },
    "automations.promote": (i: { automationId: string; confirm: boolean; ownerId?: string; replaceKeys?: { stepId: string; keyId: string }[] }) => {
      const preview = replica.run("automations.preview_promote", { automationId: i.automationId })!.data;
      for (const k of preview.diff.keysToReplace) {
        const pick = i.replaceKeys?.find((x) => x.stepId === k.stepId);
        if (!pick) throw new Error("Choose a shared API key for every AI step first");
        if (base.data.keys.find((x) => x.id === pick.keyId)?.kind !== "api") throw new Error("A subscription sign-in cannot be shared. Choose an API key.");
      }
      const cur = replica.rows("automations").find((r) => r.id === i.automationId);
      const def = cur?.["definition"] as Definition;
      const nodes = def.nodes.map((n) => { const pick = i.replaceKeys?.find((x) => x.stepId === n.id); return pick && n.ai ? { ...n, ai: { ...n.ai, keyId: pick.keyId } } : n; });
      return { automation: patchAuto(i.automationId, { kind: "space", ownerId: i.ownerId ?? me, version: Number(cur?.["version"] ?? 1) + 1, definition: { ...def, nodes } }), diff: preview.diff };
    },
    "automations.make_personal_copy": (i: { automationId: string; name?: string; idempotencyKey: string }) => {
      const cur = replica.rows("automations").find((r) => r.id === i.automationId)!;
      const row = { ...cur, id: `${i.automationId}_mine`, name: i.name ?? `${String(cur["name"])} (mine)`, kind: "personal", ownerId: me, status: "draft", version: 1, followers: [] } as Row;
      replica.put("automations", [row]);
      return { automation: row };
    },
    "automations.update": (i: { automationId: string; definition?: Definition; name?: string; expectedVersion?: number }) => {
      const cur = replica.rows("automations").find((r) => r.id === i.automationId)!;
      if (i.expectedVersion !== undefined && i.expectedVersion !== cur["version"]) throw new Error("Someone else changed this Automation. Reload it.");
      return { automation: patchAuto(i.automationId, { ...(i.definition ? { definition: i.definition } : {}), ...(i.name ? { name: i.name } : {}), version: Number(cur["version"]) + 1 }) };
    },
    "automations.webhook_url.rotate": (i: { automationId: string }) => {
      rotations += 1;
      const url = `https://northwind.vyre.run/hooks/${i.automationId}/${(0x7f3a91 + rotations * 4099).toString(16)}`;
      replica.put("webhooks", [{ id: i.automationId, url } as Row]);
      return { url };
    },
    "automations.retry": (i: { automationId: string; runId: string }) => ({ runId: `${i.runId}_again` }),
  };
  const journeyWrites = attachJourneys(replica, space.id, me).writes;

  const names: Record<string, string> = { ...space.names, ...EXTRA_NAMES };
  const screens: ScreenHooks = {
    query(screenId, name, state = {}) {
      if (screenId === "journeys.designer") {
        const journeyId = String(state["journeyId"] ?? "");
        if (name === "journey") return liveQuery(replica, "journeys.get", { journeyId }) as LiveQuery<unknown>;
        if (name === "counts") return liveQuery(replica, "journeys.stage_counts", { journeyId }) as LiveQuery<unknown>;
        if (name === "versions") return liveQuery(replica, "journeys.versions", { journeyId }) as LiveQuery<unknown>;
      }
      return base.data.screens.query(screenId, name, state);
    },
  };
  const data: AutomationsData = {
    ...base.data,
    screens,
    name: (id) => names[id] ?? base.data.name(id),
    async call(cap, input) {
      const w = writes[cap] ?? journeyWrites[cap];
      if (w) {
        base.calls.push({ cap, input });
        return w(input as never);
      }
      // a read the replica can answer (access.shares_of, the promote preview, the webhook address) is answered from its rows
      const read = replica.run(cap as keyof CapMap, input as never);
      if (read) return read.data;
      return base.data.call(cap, input);
    },
  };
  const extras: ConfigExtras = {
    directory: DIRECTORY[space.id],
    recordFields: (recordType) => RECORD_FIELDS[recordType] ?? { template: "Projects", inherited: TEMPLATE_FIELDS, own: [] },
    openFiles: (p) => void base.opened.push(`files:${p}`),
    openRuns: (id) => void base.opened.push(`runs:${id}`),
    openRecords: (t, stage) => void base.opened.push(`records:${t}${stage ? `:${stage}` : ""}`),
    openAutomation: (id) => void base.opened.push(`automation:${id}`),
  };
  return { ...base, data, extras };
}

export { harbor, northwind };
