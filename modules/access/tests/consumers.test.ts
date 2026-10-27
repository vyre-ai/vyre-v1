import test from "node:test";
import assert from "node:assert/strict";
import { applyEvent } from "../consumers.ts";
import { AccessStore } from "../projections.ts";

test("gateway actor-kind home grants fold onto the registered agent and person", () => {
  const store = new AccessStore();
  const events = [
    { type: "principal.created", payload: { id: "agt_home", kind: "agent", owner: "usr_a", status: "active" } },
    { type: "principal.created", payload: { id: "usr_a", kind: "person", status: "active" } },
    { type: "principal.created", payload: { id: "act_external", kind: "actor", status: "active" } },
    { type: "grant.created", payload: { id: "gr_home", subject_kind: "actor", subject_id: "agt_home", resource_type: "folder", resource_id: "fld_home", level: "edit" } },
    { type: "grant.created", payload: { id: "gr_owner", subject_kind: "actor", subject_id: "usr_a", resource_type: "folder", resource_id: "fld_home", level: "manage" } },
    { type: "grant.created", payload: { id: "gr_external", subject_kind: "actor", subject_id: "act_external", resource_type: "folder", resource_id: "fld_home", level: "view" } },
  ] as const;
  for (const event of events) applyEvent(store, event, 1);
  assert.equal(store.grants.get("gr_home")?.subject.kind, "agent");
  assert.equal(store.grants.get("gr_owner")?.subject.kind, "person");
  assert.equal(store.grants.get("gr_external")?.subject.kind, "actor");
  assert.deepEqual(store.snapshot().grantsOn("fld_home")?.map((g) => g.row.subject_kind), ["agent", "person", "actor"]);
});
