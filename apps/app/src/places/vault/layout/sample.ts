// The sample Spaces behind the Vault tests and screenshots: Northwind (the default Space) and Harbor Studio, filled from the prototype's Vault so a side by side reads the same.
// A fake replica holds the rows; each capability the place reads is registered with a resolver over those rows, and the writes it makes (reveal, update, put, move, rotate, delete,
// restore, generate, new folder) change the rows, so every control in a mount really works. The values below are made up; the real replica never holds a value, only the
// vault service does, and only vault.item.reveal returns one.
import { createFakeReplica, createScreenHooks } from "../../../../../../client/src/index.ts";
import type { FakeReplica, LiveQuery, QueryState, Row } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { Connection, Principal, VaultData, VaultNav } from "./data.tsx";
import type { Folder, Item, Provider, Share } from "./model.ts";
import { DAY_MS, HOUR_MS, MIN_MS } from "./model.ts";

/** Friday 24 October 2025, 10:00 UTC, so every machine prints the same "Used 14 min ago". */
export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);

type FieldSpec = [key: string, value: string, secret: boolean];
interface ItemSpec {
  id: string; name: string; kind: Item["kind"]; folder: string; scope: Item["scope"]; fields: FieldSpec[]; handle?: string; usedAgo?: number; level?: Item["yourLevel"];
  rotateEvery?: number; rotatedAgoDays?: number; spaceOnly?: boolean;
}
interface HistorySpec { item: string; actor: { kind: "person" | "agent" | "actor" | "service"; id: string }; onBehalfOf?: { kind: "person" | "agent" | "actor" | "service"; id: string }; action: string; field?: string; ago: number }
interface ProviderSpec { id: string; key: string; name: string; connection: Provider["connection"]; via: string; scope: Provider["scope"]; item: string; agents: string[]; tokens: number; cents: number; engine: string }

export interface SampleSpace {
  id: "northwind" | "harbor";
  name: string;
  me: Principal;
  principals: Principal[];
  folders: Folder[];
  items: ItemSpec[];
  history: HistorySpec[];
  providers: ProviderSpec[];
  requests: { id: string; name: string; forAutomation: string; agoMin: number }[];
  /** Who holds each item besides you: [kind, id, level]. */
  grants?: Record<string, [kind: Share["subject"]["kind"], id: string, level: Share["level"]][]>;
}

const people: Principal[] = [
  { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }, { id: "usr_maya", name: "Maya Chen", kind: "person" }, { id: "usr_omar", name: "Omar Haddad", kind: "person" },
  { id: "agt_intake", name: "Intake", kind: "agent" }, { id: "agt_research", name: "Research", kind: "agent" }, { id: "agt_billing", name: "Billing", kind: "agent" },
  { id: "aut_weekly", name: "Weekly lead report", kind: "automation" }, { id: "agt_assistant", name: "Assistant", kind: "agent" },
];
const harborPeople: Principal[] = [
  { id: "usr_nora", name: "Nora Quill", kind: "person" }, { id: "usr_june", name: "June Abel", kind: "person" }, { id: "agt_proofer", name: "Proofer", kind: "agent" },
];

const fld = (id: string, name: string, scope: Folder["scope"], count: number, level: Folder["yourLevel"] = "manage", owner = "usr_irfad"): Folder => ({ id, name, scope, owner, itemCount: count, whoCanExport: [], yourLevel: level });
const m = (n: number): number => n * MIN_MS;
const h = (n: number): number => n * HOUR_MS;

