// Ask for access through the real handlers (spec 4.8, 2.3): a request grants nothing, goes to the Manage holders as a Needs you card, and becomes a grant only when one approves.
// contract tests for the Ask access property: request, approve, retry cycle; a view-only asker never escalates.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { handlers } from "../impl.ts";
import { ASK_LIMIT, resetAskLimit } from "../handlers/request.ts";
import { codeOf } from "../fixtures/requestdb.ts";
import { can, world } from "../fixtures/askworld.ts";

interface RegCap { name: string; input: JsonSchema; output: JsonSchema }
const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { $defs: Record<string, JsonSchema>; capabilities: RegCap[] };
const outputOk = (cap: string, out: unknown): void => {
  const c = registry.capabilities.find((x) => x.name === cap)!;
  assert.deepEqual(validate(c.output, out, "", registry.$defs), [], `${cap} output`);
};

const FOLDER = { type: "folder", id: "fld_1" };
const ask = (h: ReturnType<typeof world>["h"], who: string, extra: Record<string, unknown> = {}) =>
  handlers["access.request"](h.as(who), { resource: FOLDER, level: "edit", note: "I need to file the intake notes", idempotencyKey: `idem_${who}`, ...extra } as never);

test("a request goes to the Manage holders as one Needs you card each, and nobody else", async () => {
  const { h } = world();
  const out = await ask(h, "usr_other");
  outputOk("access.request", out);
  const tasks = h.calls.filter((c) => c.cap === "tasks.create");
  assert.equal(tasks.length, 1, "usr_mgr is the only Manage holder of fld_1; the admin and the asker get no card");
  const t = tasks[0]!.input;
  assert.equal(t["kind"], "unblock");
  assert.deepEqual(t["assigned"], { kind: "person", id: "usr_mgr" });
  assert.deepEqual(t["source"], { kind: "manual", id: out.request.id });
  assert.deepEqual(t["actions"], [{ key: "resolved", label: "Approve" }, { key: "cannot", label: "Decline", note: "optional" }]);
  const block = (t["blocks"] as { type: string; data: Record<string, unknown> }[])[0]!;
  assert.equal(block.type, "access_request");
  assert.deepEqual(block.data, {
    requestId: out.request.id, requester: "usr_other", resource: FOLDER, resourceTitle: "Rivera matters", level: "edit", note: "I need to file the intake notes", state: "waiting",
  });
  assert.deepEqual([out.request.requester, out.request.state, out.request.level, out.request.note], ["usr_other", "waiting", "edit", "I need to file the intake notes"]);
  assert.deepEqual(h.events, [{ name: "access.requested", subject: out.request.id, payload: { requestId: out.request.id, resource: FOLDER, level: "edit", requester: "usr_other", taskId: out.request.taskId } }]);
});

test("Ask access cycle: request, approve, retry. Asking changes nothing; approving gives exactly the level approved, as the approver", async () => {
  const { h, store } = world();
  assert.equal(can(h, store, "usr_other", "view", FOLDER), false, "starts with no access");
  const { request } = await ask(h, "usr_other");
  assert.equal(can(h, store, "usr_other", "view", FOLDER), false, "asking grants nothing");
  assert.equal([...store.grants.values()].some((g) => g.subject.id === "usr_other"), false);

  h.events.length = 0;
  const approved = await handlers["access.requests.approve"](h.as("usr_mgr"), { requestId: request.id });
  outputOk("access.requests.approve", approved);
  assert.deepEqual([approved.grant.subject, approved.grant.resource, approved.grant.level, approved.grant.by, approved.grant.source], [{ kind: "person", id: "usr_other" }, FOLDER, "edit", "usr_mgr", `request:${request.id}`]);
  assert.equal(can(h, store, "usr_other", "edit", FOLDER), true, "the retry now passes");
  assert.equal(can(h, store, "usr_other", "manage", FOLDER), false, "and no further than approved");
  assert.deepEqual(h.events.map((e) => e.name), ["grant.created", "access.changed", "access.granted"]);
  assert.deepEqual(h.events[2]!.payload, { requestId: request.id, resource: FOLDER, level: "edit", requester: "usr_other", grantId: approved.grant.id });
  assert.deepEqual(h.calls.filter((c) => c.cap === "tasks.transition").map((c) => c.input["to"]), ["done"], "the card closes");

  // the request is settled: a second decision is refused, and the requester can ask again (a new cycle) once it is settled
  await assert.rejects(handlers["access.requests.approve"](h.as("usr_mgr"), { requestId: request.id }), (e: unknown) => codeOf(e) === "validation.precondition_failed");
  const next = await ask(h, "usr_other", { level: "manage", idempotencyKey: "idem_again" });
  assert.equal(next.request.state, "waiting");
  assert.notEqual(next.request.id, request.id);
});

