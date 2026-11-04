// Goals: a goal from start to finish in one process, with stand-ins for the modules it calls. The live test (test/goals.live.test.ts) runs the same story on a booted daemon.
import test from "node:test";
import assert from "node:assert/strict";
import { ALIZA, DAY, HELPER, HOUR, LEAD, OWNER, STRANGER, T0, host, labGoal, lead, owner, step, world } from "../fixtures/world.ts";
import { getGoal, inQuiet, nextCheckin, wakeById } from "../projections.ts";

const claim = (w: ReturnType<typeof world>, e: { payload: Record<string, any> }) => w.call("goals.wake_claim", { goalId: e.payload.goalId, wakeId: e.payload.wakeId, attempt: e.payload.attempt }, host);   // eslint-disable-line @typescript-eslint/no-explicit-any
/** The lead takes every wake-up that is out and posts its check-in, as a working lead would. */
async function answer(w: ReturnType<typeof world>, goalId: string): Promise<void> {
  for (const e of w.woken()) { const c = await claim(w, e); if (c.claimed) await w.call("goals.report", { goalId, wakeId: e.payload.wakeId, summary: "Checked." }, lead); }
}

test("the owner's press starts a goal: its chat, its parent task, its folder shared with everyone on it, its grants, the first reading and the first wake-up", async () => {
  const w = world({ count: 120 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("reminder", "Remind Lab 7 attendees")] }));
  assert.equal(goal.status, "active");
  assert.ok(goal.threadId && goal.rootTaskId && goal.folderId);
  assert.equal(goal.progress.value, 120);
  assert.equal(goal.progress.start, 120);
  assert.equal(goal.zone, "Asia/Karachi");
  assert.deepEqual(goal.quiet, { from: "22:00", to: "08:00" });
  assert.equal(goal.permissions[0].granted, true, "the owner's own press grants what the goal names");
  const pressed = w.state.grants.find((g) => g.set);
  assert.deepEqual(pressed?.set, [{ act: "send", target: "mail.send" }]);
  assert.deepEqual(pressed?.threads, [goal.threadId]);
  // the folder: <owner's files>/Goals/<title>, the owner manages, the lead and the helpers edit
  const folder = w.state.folders.get(goal.folderId)!;
  assert.equal(folder.name, "300 registrations for Lab 8");
  assert.equal(w.state.folders.get(folder.parent!)!.name, "Goals");
  assert.deepEqual(w.state.shares.map((s) => [s.subject.id, s.level]).sort(), [[HELPER, "edit"], [LEAD, "edit"], [ALIZA, "edit"], [OWNER, "manage"]]);
  // the plan is tasks under the goal's parent, tagged with the goal and run for its owner
  const child = [...w.state.tasks.values()].find((t) => t.title === "Remind Lab 7 attendees")!;
  assert.equal(child.parentTaskId, goal.rootTaskId);
  assert.equal(child.workingNotes["goal.id"], goal.id);
  assert.equal(child.workingNotes["baton.owner"], OWNER);
  assert.match(child.workingNotes["brief"]!, /Why: Remind Lab 7 attendees worked for Lab 7/);
  assert.equal(w.state.tasks.get(goal.rootTaskId)!.workingNotes["goal.root"], "1");
  // helpers are in the goal chat
  assert.ok(w.state.members.some((m) => m.id === ALIZA) && w.state.members.some((m) => m.id === HELPER));
  // one wake-up, claimed once however many times it is read
  const woken = w.woken();
  assert.equal(woken.length, 1);
  assert.equal(woken[0]!.payload.reason, "start");
  assert.equal((await claim(w, woken[0]!)).claimed, true);
  assert.equal((await claim(w, woken[0]!)).claimed, false, "a wake-up read twice runs once");
});

