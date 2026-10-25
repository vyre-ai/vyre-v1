// @reads ../../../../../../scripts/shots/mounts/P-L9d_07.tsx
// Records > Schema map and Record types finish (P-L9d_07c): selecting a type opens the fields pane on the right; Record types is a grouped inset list of plural names with type icons and
// source labels carrying the source app's icon. No letter tiles. Screens render through react-dom/server over react-native-web from the sample Space's replica.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { RecordTypesList, SchemaDataProvider, SchemaMap, appName, typeTag } from "../schemamap/index.ts";
import { createSampleSchema, northwind } from "../schemamap/sample.ts";
import type { SampleSchema } from "../schemamap/sample.ts";

const html = (s: SampleSchema, el: ReactElement): string => renderToStaticMarkup(<SchemaDataProvider value={s.data}>{el}</SchemaDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const textOf = (s: string, id: string): string | null => new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`).exec(s)?.[1] ?? null;
const map = (s: SampleSchema, props: Parameters<typeof SchemaMap>[0] = {}): string => html(s, <SchemaMap details={s.details} {...props} />);

test("nothing selected: no fields pane", () => {
  const out = map(createSampleSchema());
  assert.ok(!has(out, 'data-testid="schema-fields-pane"') && !has(out, 'data-testid="side-pane"'));
});

test("selecting a type opens the fields pane: its header, N fields and records, every field with its kind, the Name tag, Add a field", () => {
  const out = map(createSampleSchema(), { selected: "projects" });
  assert.ok(has(out, 'data-testid="schema-fields-pane"') && has(out, 'data-testid="side-pane"'), "the pane is the shared SidePane");
  assert.equal(textOf(out, "pane-type-title"), "Projects");
  assert.equal(textOf(out, "pane-type-counts"), "9 fields · 12 records");
  const fields = out.split('data-testid="pane-fields"')[1] ?? "";
  for (const key of ["name", "status", "lead", "due", "client", "tasks", "invoices", "budget", "brief"]) assert.ok(has(fields, `data-testid="row-field:projects:${key}"`), `field ${key} is a Row`);
  assert.equal(textOf(out, "pane-kind-status"), "Status");
  assert.equal(textOf(out, "pane-kind-budget"), "Money");
  assert.equal(textOf(out, "pane-kind-tasks"), "Link to Tasks");
  assert.equal(textOf(out, "pane-kind-client"), "Linked from Clients");
  assert.equal(textOf(out, "pane-name-name"), "Name", "the title field carries the Name tag");
  assert.ok(!has(out, 'data-testid="pane-name-status"'));
  assert.ok(has(out, ">Add a field<") && has(out, 'data-testid="pane-add-field"') && has(out, "Add a field in the Console"));
  assert.ok(has(out, 'aria-label="Open Projects"'));
});

test("the pane follows the selection: another type, another field list", () => {
  const out = map(createSampleSchema(), { selected: "invoices" });
  assert.equal(textOf(out, "pane-type-title"), "Invoices");
  assert.equal(textOf(out, "pane-type-counts"), "7 fields · 57 records");
  assert.equal(textOf(out, "pane-kind-number"), "Auto number");
  assert.ok(has(out, 'data-testid="row-field:invoices:pdf"'));
});

test("types get their line icon, not a letter: a person for Clients, a folder for Projects", () => {
  const out = map(createSampleSchema());
  for (const k of ["clients", "projects", "tasks", "invoices", "meetings", "hires", "messages"]) {
    const tile = out.split(`data-testid="tile-${k}"`)[1]?.split("</div>")[0] ?? "";
    assert.ok(has(tile, "<svg"), `${k} tile draws an icon`);
    assert.ok(!/>[A-Z]</.test(tile), `${k} tile has no letter`);
  }
});

test("Record types: plural names, a type icon on each row, rows divided inside one inset list", () => {
  const out = html(createSampleSchema(northwind, { withSynced: true }), <RecordTypesList />);
  for (const plural of ["Clients", "Projects", "Tasks", "Invoices", "Meetings"]) assert.ok(has(out, `>${plural}<`), plural);
  assert.ok(!has(out, ">Client<") && !has(out, ">Project<"), "singular names are not the row titles");
  assert.ok(has(out, 'data-testid="record-types-list"'));
  assert.ok(has(out, 'data-testid="tile-clients"') && (out.split('data-testid="tile-clients"')[1] ?? "").split("</div>")[0]?.includes("<svg"));
});

test("Record types: each source label, and the source app's icon beside Synced from", () => {
  const out = html(createSampleSchema(northwind, { withSynced: true }), <RecordTypesList />);
  assert.equal(textOf(out, "type-tag-clients"), "Built in");
  assert.equal(textOf(out, "type-tag-onboarding"), "Journey");
  assert.equal(textOf(out, "type-tag-hires"), "Synced from HubSpot");
  assert.equal(textOf(out, "type-tag-issues"), "Synced from GitHub");
  assert.equal(textOf(out, "type-tag-pages"), "Site table");
  const hub = out.split('data-testid="type-source-hires"')[1]?.split("</div></div>")[0] ?? "";
  assert.ok(has(hub, 'data-testid="appicon-hubspot"'), "HubSpot's own icon");
  const gh = out.split('data-testid="type-source-issues"')[1]?.split("</div></div>")[0] ?? "";
  assert.ok(has(gh, 'data-testid="appicon-github"'), "GitHub's own icon");
  const own = out.split('data-testid="type-source-clients"')[1]?.split("</div></div>")[0] ?? "";
  assert.ok(!has(own, "appicon-"), "a built-in type has no app icon");
  // a synced type shows the app's icon where the type tile would be
  const lead = out.split('data-testid="tile-hires"')[1]?.split("</div></div>")[0] ?? "";
  assert.ok(has(lead, 'data-testid="appicon-hubspot"'));
});

test("source labels in words", () => {
  assert.equal(appName("hubspot"), "HubSpot");
  assert.equal(appName("github"), "GitHub");
  assert.equal(appName("zendesk"), "Zendesk");
  assert.deepEqual(typeTag({ system: false, syncedFrom: "github" }), { kind: "synced", text: "Synced from GitHub", app: "github" });
  assert.deepEqual(typeTag({ system: false, group: "Journeys" }), { kind: "plain", text: "Journey" });
  assert.deepEqual(typeTag({ system: true, group: "Sites" }), { kind: "plain", text: "Site table" });
  assert.deepEqual(typeTag({ system: true }), { kind: "plain", text: "Built in" });
});
