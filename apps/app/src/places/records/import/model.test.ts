// Bring in a spreadsheet: the rules of the sheet. A column goes to one field, a field takes one column, the words say what will happen, and a big file is refused before anything is sent.
import test from "node:test";
import assert from "node:assert/strict";
import { counts, defaultMatch, fileLine, fillable, importLabel, leftOutNotes, looksLikeCsv, mapped, pick, picksFrom, problem, problemLines, problemsLine, progressLine, repeatsLine, skipReason, summary, undoAsk, undoneLine } from "./model.ts";
import { requestImport, takeImportRequest } from "./request.ts";

const cols = [{ name: "Full name", sample: ["Ada Alder"], empty: 0 }, { name: "Email", sample: ["ada@example.test"], empty: 0 }, { name: "Notes", sample: [], empty: 3 }];
const targets = fillable([{ key: "name", title: "Name", type: "text" }, { key: "email", title: "Email", type: "email" }, { key: "company", title: "Company", type: "relation" }]);

test("only fields an import can fill are offered; a relation is not", () => {
  assert.deepEqual(targets.map((t) => t.key), ["name", "email"]);
});

test("the suggestion becomes picks; a column with no field, or a field the type cannot take, stays out", () => {
  const p = picksFrom(cols, [{ column: "Full name", field: "name" }, { column: "Email", field: "email" }, { column: "Notes", field: "company" }], targets);
  assert.deepEqual(p, { "Full name": "name", Email: "email", Notes: "" });
  assert.equal(defaultMatch(p), "email");
  assert.equal(defaultMatch({ "Full name": "name" }), "");
});

test("a field takes one column: choosing it for another column lets the first go", () => {
  const p = picksFrom(cols, [{ column: "Full name", field: "name" }, { column: "Email", field: "email" }], targets);
  const next = pick(p, "Notes", "name");
  assert.deepEqual(next, { "Full name": "", Email: "email", Notes: "name" });
  assert.deepEqual(mapped(next), [{ column: "Email", field: "email" }, { column: "Notes", field: "name" }]);
  assert.deepEqual(pick(next, "Notes", ""), { "Full name": "", Email: "email", Notes: "" });
});

test("the preview adds up: the rows in the file are new, updated, left alone, repeated and problem rows; the button counts what is written", () => {
  const p = { rows: 202, creates: 190, updates: 6, skips: 4, repeats: 1, errorCount: 1, errors: [{ row: 7, column: "Email", message: "not an email address" }] };
  assert.equal(p.creates + p.updates + p.skips + p.repeats + p.errorCount, p.rows);
  assert.equal(fileLine(p), "202 rows in the file.");
  assert.deepEqual(counts(p).map((c) => [c.label, c.value]), [["New", 190], ["Updated", 6], ["Left alone", 4]]);
  assert.equal(skipReason(p, "update"), "Left alone: empty rows, and people already here who would not change.");
  assert.match(skipReason(p, "skip"), /which you chose to leave as they are/);
  assert.equal(skipReason({ ...p, skips: 0 }, "skip"), "");
  assert.equal(repeatsLine(p), "1 row repeats an earlier one in this file; the later row is used.");
  assert.equal(repeatsLine({ ...p, repeats: 3 }), "3 rows repeat an earlier one in this file; the later rows are used.");
  assert.equal(repeatsLine({ ...p, repeats: 0 }), "");
  assert.equal(problemsLine(p), "1 row has a problem and will not be brought in.");
  assert.equal(problemsLine({ ...p, errorCount: 2 }), "2 rows have a problem and will not be brought in.");
  assert.equal(problem(p.errors[0]!), "Row 7, Email: not an email address");
  assert.deepEqual(importLabel(p), { label: "Bring in 196 rows", ok: true });
  assert.deepEqual(importLabel({ ...p, creates: 0, updates: 0 }), { label: "Nothing to bring in", ok: false });
});

test("problem rows are listed with their number and reason, five at most, then how many more", () => {
  const errors = Array.from({ length: 50 }, (_x, i) => ({ row: i + 2, column: "Email", message: "not an email address" }));
  const lines = problemLines({ rows: 900, creates: 800, updates: 0, skips: 0, repeats: 0, errorCount: 100, errors });
  assert.equal(lines.length, 6);
  assert.equal(lines[0], "Row 2, Email: not an email address");
  assert.equal(lines[5], "and 95 more");
  assert.deepEqual(problemLines({ rows: 3, creates: 2, updates: 0, skips: 0, repeats: 0, errorCount: 1, errors: [{ row: 3, message: "bad" }] }), ["Row 3: bad"]);
});

test("a column that looks like a link to another record type says why it is left out", () => {
  const notes = leftOutNotes(cols, [{ column: "Full name", field: "name" }, { column: "Notes", field: "company" }], [{ key: "name", type: "text" }, { key: "company", title: "Company", type: "relation" }, { key: "no", type: "autonumber" }]);
  assert.deepEqual(notes, { Notes: "Links to another record type; not brought in yet" });
  assert.deepEqual(leftOutNotes([{ name: "Company", sample: ["Org 1"], empty: 0 }], [{ column: "Company" }], [{ key: "organization", title: "Company", type: "relation" }]), { Company: "Links to another record type; not brought in yet" }, "found by its name when the server suggested nothing");
  assert.deepEqual(leftOutNotes(cols, [{ column: "Notes", field: "no" }], [{ key: "no", type: "autonumber" }]), { Notes: "Vyre fills this field in; it cannot come from a file" });
});

test("the summary, Undo and the progress line are plain", () => {
  assert.equal(summary({ created: 200, updated: 0, skipped: 0, failed: 0, state: "done" }, "Contacts"), "200 new rows added. They are in contacts.");
  assert.equal(summary({ created: 1, updated: 2, skipped: 3, repeated: 1, failed: 1, state: "done" }, "Contacts"), "1 new row added, 2 rows updated, 3 rows left alone, 1 repeated row left out for a later one, 1 row left out for a problem. They are in contacts.");
  assert.match(summary({ created: 500, updated: 0, skipped: 0, failed: 0, state: "failed" }, "Contacts"), /^The import stopped\. 500 rows were written before it did/);
  assert.equal(undoAsk({ undone: [1, 2, 3], skipped: [1] }), "This removes the rows the import added and puts back the rows it changed: 3 changes. 1 row changed since the import and stays as it is.");
  assert.equal(undoAsk({ undone: [], skipped: [] }), "Nothing can be taken back.");
  assert.equal(undoneLine({ undone: [1, 2], skipped: [1, 2] }), "The import is undone: 2 changes taken back. 2 rows changed since the import and were left as they are.");
  assert.equal(progressLine(1500, 20000, false), "1,500 rows of 20,000 added");
  assert.equal(progressLine(30000, 20000, false), "20,000 rows of 20,000 added", "never past the total");
  assert.equal(progressLine(0, 0, true), "Bringing in your rows");
});

test("a file is a spreadsheet by its name or its text type", () => {
  assert.ok(looksLikeCsv({ name: "people.CSV" }) && looksLikeCsv({ name: "export", mime: "text/csv" }));
  assert.ok(!looksLikeCsv({ name: "people.xlsx", mime: "application/vnd.ms-excel" }));
});

test("a request for the sheet waits for its own table, and a request for any table goes to the first that asks", () => {
  requestImport("contact");
  assert.equal(takeImportRequest("deal"), false, "another type's table leaves it");
  assert.equal(takeImportRequest("contact"), true);
  assert.equal(takeImportRequest("contact"), false, "taken once");
  requestImport();
  assert.equal(takeImportRequest("deal"), true);
});
