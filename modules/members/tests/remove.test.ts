// Suspend, reactivate and the removal wizard (spec 2.1, 3.10; golden 9): each kind of thing the person owns has a default, reassignments go to a named member with a diff,
// held sends are dropped, every device of the person ends, and a refused removal changes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { codeOf, harness } from "../fixtures/db.ts";
import { KINDS, WIZARD } from "../handlers/remove.ts";

const DAY = 24 * 3_600_000;

function world() {
  const h = harness();
  h.person("usr_bob", "Bob");
  h.person("usr_cara", "Cara");
  h.world.devices.set("usr_bob", [{ id: "dev_b1" }, { id: "dev_b2" }]);
  h.world.devices.set("usr_cara", [{ id: "dev_c1" }]);
  const sample = (type: string, n: number) => Array.from({ length: n }, (_, i) => ({ type, id: `${type}_${i}`, title: `${type} ${i}` }));
  h.world.owned.set("usr_bob", {
    routines: { count: 3, sample: sample("routine", 3) },
    automations: { count: 2, sample: sample("automation", 2) },
    agents: { count: 1, sample: sample("agent", 1) },
    records: { count: 40, sample: sample("record", 8) },
    files: { count: 5, sample: sample("file", 5) },
    channels: { count: 2, sample: sample("channel", 2) },
    projects: { count: 1, sample: sample("project", 1) },
    mailbox_connections: { count: 1, sample: sample("connection", 1) },
    vault_mine: { count: 4, sample: [] },
    private_chats: { count: 7, sample: [] },
    memory_from_you: { count: 12, sample: [] },
  });
  h.world.holds = [
    { id: "hld_1", taskId: "tsk_1", principal: { id: "usr_bob" } },
    { id: "hld_2", taskId: "tsk_2", principal: { id: "agt_x" }, actingFor: "usr_bob" },
    { id: "hld_3", taskId: "tsk_3", principal: { id: "usr_cara" } },
  ];
  return h;
}
const rowOf = (h: ReturnType<typeof harness>, id: string) => h.raw.rows("members_status").find((r) => r["person_id"] === id);

test("suspending ends the person's devices, says so once, and reactivating undoes it", async () => {
  const h = world();
  const a = h.as("usr_admin");
  h.events.length = 0;
  await handlers["members.suspend"](a, { personId: "usr_bob", reason: "on leave" });
  await handlers["members.suspend"](a, { personId: "usr_bob" });
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["principal.suspended", { principalId: "usr_bob", reason: "on leave" }]]);
  assert.equal(rowOf(h, "usr_bob")!["status"], "suspended");
  assert.ok(h.world.devices.get("usr_bob")!.every((d) => d.revokedAt !== undefined), "both devices ended");
  assert.ok(h.world.devices.get("usr_cara")!.every((d) => d.revokedAt === undefined), "nobody else's");
  h.events.length = 0;
  await handlers["members.reactivate"](a, { personId: "usr_bob" });
  await handlers["members.reactivate"](a, { personId: "usr_bob" });
  assert.deepEqual(h.events.map((e) => e.name), ["principal.reactivated"]);
  assert.equal(rowOf(h, "usr_bob"), undefined);
});

test("you cannot suspend or remove yourself or the owner", async () => {
  const h = world();
  const a = h.as("usr_admin");
  for (const [fn, input] of [
    ["members.suspend", { personId: "usr_admin" }], ["members.suspend", { personId: "usr_owner" }],
    ["members.remove", { personId: "usr_admin", plan: [] }], ["members.remove", { personId: "usr_owner", plan: [] }],
    ["members.remove_preview", { personId: "usr_admin" }], ["members.remove_preview", { personId: "usr_owner" }],
  ] as const) {
    await assert.rejects((handlers[fn] as (c: typeof a, i: unknown) => Promise<unknown>)(a, input), (e) => codeOf(e) === "validation.precondition_failed", `${fn} ${input.personId}`);
  }
  assert.equal(h.events.length, 0);
  assert.equal(h.world.applied.length, 0);
});

