// Import: commit (spec 2.9 Lifecycle, 2.10). The previewed rows are written through records.bulk_upsert as an import Run, in batches. No automation fires unless the importer ticked run
// automations. The same key writes nothing twice. A failure keeps what was written and says why; a stopped Run ends the import.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness, reasonOf } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { CSV, MAPPING, key, run, stage } from "../fixtures/seed.ts";

async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); if (reason) assert.equal(reasonOf(e), reason); return true; });
}
const MAP2 = [{ column: "Name", field: "name" }, { column: "Email", field: "email" }];
const people = (n: number): string => `Name,Email\n${Array.from({ length: n }, (_x, i) => `Person ${i},p${i}@example.com`).join("\n")}\n`;
async function ready(h: Harness, text: string = CSV, over: Record<string, unknown> = {}, mapping: unknown = text === CSV ? MAPPING : MAP2): Promise<{ importId: string; previewToken: string }> {
  const importId = await stage(h, text);
  const p = await run(h, "import.preview", { importId, type: "contact", mapping, ...over });
  return { importId, previewToken: p.previewToken };
}
const state = (h: Harness, id: string): Record<string, unknown> => h.rows("SELECT * FROM import_session WHERE importId = ?", id)[0] as Record<string, unknown>;

test("commit writes the previewed rows as an import Run and says what it did", async () => {
  const h = harness();
  const { importId, previewToken } = await ready(h);
  h.clear();
  const out = await run(h, "import.commit", { importId, previewToken });
  assert.deepEqual(Object.keys(out).sort(), ["importId", "runId"]);
  assert.equal(out.importId, importId);
  const start = h.only("runs.start")[0]!;
  assert.deepEqual(start.input, { kind: "other", name: "Import contact", owner: "usr_dana" });
  const bulk = h.only("records.bulk_upsert");
  assert.equal(bulk.length, 1);
  assert.equal(bulk[0]!.input.type, "contact");
  assert.equal(bulk[0]!.input.rows.length, 3);
  assert.deepEqual(bulk[0]!.input.match, []);
  assert.equal(bulk[0]!.input.runAutomations, false);
  assert.equal(h.world.rows("contact").length, 3);
  assert.equal(h.world.rows("contact")[0]!["name"], "Ada Lovelace");
  assert.deepEqual(h.named("import.started").map((e) => e.payload), [{ importId, runId: out.runId, type: "contact", source: "csv", rows: 3 }]);
  assert.deepEqual(h.named("import.completed").map((e) => e.payload), [{ importId, runId: out.runId, type: "contact", source: "csv", created: 3, updated: 0, skipped: 0, failed: 0, ranAutomations: false }]);
  assert.deepEqual(h.names(), ["import.started", "import.completed"]);
  assert.equal(h.world.runs.get(out.runId)?.status, "succeeded");
  const got = (await run(h, "import.get", { importId })).import;
  assert.deepEqual([got.state, got.created, got.updated, got.skipped, got.failed, got.ranAutomations, got.type, got.runId], ["done", 3, 0, 0, 0, false, "contact", out.runId]);
});

test("commit is idempotent: the same key writes nothing twice, and an import is written once", async () => {
  const h = harness();
  const { importId, previewToken } = await ready(h);
  const k = key();
  const one = await run(h, "import.commit", { importId, previewToken, idempotencyKey: k });
  const two = await run(h, "import.commit", { importId, previewToken, idempotencyKey: k });
  assert.deepEqual(two, one);
  assert.equal(h.only("records.bulk_upsert").length, 1);
  assert.equal(h.only("runs.start").length, 1);
  assert.equal(h.world.rows("contact").length, 3);
  assert.equal(h.named("import.completed").length, 1);
  await refused(run(h, "import.commit", { importId, previewToken, idempotencyKey: key() }), "validation.precondition_failed", "already_written");
  assert.equal(h.world.rows("contact").length, 3);
});

