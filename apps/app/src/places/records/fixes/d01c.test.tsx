// @reads ../../../../../../scripts/shots/mounts/P-L9d_01c.tsx
// P-L9d_01c: Records as the prototype draws it. The filled New button, the footer's aggregates and status line, the filter menu's counts, dots and faces, every record type in the sidebar with its tile and
// brand icon, readable pills in both skins, and all of the prototype's client fields under Fields.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider } from "../sidebar/index.ts";
import { RecordViews } from "../views-a/index.ts";
import { createViewsSample } from "../views-a/sample.ts";
import { PLAIN } from "../table/index.ts";
import { filterMenuEntries } from "../table/filtermenu.ts";
import { PROTO_CLIENT_HIDDEN, protoNorthwindSpace } from "../table/sample.ts";
import type { TableViewState } from "../table/index.ts";

const render = (child: ReactElement, type = "clients"): string => {
  const s = createViewsSample(protoNorthwindSpace);
  return renderToStaticMarkup(<RecordsDataProvider value={s.data}><RecordsStateProvider initial={{ type }}>{child}</RecordsStateProvider></RecordsDataProvider>).replaceAll("<!-- -->", "");
};
const has = (s: string, needle: string): boolean => s.includes(needle);
const view: Partial<TableViewState> = { sort: [{ field: "since", dir: "desc" }], hidden: PROTO_CLIENT_HIDDEN };

test("New is a filled button: the ink as its fill and the window as its text", () => {
  const out = render(<RecordViews kind="table" view={view} />);
  const at = out.indexOf('data-testid="records-new"');
  assert.ok(at > 0, "New is there");
  const tag = out.slice(out.lastIndexOf("<", at), out.indexOf(">", at));
  assert.ok(has(tag, "var(--ink)"), "filled with the ink");
});

test("the foot says how many records, averages a rating under its column, and ends in the status line", () => {
  const out = render(<RecordViews kind="table" view={view} />);
  assert.ok(has(out, ">1,240 records<"), "the count in the name cell");
  assert.ok(/data-testid="agg-fit"[^>]*>Avg \d\.\d</.test(out), "the Fit column's average");
  assert.ok(has(out, 'data-testid="records-status"') && has(out, "1,240 clients · every record shown"), "the status line under the table");
  assert.equal(out.split(">Avg ").length - 1, 1, "no figure under a column that has none, apart from Fit's");
});

test("the table opens on the prototype's columns, and Fields lists all of its client fields", () => {
  const out = render(<RecordViews kind="table" view={view} />);
  for (const h of ["Name", "Status", "Owner", "Fit", "Client since", "First channel", "Latest channel"]) assert.ok(has(out, `>${h}<`), h);
  assert.ok(!has(out, ">Tax ID<") && !has(out, ">Bank account (IBAN)<"), "the sealed fields start hidden");
  const clients = protoNorthwindSpace.types.find((t) => t.key === "clients")!;
  const proto = ["status", "owner", "fit", "since", "openBal", "nextMeet", "taxId", "bank", "summary", "projects", "health", "source", "email", "phone", "key", "ltv", "refby", "dob", "addr", "idDoc", "pref", "sendform"];
  assert.equal(proto.length, 22);
  for (const key of proto) assert.ok(clients.fields.some((f) => f.key === key), `Fields has ${key}`);
  assert.deepEqual(clients.fields.slice(0, 7).map((f) => f.key), ["name", "status", "owner", "fit", "since", "fch", "lch"], "the table's own order");
});

test("the filter menu has its counts in the count column, a dot on each status and a face on each owner", () => {
  const s = createViewsSample(protoNorthwindSpace);
  const clients = protoNorthwindSpace.types.find((t) => t.key === "clients")!;
  const rows = s.replica.rows("records:clients") as never as { fields: Record<string, unknown> }[];
  const entries = filterMenuEntries({ def: clients, cur: PLAIN, rows: rows as never, nameOf: s.data.nameOf, countOf: (_f, key) => key.length, set: () => undefined });
  const items = entries.filter((e): e is Extract<typeof e, { label: string }> => "label" in e);
  const lead = items.find((i) => i.label === "Lead")!;
  assert.equal(lead.count, 4, "the count is a number in the Menu's column");
  assert.ok(items.every((i) => !/\(\d+\)/.test(i.label)), "no count in any label");
  assert.ok(lead.icon?.startsWith("<svg") && lead.icon.includes("<circle"), "a dot");
  const owner = items.find((i) => i.label === "Maya Chen")!;
  assert.ok(owner.icon?.startsWith("<svg") && owner.icon.includes("<mask"), "a face");
  assert.ok(entries.some((e) => "head" in e && e.head === "Owner"), "owners have their own heading");
});

test("the sidebar lists every record type of the prototype, with tiles and the brand icons of the synced ones", () => {
  const out = render(<RecordsSidebar />);
  for (const label of ["Clients", "Projects", "Meetings", "Agents", "Invoices", "Tasks", "Hires", "Messages", "HubSpot Contacts", "HubSpot Deals", "Pull requests", "Issues", "ATP", "Booking widget › Bookings", "Booking widget › Slots"]) assert.ok(has(out, `>${label}<`), label);
  for (const group of ["Records", "Journeys", "Sites"]) assert.ok(has(out, `>${group}<`), group);
  assert.equal(out.split('data-testid="brand-hubspot"').length - 1, 2, "HubSpot's tile on both of its types");
  assert.equal(out.split('data-testid="brand-github"').length - 1, 2, "GitHub's tile on both of its types");
  assert.ok(has(out, ">2,120<") && has(out, ">1,240<") && has(out, ">931<"), "the prototype's counts");
});

test("a pill's text is mixed with the ink, so it reads in the graphite skin as in the paper one", () => {
  const out = render(<RecordViews kind="table" view={view} />);
  assert.ok(has(out, "color-mix(in srgb, hsl(") && has(out, "var(--ink))"), "the chip colour follows the skin's ink");
  assert.ok(!/color:hsl\(\d+, 55%, 40%\)/.test(out), "not a fixed dark colour");
});
