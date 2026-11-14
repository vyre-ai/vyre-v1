// Whose data /permissions and /usage show (review of the Command card, 14 Nov 2026): on a booted daemon with two people, each sees only their own Always allow rules, and one person
// cannot take back another's rule. engine.my_ai answers each person for themselves. Server side: gate.allow.list filters on `person = ctx.actingFor ?? ctx.principal.id`
// (modules/gate/handlers/grants.ts:325-329), gate.allow.remove refuses a rule that is not the caller's unless the caller is an admin (grants.ts:344).
import test from "node:test";
import assert from "node:assert/strict";
import { MAC, NOAH, bootSpace } from "./support/runson.ts";

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

test(
  "two people on one Space: each lists only their own rules, cannot take back the other's, and my_ai answers each for themselves",
  { timeout: 120_000 },
  async () => {
    const s = await bootSpace();
    try {
      const rule = { act: "approve", target: "files.write", agentId: "agt_nobody" };
      const olivia = await s.as(MAC, "gate.allow.set", { ...rule, target: "files.write" });
      const noah = await s.as(NOAH, "gate.allow.set", { ...rule, target: "files.delete" });
      assert.equal(olivia.status, 200, JSON.stringify(olivia.data));
      assert.equal(noah.status, 200, JSON.stringify(noah.data));
      const mine = (await s.as(MAC, "gate.allow.list", {})).data.rules as J[];
      const his = (await s.as(NOAH, "gate.allow.list", {})).data.rules as J[];
      assert.deepEqual(
        mine.map((r) => r.target),
        ["files.write"],
        "Olivia sees her own rule only",
      );
      assert.deepEqual(
        his.map((r) => r.target),
        ["files.delete"],
        "Noah sees his own rule only",
      );
      const refused = await s.as(NOAH, "gate.allow.remove", { id: olivia.data.rule.id });
      assert.notEqual(refused.status, 200, "Noah cannot take back Olivia's rule");
      assert.equal(JSON.stringify(refused.data).includes("not_found"), true, JSON.stringify(refused.data));
      const still = (await s.as(MAC, "gate.allow.list", {})).data.rules as J[];
      assert.equal(still.length, 1, "her rule is still there");
      const taken = await s.as(MAC, "gate.allow.remove", { id: olivia.data.rule.id });
      assert.equal(taken.status, 200, JSON.stringify(taken.data));
      assert.equal(((await s.as(NOAH, "gate.allow.list", {})).data.rules as J[]).length, 1, "and his is untouched");
      // /usage: each person is answered for themselves (accounts come from the caller's own resolver, use from the caller's own turns)
      const a = await s.as(MAC, "engine.my_ai", {});
      const b = await s.as(NOAH, "engine.my_ai", {});
      assert.equal(a.status, 200, JSON.stringify(a.data));
      assert.equal(b.status, 200, JSON.stringify(b.data));
      assert.deepEqual(Object.keys(a.data.use).sort(), ["month", "today"]);
      assert.equal(a.data.use.today.turns, 0, "no turns of anyone else's are counted for her");
    } finally {
      await s.stop();
    }
  },
);
