// Import: the sources and the mapping (spec 2.9, 2.10). CSV, Excel, Airtable, Notion and Google Sheets are read into a staged import that expires after a day and changes nothing; the mapping
// suggests which column feeds which field; cells become field values.
import test from "node:test";
import assert from "node:assert/strict";
import { CONTACT, HOUR, NOW, codeOf, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { CSV, makeXlsx, makeZip, run, stage } from "../fixtures/seed.ts";
import { compileTransform, convert, inferType, parseCsvText, parseDate, parseNumber, readXlsx, setHost, suggest, unzip } from "../impl.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); return true; });
}
const cols = (out: { tables: Array<{ columns: Array<{ name: string; inferred: string }> }> }, t = 0): Array<[string, string]> => out.tables[t]!.columns.map((c) => [c.name, c.inferred]);

// ---- CSV ----

test("a CSV is staged with its columns and what they look like, and nothing else changes", async () => {
  const h = harness();
  const out = await run(h, "import.parse_csv", { text: CSV });
  assert.match(out.importId, /^imp_[a-z0-9]+$/);
  assert.equal(out.source, "csv");
  assert.equal(out.expiresAt, NOW + 24 * HOUR);
  assert.equal(out.tables.length, 1);
  assert.equal(out.tables[0].rowCount, 3);
  assert.deepEqual(cols(out), [["Full Name", "text"], ["E-mail", "email"], ["Phone", "phone"], ["Company", "text"], ["Joined", "datetime"], ["VIP", "checkbox"], ["Amount", "number"], ["Stage", "text"]]);
  const amount = out.tables[0].columns[6];
  assert.deepEqual([amount.distinct, amount.empty, amount.sample], [3, 0, ["1,200.50", "300", "15"]]);
  assert.equal(out.tables[0].columns[5].empty, 1, "one VIP cell is blank");
  assert.deepEqual(h.emitted, []);
  assert.equal(h.world.store.size, 0);
  assert.equal(h.only("records.bulk_upsert").length + h.only("schema.apply").length, 0);
});

test("quotes, doubled quotes, a newline inside a cell, any line ending and a byte order mark are read", () => {
  assert.deepEqual(parseCsvText('﻿a,b\r\n"x, y","say ""hi"""\r\n"two\nlines",z\r\n', ","), [["a", "b"], ["x, y", 'say "hi"'], ["two\nlines", "z"]]);
  assert.deepEqual(parseCsvText("a,b\rc,d\n\ne,f", ","), [["a", "b"], ["c", "d"], ["e", "f"]], "old Mac and Unix endings, a blank line");
  assert.deepEqual(parseCsvText("a,,c\n,,\n", ","), [["a", "", "c"], ["", "", ""]]);
});

test("the delimiter is found: semicolons, tabs and pipes; a header can be absent; names are made unique; short rows are padded", async () => {
  const h = harness();
  const semi = await run(h, "import.parse_csv", { text: "a;b;c\n1;2;3\n" });
  assert.deepEqual(cols(semi).map((c) => c[0]), ["a", "b", "c"]);
  const tab = await run(h, "import.parse_csv", { text: "x\ty\n1\t2\n" });
  assert.deepEqual(cols(tab).map((c) => c[0]), ["x", "y"]);
  const pipe = await run(h, "import.parse_csv", { text: "x|y\n1|2\n" });
  assert.deepEqual(cols(pipe).map((c) => c[0]), ["x", "y"]);
  const given = await run(h, "import.parse_csv", { text: "a,b\n1,2\n", delimiter: "," });
  assert.equal(given.tables[0].rowCount, 1);
  const none = await run(h, "import.parse_csv", { text: "Ada,1\nGrace,2\n", hasHeader: false });
  assert.deepEqual(cols(none), [["Column 1", "text"], ["Column 2", "number"]]);
  assert.equal(none.tables[0].rowCount, 2);
  const dup = await run(h, "import.parse_csv", { text: "name,name,\nA,B,C\nD\n" });
  assert.deepEqual(cols(dup).map((c) => c[0]), ["name", "name 2", "Column 3"]);
  assert.equal(dup.tables[0].rowCount, 2, "the short row is padded");
});

