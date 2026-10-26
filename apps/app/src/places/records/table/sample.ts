// The sample Spaces behind the Records tests and the screenshots: Northwind (clients, projects, a site table) and Harbor Studio, filled like the prototype's Records so a side by side reads
// the same. A fake replica holds the rows per type; every capability the sidebar and the table read is registered with a resolver that honours the inputs (filter, sort, group, window),
// and the writes the table makes (create, save view) change the rows. `bulk` adds that many clients: the 100,000 row Space the table100k budget opens. The real replica is SQLite behind
// the same surface.
import { createFakeReplica, createScreenHooks, liveQuery } from "../../../../../../client/src/index.ts";
import type { FakeReplica, LiveQuery, Row, Tables } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import { PROTO_CHN, PROTO_SPACE_TYPES, PROTO_TYPES } from "../../../fixtures/prototype-data.ts";
import { PROTO_CLIENT_COUNT, protoClients } from "../../../fixtures/prototype-clients.ts";
import { nameOf, namesFor, peopleFor } from "../../../fixtures/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { Connection, LiveCap, RecordsData, RecordsNav } from "../sidebar/data.tsx";
import type { TypeRow, ViewRow } from "../sidebar/model.ts";
import type { FieldDef, RecordRow, TypeDef } from "./model.ts";

export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const DAY = 86_400_000;

export type Variant = "northwind" | "harbor";

const f = (key: string, type: string, title: string, options?: Record<string, unknown>): FieldDef => ({ key, type, title, ...(options ? { options } : {}) });
const choices = (...c: [string, string, string?][]): Record<string, unknown> => ({ choices: c.map(([key, title, color]) => ({ key, title, ...(color ? { color } : {}) })) });
const stages = (...c: [string, string][]): Record<string, unknown> => ({ stages: c.map(([key, title]) => ({ key, title })) });

const def = (key: string, title: string, plural: string, icon: string, titleField: string, fields: FieldDef[], o: Partial<TypeDef> = {}): TypeDef => ({
  key, title, plural, icon, label: "internal", system: false, titleField, fields, version: 1, ...o,
});

const CLIENT_FIELDS: FieldDef[] = [
  f("name", "text", "Name"),
  f("status", "choice", "Status", choices(["lead", "Lead", "210"], ["active", "Active", "150"], ["paused", "Paused", "40"], ["closed", "Closed", "0"])),
  f("owner", "person", "Owner"),
  f("value", "money", "Value"),
  f("stage", "status", "Stage", stages(["intake", "Intake"], ["engaged", "Engaged"], ["review", "In review"], ["done", "Done"])),
  f("due", "date", "Next step due"),
  f("company", "text", "Company"),
  f("email", "email", "Email"),
  f("phone", "phone", "Phone"),
  f("rating", "rating", "Fit"),
  f("active", "checkbox", "Retainer signed"),
  f("source", "choice", "Source", choices(["web", "Website form"], ["referral", "Referral"], ["event", "Event"], ["ad", "Advert"])),
  f("notes", "longtext", "Notes"),
];

export interface SampleSpace {
  id: Variant; name: string; types: TypeDef[]; counts: Record<string, number>; views: ViewRow[]; people: Record<string, string>; me: string;
  /** Rows to use as they are, by type key, in place of the generated ones (the prototype Spaces). */
  rows?: Record<string, Row[]>;
}

const FIRST = ["Elena", "Marcus", "Priya", "Dana", "Tomas", "Hannah", "Wei", "Grace", "Jonas", "Sofia", "Nina", "Ben", "Kai", "Abel", "June", "Ines", "Theo", "Omar", "Lena", "Sam"] as const;
const LAST = ["Rivera", "Pruitt", "Nair", "Whitfield", "Berg", "Cole", "Zhang", "Mbeki", "Keller", "Alvarez", "Petrova", "Okafor", "Moreno", "Daughters", "Costa", "Lindqvist", "Haddad", "Ortiz", "Patel", "Chen"] as const;
const COMPANY = ["Rivera Holdings", "Pruitt & Co.", "Nair Studio", "Whitfield Group", "Berg Logistics", "Cole Dental", "Zhang Imports", "Mbeki Design", "Keller Bakery", "Alvarez Design"] as const;
const STATUS = ["lead", "active", "active", "paused", "closed", "active"] as const;
const STAGE = ["intake", "engaged", "review", "done"] as const;
const OWNERS = ["usr_irfad", "usr_maya", "usr_omar", "usr_lena", "usr_sam"] as const;
const SOURCE = ["web", "referral", "event", "ad"] as const;