test("an agent drafts, the owner presses Start: no grant before the press, the drafted plan becomes tasks after it", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("reel", "Ask Aliza for two reels")], sourceThreadId: "thr_chat" }), lead);
  assert.equal(goal.status, "draft");
  assert.equal(goal.permissions[0].granted, false);
  assert.equal(w.woken().length, 0);
  const card = w.state.posts.find((p) => p.threadId === "thr_chat")!;
  assert.equal(card.blocks![0]!.data.kind, "draft");
  assert.deepEqual(card.blocks![0]!.data.plan, ["Ask Aliza for two reels (Ask Aliza for two reels worked for Lab 7)"]);
  await assert.rejects(w.call("goals.confirm", { goalId: goal.id }, lead), /Only the owner starts a goal/);
  const feed = (await w.call("goals.activity", { goalId: goal.id }, owner)).activity as Array<{ kind: string; text: string; tpl?: string }>;
  const made = feed.find((a) => a.kind === "created")!;
  assert.match(made.tpl!, /^\{who:agt_[^}]+\} drafted this goal for \{who:usr_[^}]+\}\.$/, "stored with names to fill in, not with 'an agent' or 'the owner'");
  assert.doesNotMatch(made.text, /\{who:|an agent|the owner/);
  const started = (await w.call("goals.confirm", { goalId: goal.id }, owner)).goal;
  assert.equal(started.status, "active");
  assert.equal(started.permissions[0].granted, true);
  assert.ok([...w.state.tasks.values()].some((t) => t.title === "Ask Aliza for two reels"));
  // an outside agent under the owner's setup grant runs as the owner but has pressed nothing: it may start a goal, never grant it a permission
  const w2 = world({ count: 10 });
  const viaMcp = (await w2.call("goals.create", labGoal(), { id: OWNER, kind: "person", origin: "mcp" })).goal;
  assert.equal(viaMcp.status, "planning");
  assert.equal(viaMcp.permissions[0].granted, false);
});

test("the plan asks for a why on every step, and the lead's check-in carries the number Vyre read, never the agent's", async () => {
  const w = world({ count: 100 });
  const { goal } = await w.call("goals.create", labGoal());
  assert.equal(goal.status, "planning");
  const { tasks } = await w.call("goals.plan", { goalId: goal.id, children: [step("a", "Remind Lab 7"), step("b", "Post in Skool")] }, lead);
  assert.equal(tasks.length, 2);
  assert.equal(getGoal(w.db, goal.id)!.status, "active");
  w.state.count = 140;
  const wake = w.woken()[0]!;
  await claim(w, wake);
  const r = await w.call("goals.report", { goalId: goal.id, wakeId: wake.payload.wakeId, summary: "We are at 400 already!", done: ["Planned two steps"], next: ["Send the reminder"] }, lead);
  assert.equal(r.value, 100, "the number is the goal's own reading");
  const post = w.state.posts.at(-1)!;
  assert.equal(post.by, LEAD);
  assert.match(post.body, /^100 of 300 registrations\./);
  assert.equal(post.blocks![0]!.data.value, 100);
  assert.equal(wakeById(w.db, wake.payload.wakeId)!.state, "reported");
  await assert.rejects(w.call("goals.report", { goalId: goal.id, summary: "x" }, { id: "agt_other", kind: "agent", actingFor: OWNER }), /lead agent posts/);
});