test("a CSV can come from a file; it takes a file or text, not both, and not nothing; an empty one is refused", async () => {
  const h = harness();
  const id = h.world.file(CSV);
  assert.equal((await run(h, "import.parse_csv", { fileId: id })).tables[0].rowCount, 3);
  await refused(run(h, "import.parse_csv", { fileId: id, text: CSV }), "validation.bad_input");
  await refused(run(h, "import.parse_csv", {}), "validation.bad_input");
  await refused(run(h, "import.parse_csv", { text: "" }), "validation.bad_input");
  await refused(run(h, "import.parse_csv", { text: "\n\n" }), "validation.bad_input");
  await refused(run(h, "import.parse_csv", { fileId: "fil_nothere" }), "validation.bad_input");
});

test("an import over the row limit is refused before anything is staged", async () => {
  const h = harness();
  const big = `n\n${Array.from({ length: 100_001 }, (_x, i) => i).join("\n")}`;
  await refused(run(h, "import.parse_csv", { text: big }), "validation.bad_input");
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM imports_session")[0]?.["n"], 0);
});

// ---- Excel ----

test("an .xlsx is read sheet by sheet: shared and inline strings, numbers, dates by their format, empty cells", async () => {
  const h = harness();
  const file = h.world.file(makeXlsx({
    People: [["Name", "Joined", "Seen", "Count", "Note"], ["Ada & Co", { date: 46027 }, { date: 46027.5 }, 3, { inline: "hi <there>" }], ["Grace", { date: 46028 }, null, 12.5, "x"]],
    Other: [["A"], ["1"]],
  }));
  const out = await run(h, "import.parse_excel", { fileId: file });
  assert.equal(out.source, "excel");
  assert.deepEqual(out.tables.map((t: { name: string; rowCount: number }) => [t.name, t.rowCount]), [["People", 2], ["Other", 1]]);
  assert.deepEqual(cols(out), [["Name", "text"], ["Joined", "datetime"], ["Seen", "datetime"], ["Count", "number"], ["Note", "text"]]);
  const sample = (c: number): string[] => out.tables[0].columns[c].sample;
  assert.deepEqual(sample(0), ["Ada & Co", "Grace"]);
  assert.deepEqual(sample(1), ["2026-01-05", "2026-01-06"]);
  assert.deepEqual(sample(2), ["2026-01-05T12:00:00Z"]);
  assert.deepEqual(sample(3), ["3", "12.5"]);
  assert.deepEqual(sample(4), ["hi <there>", "x"]);
  assert.equal(out.tables[0].columns[2].empty, 1);
  const only = await run(h, "import.parse_excel", { fileId: file, sheets: ["Other"] });
  assert.deepEqual(only.tables.map((t: { name: string }) => t.name), ["Other"]);
});

test("an Excel file that is not one, a sheet that is not there, a missing file: each is refused with a reason", async () => {
  const h = harness();
  const file = h.world.file(makeXlsx({ A: [["x"], ["1"]] }));
  await refused(run(h, "import.parse_excel", { fileId: file, sheets: ["Nope"] }), "validation.bad_input");
  await refused(run(h, "import.parse_excel", { fileId: h.world.file("just text") }), "validation.bad_input");
  await refused(run(h, "import.parse_excel", { fileId: h.world.file(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4])) }), "validation.bad_input");
  await refused(run(h, "import.parse_excel", { fileId: "fil_none" }), "validation.not_found");
  await assert.rejects(run(h, "import.parse_excel", { fileId: h.world.file(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4])) }), /xlsx/);
});

test("the zip reader reads stored and deflated entries and skips what it cannot", () => {
  const z = unzip(makeZip({ "a.txt": "stored text", "b/c.txt": "deflated text ".repeat(20) }));
  assert.equal(new TextDecoder().decode(z.get("a.txt")), "stored text");
  assert.equal(new TextDecoder().decode(z.get("b/c.txt")), "deflated text ".repeat(20));
  assert.throws(() => unzip(new Uint8Array([1, 2, 3])), /zip/);
  assert.equal(readXlsx(makeXlsx({ S: [["a"], ["b"]] }))[0]?.rows.length, 2);
});

