// Promotion (spec 2.15, 4.15): a person's fact moves to the agent, a project or the Space only through memory.promote. A person who can edit the target is done at once;
// otherwise a task goes to the right approver, and approving, rejecting and undoing carry names and times. Nothing is ever copied between layers any other way.
import test from "node:test";
import assert from "node:assert/strict";
import { erase, factGet, factsList, promote, promotionApprove, promotionReject, promotionUndo, proposeFact, search } from "../handlers/facts.ts";
import { assertEventsConform, asPerson, codeOf, contractErrors, harness, NOW } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const respond = {
  "agents.get": () => ({ agent: { folderId: "fld_intake", ownerId: "usr_boss" } }),
  "projects.get": () => ({ project: { folderId: "fld_harlow", lead: "usr_lead" } }),
};

async function danaFact(h: Harness, text = "Dana signs off every proposal herself") {
  const out = await proposeFact(h.ctx, { text, kind: "preference", sourceKind: "chat", sourceRef: "thr_one", agentId: "agt_intake" });
  return out.fact.factId;
}

test("a person who can edit the target promotes at once, with their name and time, and the personal fact stays", async () => {
  const h = harness({ respond });
  const id = await danaFact(h);
  h.advance(5000);
  const out = await promote(h.ctx, { factId: id, toLayer: "agent", agentId: "agt_intake" });
  assert.equal(out.promoted, true);
  assert.equal(out.taskId, undefined);
  assert.deepEqual(contractErrors("memory.promote", "out", out), []);
  const shared = (await factsList(h.ctx, { layer: "agent" })).facts;
  assert.equal(shared.length, 1);
  assert.equal(shared[0]?.text, "Dana signs off every proposal herself");
  assert.equal(shared[0]?.ownerRef, "agt_intake");
  const row = h.rows("SELECT text, enc, promoted_from, promoted_by, promoted_at FROM memory_facts WHERE layer = 'agent'")[0]!;
  assert.equal(row["text"], "Dana signs off every proposal herself");
  assert.equal(row["enc"], 0);
  assert.equal(row["promoted_from"], id);
  assert.equal(row["promoted_by"], "usr_dana");
  assert.equal(row["promoted_at"], NOW + 5000);
  assert.equal(h.rows("SELECT status FROM memory_facts WHERE id = ?", id)[0]?.["status"], "current");
  assert.equal(h.named("memory.promotion_requested").length, 1);
  assert.equal(h.named("memory.promoted").length, 1);
  assert.equal(h.calls("tasks.create").length, 0);
  assert.deepEqual(assertEventsConform(h), []);
});

test("without edit access a task goes to the agent's owner, and nothing is copied until it is approved", async () => {
  const h = harness({ respond, readOnly: ["folder:fld_intake"] });
  const id = await danaFact(h);
  const out = await promote(h.ctx, { factId: id, toLayer: "agent", agentId: "agt_intake", note: "useful for everyone" });
  assert.equal(out.promoted, false);
  assert.equal(out.taskId, "tsk_prom1");
  assert.equal((await factsList(h.ctx, { layer: "agent" })).facts.length, 0);
  const task = h.calls("tasks.create")[0]!.input;
  assert.deepEqual(task["assigned"], { id: "usr_boss", kind: "person" });
  assert.equal(task["kind"], "approve");
  assert.equal(task["idempotencyKey"], `memprom:${out.promotionId}`);
  assert.deepEqual(h.named("memory.promotion_requested")[0]?.payload["taskId"], "tsk_prom1");
  // Asking twice does not make a second request.
  const again = await promote(h.ctx, { factId: id, toLayer: "agent", agentId: "agt_intake" });
  assert.equal(again.promotionId, out.promotionId);
  assert.equal(h.calls("tasks.create").length, 1);

  const boss = asPerson(h, { kind: "person", id: "usr_boss" }, { respond });
  const approved = await promotionApprove(boss.ctx, { promotionId: out.promotionId });
  assert.equal(approved.fact.layer, "agent");
  assert.equal(approved.fact.text, "Dana signs off every proposal herself");
  assert.deepEqual(contractErrors("memory.promotion.approve", "out", approved), []);
  assert.equal(h.rows("SELECT promoted_by FROM memory_facts WHERE layer = 'agent'")[0]?.["promoted_by"], "usr_boss");
  assert.deepEqual(boss.calls("tasks.transition")[0]?.input, { taskId: "tsk_prom1", to: "done", note: "Approved" });
  await assert.rejects(() => promotionApprove(boss.ctx, { promotionId: out.promotionId }), (e) => codeOf(e) === "validation.precondition_failed");
  assert.deepEqual(assertEventsConform(h), []);
});

