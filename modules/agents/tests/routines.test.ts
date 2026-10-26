// agents: routines (spec 2.6, ARCH 7.2 message meta). A routine is the schedule one person set for an agent. A message the agent posts because of it carries `via` { routineOwner } and the line
// "Sent by <agent> on a routine <person> set". Only the routine's owner sees, edits or deletes it.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { markRoutineRan, nextRun, parseCron, routineLabel, routineVia } from "../projections.ts";
import { DANA, MAYA, assertEventsConform, contractErrors, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const call = async (hn: Harness, cap: string, input: Record<string, unknown>, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap}: input`);
  const out = await h[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap}: output`);
  return out;
};
async function setup() {
  const hn = harness();
  const agent = (await call(hn, "agents.create", { name: "Intake", role: "Use me when a form arrives.", idempotencyKey: `c${++n}` })).agent;
  hn.clear();
  return { hn, id: agent.agentId as string, agent };
}
const save = (hn: Harness, id: string, over: Record<string, unknown> = {}, ctx: Harness["ctx"] = hn.ctx) =>
  call(hn, "agents.routine.save", { agentId: id, title: "Morning digest", cron: "0 9 * * 1-5", prompt: "Summarise yesterday's intake.", idempotencyKey: `r${++n}`, ...over }, ctx);

test("a routine is saved with its schedule, announced, and shows when it runs next", async () => {
  const { hn, id } = await setup();
  const { routine } = await save(hn, id, { channelId: "chn_intake" });
  assert.match(routine.routineId, /^rtn_[0-9a-z]+$/);
  assert.deepEqual({ title: routine.title, cron: routine.cron, enabled: routine.enabled, ownerId: routine.ownerId, channelId: routine.channelId, agentId: routine.agentId }, { title: "Morning digest", cron: "0 9 * * 1-5", enabled: true, ownerId: DANA, channelId: "chn_intake", agentId: id });
  assert.equal(routine.nextRunAt, nextRun("0 9 * * 1-5", hn.clock.t));
  assert.equal(new Date(routine.nextRunAt).getUTCHours(), 9);
  assert.equal(routine.lastRunAt, undefined);
  assert.deepEqual(hn.named("agent.routine_changed")[0]!.payload, { agentId: id, routineId: routine.routineId, op: "created" });
  assert.deepEqual(assertEventsConform(hn), []);
  const listed = await call(hn, "agents.routines.list", { agentId: id });
  assert.deepEqual(listed.routines, [routine]);
});

test("changing a routine keeps its id and owner, recomputes the next run, and a disabled routine has none", async () => {
  const { hn, id } = await setup();
  const { routine } = await save(hn, id);
  hn.clear();
  hn.advance(1000);
  const up = (await save(hn, id, { routineId: routine.routineId, title: "Evening digest", cron: "30 17 * * *", prompt: "Evening summary." })).routine;
  assert.deepEqual([up.routineId, up.title, up.cron, up.ownerId], [routine.routineId, "Evening digest", "30 17 * * *", DANA]);
  assert.equal(new Date(up.nextRunAt).getUTCHours() * 60 + new Date(up.nextRunAt).getUTCMinutes(), 17 * 60 + 30);
  assert.deepEqual(hn.named("agent.routine_changed")[0]!.payload["op"], "updated");
  const off = (await save(hn, id, { routineId: routine.routineId, title: "Evening digest", cron: "30 17 * * *", prompt: "x", enabled: false })).routine;
  assert.equal(off.enabled, false);
  assert.equal(off.nextRunAt, undefined);
  assert.equal((await call(hn, "agents.routines.list", { agentId: id })).routines.length, 1);
});

test("only the routine's owner sees, changes or deletes it, whatever else they may do with the agent", async () => {
  const { hn, id } = await setup();
  const mine = (await save(hn, id)).routine;
  const maya = hn.person(MAYA);
  assert.deepEqual((await call(hn, "agents.routines.list", { agentId: id }, maya)).routines, [], "Maya sees the agent and none of Dana's routines");
  const hers = (await save(hn, id, { title: "Maya's check", cron: "0 8 * * *" }, maya)).routine;
  assert.equal(hers.ownerId, MAYA);
  assert.deepEqual((await call(hn, "agents.routines.list", { agentId: id }, maya)).routines.map((r: any) => r.routineId), [hers.routineId]);
  assert.deepEqual((await call(hn, "agents.routines.list", { agentId: id })).routines.map((r: any) => r.routineId), [mine.routineId]);
  // Maya cannot reach Dana's routine by its id: edit and delete answer as if it were not there.
  assert.equal(await failure(() => save(hn, id, { routineId: mine.routineId, title: "Mine now" }, maya)), "validation.bad_input");
  assert.equal(await failure(() => call(hn, "agents.routine.delete", { agentId: id, routineId: mine.routineId }, maya)), "validation.not_found");
  assert.equal(hn.rows("SELECT title FROM agents_routine WHERE id = ?", mine.routineId)[0]!["title"], "Morning digest", "untouched");
  // Not even the agent's owner, or an admin: it is the setter's.
  const owner = hn.as({ kind: "person", id: DANA });
  assert.equal(await failure(() => call(hn, "agents.routine.delete", { agentId: id, routineId: hers.routineId }, owner)), "validation.not_found");
  // An agent acting for Dana sets Dana's routine.
  const viaAgent = (await save(hn, id, { title: "From her assistant" }, hn.as({ kind: "agent", id: "agt_assistant" }, DANA))).routine;
  assert.equal(viaAgent.ownerId, DANA);
  assert.deepEqual(await call(hn, "agents.routine.delete", { agentId: id, routineId: hers.routineId }, maya), { deleted: true });
  assert.equal(hn.named("agent.routine_changed").at(-1)!.payload["op"], "deleted");
  assert.equal(hn.rows("SELECT id FROM agents_routine").length, 2);
});

