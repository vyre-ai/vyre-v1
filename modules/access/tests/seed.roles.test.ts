// P-L7_30: only the seed's events carry the kernel's bare role names, and only they are mapped to the rol_* ids a real join stores. A runtime event that names "owner" never becomes rol_owner.
import test from "node:test";
import assert from "node:assert/strict";
import { applyEvent, SEED_ACTOR } from "../consumers.ts";
import { AccessStore } from "../projections.ts";

const roleSet = (holder: string, role: string, actor: string, seq: number) => ({ seq, type: "principal.role_set", payload: { holder, role }, actor });

test("a seed role_set maps the kernel's names to the ids real joins store, and takes the id as written when it is already one", () => {
  const store = new AccessStore();
  store.seed();
  assert.ok(applyEvent(store, roleSet("usr_a", "member", SEED_ACTOR, 1), 0));
  assert.ok(applyEvent(store, roleSet("usr_b", "owner", SEED_ACTOR, 2), 0));
  assert.ok(applyEvent(store, roleSet("usr_c", "temp", SEED_ACTOR, 3), 0));
  assert.ok(applyEvent(store, roleSet("usr_d", "rol_admin", SEED_ACTOR, 4), 0));
  assert.deepEqual([store.rolesOf("usr_a"), store.rolesOf("usr_b"), store.rolesOf("usr_c"), store.rolesOf("usr_d")], [["rol_member"], ["rol_owner"], ["rol_guest"], ["rol_admin"]]);
});

test("a runtime role_set that names \"owner\" does not make anyone rol_owner, whoever made the call", () => {
  const store = new AccessStore();
  store.seed();
  for (const [i, actor] of ["usr_member", "agt_helper", "svc_host", "act_ci"].entries()) applyEvent(store, roleSet(`usr_t${i}`, "owner", actor, i + 1), 0);
  applyEvent(store, { seq: 9, type: "principal.role_set", payload: { holder: "usr_noactor", role: "owner" } }, 0);
  for (const holder of ["usr_t0", "usr_t1", "usr_t2", "usr_t3", "usr_noactor"]) assert.ok(!store.rolesOf(holder).includes("rol_owner"), `${holder} is not an owner: ${store.rolesOf(holder).join(",")}`);
  assert.equal(store.roles.get("rol_owner")?.builtIn, true, "and the built-in Owner role is untouched");
});

test("a seed role.defined for a built-in role is not defined twice, and one the store lacks gets the rol_ prefix; a runtime one keeps its id", () => {
  const store = new AccessStore();
  store.seed();
  const before = store.roles.get("rol_member");
  assert.equal(applyEvent(store, { seq: 1, type: "role.defined", payload: { id: "member", clearance: "internal", perms: ["x.y"], name: "member" }, actor: SEED_ACTOR }, 0), false);
  assert.equal(store.roles.get("rol_member"), before, "the built-in is kept as it was");
  assert.ok(applyEvent(store, { seq: 2, type: "role.defined", payload: { id: "manager", clearance: "confidential", perms: ["a.b"], name: "manager" }, actor: SEED_ACTOR }, 0));
  assert.deepEqual(store.roles.get("rol_manager")?.permissions, ["a.b"]);
  assert.ok(applyEvent(store, { seq: 3, type: "role.defined", payload: { id: "member", clearance: "public", perms: [], name: "mine" }, actor: "usr_x" }, 0));
  assert.equal(store.roles.get("member")?.name, "mine", "a runtime definition keeps the id it was given");
});
