// @reads ../migrations/0002_audit_targets.sql
import test from "node:test";
import assert from "node:assert/strict";
import { appendRow, findRows } from "../projections.ts";
import { exportCsv } from "../handlers/log.ts";
import { harness } from "../fixtures/db.ts";

test("target-filtered Activity finds older target history behind unrelated rows and paginates exactly", () => {
  const h = harness(); const ctx = h.as("usr_admin");
  const add = (id: string, kind: "role" | "actor" | "group", target: string) => appendRow(ctx, { actor: { kind: "person", id: "usr_admin" }, action: "access.changed", class: "change", targets: [{ kind, id: target }] }, id);
  add("aud_rolefirst", "role", "rol_target");
  for (let i = 0; i < 125; i++) add(`aud_unrelated${i}`, "actor", "act_elsewhere");
  add("aud_rolesecond", "role", "rol_target");
  add("aud_sameidwrongkind", "group", "rol_target");
  const first = findRows(ctx, { target: { kind: "role", id: "rol_target" } }, undefined, 1);
  assert.deepEqual(first.rows.map((row) => row.id), ["aud_rolesecond"]);
  assert.equal(first.more, true);
  const next = findRows(ctx, { target: { kind: "role", id: "rol_target" } }, first.rows[0]!.seq, 1);
  assert.deepEqual(next.rows.map((row) => row.id), ["aud_rolefirst"]);
  assert.equal(next.more, false);
  assert.deepEqual(findRows(ctx, { target: { kind: "role", id: "missing" } }, undefined, 10).rows, []);
  assert.ok(h.raw.log.some((sql) => sql.includes("audit_target")), "filter uses the bounded target index rather than the newest global page");
});

test("untrusted detail fields never become indexed object targets", () => {
  const h = harness(); const ctx = h.as("usr_admin");
  appendRow(ctx, { actor: { kind: "person", id: "usr_admin" }, action: "read", class: "sensitive", after: { targets: [{ kind: "actor", id: "act_forged" }] } }, "aud_detail");
  assert.deepEqual(findRows(ctx, { target: { kind: "actor", id: "act_forged" } }, undefined, 10).rows, []);
});

test("a corrupt derived association cannot make a row match another target", () => {
  const h = harness(); const ctx = h.as("usr_admin");
  const row = appendRow(ctx, { actor: {kind:"person",id:"usr_admin"}, action:"role.updated", class:"change", targets:[{kind:"role",id:"rol_actual"}] }, "aud_bound");
  ctx.db.run("INSERT INTO audit_target (kind, target_id, audit_seq) VALUES (?, ?, ?)", "actor", "act_forged", row.seq);
  assert.deepEqual(findRows(ctx,{target:{kind:"actor",id:"act_forged"}},undefined,10).rows,[]);
});

test("audit CSV applies the same object filter before the owned file writer", async () => {
 const h = harness(); const ctx = h.as("usr_admin");
 appendRow(ctx,{actor:{kind:"person",id:"usr_admin"},action:"role.changed",class:"change",targets:[{kind:"role",id:"rol_one"}]},"aud_exportone");
 appendRow(ctx,{actor:{kind:"person",id:"usr_admin"},action:"other.changed",class:"change",targets:[{kind:"actor",id:"act_other"}]},"aud_exportother");
 let csv = "";
 const out = await exportCsv({...ctx,authorize:()=>({effect:"allow"}) as never,exports:{save:async(_name,body)=>{csv=body;return "fil_owned";}}},{target:{kind:"role",id:"rol_one"}});
 assert.deepEqual(out,{fileId:"fil_owned",rows:1}); assert.ok(csv.includes("role.changed")); assert.ok(!csv.includes("other.changed"));
});
