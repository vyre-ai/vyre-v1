// Diff cards through the real handlers (spec 3.10, ARCH 7.10): propose records, Apply runs as the person and is audited "on behalf of", Reject records.
// contract tests for apply: apply is audited on behalf of the proposing agent; only Space-owned objects.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { BUG_MESSAGE } from "../projections.ts";
import { ALL_PERMS, codeOf, harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";

const BOSS = "usr_boss";
const ASSISTANT = "agt_asst";

async function seeded(allow: string[] = ALL_PERMS, more: Record<string, unknown> = {}) {
  const h = harness({
    "agents.list": { agents: [{ agentId: ASSISTANT, ownerId: BOSS, role: "assistant" }] },
    "chat.start": { threadId: "thr_console1" },
    "threads.update": { threadId: "thr_console1" },
    "settings.set_space": { key: "x" },
    "audit.append": { auditId: "aud_a1b2c3" },
    "access.propose_change": { taskId: "tsk_a1b2c3" },
    ...more,
  }, allow);
  const { threadId } = await handlers["console.assistant_open"](h.as(BOSS), { page: "console.overview", idempotencyKey: "idem_1" });
  h.calls.length = 0;
  return { h, threadId };
}

type Card = Parameters<(typeof handlers)["console.diff_propose"]>[1]["diff"];
const card = (diffId: string, kind: Card["kind"], changes: Card["changes"], title = "A change"): Card => ({ diffId, kind, title, changes });
const byAgent = (h: Harness) => h.as(ASSISTANT, "agent", BOSS);
const proposeAs = (h: Harness, threadId: string, diff: Card) => handlers["console.diff_propose"](byAgent(h), { threadId, diff, idempotencyKey: "idem_p" });
const capsCalled = (h: Harness) => h.calls.map((c) => c.cap);
const SETTING = (id = "dif_a1") => card(id, "setting", [{ path: "ui.density", before: "roomy", after: "compact" }], "Use compact rows");

test("propose records the card as the agent acting for the person, emits once, and the same card again is the same proposal", async () => {
  const { h, threadId } = await seeded();
  assert.deepEqual(await proposeAs(h, threadId, SETTING()), { diffId: "dif_a1" });
  const row = h.raw.rows("console_assistant_diff")[0]!;
  assert.deepEqual([row["diff_id"], row["thread_id"], row["kind"], row["state"], row["proposed_by_kind"], row["proposed_by_id"]], ["dif_a1", threadId, "setting", "proposed", "agent", ASSISTANT]);
  assert.deepEqual(h.events, [{ name: "console.change_proposed", subject: "dif_a1", payload: { diffId: "dif_a1", kind: "setting", threadId } }]);
  assert.deepEqual(h.calls, [], "nothing is applied by proposing");
  assert.deepEqual(await proposeAs(h, threadId, SETTING()), { diffId: "dif_a1" });
  assert.equal(h.raw.rows("console_assistant_diff").length, 1);
  assert.equal(h.events.length, 1, "no second event");
});

test("propose refuses another person's thread, an unknown thread, and a card id that belongs to another thread", async () => {
  const { h, threadId } = await seeded();
  await assert.rejects(handlers["console.diff_propose"](h.as("usr_other"), { threadId, diff: SETTING(), idempotencyKey: "idem_p" }), (e: unknown) => codeOf(e) === "validation.not_found");
  await assert.rejects(proposeAs(h, "thr_nope", SETTING()), (e: unknown) => codeOf(e) === "validation.not_found");
  await proposeAs(h, threadId, SETTING());
  // a second person with their own thread cannot take the id
  h.answers.set("agents.list", { agents: [{ agentId: "agt_b", ownerId: "usr_b", role: "assistant" }] });
  h.answers.set("chat.start", { threadId: "thr_console2" });
  const second = await handlers["console.assistant_open"](h.as("usr_b"), { page: "console.overview", idempotencyKey: "idem_2" });
  await assert.rejects(handlers["console.diff_propose"](h.as("usr_b"), { threadId: second.threadId, diff: SETTING(), idempotencyKey: "idem_p" }), (e: unknown) => codeOf(e) === "validation.duplicate");
});

test("a product bug is never a card: it points to the support bundle", async () => {
  const { h, threadId } = await seeded();
  await assert.rejects(proposeAs(h, threadId, card("dif_bug", "config", [{ path: "product:sync/off-by-one", before: null, after: "patched" }])), (e: unknown) => {
    const err = (e as { error: { code: string; message: string } }).error;
    return err.code === "validation.precondition_failed" && err.message === BUG_MESSAGE;
  });
  assert.equal(h.raw.rows("console_assistant_diff").length, 0);
  assert.equal(h.events.length, 0);
});

test("Apply runs the change as the person, writes an audit row on behalf of the proposing agent, and says so in the event", async () => {
  const { h, threadId } = await seeded();
  await proposeAs(h, threadId, SETTING());
  h.events.length = 0;
  const out = await handlers["console.diff_apply"](h.as(BOSS), { diffId: "dif_a1" });
  assert.deepEqual(out, { applied: true, auditId: "aud_a1b2c3" });
  assert.deepEqual(h.calls[0], { cap: "settings.set_space", input: { key: "ui.density", value: "compact" } });
  const audit = h.calls[1]!;
  assert.equal(audit.cap, "audit.append");
  assert.equal(audit.input["action"], "console.change_applied");
  assert.equal(audit.input["class"], "admin");
  assert.deepEqual(audit.input["onBehalfOf"], { kind: "agent", id: ASSISTANT }, "the audit row reads on behalf of the assistant");
  assert.deepEqual((audit.input["detail"] as { changes: unknown[] }).changes, [{ path: "ui.density", before: "roomy", after: "compact" }]);
  assert.deepEqual(h.events, [{ name: "console.change_applied", subject: "dif_a1", payload: { diffId: "dif_a1", kind: "setting", by: BOSS, onBehalfOf: ASSISTANT } }]);
  const row = h.raw.rows("console_assistant_diff")[0]!;
  assert.deepEqual([row["state"], row["decided_by"], row["audit_id"]], ["applied", BOSS, "aud_a1b2c3"]);
});

test("a card the person wrote themselves has no on-behalf-of", async () => {
  const { h, threadId } = await seeded();
  await handlers["console.diff_propose"](h.as(BOSS), { threadId, diff: SETTING("dif_mine"), idempotencyKey: "idem_p" });
  h.events.length = 0;
  await handlers["console.diff_apply"](h.as(BOSS), { diffId: "dif_mine" });
  const audit = h.calls.find((c) => c.cap === "audit.append")!;
  assert.equal("onBehalfOf" in audit.input, false);
  assert.deepEqual(h.events[0]!.payload, { diffId: "dif_mine", kind: "setting", by: BOSS });
});

test("Apply twice changes nothing the second time", async () => {
  const { h, threadId } = await seeded();
  await proposeAs(h, threadId, SETTING());
  await handlers["console.diff_apply"](h.as(BOSS), { diffId: "dif_a1" });
  h.calls.length = 0;
  h.events.length = 0;
  assert.deepEqual(await handlers["console.diff_apply"](h.as(BOSS), { diffId: "dif_a1" }), { applied: true, auditId: "aud_a1b2c3" });
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.events, []);
});

