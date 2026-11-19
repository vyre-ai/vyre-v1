// mail.configure carries no permission of its own: every action routes through the capability behind the screen, so those capabilities are the whole door. This pins them against the registry and the real kernel:
// each demands comms.domains, a member who lacks it is refused by authorize, and the two that can reroute or send outward from an agent are held at the Gate.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../../kernel/src/authorize/index.ts";
import { registry } from "../../../generated/registry.ts";

const CALLEES = [
  "mail.setup.status",
  "mail.setup.test_send",
  "mail.smtp.get",
  "mail.smtp.set",
  "mail.smtp.verify",
  "mail.address.list",
  "mail.address.add",
  "mail.address.move",
];
const def = (name: string) =>
  registry.capabilities.find((c) => c.name === name) as unknown as {
    permission: string | null;
    level: string;
    gate?: { act: string; when?: string };
  };

test("every capability mail.configure routes to demands comms.domains, and a member without it is refused by the kernel", () => {
  const s = new AccessSnapshot();
  s.putResource({ id: "spc_t", type: "space", parent_id: null, label: 0, owner_id: null, holds: 0 });
  s.putRole({ id: "member", clearance: 1, perms: [], name: "member" });
  s.putRole({ id: "admin", clearance: 3, perms: ["comms.domains"], name: "admin" });
  for (const [id, role, level] of [
    ["usr_member", "member", "edit"],
    ["usr_admin", "admin", "manage"],
  ] as const) {
    s.putPrincipal({ id, kind: "person", status: "active", name: id });
    s.addPrincipalRole({ holder: id, role });
    s.putGrant({
      id: `gr_${id}`,
      subject_kind: "role",
      subject_id: role,
      resource_type: "space",
      resource_id: "spc_t",
      level,
      source: `role:${role}`,
    });
  }
  for (const name of CALLEES) {
    const c = def(name);
    assert.equal(c.permission, "comms.domains", `${name} asks for comms.domains`);
    const ask = (who: string) =>
      authorize(s, {
        principal: who,
        action: { perm: c.permission, level: c.level as "view" },
        resource: { type: "space", id: "spc_t" },
        now: 1_760_000_000_000,
      });
    const refused = ask("usr_member");
    assert.equal(refused.effect, "deny", `${name}: a member without comms.domains is refused`);
    assert.equal(ask("usr_admin").effect, "allow", `${name}: an admin with it is let in`);
  }
  assert.equal(
    def("mail.configure").permission,
    null,
    "the tool has no permission of its own; the capabilities behind it are the door",
  );
});

test("changing the Space's mail server or moving an address, asked by an agent, is held at the Gate for a person's ok; a person's own change is not", () => {
  for (const name of ["mail.smtp.set", "mail.address.move"]) {
    const g = def(name).gate;
    assert.equal(g?.act, "send", `${name} is held as an outward act`);
    assert.equal(g?.when, "actor.kind != 'person'", `${name} holds only for an agent or automation`);
  }
  assert.equal(def("mail.setup.test_send").gate?.act, "send");
});