// ---- Airtable ----

const BASE = "https://airtable.com/appABCDEFGH123";
const TOKEN = "vit_airkey";
function airtableWorld(h: Harness): void {
  h.world.secrets.set(TOKEN, "pat-secret");
  h.world.routes.push(
    { match: (u) => u.includes("/meta/bases/appABCDEFGH123/tables"), answer: () => ({ status: 200, json: { tables: [
      { id: "tblAAAAAAAA01", name: "Leads", fields: [{ name: "Name" }, { name: "Tags" }, { name: "Owner" }, { name: "Done" }] },
      { id: "tblBBBBBBBB02", name: "Notes", fields: [{ name: "Text" }] },
    ] } }) },
    { match: (u) => u.includes("/v0/appABCDEFGH123/tblAAAAAAAA01") && !u.includes("offset="), answer: () => ({ status: 200, json: { records: [{ fields: { Name: "Ada", Tags: ["a", "b"], Owner: { name: "Maya", email: "m@x.com" }, Done: true } }], offset: "next1" } }) },
    { match: (u) => u.includes("/v0/appABCDEFGH123/tblAAAAAAAA01") && u.includes("offset=next1"), answer: () => ({ status: 200, json: { records: [{ fields: { Name: "Grace" } }] } }) },
    { match: (u) => u.includes("/v0/appABCDEFGH123/tblBBBBBBBB02"), answer: () => ({ status: 200, json: { records: [{ fields: { Text: "hello" } }] } }) },
  );
}

test("an Airtable base is read table by table with the key from the Vault, pages followed, values flattened to text", async () => {
  const h = harness();
  airtableWorld(h);
  const out = await run(h, "import.parse_airtable", { baseUrl: BASE, key: TOKEN });
  assert.equal(out.source, "airtable");
  assert.deepEqual(out.tables.map((t: { name: string; rowCount: number }) => [t.name, t.rowCount]), [["Leads", 2], ["Notes", 1]]);
  assert.deepEqual(out.tables[0].columns.map((c: { name: string; sample: string[] }) => [c.name, c.sample]), [["Name", ["Ada", "Grace"]], ["Tags", ["a, b"]], ["Owner", ["Maya"]], ["Done", ["TRUE"]]]);
  assert.ok(h.world.http.every((r) => r.headers["authorization"] === "Bearer pat-secret"), "the key goes in the header");
  const only = await run(h, "import.parse_airtable", { baseUrl: BASE, key: TOKEN, tables: ["Notes"] });
  assert.deepEqual(only.tables.map((t: { name: string }) => t.name), ["Notes"]);
  const byUrl = await run(h, "import.parse_airtable", { baseUrl: `${BASE}/tblBBBBBBBB02/viw123`, key: TOKEN });
  assert.deepEqual(byUrl.tables.map((t: { name: string }) => t.name), ["Notes"]);
});

test("Airtable answers: a refused key, a base that is not there, a busy service, an address that is not Airtable's, no key setup", async () => {
  const h = harness();
  h.world.secrets.set(TOKEN, "pat-secret");
  const answer = (status: number): void => { h.world.routes.length = 0; h.world.routes.push({ match: () => true, answer: () => ({ status }) }); };
  answer(401); await refused(run(h, "import.parse_airtable", { baseUrl: BASE, key: TOKEN }), "provider.auth_failed");
  answer(403); await refused(run(h, "import.parse_airtable", { baseUrl: BASE, key: TOKEN }), "provider.auth_failed");
  answer(404); await refused(run(h, "import.parse_airtable", { baseUrl: BASE, key: TOKEN }), "validation.bad_input");
  answer(429); await refused(run(h, "import.parse_airtable", { baseUrl: BASE, key: TOKEN }), "provider.unavailable");
  answer(503); await refused(run(h, "import.parse_airtable", { baseUrl: BASE, key: TOKEN }), "provider.unavailable");
  await refused(run(h, "import.parse_airtable", { baseUrl: "https://example.com/nope", key: TOKEN }), "validation.bad_input");
  h.world.routes.length = 0;
  airtableWorld(h);
  await refused(run(h, "import.parse_airtable", { baseUrl: BASE, key: TOKEN, tables: ["Missing"] }), "validation.bad_input");
  setHost(undefined);
  await refused(run(h, "import.parse_airtable", { baseUrl: BASE, key: TOKEN }), "provider.unavailable");
});