test("no automation fires unless the importer ticked run automations", async () => {
  const off = harness();
  const a = await ready(off);
  await run(off, "import.commit", a);
  assert.equal(off.only("records.bulk_upsert")[0]!.input.runAutomations, false, "off by default");
  assert.equal(off.named("import.completed")[0]!.payload["ranAutomations"], false);

  const onAtCommit = harness();
  const b = await ready(onAtCommit);
  await run(onAtCommit, "import.commit", { ...b, runAutomations: true });
  assert.equal(onAtCommit.only("records.bulk_upsert")[0]!.input.runAutomations, true);
  assert.equal(onAtCommit.named("import.completed")[0]!.payload["ranAutomations"], true);

  const onAtPreview = harness();
  const c = await ready(onAtPreview, CSV, { runAutomations: true });
  await run(onAtPreview, "import.commit", c);
  assert.equal(onAtPreview.only("records.bulk_upsert")[0]!.input.runAutomations, true, "the tick on the preview carries to the commit");

  const overridden = harness();
  const d = await ready(overridden, CSV, { runAutomations: true });
  await run(overridden, "import.commit", { ...d, runAutomations: false });
  assert.equal(overridden.only("records.bulk_upsert")[0]!.input.runAutomations, false, "the commit has the last word");
  assert.equal(state(overridden, d.importId)["ranAutomations"], 0);
});

test("commit takes only the token of the plan that was previewed", async () => {
  const h = harness();
  const importId = await stage(h);
  await refused(run(h, "import.commit", { importId, previewToken: "pv_x" }), "validation.precondition_failed", "no_preview");
  const first = await run(h, "import.preview", { importId, type: "contact", mapping: MAPPING });
  await run(h, "import.preview", { importId, type: "contact", mapping: MAPPING.slice(0, 3) });
  await refused(run(h, "import.commit", { importId, previewToken: first.previewToken }), "validation.precondition_failed", "stale_preview");
  await refused(run(h, "import.commit", { importId, previewToken: "pv_made_up" }), "validation.precondition_failed", "stale_preview");
  await refused(run(h, "import.commit", { importId: "imp_none", previewToken: "pv_x" }), "validation.precondition_failed");
  assert.equal(h.only("records.bulk_upsert").length, 0);
  assert.equal(h.only("runs.start").length, 0);
  assert.deepEqual(h.emitted, []);
});

test("an expired import cannot be committed", async () => {
  const h = harness();
  const { importId, previewToken } = await ready(h);
  h.advance(24 * 3_600_000);
  await refused(run(h, "import.commit", { importId, previewToken }), "validation.precondition_failed");
  assert.equal(h.only("records.bulk_upsert").length, 0);
});

test("rows that match existing records are updates through the match key; skip leaves them out; create makes new ones", async () => {
  const text = `${CSV}\nAda Again,ada@example.com,,,,,,`;
  const upd = harness();
  upd.world.seed("contact", { name: "Old Ada", email: "ada@example.com" });
  const a = await ready(upd, text, { match: ["email"] }, MAPPING);
  await run(upd, "import.commit", a);
  assert.deepEqual(upd.only("records.bulk_upsert")[0]!.input.match, ["email"]);
  assert.equal(upd.only("records.bulk_upsert")[0]!.input.rows.length, 4);
  assert.equal(upd.world.rows("contact").length, 3, "Ada updated (twice), Grace and Alan created");
  assert.equal(upd.world.rows("contact")[0]!["name"], "Ada Again");
  assert.deepEqual(upd.named("import.completed")[0]!.payload["created"], 2);
  assert.deepEqual(upd.named("import.completed")[0]!.payload["updated"], 2);

  const skip = harness();
  skip.world.seed("contact", { name: "Old Ada", email: "ada@example.com" });
  const b = await ready(skip, text, { match: ["email"], onMatch: "skip" }, MAPPING);
  await run(skip, "import.commit", b);
  assert.equal(skip.only("records.bulk_upsert")[0]!.input.rows.length, 2, "Grace and Alan; both Adas are left alone");
  assert.equal(skip.world.rows("contact")[0]!["name"], "Old Ada");
  assert.equal(skip.named("import.completed")[0]!.payload["skipped"], 2);

  const make = harness();
  make.world.seed("contact", { name: "Old Ada", email: "ada@example.com" });
  const c = await ready(make, text, { match: ["email"], onMatch: "create" }, MAPPING);
  await run(make, "import.commit", c);
  assert.deepEqual(make.only("records.bulk_upsert")[0]!.input.match, [], "no match key: every row is new");
  assert.equal(make.world.rows("contact").length, 5);
});

test("rows that could not be converted are not written and are counted as failed", async () => {
  const h = harness();
  const { importId, previewToken } = await ready(h, "Name,Email\nAda,ada@example.com\nBad,nope\nGrace,grace@example.com\n");
  await run(h, "import.commit", { importId, previewToken });
  assert.equal(h.only("records.bulk_upsert")[0]!.input.rows.length, 2);
  assert.deepEqual(h.world.rows("contact").map((r) => r["name"]), ["Ada", "Grace"]);
  const done = h.named("import.completed")[0]!.payload;
  assert.deepEqual([done["created"], done["failed"]], [2, 1]);
  assert.deepEqual(state(h, importId)["errors"], JSON.stringify([{ row: 2, column: "Email", message: "nope is not an email address." }]));
});

