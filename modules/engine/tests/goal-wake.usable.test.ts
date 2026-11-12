// A goal's wake-up starts its lead agent for the goal's owner only while that owner may still give the agent work (review 12 Nov): goals.wake_claim hands back the owner and the lead as stored
// (modules/goals/handlers/caps.ts wakeClaim checks neither), so an agent handed to someone else, or a share taken back, would otherwise go on working with the old owner's access.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/harness.ts";
import { onGoalEvent } from "../handlers/goal-wake.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";

const LEAD = "agt_lead", OWNER = "usr_owner";
const said: DriverEvent[] = [{ type: "text", text: "Checked in." }, { type: "done" }];

function scene(usable: boolean | null) {
  const h = harness({ threads: [{ threadId: "thr_goal", kind: "thread", starter: OWNER, agents: [{ agentId: LEAD, mode: "listen" }] }] });
  const provider = scriptedProvider({ script: said });
  const engine = h.runtime({ openSession: provider.openSession });
  const asked: Array<{ cap: string; as?: string }> = [];
  let attempt = 0;
  const host = {
    call: async (cap: string, input: unknown, as?: string) => {
      asked.push({ cap, ...(as ? { as } : {}) });
      // what the real wakeClaim answers: the stored owner and lead, claimed once per attempt
      if (cap === "goals.wake_claim") return ++attempt === 1 ? { claimed: true, threadId: "thr_goal", leadAgentId: LEAD, owner: OWNER } : { claimed: false };
      if (cap === "agents.outside.usable") { if (usable === null) throw new Error("agents is down"); return { usable }; }
      return h.ctx.call(cap, input);
    },
    now: () => h.clock.t,
    log: () => undefined,
  };
  const wake = () => onGoalEvent(h.ctx, host, engine, { name: "goal.woken", payload: { goalId: "gol_1", wakeId: "gwk_1", attempt: 1 } });
  return { h, provider, engine, asked, wake };
}

test("a goal's owner who can no longer give its lead agent work does not start it; one who can, does; an answer that cannot be had starts nothing", async () => {
  const no = scene(false);
  assert.deepEqual(await no.wake(), [], "the owner lost Can use on the lead: the wake starts no turn");
  await no.engine.idle("thr_goal").catch(() => undefined);
  assert.equal(no.provider.specs.length, 0);
  assert.deepEqual(no.asked.find((c) => c.cap === "agents.outside.usable"), { cap: "agents.outside.usable", as: OWNER }, "asked as the owner");

  const yes = scene(true);
  assert.deepEqual(await yes.wake(), [LEAD], "the owner may: the lead starts");
  await yes.engine.idle("thr_goal");
  assert.equal(yes.provider.specs[0]?.asker, OWNER);

  const down = scene(null);
  assert.deepEqual(await down.wake(), [], "fails closed");
});
