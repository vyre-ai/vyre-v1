// Bring in a spreadsheet: the rules of the sheet. A column goes to one field, a field takes one column, the words say what will happen, and a big file is refused before anything is sent.
import test from "node:test";
import assert from "node:assert/strict";
import { counts, defaultMatch, fillable, importLabel, looksLikeCsv, mapped, pick, picksFrom, problem, problemsLine, progressLine, skipReason, summary } from "./model.ts";
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

test("the preview says new, updated and skipped, why rows are skipped, and what will not go in", () => {
  const p = { creates: 190, updates: 6, skips: 4, errorCount: 2, errors: [{ row: 7, column: "Email", message: "not an email address" }] };
  assert.deepEqual(counts(p).map((c) => [c.label, c.value]), [["New", 190], ["Updated", 6], ["Skipped", 4]]);
  assert.equal(skipReason(p, "update"), "Skipped rows are empty.");
  assert.match(skipReason(p, "skip"), /already in Records/);
  assert.equal(skipReason({ ...p, skips: 0 }, "skip"), "");
  assert.equal(problemsLine(p), "2 rows have a problem and will not be brought in.");
  assert.equal(problemsLine({ ...p, errorCount: 1 }), "1 row has a problem and will not be brought in.");
  assert.equal(problem(p.errors[0]!), "Row 7, Email: not an email address");
  assert.deepEqual(importLabel(p), { label: "Bring in 196 rows", ok: true });
  assert.deepEqual(importLabel({ ...p, creates: 0, updates: 0 }), { label: "Nothing to bring in", ok: false });
});

test("the summary and the progress line are plain", () => {
  assert.equal(summary({ created: 200, updated: 0, skipped: 0, failed: 0, state: "done" }, "Contacts"), "200 new rows added. They are in contacts.");
  assert.equal(summary({ created: 1, updated: 2, skipped: 3, failed: 1, state: "done" }, "Contacts"), "1 new row added, 2 rows updated, 3 rows skipped, 1 row left out for a problem. They are in contacts.");
  assert.match(summary({ created: 500, updated: 0, skipped: 0, failed: 0, state: "failed" }, "Contacts"), /^The import stopped\. 500 rows were written before it did/);
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
