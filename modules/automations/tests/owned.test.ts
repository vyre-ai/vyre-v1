// The removal wizard's host calls for automations (members.owned).
// @reads /modules/automations/impl.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { hostCalls } from "../impl.ts";

function ctxOf(rows: unknown[]) {
  const ran: { sql: string; args: unknown[] }[] = [];
  const ctx = { now: () => 1000, db: { all: () => rows, run: (sql: string, ...args: unknown[]) => { ran.push({ sql, args }); return { changes: 3 }; } } } as unknown as Ctx;
  return { ctx, ran };
}

test("owned_by lists the automations of the person", () => {
  const { ctx } = ctxOf([{ id: "aut_1", name: "Weekly digest" }]);
  assert.deepEqual(hostCalls["automations.owned_by"](ctx, { person: "usr_a" }).automations, { count: 1, sample: [{ type: "automation", id: "aut_1", title: "Weekly digest" }], ids: ["aut_1"] });
});

test("reassign, pause and delete update the definitions and answer how many", () => {
  const { ctx, ran } = ctxOf([]);
  assert.equal(hostCalls["automations.reassign_owned"](ctx, { person: "usr_a", kind: "automations", action: "reassign", to: "usr_b" }), 3);
  assert.match(ran[0]!.sql, /SET "owner_id" = \?/);
  assert.equal(hostCalls["automations.reassign_owned"](ctx, { person: "usr_a", kind: "automations", action: "pause" }), 3);
  assert.match(ran[1]!.sql, /"status" = 'paused'/);
  assert.equal(hostCalls["automations.reassign_owned"](ctx, { person: "usr_a", kind: "automations", action: "delete" }), 3);
  assert.equal(hostCalls["automations.reassign_owned"](ctx, { person: "usr_a", kind: "agents", action: "delete" }), 0);
});