test("a view-only asker never escalates: not by asking, not through an agent, not by approving their own request", async () => {
  const { h, store } = world();
  const before = { view: can(h, store, "usr_maya", "view", FOLDER), use: can(h, store, "usr_maya", "use", FOLDER), manage: can(h, store, "usr_maya", "manage", FOLDER) };
  assert.deepEqual(before, { view: true, use: false, manage: false });
  const { request } = await ask(h, "usr_maya", { level: "manage" });
  assert.deepEqual({ view: can(h, store, "usr_maya", "view", FOLDER), use: can(h, store, "usr_maya", "use", FOLDER), manage: can(h, store, "usr_maya", "manage", FOLDER) }, before);
  // she cannot decide her own request, and neither can an agent acting for her
  await assert.rejects(handlers["access.requests.approve"](h.as("usr_maya"), { requestId: request.id }), (e: unknown) => codeOf(e) === "validation.not_found");
  await assert.rejects(handlers["access.requests.approve"](h.as("agt_helper", "agent", "usr_maya"), { requestId: request.id }), (e: unknown) => codeOf(e) === "validation.not_found");
  await assert.rejects(handlers["access.requests.decline"](h.as("usr_maya"), { requestId: request.id }), (e: unknown) => codeOf(e) === "validation.not_found");
  assert.equal(can(h, store, "usr_maya", "manage", FOLDER), false);
  // an agent acting for her may ask on her behalf: the request is hers
  const viaAgent = await handlers["access.request"](h.as("agt_helper", "agent", "usr_maya"), { resource: { type: "folder", id: "fld_2" }, level: "view", idempotencyKey: "idem_agent" });
  assert.equal(viaAgent.request.requester, "usr_maya");
  await assert.rejects(handlers["access.request"](h.as("agt_loose", "agent"), { resource: FOLDER, level: "view", idempotencyKey: "idem_x" }), (e: unknown) => codeOf(e) === "permission.no_grant");
});

test("guests cannot ask, and nothing is created for them", async () => {
  const { h } = world();
  await assert.rejects(ask(h, "usr_gus"), (e: unknown) => codeOf(e) === "permission.guest_cannot_request");
  assert.equal(h.calls.length, 0);
  assert.equal(h.events.length, 0);
});

test("one open request per person and resource; the same idempotency key gives the same request and no second card", async () => {
  const { h } = world();
  const first = await ask(h, "usr_other");
  const replay = await ask(h, "usr_other");
  assert.deepEqual(replay, first);
  assert.equal(h.calls.filter((c) => c.cap === "tasks.create").length, 1);
  assert.equal(h.events.length, 1);
  await assert.rejects(ask(h, "usr_other", { idempotencyKey: "idem_other_key" }), (e: unknown) => codeOf(e) === "validation.duplicate");
  // a different resource is a different request
  const elsewhere = await ask(h, "usr_other", { resource: { type: "folder", id: "fld_2" }, idempotencyKey: "idem_fld2" });
  assert.notEqual(elsewhere.request.id, first.request.id);
  assert.deepEqual(h.calls.filter((c) => c.cap === "tasks.create").map((c) => (c.input["assigned"] as { id: string }).id), ["usr_mgr", "usr_mgr2"]);
});

