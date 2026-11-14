// The maker's grant is what lets an agent keep using what it made for a person when nothing else gives it the thing (an admin took away the agent's Space grant or role): with it the agent, acting for the
// owner, can use the folder; without it, not. And the sharing list shows the maker once: the made-by row is hidden while another grant of that agent gives the same or more, and shown when it is the only one.
import test from "node:test";
import assert from "node:assert/strict";
import { authorize } from "../../../kernel/src/authorize/index.ts";
import { handlers } from "../impl.ts";
import { grant, world } from "../fixtures/askworld.ts";

const AGENT = "agt_maker";
function setup(withMadeBy: boolean, withSpaceGrant: boolean) {
  const w = world();
  const { store } = w;
  store.principals.set(AGENT, {
    id: AGENT,
    kind: "agent",
    name: "maker",
    status: "active",
    createdAt: 1,
    owner: "usr_maya",
  });
  store.setRoles(AGENT, ["rol_member"]);
  store.resources.set("vfd_made", {
    id: "vfd_made",
    type: "vault_folder",
    parentId: "spc_1",
    label: "internal",
    ownerId: "usr_maya",
    holds: 0,
  });
  store.resources.set("spc_1", {
    id: "spc_1",
    type: "space",
    parentId: null,
    label: "public",
    ownerId: "usr_admin",
    holds: 0,
  });
  if (withSpaceGrant)
    store.grants.set(
      "gnt_space",
      grant("gnt_space", AGENT, { type: "space", id: "spc_1" }, "edit", { subject: { kind: "agent", id: AGENT } }),
    );
  if (withMadeBy)
    store.grants.set(
      "gnt_made",
      grant("gnt_made", AGENT, { type: "vault_folder", id: "vfd_made" }, "edit", {
        subject: { kind: "agent", id: AGENT },
        source: `made-by:${AGENT}`,
        by: "usr_maya",
      }),
    );
  store.bump();
  return w;
}
const can = (w: ReturnType<typeof setup>) =>
  authorize(w.store.snapshot(), {
    principal: AGENT,
    actingFor: "usr_maya",
    action: { perm: null, level: "edit" },
    resource: { type: "vault_folder", id: "vfd_made" },
    now: w.h.now(),
  }).effect === "allow";

test("with the Space grant gone, the maker still works with what it made; without the made-by grant it could not", () => {
  assert.equal(can(setup(true, false)), true);
  assert.equal(can(setup(false, false)), false);
  assert.equal(can(setup(false, true)), true, "while the Space grant is there it reaches it anyway");
});

test("the sharing list shows the maker once: the made-by row is hidden next to another grant of the same or more, shown when alone", async () => {
  const listed = async (w: ReturnType<typeof setup>) =>
    (
      await handlers["access.shares_of"](w.h.as("usr_maya"), { resource: { type: "vault_folder", id: "vfd_made" } })
    ).shares
      .filter((s) => s.grant.subject.id === AGENT)
      .map((s) => s.grant.id);
  assert.deepEqual(await listed(setup(true, true)), ["gnt_space"], "the Space grant gives the same level: one row");
  assert.deepEqual(await listed(setup(true, false)), ["gnt_made"], "alone it is shown, so the person can remove it");
});
