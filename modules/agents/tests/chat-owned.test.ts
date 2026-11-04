// The Add people and agents sheet, agents side (lane l-addsheet): an agent a chat made for itself, the four share levels (Can chat with, Can use in their work, Can edit, Can manage), and the private Assistant.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, LEO, MAYA, assertEventsConform, contractErrors, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const call = async (hn: Harness, ctx: Harness["ctx"], cap: string, input: Record<string, unknown>): Promise<any> => {
  const withKey = cap === "agents.create" ? { idempotencyKey: `c${++n}`, ...input } : input;
  const out = await h[cap]!(ctx, withKey);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap}: output`);
  return out;
};
const withChat = (hn: Harness, threadId = "thr_chat1") => hn.world.answer("threads.get", (i) => { if (i.threadId !== threadId) throw Object.assign(new Error("gone"), { error: { code: "validation.not_found" } }); return { thread: { threadId } }; });

test("an agent made for a chat is a teammate of that chat: it carries chatOf, the Agents page leaves it out, and the chat lists it", async () => {
  const hn = harness();
  withChat(hn);
  const space = (await call(hn, hn.ctx, "agents.create", { name: "Intake", role: "Takes intake." })).agent;
  const mine = (await call(hn, hn.ctx, "agents.create", { name: "Checker", role: "Checks every upload against the spec", threadId: "thr_chat1" })).agent;
  assert.deepEqual([mine.kind, mine.chatOf, mine.teammateOf], ["teammate", "thr_chat1", undefined]);
  const ids = async (input: Record<string, unknown>): Promise<string[]> => (await call(hn, hn.ctx, "agents.list", input)).agents.map((a: { agentId: string }) => a.agentId);
  assert.deepEqual(await ids({}), [space.agentId]);
  assert.deepEqual((await ids({ teammates: "include" })).sort(), [space.agentId, mine.agentId].sort());
  assert.deepEqual(await ids({ threadId: "thr_chat1" }), [mine.agentId]);
  assert.deepEqual(await ids({ threadId: "thr_other" }), []);
  assert.equal((await call(hn, hn.ctx, "agents.get", { agentId: mine.agentId })).agent.chatOf, "thr_chat1");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("an agent for a chat needs a chat its maker can open, and belongs to a chat or a project, not both", async () => {
  const hn = harness();
  withChat(hn);
  assert.equal(await failure(() => h["agents.create"]!(hn.ctx, { name: "Lost", threadId: "thr_nowhere", idempotencyKey: "k1" })), "validation.not_found");
  assert.equal(await failure(() => h["agents.create"]!(hn.ctx, { name: "Both", threadId: "thr_chat1", projectId: "prj_a", idempotencyKey: "k2" })), "validation.bad_input");
  assert.equal(hn.rows("SELECT * FROM agents_agent").length, 0);
});

// ---- the four levels

const levels = ["view", "use", "edit", "manage"] as const;
const rank = (l: string): number => levels.indexOf(l as (typeof levels)[number]);
/** A Space where Leo holds `level` on every agent and nothing else is special. */
function leoHolds(level: (typeof levels)[number]) {
  return harness({ allow: (a, r) => (r.type !== "agent" ? true : rank(level) >= rank(a.level)) });
}
async function dana(hn: Harness, name = "Ember") {
  // Dana made it; she is the owner, whatever the grants say, so the checks below run as Leo
  const owner = harness({ raw: hn.raw, clock: hn.clock, files: hn.world });
  return (await call(owner, owner.ctx, "agents.create", { name, role: "Builds things." })).agent as { agentId: string };
}

test("Can chat with (view): Leo sees and reads the agent, so he can add it to his chats and talk to it; he cannot change it, rename it, pause it or delete it", async () => {
  const hn = leoHolds("view");
  const a = await dana(hn);
  const leo = hn.person(LEO);
  assert.equal((await call(hn, leo, "agents.get", { agentId: a.agentId })).agent.name, "Ember");
  assert.equal(await failure(() => h["agents.update"]!(leo, { agentId: a.agentId, patch: { model: "claude-sonnet-5-5" } })), "permission.no_grant", "settings need Can edit");
  assert.equal(await failure(() => h["agents.update"]!(leo, { agentId: a.agentId, patch: { name: "Ember2" } })), "permission.no_grant");
});

test("Can use in their work (use): an agent can be given work only with Can use; Can chat with is not enough, and the owner and the host always can", async () => {
  const view = leoHolds("view");
  const a = await dana(view);
  const asLeo = (hn: Harness) => hn.person(LEO);
  assert.deepEqual(await h["agents.outside.usable"]!(asLeo(view), { agentId: a.agentId }), { usable: false }, "Can chat with: not for tasks, automations or crews");
  const use = harness({ raw: view.raw, clock: view.clock, files: view.world, allow: (x, r) => r.type !== "agent" || rank("use") >= rank(x.level) });
  assert.deepEqual(await h["agents.outside.usable"]!(use.person(LEO), { agentId: a.agentId }), { usable: true });
  assert.deepEqual(await h["agents.outside.usable"]!(view.person(DANA), { agentId: a.agentId }), { usable: true }, "the owner");
  assert.deepEqual(await h["agents.outside.usable"]!(view.as({ kind: "service", id: "svc_host" } as never), { agentId: a.agentId }), { usable: true }, "the host");
  assert.deepEqual(await h["agents.outside.usable"]!(view.person(LEO), { agentId: "agt_unknown" }), { usable: true }, "an agent that is not there is the caller's to find out");
});

test("Can edit (edit): settings (agent.toml, AGENT.md, memory) change; renaming does not. Pause, delete and share are level manage in the pipeline and in access.share", async () => {
  const hn = leoHolds("edit");
  const a = await dana(hn);
  const leo = hn.person(LEO);
  const upd = await h["agents.update"]!(leo, { agentId: a.agentId, patch: { model: "claude-sonnet-5-5" } });
  assert.equal(upd.agent.model, "claude-sonnet-5-5");
  assert.equal(await failure(() => h["agents.update"]!(leo, { agentId: a.agentId, patch: { name: "Renamed" } })), "permission.no_grant", "rename is Can manage");
});

test("Can manage (manage): the person who manages the agent renames it, and so does its owner", async () => {
  const hn = leoHolds("manage");
  const a = await dana(hn);
  const renamed = await h["agents.update"]!(hn.person(LEO), { agentId: a.agentId, patch: { name: "Ember Prime" } });
  assert.equal(renamed.agent.name, "Ember Prime");
  const own = await h["agents.update"]!(hn.person(DANA), { agentId: a.agentId, patch: { name: "Ember Third" } });
  assert.equal(own.agent.name, "Ember Third");
});

test("a person's own Assistant is theirs alone: nobody else can see it, open it or be given work for it, whatever level they hold", async () => {
  const hn = harness();
  const [id] = await (await import("../impl.ts")).consumers["agents.ensure_assistant"].run(hn.person(DANA), { payload: { principalId: DANA, kind: "person", name: "Dana Reyes" } });
  const allowAll = hn.person(MAYA);
  assert.equal(await failure(() => h["agents.get"]!(allowAll, { agentId: id })), "validation.not_found");
  assert.deepEqual(await h["agents.outside.usable"]!(allowAll, { agentId: id }), { usable: false });
  assert.deepEqual(await h["agents.outside.usable"]!(hn.person(DANA), { agentId: id }), { usable: true });
  assert.equal(hn.named("agent.privacy_set").length, 1, "access is told it is private, which is how access.share refuses it");
});
