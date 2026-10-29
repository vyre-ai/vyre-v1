import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import { foldEvent, isAccessEvent } from "./access.ts";
import { mayUseEngineerMcp, repairEventMatches } from "./daemon.ts";

test("grant.revoked removes a replayed grant from the boot access snapshot", () => {
  const access = new AccessSnapshot();
  foldEvent(access, { type: "grant.created", payload: { id: "gr_old", subject_kind: "actor", subject_id: "agt_legacy", resource_type: "space", resource_id: "spc_core", level: "edit" } });
  foldEvent(access, { type: "grant.revoked", payload: { grantId: "gr_old" } });
  assert.equal(access.allGrantRecs().length, 0);
  assert.equal(isAccessEvent("grant.revoked"), true);
});

test("repair duplicate validation rejects a changed deterministic envelope field", () => {
  const intended = { id: "evt_agent_access_principal_created_agt_demo", type: "principal.created", sv: 1, trace_id: "c0".repeat(16), actor: "svc_host", vis: "space", entity: "principal", entity_id: "agt_demo", payload: { id: "agt_demo" } };
  const stored = { ...intended, actor: "svc_import", depth: 0, label: 0, enc: 0 };
  assert.equal(repairEventMatches(stored, intended), false);
});

test("repair duplicate validation rejects a changed span_id", () => {
  const intended = { id: "evt_agent_access_principal_created_agt_demo", type: "principal.created", sv: 1, trace_id: "c0".repeat(16), span_id: "span_repair", actor: "svc_host", vis: "space", entity: "principal", entity_id: "agt_demo", payload: { id: "agt_demo" } };
  const stored = { ...intended, span_id: "span_collision", depth: 0, label: 0, enc: 0 };
  assert.equal(repairEventMatches(stored, intended), false);
});

test("outside MCP actors receive Engineer tools only when live Access grants engineer.mcp", () => {
  const snap = new AccessSnapshot();
  snap.putResource({ id: "spc_core", type: "space", parent_id: null, label: 0, owner_id: "usr_owner", holds: 0 });
  snap.putRole({ id: "rol_engineer", name: "Engineer MCP", clearance: 0, perms: ["engineer.mcp"] });
  snap.putRole({ id: "rol_member", name: "Member", clearance: 0, perms: [] });
  for (const [id, role] of [["act_engineer", "rol_engineer"], ["act_member", "rol_member"]] as const) {
    snap.putPrincipal({ id, kind: "person", status: "active" });
    snap.addPrincipalRole({ holder: id, role });
    snap.putGrant({ id: `gr_${id}`, subject_kind: "actor", subject_id: id, resource_type: "space", resource_id: "spc_core", level: "use" });
  }
  assert.equal(mayUseEngineerMcp(snap, "act_engineer", "spc_core", 1), true);
  assert.equal(mayUseEngineerMcp(snap, "act_member", "spc_core", 1), false);
  assert.equal(mayUseEngineerMcp(snap, "act_missing", "spc_core", 1), false);
});
