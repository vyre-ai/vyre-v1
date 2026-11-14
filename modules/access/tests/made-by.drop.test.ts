// A made-by grant (what an agent was given on a thing it made for a person) does not outlive the owner, and does not follow the thing above the agent's clearance; a move between places the owner controls
// leaves it (modules/access/consumers.ts dropMadeBy, run when a thing is registered again and when ownership is transferred).
import test from "node:test";
import assert from "node:assert/strict";
import { applyEvent, dropMadeBy } from "../consumers.ts";
import { grant, world } from "../fixtures/askworld.ts";

const AGENT = "agt_maker";
function setup() {
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
  // fld_1 is Maya's; the maker holds Edit on it as a grant it was given at birth
  store.resources.get("fld_1")!.ownerId = "usr_maya";
  store.resources.set("fld_calm", {
    id: "fld_calm",
    type: "folder",
    parentId: null,
    label: "internal",
    ownerId: "usr_maya",
    holds: 0,
  });
  store.resources.set("fld_secret", {
    id: "fld_secret",
    type: "folder",
    parentId: null,
    label: "restricted",
    ownerId: "usr_admin",
    holds: 0,
  });
  store.grants.set(
    "gnt_made",
    grant("gnt_made", AGENT, { type: "folder", id: "fld_1" }, "edit", {
      subject: { kind: "agent", id: AGENT },
      source: `made-by:${AGENT}`,
      by: "usr_maya",
    }),
  );
  store.grants.set(
    "gnt_plain",
    grant("gnt_plain", AGENT, { type: "folder", id: "fld_1" }, "view", { subject: { kind: "agent", id: AGENT } }),
  );
  store.bump();
  return store;
}
const register = (store: ReturnType<typeof setup>, over: Record<string, unknown>) =>
  applyEvent(
    store,
    {
      type: "resource.created",
      payload: { id: "fld_1", type: "folder", parent_id: null, label: 1, owner_id: "usr_maya", holds: 0, ...over },
    } as never,
    5,
  );

test("a move between places the owner controls leaves the made-by grant; a grant with no made-by source is never touched", () => {
  const store = setup();
  register(store, { parent_id: "fld_calm" });
  assert.ok(store.grants.has("gnt_made"));
  assert.ok(store.grants.has("gnt_plain"));
});

test("a move above the agent's clearance removes it; a move to a place within it does not", () => {
  const store = setup();
  register(store, { parent_id: "fld_secret" });
  assert.ok(!store.grants.has("gnt_made"), "the maker (a Member, cleared to internal) is above its clearance there");
  assert.ok(store.grants.has("gnt_plain"));
});

test("a change of owner removes it", () => {
  const store = setup();
  register(store, { owner_id: "usr_gus" });
  assert.ok(!store.grants.has("gnt_made"));
  assert.ok(store.grants.has("gnt_plain"));
});

test("an ownership transfer removes it (dropMadeBy with the owner changed), and a first registration touches nothing", () => {
  const store = setup();
  dropMadeBy(store, "fld_1", false);
  assert.ok(store.grants.has("gnt_made"), "nothing changed: it stays");
  dropMadeBy(store, "fld_1", true);
  assert.ok(!store.grants.has("gnt_made"));
  const again = setup();
  applyEvent(
    again,
    {
      type: "resource.created",
      payload: { id: "fld_new", type: "folder", parent_id: null, label: 3, owner_id: "usr_maya", holds: 0 },
    } as never,
    5,
  );
  assert.ok(again.grants.has("gnt_made"), "another thing's registration leaves it");
});