test("only a person applies, and only on their own thread", async () => {
  const { h, threadId } = await seeded();
  await proposeAs(h, threadId, SETTING());
  h.calls.length = 0;
  await assert.rejects(handlers["console.diff_apply"](byAgent(h), { diffId: "dif_a1" }), (e: unknown) => codeOf(e) === "permission.role_lacks_permission");
  await assert.rejects(handlers["console.diff_apply"](h.as("usr_other"), { diffId: "dif_a1" }), (e: unknown) => codeOf(e) === "validation.not_found");
  await assert.rejects(handlers["console.diff_apply"](h.as(BOSS), { diffId: "dif_nope" }), (e: unknown) => codeOf(e) === "validation.not_found");
  assert.deepEqual(h.calls, [], "nothing ran");
  assert.equal(h.raw.rows("console_assistant_diff")[0]!["state"], "proposed");
});

test("each kind of card becomes the capability calls of its own screen", async () => {
  const { h, threadId } = await seeded(ALL_PERMS, {
    "access.roles.update": {}, "access.roles.preview": { previewHash: "hash1", gains: [], losses: [] }, "access.roles.apply": {},
    "access.grants.update": {}, "access.policies.set": {}, "access.policies.reset": {}, "schema.apply": {}, "connections.pause": {}, "connections.resume": {}, "logs.settings_set": {},
  });
  const cards: [Card, string[]][] = [
    [card("dif_role", "role", [{ path: "rol_a1/name", before: "A", after: "Billing" }, { path: "rol_a1/clearance", before: "internal", after: "confidential" }, { path: "rol_a1/permissions", before: [], after: ["records.view"] }]),
      ["access.roles.update", "access.roles.preview", "access.roles.apply", "audit.append"]],
    [card("dif_grant", "grant", [{ path: "gnt_a1/level", before: "view", after: "edit" }]), ["access.grants.update", "audit.append"]],
    [card("dif_pol", "policy", [{ path: "space/files.external_share", before: true, after: false }, { path: "mail.send_floor", before: 1, after: null }]), ["access.policies.set", "access.policies.reset", "audit.append"]],
    [card("dif_schema", "schema", [{ path: "ops", before: [], after: [{ op: "add_field" }] }]), ["schema.apply", "audit.append"]],
    [card("dif_conn", "connector", [{ path: "con_a1/paused", before: false, after: true }]), ["connections.pause", "audit.append"]],
    [card("dif_conn2", "connector", [{ path: "con_a1/paused", before: true, after: false }]), ["connections.resume", "audit.append"]],
    [card("dif_cfg", "config", [{ path: "logging/level", before: "info", after: "debug" }, { path: "logging/fullDays", before: 7, after: 14 }]), ["logs.settings_set", "audit.append"]],
  ];
  for (const [c] of cards) await proposeAs(h, threadId, c);
  for (const [c, caps] of cards) {
    h.calls.length = 0;
    const out = await handlers["console.diff_apply"](h.as(BOSS), { diffId: c.diffId });
    assert.equal(out.applied, true, c.diffId);
    assert.deepEqual(capsCalled(h), caps, c.diffId);
  }
  // the role card sent exactly what the preview showed
  h.calls.length = 0;
  const roleCalls = await (async () => {
    await proposeAs(h, threadId, card("dif_role2", "role", [{ path: "rol_a2/permissions", before: [], after: ["files.view"] }]));
    await handlers["console.diff_apply"](h.as(BOSS), { diffId: "dif_role2" });
    return h.calls;
  })();
  assert.deepEqual(roleCalls[1], { cap: "access.roles.apply", input: { roleId: "rol_a2", permissions: ["files.view"], previewHash: "hash1" } });
});