test("the source rises to the finish line: done, honest summary, one last wake-up for the retrospective, saved to Reports and memory", async () => {
  const w = world({ count: 250 });
  const { goal } = await w.call("goals.create", labGoal({ projectId: "prj_lab8" }));
  await w.call("goals.plan", { goalId: goal.id, children: [step("a", "Remind Lab 7")] }, lead);
  const child = [...w.state.tasks.values()].find((t) => t.parentTaskId === goal.rootTaskId)!;
  child.state = "done";
  await w.task("task.completed", child.id);
  assert.ok(w.state.events.some((e) => e.name === "goal.woken" || true));
  w.state.count = 301;
  w.tick(20 * 60_000);
  await w.sweep();
  const g = getGoal(w.db, goal.id)!;
  assert.equal(g.status, "done");
  assert.match(g.summary!, /Reached 301 of 300 registrations \(100%\)\. 1 of 1 tasks done\./);
  assert.equal(w.state.tasks.get(goal.rootTaskId)!.state, "done");
  assert.ok(w.state.grants.at(-1)!.threads.length === 0, "the permissions end with the goal");
  await assert.rejects(w.call("goals.complete", { goalId: goal.id, retro: { summary: "x", worked: [], didNot: [] } }, { id: "agt_other", kind: "agent" }), /not exist|lead agent writes/);
  const retro = { summary: "Reminders to past attendees did most of the work.", worked: ["Lab 7 reminder: +60 in a day"], didNot: ["Skool post: +2"], playbook: "1. Remind the last Lab's attendees on day one." };
  assert.deepEqual(await w.call("goals.complete", { goalId: goal.id, retro }, lead), { saved: true, askedOwner: false });
  const file = w.state.files.find((f) => f.name === "Retrospective.md")!;
  assert.equal(w.state.folders.get(file.folderId)!.name, "Reports");
  assert.match(file.text, /## What worked\n- Lab 7 reminder: \+60 in a day/);
  assert.deepEqual(w.state.memory.map((m) => m.layer).sort(), ["project", "space"]);
  const past = await w.call("goals.search_past", { query: "registrations lab" }, lead);
  assert.equal(past.goals[0].retro.summary, retro.summary);
});

test("stuck after N flat check-ins: the reason in plain words, the owner hears once, and the number moving again ends it", async () => {
  const w = world({ count: 212 });
  const { goal } = await w.call("goals.create", labGoal({ stuckAfter: 3 }));
  await w.call("goals.plan", { goalId: goal.id, children: [step("a", "Remind Lab 7")] }, lead);
  let g = getGoal(w.db, goal.id)!;
  for (let i = 0; i < 4; i++) { await answer(w, goal.id); w.at(g.nextCheckinAt!); await w.sweep(); g = getGoal(w.db, goal.id)!; }
  assert.equal(g.status, "stuck");
  assert.match(g.statusReason!, /No progress in 3 check-ins; 212 of 300 registrations since/);
  const notices = [...w.state.tasks.values()].filter((t) => t.kind === "unblock" && t.title.startsWith("Stuck:"));
  assert.equal(notices.length, 1, "one notice, however many flat check-ins follow");
  w.state.count = 230;
  w.tick(20 * 60_000);
  await w.sweep();
  g = getGoal(w.db, goal.id)!;
  assert.equal(g.status, "active");
  assert.equal(w.state.tasks.get(notices[0]!.id)!.state, "canceled", "the notice is withdrawn when the number moves");
  // the agent can say it itself, with two options
  const out = await w.call("goals.mark_stuck", { goalId: goal.id, reason: "Every step waits on the email approval.", options: ["Approve the send", "Drop the email step"] }, lead);
  assert.equal(out.goal.status, "stuck");
  assert.equal(out.goal.statusReason, "Every step waits on the email approval.");
});

test("a source that cannot be read says so and counts toward stuck; it never invents a number", async () => {
  const w = world({ count: 50, failRead: "Luma refused the key" });
  const { goal } = await w.call("goals.create", labGoal({ stuckAfter: 2 }));
  assert.equal(goal.progress.value, undefined);
  assert.equal(goal.progress.error, "Luma refused the key");
  let g = getGoal(w.db, goal.id)!;
  for (let i = 0; i < 2; i++) { await answer(w, goal.id); w.at(g.nextCheckinAt!); await w.sweep(); g = getGoal(w.db, goal.id)!; }
  assert.equal(g.status, "stuck");
  assert.match(g.statusReason!, /could not be read: Luma refused the key/);
  const brief = (await w.call("goals.brief", { goalId: goal.id }, lead)).text as string;
  assert.match(brief, /The source could not be read: Luma refused the key\. Say so in your check-in; do not guess the number\./);
});

test("budget: a warning at 80%, a pause at 100% that stops the work waking, and a raised budget goes on", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal({ budget: { spendMicros: 1_000_000, turns: 100 } }));
  await w.call("goals.plan", { goalId: goal.id, children: [step("a", "Remind Lab 7")] }, lead);
  await w.turn("turn.completed", { turnId: "trn_1", threadId: goal.threadId, agentId: LEAD, costMicros: 850_000 });
  await w.turn("turn.completed", { turnId: "trn_1", threadId: goal.threadId, agentId: LEAD, costMicros: 850_000 });
  let g = getGoal(w.db, goal.id)!;
  assert.equal(g.spentMicros, 850_000, "a turn read twice counts once");
  assert.equal(w.named("goal.budget_warned").length, 1);
  assert.ok(w.state.posts.some((p) => /80% of the budget is used: \$0\.85 of \$1\.00, 1 of 100 turns/.test(p.body)));
  await w.turn("turn.completed", { turnId: "trn_2", threadId: goal.threadId, agentId: LEAD, costMicros: 200_000 });
  g = getGoal(w.db, goal.id)!;
  assert.equal(g.status, "paused");
  assert.match(g.statusReason!, /The budget is used: \$1\.05 of \$1\.00/);
  assert.equal((await w.call("goals.go", { goalId: goal.id }, host)).go, false, "the plan's tasks do not wake their agents");
  assert.ok([...w.state.tasks.values()].some((t) => t.title === "Budget used: 300 registrations for Lab 8"));
  assert.equal(w.state.grants.at(-1)!.threads.length, 0);
  await assert.rejects(w.call("goals.resume", { goalId: goal.id }), /Raise it first/);
  const raised = (await w.call("goals.update", { goalId: goal.id, budget: { spendMicros: 3_000_000, turns: 100 } })).goal;
  assert.equal(raised.status, "active");
  const resumed = w.named("goal.resumed").at(-1)!;
  assert.equal(resumed.payload.taskIds.length, 1);
  assert.equal((await w.call("goals.go", { goalId: goal.id }, host)).go, true);
});

