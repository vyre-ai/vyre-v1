// Site tables in Records (spec 2.20 Site tables): site.table_created makes a record type scoped to the site, hidden from the Console's create list and listed under Sites; site.table_promoted makes it
// a normal Space type with its rows; both replay safely. The store is the real records store.
import test from "node:test";
import assert from "node:assert/strict";
import { mintUuid } from "../../../lib/ids.ts";
import { openRecords } from "../impl.ts";
import { consoleCreatable, createSiteTableHandlers, isSiteTable, listGroup, siteOf, siteTablesOf, SITES_GROUP } from "../handlers/site-tables.ts";

const SITE = "sit_abc123";
const OTHER = "sit_def456";
const TYPE = "site_abc123_leads";
const FIELDS = [{ key: "name", type: "text", title: "Name" }, { key: "email", type: "email", title: "Email" }, { key: "seats", type: "number" }];
const make = () => { const rec = openRecords({ space: "sp_sitetables" }); return { rec, store: rec.store, h: createSiteTableHandlers({ store: rec.store }) }; };
const refused = (code: string) => (e: unknown) => { assert.equal((e as { code?: string }).code, code); return true; };
const def = async (store: ReturnType<typeof make>["store"], type = TYPE) => (await store.types()).find((t) => t.name === type);

test("site.table_created makes a record type scoped to the site, with its fields", async () => {
  const { store, h } = make();
  assert.deepEqual(await h.created({ siteId: SITE, type: TYPE, fields: FIELDS }), { applied: true, type: TYPE });
  const d = (await def(store))!;
  assert.equal(d["scope"], "site");
  assert.equal(d["site_id"], SITE);
  assert.equal(d.label, "Leads");
  assert.deepEqual(d.fields.map((f) => [f.name, f.kind, f.label]), [["name", "text", "Name"], ["email", "email", "Email"], ["seats", "number", "seats"]]);
  const id = mintUuid();
  await store.create(TYPE, id, { name: "Ada", email: "ada@example.com", seats: 3 });
  assert.equal((await store.get(TYPE, id))?.data["name"], "Ada");
});

test("a site table is hidden from the Console's create list and listed under Sites; a Space type is neither", async () => {
  const { store, h } = make();
  await h.created({ siteId: SITE, type: TYPE, fields: FIELDS });
  await store.define({ add_types: [{ name: "contact", label: "Contact", group: "People", fields: [{ name: "name", kind: "text" }] }] });
  const [site, space] = [(await def(store))!, (await def(store, "contact"))!];
  assert.deepEqual([isSiteTable(site), consoleCreatable(site), listGroup(site)], [true, false, SITES_GROUP]);
  assert.deepEqual([isSiteTable(space), consoleCreatable(space), listGroup(space)], [false, true, "People"]);
  assert.equal(siteOf(site), SITE);
  assert.equal(siteOf(space), undefined);
  assert.deepEqual((await siteTablesOf(store, SITE)).map((t) => t.name), [TYPE]);
  assert.deepEqual(await siteTablesOf(store, OTHER), []);
});

test("the same event twice changes nothing, and the rows stay", async () => {
  const { store, h } = make();
  await h.created({ siteId: SITE, type: TYPE, fields: FIELDS });
  const id = mintUuid();
  await store.create(TYPE, id, { name: "Ada" });
  const before = JSON.stringify((await store.types()));
  assert.deepEqual(await h.created({ siteId: SITE, type: TYPE, fields: FIELDS }), { applied: false, type: TYPE });
  assert.equal(JSON.stringify(await store.types()), before);
  assert.equal((await store.get(TYPE, id))?.data["name"], "Ada");
});

test("a table key another site already holds is refused and the first site keeps it", async () => {
  const { store, h } = make();
  await h.created({ siteId: SITE, type: TYPE, fields: FIELDS });
  await assert.rejects(h.created({ siteId: OTHER, type: TYPE, fields: FIELDS }), refused("invalid"));
  assert.equal((await def(store))!["site_id"], SITE);
});

test("an event that is not about a site table is refused before anything is defined", async () => {
  const { store, h } = make();
  const before = (await store.types()).length;
  for (const ev of [
    { siteId: "site-1", type: TYPE }, { siteId: SITE, type: "contact" }, { siteId: SITE, type: "Site_X" }, { siteId: SITE, type: "site_" + "a".repeat(80) },
    { siteId: SITE, type: TYPE, fields: [{ key: "Bad Key", type: "text" }] }, { siteId: SITE, type: TYPE, fields: [{ key: "a", type: "text" }, { key: "a", type: "text" }] },
    { siteId: SITE, type: TYPE, fields: [{ key: "a", type: "" }] },
  ]) await assert.rejects(h.created(ev), refused("invalid"));
  assert.equal((await store.types()).length, before);
});

test("a table made without fields is a valid empty type", async () => {
  const { store, h } = make();
  assert.equal((await h.created({ siteId: SITE, type: TYPE })).applied, true);
  assert.deepEqual((await def(store))!.fields, []);
});

test("site.table_promoted makes it a normal Space record type: listed with the others, the key and the rows unchanged", async () => {
  const { store, h } = make();
  await h.created({ siteId: SITE, type: TYPE, fields: FIELDS });
  const id = mintUuid();
  await store.create(TYPE, id, { name: "Ada", email: "ada@example.com" });
  assert.deepEqual(await h.promoted({ siteId: SITE, type: TYPE }), { applied: true, type: TYPE });
  const d = (await def(store))!;
  assert.deepEqual([d["scope"], d["promoted_from_site"], d["site_id"], d["group"], d["console_create"]], ["space", SITE, undefined, undefined, undefined]);
  assert.deepEqual([isSiteTable(d), consoleCreatable(d), listGroup(d), siteOf(d)], [false, true, undefined, SITE]);
  assert.equal(d.label, "Leads");
  assert.equal(d.fields.length, 3);
  assert.equal((await store.get(TYPE, id))?.data["email"], "ada@example.com");
  assert.deepEqual(await siteTablesOf(store, SITE), [], "no longer one of the site's tables");
});

test("promotion replays safely, and a created event that arrives after it does not scope the table back", async () => {
  const { store, h } = make();
  await h.created({ siteId: SITE, type: TYPE, fields: FIELDS });
  await h.promoted({ siteId: SITE, type: TYPE });
  assert.deepEqual(await h.promoted({ siteId: SITE, type: TYPE }), { applied: false, type: TYPE });
  assert.deepEqual(await h.created({ siteId: SITE, type: TYPE, fields: FIELDS }), { applied: false, type: TYPE });
  assert.equal((await def(store))!["scope"], "space");
});

test("a promotion before its creation waits (unknown_type, so the host retries); another site cannot promote the table", async () => {
  const { h } = make();
  await assert.rejects(h.promoted({ siteId: SITE, type: TYPE }), refused("unknown_type"));
  await h.created({ siteId: SITE, type: TYPE, fields: FIELDS });
  await assert.rejects(h.promoted({ siteId: OTHER, type: TYPE }), refused("invalid"));
  assert.deepEqual(await h.promoted({ siteId: SITE, type: TYPE }), { applied: true, type: TYPE }, "it can still be promoted by its own site");
});

test("a Space type that was never a site table cannot be 'promoted'", async () => {
  const { store, h } = make();
  await store.define({ add_types: [{ name: "site_abc123_plain", label: "Plain", fields: [{ name: "a", kind: "text" }] }] });
  await assert.rejects(h.promoted({ siteId: SITE, type: "site_abc123_plain" }), refused("invalid"));
});
