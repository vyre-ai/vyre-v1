// files sheets: CSV, XLSX and Google Sheets as table files (spec 2.16, 2.12). Row-level changes, stable row ids, parallel appends that never lose a row,
// a save from outside between read and write, and a version labelled with the automation and run on every write.
// @reads /modules/files/migrations/0002_files_sheets.sql

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { configureSheets, parseCsv, sheetsHooks, writeCsv } from "../handlers/sheets.ts";
import { open } from "../fixtures/sheets-world.ts";

type Rows = { rowId: string; values: Record<string, unknown> }[];

async function expectCode(code: string, run: () => Promise<unknown>): Promise<VyreErr> {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof VyreErr, e instanceof Error ? e.stack : "throw");
    assert.equal(e.error.code, code, e.error.message);
    return e;
  }
  return assert.fail(`expected ${code}`);
}

async function setup(): Promise<{ ctx: Ctx; events: { name: string; payload: unknown }[]; folderId: string }> {
  const { ctx, events } = open();
  const tree = await handlers["files.tree"](ctx, {});
  const folderId = tree.roots.find((root) => root.key === "personal")?.folderId;
  assert.ok(folderId, "personal folder");
  return { ctx, events, folderId };
}

async function csv(ctx: Ctx, folderId: string, columns: string[] = ["email", "name"], name = "leads"): Promise<string> {
  const made = await handlers["sheets.create"](ctx, { folderId, name, format: "csv", columns });
  return (made.file as { fileId: string }).fileId;
}

async function rowsOf(ctx: Ctx, fileId: string, extra: Record<string, unknown> = {}): Promise<Rows> {
  return (await handlers["sheets.read_rows"](ctx, { fileId, ...extra })).rows;
}

test("sheets.create makes a CSV with a header row and sheets.info lists its columns and key column", async () => {
  const { ctx, folderId } = await setup();
  const fileId = await csv(ctx, folderId, ["id", "name", "plan"]);
  const info = await handlers["sheets.info"](ctx, { fileId });
  assert.deepEqual(info.sheets, [{ name: "leads", rows: 0, columns: ["id", "name", "plan"], keyColumn: "id" }]);
  const file = await handlers["files.get"](ctx, { fileId });
  assert.equal(file.file.name, "leads.csv");
  assert.equal(file.file.kind, "spreadsheet");
  const raw = await handlers["files.read"](ctx, { fileId, as: "text" });
  assert.equal(raw.text, "id,name,plan\n");
});

test("append adds rows and new columns, each row gets its own id, and the event names the run", async () => {
  const { ctx, events, folderId } = await setup();
  const fileId = await csv(ctx, folderId);
  const run = { ...ctx, run: "run_42" };
  const out = await handlers["sheets.append_rows"](run, { fileId, rows: [{ email: "a@x.test", name: "Ana" }, { email: "b@x.test", name: "Bo", phone: "555" }] });
  assert.equal(out.appended, 2);
  assert.equal(out.rowIds.length, 2);
  assert.notEqual(out.rowIds[0], out.rowIds[1]);
  assert.ok(out.versionId);
  const info = await handlers["sheets.info"](ctx, { fileId });
  assert.deepEqual(info.sheets[0]?.columns, ["email", "name", "phone"]);
  assert.equal(info.sheets[0]?.keyColumn, "email");
  const rows = await rowsOf(ctx, fileId);
  assert.deepEqual(rows.map((r) => r.rowId), out.rowIds);
  assert.deepEqual(rows[0]?.values, { email: "a@x.test", name: "Ana", phone: "" });
  assert.deepEqual(rows[1]?.values, { email: "b@x.test", name: "Bo", phone: "555" });
  const appended = events.filter((e) => e.name === "sheet.row_appended");
  assert.equal(appended.length, 2);
  assert.deepEqual(appended[0]?.payload, { fileId, sheet: "leads", rowId: out.rowIds[0], runId: "run_42" });
});