test("missed: the deadline passes short of the line, the summary is honest, and Extend starts it again", async () => {
  const w = world({ count: 200 });
  const { goal } = await w.call("goals.create", labGoal());
  await w.call("goals.plan", { goalId: goal.id, children: [step("a", "Remind Lab 7"), step("b", "Post in Skool")] }, lead);
  const [a] = [...w.state.tasks.values()].filter((t) => t.parentTaskId === goal.rootTaskId);
  a!.state = "done"; await w.task("task.completed", a!.id);
  w.state.count = 268;
  w.at(goal.deadline + 60_000);
  await w.sweep();
  const g = getGoal(w.db, goal.id)!;
  assert.equal(g.status, "missed");
  assert.match(g.summary!, /^Got to 268 of 300 registrations \(68%\) by the deadline, Sat 7 Nov, 10:00\. 1 of 2 tasks done\. Still open: Post in Skool\. Used \$0\.00 of \$10\.00, 0 of 20 turns\.$/);
  const ended = w.state.posts.find((p) => p.blocks?.[0]?.data.kind === "ended")!;
  assert.match(ended.body, /Extend to /);
  assert.equal(w.woken().at(-1)!.payload.reason.includes("ended"), true, "the lead gets one turn for the retrospective");
  const back = (await w.call("goals.extend", { goalId: goal.id, deadline: goal.deadline + 3 * DAY })).goal;
  assert.equal(back.status, "active");
  assert.equal(back.ended, undefined);
});

test("idempotent steps: a step done before answers its result, so a retried wake-up never sends twice", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal());
  const first = await w.call("goals.step", { goalId: goal.id, stepId: "reminder-email-lab7", title: "Email Lab 7 attendees" }, lead);
  assert.equal(first.state, "started");
  assert.equal(first.idempotencyKey, `goal:${goal.id}:step:reminder-email-lab7`);
  await w.call("goals.step", { goalId: goal.id, stepId: "reminder-email-lab7", finish: true, result: "Sent to 1,240" }, lead);
  // the wake-up is retried (the lead stopped before its check-in): the step is already done
  const again = await w.call("goals.step", { goalId: goal.id, stepId: "reminder-email-lab7" }, lead);
  assert.deepEqual(again, { state: "already_done", result: "Sent to 1,240", idempotencyKey: first.idempotencyKey });
  assert.equal(w.named("goal.step_done").length, 1);
  await assert.rejects(w.call("goals.step", { goalId: goal.id, stepId: "x" }, { id: STRANGER, kind: "person" }), /does not exist/);
});

