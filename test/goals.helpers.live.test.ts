// The owner's flow from the live MLA Space (4 Nov 2026), on a booted daemon: an agent is asked to make a goal and add two named people. The goal is made, the people show as helpers and are
// in the goal's chat (this used to fail: a goal chat is a private chat and "a private chat never gains people"), the plan attaches to the draft (this used to fail: a draft takes no new tasks),
// and what the agent is told lists what really happened for each person, so its reply cannot say "added" for a person who was not.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, invite, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";
import { outsideAgent, tool } from "./support/vault-matrix.ts";

let h: Hour;
let aliza: Person;
let rubab: Person;
before(async () => {
  h = await bootHour("gh");
  aliza = h.person("Aliza", "aliza", "aliza@firm.test", "aliza horse battery staple 9");
  rubab = h.person("Rubab", "rubab", "rubab@firm.test", "rubab horse battery staple 9");
  await join(h, aliza, await invite(h, aliza.email), { device: "web" });
  await join(h, rubab, await invite(h, rubab.email), { device: "web" });
});
after(async () => { await h?.stop(); });

test("an agent asked to make a goal with two named people: they are helpers and in the goal chat, the plan attaches, and the answer lists what happened", async () => {
  const agent = await outsideAgent(h.d, h.owner.token!, true);
  const deadline = Date.now() + 5 * 86_400_000;
  const made = await tool(agent.c, "goals_create", {
    title: "Fill Lab 9", finish: { kind: "checklist", line: "Every item is ticked", items: [{ id: "a", text: "Invite the list" }, { id: "b", text: "Post in the community" }] }, deadline, leadAgentId: h.agentId,
    helpers: [{ kind: "person", id: aliza.personId }, { kind: "person", id: rubab.personId }], start: false, idempotencyKey: "gh-1",
    plan: [{ key: "invite", title: "Invite the list", why: "The list converted well last time", assigned: { kind: "agent", id: h.agentId } }],
  });
  assert.equal(made.isError, false, made.text);
  const data = made.data as { goal: { id: string; status: string; helpers: Array<{ id: string }>; threadId: string }; seated: Array<{ id: string; inChat: boolean; error?: string }>; plan: { drafted: number } };
  assert.equal(data.goal.status, "draft");
  assert.deepEqual(data.goal.helpers.map((x) => x.id).sort(), [aliza.personId, rubab.personId].sort());
  assert.deepEqual(data.seated.map((s) => [s.id, s.inChat]).sort(), [[aliza.personId, true], [rubab.personId, true]].sort(), `each person's real result: ${JSON.stringify(data.seated)}`);
  assert.equal(data.plan.drafted, 1);
  // both are members of the goal chat, and the owner is too
  const thread = (await h.owner.call("threads.get", { threadId: data.goal.threadId })).thread as { members: Array<{ id: string }> };
  for (const id of [aliza.personId, rubab.personId]) assert.ok(thread.members.some((m) => m.id === id), `${id} is in the goal chat`);
  // the plan attaches to the draft
  const more = await tool(agent.c, "goals_plan_update", { goalId: data.goal.id, children: [{ key: "post", title: "Post in the community", why: "Posts moved it last time", assigned: { kind: "agent", id: h.agentId } }] });
  assert.equal(more.isError, false, more.text);
  assert.equal((more.data as { drafted: number }).drafted, 2);
  const got = await h.owner.call("goals.get", { goalId: data.goal.id });
  assert.deepEqual(got.draftPlan.map((s: { key: string }) => s.key), ["invite", "post"]);
  // a helper sees the goal; the owner edits it in place and the answer says what happened to a removed helper
  assert.ok(((await aliza.call("goals.list", { scope: "helping" })).goals as Array<{ id: string }>).some((g) => g.id === data.goal.id), "Aliza sees the goal she helps with");
  const edited = await h.owner.call("goals.update", { goalId: data.goal.id, title: "Fill Lab 9 and 10", helpers: [{ kind: "person", id: aliza.personId }] });
  assert.equal(edited.goal.title, "Fill Lab 9 and 10");
  assert.deepEqual(edited.seated.map((s: { id: string; inChat: boolean }) => [s.id, s.inChat]), [[aliza.personId, true]]);
  const activity = (await h.owner.call("goals.activity", { goalId: data.goal.id })).activity as Array<{ kind: string }>;
  assert.ok(activity.some((a) => a.kind === "edit"), "the edit is in the activity");
});
