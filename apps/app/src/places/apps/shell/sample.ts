// The sample behind the Apps place tests and screenshots: Northwind's sites, forms, campaigns, templates and sending domains (from the prototype), answered by a fake replica through the live screen
// queries (apps.sites, apps.forms, apps.campaigns, apps.templates). Every write the place makes changes the rows, so each menu really works; launching a campaign and publishing a form are held for a yes
// when `gate` is set, the way Gate parks them. The values are made up.
import { createFakeReplica, createScreenHooks } from "../../../../../../client/src/index.ts";
import type { Row } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { AppsData } from "./data.tsx";
import type { CampaignRow, DomainRow, FormRow, SiteRow, TemplateRow } from "./model.ts";

export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);

const SITES: SiteRow[] = [
  { siteId: "st_book", name: "Booking widget", kind: "app", owner: "usr_maya", stagingUrl: "https://book-staging.northwind.example", productionUrl: "https://book.northwind.example", state: "ready" },
  { siteId: "st_north", name: "Northwind site", kind: "site", owner: "usr_irfad", stagingUrl: "https://staging.northwind.example", state: "ready" },
];
const FORMS: FormRow[] = [
  { formId: "fm_intake", name: "Client intake form", recordType: "clients", kind: "public", state: "published", slug: "intake", submissions: 14 },
  { formId: "fm_consult", name: "Consult booking", recordType: "clients", kind: "booking", state: "draft", slug: "consult", submissions: 0 },
  { formId: "fm_survey", name: "After the consult", recordType: "clients", kind: "survey", state: "published", slug: "after", submissions: 6 },
];
const CAMPAIGNS: CampaignRow[] = [
  { campaignId: "cp_fall", name: "Fall check-in", kind: "sequence", state: "draft", owner: "usr_maya", audienceCount: 212, sent: 0, replies: 0 },
  { campaignId: "cp_news", name: "October newsletter", kind: "one_time", state: "running", owner: "usr_maya", audienceCount: 1240, sent: 860, replies: 12 },
  { campaignId: "cp_win", name: "Win-back", kind: "triggered", state: "paused", owner: "usr_omar", audienceCount: 90, sent: 40, replies: 2 },
];
const TEMPLATES: TemplateRow[] = [
  { templateId: "tp_intake", title: "Law firm intake", kind: "journey", summary: "Intake, conflict check and engagement letter", version: "1.2", adds: ["Journey", "3 automations", "Form"] },
  { templateId: "tp_site", title: "Consult landing page", kind: "site", summary: "One page with a booking form", version: "1.0", adds: ["Site"] },
];
const DOMAINS: DomainRow[] = [
  { id: "dm_main", name: "updates.northwind.example", provider: "resend", spf: "pass", dkim: "pass", dmarc: "pass", verified: true, isDefault: true, checkedAt: SAMPLE_NOW - 3_600_000 },
  { id: "dm_new", name: "mail.northwind.example", provider: "mailgun", spf: "pass", dkim: "pending", dmarc: "pending", verified: false, isDefault: false },
];

export interface SampleApps {
  data: AppsData;
  calls: { cap: string; input: unknown }[];
  /** what the nav was asked to open or make */
  went: string[];
  failNext(cap: string, message?: string): void;
}