// ---- Notion ----

const DB_URL = "https://www.notion.so/Clients-0123456789abcdef0123456789abcdef";
const DB_ID = "01234567-89ab-cdef-0123-456789abcdef";
function notionWorld(h: Harness): void {
  h.world.secrets.set("vit_notion", "secret-notion");
  h.world.routes.push(
    { match: (u, m) => m === "GET" && u.endsWith(`/v1/databases/${DB_ID}`), answer: () => ({ status: 200, json: { title: [{ plain_text: "Clients" }], properties: { Tags: { type: "multi_select" }, Name: { type: "title" }, Due: { type: "date" }, Status: { type: "status" }, Done: { type: "checkbox" } } } }) },
    { match: (u, m) => m === "POST" && u.endsWith(`/v1/databases/${DB_ID}/query`), answer: (_u, body) => (body?.includes("start_cursor")
      ? { status: 200, json: { results: [{ properties: { Name: { type: "title", title: [{ plain_text: "Grace" }] } } }], has_more: false } }
      : { status: 200, json: { results: [{ properties: {
        Name: { type: "title", title: [{ plain_text: "Ada" }, { plain_text: " L." }] }, Tags: { type: "multi_select", multi_select: [{ name: "x" }, { name: "y" }] }, Due: { type: "date", date: { start: "2026-02-01" } },
        Status: { type: "status", status: { name: "Open" } }, Done: { type: "checkbox", checkbox: false } } }], has_more: true, next_cursor: "c1" } }) },
  );
}

test("a Notion database is read with the title column first, the rest by name, pages followed, values as text", async () => {
  const h = harness();
  notionWorld(h);
  const out = await run(h, "import.parse_notion", { url: DB_URL, key: "vit_notion" });
  assert.equal(out.source, "notion");
  assert.equal(out.tables[0].name, "Clients");
  assert.equal(out.tables[0].rowCount, 2);
  assert.deepEqual(out.tables[0].columns.map((c: { name: string }) => c.name), ["Name", "Done", "Due", "Status", "Tags"]);
  assert.deepEqual(out.tables[0].columns[0].sample, ["Ada L.", "Grace"]);
  assert.deepEqual(out.tables[0].columns.slice(1).map((c: { sample: string[] }) => c.sample), [["FALSE"], ["2026-02-01"], ["Open"], ["x, y"]]);
  assert.equal(h.world.http.find((r) => r.method === "GET")?.headers["notion-version"], "2022-06-28");
});

test("a Notion export file is read: a zip of CSV files, or one CSV; the address and the file are not both given", async () => {
  const h = harness();
  const zip = h.world.file(makeZip({ "Export/Clients abcdef0123456789abcdef0123456789.csv": "Name,City\nAda,London\n", "Export/readme.md": "x", "Export/Orders_all 0123456789abcdef0123456789abcdef.csv": "Id\n1\n2\n" }));
  const out = await run(h, "import.parse_notion", { exportFileId: zip });
  assert.deepEqual(out.tables.map((t: { name: string; rowCount: number }) => [t.name, t.rowCount]), [["Clients", 1], ["Orders", 2]]);
  const csv = await run(h, "import.parse_notion", { exportFileId: h.world.file("Name\nAda\n") });
  assert.deepEqual(csv.tables.map((t: { name: string }) => t.name), ["Notion"]);
  await refused(run(h, "import.parse_notion", { url: DB_URL, key: "vit_notion", exportFileId: zip }), "validation.bad_input");
  await refused(run(h, "import.parse_notion", {}), "validation.bad_input");
  await refused(run(h, "import.parse_notion", { url: DB_URL }), "validation.bad_input");
  await refused(run(h, "import.parse_notion", { url: "https://www.notion.so/not-a-database", key: "vit_notion" }), "validation.bad_input");
  await refused(run(h, "import.parse_notion", { exportFileId: h.world.file(makeZip({ "readme.md": "no csv here" })) }), "validation.bad_input");
});

