// madeForGrant (host/src/invoke.ts): what an agent holds on a thing it just made for the person it acts for. One rule for record types, sites and the Vault.
import test from "node:test";
import assert from "node:assert/strict";
import { madeForGrant } from "../src/invoke.ts";

const agent = { principal: { kind: "agent", id: "agt_a" }, actingFor: "usr_mia" };
const row = (type: string, extra: Record<string, unknown> = {}) => ({
  id: `x_${type}`,
  type,
  parent_id: "spc_1",
  owner_id: "usr_mia",
  ...extra,
});

test("a record type is Manage with no source; a vault folder Edit and a vault key Use, both with the made-by source", () => {
  assert.deepEqual(madeForGrant(row("record_type"), [], agent), { level: "manage", source: false });
  assert.deepEqual(madeForGrant(row("vault_folder"), [], agent), { level: "edit", source: true });
  assert.deepEqual(madeForGrant(row("vault_item"), [], agent), { level: "use", source: true });
});

test("a site is Edit only when this call created it", () => {
  const born = [{ type: "site.created", payload: { siteId: "x_site" } }];
  assert.deepEqual(madeForGrant(row("site"), born, agent), { level: "edit", source: true });
  assert.equal(madeForGrant(row("site"), [], agent), null, "a later move is not a birth");
  assert.equal(madeForGrant(row("site"), [{ type: "site.created", payload: { siteId: "other" } }], agent), null);
});

test("never for a person, never for an agent with nobody behind it, never for a thing that is not the person's, never for another kind of thing", () => {
  assert.equal(
    madeForGrant(row("vault_item"), [], { principal: { kind: "person", id: "usr_mia" }, actingFor: "usr_mia" }),
    null,
  );
  assert.equal(madeForGrant(row("vault_item"), [], { principal: agent.principal }), null);
  assert.equal(madeForGrant(row("vault_item", { owner_id: "usr_other" }), [], agent), null);
  assert.equal(madeForGrant(row("file"), [], agent), null);
});

test("skipped, not failed, when the place is labelled above the agent's clearance", () => {
  const asked: string[] = [];
  const clears = (_a: string, id: string) => (asked.push(id), id !== "vfd_restricted");
  assert.equal(madeForGrant(row("vault_item", { parent_id: "vfd_restricted" }), [], agent, clears), null);
  assert.deepEqual(asked, ["vfd_restricted"], "the label is read from the place it is in");
  assert.deepEqual(madeForGrant(row("vault_item", { parent_id: "vfd_open" }), [], agent, clears), {
    level: "use",
    source: true,
  });
});
