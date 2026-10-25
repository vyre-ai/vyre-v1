// Import: preview (spec 2.9 Lifecycle). The rows to create, update or skip, what cannot be converted and why, the fields the import would add, and a token for the plan checked. A preview writes
// no record, no record type and no event.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { CSV, MAPPING, makeXlsx, run, stage } from "../fixtures/seed.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); return true; });
}
const preview = (h: Harness, importId: string, over: Record<string, unknown> = {}): Promise<any> =>   // eslint-disable-line @typescript-eslint/no-explicit-any
  run(h, "import.preview", { importId, type: "contact", mapping: MAPPING, ...over });
const header = CSV.split("\n")[0] as string;
const WRITES = ["records.bulk_upsert", "records.create", "records.update", "schema.apply", "runs.start"];

test("preview does not write: no record, no record type, no Run, no event, and the import stays staged", async () => {
  const h = harness();
  const id = await stage(h);
  const fieldsBefore = JSON.stringify(h.world.types.get("contact"));
  h.clear();
  const out = await preview(h, id, { createFields: true, match: ["email"] });
  for (const cap of WRITES) assert.equal(h.only(cap).length, 0, cap);
  assert.deepEqual(h.emitted, []);
  assert.equal(h.world.store.size, 0);
  assert.equal(JSON.stringify(h.world.types.get("contact")), fieldsBefore);
  assert.equal(h.rows("SELECT state FROM import_session WHERE importId = ?", id)[0]?.["state"], "staged");
  assert.equal(h.rows("SELECT created FROM import_session WHERE importId = ?", id)[0]?.["created"], 0);
  assert.match(out.previewToken, /^pv_[0-9a-f]{32}$/);
});

test("a clean import previews as all creates, with the converted values as samples", async () => {
  const h = harness();
  const out = await preview(h, await stage(h));
  assert.deepEqual([out.creates, out.updates, out.skips, out.errorCount], [3, 0, 0, 0]);
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.newFields, []);
  assert.deepEqual(out.samples[0], { name: "Ada Lovelace", email: "ada@example.com", phone: "+15550100101", company: "Analytical", joined: Date.UTC(2026, 0, 5), vip: true, amount: 1200.5, stage: "lead" });
  assert.deepEqual(out.samples[1], { name: "Grace Hopper", email: "grace@example.com", phone: "5550100102", company: "Navy", joined: Date.UTC(2026, 0, 6), vip: false, amount: 300, stage: "client" });
  assert.equal("vip" in out.samples[2], false, "a blank cell gives no value");
  assert.equal(out.samples[2].joined, Date.UTC(2026, 0, 7));
});

test("cells that cannot be converted are listed by row and column, with the count; rows that are only blank are skipped", async () => {
  const h = harness();
  const text = [`${header},Notes`,
    "Bad Row,not-an-email,12,Co,2026-13-45,maybe,abc,Partner,x",
    "No Name,a@b.co,,,,,,,",
    ",,,,,,,,only a note",
    "Fine,fine@example.com,5550100100,Co,2026-02-01,yes,1,Lead,"].join("\n");
  const out = await preview(h, await stage(h, text));
  assert.deepEqual([out.creates, out.updates, out.skips, out.errorCount], [2, 0, 1, 6]);
  assert.deepEqual(out.errors.map((e: { row: number; column: string }) => [e.row, e.column]), [[1, "E-mail"], [1, "Phone"], [1, "Joined"], [1, "VIP"], [1, "Amount"], [1, "Stage"]]);
  assert.match(out.errors[0].message, /not-an-email is not an email/);
});

test("errors shown are capped at 50 and the count is the whole", async () => {
  const h = harness();
  const bad = Array.from({ length: 60 }, (_x, i) => `Person ${i},nope`).join("\n");
  const out = await preview(h, await stage(h, `Name,Email\n${bad}`), { mapping: [{ column: "Name", field: "name" }, { column: "Email", field: "email" }] });
  assert.equal(out.errors.length, 50);
  assert.equal(out.errorCount, 60);
  assert.equal(out.errors[0].row, 1);
  assert.equal(out.creates, 0);
});

test("a required field with no value is an error on its row", async () => {
  const h = harness();
  const out = await preview(h, await stage(h, "Name,Email\n,a@b.co\nAda,ada@b.co\n"), { mapping: [{ column: "Name", field: "name" }, { column: "Email", field: "email" }] });
  assert.deepEqual([out.creates, out.errorCount], [1, 1]);
  assert.deepEqual(out.errors[0], { row: 1, column: "Name", message: "Name is required." });
});