test("every write is a version labelled with the automation and the run", async () => {
  const { ctx, folderId } = await setup();
  const fileId = await csv(ctx, folderId);
  const run = { ...ctx, run: "run_7" };
  await handlers["sheets.append_rows"](run, { fileId, rows: [{ email: "a@x.test" }], label: "Lead intake" });
  await handlers["sheets.append_rows"](run, { fileId, rows: [{ email: "b@x.test" }] });
  await handlers["sheets.append_rows"](ctx, { fileId, rows: [{ email: "c@x.test" }] });
  const versions = (await handlers["files.versions"](ctx, { fileId })).versions;
  const reasons = versions.map((v) => v.reason);
  assert.ok(reasons.includes("Lead intake (run run_7)"), JSON.stringify(reasons));
  assert.ok(reasons.includes("Automation run run_7"), JSON.stringify(reasons));
  assert.ok(reasons.includes("Sheet edit"), JSON.stringify(reasons));
});

test("parallel appends never lose a row", async () => {
  const { ctx, folderId } = await setup();
  const fileId = await csv(ctx, folderId, ["n"]);
  const count = 25;
  const runs = Array.from({ length: count }, (_, i) => handlers["sheets.append_rows"]({ ...ctx, run: `run_${i}` }, { fileId, rows: [{ n: i }, { n: i + 100 }] }));
  const done = await Promise.all(runs);
  const ids = new Set(done.flatMap((d) => d.rowIds));
  assert.equal(ids.size, count * 2, "every appended row has its own id");
  const rows = await rowsOf(ctx, fileId, { limit: 500 });
  assert.equal(rows.length, count * 2);
  const seen = new Set(rows.map((r) => String(r.values.n)));
  for (let i = 0; i < count; i++) {
    assert.ok(seen.has(String(i)) && seen.has(String(i + 100)), `row from run ${i} is there`);
  }
  assert.equal((await handlers["files.versions"](ctx, { fileId })).versions.length, count + 1, "one version per run plus the first");
});

test("parallel updates of different rows both land", async () => {
  const { ctx, folderId } = await setup();
  const fileId = await csv(ctx, folderId);
  const added = await handlers["sheets.append_rows"](ctx, { fileId, rows: [{ email: "a@x.test", name: "A" }, { email: "b@x.test", name: "B" }] });
  const [a, b] = added.rowIds as [string, string];
  await Promise.all([
    handlers["sheets.update_row"](ctx, { fileId, rowId: a, values: { name: "Ann" } }),
    handlers["sheets.update_row"](ctx, { fileId, rowId: b, values: { name: "Bea" } }),
  ]);
  const rows = await rowsOf(ctx, fileId);
  assert.deepEqual(rows.map((r) => r.values.name), ["Ann", "Bea"]);
});

test("a save from outside between the read and the write is not overwritten: the row operation is applied again on the newest version", async () => {
  const { ctx, folderId } = await setup();
  const fileId = await csv(ctx, folderId);
  await handlers["sheets.append_rows"](ctx, { fileId, rows: [{ email: "a@x.test", name: "A" }] });
  let fired = 0;
  sheetsHooks.afterRead = async () => {
    sheetsHooks.afterRead = undefined;
    fired += 1;
    const cur = await handlers["files.read"](ctx, { fileId, as: "text" });
    await handlers["files.write"](ctx, { fileId, content: { text: `${cur.text ?? ""}c@x.test,Outside\n` }, baseVersion: cur.version });
  };
  try {
    await handlers["sheets.append_rows"](ctx, { fileId, rows: [{ email: "b@x.test", name: "B" }] });
  } finally {
    sheetsHooks.afterRead = undefined;
  }
  assert.equal(fired, 1);
  const rows = await rowsOf(ctx, fileId);
  assert.deepEqual(rows.map((r) => r.values.email), ["a@x.test", "c@x.test", "b@x.test"]);
});

