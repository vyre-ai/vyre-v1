import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import { foldEvent, isAccessEvent } from "./access.ts";
import { repairEventMatches } from "./daemon.ts";

test("grant.revoked removes a replayed grant from the boot access snapshot", () => {
  const access = new AccessSnapshot();
  foldEvent(access, {
    type: "grant.created",
    payload: {
      id: "gr_old",
      subject_kind: "actor",
      subject_id: "agt_legacy",
      resource_type: "space",
      resource_id: "spc_core",
      level: "edit",
    },
  });
  foldEvent(access, { type: "grant.revoked", payload: { grantId: "gr_old" } });
  assert.equal(access.allGrantRecs().length, 0);
  assert.equal(isAccessEvent("grant.revoked"), true);
});

test("repair duplicate validation rejects a changed deterministic envelope field", () => {
  const intended = {
    id: "evt_agent_access_principal_created_agt_demo",
    type: "principal.created",
    sv: 1,
    trace_id: "c0".repeat(16),
    actor: "svc_host",
    vis: "space",
    entity: "principal",
    entity_id: "agt_demo",
    payload: { id: "agt_demo" },
  };
  const stored = { ...intended, actor: "svc_import", depth: 0, label: 0, enc: 0 };
  assert.equal(repairEventMatches(stored, intended), false);
});

test("repair duplicate validation rejects a changed span_id", () => {
  const intended = {
    id: "evt_agent_access_principal_created_agt_demo",
    type: "principal.created",
    sv: 1,
    trace_id: "c0".repeat(16),
    span_id: "span_repair",
    actor: "svc_host",
    vis: "space",
    entity: "principal",
    entity_id: "agt_demo",
    payload: { id: "agt_demo" },
  };
  const stored = { ...intended, span_id: "span_collision", depth: 0, label: 0, enc: 0 };
  assert.equal(repairEventMatches(stored, intended), false);
});

test("agent.renamed gives the agent's principal in the boot snapshot its new name, and renames no one else", () => {
  const access = new AccessSnapshot();
  foldEvent(access, {
    type: "principal.created",
    payload: { id: "agt_docs", kind: "agent", owner: "usr_olivia", status: "active", name: "Docs" },
  });
  foldEvent(access, {
    type: "principal.created",
    payload: { id: "usr_olivia", kind: "person", status: "active", name: "Olivia Reyes" },
  });
  foldEvent(access, { type: "agent.renamed", payload: { agentId: "agt_docs", name: "Front Desk" } });
  foldEvent(access, { type: "agent.renamed", payload: { agentId: "usr_olivia", name: "Nobody" } });
  assert.equal(access.principal("agt_docs")?.name, "Front Desk");
  assert.equal(access.principal("usr_olivia")?.name, "Olivia Reyes");
  assert.equal(isAccessEvent("agent.renamed"), true);
});