test("only Space-owned objects: a path that does not name one is refused when Apply runs, with nothing called", async () => {
  const { h, threadId } = await seeded();
  const bad: Card[] = [
    card("dif_b1", "role", [{ path: "somebody/name", before: "a", after: "b" }]),
    card("dif_b2", "role", [{ path: "rol_a1/owner", before: "a", after: "b" }]),
    card("dif_b3", "grant", [{ path: "gnt_a1/subject", before: "a", after: "b" }]),
    card("dif_b4", "config", [{ path: "caddy/admin", before: "a", after: "b" }]),
    card("dif_b5", "config", [{ path: "logging/level", before: "info", after: "chatty" }]),
    card("dif_b6", "connector", [{ path: "con_a1/token", before: "a", after: "b" }]),
    card("dif_b7", "schema", [{ path: "types/lead", before: "a", after: "b" }]),
    card("dif_b8", "setting", []),
  ];
  for (const c of bad) await proposeAs(h, threadId, c);
  h.calls.length = 0;
  h.events.length = 0;
  for (const c of bad) {
    await assert.rejects(handlers["console.diff_apply"](h.as(BOSS), { diffId: c.diffId }), (e: unknown) => codeOf(e) === "validation.precondition_failed", c.diffId);
  }
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.events, []);
  assert.ok(h.raw.rows("console_assistant_diff").every((r) => r["state"] === "proposed"));
});

