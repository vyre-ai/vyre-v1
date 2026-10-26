// The removal wizard's host calls for projects (members.owned): the projects a person leads, and handing the lead over through the module's own capabilities.
// @reads /modules/projects/impl.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { hostCalls } from "../impl.ts";

test("owned_by lists the projects the person leads", () => {
  const ctx = { db: { all: () => [{ projectId: "prj_1" }, { projectId: "prj_2" }] } } as unknown as Ctx;
  const out = hostCalls["projects.owned_by"](ctx, { person: "usr_a" });
  assert.equal(out.projects.count, 2);
  assert.deepEqual(out.projects.ids, ["prj_1", "prj_2"]);
});

test("reassign gives each project the new lead and removes the old one, as the caller", async () => {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const ctx = { db: { all: () => [{ projectId: "prj_1" }] }, call: async (cap: string, input: Record<string, unknown>) => { calls.push({ cap, input }); return {}; } } as unknown as Ctx;
  assert.equal(await hostCalls["projects.reassign_owned"](ctx, { person: "usr_a", kind: "projects", action: "reassign", to: "usr_b" }), 1);
  assert.deepEqual(calls.map((c) => c.cap), ["projects.members.set", "projects.members.remove"]);
  assert.deepEqual(calls[0]!.input, { projectId: "prj_1", principal: "usr_b", role: "lead", idempotencyKey: "own-usr_a-prj_1" });
  assert.deepEqual(calls[1]!.input, { projectId: "prj_1", principal: "usr_a" });
  assert.equal(await hostCalls["projects.reassign_owned"](ctx, { person: "usr_a", kind: "projects", action: "retain" }), 0);
  assert.equal(calls.length, 2);
});
