// The removal wizard's host calls for agents and routines (members.owned): what a person owns, and handing it on, pausing it or deleting it.
// @reads /modules/agents/impl.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { hostCalls } from "../impl.ts";

function ctxOf(rows: Record<string, unknown[]>) {
  const ran: { sql: string; args: unknown[] }[] = [];
  const ctx = { now: () => 1000, db: { all: (sql: string) => rows[/agents_routine/.test(sql) ? "routine" : "agent"] ?? [], run: (sql: string, ...args: unknown[]) => { ran.push({ sql, args }); return { changes: 2 }; } } } as unknown as Ctx;
  return { ctx, ran };
}

test("owned_by lists the agents and routines of the person with a count, a sample and the ids", () => {
  const { ctx } = ctxOf({ agent: [{ id: "agt_1", name: "Helper" }], routine: [{ id: "rtn_1", title: "Morning" }, { id: "rtn_2", title: "Evening" }] });
  const out = hostCalls["agents.owned_by"](ctx, { person: "usr_a" });
  assert.deepEqual(out.agents, { count: 1, sample: [{ type: "agent", id: "agt_1", title: "Helper" }], ids: ["agt_1"] });
  assert.equal(out.routines.count, 2);
  assert.deepEqual(out.routines.ids, ["rtn_1", "rtn_2"]);
});

test("reassign, pause and delete act on the right table and say how many they touched", () => {
  const { ctx, ran } = ctxOf({});
  assert.equal(hostCalls["agents.reassign_owned"](ctx, { person: "usr_a", kind: "agents", action: "reassign", to: "usr_b" }), 2);
  assert.match(ran[0]!.sql, /UPDATE agents_agent SET "ownerId"/);
  assert.deepEqual(ran[0]!.args.slice(0, 1), ["usr_b"]);
  assert.equal(hostCalls["agents.reassign_owned"](ctx, { person: "usr_a", kind: "routines", action: "pause" }), 2);
  assert.match(ran[1]!.sql, /agents_routine SET "enabled" = 0/);
  assert.equal(hostCalls["agents.reassign_owned"](ctx, { person: "usr_a", kind: "agents", action: "delete" }), 2);
  assert.match(ran[2]!.sql, /"deletedAt" = \?/);
  assert.equal(hostCalls["agents.reassign_owned"](ctx, { person: "usr_a", kind: "agents", action: "reassign" }), 0, "no one to give it to: nothing moves");
  assert.equal(hostCalls["agents.reassign_owned"](ctx, { person: "usr_a", kind: "files", action: "delete" }), 0, "not a kind of this module");
});