test("without the permission for every step the change is filed for the Manage holders and nothing is applied", async () => {
  const { h, threadId } = await seeded(["console.access"], { "access.roles.update": {} });
  await proposeAs(h, threadId, card("dif_role", "role", [{ path: "rol_a1/name", before: "A", after: "B" }], "Rename the role"));
  h.calls.length = 0;
  h.events.length = 0;
  const out = await handlers["console.diff_apply"](h.as(BOSS), { diffId: "dif_role" });
  assert.deepEqual(out, { applied: false, auditId: "aud_a1b2c3" });
  assert.deepEqual(capsCalled(h), ["access.propose_change", "audit.append"], "the role was not touched");
  const filed = h.calls[0]!.input;
  assert.deepEqual(filed["resource"], { type: "space", id: "spc_test" });
  assert.equal(filed["idempotencyKey"], "console-dif_role");
  assert.equal(h.calls[1]!.input["action"], "console.change_filed");
  assert.deepEqual(h.events, [], "nothing was applied, so no applied event");
  const row = h.raw.rows("console_assistant_diff")[0]!;
  assert.deepEqual([row["state"], row["task_id"]], ["filed", "tsk_a1b2c3"]);

  // once the person holds the permission, the same card applies
  h.allow.add("access.manage");
  h.calls.length = 0;
  assert.equal((await handlers["console.diff_apply"](h.as(BOSS), { diffId: "dif_role" })).applied, true);
  assert.deepEqual(capsCalled(h), ["access.roles.update", "audit.append"]);
});

test("a step the target refuses stops the rest and leaves the card proposed, with no audit row and no event", async () => {
  const { h, threadId } = await seeded(ALL_PERMS, { "access.policies.set": new Error("refused") });
  await proposeAs(h, threadId, card("dif_pol", "policy", [{ path: "space/a", before: 1, after: 2 }, { path: "space/b", before: 1, after: 2 }]));
  h.calls.length = 0;
  h.events.length = 0;
  await assert.rejects(handlers["console.diff_apply"](h.as(BOSS), { diffId: "dif_pol" }), /refused/);
  assert.deepEqual(capsCalled(h), ["access.policies.set"]);
  assert.deepEqual(h.events, []);
  assert.equal(h.raw.rows("console_assistant_diff")[0]!["state"], "proposed");
});

test("a role preview without a hash stops before the apply", async () => {
  const { h, threadId } = await seeded(ALL_PERMS, { "access.roles.preview": { gains: [], losses: [] }, "access.roles.apply": {} });
  await proposeAs(h, threadId, card("dif_role", "role", [{ path: "rol_a1/permissions", before: [], after: ["x.y"] }]));
  h.calls.length = 0;
  await assert.rejects(handlers["console.diff_apply"](h.as(BOSS), { diffId: "dif_role" }), (e: unknown) => codeOf(e) === "validation.precondition_failed");
  assert.deepEqual(capsCalled(h), ["access.roles.preview"]);
});

test("Reject records who and why, emits once, and the card can no longer be applied", async () => {
  const { h, threadId } = await seeded();
  await proposeAs(h, threadId, SETTING());
  h.events.length = 0;
  assert.deepEqual(await handlers["console.diff_reject"](h.as(BOSS), { diffId: "dif_a1", note: "not now" }), { rejected: true });
  assert.deepEqual(h.events, [{ name: "console.change_rejected", subject: "dif_a1", payload: { diffId: "dif_a1", by: BOSS } }]);
  const row = h.raw.rows("console_assistant_diff")[0]!;
  assert.deepEqual([row["state"], row["note"], row["decided_by"]], ["rejected", "not now", BOSS]);
  assert.deepEqual(await handlers["console.diff_reject"](h.as(BOSS), { diffId: "dif_a1" }), { rejected: true });
  assert.equal(h.events.length, 1, "rejecting twice is one event");
  h.calls.length = 0;
  await assert.rejects(handlers["console.diff_apply"](h.as(BOSS), { diffId: "dif_a1" }), (e: unknown) => codeOf(e) === "validation.precondition_failed");
  assert.deepEqual(h.calls, []);
});

test("an applied card cannot be rejected", async () => {
  const { h, threadId } = await seeded();
  await proposeAs(h, threadId, SETTING());
  await handlers["console.diff_apply"](h.as(BOSS), { diffId: "dif_a1" });
  await assert.rejects(handlers["console.diff_reject"](h.as(BOSS), { diffId: "dif_a1" }), (e: unknown) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(handlers["console.diff_reject"](h.as("usr_other"), { diffId: "dif_a1" }), (e: unknown) => codeOf(e) === "validation.not_found");
});