test("the routine's label says who set it, and the post carries the owner so the label can be drawn", async () => {
  const { hn, id } = await setup();
  const { routine } = await save(hn, id);
  assert.equal(routineLabel("Intake", "Dana"), "Sent by Intake on a routine Dana set");
  const via = routineVia({ ownerId: routine.ownerId });
  assert.deepEqual(via, { routineOwner: DANA });
  // The post the scheduler makes for this routine is a valid chat.post with that `via`.
  const post = { threadId: "thr_a1", body: "Yesterday: 4 new matters.", via, idempotencyKey: "p1" };
  assert.deepEqual(contractErrors("chat.post", "in", post), []);
  assert.notDeepEqual(contractErrors("chat.post", "in", { ...post, via: { routineOwner: "not an id" } }), [], "the owner must be a person id");
});

test("the scheduler records a run and the next one is worked out from it", async () => {
  const { hn, id } = await setup();
  const { routine } = await save(hn, id, { cron: "*/15 * * * *" });
  const at = routine.nextRunAt as number;
  const ran = markRoutineRan(hn.db, routine.routineId, at)!;
  assert.equal(ran.lastRunAt, at);
  assert.equal(ran.nextRunAt, at + 15 * 60_000);
  assert.equal(markRoutineRan(hn.db, "rtn_none", at), null);
  const listed = (await call(hn, "agents.routines.list", { agentId: id })).routines[0];
  assert.deepEqual([listed.lastRunAt, listed.nextRunAt], [at, at + 15 * 60_000]);
});

test("what a routine needs: five cron fields that mean something, a title, a prompt, a channel id, a visible agent", async () => {
  const { hn, id } = await setup();
  // straight to the handler: some of these inputs are not even valid against the schema, and the handler must still refuse them in its own words
  const bad = (over: Record<string, unknown>) => failure(() => h["agents.routine.save"]!(hn.ctx, { agentId: id, title: "T", cron: "0 9 * * *", prompt: "P", idempotencyKey: "x", ...over }));
  for (const cron of ["", "0 9 * *", "0 9 * * * *", "60 9 * * *", "0 24 * * *", "0 9 32 * *", "0 9 * 13 *", "0 9 * * 8", "*/0 * * * *", "a b c d e", "5-1 * * * *"]) assert.equal(await bad({ cron }), "validation.bad_input", cron);
  assert.equal(await bad({ title: "   " }), "validation.bad_input");
  assert.equal(await bad({ title: "t".repeat(121) }), "validation.bad_input");
  assert.equal(await bad({ prompt: "  " }), "validation.bad_input");
  assert.equal(await bad({ prompt: "p".repeat(20_001) }), "validation.bad_input");
  assert.equal(await bad({ channelId: "usr_x" }), "validation.bad_input");
  assert.equal(await bad({ routineId: "rtn_none" }), "validation.bad_input");
  assert.equal(await bad({ agentId: "agt_none" }), "validation.bad_input");
  assert.equal(hn.rows("SELECT id FROM agents_routine").length, 0, "nothing was saved by any of these");
  assert.deepEqual(hn.names(), []);
});

test("cron: lists, ranges, steps, day-of-week 7 as Sunday, and either day field when both are set", () => {
  const t0 = Date.UTC(2026, 9, 25, 10, 7, 30);   // Sunday 25 Oct 2026, 10:07:30 UTC
  const at = (e: string) => new Date(nextRun(e, t0)!).toISOString().slice(0, 16);
  assert.equal(at("* * * * *"), "2026-10-25T10:08");
  assert.equal(at("0 9 * * *"), "2026-10-26T09:00");
  assert.equal(at("*/20 * * * *"), "2026-10-25T10:20");
  assert.equal(at("0,30 11-12 * * *"), "2026-10-25T11:00");
  assert.equal(at("0 9 * * 1-5"), "2026-10-26T09:00", "Monday");
  assert.equal(at("0 9 * * 0"), "2026-11-01T09:00", "next Sunday, the 25th at 9 has passed");
  assert.equal(at("0 9 * * 7"), "2026-11-01T09:00", "7 is Sunday too");
  assert.equal(at("0 0 1 1 *"), "2027-01-01T00:00");
  assert.equal(at("0 0 13 * 5"), "2026-10-30T00:00", "the 13th or a Friday, whichever comes first");
  assert.equal(nextRun("0 0 31 2 *", t0), null, "31 February never comes");
  assert.equal(nextRun("nonsense", t0), null);
  assert.ok(parseCron("5 4 * * sun") === null, "names are not supported");
});

