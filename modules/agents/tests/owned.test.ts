// The removal wizard's host calls for agents and routines (members.owned): what a person owns, and handing it on, pausing it or deleting it.
// @reads /modules/agents/impl.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { consumers, handlers, hostCalls } from "../impl.ts";
import { DANA, LEO, harness } from "../fixtures/harness.ts";

function ctxOf(rows: Record<string, unknown[]>) {
  const ran: { sql: string; args: unknown[] }[] = [];
  const ctx = { now: () => 1000, emit: () => undefined, log: { warn: () => undefined }, db: { all: (sql: string) => rows[/agents_routine/.test(sql) ? "routine" : "agent"] ?? [], run: (sql: string, ...args: unknown[]) => { ran.push({ sql, args }); return { changes: 2 }; } } } as unknown as Ctx;
  return { ctx, ran };
}

test("owned_by lists the agents and routines of the person with a count, a sample and the ids", () => {
  const { ctx } = ctxOf({ agent: [{ id: "agt_1", name: "Helper" }], routine: [{ id: "rtn_1", title: "Morning" }, { id: "rtn_2", title: "Evening" }] });
  const out = hostCalls["agents.owned_by"](ctx, { person: "usr_a" });
  assert.deepEqual(out.agents, { count: 1, sample: [{ type: "agent", id: "agt_1", title: "Helper" }], ids: ["agt_1"] });
  assert.equal(out.routines.count, 2);
  assert.deepEqual(out.routines.ids, ["rtn_1", "rtn_2"]);
});

test("reassign, pause and delete act on the right table and say how many they touched", async () => {
  const { ctx, ran } = ctxOf({});
  assert.equal(await hostCalls["agents.reassign_owned"](ctx, { person: "usr_a", kind: "agents", action: "reassign", to: "usr_b" }), 2);
  assert.match(ran[0]!.sql, /UPDATE agents_agent SET "ownerId"/);
  assert.deepEqual(ran[0]!.args.slice(0, 1), ["usr_b"]);
  assert.equal(await hostCalls["agents.reassign_owned"](ctx, { person: "usr_a", kind: "routines", action: "pause" }), 2);
  assert.match(ran[1]!.sql, /agents_routine SET "enabled" = 0/);
  assert.equal(await hostCalls["agents.reassign_owned"](ctx, { person: "usr_a", kind: "agents", action: "reassign" }), 0, "no one to give it to: nothing moves");
  assert.equal(await hostCalls["agents.reassign_owned"](ctx, { person: "usr_a", kind: "files", action: "delete" }), 0, "not a kind of this module");
});

const H = handlers as unknown as Record<string, (c: unknown, i: unknown) => Promise<any>>;
const born = (id: string, name: string) => ({ payload: { principalId: id, kind: "person", name } });
const left = consumers["agents.person_left"].run;

test("a person who owned nothing else still loses their assistant: it ends with them, with the event everything downstream listens for", async () => {
  const hn = harness();
  const [id] = await consumers["agents.ensure_assistant"].run(hn.person(DANA), born(DANA, "Dana Reyes"));
  assert.equal((hostCalls["agents.owned_by"](hn.ctx as never, { person: DANA })).agents.count, 0, "the wizard has nothing to do here");
  hn.clear();
  await left(hn.ctx, { payload: { personId: DANA } });
  assert.deepEqual(hn.named("agent.deleted").map((e) => e.payload["agentId"]), [id]);
  assert.equal(hn.rows("SELECT deletedAt FROM agents_agent WHERE id = ?", id)[0]!["deletedAt"], hn.clock.t);
  await left(hn.ctx, { payload: { personId: DANA } });
  assert.equal(hn.named("agent.deleted").length, 1, "a second delivery does nothing");
});

test("someone who leaves by themselves hands nothing on: their agents pause with the reason shown and their routines stop", async () => {
  const hn = harness();
  const a = (await H["agents.create"]!(hn.person(DANA), { name: "Bookkeeper" })).agent;
  hn.db.run(`INSERT INTO agents_routine (id, agentId, ownerId, title, cron, prompt, enabled, createdAt, updatedAt) VALUES ('rtn_1', ?, ?, 'Morning', '0 9 * * *', 'Go', 1, 1, 1)`, a.agentId, DANA);
  await left(hn.ctx, { payload: { personId: DANA } });
  const row = hn.rows("SELECT paused, pausedReason FROM agents_agent WHERE id = ?", a.agentId)[0]!;
  assert.deepEqual([row["paused"], row["pausedReason"]], [1, "The owner left this Space"]);
  assert.deepEqual(hn.named("agent.paused").map((e) => e.payload["agentId"]), [a.agentId]);
  assert.equal(hn.rows("SELECT enabled FROM agents_routine WHERE id = 'rtn_1'")[0]!["enabled"], 0);
});

test("the wizard's delete goes the one way: the agents leave with agent.deleted, and a private assistant is never among those it moves", async () => {
  const hn = harness();
  const [assistant] = await consumers["agents.ensure_assistant"].run(hn.person(DANA), born(DANA, "Dana Reyes"));
  const a = (await H["agents.create"]!(hn.person(DANA), { name: "Bookkeeper" })).agent;
  hn.clear();
  assert.equal(await hostCalls["agents.reassign_owned"](hn.ctx as never, { person: DANA, kind: "agents", action: "delete" }), 1);
  assert.deepEqual(hn.named("agent.deleted").map((e) => e.payload["agentId"]), [a.agentId]);
  assert.equal(hn.rows("SELECT deletedAt FROM agents_agent WHERE id = ?", assistant)[0]!["deletedAt"], null, "the assistant goes with its person, not with the wizard");
  assert.equal(await hostCalls["agents.reassign_owned"](hn.ctx as never, { person: DANA, kind: "agents", action: "reassign", to: LEO }), 0);
  assert.equal(hn.rows("SELECT ownerId FROM agents_agent WHERE id = ?", assistant)[0]!["ownerId"], DANA, "and is never handed on");
});

test("a person cannot delete their own assistant: they have one for as long as they are here", async () => {
  const hn = harness();
  const [id] = await consumers["agents.ensure_assistant"].run(hn.person(DANA), born(DANA, "Dana Reyes"));
  await assert.rejects(() => H["agents.delete"]!(hn.person(DANA), { agentId: id }), (e: any) => e?.error?.code === "validation.precondition_failed");
});
