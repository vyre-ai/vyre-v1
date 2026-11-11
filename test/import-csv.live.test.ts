// Bring a spreadsheet of contacts in with no AI account (client walk, 11 Nov 2026): the owner stages a CSV, takes the suggested mapping, previews, commits and the people are in Records, where a member sees them.
// Runs on a server-role daemon with the real import, schema and records modules. A second CSV of 20,000 rows is timed.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, invite, join, waitFor } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
let aina: Person;
const first = ["Ada", "Bram", "Cleo", "Dara", "Eli", "Fenn", "Gia", "Hale", "Iris", "Jory"], last = ["Alder", "Birch", "Cedar", "Dunmore", "Elm", "Fairweather", "Grove", "Hawthorn"];
const csv = (n: number): string => ["Full name,Email,Phone,Company,Job title", ...Array.from({ length: n }, (_, i) => `${first[i % 10]} ${last[i % 8]}${i},${first[i % 10]!.toLowerCase()}.${i}@example.test,+1 555 01${String(i % 100).padStart(2, "0")},Org ${i % 25},Role ${i % 7}`)].join("\n");

before(async () => { h = await bootHour("import"); });
after(async () => { await h?.stop(); });

async function run(rows: number, key: string): Promise<{ ms: number; preview: Record<string, unknown>; runId: string; contactType: string; fieldKeys: string[] }> {
  const types = (await h.owner.call("schema.types.list", {})).types as Array<{ key: string; template?: string; title?: string }>;
  const contactType = types.find((t) => t.key === "contact")?.key ?? types.find((t) => /contact/i.test(t.key))!.key;
  const t0 = Date.now();
  const staged = await h.owner.call("import.parse_csv", { text: csv(rows) });
  assert.equal((staged.tables as Array<{ rowCount: number }>)[0]!.rowCount, rows);
  const sug = await h.owner.call("import.suggest_mapping", { importId: staged.importId, type: contactType });
  const mapping = (sug.mapping as Array<{ column: string; field?: string }>).filter((m) => m.field).map((m) => ({ column: m.column, field: m.field! }));
  const preview = await h.owner.call("import.preview", { importId: staged.importId, type: contactType, mapping, match: mapping.some((m) => m.field === "email") ? ["email"] : undefined });
  const started = await h.owner.call("import.commit", { importId: staged.importId, previewToken: preview.previewToken, idempotencyKey: key });
  await waitFor(async () => ((await h.owner.call("import.get", { importId: staged.importId })).import as { state: string }).state === "done" ? true : null, 600_000, "import done");
  return { ms: Date.now() - t0, preview, runId: String(started.runId), contactType, fieldKeys: mapping.map((m) => m.field) };
}

test("200 contacts import with no AI account and a member sees them", async () => {
  const r = await run(200, "imp-200");
  console.log("IMPORT 200 rows", r.ms, "ms", JSON.stringify({ creates: r.preview["creates"], updates: r.preview["updates"], skips: r.preview["skips"], fields: r.fieldKeys }));
  assert.equal(r.preview["creates"], 200);
  aina = h.person("Aina", "aina", "aina@firm.test", "aina horse battery staple 9");
  await join(h, aina, await invite(h, aina.email), { device: "web" });
  const mine = await aina.call("records.query", { type: r.contactType, limit: 500 });
  const total = (mine.total as number | undefined) ?? (mine.rows as unknown[]).length;
  assert.equal(total, 200);
});

test("2,000 contacts (IMPORT_ROWS=20000 for the big one): timed", async () => {
  const r = await run(Number(process.env["IMPORT_ROWS"] ?? 2000), "imp-big");
  console.log("IMPORT big rows", r.ms, "ms", JSON.stringify({ creates: r.preview["creates"], skips: r.preview["skips"], errorCount: r.preview["errorCount"] }));
});

const WATCHED = ["nia", "sam", "olive", "mid", "fay"].map((n) => `${n}@example.test`);
const people = async (who: Person): Promise<Array<{ id: string; fields: Record<string, unknown> }>> => ((await who.call("records.query", { type: "contact", filter: { or: WATCHED.map((e) => ({ field: "email", op: "eq", value: e })) }, limit: 500 })).rows as Array<{ id: string; fields: Record<string, unknown> }>);

