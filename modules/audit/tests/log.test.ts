// The audit log through the real handlers (spec 2.25, ARCH 4.1).
// contract tests for verify: audit chain verify detects a tampered row.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { ed25519Signer } from "../../../kernel/src/audit/index.ts";
import { handlers } from "../impl.ts";
import { classOfInvoke, genesis, hashOf } from "../projections.ts";
import type { AuditSeams, RowRec } from "../projections.ts";
import { codeOf, harness, NOW, SPACE } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";

const ADMIN = "usr_admin";
const keys = generateKeyPairSync("ed25519");
const signer: NonNullable<AuditSeams["signer"]> = { keyId: "key_space_1", sign: ed25519Signer(keys.privateKey), publicKey: keys.publicKey };
const other = generateKeyPairSync("ed25519");

async function add(h: Harness, action: string, o: { cls?: "change" | "sensitive" | "deny" | "admin" | "erase" | "sign_in"; detail?: unknown; resource?: { type: string; id: string }; behalf?: string; as?: string } = {}) {
  h.advance(1000);
  return handlers["audit.append"](h.as(o.as ?? ADMIN), {
    action, class: o.cls ?? "change", ...(o.detail !== undefined ? { detail: o.detail } : {}), ...(o.resource ? { resource: o.resource } : {}),
    ...(o.behalf ? { onBehalfOf: { kind: "person" as const, id: o.behalf } } : {}),
  });
}
/** Four admin acts. */
async function chain() {
  const h = harness();
  await add(h, "grant.created", { resource: { type: "folder", id: "fld_1" } });
  await add(h, "role.assigned", { cls: "admin", resource: { type: "space", id: SPACE }, behalf: "usr_boss" });
  await add(h, "vault.revealed", { cls: "sensitive", resource: { type: "vault_item", id: "vlt_1" } });
  await add(h, "policy.changed", { cls: "admin" });
  h.events.length = 0;
  return h;
}
const rowsOf = (h: Harness) => h.raw.rows("audit_row") as unknown as RowRec[];
const verify = (h: Harness, input: { fromSeq?: number; toSeq?: number } = {}) => handlers["audit.verify"](h.as(ADMIN), input);

test("rows chain from the Space genesis, each hash covers the one before, and verify says so", async () => {
  const h = await chain();
  const rows = rowsOf(h);
  assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3, 4]);
  assert.equal(rows[0]!.prev_hash, genesis(SPACE));
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i]!.prev_hash, rows[i - 1]!.hash);
  assert.equal(new Set(rows.map((r) => r.hash)).size, 4);
  const v = await verify(h);
  assert.deepEqual(v, { ok: true, checked: 4 });
  assert.deepEqual(h.events, [{ name: "audit.verified", subject: ADMIN, payload: { ok: true, checked: 4, by: ADMIN } }]);
  assert.deepEqual(await verify(h, { fromSeq: 3, toSeq: 4 }), { ok: true, checked: 2 }, "a slice verifies against the row before it");
});

test("audit chain verify detects a tampered row", async () => {
  const h = await chain();
  h.raw.run(`UPDATE audit_row SET action = ? WHERE seq = ?`, "grant.deleted", 2);
  const v = await verify(h);
  assert.deepEqual(v, { ok: false, checked: 2, firstBadSeq: 2 });
  assert.equal(h.events.at(-1)!.name, "audit.verified");
  assert.deepEqual((h.events.at(-1)!.payload as { ok: boolean; firstBadSeq: number }).firstBadSeq, 2);
  assert.deepEqual(await verify(h, { fromSeq: 3 }), { ok: true, checked: 2 }, "rows after the edit still link to each other");
  assert.equal((await verify(h, { fromSeq: 2, toSeq: 2 })).firstBadSeq, 2);
});

test("an edited row with its hash patched up breaks the link of the next row", async () => {
  const h = await chain();
  const r = rowsOf(h).find((x) => x.seq === 2)!;
  const edited = { ...r, action: "grant.deleted" };
  const { hash: _drop, ...rest } = edited;
  h.raw.run(`UPDATE audit_row SET action = ?, hash = ? WHERE seq = ?`, "grant.deleted", hashOf(rest), 2);
  assert.deepEqual(await verify(h), { ok: false, checked: 3, firstBadSeq: 3 });
});

test("a deleted row leaves a gap that verify names", async () => {
  const h = await chain();
  h.raw.run(`DELETE FROM audit_row WHERE seq = ?`, 2);
  assert.deepEqual(await verify(h), { ok: false, checked: 2, firstBadSeq: 3 });
});

