// Import: reading an import, the history, dropping a staged one, and the CSV template of a record type (spec 2.9).
import test from "node:test";
import assert from "node:assert/strict";
import { DANA, NOW, codeOf, harness } from "../fixtures/harness.ts";
import { MAPPING, run, stage } from "../fixtures/seed.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); return true; });
}

test("a staged import reads as staged with no type yet; after a preview it has its type", async () => {
  const h = harness();
  const id = await stage(h);
  const fresh = (await run(h, "import.get", { importId: id })).import;
  assert.deepEqual(fresh, { importId: id, source: "csv", type: "pending", state: "staged", by: DANA, at: NOW, created: 0, updated: 0, skipped: 0, failed: 0, ranAutomations: false });
  await run(h, "import.preview", { importId: id, type: "contact", mapping: MAPPING });
  assert.equal((await run(h, "import.get", { importId: id })).import.type, "contact");
  await refused(run(h, "import.get", { importId: "imp_none" }), "validation.bad_input");
});

test("the history lists imports newest first, by type, in pages", async () => {
  const h = harness();
  const a = await stage(h);
  h.advance(1000);
  const b = await stage(h);
  h.advance(1000);
  const c = await stage(h);
  const p = await run(h, "import.preview", { importId: b, type: "contact", mapping: MAPPING });
  await run(h, "import.commit", { importId: b, previewToken: p.previewToken });
  const all = await run(h, "import.list", {});
  assert.deepEqual(all.imports.map((i: { importId: string }) => i.importId), [c, b, a]);
  assert.equal(all.total, 3);
  assert.deepEqual((await run(h, "import.list", { type: "contact" })).imports.map((i: { importId: string }) => i.importId), [b]);
  const first = await run(h, "import.list", { limit: 2 });
  assert.equal(first.imports.length, 2);
  assert.equal(first.next, "2");
  assert.deepEqual((await run(h, "import.list", { limit: 2, cursor: first.next })).imports.map((i: { importId: string }) => i.importId), [a]);
});

test("discard drops a staged import; one that was written stays as the record of what happened", async () => {
  const h = harness();
  const id = await stage(h);
  assert.deepEqual(await run(h, "import.discard", { importId: id }), { discarded: true });
  await refused(run(h, "import.get", { importId: id }), "validation.bad_input");
  assert.deepEqual(h.emitted, []);
  const kept = await stage(h);
  const p = await run(h, "import.preview", { importId: kept, type: "contact", mapping: MAPPING });
  await run(h, "import.commit", { importId: kept, previewToken: p.previewToken });
  assert.deepEqual(await run(h, "import.discard", { importId: kept }), { discarded: false });
  assert.equal((await run(h, "import.get", { importId: kept })).import.state, "done");
  await refused(run(h, "import.discard", { importId: "imp_none" }), "validation.bad_input");
});

test("the template is a header row and one example row, and it imports cleanly", async () => {
  const h = harness();
  const out = await run(h, "import.template", { type: "contact" });
  assert.equal(out.text, "Name,Email,Phone,Company,Joined,VIP,Amount,Stage\nExample,name@example.com,+1 555 010 0100,Example,2026-01-31,yes,42,Lead\n");
  const staged = await run(h, "import.parse_csv", { text: out.text });
  const mapping = (await run(h, "import.suggest_mapping", { importId: staged.importId, type: "contact" })).mapping.map((m: { column: string; field: string }) => ({ column: m.column, field: m.field }));
  assert.equal(mapping.length, 8);
  const pv = await run(h, "import.preview", { importId: staged.importId, type: "contact", mapping });
  assert.deepEqual([pv.creates, pv.errorCount], [1, 0]);
  await refused(run(h, "import.template", { type: "nothing" }), "validation.not_found");
});

test("a title with a comma is quoted in the template", async () => {
  const h = harness();
  h.world.types.set("deal", [{ key: "title", type: "text", title: "Deal, name" }]);
  assert.equal((await run(h, "import.template", { type: "deal" })).text, '"Deal, name"\nExample\n');
});