test("a request for the Space, or for a resource nobody manages, goes to the admins", async () => {
  const { h, store } = world();
  // a real resource that nobody manages (an id that is not a resource at all is the made-up case, tested below)
  store.resources.set("fld_unmanaged", { id: "fld_unmanaged", type: "folder", parentId: null, label: "internal", ownerId: null, holds: 0, row: {} });
  await ask(h, "usr_other", { resource: { type: "space", id: "spc_test" }, level: "manage", idempotencyKey: "idem_s" });
  await ask(h, "usr_maya", { resource: { type: "folder", id: "fld_unmanaged" }, level: "view", idempotencyKey: "idem_u" });
  assert.deepEqual(h.calls.filter((c) => c.cap === "tasks.create").map((c) => (c.input["assigned"] as { id: string }).id), ["usr_admin", "usr_admin"]);
  // the title falls back to the type and id when the resource has no name
  const blocks = h.calls.filter((c) => c.cap === "tasks.create").map((c) => ((c.input["blocks"] as { data: { resourceTitle: string } }[])[0]!.data.resourceTitle));
  assert.deepEqual(blocks, ["space spc_test", "folder fld_unmanaged"]);
});

test("a card that cannot be created stops the request before anything is stored", async () => {
  const { h } = world({ "tasks.create": new Error("tasks are down") });
  await assert.rejects(ask(h, "usr_other"), /tasks are down/);
  assert.equal(h.db.own.rows("access_requests").length, 0);
  assert.equal(h.events.length, 0);
});

test("approve gives the level the approver chooses, never more than they hold", async () => {
  const { h, store } = world();
  const { request } = await ask(h, "usr_other", { level: "manage" });
  const lower = await handlers["access.requests.approve"](h.as("usr_mgr"), { requestId: request.id, level: "use" });
  assert.equal(lower.grant.level, "use");
  assert.equal(can(h, store, "usr_other", "use", FOLDER), true);
  assert.equal(can(h, store, "usr_other", "edit", FOLDER), false);

  // an approver who has since dropped to Edit cannot hand out Manage
  const second = await ask(h, "usr_maya", { level: "manage", idempotencyKey: "idem_m" });
  store.grants.get("gnt_mgr1")!.level = "edit";
  store.bump();
  await assert.rejects(handlers["access.requests.approve"](h.as("usr_mgr"), { requestId: second.request.id }), (e: unknown) => codeOf(e) === "permission.not_contained");
  assert.equal((await handlers["access.requests.approve"](h.as("usr_mgr"), { requestId: second.request.id, level: "edit" })).grant.level, "edit");
});

test("decline records the note, tells the requester, grants nothing and closes the card", async () => {
  const { h, store } = world();
  const { request } = await ask(h, "usr_other");
  h.events.length = 0;
  h.calls.length = 0;
  assert.deepEqual(await handlers["access.requests.decline"](h.as("usr_mgr"), { requestId: request.id, note: "Ask Rivera's lead first" }), { ok: true });
  assert.deepEqual(h.events, [{ name: "access.declined", subject: request.id, payload: { requestId: request.id, resource: FOLDER, requester: "usr_other", note: "Ask Rivera's lead first" } }]);
  assert.equal(can(h, store, "usr_other", "view", FOLDER), false);
  assert.deepEqual(h.calls.map((c) => [c.cap, c.input["to"], c.input["note"]]), [["tasks.transition", "canceled", "Declined: Ask Rivera's lead first"]]);
  await assert.rejects(handlers["access.requests.approve"](h.as("usr_mgr"), { requestId: request.id }), (e: unknown) => codeOf(e) === "validation.precondition_failed");
});

test("only the people the request went to can decide it; anyone else gets not found", async () => {
  const { h } = world();
  const { request } = await ask(h, "usr_other");
  for (const who of ["usr_mgr2", "usr_admin", "usr_maya"]) {
    await assert.rejects(handlers["access.requests.approve"](h.as(who), { requestId: request.id }), (e: unknown) => codeOf(e) === "validation.not_found", who);
  }
  await assert.rejects(handlers["access.requests.decline"](h.as("usr_mgr"), { requestId: "arq_nope" }), (e: unknown) => codeOf(e) === "validation.not_found");
});

test("a card that will not close is logged and the decision stands", async () => {
  const { h, store } = world({ "tasks.transition": new Error("tasks are down") });
  const { request } = await ask(h, "usr_other");
  const out = await handlers["access.requests.approve"](h.as("usr_mgr"), { requestId: request.id });
  assert.equal(can(h, store, "usr_other", "edit", FOLDER), true);
  assert.equal(out.grant.level, "edit");
  assert.deepEqual(h.warnings, ["access request card did not close"]);
});