export function createSampleApps(o: { team?: boolean; gate?: boolean; deferred?: readonly string[] } = {}): SampleApps {
  const replica = createFakeReplica("northwind");
  const put = (table: string, rows: readonly object[], id: (r: never) => string): void => replica.put(table, rows.map((r) => ({ ...r, id: id(r as never) }) as unknown as Row));
  put("sites", SITES, (r: SiteRow) => r.siteId); put("forms", FORMS, (r: FormRow) => r.formId); put("campaigns", CAMPAIGNS, (r: CampaignRow) => r.campaignId); put("templates", TEMPLATES, (r: TemplateRow) => r.templateId);
  const strip = <T,>(rows: Row[]): T[] => rows.map(({ id: _id, ...rest }) => rest as unknown as T);
  const row = (table: string, id: string): Row => { const r = replica.rows(table).find((x) => x.id === id); if (!r) throw new Error("Not found"); return r; };
  replica.resolve("sites.list", () => ({ sites: strip<SiteRow>(replica.rows("sites")) }) as CapMap["sites.list"]["out"]);
  replica.resolve("forms.list", () => ({ forms: strip<FormRow>(replica.rows("forms")) }) as CapMap["forms.list"]["out"]);
  replica.resolve("campaigns.list", () => ({ campaigns: strip<CampaignRow>(replica.rows("campaigns")) }) as CapMap["campaigns.list"]["out"]);
  replica.resolve("templates.list", () => ({ templates: strip<TemplateRow>(replica.rows("templates")) }) as CapMap["templates.list"]["out"]);
  replica.resolve("forms.get", (_t, input) => ({ form: strip<FormRow>([row("forms", input.formId)])[0]!, fields: [{ field: "name", mode: "ask" }, { field: "email", mode: "ask" }], theme: { skin: "paper" } }) as CapMap["forms.get"]["out"]);
  replica.resolve("campaigns.get", (_t, input) => ({ campaign: strip<CampaignRow>([row("campaigns", input.campaignId)])[0]!, steps: [{ key: "email-1", type: "email", config: { subject: "Checking in" } }, { key: "wait-1", type: "wait", config: { days: 2 } }], audienceViewId: "vw_active" }) as CapMap["campaigns.get"]["out"]);
  replica.resolve("campaigns.preview", (_t, input) => { const campaign = strip<CampaignRow>([row("campaigns", input.campaignId)])[0]!; return { sample: { subject: campaign.name, body: "A preview of the first message." }, counts: { audience: campaign.audienceCount, excluded: 3, suppressed: 2 } } as CapMap["campaigns.preview"]["out"]; });
  replica.resolve("templates.preview", (_t, input) => { const template = strip<TemplateRow>([row("templates", input.templateId)])[0]!; return { template, record_types: ["clients"], domains: ["api.example.com"], vaultNames: ["MAIL_API_KEY"] } as CapMap["templates.preview"]["out"]; });
  const calls: SampleApps["calls"] = [];
  const went: string[] = [];
  const failing = new Map<string, string>();
  let domains = [...DOMAINS];
  const set = (table: string, id: string, patch: object): void => replica.put(table, [{ ...row(table, id), ...patch } as unknown as Row]);
  const held = (): { status: "held"; taskId: string; runId: string } => ({ status: "held", taskId: "tsk_gate1", runId: "run_gate1" });
  const writes: Record<string, (i: Record<string, unknown>) => unknown> = {
    "forms.get": (i) => ({ form: strip<FormRow>([row("forms", String(i["formId"]))])[0]!, fields: [{ field: "name", mode: "ask" }, { field: "email", mode: "ask" }], theme: { skin: "paper" } }),
    "forms.create": (i) => {
      const form = { formId: `fm_new${replica.rows("forms").length + 1}`, name: String(i["name"]), recordType: String(i["recordType"]), kind: i["kind"], state: "draft", slug: String(i["name"]).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), submissions: 0 };
      replica.put("forms", [{ ...form, id: form.formId } as unknown as Row]);
      return { form };
    },
    "forms.publish": (i) => { if (o.gate) return held(); set("forms", String(i["formId"]), { state: "published" }); return { url: "https://forms.northwind.example/f", embed: "<iframe>" }; },
    "forms.unpublish": (i) => { set("forms", String(i["formId"]), { state: "closed" }); return { ok: true }; },
    "campaigns.launch": (i) => { if (o.gate) return held(); set("campaigns", String(i["campaignId"]), { state: "running" }); return { runId: "run_1" }; },
    "campaigns.get": (i) => ({ campaign: strip<CampaignRow>([row("campaigns", String(i["campaignId"]))])[0]!, steps: [{ key: "email-1", type: "email", config: { subject: "Checking in" } }, { key: "wait-1", type: "wait", config: { days: 2 } }], audienceViewId: "vw_active" }),
    "campaigns.preview": (i) => { const campaign = strip<CampaignRow>([row("campaigns", String(i["campaignId"]))])[0]!; return { sample: { subject: campaign.name, body: "A preview of the first message." }, counts: { audience: campaign.audienceCount, excluded: 3, suppressed: 2 } }; },
    "campaigns.create": (i) => {
      const campaign = { campaignId: `cmp_new${replica.rows("campaigns").length + 1}`, name: String(i["name"]), kind: i["kind"], state: "draft", owner: "usr_irfad", audienceCount: 0, sent: 0, replies: 0 };
      replica.put("campaigns", [{ ...campaign, id: campaign.campaignId } as unknown as Row]);
      return { campaign };
    },
    "campaigns.pause": (i) => { set("campaigns", String(i["campaignId"]), { state: "paused" }); return { ok: true }; },
    "campaigns.resume": (i) => { set("campaigns", String(i["campaignId"]), { state: "running" }); return { ok: true }; },
    "campaigns.stop": (i) => { set("campaigns", String(i["campaignId"]), { state: "stopped" }); return { ok: true }; },
    "templates.preview": (i) => ({ template: strip<TemplateRow>([row("templates", String(i["templateId"]))])[0]!, record_types: ["clients"], domains: ["api.example.com"], vaultNames: ["MAIL_API_KEY"] }),
    "templates.install": (i) => ({ installed: [{ kind: "journey", id: `jr_${String(i["templateId"])}` }, { kind: "form", id: "fm_new" }] }),
    "mail.domain.list": () => ({ domains }),
    "mail.domain.get": (i) => ({ domain: domains.find((d) => d.id === i["domainId"]), records: [{ type: "TXT", name: "resend._domainkey", value: "p=fake", status: "pass" }] }),
    "mail.domain.check": (i) => { domains = domains.map((d) => (d.id === i["domainId"] ? { ...d, dkim: "pass" as const, dmarc: "pass" as const, verified: true, checkedAt: SAMPLE_NOW } : d)); return { domain: domains.find((d) => d.id === i["domainId"]), records: [] }; },
    "mail.domain.add": (i) => {
      const domain = { id: `dm_new${domains.length + 1}`, name: String(i["name"]), provider: i["provider"] as "resend" | "mailgun", spf: "pending" as const, dkim: "pending" as const, dmarc: "pending" as const, verified: false, isDefault: false };
      domains = [...domains, domain];
      return { domain, records: [] };
    },
    "kits.builder_open": () => ({ threadId: "thr_kit1" }),
  };
  const data: AppsData = {
    screens: createScreenHooks(replica, screensById),
    async call(cap, input) {
      calls.push({ cap, input });
      const why = failing.get(cap);
      if (why !== undefined) { failing.delete(cap); throw new Error(why); }
      const w = writes[cap];
      if (!w) throw new Error(`no handler for ${cap}`);
      return w(input as Record<string, unknown>);
    },
    clock: () => ({ now: SAMPLE_NOW }),
    team: o.team !== false,
    deferred: o.deferred ?? ["sites"],
    nav: {
      open: (g, id) => void went.push(`open:${g}:${id}`), create: (g, k) => void went.push(`create:${g}${k ? `:${k}` : ""}`), joinTeam: () => void went.push("join"),
      show: (g) => void went.push(`show:${g}`),
      openTask: (id) => void went.push(`task:${id}`), openThread: (id) => void went.push(`thread:${id}`),
    },
  };
  return { data, calls, went, failNext: (cap, message = `${cap} failed`) => void failing.set(cap, message) };
}