test("a file with new, updated, left alone, repeated and problem rows: the preview is what the commit does, the later repeat is used whole, and Undo takes the import back", async () => {
  const mk = async (name: string, email: string) => (await h.owner.call("records.create", { type: "contact", fields: { name, email } })).record.id as string;
  const olive = await mk("Olive", "olive@example.test");
  await mk("Same Sam", "sam@example.test");
  const mid = await mk("Mid Mo", "mid@example.test");
  const text = ["Name,Email,Phone",
    "New Nia,nia@example.test,+1 555 0200",
    "Same Sam,sam@example.test,",
    "Olive Renamed,olive@example.test,",
    "Mid Renamed,mid@example.test,",
    "Bad Bo,not-an-email,",
    "First Fay,fay@example.test,+1 555 0300",
    "Second Fay,fay@example.test,"].join("\n");
  const staged = await h.owner.call("import.parse_csv", { text });
  const mapping = [{ column: "Name", field: "name" }, { column: "Email", field: "email" }, { column: "Phone", field: "phone" }];
  const pv = await h.owner.call("import.preview", { importId: staged.importId, type: "contact", mapping, match: ["email"] });
  assert.deepEqual([pv.rows, pv.creates, pv.updates, pv.skips, pv.repeats, pv.errorCount], [7, 2, 2, 1, 1, 1], "new Nia and Second Fay; Olive and Mid updated; Sam left alone; First Fay repeats; Bad Bo is a problem");
  const run = await h.owner.call("import.commit", { importId: staged.importId, previewToken: pv.previewToken, idempotencyKey: "import-all-kinds" });
  await waitFor(async () => ((await h.owner.call("import.get", { importId: staged.importId })).import as { state: string }).state === "done" ? true : null, 60_000, "done");
  const got = (await h.owner.call("import.get", { importId: staged.importId })).import as Record<string, number>;
  assert.deepEqual([got["created"], got["updated"], got["skipped"], got["repeated"], got["failed"]], [pv.creates, pv.updates, pv.skips, pv.repeats, pv.errorCount], "the commit does what the preview said");
  const now = await people(h.owner);
  const fay = now.find((r) => r.fields["email"] === "fay@example.test")!;
  assert.equal(fay.fields["name"], "Second Fay");
  assert.equal(fay.fields["phone"], undefined, "every field of the kept row is from the later row: the earlier row's phone is not mixed in");
  assert.equal(now.filter((r) => r.fields["email"] === "fay@example.test").length, 1);

  const listed = ((await h.owner.call("runs.list", { scope: "mine", limit: 50 })).runs as Array<{ id: string; name?: string; status?: string }>).find((r) => r.id === String(run.runId));
  assert.deepEqual([listed?.name, listed?.status], ["Import contact", "succeeded"], "the import is a Run in the importer's own list of runs");
  // someone else changes Mid after the import
  await h.owner.call("records.update", { type: "contact", recordId: mid, patch: { name: "Mid by hand" } });
  const undo = await h.owner.call("runs.preview_undo", { runId: String(run.runId) });
  assert.equal((undo.undone as unknown[]).length, 3, "Nia and Second Fay are removed, Olive is put back");
  assert.deepEqual((undo.skipped as Array<{ reason: string; summary: string }>).map((x) => x.reason), ["changed_since"]);
  const done = await h.owner.call("runs.undo", { runId: String(run.runId) });
  assert.equal((done.undone as unknown[]).length, 3);
  const after = await people(h.owner);
  const byEmail = (e: string) => after.find((r) => r.fields["email"] === e);
  assert.equal(byEmail("nia@example.test"), undefined, "rows the import created are gone");
  assert.equal(byEmail("fay@example.test"), undefined);
  assert.equal(after.find((r) => r.id === olive)?.fields["name"], "Olive", "a row it updated is back to its earlier values");
  assert.equal(after.find((r) => r.id === mid)?.fields["name"], "Mid by hand", "a row changed by someone after the import is left alone");
  assert.match(((done.skipped as Array<{ summary: string }>)[0]?.summary) ?? "", /changed after the run/, "and named");
});