export const northwind: SampleSpace = {
  id: "northwind", name: "Northwind", me: people[0]!, principals: people,
  folders: [fld("fld_marketing", "Marketing", "shared", 3), fld("fld_finance", "Finance", "shared", 4), fld("fld_ops", "Operations", "shared", 6), fld("fld_mine", "Mine", "mine", 3)],
  items: [
    { id: "vit_ghl", name: "GoHighLevel", kind: "api_key", folder: "fld_marketing", scope: "shared", handle: "#Northwind_GHL", usedAgo: m(14), rotateEvery: 90, rotatedAgoDays: 214, fields: [["GHL_PIT", "pit-7c1e4a2b-90d1-4b9e-8a52-3e6d1f0aa417", true], ["GHL_LOCATION_ID", "nwLoc7Kq2mXpR4vLnTzB", false]] },
    { id: "vit_forms", name: "Northwind Forms", kind: "login", folder: "fld_marketing", scope: "shared", usedAgo: m(26), fields: [["USERNAME", "intake-bot", false], ["PASSWORD", "Wm4!rT8vQz2#", true]] },
    { id: "vit_stripe", name: "Stripe", kind: "api_key", folder: "fld_finance", scope: "shared", usedAgo: m(28), level: "edit", rotateEvery: 180, rotatedAgoDays: 203, fields: [["STRIPE_SECRET_KEY", "sk_live_51NwFakeFakeFakeFakeFake00aa", true], ["STRIPE_PUBLISHABLE_KEY", "pk_live_51NwFakeFakeFakeFake11bb", false]] }, // secret-scan: fake
    { id: "vit_claude", name: "Claude", kind: "ai_subscription", folder: "fld_mine", scope: "mine", usedAgo: m(42), fields: [["CLAUDE_SETUP_TOKEN", "sk-ant-oat01-fake-fake-fake-fake-fake", true]] }, // secret-scan: fake
    { id: "vit_stripe_wh", name: "Stripe webhooks", kind: "api_key", folder: "fld_finance", scope: "shared", usedAgo: h(2), fields: [["STRIPE_WEBHOOK_SECRET", "whsec_fakefakefakefakefakefake", true], ["ENDPOINT_URL", "https://hooks.northwind.example/stripe", false]] },
    { id: "vit_gws", name: "Google Workspace", kind: "login", folder: "fld_ops", scope: "shared", usedAgo: h(3), fields: [["USERNAME", "ops@northwind.example", false], ["PASSWORD", "Gx7#pLm29vQe", true]] },
    { id: "vit_gsa", name: "Google service account", kind: "other", folder: "fld_ops", scope: "shared", usedAgo: h(3), fields: [["CLIENT_EMAIL", "bot@northwind-prod.iam.example", false], ["PROJECT_ID", "northwind-prod", false], ["PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----fake", true]] }, // secret-scan: fake
    { id: "vit_rivera", name: "Rivera client portal", kind: "api_key", folder: "fld_ops", scope: "shared", usedAgo: h(3), level: "use", fields: [["PORTAL_PIN", "482913", true], ["ACCOUNT_NUMBER", "RV-20931", true]] },
    { id: "vit_opencode", name: "OpenCode Go key", kind: "api_key", folder: "fld_mine", scope: "mine", usedAgo: h(6), fields: [["OPENCODE_API_KEY", "oc-fake-fake-fake-fake-fake-fake-12", true]] },
    { id: "vit_pg", name: "Postgres · Northwind prod", kind: "env", folder: "fld_ops", scope: "shared", usedAgo: h(6), fields: [["DATABASE_URL", "postgres://app:s3cretPw@db.northwind.example:5432/prod", true]] },
    { id: "vit_twilio", name: "Twilio · Support line", kind: "api_key", folder: "fld_ops", scope: "shared", usedAgo: h(15), fields: [["TWILIO_ACCOUNT_SID", "AC0123456789abcdef0123456789abcdef", false], ["TWILIO_AUTH_TOKEN", "fakefakefakefakefakefakefakefake", true]] },
    { id: "vit_anthropic", name: "OpenAI key", kind: "api_key", folder: "fld_marketing", scope: "shared", usedAgo: h(30), fields: [["OPENAI_API_KEY", "sk-proj-fake-fake-fake-fake", true]] },
    { id: "vit_visa", name: "Northwind Visa", kind: "card", folder: "fld_finance", scope: "shared", usedAgo: h(30), level: "view", fields: [["CARD_NUMBER", "4111111111111111", true], ["EXPIRY", "09/28", false], ["CVV", "123", true]] },
    { id: "vit_github", name: "GitHub", kind: "login", folder: "fld_mine", scope: "mine", usedAgo: h(40), fields: [["USERNAME", "irfad7", false], ["PASSWORD", "Gh9$kLp3xQw8", true]] },
    { id: "vit_resend", name: "Resend", kind: "api_key", folder: "fld_ops", scope: "shared", usedAgo: 5 * DAY_MS, fields: [["RESEND_API_KEY", "re_fakefakefakefakefake", true]] },
    { id: "vit_wifi", name: "Office Wi-Fi", kind: "note", folder: "fld_finance", scope: "shared", usedAgo: 40 * DAY_MS, fields: [["NOTE", "Northwind-Guest / harbor-lights-42", true]] },
  ],
  history: [
    { item: "vit_claude", actor: { kind: "agent", id: "agt_intake" }, action: "used", field: "CLAUDE_SETUP_TOKEN", ago: m(42) },
    { item: "vit_claude", actor: { kind: "agent", id: "agt_intake" }, action: "used", field: "CLAUDE_SETUP_TOKEN", ago: h(3) },
    { item: "vit_claude", actor: { kind: "agent", id: "agt_research" }, action: "used", field: "CLAUDE_SETUP_TOKEN", ago: h(5) },
    { item: "vit_ghl", actor: { kind: "agent", id: "agt_intake" }, action: "used", field: "GHL_PIT", ago: m(14) },
    { item: "vit_ghl", actor: { kind: "agent", id: "agt_research" }, action: "used", field: "GHL_PIT", ago: h(2) },
    { item: "vit_ghl", actor: { kind: "service", id: "aut_weekly" }, onBehalfOf: { kind: "person", id: "usr_irfad" }, action: "used", field: "GHL_PIT", ago: h(26) },
    { item: "vit_ghl", actor: { kind: "person", id: "usr_maya" }, action: "edited", field: "GHL_LOCATION_ID", ago: 3 * DAY_MS },
    { item: "vit_ghl", actor: { kind: "person", id: "usr_irfad" }, action: "revealed", field: "GHL_PIT", ago: 9 * DAY_MS },
    { item: "vit_ghl", actor: { kind: "person", id: "usr_irfad" }, action: "created", ago: 214 * DAY_MS },
    { item: "vit_stripe", actor: { kind: "agent", id: "agt_billing" }, action: "used", field: "STRIPE_SECRET_KEY", ago: m(28) },
    { item: "vit_forms", actor: { kind: "agent", id: "agt_intake" }, action: "used", field: "PASSWORD", ago: m(26) },
  ],
  providers: [
    { id: "prv_claude", key: "claude-code", name: "Claude", connection: "subscription", via: "Sign in with Claude Max", scope: "mine", item: "vit_claude", agents: ["agt_intake", "agt_research"], tokens: 4_200_000, cents: 0, engine: "claude-code" },
    { id: "prv_opencode", key: "opencode-go", name: "OpenCode Go", connection: "api_key", via: "API key", scope: "mine", item: "vit_opencode", agents: ["agt_billing"], tokens: 900_000, cents: 740, engine: "opencode" },
    { id: "prv_anthropic", key: "openai", name: "OpenAI", connection: "api_key", via: "API key #Northwind_OpenAI", scope: "shared", item: "vit_anthropic", agents: ["agt_intake"], tokens: 1_100_000, cents: 1320, engine: "claude-code" },
  ],
  requests: [{ id: "req_twilio", name: "Twilio", forAutomation: "New lead follow-up", agoMin: 120 }],
  grants: {
    vit_ghl: [["person", "usr_maya", "edit"], ["person", "usr_omar", "view"], ["agent", "agt_intake", "use"], ["agent", "agt_research", "use"], ["service", "aut_weekly", "use"]],
    vit_stripe: [["agent", "agt_billing", "use"], ["person", "usr_maya", "edit"]],
  },
};

