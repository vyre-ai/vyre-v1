// agents: a watcher is a routine that runs when something happens, not at a time (P-CC_34): a new message in the channel it names starts one run under the routine owner.
// @reads /modules/agents/migrations/0001_agents.sql
// @reads /modules/agents/migrations/0002_routine_watch.sql
// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, consumers } from "../impl.ts";
import { DANA, assertEventsConform, contractErrors, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const call = async (hn: Harness, cap: string, input: Record<string, unknown>): Promise<any> => {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap}: input`);
  const out = await h[cap]!(hn.ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap}: output`);
  return out;
};
async function setup() {
  const hn = harness();
  const agent = (await call(hn, "agents.create", { name: "Scout", role: "Use me to watch intake.", idempotencyKey: `w${++n}` })).agent;
  hn.clear();
  return { hn, id: agent.agentId as string };
}
const watch = (hn: Harness, id: string, over: Record<string, unknown> = {}) =>
  call(hn, "agents.routine.save", { agentId: id, title: "Greet new leads", kind: "watch", watch: { on: "message", channelId: "chn_leads" }, prompt: "Say hello.", idempotencyKey: `x${++n}`, ...over });
const msg = (over: Record<string, unknown> = {}) => ({ name: "message.received", payload: { messageId: `msg_${++n}`, threadId: "thr_leads", threadSeq: 1, author: { kind: "person", id: "usr_pat" }, kind: "text", depth: 0, mentions: [], hasBlocks: false, ...over } });
const fire = (hn: Harness, event: ReturnType<typeof msg>) => (consumers["agents.watchers"].run as (c: Harness["ctx"], e: unknown) => Promise<string[]>)(hn.ctx, event);

test("a watcher is saved with no schedule, listed as a watcher, and never gets a next run", async () => {
  const { hn, id } = await setup();
  const { routine } = await watch(hn, id);
  assert.equal(routine.kind, "watch");
  assert.deepEqual(routine.watch, { on: "message", channelId: "chn_leads" });
  assert.equal(routine.cron, undefined);
  assert.equal(routine.nextRunAt, undefined, "nothing waits for a clock");
  assert.deepEqual((await call(hn, "agents.routines.list", { agentId: id })).routines, [routine]);
  assert.deepEqual(assertEventsConform(hn), []);
  // a schedule routine is unchanged, and turning a schedule into a watcher (and back) swaps what it waits for
  const sched = (await call(hn, "agents.routine.save", { agentId: id, title: "Digest", cron: "0 9 * * *", prompt: "p", idempotencyKey: "s1" })).routine;
  assert.equal(sched.kind, undefined);
  assert.equal(sched.cron, "0 9 * * *");
  const flipped = (await watch(hn, id, { routineId: sched.routineId, title: "Digest" })).routine;
  assert.deepEqual([flipped.kind, flipped.cron, flipped.nextRunAt], ["watch", undefined, undefined]);
  const back = (await call(hn, "agents.routine.save", { agentId: id, routineId: sched.routineId, title: "Digest", cron: "0 9 * * *", prompt: "p", idempotencyKey: "s2" })).routine;
  assert.deepEqual([back.kind, back.watch, back.cron], [undefined, undefined, "0 9 * * *"]);
});

test("a watcher needs its channel, and only a watcher may name one; a schedule needs its cron", async () => {
  const { hn, id } = await setup();
  // straight to the handler: these inputs are ones the contract itself may not describe (a missing watch, a bad channel id), and the handler must still refuse them
  const bad = (over: Record<string, unknown>) => {
    const input: Record<string, unknown> = { agentId: id, title: "Greet new leads", kind: "watch", watch: { on: "message", channelId: "chn_leads" }, prompt: "Say hello.", idempotencyKey: `y${++n}`, ...over };
    for (const k of Object.keys(input)) if (input[k] === undefined) delete input[k];
    return failure(() => h["agents.routine.save"]!(hn.ctx, input));
  };
  assert.equal(await bad({ watch: undefined }), "validation.bad_input");
  assert.equal(await bad({ watch: { on: "message", channelId: "usr_nope" } }), "validation.bad_input");
  assert.equal(await bad({ kind: "schedule", cron: "0 9 * * *" }), "validation.bad_input", "a schedule routine that names a watch is refused");
  assert.equal(await bad({ kind: "schedule", watch: undefined, cron: undefined }), "validation.bad_input");
  assert.equal((await call(hn, "agents.routines.list", { agentId: id })).routines.length, 0, "nothing was saved");
});