test("Notion answers: a refused key is provider.auth_failed", async () => {
  const h = harness();
  h.world.secrets.set("vit_notion", "bad");
  h.world.routes.push({ match: () => true, answer: () => ({ status: 401 }) });
  await refused(run(h, "import.parse_notion", { url: DB_URL, key: "vit_notion" }), "provider.auth_failed");
});

// ---- Google Sheets ----

test("a Google Sheet is read tab by tab through the google module", async () => {
  const h = harness();
  h.world.sheets.set("abc123", { sheets: [{ title: "Leads", values: [["Name", "Email"], ["Ada", "ada@x.com"]] }, { title: "O'Brien", values: [["A"], ["1"]] }] });
  const url = "https://docs.google.com/spreadsheets/d/abc123/edit#gid=0";
  const out = await run(h, "import.parse_google_sheets", { url });
  assert.equal(out.source, "google_sheets");
  assert.deepEqual(out.tables.map((t: { name: string; rowCount: number }) => [t.name, t.rowCount]), [["Leads", 1], ["O'Brien", 1]]);
  assert.deepEqual(h.only("google.sheets.get_values").map((c) => c.input.range), ["'Leads'", "'O''Brien'"]);
  const one = await run(h, "import.parse_google_sheets", { url, tabs: ["Leads"] });
  assert.equal(one.tables.length, 1);
  await refused(run(h, "import.parse_google_sheets", { url, tabs: ["Nope"] }), "validation.bad_input");
  await refused(run(h, "import.parse_google_sheets", { url: "https://example.com/x" }), "validation.bad_input");
  await refused(run(h, "import.parse_google_sheets", { url: "https://docs.google.com/spreadsheets/d/other/edit" }), "provider.auth_failed");
});

// ---- staging ----

test("a staged import expires after 24 hours", async () => {
  const h = harness();
  const id = await stage(h);
  h.advance(24 * HOUR);
  await refused(run(h, "import.suggest_mapping", { importId: id, type: "contact" }), "validation.not_found");
  await refused(run(h, "import.preview", { importId: id, type: "contact", mapping: [{ column: "Full Name", field: "name" }] }), "validation.not_found");
});

// ---- suggestions ----

test("suggest_mapping offers a field for each column with a confidence, and new fields for the rest", async () => {
  const h = harness();
  const id = await stage(h, `${CSV.split("\n")[0]},Favourite colour\n${CSV.split("\n").slice(1).map((r) => `${r},blue`).join("\n")}`);
  const out = await run(h, "import.suggest_mapping", { importId: id, type: "contact" });
  const byCol = Object.fromEntries(out.mapping.map((m: { column: string; field?: string; confidence: number }) => [m.column, [m.field, m.confidence]]));
  assert.deepEqual(byCol["Full Name"], ["name", 0.9]);
  assert.deepEqual(byCol["E-mail"], ["email", 1]);
  assert.deepEqual(byCol["VIP"], ["vip", 1]);
  assert.deepEqual(byCol["Stage"], ["stage", 1]);
  assert.deepEqual(byCol["Favourite colour"], [undefined, 0]);
  assert.deepEqual(out.unmapped, ["Favourite colour"]);
  assert.deepEqual(out.newFields, [{ column: "Favourite colour", key: "favourite_colour", type: "text" }]);
  await refused(run(h, "import.suggest_mapping", { importId: id, type: "nothing" }), "validation.not_found");
  await refused(run(h, "import.suggest_mapping", { importId: "imp_none", type: "contact" }), "validation.not_found");
});