export const harbor: SampleSpace = {
  id: "harbor", name: "Harbor Studio", me: harborPeople[0]!, principals: harborPeople,
  folders: [fld("fld_studio", "Studio", "shared", 3, "manage", "usr_nora"), fld("fld_mine", "Mine", "mine", 2, "manage", "usr_nora")],
  items: [
    { id: "vit_figma", name: "Figma", kind: "login", folder: "fld_studio", scope: "shared", usedAgo: m(9), fields: [["USERNAME", "studio@harbor.example", false], ["PASSWORD", "Fg2!qWe7Rt5y", true]] },
    { id: "vit_shopify", name: "Shopify", kind: "api_key", folder: "fld_studio", scope: "shared", usedAgo: h(4), rotateEvery: 365, rotatedAgoDays: 40, fields: [["SHOPIFY_ADMIN_TOKEN", "shpat_fakefakefakefakefakefake", true], ["SHOPIFY_STORE", "harbor-studio.myshopify.example", false]] },
    { id: "vit_mailchimp", name: "Mailchimp", kind: "api_key", folder: "fld_studio", scope: "shared", usedAgo: 2 * DAY_MS, fields: [["MAILCHIMP_API_KEY", "fakefakefakefakefakefake-us21", true]] },
    { id: "vit_claude_h", name: "Claude", kind: "ai_subscription", folder: "fld_mine", scope: "mine", usedAgo: m(31), fields: [["CLAUDE_SETUP_TOKEN", "sk-ant-oat01-fake-harbor", true]] },
    { id: "vit_bank", name: "Harbor Visa", kind: "card", folder: "fld_mine", scope: "mine", usedAgo: 6 * DAY_MS, fields: [["CARD_NUMBER", "5555555555554444", true], ["EXPIRY", "02/27", false], ["CVV", "456", true]] },
  ],
  history: [
    { item: "vit_figma", actor: { kind: "person", id: "usr_june" }, action: "used", field: "PASSWORD", ago: m(9) },
    { item: "vit_figma", actor: { kind: "person", id: "usr_nora" }, action: "created", ago: 30 * DAY_MS },
  ],
  providers: [{ id: "prv_claude_h", key: "claude-code", name: "Claude", connection: "subscription", via: "Sign in with Claude Pro", scope: "mine", item: "vit_claude_h", agents: ["agt_proofer"], tokens: 800_000, cents: 0, engine: "claude-code" }],
  requests: [],
};