test("only someone who can edit the target approves; the requester cannot approve their own request", async () => {
  const h = harness({ respond, readOnly: ["folder:fld_intake"] });
  const out = await promote(h.ctx, { factId: await danaFact(h), toLayer: "agent", agentId: "agt_intake" });
  await assert.rejects(() => promotionApprove(h.ctx, { promotionId: out.promotionId }), (e) => codeOf(e) === "permission.no_grant");
  await assert.rejects(() => promotionApprove(h.ctx, { promotionId: "prm_nothing" }), (e) => codeOf(e) === "validation.bad_input");
});

test("reject keeps the request on record with a note, closes the task, and leaves the personal fact", async () => {
  const h = harness({ respond, readOnly: ["folder:fld_intake"] });
  const id = await danaFact(h);
  const out = await promote(h.ctx, { factId: id, toLayer: "agent", agentId: "agt_intake" });
  const boss = asPerson(h, { kind: "person", id: "usr_boss" }, { respond });
  const res = await promotionReject(boss.ctx, { promotionId: out.promotionId, note: "too specific" });
  assert.deepEqual(res, { ok: true });
  assert.equal(h.rows("SELECT status, note, decided_by FROM memory_promotions")[0]?.["status"], "rejected");
  assert.equal(h.rows("SELECT note FROM memory_promotions")[0]?.["note"], "too specific");
  assert.equal(boss.named("memory.promotion_rejected").length, 1);
  assert.deepEqual(boss.calls("tasks.transition")[0]?.input["to"], "canceled");
  assert.equal(h.rows("SELECT id FROM memory_facts WHERE layer = 'agent'").length, 0);
  await assert.rejects(() => promotionReject(boss.ctx, { promotionId: out.promotionId }), (e) => codeOf(e) === "validation.bad_input");
  // The requester may withdraw their own request.
  const second = await promote(h.ctx, { factId: id, toLayer: "agent", agentId: "agt_intake" });
  assert.deepEqual(await promotionReject(h.ctx, { promotionId: second.promotionId }), { ok: true });
});

test("undo closes the shared copy and keeps the personal fact", async () => {
  const h = harness({ respond });
  const id = await danaFact(h);
  const out = await promote(h.ctx, { factId: id, toLayer: "space" });
  assert.equal(out.promoted, true);
  assert.equal((await factsList(h.ctx, { layer: "space" })).facts.length, 1);
  h.advance(1000);
  assert.deepEqual(await promotionUndo(h.ctx, { promotionId: out.promotionId }), { ok: true });
  assert.equal((await factsList(h.ctx, { layer: "space" })).facts.length, 0);
  const copy = h.rows("SELECT status, valid_to FROM memory_facts WHERE layer = 'space'")[0]!;
  assert.equal(copy["status"], "closed");
  assert.equal(copy["valid_to"], NOW + 1000);
  assert.equal((await factGet(h.ctx, { factId: id })).fact.status, "current");
  assert.equal(h.named("memory.promotion_undone").length, 1);
  await assert.rejects(() => promotionUndo(h.ctx, { promotionId: out.promotionId }), (e) => codeOf(e) === "validation.bad_input");
});