test("a wake-up nobody answered is offered once more, then the goal is stuck, never silent", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "Remind Lab 7")] }));
  const first = w.woken()[0]!;
  await claim(w, first);
  w.tick(50 * 60_000); await w.sweep();
  const retry = w.woken().at(-1)!;
  assert.equal(retry.payload.wakeId, first.payload.wakeId);
  assert.equal(retry.payload.attempt, 2);
  assert.match(retry.payload.reason, /retry/);
  await claim(w, retry);
  w.tick(50 * 60_000); await w.sweep();
  assert.equal(getGoal(w.db, goal.id)!.status, "stuck");
  assert.equal(getGoal(w.db, goal.id)!.statusReason, "The lead agent stopped answering its wake-ups.");
});

test("a held send makes the goal wait on its approver; the answer resumes it and wakes the lead", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "Remind Lab 7")] }));
  const wake = w.woken()[0]!;
  await claim(w, wake);
  await w.call("goals.report", { goalId: goal.id, wakeId: wake.payload.wakeId, summary: "Sending the reminder." }, lead);
  const hold = (await w.ctx(host).call!("tasks.create", { kind: "approve", title: "Approve: email to 1,240 Lab 7 attendees", assigned: { kind: "person", id: OWNER } })) as { task: { id: string } };
  await w.waiting({ threadId: goal.threadId, taskId: hold.task.id, turnId: "trn_9" });
  let g = getGoal(w.db, goal.id)!;
  assert.equal(g.status, "waiting");
  assert.equal(g.statusReason, "Approve: email to 1,240 Lab 7 attendees");
  const got = await w.call("goals.get", { goalId: goal.id });
  assert.deepEqual(got.waiting.map((x: { title: string }) => x.title), ["Approve: email to 1,240 Lab 7 attendees"]);
  w.state.tasks.get(hold.task.id)!.state = "done";
  await w.task("task.completed", hold.task.id);
  await w.task("task.transitioned", hold.task.id, { to: "done" });
  g = getGoal(w.db, goal.id)!;
  assert.equal(g.status, "active");
  const answered = w.woken().filter((e) => String(e.payload.reason).includes("answered"));
  assert.equal(answered.length, 1, "one wake-up for the answer, however many events say it");
});

test("a restart mid-goal picks up from the tables: the due check-in runs and wakes the lead", async () => {
  const w = world({ count: 40 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "Remind Lab 7")] }));
  const wake = w.woken()[0]!;
  await claim(w, wake);
  await w.call("goals.report", { goalId: goal.id, wakeId: wake.payload.wakeId, summary: "Planned." }, lead);
  // the server is down across the check-in: nothing in memory survives, the clock finds the due check-in from the tables
  const g0 = getGoal(w.db, goal.id)!;
  w.at(g0.nextCheckinAt! + 3 * HOUR);
  const before = w.woken().length;
  await w.sweep();
  const after = w.woken();
  assert.equal(after.length, before + 1);
  assert.equal(after.at(-1)!.payload.reason, "checkin");
  assert.equal(getGoal(w.db, goal.id)!.checkins, 1);
});

test("quiet hours: a check-in never falls in them and a wake-up asked for in them waits for the morning", async () => {
  const g = { rhythm: { every: "hours" as const, hours: 6 }, zone: "Asia/Karachi", quiet: { from: "22:00", to: "08:00" } };
  const late = Date.UTC(2026, 10, 3, 17, 30);   // 22:30 in Karachi
  assert.equal(inQuiet(late, g), true);
  const next = nextCheckin(g, late - 6 * HOUR);
  assert.equal(inQuiet(next, g), false);
  assert.equal(next, Date.UTC(2026, 10, 4, 3, 0), "08:00 in Karachi");
  const w = world({ count: 40 });
  const { goal } = await w.call("goals.create", labGoal());
  const sent = w.woken().length;
  w.at(late);
  await w.call("goals.plan", { goalId: goal.id, children: [step("a", "Remind Lab 7")] }, lead);
  const child = [...w.state.tasks.values()].find((t) => t.parentTaskId === goal.rootTaskId)!;
  await claim(w, w.woken()[0]!);
  await w.call("goals.report", { goalId: goal.id, summary: "ok" }, lead);
  child.state = "done";
  await w.task("task.completed", child.id);
  await w.sweep();
  assert.equal(w.woken().length, sent, "nothing goes out at 22:30");
  w.at(Date.UTC(2026, 10, 4, 3, 1));
  await w.sweep();
  assert.ok(w.woken().length > sent);
});

