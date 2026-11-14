// Whose turns a Stop reaches (lead ruling, 14 Nov 2026). A member stops any agent's turn in the chat; a guest (no View on the Space) only a turn they asked for, and their Stop all only their own; an
// agent its own turn, and another's only when the person it acts for could. Real SQLite behind ctx.db, a fake provider that holds every turn, three people each asking one agent.
import test from "node:test";
import assert from "node:assert/strict";
import { stop, stopAll } from "../handlers/control.ts";
import { harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import { gate, until } from "../../../agent/src/turn-engine/harness.ts";
import type { EngineCtx } from "../projections.ts";

const THREAD = "thr_reach";
const NO_BEAT = (): (() => void) => () => {};
const person = (id: string) => ({ kind: "person" as const, id });
const ask = (a: string) => [{ kind: "agent" as const, id: a }];
const INTAKE = "agt_intake"; // Dana's
const DOCS = "agt_docs"; // Sam's
const BILLING = "agt_billing"; // Gus's, the guest

/** Three agents, each holding a turn for the person who asked it. */
async function world() {
  const h = harness({
    threads: [
      {
        threadId: THREAD,
        kind: "chat",
        starter: "usr_dana",
        agents: [
          { agentId: INTAKE, mode: "lead", model: "claude-sonnet-5-5" },
          { agentId: DOCS, mode: "listen" },
          { agentId: BILLING, mode: "listen" },
        ],
      },
    ],
  });
  const hold = gate();
  const p = scriptedProvider({
    script: [{ type: "text", text: "Done." }, { type: "done" }],
    beforeEvent: async (i) => {
      if (i === 0) await hold.wait;
    },
  });
  const engine = h.runtime({ openSession: p.openSession, schedule: NO_BEAT });
  engine.openThread({
    id: THREAD,
    kind: "chat",
    starter: "usr_dana",
    agents: [
      { id: INTAKE, mode: "lead", model: "claude-sonnet-5-5" },
      { id: DOCS, mode: "listen" },
      { id: BILLING, mode: "listen" },
    ],
  });
  engine.receive({ threadId: THREAD, author: person("usr_dana"), body: "one" });
  engine.receive({ threadId: THREAD, author: person("usr_sam"), mentions: ask(DOCS), body: "two" });
  engine.receive({ threadId: THREAD, author: person("usr_gus"), mentions: ask(BILLING), body: "three" });
  await until(() => engine.turns(THREAD).filter((t) => t.state === "running").length === 3);
  const running = (): string[] =>
    engine
      .turns(THREAD)
      .filter((t) => t.state === "running")
      .map((t) => t.agentId)
      .sort();
  const as = (who: string, guest: boolean, agent?: string): EngineCtx => {
    h.setManager(!guest);
    return agent
      ? { ...h.ctx, principal: { kind: "agent", id: agent }, actingFor: who }
      : { ...h.ctx, principal: { kind: "person", id: who } };
  };
  /** The agents with a running turn, once the stopped ones have wound down. */
  const runningIs = async (want: string[]): Promise<void> => {
    await until(() => JSON.stringify(running()) === JSON.stringify([...want].sort()));
  };
  return { h, engine, hold, running, runningIs, as };
}

test("a member stops any agent's turn in the chat", async () => {
  const w = await world();
  const out = await stop(w.as("usr_sam", false), { threadId: THREAD, agentId: INTAKE });
  assert.equal(out.stopped, 1);
  await w.runningIs([BILLING, DOCS]);
  w.hold.open();
  await w.engine.idle(THREAD);
});

test("a guest stops the turn they asked for and not another person's", async () => {
  const w = await world();
  const g = w.as("usr_gus", true);
  assert.equal((await stop(g, { threadId: THREAD, agentId: INTAKE })).stopped, 0, "Dana's agent is out of reach");
  assert.equal((await stop(g, { threadId: THREAD, agentId: DOCS })).stopped, 0, "so is Sam's");
  await w.runningIs([BILLING, DOCS, INTAKE]);
  assert.equal((await stop(g, { threadId: THREAD, agentId: BILLING })).stopped, 1, "their own turn stops");
  await w.runningIs([DOCS, INTAKE]);
  w.hold.open();
  await w.engine.idle(THREAD);
});

test("a guest's Stop all stops only their own turns, and a member's stops everything", async () => {
  const w = await world();
  assert.equal((await stopAll(w.as("usr_gus", true), { threadId: THREAD })).stopped, 1);
  await w.runningIs([DOCS, INTAKE]);
  assert.equal((await stopAll(w.as("usr_sam", false), { threadId: THREAD })).stopped, 2);
  await w.runningIs([]);
  w.hold.open();
  await w.engine.idle(THREAD);
});

test("the Stop event names who pressed it", async () => {
  const w = await world();
  await stop(w.as("usr_sam", false), { threadId: THREAD, agentId: INTAKE });
  const e = w.h.emitted.filter((x) => x.name === "turn.cancelled");
  assert.deepEqual(
    e.map((x) => [x.payload["agentId"], x.payload["by"]]),
    [[INTAKE, "usr_sam"]],
  );
  w.hold.open();
  await w.engine.idle(THREAD);
});

test("an agent stops its own turn, and another's only as far as the person it acts for could", async () => {
  const w = await world();
  // Docs works for Gus, a guest: Dana's agent is out of reach, Gus's own turn is in reach, its own turn is always its to stop
  const forGuest = w.as("usr_gus", true, DOCS);
  assert.equal((await stop(forGuest, { threadId: THREAD, agentId: INTAKE })).stopped, 0);
  assert.equal((await stop(forGuest, { threadId: THREAD, agentId: BILLING })).stopped, 1, "the guest's own turn");
  assert.equal((await stop(forGuest, { threadId: THREAD, agentId: DOCS })).stopped, 1, "its own turn");
  await w.runningIs([INTAKE]);
  w.hold.open();
  await w.engine.idle(THREAD);
});

test("an agent acting for a member reaches any turn; naming nobody it stops itself; its Stop all follows the person", async () => {
  const w = await world();
  const forMember = w.as("usr_sam", false, DOCS);
  assert.equal((await stop(forMember, { threadId: THREAD })).stopped, 1, "naming nobody stops itself");
  await w.runningIs([BILLING, INTAKE]);
  assert.equal(
    (await stop(forMember, { threadId: THREAD, agentId: INTAKE })).stopped,
    1,
    "a member's agent stops another's",
  );
  assert.equal(
    (await stopAll(w.as("usr_gus", true, BILLING), { threadId: THREAD })).stopped,
    1,
    "an agent for a guest: Stop all reaches the guest's turns only",
  );
  await w.runningIs([]);
  w.hold.open();
  await w.engine.idle(THREAD);
});