test("update by row id and by key column; an unknown or ambiguous key is refused", async () => {
  const { ctx, folderId } = await setup();
  const fileId = await csv(ctx, folderId, ["email", "name", "plan"]);
  const added = await handlers["sheets.append_rows"](ctx, { fileId, rows: [{ email: "a@x.test", name: "A", plan: "free" }, { email: "b@x.test", name: "B", plan: "free" }, { email: "b@x.test", name: "B2", plan: "pro" }] });
  const upd = await handlers["sheets.update_row"](ctx, { fileId, rowId: added.rowIds[0], values: { plan: "pro" } });
  assert.equal(upd.rowId, added.rowIds[0]);
  assert.ok(upd.versionId);
  assert.deepEqual((await rowsOf(ctx, fileId))[0]?.values, { email: "a@x.test", name: "A", plan: "pro" });
  const byKey = await handlers["sheets.update_row"](ctx, { fileId, key: { column: "email", value: "a@x.test" }, values: { name: "Ann" } });
  assert.equal(byKey.rowId, added.rowIds[0]);
  await expectCode("validation.precondition_failed", () => handlers["sheets.update_row"](ctx, { fileId, key: { column: "email", value: "nobody@x.test" }, values: { name: "x" } }));
  await expectCode("validation.precondition_failed", () => handlers["sheets.update_row"](ctx, { fileId, key: { column: "email", value: "b@x.test" }, values: { name: "x" } }));
  await expectCode("validation.precondition_failed", () => handlers["sheets.update_row"](ctx, { fileId, key: { column: "nope", value: "x" }, values: { name: "x" } }));
  await expectCode("validation.bad_input", () => handlers["sheets.update_row"](ctx, { fileId, values: { name: "x" } }));
  const events = (await rowsOf(ctx, fileId)).length;
  assert.equal(events, 3);
});

test("upsert updates the matching row, or appends a new one", async () => {
  const { ctx, events, folderId } = await setup();
  const fileId = await csv(ctx, folderId, ["email", "name"]);
  const first = await handlers["sheets.upsert_row"](ctx, { fileId, match: ["email"], values: { email: "a@x.test", name: "A" } });
  assert.equal(first.created, true);
  const second = await handlers["sheets.upsert_row"](ctx, { fileId, match: ["email"], values: { email: "a@x.test", name: "Ann" } });
  assert.equal(second.created, false);
  assert.equal(second.rowId, first.rowId);
  assert.deepEqual((await rowsOf(ctx, fileId)).map((r) => r.values), [{ email: "a@x.test", name: "Ann" }]);
  assert.equal(events.filter((e) => e.name === "sheet.row_appended").length, 1);
  assert.equal(events.filter((e) => e.name === "sheet.row_updated").length, 1);
  await expectCode("validation.bad_input", () => handlers["sheets.upsert_row"](ctx, { fileId, match: ["phone"], values: { email: "z@x.test" } }));
});

test("deleting a row leaves the ids of the others alone; an id read before an outside save is refused", async () => {
  const { ctx, events, folderId } = await setup();
  const fileId = await csv(ctx, folderId, ["email"]);
  const added = await handlers["sheets.append_rows"](ctx, { fileId, rows: [{ email: "a" }, { email: "b" }, { email: "c" }] });
  const [a, b, c] = added.rowIds as [string, string, string];
  const gone = await handlers["sheets.delete_row"](ctx, { fileId, rowId: b });
  assert.equal(gone.deleted, true);
  const rows = await rowsOf(ctx, fileId);
  assert.deepEqual(rows.map((r) => r.rowId), [a, c]);
  await expectCode("validation.precondition_failed", () => handlers["sheets.delete_row"](ctx, { fileId, rowId: b }));
  assert.deepEqual(events.filter((e) => e.name === "sheet.row_deleted").map((e) => (e.payload as { rowId: string }).rowId), [b]);

  // a save that did not go through the sheet handlers: the ids it never saw are not trusted any more
  const cur = await handlers["files.read"](ctx, { fileId, as: "text" });
  await handlers["files.write"](ctx, { fileId, content: { text: `${cur.text ?? ""}d\n` }, baseVersion: cur.version });
  const after = await rowsOf(ctx, fileId);
  assert.equal(after.length, 3);
  assert.ok(after.every((r) => r.rowId !== a && r.rowId !== c), "fresh ids for the new version");
  await expectCode("validation.precondition_failed", () => handlers["sheets.update_row"](ctx, { fileId, rowId: a, values: { email: "x" } }));
  const fresh = after[0]?.rowId as string;
  await handlers["sheets.update_row"](ctx, { fileId, rowId: fresh, values: { email: "A" } });
  assert.equal((await rowsOf(ctx, fileId))[0]?.values.email, "A");
});