/** One sample client; `i` makes it unique and keeps the pattern stable between runs. */
export function client(i: number, owners: readonly string[] = OWNERS): RecordRow {
  const first = FIRST[i % FIRST.length]!, last = LAST[(i * 7 + (i >> 4)) % LAST.length]!;
  return {
    id: `cl_${i}`, type: "clients", version: 1, label: 1, createdAt: SAMPLE_NOW - (i + 1) * 3_600_000, updatedAt: SAMPLE_NOW - i * 60_000, holds: 0,
    fields: {
      name: `${first} ${last}${i >= LAST.length * 2 ? ` ${i}` : ""}`, status: STATUS[i % STATUS.length], owner: owners[i % owners.length], value: { amount: 1000 + ((i * 7919) % 90000), currency: "USD" },
      stage: STAGE[i % STAGE.length], due: SAMPLE_NOW + ((i % 30) - 6) * DAY, company: COMPANY[i % COMPANY.length], email: `${first.toLowerCase()}.${last.toLowerCase()}@example.test`,
      phone: `+1 415 555 ${String(100 + (i % 900)).padStart(4, "0")}`, rating: 1 + (i % 5), active: i % 3 === 0, source: SOURCE[i % SOURCE.length], notes: "",
    },
  };
}

export const northwind: SampleSpace = {
  id: "northwind", name: "Northwind", me: "usr_irfad",
  types: [
    def("clients", "Client", "Clients", "people", "name", CLIENT_FIELDS),
    def("companies", "Company", "Companies", "building", "name", [f("name", "text", "Name"), f("industry", "choice", "Industry", choices(["legal", "Legal"], ["retail", "Retail"], ["health", "Health"])), f("size", "number", "People")]),
    def("projects", "Project", "Projects", "project", "name", [f("name", "text", "Name"), f("status", "status", "Status", stages(["planning", "Planning"], ["active", "Active"], ["done", "Done"])), f("lead", "person", "Lead"), f("due", "date", "Due")], { system: true, template: "project", group: "Projects" }),
    def("meetings", "Meeting", "Meetings", "calendar", "title", [f("title", "text", "Title"), f("when", "datetime", "When")], { system: true }),
    def("orders", "Order", "Orders", "table", "number", [f("number", "text", "Order"), f("total", "money", "Total")], { scope: "site:northwind-site" }),
  ],
  counts: { clients: 14, companies: 6, projects: 4, meetings: 3, orders: 9 },
  views: [
    { viewId: "vw_active", type: "clients", kind: "table", title: "Active clients", shared: true, ownerId: "usr_maya", filter: { field: "status", op: "eq", value: "active" }, sort: [{ field: "value", dir: "desc" }], hidden: ["notes"], updatedAt: SAMPLE_NOW },
    { viewId: "vw_mine", type: "clients", kind: "table", title: "My clients", shared: false, ownerId: "usr_irfad", filter: { field: "owner", op: "eq", value: "usr_irfad" }, updatedAt: SAMPLE_NOW },
  ],
  people: peopleFor("northwind", OWNERS),
};

export const harbor: SampleSpace = {
  id: "harbor", name: "Harbor Studio", me: "usr_june",
  types: [
    def("clients", "Client", "Clients", "people", "name", CLIENT_FIELDS.slice(0, 6)),
    def("projects", "Project", "Projects", "project", "name", [f("name", "text", "Name"), f("status", "status", "Status", stages(["planning", "Planning"], ["active", "Active"], ["done", "Done"])), f("due", "date", "Due")], { system: true, template: "project", group: "Projects" }),
  ],
  counts: { clients: 6, projects: 3 },
  views: [],
  people: peopleFor("harbor", ["usr_june", "usr_ines", "usr_theo"]),
};

// ---------------------------------------------------------------- the prototype Spaces
// Northwind Clients and the Harbor Studio types, read from the prototype through fixtures/prototype-data.ts and fixtures/prototype-clients.ts. `northwind` and `harbor` above stay the
// small sets the table's own tests count; the screenshot mounts use these.

const slug = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const hueChoices = (list: readonly (readonly [string, number | null])[]): Record<string, unknown> => choices(...list.map(([t, h]): [string, string, string?] => (h === null ? [slug(t), t] : [slug(t), t, String(h)])));
const dayMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