test("the wizard lists every kind with its default, the choices, who gets reassigned things and how long exports last", async () => {
  const h = world();
  const out = await handlers["members.remove_preview"](h.as("usr_admin"), { personId: "usr_bob" });
  assert.deepEqual(out.items.map((i) => i.kind), [...KINDS]);
  assert.equal(out.exportUntil, h.now() + 30 * DAY);
  const by = Object.fromEntries(out.items.map((i) => [i.kind, i]));
  assert.deepEqual(
    Object.fromEntries(out.items.map((i) => [i.kind, i.defaultAction])),
    { routines: "pause", automations: "reassign", agents: "reassign", records: "reassign", files: "reassign", channels: "reassign", projects: "reassign",
      mailbox_connections: "revoke", vault_mine: "export", private_chats: "retain", memory_from_you: "keep" },
  );
  for (const k of KINDS) assert.deepEqual(by[k]!.options, [...WIZARD[k].options]);
  assert.equal(by["records"]!.count, 40);
  assert.equal(by["records"]!.sample.length, 5, "a sample, not a dump");
  assert.equal(by["records"]!.reassignTo, "usr_admin");
  assert.equal(by["mailbox_connections"]!.reassignTo, undefined);
  assert.equal(by["vault_mine"]!.reassignTo, undefined, "Mine items are never handed to someone else");
  assert.deepEqual(by["private_chats"]!.options, ["retain", "delete"]);
  assert.equal(h.world.applied.length, 0, "a preview changes nothing");
});