test("read_rows filters by column values, projects columns and pages", async () => {
  const { ctx, folderId } = await setup();
  const fileId = await csv(ctx, folderId, ["name", "age", "city"]);
  await handlers["sheets.append_rows"](ctx, { fileId, rows: [
    { name: "Ana", age: 31, city: "Lahore" }, { name: "Bo", age: 9, city: "Lahore" }, { name: "Cy", age: 45, city: "Kuala Lumpur" }, { name: "Di", age: 52, city: "" },
  ] });
  assert.deepEqual((await rowsOf(ctx, fileId, { where: { city: "Lahore" } })).map((r) => r.values.name), ["Ana", "Bo"]);
  assert.deepEqual((await rowsOf(ctx, fileId, { where: { age: { gt: 30 } } })).map((r) => r.values.name), ["Ana", "Cy", "Di"], "numbers compare as numbers: 9 is not above 30");
  assert.deepEqual((await rowsOf(ctx, fileId, { where: { age: { gte: 31, lt: 50 } } })).map((r) => r.values.name), ["Ana", "Cy"]);
  assert.deepEqual((await rowsOf(ctx, fileId, { where: { city: { contains: "kuala" } } })).map((r) => r.values.name), ["Cy"]);
  assert.deepEqual((await rowsOf(ctx, fileId, { where: { name: ["Bo", "Di"] } })).map((r) => r.values.name), ["Bo", "Di"]);
  assert.deepEqual((await rowsOf(ctx, fileId, { where: { city: { empty: true } } })).map((r) => r.values.name), ["Di"]);
  assert.deepEqual((await rowsOf(ctx, fileId, { where: { nope: "x" } })).length, 0, "a column the sheet lacks never matches");
  assert.deepEqual((await rowsOf(ctx, fileId, { columns: ["name"], limit: 2 })).map((r) => r.values), [{ name: "Ana" }, { name: "Bo" }]);
  const page = await handlers["sheets.read_rows"](ctx, { fileId, limit: 3 });
  assert.equal(page.total, 4);
  assert.equal(page.next, "3");
  const rest = await handlers["sheets.read_rows"](ctx, { fileId, limit: 3, cursor: page.next });
  assert.deepEqual(rest.rows.map((r) => r.values.name), ["Di"]);
  assert.equal(rest.next, undefined);
});

test("CSV quoting round-trips commas, quotes and line breaks", async () => {
  const { ctx, folderId } = await setup();
  const fileId = await csv(ctx, folderId, ["note", "who"]);
  const tricky = 'He said "hi", then\nleft';
  await handlers["sheets.append_rows"](ctx, { fileId, rows: [{ note: tricky, who: " padded " }] });
  assert.equal((await rowsOf(ctx, fileId))[0]?.values.note, tricky);
  assert.equal((await rowsOf(ctx, fileId))[0]?.values.who, " padded ");
  assert.deepEqual(parseCsv(writeCsv(["a", "b"], [[tricky, "x,y"]])), [["a", "b"], [tricky, "x,y"]]);
  assert.deepEqual(parseCsv("﻿a,b\r\n1,2\r\n\r\n3,4"), [["a", "b"], ["1", "2"], ["3", "4"]]);
});

test("a file that is not a table is refused, and so is a deleted one", async () => {
  const { ctx, folderId } = await setup();
  const note = await handlers["files.create"](ctx, { folderId, name: "notes.txt", content: { text: "hello" } });
  await expectCode("validation.unsupported", () => handlers["sheets.info"](ctx, { fileId: note.file.fileId }));
  const fileId = await csv(ctx, folderId);
  await handlers["files.delete"](ctx, { fileId });
  await expectCode("validation.not_found", () => handlers["sheets.append_rows"](ctx, { fileId, rows: [{ email: "a" }] }));
  await expectCode("validation.bad_input", () => handlers["sheets.append_rows"](ctx, { fileId: note.file.fileId, rows: [] }));
  await expectCode("validation.duplicate", () => handlers["sheets.create"](ctx, { folderId, name: "x", format: "csv", columns: ["a", "a"] }));
  await expectCode("validation.unsupported", () => handlers["sheets.add_sheet"](ctx, { fileId: note.file.fileId, sheet: "Two", columns: [] }));
});