const STATUS_OPTIONS: readonly (readonly [string, number | null])[] = [["Lead", 220], ["Consult booked", 270], ["Active", 145], ["On hold", 35], ["Closed", null]];
const SOURCE_OPTIONS: readonly (readonly [string, number | null])[] = [["Referral", 160], ["Website", 205], ["Event", 330], ["Partner", 35]];

type ProtoField = { id: string; n: string; t: string; kind?: string; rt?: string; o?: readonly (readonly [string, number | null])[] };
const protoClientType = PROTO_TYPES["clients"] as { fields: readonly ProtoField[]; hidden: readonly string[] };
/** The prototype's field types as the table draws them: a status is a coloured choice here, a check a checkbox, a text of kind email or phone its own type. */
const protoFieldType = (p: ProtoField): string => (p.t === "status" ? "choice" : p.t === "check" ? "checkbox" : p.t === "text" && (p.kind === "email" || p.kind === "phone") ? p.kind : p.t);
const protoField = (p: ProtoField): FieldDef => f(p.id, protoFieldType(p), p.n, p.o ? hueChoices(p.o) : undefined);
/** All 23 of the prototype's Client fields (the name and the 22 under Fields), then the first and latest channel the prototype's table also draws. */
const PROTO_CLIENT_FIELDS: FieldDef[] = [
  ...protoClientType.fields.map(protoField),
  f("fch", "choice", "First channel", hueChoices(PROTO_CHN as readonly (readonly [string, number | null])[])),
  f("lch", "choice", "Latest channel", hueChoices(PROTO_CHN as readonly (readonly [string, number | null])[])),
];
/** The fields the prototype's Clients table opens without (the view's hidden list). */
export const PROTO_CLIENT_HIDDEN: readonly string[] = protoClientType.hidden;

function protoNorthwind(): SampleSpace {
  const idOf = Object.fromEntries(Object.entries(namesFor("northwind")).map(([id, name]) => [name, id]));
  const rows = protoClients().map((c) => ({
    id: `cl_${c.id}`, type: "clients", version: 1, label: 1, createdAt: dayMs(c.since), updatedAt: dayMs(c.since), holds: 0,
    fields: { name: c.name, status: slug(c.status), owner: idOf[c.owner] ?? c.owner, ...(c.fit === null ? {} : { fit: c.fit }), since: dayMs(c.since), fch: slug(c.fch), lch: slug(c.lch), source: slug(c.source) },
  })) as unknown as Row[];
  const base = northwind;
  return {
    ...base,
    types: [
      def("clients", "Client", "Clients", "people", "name", PROTO_CLIENT_FIELDS),
      ...base.types.filter((t) => t.key === "projects"),
      // the prototype's other record types, as the sidebar lists them (their rows are not drawn here, only their names, icons and counts)
      def("meetings", "Meeting", "Meetings", "calendar", "title", [f("title", "text", "Title"), f("when", "datetime", "When")]),
      def("agents", "Agent", "Agents", "agents", "name", [f("name", "text", "Name")]),
      def("invoices", "Invoice", "Invoices", "invoice", "no", [f("no", "text", "Number")]),
      def("tasks", "Task", "Tasks", "task", "title", [f("title", "text", "Title")]),
      def("hires", "Hire", "Hires", "hires", "name", [f("name", "text", "Name")]),
      def("messages", "Message", "Messages", "message", "subject", [f("subject", "text", "Subject")]),
      def("hscontacts", "HubSpot contact", "HubSpot Contacts", "people", "name", [f("name", "text", "Name")], { syncedFrom: "hubspot" }),
      def("hsdeals", "HubSpot deal", "HubSpot Deals", "table", "name", [f("name", "text", "Name")], { syncedFrom: "hubspot" }),
      def("pulls", "Pull request", "Pull requests", "pull", "title", [f("title", "text", "Title")], { syncedFrom: "github" }),
      def("issues", "Issue", "Issues", "issue", "title", [f("title", "text", "Title")], { syncedFrom: "github" }),
      def("atp", "ATP", "ATP", "route", "title", [f("title", "text", "Title")], { group: "Journeys" }),
      def("bookings", "Booking", "Bookings", "table", "name", [f("name", "text", "Name")], { scope: "site:booking-widget" }),
      def("slots", "Slot", "Slots", "table", "name", [f("name", "text", "Name")], { scope: "site:booking-widget" }),
    ],
    counts: { ...base.counts, clients: PROTO_CLIENT_COUNT, agents: 5, invoices: 2120, meetings: 652, tasks: 931, hires: 2, messages: 5, hscontacts: 79, hsdeals: 40, pulls: 4, issues: 5, atp: 2, bookings: 12, slots: 40 },
    views: [
      { viewId: "vw_active", type: "clients", kind: "table", title: "Active clients", shared: true, ownerId: "usr_maya", filter: { field: "status", op: "eq", value: "active" }, sort: [{ field: "since", dir: "desc" }], updatedAt: SAMPLE_NOW },
      { viewId: "vw_mine", type: "clients", kind: "table", title: "My clients", shared: false, ownerId: "usr_irfad", filter: { field: "owner", op: "eq", value: "usr_maya" }, updatedAt: SAMPLE_NOW },
    ],
    rows: { clients: rows },
  };
}

