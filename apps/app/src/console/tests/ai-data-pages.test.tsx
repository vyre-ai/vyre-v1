import test from "node:test";
import assert from "node:assert/strict";
import { aiDataPageFor } from "../../shell/providers/console.tsx";
import { incidentDefaultFilters, mergeIncidentPages } from "../pages/Incidents.tsx";
import { canEditOwnerFloor, gateRuleDraft, mergeGateAgents } from "../pages/GateRules.tsx";
import { mergeReviewPages } from "../pages/AiSettings.tsx";
import { holdTargetOf, mergeHolds } from "../pages/Holds.tsx";

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
  assert.ok(aiDataPageFor("retention"));
  assert.ok(aiDataPageFor("holds"));
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
  const agent = (agentId: string, name: string) => ({ agentId, name }) as never;
  assert.deepEqual(mergeGateAgents([agent("agt_1", "One")], [agent("agt_1", "Updated"), agent("agt_2", "Two")]).map((row) => `${row.agentId}:${row.name}`), ["agt_1:Updated", "agt_2:Two"]);
});

test("sampled turn pagination keeps the latest unique turn state", () => {
  const item = (turnId: string, state: "waiting" | "ok" | "flagged") => ({ turnId, threadId: "thr_1", agentId: "agt_1", sampledAt: 1, state });
  assert.deepEqual(mergeReviewPages([item("trn_1", "waiting")], [item("trn_1", "ok"), item("trn_2", "flagged")]).map((row) => `${row.turnId}:${row.state}`), ["trn_1:ok", "trn_2:flagged"]);
});

test("hold search maps named app objects to governance targets and paginates uniquely", () => {
  assert.deepEqual(holdTargetOf({ kind: "chat", id: "thr_1", title: "Matter room" }), { kind: "thread", id: "thr_1", title: "Matter room" });
  assert.deepEqual(holdTargetOf({ kind: "file", id: "fil_1", title: "Brief" }), { kind: "file", id: "fil_1", title: "Brief" });
  const row = (id: string, reason: string) => ({ target: { kind: "file" as const, id }, title: id, reason, by: "usr_1", at: 1 });
  assert.deepEqual(mergeHolds([row("fil_1", "old")], [row("fil_1", "new"), row("fil_2", "two")]).map((item) => item.reason), ["new", "two"]);
});
