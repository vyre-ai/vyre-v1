// Seeded Space rows for tasks. The small recipe finds fixtures/seed.ts by glob and does not import it,
// so this test is the import-graph edge that keeps CI from reporting the file as uncovered.

import assert from "node:assert/strict";
import test from "node:test";
import { seed } from "../fixtures/seed.ts";
import { initialState, isTaskKind, isTaskState, sameParty, slotFill } from "../handlers/state.ts";
import type { Party, SlotFill, TaskKind, TaskState } from "../handlers/state.ts";

const PARTY_KIND: ReadonlySet<string> = new Set(["person", "agent", "group", "role", "automation"]);

function partyOf(value: unknown): Party | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id.length === 0) return null;
  if (typeof row.kind !== "string" || !PARTY_KIND.has(row.kind)) return null;
  switch (row.kind) {
    case "person":
    case "agent":
    case "group":
    case "role":
    case "automation":
      return { kind: row.kind, id: row.id };
    default:
      return null;
  }
}

test("seeded tasks are legal starts on tasks_item", () => {
  assert.equal(seed.table, "tasks_item");
  assert.deepEqual(seed.rows.map((row) => row.id), ["tsk_seed_work", "tsk_seed_approve", "tsk_seed_review"]);
  const ids = new Set<string>();
  const fills = new Set<SlotFill>();
  for (const row of seed.rows) {
    assert.equal(ids.has(row.id), false, row.id);
    ids.add(row.id);
    assert.equal(isTaskKind(row.kind), true, row.kind);
    assert.equal(isTaskState(row.state), true, row.state);
    const kind: TaskKind = isTaskKind(row.kind) ? row.kind : "work";
    const state: TaskState = isTaskState(row.state) ? row.state : "todo";
    assert.equal(state, initialState(kind));
    const assigned = partyOf(row.assigned);
    assert.ok(assigned, `${row.id} assigned`);
    if (!assigned) continue;
    fills.add(slotFill(assigned));
    const reviewer = "reviewer" in row ? partyOf(row.reviewer) : null;
    const approver = "approver" in row ? partyOf(row.approver) : null;
    if ("reviewer" in row) {
      assert.ok(reviewer, `${row.id} reviewer`);
      if (reviewer) {
        fills.add(slotFill(reviewer));
        assert.equal(sameParty(assigned, reviewer), false);
      }
    }
    if ("approver" in row) {
      assert.ok(approver, `${row.id} approver`);
      if (approver) {
        fills.add(slotFill(approver));
        assert.equal(sameParty(assigned, approver), false);
      }
    }
    assert.equal(typeof row.title, "string");
    assert.ok(row.title.length > 0);
    assert.equal(typeof row.createdBy, "string");
    assert.ok(row.createdBy.length > 0);
  }
  assert.ok(fills.has("human"));
  assert.ok(fills.has("agent"));
});