/** Harbor Studio's Records: the prototype's Clients and Jobs types with their three rows each. Owners are Noor Hashmi and Ravi Menon, as the prototype has them. */
function protoHarbor(): SampleSpace {
  const owners: Record<string, string> = { "Noor Hashmi": "usr_noor", "Ravi Menon": "usr_ravi" };
  const hc = PROTO_SPACE_TYPES["hclients"]!, hj = PROTO_SPACE_TYPES["hjobs"]!;
  const fieldOf = (d: (typeof hc)["fields"][number]): FieldDef => {
    const opts = d.options ? hueChoices(d.options) : undefined;
    if (d.type === "status") return f(d.id, "choice", d.name, opts);
    if (d.type === "relation") return f(d.id, "text", d.name);
    return f(d.id, d.type, d.name, opts);
  };
  const clientNames = hc.rows.map((r) => String(r["name"]));
  const toRows = (type: string, d: typeof hc, map: (r: Record<string, unknown>) => Record<string, unknown>): Row[] => d.rows.map((r, i) => ({
    id: `${type}_${i}`, type, version: 1, label: 1, createdAt: SAMPLE_NOW - i * DAY, updatedAt: SAMPLE_NOW - i * DAY, holds: 0, fields: map(r),
  })) as unknown as Row[];
  const clientRows = toRows("clients", hc, (r) => ({ name: r["name"], status: slug(String(r["status"])), owner: owners[String(r["owner"])] ?? r["owner"], email: r["email"] }));
  const jobRows = toRows("jobs", hj, (r) => ({ title: r["title"], client: clientNames[Number(String((r["client"] as string[])[0]).replace(/\D/g, ""))] ?? "", stage: slug(String(r["stage"])), due: dayMs(String(r["due"])) }));
  return {
    id: "harbor", name: "Harbor Studio", me: "usr_june",
    types: [
      def("clients", hc.meta.one, hc.meta.title, "people", hc.meta.primary, hc.fields.map(fieldOf)),
      def("jobs", hj.meta.one, hj.meta.title, "project", hj.meta.primary, hj.fields.map(fieldOf)),
    ],
    counts: { clients: clientRows.length, jobs: jobRows.length },
    views: [],
    people: namesFor("harbor", { usr_noor: "Noor Hashmi", usr_ravi: "Ravi Menon" }),
    rows: { clients: clientRows, jobs: jobRows },
  };
}

export const protoNorthwindSpace: SampleSpace = protoNorthwind();
export const protoHarborSpace: SampleSpace = protoHarbor();

// ---------------------------------------------------------------- the replica

type Clause = { field?: string; op?: string; value?: unknown; and?: Clause[]; or?: Clause[] };

function matches(r: RecordRow, c: Clause | undefined): boolean {
  if (!c) return true;
  if (c.and) return c.and.every((x) => matches(r, x));
  if (c.or) return c.or.some((x) => matches(r, x));
  const v = r.fields[c.field ?? ""];
  switch (c.op) {
    case "eq": return v === c.value;
    case "ne": return v !== c.value;
    case "in": return Array.isArray(c.value) && c.value.includes(v);
    case "contains": return typeof v === "string" && typeof c.value === "string" && v.toLowerCase().includes(c.value.toLowerCase());
    case "empty": return v === undefined || v === null || v === "";
    case "notempty": return !(v === undefined || v === null || v === "");
    default: return true;
  }
}

const key = (v: unknown): number | string => (typeof v === "number" ? v : v && typeof v === "object" && typeof (v as { amount?: unknown }).amount === "number" ? (v as { amount: number }).amount : typeof v === "boolean" ? Number(v) : String(v ?? ""));

function rowsOf(tables: Tables, type: string): RecordRow[] {
  const t = tables.get(`records:${type}`);
  return t ? ([...t.values()] as unknown as RecordRow[]) : [];
}