test("a project promotion goes to the project lead, and project and Space layers need the right ids", async () => {
  const h = harness({ respond, readOnly: ["folder:fld_harlow"] });
  const id = await danaFact(h, "Harlow likes the calm tone");
  await assert.rejects(() => promote(h.ctx, { factId: id, toLayer: "project" }), (e) => codeOf(e) === "validation.bad_input");
  const out = await promote(h.ctx, { factId: id, toLayer: "project", projectId: "prj_harlow" });
  assert.equal(out.promoted, false);
  assert.deepEqual(h.calls("tasks.create")[0]?.input["assigned"], { id: "usr_lead", kind: "person" });
});

test("a Space promotion without edit goes to the admins as a role", async () => {
  const h = harness({ respond });
  h.deny("space:spc_memorytest");
  const id = await danaFact(h);
  // The person may not even edit the Space layer; the request is still allowed because they can see their own fact.
  const out = await promote(h.ctx, { factId: id, toLayer: "space" });
  assert.equal(out.promoted, false);
  assert.deepEqual(h.calls("tasks.create")[0]?.input["assigned"], { id: "admin", kind: "role" });
});

test("a task module that is down leaves nothing half done", async () => {
  const h = harness({ respond: { ...respond, "tasks.create": () => { throw new Error("tasks is down"); } }, readOnly: ["folder:fld_intake"] });
  const id = await danaFact(h);
  await assert.rejects(() => promote(h.ctx, { factId: id, toLayer: "agent", agentId: "agt_intake" }), (e) => codeOf(e) === "internal.unexpected");
  assert.equal(h.rows("SELECT id FROM memory_promotions").length, 0);
});

test("only a current fact the person can see is promoted, and not into the layer it is already in", async () => {
  const h = harness({ respond });
  const proposed = (await proposeFact(h.ctx, { text: "Dana wants a weekly recap", kind: "note", sourceKind: "chat", sourceRef: "t", agentId: "agt_intake" })).fact.factId;
  await assert.rejects(() => promote(h.ctx, { factId: proposed, toLayer: "space" }), (e) => codeOf(e) === "validation.bad_input");
  const omar = asPerson(h, { kind: "person", id: "usr_omar" }, { respond });
  const mine = await danaFact(h, "Dana avoids Monday meetings");
  await assert.rejects(() => promote(omar.ctx, { factId: mine, toLayer: "space" }), (e) => codeOf(e) === "permission.no_grant");
});

test("erasing the source erases its promoted copy too, and the shared copy was searchable until then", async () => {
  const h = harness({ respond });
  const id = await danaFact(h, "Dana bills in quarter hours");
  await promote(h.ctx, { factId: id, toLayer: "space" });
  const omar = asPerson(h, { kind: "person", id: "usr_omar" }, { respond });
  const seen = await search(omar.ctx, { q: "quarter hours billing" });
  assert.equal(seen.hits.length, 1, "Omar finds the shared copy, never the personal fact");
  assert.equal(seen.hits[0]?.layer, "space");
  assert.equal((await erase(h.ctx, { factIds: [id] })).erased, 2);
  assert.equal(h.rows("SELECT id FROM memory_facts").length, 0);
  assert.equal((await search(omar.ctx, { q: "quarter hours billing" })).hits.length, 0);
});

test("golden 8 trace: a person-layer fact, a promotion task for the approver, the project layer", async () => {
  // Steps of golden flow 8 (golden/flows/08-memory-promotion.flow.ts): the events are the ones the flow lists, in order.
  const h = harness({ respond, readOnly: ["folder:fld_harlow"] });
  const fact = await proposeFact(h.ctx, { text: "Harlow wants proofs a day early", kind: "preference", sourceKind: "chat", sourceRef: "thr_golden", agentId: "agt_intake" });
  assert.equal(fact.fact.layer, "person");
  assert.equal(fact.merged, true);
  const ask = await promote(h.ctx, { factId: fact.fact.factId, toLayer: "project", projectId: "prj_harlow", note: "the whole team should know" });
  assert.equal(ask.promoted, false);
  assert.ok(ask.taskId);
  assert.equal((await factsList(h.ctx, { layer: "project" })).facts.length, 0, "nothing is shared before the approver says yes");
  const lead = asPerson(h, { kind: "person", id: "usr_lead" }, { respond });
  const done = await promotionApprove(lead.ctx, { promotionId: ask.promotionId });
  assert.equal(done.fact.layer, "project");
  assert.equal(done.fact.ownerRef, "prj_harlow");
  const names = [...h.emitted, ...lead.emitted].map((e) => e.name);
  assert.deepEqual(names, ["memory.fact_proposed", "memory.fact_accepted", "memory.promotion_requested", "memory.promoted"]);
  const promoted = lead.named("memory.promoted")[0]!.payload;
  assert.equal(promoted["by"], "usr_lead");
  assert.equal(h.rows("SELECT promoted_by FROM memory_facts WHERE layer = 'project'")[0]?.["promoted_by"], "usr_lead");
  assert.deepEqual(assertEventsConform(h), []);
  assert.deepEqual(assertEventsConform(lead), []);
});