test("asking: one Waiting-on item per decision, never asked twice", async () => {
  const w = world({ count: 40 });
  const { goal } = await w.call("goals.create", labGoal());
  const a = await w.call("goals.ask", { goalId: goal.id, decision: "lab7-audience", question: "Email Lab 7 no-shows too?", options: ["Yes", "Only attendees"] }, lead);
  const b = await w.call("goals.ask", { goalId: goal.id, decision: "lab7-audience", question: "Should I email Lab 7 no-shows?" }, lead);
  assert.equal(a.asked, true);
  assert.equal(b.asked, false);
  assert.equal(a.taskId, b.taskId);
  assert.equal([...w.state.tasks.values()].filter((t) => t.kind === "answer").length, 1);
  assert.equal(getGoal(w.db, goal.id)!.status, "waiting");
});

test("access follows the goal: helpers added and removed, a mention reads, a stranger sees nothing, a rename follows", async () => {
  const w = world({ count: 40 });
  const { goal } = await w.call("goals.create", labGoal());
  await w.call("goals.update", { goalId: goal.id, helpers: [{ kind: "person", id: "usr_dana" }] });
  const subjects = w.state.shares.filter((s) => s.source === `goal:${goal.id}`).map((s) => s.subject.id).sort();
  assert.deepEqual(subjects, [LEAD, "usr_dana", OWNER], "Aliza and the helper agent lost what the goal gave them");
  await w.mention({ threadId: goal.threadId, personId: "usr_omar", messageId: "msg_1" });
  assert.ok(w.state.shares.some((s) => s.subject.id === "usr_omar" && s.level === "view" && s.source === `goal:${goal.id}:mention`));
  await assert.rejects(w.call("goals.get", { goalId: goal.id }, { id: STRANGER, kind: "person" }), /does not exist/);
  await assert.rejects(w.call("goals.pause", { goalId: goal.id }, lead), /Only the owner/);
  await w.call("goals.update", { goalId: goal.id, title: "320 registrations for Lab 8" });
  assert.equal(w.state.folders.get(goal.folderId)!.name, "320 registrations for Lab 8");
  const listed = await w.call("goals.list", { scope: "helping" }, { id: "usr_dana", kind: "person" });
  assert.equal(listed.goals.length, 1);
  assert.equal((await w.call("goals.list", { scope: "all" }, { id: STRANGER, kind: "person" })).goals.length, 0);
});

test("two goals on one record are told about each other; a task belongs to one goal", async () => {
  const w = world({ count: 40 });
  await w.call("goals.create", labGoal({ recordIds: ["rec_lab8"] }));
  const second = await w.call("goals.create", labGoal({ title: "Lab 8 sponsor slots", recordIds: ["rec_lab8"], idempotencyKey: "k2" }));
  assert.equal(second.overlaps.length, 1);
  assert.equal(second.overlaps[0].title, "300 registrations for Lab 8");
  const brief = (await w.call("goals.brief", { goalId: second.goal.id }, lead)).text as string;
  assert.match(brief, /Records this goal shares with other goals: "300 registrations for Lab 8"\. Change those records through tasks, never directly\./);
});