test("checkpoints: signed head, listed with their check; a tail cut off or rewritten consistently is caught", async () => {
  const h = await chain();
  const admin = h.as(ADMIN, { signer });
  const cp = await handlers["audit.checkpoint"](admin, {});
  assert.equal(cp.checkpoint.seq, 4);
  assert.equal(cp.checkpoint.signatureOk, true);
  assert.deepEqual(h.events.map((e) => e.name), ["audit.checkpointed"]);
  h.events.length = 0;
  assert.deepEqual(await handlers["audit.checkpoint"](admin, {}), cp, "the same head is checkpointed once");
  assert.deepEqual(h.events, []);
  assert.deepEqual((await handlers["audit.checkpoints.list"](admin, {})).checkpoints, [cp.checkpoint]);
  await assert.rejects(handlers["audit.checkpoint"](h.as(ADMIN), {}), (e) => codeOf(e) === "internal.not_implemented");
  assert.deepEqual(await verify(h), { ok: true, checked: 4 });

  // cut the tail off: the chain still links, the checkpoint names a row that is gone
  const cut = await chain();
  await handlers["audit.checkpoint"](cut.as(ADMIN, { signer }), {});
  cut.raw.run(`DELETE FROM audit_row WHERE seq = ?`, 4);
  assert.deepEqual(await handlers["audit.verify"](cut.as(ADMIN, { signer }), {}), { ok: false, checked: 3, firstBadSeq: 4 });

  // rewrite rows 3 and 4 and rehash them so the chain links: the checkpoint's hash no longer matches
  const rewrite = await chain();
  await handlers["audit.checkpoint"](rewrite.as(ADMIN, { signer }), {});
  let prev = rowsOf(rewrite).find((r) => r.seq === 2)!.hash;
  for (const seq of [3, 4]) {
    const r = rowsOf(rewrite).find((x) => x.seq === seq)!;
    const { hash: _h, ...rest } = { ...r, prev_hash: prev, action: `${r.action}.rewritten` };
    prev = hashOf(rest);
    rewrite.raw.run(`UPDATE audit_row SET action = ?, prev_hash = ?, hash = ? WHERE seq = ?`, rest.action, rest.prev_hash, prev, seq);
  }
  assert.deepEqual(await handlers["audit.verify"](rewrite.as(ADMIN, { signer }), {}), { ok: false, checked: 4, firstBadSeq: 4 });
});

test("a checkpoint signed by another key does not verify", async () => {
  const h = await chain();
  await handlers["audit.checkpoint"](h.as(ADMIN, { signer: { keyId: "key_other", sign: ed25519Signer(other.privateKey), publicKey: other.publicKey } }), {});
  const v = await handlers["audit.verify"](h.as(ADMIN, { signer }), {});
  assert.equal(v.ok, false);
  assert.equal(v.firstBadSeq, 4);
  const list = await handlers["audit.checkpoints.list"](h.as(ADMIN, { signer }), {});
  assert.equal(list.checkpoints[0]!.signatureOk, false);
});

test("chain health: empty, no checkpoint, fresh, stale, broken", async () => {
  const h = harness();
  const ask = (seams: AuditSeams = { signer }) => handlers["audit.chain_health"](h.as(ADMIN, seams), {});
  assert.equal((await ask()).state, "healthy");
  await add(h, "grant.created");
  assert.equal((await ask()).state, "degraded");
  await handlers["audit.checkpoint"](h.as(ADMIN, { signer }), {});
  const fresh = await ask();
  assert.equal(fresh.state, "healthy");
  assert.ok(Number.isInteger(fresh.latencyMs));
  h.advance(31 * 60_000);
  const stale = await ask();
  assert.equal(stale.state, "degraded");
  assert.match(stale.detail!, /31 minutes old/);
  h.raw.run(`UPDATE audit_row SET action = ? WHERE seq = ?`, "x", 1);
  assert.equal((await ask()).state, "down");
});