test("a field goes to the column with the strongest claim; fields that cannot be imported are never offered", () => {
  const picks = suggest(["E-mail address", "Email", "Linked"], [{ key: "email", type: "email", title: "Email" }, { key: "links", type: "relation", title: "Linked" }]);
  assert.deepEqual(picks, [{ column: "E-mail address", confidence: 0 }, { column: "Email", field: "email", confidence: 1 }, { column: "Linked", confidence: 0 }]);
  const second = suggest(["Phone number", "Mobile"], [{ key: "phone", type: "phone", title: "Phone" }]);
  assert.deepEqual(second.map((p) => [p.field, p.confidence]), [["phone", 0.9], [undefined, 0]], "the first of two equal claims keeps it");
});

// ---- cells ----

test("dates are read in the forms people write them, and a day that does not exist is not a date", () => {
  const d = (y: number, m: number, day: number, h = 0, mi = 0): number => Date.UTC(y, m - 1, day, h, mi);
  assert.equal(parseDate("2026-01-05"), d(2026, 1, 5));
  assert.equal(parseDate("2026-01-05T10:30:00Z"), d(2026, 1, 5, 10, 30));
  assert.equal(parseDate("2026-01-05T10:30:00+02:00"), d(2026, 1, 5, 8, 30));
  assert.equal(parseDate("1/6/2026"), d(2026, 1, 6));
  assert.equal(parseDate("13/6/2026"), d(2026, 6, 13), "first number over 12: day first");
  assert.equal(parseDate("1/6/26"), d(2026, 1, 6));
  assert.equal(parseDate("1/6/2026 3:15 pm"), d(2026, 1, 6, 15, 15));
  assert.equal(parseDate("7 Jan 2026"), d(2026, 1, 7));
  assert.equal(parseDate("Jan 7, 2026"), d(2026, 1, 7));
  for (const bad of ["2026-02-30", "31/02/2026", "13/13/2026", "hello", "2026", "5 Foo 2026", ""]) assert.equal(parseDate(bad), undefined, bad);
});

test("numbers are read with thousands separators, currency signs, brackets and percents", () => {
  assert.equal(parseNumber("1,200.50"), 1200.5);
  assert.equal(parseNumber("$40"), 40);
  assert.equal(parseNumber("(12)"), -12);
  assert.equal(parseNumber("-3.5"), -3.5);
  assert.equal(parseNumber("15%"), 15);
  assert.equal(parseNumber(".5"), 0.5);
  for (const bad of ["abc", "1,2", "12abc", "", "1.2.3"]) assert.equal(parseNumber(bad), undefined, bad);
});

test("a column is typed by what is in it: ids with leading zeros stay text, a few repeated values are a choice", () => {
  assert.equal(inferType(["02134", "10001"]), "text");
  assert.equal(inferType(["12", "40.5"]), "number");
  assert.equal(inferType(["a@b.co", "c@d.org"]), "email");
  assert.equal(inferType(["https://a.co", "http://b.org/x"]), "url");
  assert.equal(inferType(["yes", "NO", "true"]), "checkbox");
  assert.equal(inferType(["+44 20 7946 0958", "(020) 7946 0958"]), "phone");
  assert.equal(inferType(["2026-01-05", "1/6/2026"]), "datetime");
  assert.equal(inferType(["x\ny"]), "longtext");
  assert.equal(inferType(["a".repeat(250)]), "longtext");
  assert.equal(inferType([]), "text");
  assert.equal(inferType(["", ""]), "text");
  const many = Array.from({ length: 12 }, (_x, i) => (i % 2 === 0 ? "Open" : "Closed"));
  assert.equal(inferType(many), "choice");
  assert.equal(inferType(["Open", "Closed", "Open"]), "text", "too few rows to call it a choice");
});

