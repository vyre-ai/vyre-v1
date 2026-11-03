// Tasks on a booted daemon (l-tasks): the baton between people, a team task one member takes, an agent that does a Review it was given, and a due reminder at midnight in Karachi.
// Each step reads what each person would see: their Needs you, their count and their notifications, through their own token.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, call, connect, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";
import { as, join } from "./support/people.ts";
import type { Caller } from "./support/people.ts";

type Json = any;   // eslint-disable-line @typescript-eslint/no-explicit-any
type D = Awaited<ReturnType<typeof boot>>;
const ok = (r: { status: number; data: Json }, what: string): Json => { assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.data)}`); return r.data; };
const pump = async (d: D): Promise<void> => { await d.hooks?.pump?.(); await d.hooks?.pump?.(); };
const needs = async (P: Caller): Promise<Json[]> => ok(await P("tasks.needs_you", {}), "needs_you").items.filter((i: Json) => i.yourTurn === true);
const count = async (P: Caller): Promise<number> => ok(await P("tasks.count_needs_you", {}), "count").count;
const titles = async (P: Caller): Promise<string[]> => ok(await P("notifications.list", { limit: 50 }), "notifications.list").notifications.map((n: Json) => n.title);

async function people(d: D): Promise<{ O: Caller; B: Caller; C: Caller; o: string; b: string; c: string }> {
  await connect(d);
  const O = as(d, d.token!);
  // the person behind the daemon's token: whoever a task they make says made it
  const probe = ok(await O("tasks.create", { title: "Who am I", assigned: { kind: "group", id: "grp_nobody" } }), "probe").task;
  const o = probe.createdBy as string;
  ok(await O("tasks.delete", { taskId: probe.id }), "delete probe");
  const bea = await join(d, O, "Member", "bea", "Bea Baker");
  const cal = await join(d, O, "Member", "cal", "Cal Cruz");
  return { O, B: as(d, bea.token), C: as(d, cal.token), o, b: bea.id, c: cal.id };
}

test("the baton between people: given, handed in, reviewed, approved; each person's Needs you and notifications follow it", async () => {
  const dir = seededDir();
  const d = await boot(dir, null);
  try {
    const { O, B, C, o, b, c } = await people(d);
    const task = ok(await O("tasks.create", { title: "Draft the engagement letter", assigned: { kind: "person", id: b }, reviewer: { kind: "person", id: c }, approver: { kind: "person", id: o } }), "create").task;
    await pump(d);
    assert.deepEqual((await needs(B)).map((i) => i.task.id), [task.id], "Bea: work someone gave her is her turn");
    assert.equal(await count(B), 1);
    assert.equal(await count(C), 0, "Cal waits until it is handed in");
    await waitFor(async () => { await pump(d); return (await titles(B)).find((t) => /gave you a task: Draft the engagement letter/.test(t)) ?? null; });
    assert.ok((await titles(C)).some((t) => /asked you to review: Draft the engagement letter/.test(t)), "Cal hears he reviews it");

    ok(await B("tasks.submit", { taskId: task.id, summary: "Drafted it" }), "submit");
    await pump(d);
    assert.equal(await count(B), 0, "handed in, it is not Bea's any more");
    assert.deepEqual((await needs(C)).map((i) => i.task.id), [task.id], "Cal: his review");
    await waitFor(async () => { await pump(d); return (await titles(C)).find((t) => t === 'Bea Baker handed in "Draft the engagement letter" for your review') ?? null; });

    ok(await C("tasks.review", { taskId: task.id, verdict: "send_back", fixes: ["Use the client's legal name"] }), "send back");
    await pump(d);
    assert.equal(await count(B), 1, "sent back, it is Bea's again");
    await waitFor(async () => { await pump(d); return (await titles(B)).find((t) => t === `Cal Cruz sent "Draft the engagement letter" back: Use the client's legal name`) ?? null; });
    ok(await B("tasks.submit", { taskId: task.id, summary: "Fixed the name" }), "submit again");
    ok(await C("tasks.review", { taskId: task.id, verdict: "approve" }), "review");
    await pump(d);
    assert.deepEqual((await needs(O)).map((i) => i.task.id), [task.id], "the owner approves now");
    ok(await O("tasks.decide", { taskId: task.id, verdict: "approve" }), "decide");
    await pump(d);
    for (const P of [O, B, C]) assert.equal(await count(P), 0, "done: nobody's turn");
    assert.equal(ok(await B("tasks.get", { taskId: task.id }), "get").task.state, "done");
    // only someone on it may change it: Cal can no longer be the one to rename it once he is not on it
    const theirs = ok(await O("tasks.create", { title: "Owner's own", assigned: { kind: "person", id: o } }), "create").task;
    assert.equal((await C("tasks.update", { taskId: theirs.id, title: "Mine now" })).status !== 200, true, "a bystander cannot rename someone's task");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a team task: everyone on the team is offered it, one takes it, joins its thread, and the others see who has it", async () => {
  const dir = seededDir();
  const d = await boot(dir, null);
  try {
    const { O, B, C, b, c } = await people(d);
    const group = ok(await O("access.groups.create", { name: "Intake team", members: [{ kind: "person", id: b }, { kind: "person", id: c }] }), "group").group;
    const task = ok(await O("tasks.create", { title: "Call the new client back", assigned: { kind: "group", id: group.id } }), "create").task;
    await pump(d);
    assert.equal(await count(B), 1, "offered to Bea");
    assert.equal(await count(C), 1, "and to Cal");
    await waitFor(async () => { await pump(d); return (await titles(C)).find((t) => /gave you a task: Call the new client back/.test(t)) ?? null; });
    ok(await B("tasks.take", { taskId: task.id }), "take");
    await pump(d);
    assert.equal(await count(C), 0, "taken by Bea, it leaves Cal's Needs you");
    const seen = ok(await C("tasks.get", { taskId: task.id }), "get as Cal").task;
    assert.equal(seen.takenBy, b, "Cal sees Bea has it");
    const refused = await C("tasks.take", { taskId: task.id });
    assert.notEqual(refused.status, 200, "the second take is refused");
    const members = ok(await call(d, "threads.get", { threadId: seen.threadId }), "thread").thread;
    assert.ok(JSON.stringify(members).includes(b), "Bea joined the task's thread");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("an agent given a Review task does it: woken, it approves with tasks_act, and the request closes", async () => {
  const dir = seededDir();
  const d = await boot(dir, scriptedModel(async function* (input: Json, run) {
    const text = JSON.stringify(input);
    const id = /taskId (tsk_[A-Za-z0-9]+)/.exec(text)?.[1];
    if (!id || !/request of kind review/.test(text)) return;
    yield* run("tasks_act", { taskId: id, action: "approve", note: "Checked the dates; they match." });
    yield { type: "text", text: "Reviewed." };
  }));
  try {
    await connect(d);
    const checker = await makeAgent(d, "Checker", "You review drafts.");
    const req = ok(await call(d, "tasks.create", { kind: "review", title: "Check the dates in the letter", assigned: { kind: "agent", id: checker }, idempotencyKey: "live-review-1" }), "create").task;
    const done = await waitFor(async () => { await pump(d); const t = ok(await call(d, "tasks.get", { taskId: req.id }), "get").task; return t.state === "done" ? t : null; });
    assert.equal(done.state, "done", "the agent reviewed it");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a due reminder at midnight in Karachi: the day a task is due begins for Bea at 19:00 UTC the evening before", async () => {
  const dir = seededDir();
  // Tuesday 3 Nov 2026, 12:00 UTC; the task is due Wednesday 10:00 in Karachi (05:00 UTC)
  let at = Date.UTC(2026, 10, 3, 12);
  const d = await boot(dir, null, { now: () => at });
  try {
    const { O, B, b } = await people(d);
    ok(await B("settings.set", { key: "profile.timezone", value: "Asia/Karachi" }), "time zone");
    await pump(d);
    const task = ok(await O("tasks.create", { title: "File the annual return", assigned: { kind: "person", id: b }, due: Date.UTC(2026, 10, 4, 5) }), "create").task;
    await pump(d);
    at = Date.UTC(2026, 10, 3, 18, 59);
    await d.hooks!.runPeriodic("tasks.clock");
    await pump(d);
    assert.equal((await titles(B)).some((t) => /^Due today: File the annual return/.test(t)), false, "a minute before her midnight, nothing");
    at = Date.UTC(2026, 10, 3, 19, 0);
    await d.hooks!.runPeriodic("tasks.clock");
    await waitFor(async () => { await pump(d); return (await titles(B)).find((t) => t === "Due today: File the annual return") ?? null; });
    const item = (await needs(B)).find((i) => i.task.id === task.id) ?? ok(await B("tasks.needs_you", {}), "needs").items.find((i: Json) => i.task.id === task.id);
    assert.equal(item.reason, "due_today", "in Karachi it is due today");
    await d.hooks!.runPeriodic("tasks.clock");
    await pump(d);
    assert.equal((await titles(B)).filter((t) => t === "Due today: File the annual return").length, 1, "said once");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
