// What each item of the menus in kinds-b.ts calls: one capability, with the input the capability takes.
import test from "node:test";
import assert from "node:assert/strict";
import { createMenuApiB } from "./actions-b.ts";

function world(answers: Record<string, unknown> = {}) {
  const calls: { cap: string; input: any }[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const api = createMenuApiB({ call: async (cap: string, input: unknown) => { calls.push({ cap, input: input as never }); return answers[cap] ?? {}; } } as never);
  return { api, calls };
}

test("vault, automation, goal and project items each make one capability call", async () => {
  const w = world();
  await w.api.vaultMove("vit_1", "vfl_2"); await w.api.vaultMarkRotated("vit_1"); await w.api.vaultTrash("vit_1");
  await w.api.automationRun("aut_1"); await w.api.automationSetEnabled("aut_1", false); await w.api.automationTest("aut_1"); await w.api.automationPersonalCopy("aut_1"); await w.api.automationMove("aut_1", null); await w.api.automationTrash("aut_1");
  await w.api.goalPause("gol_1"); await w.api.goalResume("gol_1"); await w.api.goalMarkStuck("gol_1", "Waiting on the county", ["Wait", "Stop"]); await w.api.goalReport("gol_1", "On pace"); await w.api.goalStop("gol_1");
  await w.api.projectStar("prj_1", true); await w.api.projectAddPerson("prj_1", { kind: "person", id: "usr_a" }, "member"); await w.api.projectPinFile("prj_1", "fil_1"); await w.api.projectArchive("prj_1"); await w.api.projectUnarchive("prj_1");
  assert.deepEqual(w.calls.map((c) => c.cap), [
    "vault.item.move", "vault.item.mark_rotated", "vault.item.delete",
    "automations.run", "automations.set_enabled", "automations.test", "automations.make_personal_copy", "automations.move", "automations.delete",
    "goals.pause", "goals.resume", "goals.mark_stuck", "goals.report", "goals.stop",
    "stars.toggle", "projects.members.set", "projects.pin_file", "projects.archive", "projects.unarchive",
  ]);
  assert.deepEqual(w.calls[0]!.input, { itemId: "vit_1", folderId: "vfl_2" });
  assert.deepEqual(w.calls[4]!.input, { automationId: "aut_1", enabled: false });
  assert.deepEqual(w.calls[7]!.input, { automationId: "aut_1", groupId: null });
  assert.ok(w.calls[3]!.input.idempotencyKey && w.calls[6]!.input.idempotencyKey, "run and copy carry a key");
  assert.deepEqual(w.calls[11]!.input, { goalId: "gol_1", reason: "Waiting on the county", options: ["Wait", "Stop"] });
  assert.deepEqual(w.calls[14]!.input, { resource: { type: "project", id: "prj_1" }, on: true });
  assert.equal(w.calls[15]!.input.role, "member");
  assert.ok(w.calls[15]!.input.idempotencyKey);
});

test("Console items each make one capability call; removing a person follows the wizard's own plan", async () => {
  const w = world({ "members.remove_preview": { items: [{ kind: "automations", defaultAction: "reassign", reassignTo: "usr_owner" }, { kind: "routines", defaultAction: "pause" }] } });
  await w.api.personSuspend("usr_s"); await w.api.personReactivate("usr_s"); await w.api.personRole("usr_s", "rol_editor");
  await w.api.groupAddMember("grp_1", { kind: "person", id: "usr_s" }); await w.api.groupRename("grp_1", "Sales team"); await w.api.groupDelete("grp_1");
  await w.api.roleDuplicate("rol_editor", "Editor copy"); await w.api.roleDelete("rol_x");
  await w.api.computerWake("cmp_1"); await w.api.computerSleep("cmp_1"); await w.api.computerTakeOver("cmp_1"); await w.api.computerRemove("cmp_1");
  await w.api.numberAssign("num_1", "person", "usr_s"); await w.api.numberRelease("num_1");
  await w.api.domainCheck("dom_1"); await w.api.domainRemove("dom_1");
  await w.api.personRemove("usr_gone");
  assert.deepEqual(w.calls.map((c) => c.cap), [
    "members.suspend", "members.reactivate", "access.roles.assign", "access.groups.add_member", "access.groups.update", "access.groups.delete", "access.roles.create", "access.roles.delete",
    "computers.wake", "computers.sleep", "computers.take_over", "computers.remove", "telephony.number.assign", "telephony.number.release", "mail.domain.check", "mail.domain.remove",
    "members.remove_preview", "members.remove",
  ]);
  assert.deepEqual(w.calls[2]!.input, { subject: { kind: "person", id: "usr_s" }, roleId: "rol_editor" });
  assert.deepEqual(w.calls[6]!.input.cloneFrom, "rol_editor");
  assert.deepEqual(w.calls[13]!.input.numberId, "num_1");
  assert.deepEqual(w.calls.at(-1)!.input, { personId: "usr_gone", plan: [{ kind: "automations", action: "reassign", to: "usr_owner" }, { kind: "routines", action: "pause" }] });
});

test("machine items each make one capability call on the machine's own id", async () => {
  const w = world();
  await w.api.machineDrain("srv_box", true); await w.api.machineDrain("srv_box", false); await w.api.machineFix("srv_box", "clear_caches"); await w.api.machineFix("srv_box", "stop_idle");
  await w.api.serverRemove("srv_box"); await w.api.myComputerRemove("srv_mine");
  assert.deepEqual(w.calls.map((c) => [c.cap, c.input]), [
    ["machines.set", { machineId: "srv_box", drain: true }], ["machines.set", { machineId: "srv_box", drain: false }],
    ["machines.fix", { machineId: "srv_box", fix: "clear_caches" }], ["machines.fix", { machineId: "srv_box", fix: "stop_idle" }],
    ["network.server_remove", { serverId: "srv_box" }], ["network.my_computer_remove", { serverId: "srv_mine" }],
  ]);
});