export interface SampleRecords {
  data: RecordsData;
  replica: FakeReplica;
  /** every capability the table called, in order */
  calls: { cap: string; input: unknown }[];
  /** what the nav handlers were asked to open */
  opened: string[];
  setOnline(online: boolean): void;
}

export function createSampleRecords(space: SampleSpace = northwind, o: { online?: boolean; bulk?: number } = {}): SampleRecords {
  const replica = createFakeReplica(space.id);
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  let online = o.online ?? true;
  const listeners = new Set<() => void>();
  const bulk = o.bulk ?? 0;

  // the rows: a handful of named clients and the bulk after them
  // owners come from the Space's own people, so a Harbor row never names a Northwind teammate
  const owners = Object.keys(space.people).filter((id) => id.startsWith("usr_"));
  const seeded = Math.min(space.counts["clients"] ?? 0, 14);
  const given = space.rows?.["clients"];
  const clients: Row[] = [];
  if (!given) {
    for (let i = 0; i < seeded; i++) clients.push(client(i, owners) as unknown as Row);
    for (let i = seeded; i < seeded + bulk; i++) clients.push(client(i, owners) as unknown as Row);
  }
  replica.put("records:clients", given ? [...given, ...Array.from({ length: bulk }, (_, k) => ({ ...(given[k % given.length] as Row), id: `cl_x${k}` }))] : clients);
  for (const t of space.types) {
    if (t.key === "clients") continue;
    if (space.rows?.[t.key]) { replica.put(`records:${t.key}`, space.rows[t.key] as Row[]); continue; }
    const n = space.counts[t.key] ?? 0;
    const rows: Row[] = [];
    for (let i = 0; i < n; i++) {
      const fields: Record<string, unknown> = {};
      for (const fd of t.fields) fields[fd.key] = fd.type === "text" ? `${t.title} ${i + 1}` : fd.type === "person" ? (owners[1] ?? space.me) : fd.type === "money" ? { amount: 100 * (i + 1), currency: "USD" } : fd.type === "date" || fd.type === "datetime" ? SAMPLE_NOW + i * DAY : fd.type === "number" ? 5 + i : fd.type === "status" || fd.type === "choice" ? (optionKeys(fd)[i % Math.max(1, optionKeys(fd).length)] ?? "") : "";
      rows.push({ id: `${t.key}_${i}`, type: t.key, version: 1, label: 1, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW, holds: 0, fields } as unknown as Row);
    }
    replica.put(`records:${t.key}`, rows);
  }
  replica.put("views", space.views.map((v) => ({ ...v, id: v.viewId }) as unknown as Row));

  const typeRows = (tables: Tables): TypeRow[] => space.types.map((t) => ({
    key: t.key, title: t.title, plural: t.plural, icon: t.icon, ...(t.group ? { group: t.group } : {}), label: t.label, system: t.system,
    ...(t.scope ? { scope: t.scope } : {}), ...(t.syncedFrom ? { syncedFrom: t.syncedFrom } : {}), rowCount: tables.get(`records:${t.key}`)?.size || space.counts[t.key] || 0, fieldCount: t.fields.length,
  }));

  // The long table (100,000 rows) asks the same filter and sort again for every window and every re-render; filtering and sorting the whole table each time took seconds. The matching
  // rows, in order, are worked out once per (type, filter, sort, group) for as long as the replica has not been written, and each window is a slice of that.
  const ordered = new Map<string, { at: number; rows: RecordRow[] }>();
  const orderOf = (tables: Tables, i: { type: string; filter?: unknown; sort?: readonly { field: string; dir?: string }[]; group?: string }): RecordRow[] => {
    const id = JSON.stringify([i.type, i.filter ?? null, i.sort ?? null, i.group ?? null]);
    const hit = ordered.get(id);
    if (hit && hit.at === replica.version()) return hit.rows;
    let rows = rowsOf(tables, i.type);
    if (i.filter !== undefined) rows = rows.filter((r) => matches(r, i.filter as Clause));
    const sorts = [...(i.group ? [{ field: i.group, dir: "asc" as const }] : []), ...(i.sort ?? [])];
    if (sorts.length) {
      // keys are read once per row and sort, not once per comparison
      const keyed = rows.map((r) => ({ r, k: sorts.map((s) => key(r.fields[s.field])) }));
      keyed.sort((a, b) => {
        for (let n = 0; n < sorts.length; n++) {
          const x = a.k[n]!, y = b.k[n]!;
          if (x !== y) return (x < y ? -1 : 1) * (sorts[n]!.dir === "desc" ? -1 : 1);
        }
        return 0;
      });
      rows = keyed.map((e) => e.r);
    }
    ordered.set(id, { at: replica.version(), rows });
    return rows;
  };
  replica.resolve("schema.types.list", (tables) => ({ types: typeRows(tables), total: space.types.length }));
  replica.resolve("schema.describe", (_t, i) => ({ types: space.types.filter((t) => !i.type || t.key === i.type) }));
  replica.resolve("views.list", (_t, i) => ({ views: (replica.rows("views") as unknown as ViewRow[]).filter((v) => !i.type || v.type === i.type) }));
  replica.resolve("records.counts", (tables, i) => ({ count: i.filter === undefined ? (tables.get(`records:${i.type}`)?.size ?? 0) : orderOf(tables, { type: i.type, filter: i.filter }).length }));
  replica.resolve("records.query", (tables, i) => {
    const rows = orderOf(tables, i);
    const offset = i.offset ?? 0, limit = i.limit ?? 200;
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  });

  const trash = new Map<string, Row>();
  const writes: Record<string, (i: never) => unknown> = {
    "records.create": (i: { type: string; fields: Record<string, unknown> }) => {
      const id = `${i.type}_new${replica.rows(`records:${i.type}`).length}`;
      const rec = { id, type: i.type, version: 1, label: 1, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW, holds: 0, fields: i.fields } as unknown as Row;
      replica.put(`records:${i.type}`, [rec]);
      return { record: rec };
    },
    "records.delete": (i: { type: string; recordId: string }) => {
      const cur = (replica.rows(`records:${i.type}`) as unknown as { id: string }[]).find((r) => r.id === i.recordId);
      if (!cur) throw new Error("not_found");
      trash.set(i.recordId, cur as unknown as Row);
      replica.remove(`records:${i.type}`, [i.recordId]);
      return { deleted: true };
    },
    "records.restore": (i: { type: string; recordId: string }) => {
      const cur = trash.get(i.recordId);
      if (!cur) throw new Error("not_found");
      trash.delete(i.recordId);
      replica.put(`records:${i.type}`, [cur]);
      return { record: cur };
    },
    "records.export": () => ({ fileId: "fil_export" }),
    "views.save": (i: { type: string; viewId?: string; kind: string; title: string; filter?: unknown; sort?: unknown; group?: string; hidden?: string[]; config?: Record<string, unknown> }) => {
      const viewId = i.viewId ?? `vw_${replica.rows("views").length + 1}`;
      const view = { id: viewId, viewId, type: i.type, kind: i.kind, title: i.title, shared: false, ownerId: space.me, updatedAt: SAMPLE_NOW, ...(i.filter !== undefined ? { filter: i.filter } : {}), ...(i.sort !== undefined ? { sort: i.sort } : {}), ...(i.group ? { group: i.group } : {}), ...(i.hidden ? { hidden: i.hidden } : {}), ...(i.config ? { config: i.config } : {}) };
      replica.put("views", [view as unknown as Row]);
      return { view };
    },
  };

  const nav: RecordsNav = {
    openRecord: (id) => void opened.push(`record:${id}`),
    openRecordTypes: () => void opened.push("record-types"),
    openSchemaMap: () => void opened.push("schema-map"),
  };
  const connection: Connection = { get: () => (online ? "online" : "offline"), subscribe: (l) => { listeners.add(l); return () => void listeners.delete(l); } };

  const data: RecordsData = {
    screens: createScreenHooks(replica, screensById),
    live<C extends LiveCap>(cap: C, input: CapMap[C]["in"]): LiveQuery<CapMap[C]["out"]> { return liveQuery(replica, cap, input); },
    async call(cap, input) {
      calls.push({ cap, input });
      const w = writes[cap];
      if (!w) {
        const read = replica.run(cap as never, input as never);
        if (read) return read.data;
        throw new Error(`unknown capability ${cap}`);
      }
      return w(input as never);
    },
    connection, nav,
    nameOf: (id) => space.people[id] ?? nameOf(space.id, id),
  };
  return { data, replica, calls, opened, setOnline(v) { online = v; for (const l of [...listeners]) l(); } };
}

function optionKeys(fd: FieldDef): string[] {
  const o = fd.options ?? {};
  const list = (o["choices"] ?? o["stages"]) as { key: string }[] | undefined;
  return list ? list.map((x) => x.key) : [];
}
