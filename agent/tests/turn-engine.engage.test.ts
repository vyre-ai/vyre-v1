// An agent that joins a thread that is already open (a task's reviewer) can be woken, and a thread opened for one person can be worked for another (a task thread is worked for whoever asked for the task).
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";

const say = [{ type: "text" as const, text: "On it." }, { type: "done" as const }];

test("engage adds an agent once, as a listener beside a lead, and a wake then runs it", async () => {
  const p = scriptedProvider({ script: () => say });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "thread", starter: "svc", agents: [{ id: "doer", mode: "lead" }] });
  engine.engage("T", { id: "checker", mode: "lead" });
  engine.engage("T", { id: "checker", mode: "lead" });
  assert.deepEqual(engine.agents("T").map((a) => [a.id, a.mode]), [["doer", "lead"], ["checker", "listen"]], "one lead per thread, and joining twice changes nothing");
  engine.wake("T", "checker");
  await engine.idle("T");
  assert.equal(p.specs[0]!.agent.id, "checker", "the wake runs the engaged agent first (its plain reply then goes to the lead, as in any chat)");
});

test("a wake runs for the starter, and setStarter changes whose that is", async () => {
  const p = scriptedProvider({ script: () => say });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "thread", starter: "svc_host", agents: [{ id: "doer", mode: "listen" }] });
  engine.setStarter("T", "usr_owner");
  engine.wake("T", "doer");
  await engine.idle("T");
  assert.equal(p.specs[0]!.asker, "usr_owner");
  assert.throws(() => engine.setStarter("nope", "x"), RangeError);
});