type ItemRow = Item & Row;
type FieldRow = Row & { itemId: string; key: string; secret: boolean; value: string; order: number };
type HistRow = Row & { itemId: string; at: number; actor: HistorySpec["actor"]; onBehalfOf?: HistorySpec["onBehalfOf"]; action: string; field?: string };

export function liveRows<T>(replica: FakeReplica, table: string, map: (rows: Row[]) => T): LiveQuery<T> {
  let at = -1, snap: QueryState<T> = { status: "loading" };
  return {
    subscribe: (l) => replica.subscribe(l),
    getSnapshot() {
      if (replica.version() === at) return snap;
      at = replica.version();
      snap = { status: "ready", data: map(replica.rows(table)) };
      return snap;
    },
  };
}

export interface SampleVault {
  data: VaultData;
  replica: FakeReplica;
  /** every capability the place called, in order, with its input */
  calls: { cap: string; input: unknown }[];
  /** what the nav handlers were asked to open */
  opened: string[];
  /** text the place put on the clipboard */
  copied: string[];
  setOnline(online: boolean): void;
  failNext(cap: string, message?: string): void;
}

const ISSUE_AGE = (days: number): number => SAMPLE_NOW - days * DAY_MS;

export function createSampleVault(space: SampleSpace = northwind, o: { online?: boolean; extraItems?: number } = {}): SampleVault {
  const replica = createFakeReplica(space.id);
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const copied: string[] = [];
  const failing = new Map<string, string>();
  let online = o.online ?? true;
  const listeners = new Set<() => void>();
  let seq = 100;

  const meta = (s: ItemSpec): ItemRow => ({
    id: s.id, name: s.name, kind: s.kind, folderId: s.folder, owner: space.me.id, scope: s.scope, fieldKeys: s.fields.map((f) => f[0]), handle: s.handle ?? `#${space.name.split(" ")[0]}_${s.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    spaceOnly: s.spaceOnly ?? false, injectIntoDeployments: false,
    ...(s.rotateEvery ? { rotateEveryDays: s.rotateEvery, lastRotatedAt: ISSUE_AGE(s.rotatedAgoDays ?? 0) } : {}),
    ...(s.usedAgo !== undefined ? { lastUsedAt: SAMPLE_NOW - s.usedAgo } : {}),
    yourLevel: s.level ?? "manage", label: 0, createdAt: ISSUE_AGE(240), updatedAt: SAMPLE_NOW - DAY_MS,
  });
  const putItems = (specs: ItemSpec[]): void => {
    replica.put("items", specs.map(meta));
    replica.put("fields", specs.flatMap((s) => s.fields.map(([key, value, secret], order): FieldRow => ({ id: `${s.id}:${key}`, itemId: s.id, key, secret, value, order }))));
  };
  const extra: ItemSpec[] = Array.from({ length: o.extraItems ?? 0 }, (_, i) => ({
    id: `vit_x${i}`, name: `Sample key ${i + 1}`, kind: "api_key", folder: "fld_ops", scope: "shared", usedAgo: (i + 1) * m(7), fields: [[`SAMPLE_KEY_${i + 1}`, `fake-${i}`, true]],
  }));
  putItems([...space.items, ...extra]);
  replica.put("folders", space.folders.map((f) => ({ ...f }) as Row));
  replica.put("history", space.history.map((e, i): HistRow => ({ id: `h${i}`, itemId: e.item, at: SAMPLE_NOW - e.ago, actor: e.actor, ...(e.onBehalfOf ? { onBehalfOf: e.onBehalfOf } : {}), action: e.action, ...(e.field ? { field: e.field } : {}) })));
  replica.put("providers", space.providers.map((p) => ({
    id: p.id, providerKey: p.key, name: p.name, connection: p.connection, via: p.via, scope: p.scope, itemId: p.item, agentsUsing: p.agents,
    usage: { tokens: p.tokens, costCents: p.cents, periodStart: Date.UTC(2025, 9, 1) }, engine: p.engine, spaceMayUse: p.scope === "shared", state: "ok",
  }) as Row));
  replica.put("requests", space.requests.map((r) => ({ id: r.id, name: r.name, forAutomation: r.forAutomation, at: SAMPLE_NOW - m(r.agoMin) }) as Row));
  replica.put("principals", space.principals.map((p) => ({ ...p })));

  const rows = <T,>(table: string): T[] => replica.rows(table) as unknown as T[];
  const itemRows = (): ItemRow[] => rows<ItemRow>("items").filter((i) => !(i as { trashed?: boolean }).trashed);
  const strip = (r: ItemRow): Item => { const { trashed: _t, ...rest } = r as ItemRow & { trashed?: boolean }; void _t; return rest as Item; };
  const fieldsOf = (itemId: string): FieldRow[] => rows<FieldRow>("fields").filter((f) => f.itemId === itemId).sort((a, b) => a.order - b.order);
  const find = (id: string): ItemRow => { const it = rows<ItemRow>("items").find((i) => i.id === id); if (!it) throw new Error(`no such item ${id}`); return it; };

  replica.resolve("vault.items.list", (_t, input) => {
    let list = itemRows();
    if (input.folder) list = list.filter((i) => i.folderId === input.folder);
    if (input.kind) list = list.filter((i) => i.kind === input.kind);
    if (input.q) list = list.filter((i) => i.name.toLowerCase().includes(input.q!.toLowerCase()));
    const counts: Record<string, number> = {};
    for (const i of list) counts[i.folderId] = (counts[i.folderId] ?? 0) + 1;
    return { items: list.map(strip), counts };
  });
  replica.resolve("vault.folders.list", (_t, input) => {
    const items = itemRows();
    const folders = (rows<Folder & Row>("folders")).filter((f) => !input.scope || f.scope === input.scope);
    return { folders: folders.map((f) => ({ ...f, itemCount: items.filter((i) => i.folderId === f.id).length }) as Folder) };
  });
  replica.resolve("providers.list", () => ({ providers: rows<Provider & Row>("providers") as Provider[] }));
  replica.resolve("vault.health", () => {
    const flagged = itemRows().filter((i) => i.rotateEveryDays !== undefined && Math.floor((SAMPLE_NOW - (i.lastRotatedAt ?? i.createdAt)) / DAY_MS) >= i.rotateEveryDays);
    return { total: itemRows().length, weak: 0, reused: 0, stale: 0, rotationDue: flagged.length, items: flagged.map((i) => ({ itemId: i.id, name: i.name, issues: ["rotation_due" as const] })) };
  });
  replica.resolve("vault.requests.list", (_t, input) => {
    const all = rows<Row & { name: string }>("requests");
    return { requests: (input.state && input.state !== "waiting" ? [] : all).map((r) => ({ id: r.id, name: r.name })) } as unknown as CapMap["vault.requests.list"]["out"];
  });
  replica.resolve("vault.item.get", (_t, input) => {
    const it = find(input.itemId);
    return { item: strip(it), fields: fieldsOf(it.id).map((f) => ({ key: f.key, secret: f.secret, hasValue: f.value !== "" })) };
  });
  replica.resolve("vault.item.history", (_t, input) => {
    const entries = rows<HistRow>("history").filter((e) => e.itemId === input.itemId).sort((a, b) => b.at - a.at);
    return { entries: entries.map((e) => ({ at: e.at, actor: e.actor, ...(e.onBehalfOf ? { onBehalfOf: e.onBehalfOf } : {}), action: e.action as CapMap["vault.item.history"]["out"]["entries"][number]["action"], ...(e.field ? { field: e.field } : {}) })) } as CapMap["vault.item.history"]["out"];
  });

  const log = (itemId: string, action: string, field?: string): void => {
    replica.put("history", [{ id: `h${++seq}`, itemId, at: SAMPLE_NOW, actor: { kind: "person", id: space.me.id }, action, ...(field ? { field } : {}) } as HistRow]);
  };
  const touch = (id: string, patch: Partial<ItemRow>): ItemRow => { const next = { ...find(id), ...patch, updatedAt: SAMPLE_NOW } as ItemRow; replica.put("items", [next]); return next; };

  // Who holds each item (access.shares_of): the owner, then the grants above. A grant is changed by vault.share and removed by vault.unshare.
  const grants = new Map<string, Share[]>();
  for (const [itemId, list] of Object.entries(space.grants ?? {})) grants.set(itemId, list.map(([kind, id, level]): Share => ({ subject: { kind, id }, level, through: "direct" })));
  const sharesOf = (itemId: string): Share[] => [{ subject: { kind: "person", id: space.me.id }, level: "manage", through: "owner" }, ...(grants.get(itemId) ?? [])];

  const writes: Record<string, (input: any) => unknown> = {
    "access.shares_of": (i: { resource: { type: string; id: string } }) => ({
      shares: sharesOf(i.resource.id).map((x, n) => ({ grant: { id: `grt_${n}`, subject: x.subject, resource: i.resource, level: x.level, conditions: {}, by: space.me.id, createdAt: SAMPLE_NOW }, through: x.through })),
    }),
    "vault.share": (i: { resource: { id: string }; subject: Share["subject"]; level: Share["level"] }) => {
      const cur = grants.get(i.resource.id) ?? [];
      const same = (x: Share): boolean => x.subject.kind === i.subject.kind && x.subject.id === i.subject.id;
      grants.set(i.resource.id, cur.some(same) ? cur.map((x) => (same(x) ? { ...x, level: i.level } : x)) : [...cur, { subject: i.subject, level: i.level, through: "direct" }]);
      log(i.resource.id, "shared");
      return { granted: true };
    },
    "vault.unshare": (i: { resource: { id: string }; subject: Share["subject"] }) => {
      const cur = grants.get(i.resource.id) ?? [];
      grants.set(i.resource.id, cur.filter((x) => !(x.subject.kind === i.subject.kind && x.subject.id === i.subject.id)));
      log(i.resource.id, "unshared");
      return { revoked: 1 };
    },
    "vault.item.reveal": (i: { itemId: string; fields?: string[] }) => {
      const it = find(i.itemId);
      if (it.kind === "ai_subscription") throw new Error("permission.provider_label");
      if (it.yourLevel === "use") throw new Error("permission.denied");
      const want = new Set(i.fields ?? it.fieldKeys);
      const out = fieldsOf(it.id).filter((f) => want.has(f.key)).map((f) => ({ key: f.key, value: f.value }));
      for (const f of out) log(it.id, "revealed", f.key);
      return { fields: out };
    },
    "vault.item.update": (i: { itemId: string; name?: string; fieldsSet?: { key: string; value: string; secret?: boolean }[]; fieldsRemove?: string[]; spaceOnly?: boolean }) => {
      const cur = fieldsOf(i.itemId);
      const keys = new Map(cur.map((f) => [f.key, f] as const));
      for (const k of i.fieldsRemove ?? []) { replica.remove("fields", [`${i.itemId}:${k}`]); keys.delete(k); }
      let order = cur.length;
      for (const f of i.fieldsSet ?? []) {
        const had = keys.get(f.key);
        const row: FieldRow = { id: `${i.itemId}:${f.key}`, itemId: i.itemId, key: f.key, secret: f.secret ?? had?.secret ?? true, value: f.value === "" && had ? had.value : f.value, order: had?.order ?? order++ };
        replica.put("fields", [row]); keys.set(f.key, row);
        log(i.itemId, "edited", f.key);
      }
      const fieldKeys = [...keys.values()].sort((a, b) => a.order - b.order).map((f) => f.key);
      return { item: strip(touch(i.itemId, { ...(i.name ? { name: i.name } : {}), ...(i.spaceOnly !== undefined ? { spaceOnly: i.spaceOnly } : {}), fieldKeys })) };
    },
    "vault.item.put": (i: { folderId: string; name: string; kind: Item["kind"]; fields: { key: string; value: string; secret?: boolean }[]; template?: string }) => {
      if (itemRows().some((x) => x.folderId === i.folderId && x.name.toLowerCase() === i.name.toLowerCase())) throw new Error("validation.duplicate");
      const folder = rows<Folder & Row>("folders").find((f) => f.id === i.folderId);
      const id = `vit_new${++seq}`;
      putItems([{ id, name: i.name, kind: i.kind, folder: i.folderId, scope: folder?.scope ?? "mine", usedAgo: 0, fields: i.fields.map((f): FieldSpec => [f.key, f.value, f.secret ?? true]) }]);
      log(id, "created");
      return { item: strip(find(id)) };
    },
    "vault.item.move": (i: { itemId: string; folderId: string }) => {
      const folder = rows<Folder & Row>("folders").find((f) => f.id === i.folderId);
      log(i.itemId, "moved");
      return { item: strip(touch(i.itemId, { folderId: i.folderId, ...(folder ? { scope: folder.scope } : {}) })) };
    },
    "vault.item.mark_rotated": (i: { itemId: string }) => { log(i.itemId, "rotated"); return { item: strip(touch(i.itemId, { lastRotatedAt: SAMPLE_NOW })) }; },
    "vault.item.delete": (i: { itemId: string }) => { touch(i.itemId, { trashed: true } as Partial<ItemRow>); log(i.itemId, "deleted"); return { ok: true }; },
    "vault.item.restore": (i: { itemId: string }) => { touch(i.itemId, { trashed: false } as Partial<ItemRow>); log(i.itemId, "restored"); return { item: strip(find(i.itemId)) }; },
    "vault.generate": () => ({ value: "Kq7#vXm2Lp9wRt4Zc8Yn", strength: "strong" }),
    "vault.folders.create": (i: { name: string; scope: Folder["scope"]; parentId?: string }) => {
      const f = fld(`fld_new${++seq}`, i.name, i.scope, 0, "manage", space.me.id);
      replica.put("folders", [f as unknown as Row]);
      return { folder: f };
    },
  };

  const nav: VaultNav = {
    openShare: (id) => void opened.push(`share:${id}`), openExport: (id) => void opened.push(`export:${id}`), openAdvanced: () => void opened.push("advanced"), ask: (agentId, mode, about) => void opened.push(`ask:${agentId}:${mode}:${about.id}`),
    openRequests: () => void opened.push("requests"), openAgent: (id) => void opened.push(`agent:${id}`),
  };
  const connection: Connection = { get: () => (online ? "online" : "offline"), subscribe: (l) => { listeners.add(l); return () => void listeners.delete(l); } };

  const data: VaultData = {
    screens: createScreenHooks(replica, screensById),
    async call(cap, input) {
      calls.push({ cap, input });
      const why = failing.get(cap);
      if (why !== undefined) { failing.delete(cap); throw new Error(why); }
      const w = writes[cap];
      if (!w) throw new Error(`no write for ${cap}`);
      return w(input);
    },
    connection,
    principals: liveRows(replica, "principals", (r) => r as unknown as Principal[]),
    me: space.me,
    spaceName: space.name,
    nav,
    clock: () => ({ now: SAMPLE_NOW }),
    copy: (t) => { copied.push(t); },
  };
  return {
    data, replica, calls, opened, copied,
    setOnline(v) { online = v; for (const l of [...listeners]) l(); },
    failNext(cap, message = `${cap} failed`) { failing.set(cap, message); },
  };
}
