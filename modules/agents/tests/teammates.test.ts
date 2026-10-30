// An agent made for one project is a teammate (owner ruling 20 Oct): it carries the project it was made for, the Agents page leaves it out unless asked, and it is the same agent otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { assertEventsConform, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const call = async (hn: Harness, cap: string, input: Record<string, unknown>): Promise<any> => {
  const withKey = cap === "agents.create" ? { idempotencyKey: `t${++n}`, ...input } : input;
  assert.deepEqual(contractErrors(cap, "in", withKey), [], `${cap}: input`);
  const out = await h[cap]!(hn.ctx, withKey);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap}: output`);
  return out;
};

test("a teammate carries its project, is left out of the Agents page by default, and shows when asked for", async () => {
  const hn = harness();
  const space = (await call(hn, "agents.create", { name: "Intake", role: "Takes intake." })).agent;
  const mate = (await call(hn, "agents.create", { name: "Reviewer one", role: "Reviews drafts.", projectId: "prj_probate" })).agent;
  assert.equal(mate.teammateOf, "prj_probate");
  assert.equal(space.teammateOf, undefined);
  const ids = async (input: Record<string, unknown>): Promise<string[]> => (await call(hn, "agents.list", input)).agents.map((a: { agentId: string }) => a.agentId);
  assert.deepEqual(await ids({}), [space.agentId], "the Agents page lists the Space's agents");
  assert.deepEqual((await ids({ teammates: "include" })).sort(), [space.agentId, mate.agentId].sort());
  assert.deepEqual(await ids({ teammates: "only" }), [mate.agentId]);
  assert.deepEqual(await ids({ projectId: "prj_probate" }), [mate.agentId]);
  assert.deepEqual(await ids({ projectId: "prj_other" }), []);
  assert.equal((await call(hn, "agents.get", { agentId: mate.agentId })).agent.teammateOf, "prj_probate");
  assert.deepEqual(assertEventsConform(hn), []);
});
