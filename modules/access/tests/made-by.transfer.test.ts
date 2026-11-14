// An ownership transfer takes the made-by grant (what an agent was given on a thing it made for the owner) with it: it does not outlive the owner.
import test from "node:test";
import assert from "node:assert/strict";
import type { LogEvent } from "../consumers.ts";
import { storeOf } from "../projections.ts";
import { SPACE, ctxOf, fresh, sync, transfer } from "../fixtures/incremental.ts";

test("access.transfer_ownership removes made-by grants on the thing and leaves every other grant", async () => {
  const { db } = fresh("madeby");
  const grant = (seq: number, id: string, source?: string): LogEvent => ({
    seq,
    type: "grant.created",
    payload: {
      id,
      subject_kind: "actor",
      subject_id: "agt_maker",
      resource_type: "vault_folder",
      resource_id: "vfd_1",
      level: "edit",
      by: "usr_owner",
      ...(source ? { source } : {}),
    },
  });
  const log: LogEvent[] = [
    {
      seq: 1,
      type: "resource.created",
      payload: { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_owner", holds: 0 },
    },
    {
      seq: 2,
      type: "principal.created",
      payload: { id: "usr_owner", kind: "person", name: "Owner", status: "active" },
    },
    { seq: 3, type: "principal.created", payload: { id: "usr_ida", kind: "person", name: "Ida", status: "active" } },
    {
      seq: 4,
      type: "resource.created",
      payload: { id: "vfd_1", type: "vault_folder", parent_id: SPACE, label: 0, owner_id: "usr_owner", holds: 0 },
    },
    grant(5, "gnt_made", "made-by:agt_maker"),
    grant(6, "gnt_other"),
  ];
  sync(ctxOf(db), { events: log });
  const store = () => storeOf(ctxOf(db));
  assert.ok(store().grants.has("gnt_made"), "the made-by grant is there");
  assert.equal(
    transfer(ctxOf(db), { resource: { type: "vault_folder", id: "vfd_1" }, from: "usr_owner", to: "usr_ida" }),
    true,
  );
  assert.ok(!store().grants.has("gnt_made"), "gone with the owner");
  assert.ok(store().grants.has("gnt_other"), "a grant with no made-by source is untouched");
});
