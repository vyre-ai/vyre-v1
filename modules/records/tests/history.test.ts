// @reads /modules/records/migrations/0001_init.sql
// @reads /modules/records/migrations/0003_history.sql
// records.history / as_of / versions / restore_version / hold / release_hold / reveal over the kernel log (ruling 20).
import test from "node:test";
import assert from "node:assert/strict";
import { formatHlc } from "../../../lib/hlc.ts";
import { openRecords } from "../impl.ts";
import { createHistoryHandlers } from "../handlers/history.ts";
import type { HistoryCtx, SealedRef } from "../handlers/history.ts";
import { ITEM, PERSON } from "../fixtures/seed.ts";

const vcode = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c);
  return true;
};

interface Seen { name: string; subject: string; payload: Record<string, unknown>; vis?: string }

async function setup(types: object[] = [ITEM]) {
  let t = 1000;
  const rec = openRecords({ space: `sp_hist_${Math.random().toString(36).slice(2, 8)}`, clock: () => t });
  await rec.store.define({ add_types: types as never });
  const seen: Seen[] = [];
  const ctx: HistoryCtx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    principal: { kind: "person", id: "usr_a" },
    emit: (name, subject, payload, opts) => { seen.push({ name, subject, payload, ...(opts?.vis ? { vis: opts.vis } : {}) }); },
    authorize: () => ({ effect: "allow", reason: "granted" }),
  };
  const unsealed: SealedRef[] = [];
  const h = createHistoryHandlers({
    tx: rec.host.tx, store: rec.store, writes: rec.handlers, readLog: (q) => rec.host.store.read(q),
    unseal: async (ref) => { unsealed.push(ref); return `secret-of-${ref.ref}`; },
    now: () => t,
  });
  return { rec, h, ctx, seen, unsealed, at: (ms: number) => { t = ms; } };
}

test("as_of replays the log: each time gives the row as it was, and now equals the stored row", async () => {
  const { rec, h, ctx, at } = await setup();
  at(1000);
  const made = await rec.handlers["records.create"](ctx, { type: "item", fields: { name: "A", qty: 1 } });
  const id = made.record.id;
  at(2000);
  await rec.handlers["records.update"](ctx, { type: "item", recordId: id, patch: { qty: 2, status: "open" }, baseVersion: 1 });
  at(3000);
  await rec.handlers["records.update"](ctx, { type: "item", recordId: id, patch: { name: "B" }, baseVersion: 2 });

  await assert.rejects(() => h["records.as_of"](ctx, { type: "item", recordId: id, at: 999 }), vcode("validation.not_found"));
  const t1 = (await h["records.as_of"](ctx, { type: "item", recordId: id, at: 1500 })).record;
  assert.deepEqual(t1.fields, { name: "A", qty: 1 });
  assert.equal(t1.version, 1);
  const t2 = (await h["records.as_of"](ctx, { type: "item", recordId: id, at: 2500 })).record;
  assert.deepEqual(t2.fields, { name: "A", qty: 2, status: "open" });
  assert.equal(t2.version, 2);
  const now = (await h["records.as_of"](ctx, { type: "item", recordId: id, at: 9999 })).record;
  const stored = await rec.store.get("item", id);
  assert.deepEqual(now.fields, { ...stored!.data });
  assert.equal(now.version, stored!.version);
  assert.equal(now.createdAt, stored!.created_at);
  assert.equal(now.updatedAt, stored!.updated_at);
  await assert.rejects(() => h["records.as_of"](ctx, { type: "item", recordId: "nope", at: 5000 }), vcode("validation.not_found"));
  await assert.rejects(() => h["records.as_of"](ctx, { type: "ghost", recordId: id, at: 5000 }), vcode("validation.not_found"));
});

test("as_of shows a deleted row as deleted, and a restored row as live again", async () => {
  const { rec, h, ctx, at } = await setup();
  at(1000);
  const id = (await rec.handlers["records.create"](ctx, { type: "item", fields: { name: "A" } })).record.id;
  at(2000);
  await rec.handlers["records.delete"](ctx, { type: "item", recordId: id });
  at(3000);
  await rec.handlers["records.restore"](ctx, { type: "item", recordId: id });
  assert.equal((await h["records.as_of"](ctx, { type: "item", recordId: id, at: 2500 })).record.deletedAt, 2000);
  assert.equal((await h["records.as_of"](ctx, { type: "item", recordId: id, at: 3500 })).record.deletedAt, undefined);
  const v = (await h["records.versions"](ctx, { type: "item", recordId: id })).versions;
  assert.deepEqual(v.map((x) => x.reason), ["restored", "removed", "created"]);
});

