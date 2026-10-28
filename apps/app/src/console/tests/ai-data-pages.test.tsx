import test from "node:test";
import assert from "node:assert/strict";
import { aiDataPageFor } from "../../shell/providers/console.tsx";
import { incidentDefaultFilters, mergeIncidentPages } from "../pages/Incidents.tsx";

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
