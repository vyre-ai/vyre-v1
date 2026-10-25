// The sample Space behind the Schema map and Record types tests and screenshots: the Northwind tables of the prototype's Records (Clients, Projects, Tasks, Invoices, Meetings, Hires,
// Messages) with their fields and links, a synced HubSpot type and a site table for the list. `call` answers schema.types.get from memory; the screens' live queries (schema.map,
// schema.types.list) read the fake replica, so what the tests change is what the next render shows.
import { createFakeReplica, createScreenHooks } from "../../../../../../client/src/index.ts";
import type { FakeReplica, Row } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { SchemaData } from "./data.tsx";
import type { MapEdge, MapNode, TypeDetail, TypeRow } from "./model.ts";

type F = TypeDetail["fields"][number];
const f = (key: string, type: string, title: string, o: Partial<F> = {}): F => ({ key, type, title, ...o });

const detail = (key: string, title: string, plural: string, titleField: string, fields: F[], o: Partial<TypeDetail> = {}): TypeDetail => ({
  key, title, plural, icon: key, label: "internal", system: false, titleField, fields, version: 1, ...o,
});

export const northwindTypes: TypeDetail[] = [
  detail("clients", "Client", "Clients", "name", [
    f("name", "text", "Name"), f("email", "email", "Email"), f("phone", "phone", "Phone"), f("stage", "status", "Stage"), f("owner", "person", "Owner"),
    f("projects", "relation", "Projects"), f("invoices", "relation", "Invoices"), f("meetings", "relation", "Meetings"), f("balance", "rollup", "Balance"), f("since", "datetime", "Client since"),
  ], { system: true }),
  detail("projects", "Project", "Projects", "name", [
    f("name", "text", "Name"), f("status", "status", "Status"), f("lead", "person", "Lead"), f("due", "datetime", "Due"), f("client", "relation", "Client"),
    f("tasks", "relation", "Tasks"), f("invoices", "relation", "Invoices"), f("budget", "money", "Budget"), f("brief", "longtext", "Brief"),
  ], { system: true, template: "project", workspace: true }),
  detail("tasks", "Task", "Tasks", "title", [
    f("title", "text", "Title"), f("state", "status", "State"), f("assigned", "person", "Assigned"), f("due", "datetime", "Due"), f("project", "relation", "Project"), f("done", "checkbox", "Done"),
  ], { system: true }),
  detail("invoices", "Invoice", "Invoices", "number", [
    f("number", "autonumber", "Number"), f("amount", "money", "Amount"), f("due", "datetime", "Due"), f("status", "choice", "Status"), f("client", "relation", "Client"), f("project", "relation", "Project"), f("pdf", "files", "PDF"),
  ], { system: true }),
  detail("meetings", "Meeting", "Meetings", "title", [
    f("title", "text", "Title"), f("when", "datetime", "When"), f("who", "person", "Who"), f("client", "relation", "Client"), f("notes", "longtext", "Notes"),
  ], { system: true }),
  detail("hires", "Hire", "Hires", "name", [f("name", "text", "Name"), f("role", "choice", "Role"), f("start", "datetime", "Start date"), f("offer", "files", "Offer letter")]),
  detail("messages", "Message", "Messages", "subject", [f("subject", "text", "Subject"), f("from", "person", "From"), f("sent", "datetime", "Sent"), f("client", "relation", "Client")], { system: true }),
];

export const northwindEdges: MapEdge[] = [
  { from: "clients", to: "projects", field: "projects", inverse: "client" },
  { from: "clients", to: "invoices", field: "invoices", inverse: "client" },
  { from: "clients", to: "meetings", field: "meetings", inverse: "client" },
  { from: "projects", to: "tasks", field: "tasks", inverse: "project" },
  { from: "projects", to: "invoices", field: "invoices", inverse: "project" },
  { from: "messages", to: "clients", field: "client" },
];

export interface SchemaSpace {
  types: TypeDetail[];
  edges: MapEdge[];
  rows: Record<string, number>;
  synced?: Record<string, string>;
  group?: Record<string, string>;
}

