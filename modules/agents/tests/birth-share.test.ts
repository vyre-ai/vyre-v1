// What an agent is born with (the owner's decision, 15 Nov 2026): an agent a person makes in a Team Space is the team's, so its birth says `shared` and the gateway writes the one Everyone use grant with it.
// An Assistant and an outside agent are their person's, a project teammate and a chat's agent follow their own rules, an agent made by an agent is its person's, and `sharing: "me"` keeps it to its maker.
import test from "node:test";
import assert from "node:assert/strict";
import { consumers, handlers } from "../impl.ts";
import { DANA, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
const born = (hn: Harness): Array<Record<string, unknown>> => hn.named("agent.created").map((e) => e.payload);

test("a person's new agent in a Team Space is born shared", async () => {
  const hn = harness();
  await h["agents.create"]!(hn.ctx, { name: "Intake", idempotencyKey: "a" });
  assert.equal(born(hn)[0]!["shared"], true);
});

test("sharing me keeps it to its maker", async () => {
  const hn = harness();
  await h["agents.create"]!(hn.ctx, { name: "Ledger", sharing: "me", idempotencyKey: "a" });
  assert.equal(born(hn)[0]!["shared"], undefined);
});

test("an Assistant, an outside agent, a teammate and an agent made by an agent are not born shared", async () => {
  const hn = harness();
  await consumers["agents.ensure_assistant"].run(hn.person(DANA), {
    payload: { principalId: DANA, kind: "person", name: "Dana Reyes" },
  } as never);
  await h["agents.outside.connect"]!({ ...hn.ctx, depth: 1 }, { clientName: "Claude Code" });
  await h["agents.create"]!(hn.ctx, { name: "Helper", projectId: "prj_1", idempotencyKey: "t" }).catch(() => undefined);
  await h["agents.create"]!(hn.as({ kind: "agent", id: "agt_maker" }, DANA), { name: "Made", idempotencyKey: "m" });
  const shared = born(hn).filter((p) => p["shared"] === true);
  assert.deepEqual(shared, [], "none of them carries a share");
  assert.ok(born(hn).length >= 3, "they were born");
});

test("a Personal Space has no team to share with", async () => {
  const hn = harness();
  hn.world.handlers["spaces.matrix"] = () => ({ kind: "personal" });
  await h["agents.create"]!(hn.ctx, { name: "Mine", idempotencyKey: "a" });
  assert.equal(born(hn)[0]!["shared"], undefined);
});