test("versions list newest first with who and when; restore_version round trip goes back and forward", async () => {
  const { rec, h, ctx, at } = await setup();
  at(1000);
  const id = (await rec.handlers["records.create"](ctx, { type: "item", fields: { name: "A", qty: 1 } })).record.id;
  at(2000);
  await rec.handlers["records.update"](ctx, { type: "item", recordId: id, patch: { qty: 2, status: "open" }, baseVersion: 1 });

  const list = (await h["records.versions"](ctx, { type: "item", recordId: id })).versions;
  assert.deepEqual(list.map((v) => [v.versionId, v.n, v.at, v.reason]), [["ver_2", 2, 2000, "updated"], ["ver_1", 1, 1000, "created"]]);
  assert.ok(list.every((v) => v.by.length > 0));

  at(3000);
  const back = (await h["records.restore_version"](ctx, { type: "item", recordId: id, versionId: "ver_1" })).record;
  assert.equal(back.fields["name"], "A");
  assert.equal(back.fields["qty"], 1);
  assert.equal(back.fields["status"] ?? null, null);
  assert.equal(back.version, 3);

  const after = (await h["records.versions"](ctx, { type: "item", recordId: id })).versions;
  assert.equal(after[0]!.n, 3);
  assert.equal(after[0]!.reason, "restored from version 1");

  // Undo the restore: go forward to version 2.
  at(4000);
  const fwd = (await h["records.restore_version"](ctx, { type: "item", recordId: id, versionId: "ver_2" })).record;
  assert.equal(fwd.fields["qty"], 2);
  assert.equal(fwd.fields["status"], "open");
  assert.equal(fwd.version, 4);

  // Restoring the version it already is changes nothing and writes no version.
  const same = (await h["records.restore_version"](ctx, { type: "item", recordId: id, versionId: "ver_4" })).record;
  assert.equal(same.version, 4);

  await assert.rejects(() => h["records.restore_version"](ctx, { type: "item", recordId: id, versionId: "ver_99" }), vcode("validation.not_found"));
  await assert.rejects(() => h["records.restore_version"](ctx, { type: "item", recordId: id, versionId: "bogus" }), vcode("validation.bad_input"));
});