test("the list shows what I asked and what waits on me, by state, newest first, with paging", async () => {
  const { h } = world();
  const a = await ask(h, "usr_other");
  h.advance(1000);
  const b = await ask(h, "usr_maya", { level: "edit", idempotencyKey: "idem_b" });
  h.advance(1000);
  const c = await ask(h, "usr_other", { resource: { type: "folder", id: "fld_2" }, idempotencyKey: "idem_c" });
  const mineOther = await handlers["access.requests.list"](h.as("usr_other"), { mine: true });
  outputOk("access.requests.list", mineOther);
  assert.deepEqual(mineOther.requests.map((r) => r.id), [c.request.id, a.request.id]);
  assert.deepEqual((await handlers["access.requests.list"](h.as("usr_mgr"), {})).requests.map((r) => r.id), [b.request.id, a.request.id], "waiting on the folder's Manage holder");
  assert.deepEqual((await handlers["access.requests.list"](h.as("usr_mgr2"), {})).requests.map((r) => r.id), [c.request.id]);
  assert.deepEqual((await handlers["access.requests.list"](h.as("usr_admin"), {})).requests, []);
  await handlers["access.requests.decline"](h.as("usr_mgr"), { requestId: a.request.id });
  assert.deepEqual((await handlers["access.requests.list"](h.as("usr_mgr"), { state: "declined" })).requests.map((r) => r.id), [a.request.id]);
  assert.deepEqual((await handlers["access.requests.list"](h.as("usr_mgr"), { state: "waiting" })).requests.map((r) => r.id), [b.request.id]);
  const first = await handlers["access.requests.list"](h.as("usr_other"), { mine: true, limit: 1 });
  assert.equal(first.total, 2);
  const rest = await handlers["access.requests.list"](h.as("usr_other"), { mine: true, limit: 1, cursor: first.next! });
  assert.deepEqual([first.requests[0]!.id, rest.requests[0]!.id], [c.request.id, a.request.id]);
  assert.equal(rest.next, undefined);
});

test("a member without view gets the same accepted answer for a real id and a made-up one; only the real one creates a request, a card and an event", async () => {
  const { h, store } = world();
  resetAskLimit();
  assert.equal(can(h, store, "usr_other", "view", FOLDER), false, "usr_other cannot see the folder");
  const real = await ask(h, "usr_other", { idempotencyKey: "idem_real" });
  const cardsAfterReal = h.calls.filter((c) => c.cap === "tasks.create").length;
  const eventsAfterReal = h.events.length;
  const fake = await ask(h, "usr_other", { resource: { type: "folder", id: "fld_made_up" }, idempotencyKey: "idem_fake" });
  outputOk("access.request", real);
  outputOk("access.request", fake);
  assert.deepEqual(Object.keys(fake.request).sort(), Object.keys(real.request).sort());
  assert.equal(fake.request.state, "waiting");
  assert.equal(fake.request.requester, "usr_other");
  assert.equal(h.calls.filter((c) => c.cap === "tasks.create").length, cardsAfterReal, "a made-up id makes no card");
  assert.equal(h.events.length, eventsAfterReal, "a made-up id emits nothing");
  const listed = await handlers["access.requests.list"](h.as("usr_other"), { mine: true } as never);
  assert.deepEqual(listed.requests.map((r: { id: string }) => r.id), [real.request.id], "only the real request is stored");
});

test("the rate limit counts real and made-up asks alike, per requester", async () => {
  const { h } = world();
  resetAskLimit();
  for (let i = 0; i < ASK_LIMIT; i++) await ask(h, "usr_other", { resource: { type: "folder", id: `fld_nope_${i}` }, idempotencyKey: `idem_n${i}` });
  await assert.rejects(ask(h, "usr_other", { idempotencyKey: "idem_over" }), (e: unknown) => codeOf(e) === "rate_limit.exceeded");
  await assert.rejects(ask(h, "usr_other", { resource: { type: "folder", id: "fld_nope_x" }, idempotencyKey: "idem_over2" }), (e: unknown) => codeOf(e) === "rate_limit.exceeded");
  const maya = await ask(h, "usr_maya", { idempotencyKey: "idem_maya" });
  assert.equal(maya.request.state, "waiting", "another requester has their own allowance");
});