test("append never stores secret values, erase records who and when and never what, a bulk read is one row with a sample", async () => {
  const h = harness();
  await add(h, "vault.revealed", { cls: "sensitive", detail: { item: "vlt_1", password: "hunter2", nested: { apiKey: "sk-123", note: "ok" }, list: [{ token: "t" }] } });
  await add(h, "person.erased", { cls: "erase", resource: { type: "record", id: "rec_1" }, detail: { name: "Maya Doe", email: "m@example.com" } });
  const ids = Array.from({ length: 45 }, (_, i) => `rec_${i}`);
  await add(h, "records.read_bulk", { cls: "sensitive", detail: { ids, filter: "all" } });
  const [vault, erase, bulk] = rowsOf(h);
  assert.ok(!vault!.after_json!.includes("hunter2") && !vault!.after_json!.includes("sk-123") && !vault!.after_json!.includes('"t"'));
  assert.deepEqual(JSON.parse(vault!.after_json!), { item: "vlt_1", password: "[redacted]", nested: { apiKey: "[redacted]", note: "ok" }, list: [{ token: "[redacted]" }] });
  assert.equal(erase!.after_json, null);
  assert.equal(erase!.before_json, null);
  assert.equal(erase!.actor_id, ADMIN);
  const b = JSON.parse(bulk!.after_json!) as { ids: string[]; count: number; sampled: boolean };
  assert.equal(b.ids.length, 20);
  assert.equal(b.count, 45);
  assert.equal(b.sampled, true);
  await assert.rejects(handlers["audit.append"](h.as(ADMIN), { action: "  ", class: "change" }), (e) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(await verify(h), { ok: true, checked: 3 });
});

test("list: newest first, filters, search, paging; viewing the log is itself recorded", async () => {
  const h = await chain();
  const ctx = h.as(ADMIN);
  const all = await handlers["audit.list"](ctx, {});
  assert.deepEqual(all.rows.map((r) => r.action), ["policy.changed", "vault.revealed", "role.assigned", "grant.created"]);
  assert.equal(all.next, undefined);
  const row = all.rows.find((r) => r.action === "role.assigned")!;
  assert.deepEqual(row.onBehalfOf, { kind: "person", id: "usr_boss" });
  assert.deepEqual(row.resource, { type: "space", id: SPACE });
  assert.equal(row.actor.id, ADMIN);

  // the first view is now a row of its own
  const again = await handlers["audit.list"](ctx, { class: "sensitive" });
  assert.deepEqual(again.rows.map((r) => r.action), ["audit.viewed", "vault.revealed"]);
  assert.deepEqual(again.rows[0]!.after, { rows: 4, filters: [] });

  assert.deepEqual((await handlers["audit.list"](ctx, { action: "grant.created" })).rows.map((r) => r.seq), [1]);
  assert.deepEqual((await handlers["audit.list"](ctx, { resource: { type: "folder", id: "fld_1" } })).rows.map((r) => r.seq), [1]);
  assert.deepEqual((await handlers["audit.list"](ctx, { actor: { kind: "person", id: "usr_nobody" } })).rows, []);
  assert.deepEqual((await handlers["audit.list"](ctx, { q: "BOSS" })).rows.map((r) => r.seq), [2], "q matches the on-behalf-of person, any case");
  assert.deepEqual((await handlers["audit.list"](ctx, { q: "vault" })).rows.map((r) => r.action), ["vault.revealed"]);
  // later views are rows too, at the clock's last tick, so the window stops before it
  const window = (await handlers["audit.list"](ctx, { from: NOW + 2000, to: NOW + 3500 })).rows.map((r) => r.seq);
  assert.deepEqual(window, [3, 2]);
  assert.deepEqual((await handlers["audit.list"](ctx, { traceId: "0123456789abcdef0123456789abcdef", class: "admin" })).rows.map((r) => r.seq), [4, 2]);

  const p1 = await handlers["audit.list"](ctx, { limit: 2, class: "admin" });
  assert.deepEqual(p1.rows.map((r) => r.seq), [4, 2]);
  assert.equal(p1.next, undefined, "exactly the rows there are: no next page");
  const p2 = await handlers["audit.list"](ctx, { limit: 2 });
  assert.equal(p2.rows.length, 2);
  assert.equal(p2.next, String(p2.rows[1]!.seq));
  const p3 = await handlers["audit.list"](ctx, { limit: 2, cursor: p2.next! });
  assert.ok(p3.rows.every((r) => r.seq < Number(p2.next)));
  assert.deepEqual((await handlers["audit.list"](ctx, { cursor: "garbage", limit: 1 })).rows.length, 1);
});

test("get returns one row and records the view; an unknown id is not found", async () => {
  const h = await chain();
  const id = (await handlers["audit.list"](h.as(ADMIN), { action: "vault.revealed" })).rows[0]!.id;
  const got = await handlers["audit.get"](h.as(ADMIN), { auditId: id });
  assert.equal(got.row.action, "vault.revealed");
  assert.equal(rowsOf(h).at(-1)!.action, "audit.viewed");
  await assert.rejects(handlers["audit.get"](h.as(ADMIN), { auditId: "aud_missing" }), (e) => codeOf(e) === "validation.not_found");
});

test("export writes a CSV through the file seam, keeps formulas inert, and says so", async () => {
  const h = await chain();
  await add(h, "=HYPERLINK(\"http://x\")", { resource: { type: "record", id: "rec,1" } });
  h.events.length = 0;
  const saved: { name: string; csv: string }[] = [];
  const exports = { async save(name: string, csv: string) { saved.push({ name, csv }); return "fil_export1"; } };
  const out = await handlers["audit.export"]({ ...h.as(ADMIN, { exports }), authorize: () => ({ effect: "allow", reason: "test", decisionId: "dec_t" }) } as never, { class: "change" });
  assert.deepEqual(out, { fileId: "fil_export1", rows: 2 });
  assert.match(saved[0]!.name, /^audit-2025-10-\d\d-\d\d-\d\d-\d\d\.csv$/);
  const lines = saved[0]!.csv.trimEnd().split("\n");
  assert.equal(lines[0], "at,actor,on_behalf_of,action,resource,class,trace_id,seq");
  assert.equal(lines.length, 3);
  assert.ok(lines[1]!.includes(",grant.created,folder:fld_1,change,"), "oldest first");
  assert.ok(lines[2]!.includes(`"'=HYPERLINK(""http://x"")"`), "a leading = is quoted as text");
  assert.ok(lines[2]!.includes(`"record:rec,1"`));
  assert.deepEqual(h.events, [{ name: "audit.exported", subject: "fil_export1", payload: { by: ADMIN, rows: 2, fileId: "fil_export1" } }]);
  await assert.rejects(handlers["audit.export"](h.as(ADMIN), {}), (e) => codeOf(e) === "internal.not_implemented");
});

test("archive moves old rows to the year file, keeps the chain verifiable through the anchor, and the log carries on", async () => {
  const h = harness(Date.UTC(2023, 11, 30, 12));
  await add(h, "a.2023");
  h.advance(3 * 86_400_000);
  await add(h, "b.2024");
  await add(h, "c.2024");
  h.advance(400 * 86_400_000);
  await add(h, "d.2025");
  const written: { year: number; lines: string[] }[] = [];
  const archive = { async write(year: number, lines: string[]) { written.push({ year, lines }); return { file: `audit-archive/${year}.jsonl.zst`, sizeBytes: lines.join("\n").length }; } };
  h.events.length = 0;

  const before = Date.UTC(2025, 0, 1);
  const out = await handlers["audit.archive"](h.as("svc_governance", { archive }, "service"), { before });
  assert.deepEqual(out, { archived: 3 });
  assert.deepEqual(written.map((w) => [w.year, w.lines.length]), [[2023, 1], [2024, 2]]);
  assert.equal((JSON.parse(written[0]!.lines[0]!) as RowRec).action, "a.2023");
  assert.deepEqual(h.events.map((e) => [e.name, (e.payload as { year: number; rows: number }).year, (e.payload as { rows: number }).rows]), [["audit.archived", 2023, 1], ["audit.archived", 2024, 2]]);
  assert.deepEqual(rowsOf(h).map((r) => r.action), ["d.2025"]);
  assert.deepEqual((await handlers["audit.archives.list"](h.as(ADMIN), {})).archives, [
    { year: 2024, file: "audit-archive/2024.jsonl.zst", rows: 2, sizeBytes: written[1]!.lines.join("\n").length },
    { year: 2023, file: "audit-archive/2023.jsonl.zst", rows: 1, sizeBytes: written[0]!.lines.join("\n").length },
  ]);
  assert.deepEqual(await verify(h), { ok: true, checked: 1 }, "the first row that stayed links to the anchor");
  assert.deepEqual(await handlers["audit.archive"](h.as("svc_governance", { archive }, "service"), { before }), { archived: 0 }, "nothing left to move");

  // archive everything, then keep going: the next row follows the anchor
  await handlers["audit.archive"](h.as("svc_governance", { archive }, "service"), { before: Date.UTC(2030, 0, 1) });
  assert.deepEqual(rowsOf(h), []);
  await add(h, "e.2025");
  assert.equal(rowsOf(h)[0]!.seq, 5);
  assert.deepEqual(await verify(h), { ok: true, checked: 1 });
  h.raw.run(`UPDATE audit_row SET prev_hash = ? WHERE seq = ?`, "forged", 5);
  assert.equal((await verify(h)).firstBadSeq, 5);
  await assert.rejects(handlers["audit.archive"](h.as(ADMIN), { before }), (e) => codeOf(e) === "internal.not_implemented");
});

test("the class an invoke row gets", () => {
  assert.equal(classOfInvoke("deny", "low"), "deny");
  assert.equal(classOfInvoke("hold", "high"), "sensitive");
  assert.equal(classOfInvoke("allow", "low"), "change");
  assert.equal(classOfInvoke("allow", "medium"), "sensitive");
});