// Ruling 88: a member's Space-wide Edit reaches an agent's folder by inheritance and does not make its memory theirs to edit.
const inherited = { "access.shares_of": () => ({ shares: [{ grant: { subject: { kind: "role", id: "rol_member" }, level: "edit" }, through: "folder" }, { grant: { subject: { kind: "person", id: "usr_boss" }, level: "manage" }, through: "owner" }] }) };

test("a member whose Edit is only inherited from the Space does not edit an agent's memory: the promotion waits for its owner", async () => {
  const h = harness({ respond: { ...respond, ...inherited } });
  const id = await danaFact(h);
  const out = await promote(h.ctx, { factId: id, toLayer: "agent", agentId: "agt_intake" });
  assert.equal(out.promoted, false);
  assert.ok(out.taskId, "a task waits for the approver");
});

test("the agent's owner, an admin, and a person the owner shared the folder with do edit it", async () => {
  const owner = harness({ respond: { ...respond, ...inherited, "agents.get": () => ({ agent: { folderId: "fld_intake", ownerId: "usr_dana" } }) } });
  assert.equal((await promote(owner.ctx, { factId: await danaFact(owner), toLayer: "agent", agentId: "agt_intake" })).promoted, true, "the owner");
  const admin = harness({ respond: { ...respond, ...inherited } });
  admin.setAdmin(true);
  assert.equal((await promote(admin.ctx, { factId: await danaFact(admin), toLayer: "agent", agentId: "agt_intake" })).promoted, true, "an admin");
  const shared = harness({ respond: { ...respond, "access.shares_of": () => ({ shares: [{ grant: { subject: { kind: "person", id: "usr_dana" }, level: "edit" }, through: "direct" }] }) } });
  assert.equal((await promote(shared.ctx, { factId: await danaFact(shared), toLayer: "agent", agentId: "agt_intake" })).promoted, true, "a direct Edit share");
});

test("a member of a group the owner shared the agent's folder with at Edit does edit its memory; a member of no such group does not", async () => {
  const shares = () => ({ shares: [
    { grant: { subject: { kind: "role", id: "rol_member" }, level: "edit" }, through: "folder" },
    { grant: { subject: { kind: "group", id: "grp_billing" }, level: "edit" }, through: "group" },
  ] });
  const inGroup = harness({ respond: { ...respond, "access.shares_of": shares, "access.groups.get": () => ({ group: { id: "grp_billing", members: [{ kind: "person", id: "usr_dana" }, { kind: "person", id: "usr_kim" }] } }) } });
  assert.equal((await promote(inGroup.ctx, { factId: await danaFact(inGroup), toLayer: "agent", agentId: "agt_intake" })).promoted, true, "in the Billing team");
  const outside = harness({ respond: { ...respond, "access.shares_of": shares, "access.groups.get": () => ({ group: { id: "grp_billing", members: [{ kind: "person", id: "usr_kim" }] } }) } });
  const out = await promote(outside.ctx, { factId: await danaFact(outside), toLayer: "agent", agentId: "agt_intake" });
  assert.equal(out.promoted, false, "not in it, the inherited Edit alone does not count");
});
