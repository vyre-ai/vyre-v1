import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import { foldEvent, isAccessEvent } from "./access.ts";

test("grant.revoked removes a replayed grant from the boot access snapshot", () => {
  const access = new AccessSnapshot();
  foldEvent(access, { type: "grant.created", payload: { id: "gr_old", subject_kind: "actor", subject_id: "agt_legacy", resource_type: "space", resource_id: "spc_core", level: "edit" } });
  foldEvent(access, { type: "grant.revoked", payload: { grantId: "gr_old" } });
  assert.equal(access.allGrantRecs().length, 0);
  assert.equal(isAccessEvent("grant.revoked"), true);
});