test("golden 9: removing a person applies the wizard defaults, drops their held sends, ends their devices and takes their access away", async () => {
  const h = world();
  const a = h.as("usr_admin");
  const preview = await handlers["members.remove_preview"](a, { personId: "usr_bob" });
  h.events.length = 0;
  h.calls.length = 0;
  await handlers["members.remove"](a, { personId: "usr_bob", plan: [], reason: "left the firm" });
  // the transfer diff: what was applied is what the preview promised, kind by kind, to the person who removed them
  assert.deepEqual(h.world.applied, preview.items.filter((i) => i.count > 0).map((i) => ({
    person: "usr_bob", kind: i.kind, action: i.defaultAction, ...(i.defaultAction === "reassign" && i.reassignTo ? { to: i.reassignTo } : {}),
  })));
  assert.deepEqual(h.events.map((e) => e.name), ["member.removal_plan_applied", "principal.suspended", "member.removed"]);
  const applied = h.events[0]!.payload as { personId: string; kinds: { kind: string; action: string; count: number }[] };
  assert.equal(applied.kinds.length, 11);
  assert.deepEqual(applied.kinds.find((k) => k.kind === "records"), { kind: "records", action: "reassign", count: 40 });
  assert.deepEqual(h.events[2]!.payload, { personId: "usr_bob", by: "usr_admin", reason: "left the firm" });
  // access is gone: roles, groups, devices
  const bob = h.world.principals.get("usr_bob")!;
  assert.deepEqual([bob.roles, bob.groups], [[], []]);
  assert.ok(h.world.devices.get("usr_bob")!.every((d) => d.revokedAt !== undefined));
  assert.ok(h.world.devices.get("usr_cara")!.every((d) => d.revokedAt === undefined));
  // Gate rejectAllOf: what Bob asked for, and what an agent asked for on his behalf, is dropped; Cara's hold stays
  assert.deepEqual(h.world.holds.map((x) => x.id), ["hld_3"]);
  assert.deepEqual(h.calls.filter((c) => c.cap === "gate.deny").map((c) => (c.input as { holdId: string; mode: string }).holdId + ":" + (c.input as { mode: string }).mode), ["hld_1:drop", "hld_2:drop"]);
  // the order of the trace: wizard first, then access, holds, devices
  const caps = h.calls.map((c) => c.cap);
  assert.ok(caps.indexOf("access.roles.unassign") < caps.indexOf("gate.holds.list") && caps.indexOf("gate.holds.list") < caps.indexOf("devices.list"));
  const st = rowOf(h, "usr_bob")!;
  assert.equal(st["status"], "removed");
  assert.equal(st["key_rotation_pending"], 1, "the Space key epoch still has to rotate on an admin's device");
  assert.equal(st["export_until"], h.now() + 30 * DAY);
  assert.equal((JSON.parse(String(st["plan"])) as unknown[]).length, 11);
  // once is enough
  h.events.length = 0;
  await handlers["members.remove"](a, { personId: "usr_bob", plan: [] });
  assert.equal(h.events.length, 0);
  await assert.rejects(handlers["members.reactivate"](a, { personId: "usr_bob" }), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(handlers["members.suspend"](a, { personId: "usr_bob" }), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(handlers["members.remove_preview"](a, { personId: "usr_bob" }), (e) => codeOf(e) === "validation.precondition_failed");
});

test("the plan can choose: a named person gets the records, private chats are deleted instead of retained", async () => {
  const h = world();
  await handlers["members.remove"](h.as("usr_admin"), { personId: "usr_bob", plan: [
    { kind: "records", action: "reassign", to: "usr_cara" }, { kind: "private_chats", action: "delete" }, { kind: "routines", action: "delete" },
  ] });
  const got = Object.fromEntries(h.world.applied.map((x) => [x.kind, x]));
  assert.deepEqual(got["records"], { person: "usr_bob", kind: "records", action: "reassign", to: "usr_cara" });
  assert.equal(got["private_chats"]!.action, "delete");
  assert.equal(got["routines"]!.action, "delete");
  assert.equal(got["files"]!.to, "usr_admin", "kinds the plan leaves out take the default");
});

test("a bad plan is refused whole, before anything is touched", async () => {
  const h = world();
  const a = h.as("usr_admin");
  await handlers["members.suspend"](a, { personId: "usr_cara" });
  h.events.length = 0;
  const refuse = async (plan: unknown[], want: string, why: string) => {
    await assert.rejects(handlers["members.remove"](a, { personId: "usr_bob", plan: plan as never }), (e) => codeOf(e) === want, why);
    assert.equal(h.world.applied.length, 0, why);
    assert.equal(rowOf(h, "usr_bob"), undefined, why);
    assert.equal(h.events.length, 0, why);
    assert.deepEqual(h.world.principals.get("usr_bob")!.roles, ["rol_member"], why);
  };
  await refuse([{ kind: "records", action: "reassign", to: "usr_bob" }], "validation.precondition_failed", "to the person being removed");
  await refuse([{ kind: "records", action: "reassign", to: "usr_cara" }], "validation.precondition_failed", "to a suspended member");
  await refuse([{ kind: "records", action: "reassign", to: "usr_nobody" }], "validation.not_found", "to nobody");
  await refuse([{ kind: "nope", action: "keep" }], "validation.bad_input", "unknown kind");
  await refuse([{ kind: "mailbox_connections", action: "delete" }], "validation.bad_input", "action not offered");
  await refuse([{ kind: "files", action: "reassign" }, { kind: "files", action: "retain" }], "validation.bad_input", "kind twice");
});

test("things under a legal hold block a delete, and the refusal changes nothing", async () => {
  const h = world();
  const a = h.as("usr_admin");
  h.world.heldItems = 2;
  await assert.rejects(handlers["members.remove"](a, { personId: "usr_bob", plan: [{ kind: "vault_mine", action: "delete" }] }), (e) => codeOf(e) === "permission.on_hold");
  assert.equal(h.world.applied.length, 0);
  assert.equal(rowOf(h, "usr_bob"), undefined);
  // the defaults delete nothing, so a hold does not stop a removal
  await handlers["members.remove"](a, { personId: "usr_bob", plan: [] });
  assert.equal(rowOf(h, "usr_bob")!["status"], "removed");
});

test("an agent never removes a person on its own say-so", async () => {
  const h = world();
  const agent = { ...h.as("usr_admin"), principal: { kind: "agent", id: "agt_helper" } };
  await assert.rejects(handlers["members.remove"](agent, { personId: "usr_bob", plan: [] }), (e) => codeOf(e) === "permission.needs_approval");
  assert.equal(h.world.applied.length, 0);
  assert.equal(h.events.length, 0);
});

test("a suspended person can still be removed, and a removal of someone unknown is not found", async () => {
  const h = world();
  const a = h.as("usr_admin");
  await handlers["members.suspend"](a, { personId: "usr_bob" });
  h.events.length = 0;
  await handlers["members.remove"](a, { personId: "usr_bob", plan: [] });
  assert.equal(rowOf(h, "usr_bob")!["status"], "removed");
  assert.deepEqual(h.events.map((e) => e.name), ["member.removal_plan_applied", "principal.suspended", "member.removed"]);
  await assert.rejects(handlers["members.remove"](a, { personId: "usr_ghost", plan: [] }), (e) => codeOf(e) === "validation.not_found");
});
