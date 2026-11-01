// @reads /modules/schema/migrations/0001_schema.sql
// Sealing an existing field (field.retype to sealed): only text-like fields, a yes first, every value into the Vault before anything changes, plaintext gone from the log and the copies,
// the rows rebuildable from the log afterwards, and no way back to plain text.
import test from "node:test";
import assert from "node:assert/strict";
import { isErased } from "../../../kernel/src/events/compact.ts";
import { mintRecordId } from "../../../lib/ids.ts";
import { openSchema } from "../impl.ts";
import { finishJobs, setSchemaVault } from "../handlers/seal.ts";

const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: () => undefined, actor: "usr_dana" };
const refused = (re: RegExp) => (e: unknown) => { assert.match(JSON.stringify(e), re); return true; };

async function made() {
  const s = openSchema({ path: ":memory:" });
  await s.handlers["schema.apply"](ctx, { ops: [{ op: "type.create", type: "client", def: { title: "Client", plural: "Clients", icon: "table", label: "internal", titleField: "name", fields: [
    { key: "name", type: "text", title: "Name", required: true }, { key: "taxid", type: "text", title: "Tax ID" }, { key: "budget", type: "money", title: "Budget" }] } }] });
  const ids = [mintRecordId(), mintRecordId(), mintRecordId()] as const;
  for (const [i, v] of ["111-22-3333", "444-55-6666", null].entries()) await s.store.create("client", ids[i]!, { name: `C${i}`, taxid: v });
  await s.store.update("client", ids[0], { taxid: "999-99-9999" }, 1);
  return { s, ids };
}
const ops = [{ op: "field.retype" as const, type: "client", field: "taxid", toType: "sealed" }];
const seeing = (s: Awaited<ReturnType<typeof made>>["s"]): string => new TextDecoder().decode(Buffer.concat(s.host!.store.read({ limit: 1000 }).map((e) => Buffer.from(e.payload))));

test("sealing asks first, says it is one way, and refuses what cannot be sealed", async () => {
  const { s } = await made();
  const d = await s.handlers["schema.diff"](ctx, { ops });
  assert.equal(d.destructive, 1);
  assert.match(d.items[0]!.summary, /cannot be turned back into plain text/);
  assert.equal(d.items[0]!.affectedRows, 2);
  await assert.rejects(() => s.handlers["schema.apply"](ctx, { ops }), refused(/Confirm the destructive changes/));
  assert.match((await s.handlers["schema.diff"](ctx, { ops: [{ op: "field.retype", type: "client", field: "budget", toType: "sealed" }] })).problems[0]!.message, /money field cannot be sealed/);
  assert.match((await s.handlers["schema.diff"](ctx, { ops: [{ op: "field.retype", type: "client", field: "name", toType: "sealed" }] })).problems[0]!.message, /names the record/);
});

test("no Vault: nothing is sealed and the values stay as they were", async () => {
  const { s, ids } = await made();
  setSchemaVault(null);
  const d = await s.handlers["schema.diff"](ctx, { ops });
  await assert.rejects(() => s.handlers["schema.apply"](ctx, { ops, previewToken: d.previewToken, confirm: d.items.map((i) => i.itemKey) }), refused(/Vault is not available/));
  const row = await s.store.get("client", ids[1]);
  assert.equal(row!.data["taxid"], "444-55-6666");
  assert.equal((await s.handlers["schema.types.get"](ctx, { type: "client" })).type.fields.find((f) => f.key === "taxid")!.type, "text");
});

test("sealed: values in the Vault, references in the rows, no plaintext in the log, a rebuild keeps the rows, and no way back", async () => {
  const { s, ids } = await made();
  const kept = new Map<string, string>();
  setSchemaVault({ put: async (o) => { kept.set(o.recordId, o.value); return `vit_${o.recordId}`; } });
  try {
    assert.ok(seeing(s).includes("111-22-3333"), "before: the log holds the value");
    const d = await s.handlers["schema.diff"](ctx, { ops });
    await s.handlers["schema.apply"](ctx, { ops, previewToken: d.previewToken, confirm: d.items.map((i) => i.itemKey) });
    assert.deepEqual([...kept.entries()].sort(), [[ids[0], "999-99-9999"], [ids[1], "444-55-6666"]].sort());
    assert.equal(await finishJobs(s.deps), 1);
    assert.equal(await finishJobs(s.deps), 0, "the job is done once");
    for (const id of [ids[0], ids[1]]) {
      const v = (await s.store.get("client", id))!.data["taxid"] as { sealed: string; ref: string; present: boolean };
      assert.deepEqual({ sealed: v.sealed, ref: v.ref, present: v.present }, { sealed: "taxid", ref: `vit_${id}`, present: true });
    }
    assert.equal((await s.store.get("client", ids[2]))!.data["taxid"], null, "an empty value stays empty");
    const text = seeing(s);
    for (const v of ["111-22-3333", "444-55-6666", "999-99-9999"]) assert.ok(!text.includes(v), `the log no longer holds ${v}`);
    assert.ok(s.host!.store.read({ limit: 1000 }).some((e) => isErased(e)), "the old events lost their payloads");
    // the rows come back from the log alone
    const snap = async (): Promise<string[]> => Promise.all(ids.map(async (id) => JSON.stringify((await s.store.get("client", id))!.data)));
    const before = await snap();
    s.host!.rebuild("records.rows");
    assert.deepEqual(await snap(), before);
    // sealing is one way
    const back = await s.handlers["schema.diff"](ctx, { ops: [{ op: "field.retype", type: "client", field: "taxid", toType: "text" }] });
    assert.match(back.problems[0]!.message, /sealed field cannot be retyped/);
  } finally { setSchemaVault(null); }
});
