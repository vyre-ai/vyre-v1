// The sample Spaces behind the Records tests and the screenshots: Northwind (clients, projects, a site table) and Harbor Studio, filled like the prototype's Records so a side by side reads
// the same. A fake replica holds the rows per type; every capability the sidebar and the table read is registered with a resolver that honours the inputs (filter, sort, group, window),
// and the writes the table makes (create, save view) change the rows. `bulk` adds that many clients: the 100,000 row Space the table100k budget opens. The real replica is SQLite behind
// the same surface.
import { createFakeReplica, createScreenHooks, liveQuery } from "../../../../../../client/src/index.ts";
import type { FakeReplica, LiveQuery, Row, Tables } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import { peopleFor, nameOf } from "../../../fixtures/index.ts";
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

export interface SampleSpace { id: Variant; name: string; types: TypeDef[]; counts: Record<string, number>; views: ViewRow[]; people: Record<string, string>; me: string }

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
  const clients: Row[] = [];
  for (let i = 0; i < seeded; i++) clients.push(client(i, owners) as unknown as Row);
  for (let i = seeded; i < seeded + bulk; i++) clients.push(client(i, owners) as unknown as Row);
  replica.put("records:clients", clients);
  for (const t of space.types) {
    if (t.key === "clients") continue;
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
    ...(t.scope ? { scope: t.scope } : {}), rowCount: tables.get(`records:${t.key}`)?.size ?? 0, fieldCount: t.fields.length,
  }));

  replica.resolve("schema.types.list", (tables) => ({ types: typeRows(tables), total: space.types.length }));
  replica.resolve("schema.describe", (_t, i) => ({ types: space.types.filter((t) => !i.type || t.key === i.type) }));
  replica.resolve("views.list", (_t, i) => ({ views: (replica.rows("views") as unknown as ViewRow[]).filter((v) => !i.type || v.type === i.type) }));
  replica.resolve("records.counts", (tables, i) => ({ count: i.filter === undefined ? (tables.get(`records:${i.type}`)?.size ?? 0) : rowsOf(tables, i.type).filter((r) => matches(r, i.filter as Clause)).length }));
  replica.resolve("records.query", (tables, i) => {
    let rows = rowsOf(tables, i.type);
    if (i.filter !== undefined) rows = rows.filter((r) => matches(r, i.filter as Clause));
    const sorts = [...(i.group ? [{ field: i.group, dir: "asc" as const }] : []), ...(i.sort ?? [])];
    if (sorts.length) {
      rows = rows.slice().sort((a, b) => {
        for (const s of sorts) {
          const x = key(a.fields[s.field]), y = key(b.fields[s.field]);
          if (x !== y) return (x < y ? -1 : 1) * (s.dir === "desc" ? -1 : 1);
        }
        return 0;
      });
    }
    const offset = i.offset ?? 0, limit = i.limit ?? 200;
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  });

  const writes: Record<string, (i: never) => unknown> = {
    "records.create": (i: { type: string; fields: Record<string, unknown> }) => {
      const id = `${i.type}_new${replica.rows(`records:${i.type}`).length}`;
      const rec = { id, type: i.type, version: 1, label: 1, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW, holds: 0, fields: i.fields } as unknown as Row;
      replica.put(`records:${i.type}`, [rec]);
      return { record: rec };
    },
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
      if (!w) throw new Error(`unknown capability ${cap}`);
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