test("XLSX: typed values, row operations, a second sheet, and row ids that survive edits to the other sheet", async () => {
  const { ctx, folderId } = await setup();
  const made = await handlers["sheets.create"](ctx, { folderId, name: "book", format: "xlsx", columns: ["sku", "qty"], sheet: "Stock" });
  const fileId = (made.file as { fileId: string }).fileId;
  assert.equal((made.file as { name: string }).name, "book.xlsx");
  const added = await handlers["sheets.append_rows"](ctx, { fileId, rows: [{ sku: "A1", qty: 5 }, { sku: "B2", qty: 7 }, { sku: "C3", qty: 9 }] });
  const rows = await rowsOf(ctx, fileId);
  assert.deepEqual(rows.map((r) => r.values), [{ sku: "A1", qty: 5 }, { sku: "B2", qty: 7 }, { sku: "C3", qty: 9 }], "numbers stay numbers");
  assert.deepEqual(rows.map((r) => r.rowId), added.rowIds);

  await handlers["sheets.add_sheet"](ctx, { fileId, sheet: "Orders", columns: ["order", "sku"] });
  await expectCode("validation.duplicate", () => handlers["sheets.add_sheet"](ctx, { fileId, sheet: "orders", columns: [] }));
  const info = await handlers["sheets.info"](ctx, { fileId });
  assert.deepEqual(info.sheets.map((s) => [s.name, s.rows, s.columns]), [["Stock", 3, ["sku", "qty"]], ["Orders", 0, ["order", "sku"]]]);
  assert.deepEqual((await rowsOf(ctx, fileId)).map((r) => r.rowId), added.rowIds, "the first sheet keeps its ids when a sheet is added");

  const order = await handlers["sheets.append_rows"](ctx, { fileId, sheet: "Orders", rows: [{ order: "o1", sku: "B2" }] });
  assert.deepEqual((await rowsOf(ctx, fileId)).map((r) => r.rowId), added.rowIds, "and when another sheet gets a row");
  await handlers["sheets.update_row"](ctx, { fileId, rowId: added.rowIds[1], values: { qty: 70 } });
  await handlers["sheets.delete_row"](ctx, { fileId, rowId: added.rowIds[0] });
  const left = await rowsOf(ctx, fileId);
  assert.deepEqual(left.map((r) => r.values), [{ sku: "B2", qty: 70 }, { sku: "C3", qty: 9 }]);
  assert.deepEqual(left.map((r) => r.rowId), [added.rowIds[1], added.rowIds[2]]);
  assert.equal((await rowsOf(ctx, fileId, { sheet: "Orders" }))[0]?.rowId, order.rowIds[0]);
  await expectCode("validation.precondition_failed", () => handlers["sheets.read_rows"](ctx, { fileId, sheet: "Missing" }));
  const up = await handlers["sheets.upsert_row"](ctx, { fileId, sheet: "Orders", match: ["order"], values: { order: "o1", sku: "C3" } });
  assert.equal(up.created, false);
});

test("XLSX: parallel appends never lose a row, and dates, formulas and rich text read as plain values", async () => {
  const { ctx, folderId } = await setup();
  const made = await handlers["sheets.create"](ctx, { folderId, name: "log", format: "xlsx", columns: ["n"] });
  const fileId = (made.file as { fileId: string }).fileId;
  await Promise.all(Array.from({ length: 12 }, (_, i) => handlers["sheets.append_rows"]({ ...ctx, run: `run_${i}` }, { fileId, rows: [{ n: i }] })));
  const rows = await rowsOf(ctx, fileId, { limit: 100 });
  assert.deepEqual(rows.map((r) => r.values.n).sort((a, b) => Number(a) - Number(b)), Array.from({ length: 12 }, (_, i) => i));

  const need = createRequire(import.meta.url);
  const { Workbook } = need("exceljs") as { Workbook: new () => { addWorksheet(n: string): { addRow(v: unknown[]): unknown }; xlsx: { writeBuffer(): Promise<ArrayBuffer> } } };
  const wb = new Workbook();
  const ws = wb.addWorksheet("Mixed");
  ws.addRow(["when", "calc", "rich"]);
  ws.addRow([new Date(Date.UTC(2026, 9, 24, 12, 0, 0)), { formula: "1+2", result: 3 }, { richText: [{ text: "Hel" }, { text: "lo" }] }]);
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  const mixed = await handlers["files.create"](ctx, { folderId, name: "mixed.xlsx", content: { base64: bytes.toString("base64") } });
  const got = await rowsOf(ctx, mixed.file.fileId);
  assert.deepEqual(got[0]?.values, { when: "2026-10-24T12:00:00.000Z", calc: 3, rich: "Hello" });
});

