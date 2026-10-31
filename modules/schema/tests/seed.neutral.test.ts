// @reads /modules/schema/migrations/0001_schema.sql
// A Space starts with the neutral record types only. The example Kits (estate planning, Harbor Studio, law firm intake) add theirs when the person installs one, and an older build that
// seeded them into every Space has the unused copies removed at start. A type with a record, an edit, a layout or a view is kept.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exampleKitTypeKeys, loadRegistry, openSchema } from "../impl.ts";
import { mintRecordId } from "../../../lib/ids.ts";

const NOW = 1_800_000_000_000;
const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: () => undefined, actor: "usr_owner" };
const file = (): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-schema-neutral-")), "space.db");
const keys = (s: ReturnType<typeof openSchema>): string[] => s.tx.all<{ type: string }>("SELECT type FROM sc_types ORDER BY type").map((r) => r.type);
const groups = async (s: ReturnType<typeof openSchema>): Promise<string[]> => {
  const out = await s.handlers["schema.types.list"](ctx, {});
  return [...new Set(out.types.map((t: { group?: string }) => t.group ?? ""))].sort();
};
/** What an older build seeded: every type the manifests declare, example Kits included. */
async function oldSpace(p: string): Promise<void> {
  const s = openSchema({ path: p, now: () => NOW, registry: loadRegistry(undefined, { withKitTypes: true }) });
  await s.start();
  s.host?.close();
}

test("a new Space has only the neutral record types and no example Kit group", async () => {
  const s = openSchema({ path: file(), now: () => NOW });
  await s.start();
  assert.deepEqual(keys(s), ["agent", "company", "contact", "envelope", "issue", "meeting", "note_board", "project", "pull_request", "report", "task"]);
  for (const k of ["client_plan", "commission", "lead", "matter"]) assert.ok(!keys(s).includes(k), `${k} is not seeded`);
  assert.deepEqual(s.pruned, []);
  const g = await groups(s);
  for (const name of ["Planning", "Studio", "Intake"]) assert.ok(!g.includes(name), `no ${name} group`);
  s.host?.close();
});

test("start removes an unused seeded example Kit type, keeps one with a record, one that was edited, one with a layout, and is idempotent", async () => {
  const p = file();
  await oldSpace(p);
  // the person used matter (a record), edited commission (a new field) and gave lead a page layout
  const a = openSchema({ path: p, now: () => NOW });
  assert.ok(keys(a).includes("client_plan") && keys(a).includes("matter"), "the old seed holds the example types");
  const rec = mintRecordId();
  const matter = (await a.handlers["schema.types.get"](ctx, { type: "matter" })).type;
  const required = Object.fromEntries(matter.fields.filter((f: { required?: boolean }) => f.required).map((f: { key: string }) => [f.key, "x"]));
  await a.store.create("matter", rec, required);
  await a.handlers["schema.apply"](ctx, { ops: [{ op: "field.add", type: "commission", field: "budget", def: { type: "number", title: "Budget" } }] });
  const lead = (await a.handlers["schema.types.get"](ctx, { type: "lead" })).type;
  await a.handlers["schema.layout.set"](ctx, { type: "lead", sections: [{ key: "main", title: "Lead", fields: [lead.fields[0].key] }] });
  a.host?.close();

  const b = openSchema({ path: p, now: () => NOW + 1000 });
  await b.start();
  assert.deepEqual(b.pruned, ["client_plan"], "only the untouched example type goes");
  for (const k of ["matter", "commission", "lead"]) assert.ok(keys(b).includes(k), `${k} is kept`);
  assert.ok(!keys(b).includes("client_plan"));
  for (const k of ["company", "contact", "task", "agent", "issue", "pull_request"]) assert.ok(keys(b).includes(k), `${k} stays`);
  assert.equal((await b.store.get("matter", rec)) !== null, true, "the record is untouched");
  const afterFirst = keys(b);
  b.host?.close();

  const c = openSchema({ path: p, now: () => NOW + 2000 });
  await c.start();
  assert.deepEqual(c.pruned, [], "a second start removes nothing more");
  assert.deepEqual(keys(c), afterFirst);
  c.host?.close();
});

test("start removes every unused example type of an old Space, and the example key list is the three Kits", async () => {
  assert.deepEqual([...exampleKitTypeKeys()].sort(), ["client_plan", "commission", "lead", "matter"]);
  const p = file();
  await oldSpace(p);
  const s = openSchema({ path: p, now: () => NOW });
  await s.start();
  assert.deepEqual(s.pruned, ["client_plan", "commission", "lead", "matter"]);
  const g = await groups(s);
  for (const name of ["Planning", "Studio", "Intake"]) assert.ok(!g.includes(name), `no ${name} group`);
  s.host?.close();
});