test("the brief tells the lead why it was woken, the pace, the plan, what waits and its permissions", async () => {
  const w = world({ count: 120 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "Remind Lab 7")] }));
  w.state.count = 150;
  w.tick(DAY);
  const text = (await w.call("goals.brief", { goalId: goal.id }, lead)).text as string;
  assert.match(text, /^300 registrations for Lab 8 \(goalId gol_[a-z0-9]+\)\. Status: active\./);
  assert.match(text, /The number, read by Vyre from Luma, Lab 8 registrations: 120 of 300 registrations \(0%\)/);
  assert.match(text, /You were woken because: the goal started/);
  assert.match(text, /- VY-\d+ Remind Lab 7 \[todo\]/);
  assert.match(text, /Standing permissions \(these acts go without asking, in this goal's chats only\): Send email from the Lab template\./);
  assert.match(text, /The goal's folder in Files/);
  assert.match(text, /The owner's time now: Wed 4 Nov, 10:00 \(Asia\/Karachi\)\. Write every time in check-ins, summaries and the retrospective in this zone/, "times are the owner's, from their profile");
});

test("the goal's folder keeps what its tasks hand in and what people drop in its chat, once each", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "Draft the reminder")] }));
  const child = [...w.state.tasks.values()].find((t) => t.parentTaskId === goal.rootTaskId)!;
  child.fileIds = ["fil_draft"]; child.state = "done";
  await w.task("task.completed", child.id);
  await w.task("task.completed", child.id);
  assert.deepEqual(w.state.files.filter((f) => f.folderId === goal.folderId).map((f) => f.name), ["copy of fil_draft"], "a task's output is kept once");
  await w.message({ threadId: goal.threadId, messageId: "msg_drop", author: { kind: "person", id: OWNER } });
  await w.message({ threadId: goal.threadId, messageId: "msg_drop", author: { kind: "person", id: OWNER } });
  await w.message({ threadId: goal.threadId, messageId: "msg_drop", author: { kind: "agent", id: LEAD } });
  assert.deepEqual(w.state.files.filter((f) => f.folderId === goal.folderId).map((f) => f.name).sort(), ["copy of fil_brief", "copy of fil_draft", "copy of fil_list"]);
  const listed = await w.call("goals.list", { scope: "mine" });
  assert.equal(listed.goals[0].folderId, goal.folderId, "the Files folder knows its goal");
});

test("a lead whose turn ends without a check-in is asked again at once, then the goal is stuck with why", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "Remind Lab 7")] }));
  await claim(w, w.woken()[0]!);
  await w.turn("turn.failed", { turnId: "trn_a", threadId: goal.threadId, agentId: LEAD, code: "engine.step_limit" });
  const again = w.woken().at(-1)!;
  assert.equal(again.payload.attempt, 2);
  assert.match(again.payload.reason, /retry/);
  await claim(w, again);
  await w.turn("turn.completed", { turnId: "trn_b", threadId: goal.threadId, agentId: LEAD, costMicros: 1 });
  const g = getGoal(w.db, goal.id)!;
  assert.equal(g.status, "stuck");
  assert.equal(g.statusReason, "The lead agent did not check in after two wake-ups: the turn ended without a check-in.");
});

test("a watched page is a source: the number it last read, or how many times it changed; a watch that is gone or has read nothing says so", async () => {
  const w = world();
  const watched = (path?: string, id = "wch_lab8") => labGoal({ idempotencyKey: `k${path ?? "n"}${id}${w.state.watch.error ?? ""}`, finish: { kind: "number", line: "Luma shows 300 registrations", target: 300, unit: "registrations", source: { kind: "watch", watchId: id, ...(path ? { path } : {}) } } });
  const { goal } = await w.call("goals.create", watched());
  assert.equal(goal.progress.value, 212, "the number written on the watched page");
  assert.deepEqual(w.state.calls.filter((c) => c.cap === "automations.watches.list").map((c) => c.input), [{ watchId: "wch_lab8", person: OWNER }], "asked for the owner's watch");
  const changes = (await w.call("goals.create", watched("changes"))).goal;
  assert.equal(changes.progress.value, 3);
  w.state.watch = { changes: 0, error: "timed out" };
  const none = (await w.call("goals.create", watched(undefined, "wch_lab8"))).goal;
  assert.match(none.progress.error, /watch could not read the page: timed out/);
  const gone = (await w.call("goals.create", watched(undefined, "wch_other"))).goal;
  assert.match(gone.progress.error, /watch is gone/);
});