test("a Google Sheet is edited through the Sheets API; without a mount that knows the spreadsheet it is refused in plain words", async () => {
  const { ctx, events, folderId } = await setup();
  const native = await handlers["files.create"](ctx, { folderId, name: "Budget", content: { text: "snapshot" }, mime: "application/vnd.google-apps.spreadsheet", kind: "google_native" });
  const fileId = native.file.fileId;
  configureSheets(null);
  await expectCode("validation.unsupported", () => handlers["sheets.append_rows"](ctx, { fileId, rows: [{ a: 1 }] }));

  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  let table: string[][] = [["email", "name"], ["a@x.test", "Ana"]];
  const wired: Ctx = {
    ...ctx,
    run: "run_g",
    call: async (cap: string, input: unknown) => {
      const i = input as Record<string, unknown>;
      calls.push({ cap, input: i });
      if (cap === "google.sheets.get_spreadsheet") return { title: "Budget", sheets: [{ sheetId: 7, title: "Q4" }] };
      if (cap === "google.sheets.get_values") return { values: table.map((r) => [...r]) };
      if (cap === "google.sheets.append_values") { table = [...table, ...(i.values as string[][])]; return { updatedRows: (i.values as string[][]).length }; }
      if (cap === "google.sheets.update_values") return { updatedCells: 1 };
      if (cap === "google.sheets.batch_update") return { applied: 1 };
      throw new Error(`unexpected ${cap}`);
    },
  };
  configureSheets({ googleSpreadsheetId: () => "sheet_abc" });
  try {
    const info = await handlers["sheets.info"](wired, { fileId });
    assert.deepEqual(info.sheets, [{ name: "Q4", rows: 1, columns: ["email", "name"], keyColumn: "email" }]);
    const rows = await handlers["sheets.read_rows"](wired, { fileId, where: { name: "Ana" } });
    assert.deepEqual(rows.rows, [{ rowId: "g2", values: { email: "a@x.test", name: "Ana" } }]);

    const added = await handlers["sheets.append_rows"](wired, { fileId, rows: [{ email: "b@x.test", name: "Bo", plan: "pro" }] });
    assert.deepEqual(added.rowIds, ["g3"]);
    const header = calls.find((c) => c.cap === "google.sheets.update_values");
    assert.deepEqual(header?.input.values, [["email", "name", "plan"]], "a new column extends the header first");
    const append = calls.find((c) => c.cap === "google.sheets.append_values");
    assert.deepEqual(append?.input.values, [["b@x.test", "Bo", "pro"]]);
    assert.deepEqual(events.find((e) => e.name === "sheet.row_appended")?.payload, { fileId, sheet: "Q4", rowId: "g3", runId: "run_g" });

    const upd = await handlers["sheets.update_row"](wired, { fileId, rowId: "g2", values: { name: "Ann" } });
    assert.equal(upd.rowId, "g2");
    const write = calls.filter((c) => c.cap === "google.sheets.update_values").at(-1);
    assert.equal(write?.input.range, "'Q4'!A2:B2");
    assert.deepEqual(write?.input.values, [["a@x.test", "Ann"]]);
    await expectCode("validation.precondition_failed", () => handlers["sheets.update_row"](wired, { fileId, rowId: "g99", values: { name: "x" } }));

    const del = await handlers["sheets.delete_row"](wired, { fileId, rowId: "g2" });
    assert.equal(del.deleted, true);
    const batch = calls.filter((c) => c.cap === "google.sheets.batch_update").at(-1);
    assert.deepEqual(batch?.input.requests, [{ deleteDimension: { range: { sheetId: 7, dimension: "ROWS", startIndex: 1, endIndex: 2 } } }]);
  } finally {
    configureSheets(null);
  }
});