export const northwind: SchemaSpace = {
  types: northwindTypes,
  edges: northwindEdges,
  rows: { clients: 38, projects: 12, tasks: 164, invoices: 57, meetings: 91, hires: 2, messages: 420 },
};

export const harbor: SchemaSpace = {
  types: [
    detail("clients", "Client", "Clients", "name", [f("name", "text", "Name"), f("email", "email", "Email"), f("projects", "relation", "Projects")], { system: true }),
    detail("projects", "Project", "Projects", "name", [f("name", "text", "Name"), f("status", "status", "Status"), f("client", "relation", "Client"), f("due", "datetime", "Due")], { system: true, template: "project" }),
    detail("invoices", "Invoice", "Invoices", "number", [f("number", "autonumber", "Number"), f("amount", "money", "Amount"), f("client", "relation", "Client")], { system: true }),
  ],
  edges: [{ from: "clients", to: "projects", field: "projects", inverse: "client" }, { from: "clients", to: "invoices", field: "invoices" }],
  rows: { clients: 19, projects: 7, invoices: 33 },
};

const listRow = (d: TypeDetail, space: SchemaSpace): TypeRow => ({
  key: d.key, title: d.title, plural: d.plural, icon: d.icon, label: d.label, system: d.system, rowCount: space.rows[d.key] ?? 0, fieldCount: d.fields.length,
  ...(space.synced?.[d.key] ? { syncedFrom: space.synced[d.key] as string } : {}), ...(space.group?.[d.key] ? { group: space.group[d.key] as string } : {}),
});

export interface SampleSchema {
  data: SchemaData;
  replica: FakeReplica;
  calls: { cap: string; input: unknown }[];
  /** every place a press led: "type:projects", "console", "console:projects" */
  went: string[];
  copied: string[];
  details: ReadonlyMap<string, TypeDetail>;
  /** Add a record type to the Space: the map and the list update. */
  addType(d: TypeDetail, rows: number, edges?: MapEdge[]): void;
}

export function createSampleSchema(space: SchemaSpace = northwind, o: { withSynced?: boolean } = {}): SampleSchema {
  const replica = createFakeReplica("spc_northwind");
  const calls: { cap: string; input: unknown }[] = [];
  const went: string[] = [];
  const copied: string[] = [];
  const types = new Map<string, TypeDetail>();
  for (const d of space.types) types.set(d.key, d);
  const sp: SchemaSpace = o.withSynced
    ? { ...space, synced: { ...space.synced, hires: "hubspot" }, group: { ...space.group } }
    : space;
  let edges = [...space.edges];
  const rows = { ...space.rows };

  const publish = (): void => {
    const nodes: MapNode[] = [];
    for (const d of types.values()) nodes.push({ type: d.key, title: d.plural, rowCount: rows[d.key] ?? 0 });
    replica.put("map", [{ id: "map", nodes, edges } as Row]);
    replica.put("types", [...types.values()].map((d) => ({ id: d.key, ...listRow(d, sp) }) as Row));
  };
  publish();
  replica.resolve("schema.map", () => {
    const m = replica.rows("map")[0] as unknown as { nodes: MapNode[]; edges: MapEdge[] };
    return { nodes: m.nodes, edges: m.edges } as CapMap["schema.map"]["out"];
  });
  replica.resolve("schema.types.list", () => {
    const list = replica.rows("types") as unknown as (TypeRow & { id: string })[];
    return { types: list.map(({ id: _id, ...t }) => t), total: list.length } as CapMap["schema.types.list"]["out"];
  });

  const data: SchemaData = {
    screens: createScreenHooks(replica, screensById),
    async call(cap, input) {
      calls.push({ cap, input });
      if (cap !== "schema.types.get") throw new Error(`no answer for ${cap}`);
      const d = types.get((input as { type: string }).type);
      if (!d) throw new Error("not_found");
      return { type: d };
    },
    nav: { openType: (k) => void went.push(`type:${k}`), openConsole: (k) => void went.push(k ? `console:${k}` : "console") },
    copy: (t) => void copied.push(t),
  };
  return {
    data, replica, calls, went, copied, details: types,
    addType(d, n, extra = []) { types.set(d.key, d); rows[d.key] = n; edges = [...edges, ...extra]; publish(); },
  };
}