test("a watcher on a channel its owner cannot read is refused with permission.no_grant and never saved", async () => {
  const { hn, id } = await setup();
  hn.allowOnly((_a, res) => !(res.type === "channel" && res.id === "chn_secret"));
  const code = await failure(() => h["agents.routine.save"]!(hn.ctx, { agentId: id, title: "Spy", kind: "watch", watch: { on: "message", channelId: "chn_secret" }, prompt: "Read.", idempotencyKey: "sec1" }));
  assert.equal(code, "permission.no_grant");
  assert.equal((await call(hn, "agents.routines.list", { agentId: id })).routines.length, 0);
  // a channel they can read is fine, and changing an existing watcher to the secret channel is refused too
  const ok = (await watch(hn, id)).routine;
  const move = await failure(() => h["agents.routine.save"]!(hn.ctx, { agentId: id, routineId: ok.routineId, title: "Greet new leads", kind: "watch", watch: { on: "message", channelId: "chn_secret" }, prompt: "Say hello.", idempotencyKey: "sec2" }));
  assert.equal(move, "permission.no_grant");
  assert.equal((await call(hn, "agents.routines.list", { agentId: id })).routines[0].watch.channelId, "chn_leads", "the watcher still listens where it did");
});

test("a new message in the watched channel starts one run under the routine owner; other channels, the agent itself and routine messages do not", async () => {
  const { hn, id } = await setup();
  const started: any[] = [];
  const keys: string[] = [];
  hn.world.answer("runs.start", (i: any, o: any) => { started.push(i); keys.push(String(o?.idempotencyKey)); return { runId: `run_a${started.length}` }; });
  hn.world.answer("threads.get", (i: any) => ({ thread: { threadId: i.threadId, channelId: i.threadId === "thr_leads" ? "chn_leads" : "chn_other" } }));
  const { routine } = await watch(hn, id);
  hn.clear();
  const first = msg();
  assert.deepEqual(await fire(hn, first), ["run_a1"]);
  assert.deepEqual([started[0].kind, started[0].owner, started[0].name], ["routine", DANA, "Greet new leads"]);
  assert.deepEqual([started[0].threadId, started[0].trigger], ["thr_leads", { messageId: first.payload.messageId, threadId: "thr_leads", channelId: "chn_leads" }], "the run carries the message, thread and channel that woke it");
  assert.deepEqual(contractErrors("runs.start", "in", { ...started[0], idempotencyKey: keys[0] }), [], "what the watcher sends is a valid runs.start input");
  assert.deepEqual(hn.named("agent.routine_run_started")[0]!.payload, { agentId: id, routineId: routine.routineId, runId: "run_a1", ownerId: DANA, requestedBy: `watch:${first.payload.messageId}` });
  assert.deepEqual(assertEventsConform(hn), []);
  assert.deepEqual(await fire(hn, msg({ threadId: "thr_elsewhere" })), [], "another channel");
  assert.deepEqual(await fire(hn, msg({ author: { kind: "agent", id } })), [], "the watcher's own agent");
  assert.deepEqual(await fire(hn, msg({ via: "usr_dana" })), [], "a message posted on a routine");
  assert.equal(started.length, 1);
  // the same message twice asks for the same run (the idempotency key is the routine and the message), so the Run module starts one
  await fire(hn, first);
  assert.equal(keys[0], `watch:${routine.routineId}:${first.payload.messageId}`);
  assert.equal(keys[1], keys[0]);
  started.length = 1;
  // a disabled watcher is quiet
  await call(hn, "agents.routine.save", { agentId: id, routineId: routine.routineId, title: "Greet new leads", kind: "watch", watch: { on: "message", channelId: "chn_leads" }, prompt: "Say hello.", enabled: false, idempotencyKey: "off1" });
  const before = started.length;
  assert.deepEqual(await fire(hn, msg()), []);
  assert.equal(started.length, before);
});
// run on the final commit