test("transforms are a pipe of named steps and a bad one is refused before a row is read", () => {
  const run1 = (text: string, v: string): string | string[] => { const c = compileTransform(text); if (!c.ok) throw new Error(c.message); return c.run(v); };
  assert.equal(run1("trim|lower", "  ADA  "), "ada");
  assert.equal(run1("title", "ada LOVELACE-smith o'neil"), "Ada Lovelace-Smith O'Neil");
  assert.equal(run1("digits", "(555) 010-0102"), "5550100102");
  assert.deepEqual(run1("split:;", "a; b;; c"), ["a", "b", "c"]);
  assert.equal(run1("default:n/a", "  "), "n/a");
  assert.equal(run1("default:n/a", "x"), "x");
  assert.equal(run1("prefix:+1", "5550100"), "+15550100");
  assert.equal(run1("prefix:+1", ""), "", "an empty cell stays empty");
  assert.equal(run1("suffix: Ltd", "Acme"), "Acme Ltd");
  assert.equal(run1("replace:-=>", "a-b-c"), "abc");
  assert.equal(run1("upper", "x"), "X");
  for (const bad of ["", "shout", "split", "replace:abc", "trim|nope"]) assert.equal(compileTransform(bad).ok, false, bad);
});

test("a cell becomes the value of its field, or the reason it cannot; empty cells give no value", () => {
  const f = (type: string, extra: { options?: Record<string, unknown> } = {}) => ({ key: "k", type, ...extra });
  assert.deepEqual(convert(f("text"), "  hi "), { ok: true, value: "hi" });
  assert.deepEqual(convert(f("number"), "1,200"), { ok: true, value: 1200 });
  assert.deepEqual(convert(f("rating"), "4"), { ok: true, value: 4 });
  assert.equal(convert(f("rating"), "11").ok, false);
  assert.deepEqual(convert(f("duration"), "90"), { ok: true, value: 90 });
  assert.equal(convert(f("duration"), "-5").ok, false);
  assert.deepEqual(convert(f("money"), "$1,200.50"), { ok: true, value: { amount: 120050, currency: "USD" } });
  assert.deepEqual(convert(f("money"), "EUR 40"), { ok: true, value: { amount: 4000, currency: "EUR" } });
  assert.deepEqual(convert(f("datetime"), "2026-01-05"), { ok: true, value: Date.UTC(2026, 0, 5) });
  assert.deepEqual(convert(f("checkbox"), "Yes"), { ok: true, value: true });
  assert.deepEqual(convert(f("checkbox"), "0"), { ok: true, value: false });
  assert.deepEqual(convert(f("email"), " ADA@Example.com "), { ok: true, value: "ada@example.com" });
  assert.deepEqual(convert(f("phone"), "+1 (555) 010-0101"), { ok: true, value: "+15550100101" });
  assert.deepEqual(convert(f("url"), "example.com/a"), { ok: true, value: "https://example.com/a" });
  const choices = f("choice", { options: { choices: [{ key: "lead", title: "Lead" }, { key: "client", title: "Client" }] } });
  assert.deepEqual(convert(choices, "client"), { ok: true, value: "client" });
  assert.deepEqual(convert(choices, " LEAD "), { ok: true, value: "lead" });
  assert.equal(convert(choices, "partner").ok, false);
  assert.deepEqual(convert(f("choice"), "anything"), { ok: true, value: "anything" }, "no list of choices: any text");
  const tags = f("multichoice", { options: { choices: [{ key: "a", title: "Alpha" }, { key: "b", title: "Beta" }] } });
  assert.deepEqual(convert(tags, "Alpha; beta"), { ok: true, value: ["a", "b"] });
  assert.deepEqual(convert(tags, ["Alpha", "b"]), { ok: true, value: ["a", "b"] });
  assert.equal(convert(tags, "Alpha, Gamma").ok, false);
  assert.deepEqual(convert(f("text"), "   "), { ok: true, empty: true });
  assert.deepEqual(convert(f("number"), []), { ok: true, empty: true });
  for (const [type, cell] of [["number", "abc"], ["datetime", "soon"], ["checkbox", "maybe"], ["email", "nope"], ["phone", "12"], ["url", "not a url"], ["relation", "x"], ["formula", "x"]] as const) assert.equal(convert(f(type), cell).ok, false, type);
  assert.equal(CONTACT.length, 9);
});
