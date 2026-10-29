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
