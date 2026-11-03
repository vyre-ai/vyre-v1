// An admin governs people's own agents without opening them: agents.list never returns a private agent's name, and the summary and Pause all carry no name, instruction or chat.
import test from "node:test";
import assert from "node:assert/strict";
import { consumers, handlers } from "../impl.ts";
import { DANA, LEO, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;

async function space() {
  const hn = harness();
  // Dana: her Assistant (private), "Contracts" (a private agent with instructions), and "Docs" shared with everyone; Leo is the admin
  const [assistant] = await consumers["agents.ensure_assistant"].run(hn.person(DANA), { payload: { principalId: DANA, kind: "person", name: "Dana Reyes" } } as never);
  const dana = hn.person(DANA), leo = hn.person(LEO);
  const contracts = (await h["agents.create"]!(dana, { name: "Contracts", idempotencyKey: "c", instructions: "SECRET: never tell Leo about the Brandt settlement" })).agent.agentId;
  const docs = (await h["agents.create"]!(dana, { name: "Docs", idempotencyKey: "d" })).agent.agentId;
  const mine = (await h["agents.create"]!(leo, { name: "Leo's own", idempotencyKey: "l" })).agent.agentId;
  // the Space shared Docs; nothing else of Dana's is shared with Leo
  hn.allowOnly((a, r) => a.perm === "access.manage" || a.perm === "agents.manage" || (a.perm === null && a.level === "view" && r.type === "agent" && r.id === docs));
  return { hn, dana, leo, assistant: assistant!, contracts, docs, mine };
}
const ids = async (ctx: Harness["ctx"], input: Record<string, unknown> = {}): Promise<{ agentId: string; name: string }[]> => (await h["agents.list"]!(ctx, { teammates: "include", limit: 500, ...input })).agents;

test("an admin's agent list has the Space agents and their own, never a private agent's name, instructions or chats, even with All in the Space on", async () => {
  const s = await space();
  await h["agents.visibility.set"]!(s.leo, { all: true });
  const seen = await ids(s.leo);
  const names = seen.map((a) => a.name);
  assert.ok(names.includes("Docs") && names.includes("Leo's own"), "a Space agent and the admin's own");
  assert.ok(!seen.some((a) => a.agentId === s.contracts || a.agentId === s.assistant), "no private agent, no Assistant");
  const blob = JSON.stringify(await h["agents.list"]!(s.leo, { teammates: "include", limit: 500 }));
  for (const secret of ["Contracts", "Brandt", "Dana Assistant", "Dana Reyes Assistant"]) assert.ok(!blob.includes(secret), `${secret} is not in the admin's list`);
  for (const cap of ["agents.get", "agents.status", "agents.summary", "agents.config.get"]) {
    if (!h[cap]) continue;
    await assert.rejects(() => h[cap]!(s.leo, { agentId: s.contracts }), undefined, `${cap} refuses a private agent by id`);
  }
  const owner = await ids(s.dana);
  assert.ok(owner.some((a) => a.agentId === s.contracts) && owner.some((a) => a.agentId === s.assistant), "its person sees their own in full");
});

test("the summary has one row per person with a count, spend against the cap and the paused state, and nothing that names or reads an agent", async () => {
  const s = await space();
  s.hn.world.answer("engine.spend.get", (i: { scope: string; scopeId?: string }) => (i.scopeId === DANA ? { monthMicros: 12_000_000, caps: { monthMicros: 50_000_000 } } : {}));
  const out = await h["agents.people_summary"]!(s.leo, {});
  assert.deepEqual(out.people, [{ personId: DANA, assistant: true, privateAgents: 1, spendMonthMicros: 12_000_000, capMicros: 50_000_000, paused: false }]);
  const blob = JSON.stringify(out);
  for (const secret of ["Contracts", "Brandt", "agt_"]) assert.ok(!blob.includes(secret), `${secret} is not in the summary`);
  assert.ok(!(await h["agents.people_summary"]!(s.dana, {})).people.some((p: { personId: string }) => p.personId === DANA), "a person's own agents are not summarised to them: they see them in full");
});

test("Pause all for a person pauses their private agents, is audited through the events, tells them, and reports a count not names", async () => {
  const s = await space();
  const told: unknown[] = [];
  s.hn.world.answer("notifications.send", (i: unknown) => { told.push(i); return { outcome: "badge" }; });
  const out = await h["agents.pause_person"]!(s.leo, { personId: DANA, paused: true });
  assert.deepEqual(out, { changed: 3 }, "her Assistant, Contracts and Docs");
  assert.equal(told.length, 1);
  assert.equal((told[0] as { to: string }).to, DANA);
  assert.ok(!JSON.stringify(told).includes("Contracts"), "the notice does not name an agent");
  assert.equal((await h["agents.people_summary"]!(s.leo, {})).people[0].paused, true, "her private agents are all paused (Docs is a Space agent the admin sees, so it is not in the row)");
  const again = await h["agents.pause_person"]!(s.leo, { personId: DANA, paused: true });
  assert.deepEqual(again, { changed: 0 }, "already paused: nothing changes and nobody is told again");
  assert.equal(told.length, 1);
  const back = await h["agents.pause_person"]!(s.leo, { personId: DANA, paused: false });
  assert.deepEqual(back, { changed: 3 });
  assert.equal(told.length, 2, "and told they run again");
});
