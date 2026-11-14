// The four access answers that tell a screen what the server would do (who may share, request, export, and which provider may see a thing) use the decision snapshot, like check and reach (r-auto2, 14 Nov 2026).
// A Space whose built-in roles were never given the Space-level grant answers the same as the server: a member may edit. The store's bare snapshot says none, so each of these four fails without the swap.
// @reads ../migrations/0001_access_core.sql
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { builderStatus } from "../handlers/connector-builder.ts";
import { providerCheck } from "../handlers/check.ts";
import { allows } from "../handlers/request.ts";
import { mayExport } from "../handlers/share.ts";
import { putPrincipal } from "../handlers/roles.ts";
import { dropStore, pkey, storeOf } from "../projections.ts";
import { authorize } from "../../../kernel/src/authorize/index.ts";

/** A Space with the Space resource and two members, a person and an agent, whose roles carry no Space-level grant; and one thing of each kind under the Space. */
function unseeded() {
  const h = harness();
  const store = storeOf(h.ctx);
  putPrincipal(store, { id: "usr_p", kind: "person", name: "P" });
  putPrincipal(store, { id: "agt_a", kind: "agent", name: "Assistant" });
  store.setRoles("usr_p", ["rol_member"]);
  store.setRoles("agt_a", ["rol_member"]);
  putPrincipal(store, { id: "usr_adm", kind: "person", name: "Adm" });
  store.setRoles("usr_adm", ["rol_admin"]);
  store.resources.set("spc_test", {
    id: "spc_test",
    type: "space",
    parentId: null,
    label: "internal",
    ownerId: null,
    holds: 0,
    row: { name: "Space" },
  });
  for (const [id, type, label] of [
    ["vit_x", "vault_item", "internal"],
    ["rec_x", "record", "internal"],
    ["fld_x", "folder", "internal"],
  ] as const)
    store.resources.set(id, { id, type, parentId: "spc_test", label, ownerId: null, holds: 0, row: { name: id } });
  // a policy that lets the provider "cloud" see nothing above label 0
  store.policies.set(pkey("p1", "space"), { key: "p1", scope: "space", kind: "provider_label", value: { allow: { cloud: 0 } }, updatedAt: 1 });
  store.bump();
  return { h, store };
}

test("the store's own snapshot gives a member nothing in such a Space (the premise of the four swaps)", () => {
  const { h, store } = unseeded();
  assert.equal(
    authorize(store.snapshot(), {
      principal: "usr_p",
      action: { perm: null, level: "view" },
      resource: { type: "folder", id: "fld_x" },
      now: h.ctx.now(),
    }).effect,
    "deny",
  );
  dropStore(h.db);
});

test("who an agent may use a Vault item for (connector builder) answers as the server: the member's use reaches it", async () => {
  const { h, store } = unseeded();
  h.ctx.principal = { kind: "person", id: "usr_p" };
  const out = await builderStatus(h.ctx, { agentId: "agt_a", itemId: "vit_x" });
  assert.equal(out.reaches, true);
  assert.ok(store);
  dropStore(h.db);
});

test("the person an agent asks for already has the level, so the ask is the agent's own (request)", () => {
  const { h, store } = unseeded();
  assert.equal(allows(h.ctx as never, store, "usr_p", null, "edit", { type: "folder", id: "fld_x" }), true);
  dropStore(h.db);
});

test("an admin may give the right to export a record, in a Space whose roles carry no Space grant (share)", () => {
  const { h, store } = unseeded();
  h.ctx.principal = { kind: "person", id: "usr_adm" };
  const res = store.resources.get("rec_x")!;
  assert.equal(mayExport(h.ctx, store, res), true);
  dropStore(h.db);
});

test("a thing labelled above what a provider may see is blocked for a member who may view it (provider check)", async () => {
  const { h } = unseeded();
  h.ctx.principal = { kind: "person", id: "usr_p" };
  const out = await providerCheck(h.ctx, { resources: [{ type: "folder", id: "fld_x" }], provider: "cloud" });
  assert.deepEqual(
    out.blocked.map((b) => b.id),
    ["fld_x"],
  );
  dropStore(h.db);
});
