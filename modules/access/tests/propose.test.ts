// access.propose_change (P-L7_21): the View-level Ask. Someone who can only view an object drafts a change; it is stored and goes to the people who can edit as one Review task each; nothing is written to the
// object; a retry answers the same task; with no editor the admins review it. Through the real handler, the answer and the tasks checked against the frozen contract.
// @reads /generated/registry.json
// @reads /modules/access/migrations/0003_requests_reviews.sql
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { handlers } from "../impl.ts";
import { codeOf } from "../fixtures/requestdb.ts";
import { world } from "../fixtures/askworld.ts";

interface RegCap { name: string; input: JsonSchema; output: JsonSchema }
const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { $defs: Record<string, JsonSchema>; capabilities: RegCap[] };
const cap = registry.capabilities.find((c) => c.name === "access.propose_change")!;
const FOLDER = { type: "folder", id: "fld_1" };
const propose = (h: ReturnType<typeof world>["h"], who: string, extra: Record<string, unknown> = {}) =>
  handlers["access.propose_change"](h.as(who), { resource: FOLDER, change: { op: "rename", name: "Rivera matters 2026" }, note: "The year is wrong in the name", idempotencyKey: `idem_${who}`, ...extra } as never);

test("a viewer's proposal becomes one Review task for the people who can edit, and nothing is written to the object", async () => {
  const { h } = world();
  const out = await propose(h, "usr_maya");
  assert.deepEqual(validate(cap.output, out, "", registry.$defs), []);
  const tasks = h.calls.filter((c) => c.cap === "tasks.create");
  assert.equal(tasks.length, 1, "usr_mgr is the only editor of fld_1; the proposer and the admin get no card");
  const t = tasks[0]!.input;
  assert.equal(t["kind"], "review");
  assert.deepEqual(t["assigned"], { kind: "person", id: "usr_mgr" });
  assert.equal(t["summary"], "The year is wrong in the name");
  assert.ok(String(t["why"]).includes("Rivera matters 2026"), "the card shows the change");
  assert.match(String(t["title"]), /proposes a change to Rivera matters/);
  assert.equal(out.taskId, `tsk_${String(t["idempotencyKey"]).replace(/[^a-z0-9]/g, "").slice(-12)}`);
  assert.deepEqual(h.calls.map((c) => c.cap), ["tasks.create"], "only the task is created: no write to the object");
  assert.deepEqual(h.events, [], "no event: the object did not change");
  const row = h.db.own.rows("access_proposals")[0]!;
  assert.deepEqual([row["proposer"], row["resource_type"], row["resource_id"], row["note"]], ["usr_maya", "folder", "fld_1", "The year is wrong in the name"]);
  assert.deepEqual(JSON.parse(String(row["change_json"])), { op: "rename", name: "Rivera matters 2026" });
});

test("the same idempotency key answers the same task and makes nothing new; a different key is a new proposal", async () => {
  const { h } = world();
  const first = await propose(h, "usr_maya");
  const again = await propose(h, "usr_maya");
  assert.deepEqual(again, first);
  assert.equal(h.calls.filter((c) => c.cap === "tasks.create").length, 1);
  assert.equal(h.db.own.rows("access_proposals").length, 1);
  const second = await propose(h, "usr_maya", { idempotencyKey: "idem_two" });
  assert.notEqual(second.taskId, first.taskId);
  assert.equal(h.db.own.rows("access_proposals").length, 2);
});

test("with nobody else who can edit the object the admins review it; with nobody at all the proposal is refused", async () => {
  const { h, store } = world();
  const out = await propose(h, "usr_maya", { resource: { type: "folder", id: "fld_2" }, idempotencyKey: "idem_f2" });
  assert.equal(out.taskId.startsWith("tsk_"), true);
  const t = h.calls.filter((c) => c.cap === "tasks.create").at(-1)!.input;
  assert.deepEqual(t["assigned"], { kind: "person", id: "usr_mgr2" }, "fld_2 has its own Manage holder");
  store.grants.delete("gnt_mgr2");
  store.bump();
  const admin = await propose(h, "usr_maya", { resource: { type: "folder", id: "fld_2" }, idempotencyKey: "idem_f2b" });
  assert.equal(admin.taskId.startsWith("tsk_"), true);
  assert.deepEqual(h.calls.filter((c) => c.cap === "tasks.create").at(-1)!.input["assigned"], { kind: "person", id: "usr_admin" }, "no editor left: the admin");
});

test("an agent proposes for the person it acts for; bad input, a missing object and an oversized change are refused and write nothing", async () => {
  const { h } = world();
  const viaAgent = await handlers["access.propose_change"](h.as("agt_helper", "agent", "usr_maya"), { resource: FOLDER, change: { op: "x" }, idempotencyKey: "idem_agent" } as never);
  assert.equal(viaAgent.taskId.startsWith("tsk_"), true);
  assert.equal(h.db.own.rows("access_proposals")[0]!["proposer"], "usr_maya");
  await assert.rejects(handlers["access.propose_change"](h.as("agt_loose", "agent"), { resource: FOLDER, change: { op: "x" }, idempotencyKey: "i" } as never), (e: unknown) => codeOf(e) === "permission.no_grant");
  await assert.rejects(propose(h, "usr_maya", { change: null, idempotencyKey: "i2" }), (e: unknown) => codeOf(e) === "validation.bad_input");
  await assert.rejects(propose(h, "usr_maya", { resource: { type: "folder", id: "fld_nope" }, idempotencyKey: "i3" }), (e: unknown) => codeOf(e) === "validation.bad_input");
  await assert.rejects(propose(h, "usr_maya", { change: { blob: "x".repeat(70_000) }, idempotencyKey: "i4" }), (e: unknown) => codeOf(e) === "validation.bad_input");
  assert.equal(h.db.own.rows("access_proposals").length, 1, "only the first one was kept");
});