test("new fields are added through the schema before the rows are written", async () => {
  const h = harness();
  const text = "Name,Email,Favourite colour\nAda,ada@example.com,blue\n";
  const mapping = [...MAP2, { column: "Favourite colour", field: "favourite_colour" }];
  const { importId, previewToken } = await ready(h, text, { createFields: true }, mapping);
  h.clear();
  await run(h, "import.commit", { importId, previewToken });
  assert.deepEqual(h.calls.map((c) => c.cap).filter((c) => c === "schema.apply" || c === "records.bulk_upsert"), ["schema.apply", "records.bulk_upsert"]);
  const op = h.only("schema.apply")[0]!.input.ops[0];
  assert.deepEqual(op, { op: "field.add", type: "contact", field: "favourite_colour", def: { key: "favourite_colour", type: "text", title: "Favourite colour" } });
  assert.equal(h.world.rows("contact")[0]!["favourite_colour"], "blue");
});

test("a large import is written in batches of 500, each with its own key", async () => {
  const h = harness();
  const { importId, previewToken } = await ready(h, people(1200));
  await run(h, "import.commit", { importId, previewToken });
  const bulk = h.only("records.bulk_upsert");
  assert.deepEqual(bulk.map((c) => c.input.rows.length), [500, 500, 200]);
  assert.deepEqual(bulk.map((c) => c.key), [`imp:${importId}:0`, `imp:${importId}:1`, `imp:${importId}:2`]);
  assert.equal(h.world.rows("contact").length, 1200);
  assert.equal(h.named("import.completed")[0]!.payload["created"], 1200);
});

test("a batch that fails stops the import: rows already written stay, the Run is failed, and import.failed says why", async () => {
  const h = harness();
  const { importId, previewToken } = await ready(h, people(1200));
  h.world.failBatch.at = 1;
  h.clear();
  const out = await run(h, "import.commit", { importId, previewToken });
  assert.equal(out.importId, importId);
  assert.equal(h.world.rows("contact").length, 500, "the first batch is in");
  assert.equal(h.only("records.bulk_upsert").length, 2, "nothing was tried after the failure");
  assert.deepEqual(h.names(), ["import.started", "import.failed"]);
  assert.deepEqual(h.named("import.failed")[0]!.payload, { importId, runId: out.runId, type: "contact", error: "the store is full" });
  assert.equal(h.world.runs.get(out.runId)?.status, "failed");
  const got = (await run(h, "import.get", { importId })).import;
  assert.deepEqual([got.state, got.created], ["failed", 500]);
  await refused(run(h, "import.commit", { importId, previewToken }), "validation.precondition_failed", "already_written");
});

test("a Run that was stopped ends the import as canceled and writes nothing more", async () => {
  const h = harness();
  const { importId, previewToken } = await ready(h, people(1200));
  const start = h.world.handlers["runs.start"]!;
  h.world.handlers["runs.start"] = (i, o) => { const r = start(i, o) as { runId: string }; h.world.runs.get(r.runId)!.status = "stopped"; return r; };
  const out = await run(h, "import.commit", { importId, previewToken });
  assert.equal(h.only("records.bulk_upsert").length, 0);
  assert.equal(h.world.runs.get(out.runId)?.status, "stopped");
  assert.equal(h.named("import.completed").length, 0);
  assert.equal((await run(h, "import.get", { importId })).import.state, "canceled");
});

test("when Runs cannot be started nothing is written", async () => {
  const h = harness();
  const { importId, previewToken } = await ready(h);
  h.world.down.add("runs.start");
  await assert.rejects(run(h, "import.commit", { importId, previewToken }));
  assert.equal(h.only("records.bulk_upsert").length, 0);
  assert.equal(state(h, importId)["state"], "staged", "still staged, so it can be committed when Runs are back");
  assert.deepEqual(h.emitted, []);
});

test("the rows are not kept once an import is written", async () => {
  const h = harness();
  const { importId, previewToken } = await ready(h, people(50));
  assert.ok(String(state(h, importId)["tables"]).length > 1000);
  await run(h, "import.commit", { importId, previewToken });
  const kept = JSON.parse(String(state(h, importId)["tables"])) as Array<{ rows: unknown[]; columns: unknown[] }>;
  assert.deepEqual(kept.map((t) => t.rows.length), [0]);
  assert.equal(kept[0]!.columns.length, 2, "the columns stay");
});