test("rows that match existing records are updates, skips or new records as asked; the same person twice in the file is one create and one update", async () => {
  const h = harness();
  h.world.seed("contact", { name: "Ada", email: "ada@example.com" }, { name: "Grace", email: "grace@example.com" });
  const id = await stage(h, `${CSV}\nAda Again,ada@example.com,,,,,,`);
  const upd = await preview(h, id, { match: ["email"] });
  assert.deepEqual([upd.creates, upd.updates, upd.skips], [1, 3, 0], "Alan is new; Ada, Grace and the second Ada exist");
  const filter = h.only("records.query")[0]!.input.filter;
  assert.deepEqual(filter.or[0], { and: [{ field: "email", op: "eq", value: "ada@example.com" }] });
  const skip = await preview(h, id, { match: ["email"], onMatch: "skip" });
  assert.deepEqual([skip.creates, skip.updates, skip.skips], [1, 0, 3]);
  const make = await preview(h, id, { match: ["email"], onMatch: "create" });
  assert.deepEqual([make.creates, make.updates, make.skips], [4, 0, 0]);
  const none = await preview(h, id);
  assert.deepEqual([none.creates, none.updates], [4, 0], "without a match every row is new");
});

test("a match on a file with nothing existing: the first row of a pair is a create and the second an update", async () => {
  const h = harness();
  const id = await stage(h, "Name,Email\nAda,ada@example.com\nAda B,ada@example.com\nGrace,grace@example.com\n");
  const out = await preview(h, id, { mapping: [{ column: "Name", field: "name" }, { column: "Email", field: "email" }], match: ["email"] });
  assert.deepEqual([out.creates, out.updates], [2, 1]);
});

test("a column with no field is a new field only when asked, and then it is only listed", async () => {
  const h = harness();
  const id = await stage(h, `${header},Favourite colour\n${CSV.split("\n").slice(1).map((r) => `${r},blue`).join("\n")}`);
  const mapping = [...MAPPING, { column: "Favourite colour", field: "favourite_colour" }];
  await refused(preview(h, id, { mapping }), "validation.bad_input");
  const out = await preview(h, id, { mapping, createFields: true });
  assert.deepEqual(out.newFields, [{ key: "favourite_colour", type: "text" }]);
  assert.equal(out.samples[0].favourite_colour, "blue");
  assert.equal(h.only("schema.apply").length, 0);
  assert.equal(h.world.types.get("contact")!.some((f) => f.key === "favourite_colour"), false);
});

test("transforms are applied before a cell is converted", async () => {
  const h = harness();
  const id = await stage(h, "Name,Phone,Tags\nada LOVELACE,(555) 010-0101,x\n");
  const out = await preview(h, id, { mapping: [{ column: "Name", field: "name", transform: "title" }, { column: "Phone", field: "phone", transform: "digits|prefix:+1" }] });
  assert.deepEqual(out.samples[0], { name: "Ada Lovelace", phone: "+15550100101" });
});

test("a mapping that cannot work is refused whole, before any row is read", async () => {
  const h = harness();
  const id = await stage(h);
  const cases: Array<Record<string, unknown>> = [
    { mapping: [] },
    { mapping: [{ column: "Nope", field: "name" }] },
    { mapping: [{ column: "Full Name", field: "Name!" }] },
    { mapping: [{ column: "Full Name", field: "name" }, { column: "Company", field: "name" }] },
    { mapping: [{ column: "Full Name", field: "name" }, { column: "Company", field: "links" }] },
    { mapping: [{ column: "Company", field: "company" }] },
    { mapping: [{ column: "Full Name", field: "name", transform: "shout" }] },
    { mapping: [{ column: "Full Name", field: "name" }], match: ["email"] },
    { mapping: [{ column: "Full Name", field: "name" }], table: "Other" },
  ];
  for (const c of cases) await refused(preview(h, id, c), "validation.bad_input");
  await refused(preview(h, id, { type: "nothing" }), "validation.not_found");
  await refused(preview(h, "imp_none"), "validation.not_found");
});

test("a workbook with several sheets needs the sheet named", async () => {
  const h = harness();
  const file = h.world.file(makeXlsx({ People: [["Name"], ["Ada"], ["Grace"]], Other: [["Name"], ["X"]] }));
  const id = (await run(h, "import.parse_excel", { fileId: file })).importId;
  const mapping = [{ column: "Name", field: "name" }];
  await refused(preview(h, id, { mapping }), "validation.bad_input");
  const out = await preview(h, id, { mapping, table: "People" });
  assert.equal(out.creates, 2);
});

test("the token follows the plan: the same plan gives the same token, a changed one a different token", async () => {
  const h = harness();
  const id = await stage(h);
  const a = await preview(h, id);
  const b = await preview(h, id);
  assert.equal(a.previewToken, b.previewToken);
  const c = await preview(h, id, { mapping: MAPPING.slice(0, 3) });
  assert.notEqual(c.previewToken, a.previewToken);
  const other = await stage(h);
  assert.notEqual((await preview(h, other)).previewToken, a.previewToken, "another import, another token");
});

test("an import that was already written cannot be previewed again", async () => {
  const h = harness();
  const id = await stage(h);
  const p = await preview(h, id);
  await run(h, "import.commit", { importId: id, previewToken: p.previewToken });
  await refused(preview(h, id), "validation.bad_input");
});