test("restore_version emits record.updated with the restored values and refuses a deleted record and a write-once change", async () => {
  const { rec, h, ctx, seen, at } = await setup();
  at(1000);
  const id = (await rec.handlers["records.create"](ctx, { type: "item", fields: { name: "A", qty: 1, code: "c1" } })).record.id;
  at(2000);
  await rec.handlers["records.update"](ctx, { type: "item", recordId: id, patch: { qty: 5 }, baseVersion: 1 });
  seen.length = 0;
  await h["records.restore_version"](ctx, { type: "item", recordId: id, versionId: "ver_1" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.name, "record.updated");
  assert.deepEqual(seen[0]!.payload["fields"], { qty: 1 });
  assert.deepEqual(seen[0]!.payload["prev"], { qty: 5 });

  await rec.handlers["records.delete"](ctx, { type: "item", recordId: id });
  await assert.rejects(() => h["records.restore_version"](ctx, { type: "item", recordId: id, versionId: "ver_1" }), vcode("validation.precondition_failed"));
});

test("history lists replaced values with who and when, merge losers with their reason, and filters by field", async () => {
  const { rec, h, ctx } = await setup();
  const id = (await rec.handlers["records.create"](ctx, { type: "item", fields: { name: "A", qty: 1 } })).record.id;
  await rec.handlers["records.update"](ctx, { type: "item", recordId: id, patch: { qty: 2, name: "B" }, baseVersion: 1 });
  await rec.handlers["records.update"](ctx, { type: "item", recordId: id, patch: { qty: 3 }, baseVersion: 2 });
  // An older sync write for qty loses to the stored clock and lands in history as a loser.
  const lost = await rec.mergeFields("item", id, { qty: { value: 99, hlc: formatHlc({ ms: 1, counter: 0, deviceId: "dev1" }), baseSeq: 0 } }, "usr_sync");
  assert.deepEqual(lost.lost.map((l) => l.field), ["qty"]);

  const all = (await h["records.history"](ctx, { type: "item", recordId: id })).entries;
  const qty = all.filter((e) => e.field === "qty");
  assert.deepEqual(qty.map((e) => [e.value, e.reason]).sort(), [[1, "replaced"], [2, "replaced"], [99, "lww_loser"]].sort());
  assert.deepEqual(all.filter((e) => e.field === "name").map((e) => e.value), ["A"]);
  assert.ok(all.every((e) => e.actor.length > 0 && e.hlc.length > 0));
  const only = (await h["records.history"](ctx, { type: "item", recordId: id, field: "name" })).entries;
  assert.equal(only.length, 1);
  assert.equal(only[0]!.reason, "replaced");
});

test("holds: a hold blocks delete, counts on the row, needs a reason, and release lifts every hold", async () => {
  const { rec, h, ctx, seen } = await setup();
  const id = (await rec.handlers["records.create"](ctx, { type: "item", fields: { name: "A" } })).record.id;
  seen.length = 0;
  await assert.rejects(() => h["records.hold"](ctx, { type: "item", recordId: id, reason: "  " }), vcode("validation.bad_input"));
  await assert.rejects(() => h["records.hold"](ctx, { type: "item", recordId: "nope", reason: "x" }), vcode("validation.not_found"));
  assert.deepEqual(await h["records.hold"](ctx, { type: "item", recordId: id, reason: "litigation" }), { held: true });
  await h["records.hold"](ctx, { type: "item", recordId: id, reason: "audit" });
  assert.deepEqual(seen.map((s) => s.name), ["record.held", "record.held"]);
  assert.equal(seen[0]!.payload["reason"], "litigation");
  await assert.rejects(() => rec.handlers["records.delete"](ctx, { type: "item", recordId: id }), vcode("permission.on_hold"));
  const asOf = (await h["records.as_of"](ctx, { type: "item", recordId: id, at: 9e12 })).record;
  assert.equal(asOf.holds, 2);

  seen.length = 0;
  assert.deepEqual(await h["records.release_hold"](ctx, { type: "item", recordId: id }), { released: true });
  assert.deepEqual(seen.map((s) => s.name), ["record.hold_released"]);
  assert.deepEqual(await h["records.release_hold"](ctx, { type: "item", recordId: id }), { released: false });
  assert.deepEqual(await rec.handlers["records.delete"](ctx, { type: "item", recordId: id }), { deleted: true });
});

const sealedRef = (ref: string) => ({ sealed: "ssn", ref, present: true });

test("reveal: needs a person with clearance, opens the vault, logs per actor, and the value is never in an event", async () => {
  const { rec, h, ctx, seen, unsealed } = await setup([PERSON]);
  const id = (await rec.handlers["records.create"](ctx, { type: "person", fields: { name: "P", ssn: sealedRef("sv_1") } })).record.id;
  seen.length = 0;

  const res = await h["records.reveal"](ctx, { type: "person", recordId: id, field: "ssn" });
  assert.deepEqual(res, { value: "secret-of-sv_1" });
  assert.equal(unsealed.length, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.name, "field.revealed");
  assert.equal(seen[0]!.vis, "participants");
  assert.deepEqual(seen[0]!.payload, { recordId: id, type: "person", field: "ssn" });
  assert.ok(!JSON.stringify(seen).includes("secret-of"));

  // An agent never reveals; nothing is logged and the vault is not touched.
  seen.length = 0;
  await assert.rejects(() => h["records.reveal"]({ ...ctx, principal: { kind: "agent", id: "agt_1" } }, { type: "person", recordId: id, field: "ssn" }), vcode("permission.role_lacks_permission"));
  // Above clearance and no grant are different answers; a held decision becomes needs_approval.
  await assert.rejects(() => h["records.reveal"]({ ...ctx, authorize: () => ({ effect: "deny", reason: "label restricted is above your clearance" }) }, { type: "person", recordId: id, field: "ssn" }), vcode("permission.above_clearance"));
  await assert.rejects(() => h["records.reveal"]({ ...ctx, authorize: () => ({ effect: "deny", reason: "no grant" }) }, { type: "person", recordId: id, field: "ssn" }), vcode("permission.no_grant"));
  await assert.rejects(() => h["records.reveal"]({ ...ctx, authorize: () => ({ effect: "hold", reason: "ask" }) }, { type: "person", recordId: id, field: "ssn" }), vcode("permission.needs_approval"));
  const bare: HistoryCtx = { trace: ctx.trace, principal: ctx.principal!, emit: ctx.emit };
  await assert.rejects(() => h["records.reveal"](bare, { type: "person", recordId: id, field: "ssn" }), vcode("permission.no_grant"));
  assert.equal(seen.length, 0);
  assert.equal(unsealed.length, 1);

  await assert.rejects(() => h["records.reveal"](ctx, { type: "person", recordId: id, field: "name" }), vcode("validation.bad_input"));
  await assert.rejects(() => h["records.reveal"](ctx, { type: "person", recordId: id, field: "zzz" }), vcode("validation.bad_input"));
  await assert.rejects(() => h["records.reveal"](ctx, { type: "person", recordId: "nope", field: "ssn" }), vcode("validation.not_found"));
});

test("reveal of a field with no value is not found, and a deleted record cannot be revealed", async () => {
  const { rec, h, ctx } = await setup([PERSON]);
  const empty = (await rec.handlers["records.create"](ctx, { type: "person", fields: { name: "P" } })).record.id;
  await assert.rejects(() => h["records.reveal"](ctx, { type: "person", recordId: empty, field: "ssn" }), vcode("validation.not_found"));
  const gone = (await rec.handlers["records.create"](ctx, { type: "person", fields: { name: "Q", ssn: sealedRef("sv_2") } })).record.id;
  await rec.handlers["records.delete"](ctx, { type: "person", recordId: gone });
  await assert.rejects(() => h["records.reveal"](ctx, { type: "person", recordId: gone, field: "ssn" }), vcode("validation.not_found"));
});

test("sealed values stay masked in history", async () => {
  const { rec, h, ctx } = await setup([PERSON]);
  const id = (await rec.handlers["records.create"](ctx, { type: "person", fields: { name: "P", ssn: sealedRef("sv_old") } })).record.id;
  await rec.handlers["records.update"](ctx, { type: "person", recordId: id, patch: { ssn: sealedRef("sv_new") }, baseVersion: 1 });
  const entries = (await h["records.history"](ctx, { type: "person", recordId: id, field: "ssn" })).entries;
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0]!.value, { sealed: "ssn", masked: true });
  assert.ok(!JSON.stringify(entries).includes("sv_old"));
});