test("run now starts one run as the routine owner, never the caller, and leaves the schedule alone", async () => {
  const { hn, id } = await setup();
  const { routine } = await save(hn, id);
  const started: any[] = [];
  hn.world.answer("runs.start", (i: any) => { started.push(i); return { runId: "run_a1b2c3" }; });
  hn.clear();
  hn.advance(60_000);
  // Maya can use the agent; she asks, the run is still Dana's
  const out = await call(hn, "agents.routine.run_now", { agentId: id, routineId: routine.routineId, idempotencyKey: "rn1" }, hn.as({ kind: "person", id: MAYA }));
  assert.equal(out.runId, "run_a1b2c3");
  assert.equal(started.length, 1);
  assert.deepEqual([started[0].kind, started[0].owner, started[0].name], ["routine", DANA, "Morning digest"]);
  assert.equal(started[0].idempotencyKey, `routine-run-now:${routine.routineId}:rn1`, "runs.start declares a key, so it is in the input, not only in the call options");
  assert.equal(out.routine.lastRunAt, hn.clock.t);
  assert.equal(out.routine.nextRunAt, routine.nextRunAt, "the schedule did not move");
  assert.deepEqual(hn.named("agent.routine_run_started")[0]!.payload, { agentId: id, routineId: routine.routineId, runId: "run_a1b2c3", ownerId: DANA, requestedBy: MAYA });
  assert.deepEqual(assertEventsConform(hn), []);
});

test("delegate hands a routine to another person and undo hands it back; a second hand-over still undoes to the original", async () => {
  const { hn, id } = await setup();
  const { routine } = await save(hn, id);
  hn.clear();
  const d = await call(hn, "agents.routine.delegate", { agentId: id, routineId: routine.routineId, to: { kind: "person", id: MAYA } });
  assert.deepEqual([d.routine.ownerId, d.previousOwnerId], [MAYA, DANA]);
  assert.deepEqual(hn.named("agent.routine_delegated")[0]!.payload, { agentId: id, routineId: routine.routineId, from: DANA, to: MAYA, undo: false });
  assert.deepEqual((await call(hn, "agents.routines.list", { agentId: id })).routines, [], "Dana no longer sees it");
  // Dana cannot hand on what is no longer hers
  assert.equal(await failure(() => h["agents.routine.delegate"]!(hn.ctx, { agentId: id, routineId: routine.routineId, to: { kind: "person", id: "usr_x" } })), "validation.not_found");
  const maya = hn.as({ kind: "person", id: MAYA });
  await call(hn, "agents.routine.delegate", { agentId: id, routineId: routine.routineId, to: { kind: "person", id: "usr_zed" } }, maya);
  const back = await call(hn, "agents.routine.delegate", { agentId: id, routineId: routine.routineId, undo: true }, hn.as({ kind: "person", id: "usr_zed" }));
  assert.equal(back.routine.ownerId, DANA);
  assert.deepEqual((await call(hn, "agents.routines.list", { agentId: id })).routines.map((r: any) => r.routineId), [routine.routineId]);
  assert.equal(hn.named("agent.routine_delegated").at(-1)!.payload["undo"], true);
  assert.equal(await failure(() => h["agents.routine.delegate"]!(hn.ctx, { agentId: id, routineId: routine.routineId, undo: true })), "validation.precondition_failed", "nothing left to undo");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("delegate to an agent moves the routine onto that agent; delegating to oneself or to a missing agent is refused", async () => {
  const { hn, id } = await setup();
  const other = (await call(hn, "agents.create", { name: "Billing", role: "Use me for invoices.", idempotencyKey: `c${++n}` })).agent.agentId as string;
  const { routine } = await save(hn, id);
  assert.equal(await failure(() => h["agents.routine.delegate"]!(hn.ctx, { agentId: id, routineId: routine.routineId, to: { kind: "agent", id } })), "validation.bad_input");
  assert.equal(await failure(() => h["agents.routine.delegate"]!(hn.ctx, { agentId: id, routineId: routine.routineId, to: { kind: "agent", id: "agt_none" } })), "validation.not_found");
  const d = await call(hn, "agents.routine.delegate", { agentId: id, routineId: routine.routineId, to: { kind: "agent", id: other } });
  assert.deepEqual([d.routine.agentId, d.routine.ownerId], [other, DANA]);
  const back = await call(hn, "agents.routine.delegate", { agentId: other, routineId: routine.routineId, undo: true });
  assert.equal(back.routine.agentId, id);
});
// P-CC_20: run now and delegate are covered here; touched so the check selects this file.

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
