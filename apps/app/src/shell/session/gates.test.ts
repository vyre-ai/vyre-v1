// l-perms: per built-in role, which of the app's permission-gated controls are drawn. The roles' permissions come from the catalogue the server seeds (manifests/permissions.ts), so a change
// there that would show a member a control the server refuses fails here. Owner holds everything; a Guest's role carries nothing of its own.
import test from "node:test";
import assert from "node:assert/strict";
import { PERMISSIONS } from "../../../../../manifests/permissions.ts";
import { GATE, allows, shownGates } from "./gates.ts";
import type { Gate } from "./gates.ts";
import { sectionsOf } from "../../places/automations/sidebar/model.ts";
import type { AutoRow } from "../../places/automations/sidebar/model.ts";

type Role = "owner" | "admin" | "developer" | "member" | "guest";
const permsOf = (role: Role): string[] => role === "guest" ? [] : PERMISSIONS.filter((p) => role === "owner" || p.defaults[role] === true).map((p) => p.key);
const ALL = Object.keys(GATE) as Gate[];

const EXPECTED: Record<Role, Gate[]> = {
  owner: ALL,
  admin: ALL,
  developer: ["spaceAutomations", "newChat", "newChannel", "newAgent", "sharedVault", "takeOver"],
  member: ["newChat", "newChannel", "newAgent", "sharedVault"],
  guest: [],
};

for (const role of Object.keys(EXPECTED) as Role[]) {
  test(`a ${role} sees exactly the controls their role allows`, () => {
    assert.deepEqual(shownGates(permsOf(role)).sort(), [...EXPECTED[role]].sort());
  });
}

test("every gate names a permission in the catalogue", () => {
  const keys = new Set(PERMISSIONS.map((p) => p.key));
  for (const g of ALL) assert.ok(keys.has(GATE[g]), `${g} -> ${GATE[g]}`);
});

test("a member's own scope needs nothing they lack: Mine automations, agents, records, files, sites, terminals", () => {
  const m = new Set(permsOf("member"));
  for (const k of ["automations.personal", "agents.create", "agents.schedule", "records.create", "records.edit", "files.write", "sites.deploy", "channels.create", "chats.private", "terminal.use", "forms.publish"]) assert.ok(m.has(k), k);
  for (const k of ["automations.space", "console.access", "members.invite", "access.manage", "connectors.manage", "sites.domains", "sites.promote"]) assert.ok(!m.has(k), k);
});

test("nothing is hidden when the server does not say, or in a Personal Space", () => {
  assert.equal(allows({ space: { kind: "team" } }, GATE.spaceAutomations), true);
  assert.equal(allows(null, GATE.spaceAutomations), true);
  assert.equal(allows({ permissions: new Set(), space: { kind: "personal" } }, GATE.spaceAutomations), true);
  assert.equal(allows({ permissions: new Set(), space: { kind: "team" } }, GATE.spaceAutomations), false);
});

test("Automations: a member's Space section has no +, their Personal one does; an admin has both (the live bug: + on Space made a draft, then the promote was refused)", () => {
  const row = (id: string, kind: "personal" | "space", ownerId: string): AutoRow => ({ id, name: id, kind, ownerId, status: "off", triggers: [], failedRuns: 0, version: 1 }) as unknown as AutoRow;
  const autos = [row("a1", "personal", "usr_m"), row("a2", "space", "usr_o")];
  const member = sectionsOf(autos, [], { me: "usr_m", canSpace: allows({ permissions: new Set(permsOf("member")), space: { kind: "team" } }, GATE.spaceAutomations) });
  assert.equal(member.find((s) => s.key === "personal")?.canAdd, true);
  assert.equal(member.find((s) => s.key === "space")?.canAdd, false);
  assert.equal(member.find((s) => s.key === "space")?.count, 1, "the Space automation is still listed, to open read-only");
  const admin = sectionsOf(autos, [], { me: "usr_o", canSpace: allows({ permissions: new Set(permsOf("admin")), space: { kind: "team" } }, GATE.spaceAutomations) });
  assert.equal(admin.find((s) => s.key === "space")?.canAdd, true);
});
