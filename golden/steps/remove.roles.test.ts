// P-L7_30: members.remove takes the person's roles away by the ids the access module holds. A person the Space was seeded with (roles stored by the kernel's names) is removed like one who joined by
// invite (rol_ ids): the call answers 200, the roles are gone, their sessions end and the owner cannot be removed. Booted daemon, real tokens through the gateway (rule 27).
import test from "node:test";
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus, short, Trail } from "./02-space.ts";
import { joinPerson, memberRole } from "./02-person-joining.ts";

const LIVE = ["members", "identity", "devices", "access", "spaces", "tasks", "gate"];

test("removing a seeded member and an invited member both succeed, their roles are gone and their sessions end", async () => {
  const s = await bootFlowSpace(LIVE);
  const trail = new Trail();
  try {
    const admin = s.d.token;
    const rolesOf = async (id: string): Promise<string[]> => expectStatus(await s.call("access.principals.get", admin, { principal: { kind: "person", id } }), 200, "access.principals.get").principal.roles as string[];

    // seeded: Sana holds the member role by the seed's name
    const sana = s.signedIn("usr_sana", "dev_sana0001");
    assert.equal((await s.call("identity.whoami", sana, {})).status, 200, "Sana's session works before");
    assert.deepEqual(await rolesOf("usr_sana"), ["rol_member"], "a seeded member holds the id a real join stores");
    expectStatus(await s.call("members.remove", admin, { personId: "usr_sana", plan: [], reason: "left the firm" }), 200, "members.remove of a seeded member");
    assert.deepEqual(await rolesOf("usr_sana"), [], "her roles are gone");
    const after = await s.call("identity.whoami", sana, {});
    assert.equal(after.status, 401, `Sana's session ends: ${after.status} ${short(after.body?.error ?? after.body)}`);

    // invited
    const roleId = await memberRole(s);
    const noel = await joinPerson(s, trail, "Noel", roleId);
    assert.ok(noel, `Noel joined:\n${trail.report()}`);
    assert.equal((await s.call("identity.whoami", noel!.token, {})).status, 200);
    expectStatus(await s.call("members.remove", admin, { personId: noel!.id, plan: [] }), 200, "members.remove of an invited member");
    assert.equal((await s.call("identity.whoami", noel!.token, {})).status, 401, "Noel's session ends");

    // the owner is still protected: the seeded owner holds the owner role under its real id, so the guard sees it
    assert.deepEqual(await rolesOf("usr_olivia"), ["rol_owner"]);
    const owner = await s.call("members.remove", admin, { personId: "usr_olivia", plan: [] });
    assert.ok(owner.status >= 400 && owner.status < 500, `the owner cannot be removed: ${owner.status}`);
  } finally { await s.stop(); }
});
