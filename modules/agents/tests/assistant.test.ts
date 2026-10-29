// Every person gets a private assistant when their account exists, with or without an AI account; a repeat delivery makes no second one.
// @reads /modules/agents/impl.ts
import test from "node:test";
import assert from "node:assert/strict";
import { consumers } from "../impl.ts";
import { DANA, LEO, harness } from "../fixtures/harness.ts";

const run = consumers["agents.ensure_assistant"].run;
const born = (id: string, name: string, kind = "person") => ({ payload: { principalId: id, kind, name } });

test("a person's account makes one private assistant owned by them, and a second delivery finds it", async () => {
  const hn = harness();
  const [id] = await run(hn.ctx, born(DANA, "Dana Reyes"));
  assert.match(id!, /^agt_/);
  const again = await run(hn.ctx, born(DANA, "Dana Reyes"));
  assert.deepEqual(again, [id]);
  const listed = (await (await import("../impl.ts")).handlers["agents.list"]!(hn.ctx, { section: "personal", limit: 100 }) as any).agents;
  const mine = listed.filter((a: any) => a.ownerId === DANA);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].role, "assistant");
  assert.equal(mine[0].name, "Dana Assistant");
});

test("two people with the same first name each get their own; agents and services get none", async () => {
  const hn = harness();
  const a = await run(hn.ctx, born(DANA, "Dana Reyes"));
  const b = await run(hn.ctx, born(LEO, "Dana Okafor"));
  assert.notDeepEqual(a, b);
  assert.deepEqual(await run(hn.ctx, born("agt_x", "Helper", "agent")), []);
  assert.deepEqual(await run(hn.ctx, born("svc_x", "Service", "service")), []);
});

test("the assistant belongs to its person alone: another member's list does not show it, and the lookup is by what create stores", async () => {
  const { handlers } = await import("../impl.ts");
  const list = handlers["agents.list"] as unknown as (c: unknown, i: unknown) => Promise<{ agents: { agentId: string; ownerId: string; role?: string; name: string }[] }>;
  const get = handlers["agents.get"] as unknown as (c: unknown, i: unknown) => Promise<{ agent: { role?: string } }>;
  const hn = harness();
  const [id] = await run(hn.person(DANA), born(DANA, "Dana Reyes"));
  hn.allowOnly(() => true);   // even a Space where everyone may view every agent, and an admin who sees all: the assistant stays its owner's
  // what the console assistant reads to find it: agentId, ownerId and role === "assistant"
  const mine = (await list(hn.person(DANA), { section: "personal", limit: 100 })).agents.find((a) => a.agentId === id);
  assert.deepEqual(mine && [mine.ownerId, mine.role], [DANA, "assistant"]);
  assert.equal((await get(hn.person(DANA), { agentId: id! })).agent.role, "assistant", "create stores the role the lookup matches");
  // another member: not in any section of their list, and a direct get answers as if it did not exist
  for (const section of ["personal", "shared", "space", undefined]) {
    const seen = (await list(hn.person(LEO), { ...(section ? { section } : {}), limit: 100 })).agents;
    assert.ok(!seen.some((a) => a.agentId === id), `not in ${section ?? "the default list"}`);
  }
  await assert.rejects(() => get(hn.person(LEO), { agentId: id! }), (e: any) => (e?.error?.code ?? e?.code) === "validation.not_found");
  // a second delivery (and a delivery for a differently written name) finds it and makes no duplicate
  assert.deepEqual(await run(hn.person(DANA), born(DANA, "Dana R.")), [id]);
  const again = (await list(hn.person(DANA), { section: "personal", limit: 100 })).agents.filter((a) => a.ownerId === DANA && a.role === "assistant");
  assert.equal(again.length, 1);
});
