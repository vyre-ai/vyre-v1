import test from "node:test";
import assert from "node:assert/strict";
import { aiDataPageFor } from "../../shell/providers/console.tsx";
import { incidentDefaultFilters, mergeIncidentPages } from "../pages/Incidents.tsx";
import { canEditOwnerFloor, gateRuleDraft } from "../pages/GateRules.tsx";

test("Models and providers mounts a real Console page", () => {
  const page = aiDataPageFor("models");
  assert.ok(page);
  assert.ok(aiDataPageFor("spend"));
  assert.ok(aiDataPageFor("usage"));
  assert.ok(aiDataPageFor("logging"));
  assert.ok(aiDataPageFor("review"));
  assert.ok(aiDataPageFor("incidents"));
  assert.ok(aiDataPageFor("aipolicy"));
  assert.ok(aiDataPageFor("gate"));
  assert.equal(aiDataPageFor("not-ai-data"), null);
});

test("incident defaults keep every state visible and pagination preserves unique incidents", () => {
  assert.deepEqual([...incidentDefaultFilters()], []);
  const incident = (incidentId: string, state: "open" | "assigned" | "resolved") => ({ incidentId, state, kind: "other" as const, title: incidentId, openedAt: 1, notes: [] });
  assert.deepEqual(mergeIncidentPages([incident("inc_1", "open"), incident("inc_2", "assigned")], [incident("inc_2", "resolved"), incident("inc_3", "resolved")]).map((row) => `${row.incidentId}:${row.state}`), ["inc_1:open", "inc_2:resolved", "inc_3:resolved"]);
});

test("a new agent Gate override inherits a real parent rule and owner floors stay owner-only", () => {
  const parent = { act: "send" as const, mode: "hold" as const, approvers: "asker", peopleOnly: true, afterHours: 24, onTimeout: "drop" as const, escalateTo: "delegate" as const, emailBackstopHours: 4, scope: "space" as const };
  assert.deepEqual(gateRuleDraft("send", "agent", "agt_1", [], [], [parent]), { ...parent, scope: "agent", agentId: "agt_1" });
  assert.equal(canEditOwnerFloor(["rol_owner"]), true);
  assert.equal(canEditOwnerFloor(["rol_admin"]), false);
});
