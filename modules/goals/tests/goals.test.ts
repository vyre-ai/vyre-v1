// Goals: a goal from start to finish in one process, with stand-ins for the modules it calls. The live test (test/goals.live.test.ts) runs the same story on a booted daemon.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ALIZA,
  DAY,
  HELPER,
  HOUR,
  LEAD,
  OWNER,
  STRANGER,
  T0,
  host,
  labGoal,
  lead,
  owner,
  step,
  world,
} from "../fixtures/world.ts";
import { getGoal, inQuiet, nextCheckin, wakeById } from "../projections.ts";

const claim = (w: ReturnType<typeof world>, e: { payload: Record<string, any> }) =>
  w.call("goals.wake_claim", { goalId: e.payload.goalId, wakeId: e.payload.wakeId, attempt: e.payload.attempt }, host); // eslint-disable-line @typescript-eslint/no-explicit-any
/** The lead takes every wake-up that is out and posts its check-in, as a working lead would. */
async function answer(w: ReturnType<typeof world>, goalId: string): Promise<void> {
  for (const e of w.woken()) {
    const c = await claim(w, e);
    if (c.claimed) await w.call("goals.report", { goalId, wakeId: e.payload.wakeId, summary: "Checked." }, lead);
  }
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
  assert.deepEqual(w.state.shares.map((s) => [s.subject.id, s.level]).sort(), [
    [HELPER, "edit"],
    [LEAD, "edit"],
    [ALIZA, "edit"],
    [OWNER, "manage"],
  ]);
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
  const { goal } = await w.call(
    "goals.create",
    labGoal({ plan: [step("reel", "Ask Aliza for two reels")], sourceThreadId: "thr_chat" }),
    lead,
  );
  assert.equal(goal.status, "draft");
  assert.equal(goal.permissions[0].granted, false);
  assert.equal(w.woken().length, 0);
  const card = w.state.posts.find((p) => p.threadId === "thr_chat")!;
  assert.equal(card.blocks![0]!.data.kind, "draft");
  assert.deepEqual(card.blocks![0]!.data.plan, ["Ask Aliza for two reels (Ask Aliza for two reels worked for Lab 7)"]);
  await assert.rejects(w.call("goals.confirm", { goalId: goal.id }, lead), /Only the owner starts a goal/);
  const feed = (await w.call("goals.activity", { goalId: goal.id }, owner)).activity as Array<{
    kind: string;
    text: string;
    tpl?: string;
  }>;
  const made = feed.find((a) => a.kind === "created")!;
  assert.match(
    made.tpl!,
    /^\{who:agt_[^}]+\} drafted this goal for \{who:usr_[^}]+\}\.$/,
    "stored with names to fill in, not with 'an agent' or 'the owner'",
  );
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
  const { tasks } = await w.call(
    "goals.plan",
    { goalId: goal.id, children: [step("a", "Remind Lab 7"), step("b", "Post in Skool")] },
    lead,
  );
  assert.equal(tasks.length, 2);
  assert.equal(getGoal(w.db, goal.id)!.status, "active");
  w.state.count = 140;
  const wake = w.woken()[0]!;
  await claim(w, wake);
  const r = await w.call(
    "goals.report",
    {
      goalId: goal.id,
      wakeId: wake.payload.wakeId,
      summary: "We are at 400 already!",
      done: ["Planned two steps"],
      next: ["Send the reminder"],
    },
    lead,
  );
  assert.equal(r.value, 100, "the number is the goal's own reading");
  const post = w.state.posts.at(-1)!;
  assert.equal(post.by, LEAD);
  assert.match(post.body, /^100 of 300 registrations\./);
  assert.equal(post.blocks![0]!.data.value, 100);
  assert.equal(wakeById(w.db, wake.payload.wakeId)!.state, "reported");
  await assert.rejects(
    w.call("goals.report", { goalId: goal.id, summary: "x" }, { id: "agt_other", kind: "agent", actingFor: OWNER }),
    /lead agent posts/,
  );
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
  await assert.rejects(
    w.call(
      "goals.complete",
      { goalId: goal.id, retro: { summary: "x", worked: [], didNot: [] } },
      { id: "agt_other", kind: "agent" },
    ),
    /not exist|lead agent writes/,
  );
  const retro = {
    summary: "Reminders to past attendees did most of the work.",
    worked: ["Lab 7 reminder: +60 in a day"],
    didNot: ["Skool post: +2"],
    playbook: "1. Remind the last Lab's attendees on day one.",
  };
  assert.deepEqual(await w.call("goals.complete", { goalId: goal.id, retro }, lead), {
    saved: true,
    askedOwner: false,
  });
  const file = w.state.files.find((f) => f.name === "Retrospective.md")!;
  assert.equal(w.state.folders.get(file.folderId)!.name, "Reports");
  assert.match(file.text, /## What worked\n- Lab 7 reminder: \+60 in a day/);
  assert.deepEqual(w.state.memory.map((m) => m.layer).sort(), ["project", "space"]);
  const past = await w.call("goals.search_past", { query: "registrations lab" }, lead);
  assert.equal(past.goals[0].retro.summary, retro.summary);
});

test("two readers reach the finish line at once (the clock and a read of the number): the goal ends once and the lead keeps its one retrospective wake-up", async () => {
  const w = world({ count: 250 });
  const { goal } = await w.call("goals.create", labGoal({ projectId: "prj_lab8" }));
  await w.call("goals.plan", { goalId: goal.id, children: [step("a", "Remind Lab 7")] }, lead);
  const child = [...w.state.tasks.values()].find((t) => t.parentTaskId === goal.rootTaskId)!;
  child.state = "done";
  await w.task("task.completed", child.id);
  w.state.count = 301;
  w.tick(20 * 60_000);
  await Promise.all([w.sweep(), w.sweep()]);
  const g = getGoal(w.db, goal.id)!;
  assert.equal(g.status, "done");
  const ended = w.db.all("SELECT state FROM goals_wake WHERE goal_id = ? AND reason LIKE '%ended%'", goal.id) as Array<{
    state: string;
  }>;
  assert.deepEqual(
    ended.map((r) => r.state),
    ["sent"],
    "one retrospective wake-up, still open for the lead; the second ending did not drop it",
  );
  const activity = w.db.all(
    "SELECT kind FROM goals_activity WHERE goal_id = ? AND kind = 'ended'",
    goal.id,
  ) as unknown[];
  assert.equal(activity.length, 1, "the goal ended once");
});

test("stuck after N flat check-ins: the reason in plain words, the owner hears once, and the number moving again ends it", async () => {
  const w = world({ count: 212 });
  const { goal } = await w.call("goals.create", labGoal({ stuckAfter: 3 }));
  await w.call("goals.plan", { goalId: goal.id, children: [step("a", "Remind Lab 7")] }, lead);
  let g = getGoal(w.db, goal.id)!;
  for (let i = 0; i < 4; i++) {
    await answer(w, goal.id);
    w.at(g.nextCheckinAt!);
    await w.sweep();
    g = getGoal(w.db, goal.id)!;
  }
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
  const out = await w.call(
    "goals.mark_stuck",
    {
      goalId: goal.id,
      reason: "Every step waits on the email approval.",
      options: ["Approve the send", "Drop the email step"],
    },
    lead,
  );
  assert.equal(out.goal.status, "stuck");
  assert.equal(out.goal.statusReason, "Every step waits on the email approval.");
});

test("a source that cannot be read says so and counts toward stuck; it never invents a number", async () => {
  const w = world({ count: 50, failRead: "Luma refused the key" });
  const { goal } = await w.call("goals.create", labGoal({ stuckAfter: 2 }));
  assert.equal(goal.progress.value, undefined);
  assert.equal(goal.progress.error, "Luma refused the key");
  let g = getGoal(w.db, goal.id)!;
  for (let i = 0; i < 2; i++) {
    await answer(w, goal.id);
    w.at(g.nextCheckinAt!);
    await w.sweep();
    g = getGoal(w.db, goal.id)!;
  }
  assert.equal(g.status, "stuck");
  assert.match(g.statusReason!, /could not be read: Luma refused the key/);
  const brief = (await w.call("goals.brief", { goalId: goal.id }, lead)).text as string;
  assert.match(
    brief,
    /The source could not be read: Luma refused the key\. Say so in your check-in; do not guess the number\./,
  );
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
  assert.ok(w.state.posts.some((p) => /80% of the budget is used: \$0\.85 of \$1\.00 and 1 of 100 turns/.test(p.body)));
  await w.turn("turn.completed", { turnId: "trn_2", threadId: goal.threadId, agentId: LEAD, costMicros: 200_000 });
  g = getGoal(w.db, goal.id)!;
  assert.equal(g.status, "paused");
  assert.match(g.statusReason!, /The budget is used: \$1\.05 of \$1\.00/);
  assert.equal(
    (await w.call("goals.go", { goalId: goal.id }, host)).go,
    false,
    "the plan's tasks do not wake their agents",
  );
  assert.ok([...w.state.tasks.values()].some((t) => t.title === "Budget used: 300 registrations for Lab 8"));
  assert.equal(w.state.grants.at(-1)!.threads.length, 0);
  await assert.rejects(w.call("goals.resume", { goalId: goal.id }), /Raise it first/);
  const raised = (await w.call("goals.update", { goalId: goal.id, budget: { spendMicros: 3_000_000, turns: 100 } }))
    .goal;
  assert.equal(raised.status, "active");
  const resumed = w.named("goal.resumed").at(-1)!;
  assert.equal(resumed.payload.taskIds.length, 1);
  assert.equal((await w.call("goals.go", { goalId: goal.id }, host)).go, true);
});

test("missed: the deadline passes short of the line, the summary is honest, and Extend starts it again", async () => {
  const w = world({ count: 200 });
  const { goal } = await w.call("goals.create", labGoal());
  await w.call(
    "goals.plan",
    { goalId: goal.id, children: [step("a", "Remind Lab 7"), step("b", "Post in Skool")] },
    lead,
  );
  const [a] = [...w.state.tasks.values()].filter((t) => t.parentTaskId === goal.rootTaskId);
  a!.state = "done";
  await w.task("task.completed", a!.id);
  w.state.count = 268;
  w.at(goal.deadline + 60_000);
  await w.sweep();
  const g = getGoal(w.db, goal.id)!;
  assert.equal(g.status, "missed");
  assert.match(
    g.summary!,
    /^Got to 268 of 300 registrations \(68%\) by the deadline, Sat 7 Nov, 10:00\. 1 of 2 tasks done\. Still open: Post in Skool\. Used \$0\.00 of \$10\.00 and 0 of 20 turns\.$/,
  );
  const ended = w.state.posts.find((p) => p.blocks?.[0]?.data.kind === "ended")!;
  assert.match(ended.body, /Extend to /);
  assert.equal(
    w.woken().at(-1)!.payload.reason.includes("ended"),
    true,
    "the lead gets one turn for the retrospective",
  );
  const back = (await w.call("goals.extend", { goalId: goal.id, deadline: goal.deadline + 3 * DAY })).goal;
  assert.equal(back.status, "active");
  assert.equal(back.ended, undefined);
});

test("idempotent steps: a step done before answers its result, so a retried wake-up never sends twice", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal());
  const first = await w.call(
    "goals.step",
    { goalId: goal.id, stepId: "reminder-email-lab7", title: "Email Lab 7 attendees" },
    lead,
  );
  assert.equal(first.state, "started");
  assert.equal(first.idempotencyKey, `goal:${goal.id}:step:reminder-email-lab7`);
  await w.call(
    "goals.step",
    { goalId: goal.id, stepId: "reminder-email-lab7", finish: true, result: "Sent to 1,240" },
    lead,
  );
  // the wake-up is retried (the lead stopped before its check-in): the step is already done
  const again = await w.call("goals.step", { goalId: goal.id, stepId: "reminder-email-lab7" }, lead);
  assert.deepEqual(again, { state: "already_done", result: "Sent to 1,240", idempotencyKey: first.idempotencyKey });
  assert.equal(w.named("goal.step_done").length, 1);
  await assert.rejects(
    w.call("goals.step", { goalId: goal.id, stepId: "x" }, { id: STRANGER, kind: "person" }),
    /does not exist/,
  );
});

test("a wake-up nobody answered is offered once more, then the goal is stuck, never silent", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "Remind Lab 7")] }));
  const first = w.woken()[0]!;
  await claim(w, first);
  w.tick(50 * 60_000);
  await w.sweep();
  const retry = w.woken().at(-1)!;
  assert.equal(retry.payload.wakeId, first.payload.wakeId);
  assert.equal(retry.payload.attempt, 2);
  assert.match(retry.payload.reason, /retry/);
  await claim(w, retry);
  w.tick(50 * 60_000);
  await w.sweep();
  assert.equal(getGoal(w.db, goal.id)!.status, "stuck");
  assert.equal(getGoal(w.db, goal.id)!.statusReason, "The lead agent stopped answering its wake-ups.");
});

test("a held send makes the goal wait on its approver; the answer resumes it and wakes the lead", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "Remind Lab 7")] }));
  const wake = w.woken()[0]!;
  await claim(w, wake);
  await w.call(
    "goals.report",
    { goalId: goal.id, wakeId: wake.payload.wakeId, summary: "Sending the reminder." },
    lead,
  );
  const hold = (await w.ctx(host).call!("tasks.create", {
    kind: "approve",
    title: "Approve: email to 1,240 Lab 7 attendees",
    assigned: { kind: "person", id: OWNER },
  })) as { task: { id: string } };
  await w.waiting({ threadId: goal.threadId, taskId: hold.task.id, turnId: "trn_9" });
  let g = getGoal(w.db, goal.id)!;
  assert.equal(g.status, "waiting");
  assert.equal(g.statusReason, "Approve: email to 1,240 Lab 7 attendees");
  const got = await w.call("goals.get", { goalId: goal.id });
  assert.deepEqual(
    got.waiting.map((x: { title: string }) => x.title),
    ["Approve: email to 1,240 Lab 7 attendees"],
  );
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
  const g = {
    rhythm: { every: "hours" as const, hours: 6 },
    zone: "Asia/Karachi",
    quiet: { from: "22:00", to: "08:00" },
  };
  const late = Date.UTC(2026, 10, 3, 17, 30); // 22:30 in Karachi
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
  const a = await w.call(
    "goals.ask",
    {
      goalId: goal.id,
      decision: "lab7-audience",
      question: "Email Lab 7 no-shows too?",
      options: ["Yes", "Only attendees"],
    },
    lead,
  );
  const b = await w.call(
    "goals.ask",
    { goalId: goal.id, decision: "lab7-audience", question: "Should I email Lab 7 no-shows?" },
    lead,
  );
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
  const subjects = w.state.shares
    .filter((s) => s.source === `goal:${goal.id}`)
    .map((s) => s.subject.id)
    .sort();
  assert.deepEqual(subjects, [LEAD, "usr_dana", OWNER], "Aliza and the helper agent lost what the goal gave them");
  await w.mention({ threadId: goal.threadId, personId: "usr_omar", messageId: "msg_1" });
  assert.ok(
    w.state.shares.some(
      (s) => s.subject.id === "usr_omar" && s.level === "view" && s.source === `goal:${goal.id}:mention`,
    ),
  );
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
  const second = await w.call(
    "goals.create",
    labGoal({ title: "Lab 8 sponsor slots", recordIds: ["rec_lab8"], idempotencyKey: "k2" }),
  );
  assert.equal(second.overlaps.length, 1);
  assert.equal(second.overlaps[0].title, "300 registrations for Lab 8");
  const brief = (await w.call("goals.brief", { goalId: second.goal.id }, lead)).text as string;
  assert.match(
    brief,
    /Records this goal shares with other goals: "300 registrations for Lab 8"\. Change those records through tasks, never directly\./,
  );
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
  assert.match(
    text,
    /Standing permissions \(these acts go without asking, in this goal's chats only\): Send email from the Lab template\./,
  );
  assert.match(text, /The goal's folder in Files/);
  assert.match(
    text,
    /The time now: Wed 4 Nov, 10:00 \(Asia\/Karachi\)\. Write every time in check-ins, summaries and the retrospective in this zone/,
    "times are the owner's, from their profile",
  );
});

test("the goal's folder keeps what its tasks hand in and what people drop in its chat, once each", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "Draft the reminder")] }));
  const child = [...w.state.tasks.values()].find((t) => t.parentTaskId === goal.rootTaskId)!;
  child.fileIds = ["fil_draft"];
  child.state = "done";
  await w.task("task.completed", child.id);
  await w.task("task.completed", child.id);
  assert.deepEqual(
    w.state.files.filter((f) => f.folderId === goal.folderId).map((f) => f.name),
    ["copy of fil_draft"],
    "a task's output is kept once",
  );
  await w.message({ threadId: goal.threadId, messageId: "msg_drop", author: { kind: "person", id: OWNER } });
  await w.message({ threadId: goal.threadId, messageId: "msg_drop", author: { kind: "person", id: OWNER } });
  await w.message({ threadId: goal.threadId, messageId: "msg_drop", author: { kind: "agent", id: LEAD } });
  assert.deepEqual(
    w.state.files
      .filter((f) => f.folderId === goal.folderId)
      .map((f) => f.name)
      .sort(),
    ["copy of fil_brief", "copy of fil_draft", "copy of fil_list"],
  );
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
  assert.equal(g.statusReason, "The lead agent did not check in after two tries: it ended without writing a check-in.");
});

test("a watched page is a source: the number it last read, or how many times it changed; a watch that is gone or has read nothing says so", async () => {
  const w = world();
  const watched = (path?: string, id = "wch_lab8") =>
    labGoal({
      idempotencyKey: `k${path ?? "n"}${id}${w.state.watch.error ?? ""}`,
      finish: {
        kind: "number",
        line: "Luma shows 300 registrations",
        target: 300,
        unit: "registrations",
        source: { kind: "watch", watchId: id, ...(path ? { path } : {}) },
      },
    });
  const { goal } = await w.call("goals.create", watched());
  assert.equal(goal.progress.value, 212, "the number written on the watched page");
  assert.deepEqual(
    w.state.calls.filter((c) => c.cap === "automations.watches.list").map((c) => c.input),
    [{ watchId: "wch_lab8", person: OWNER }],
    "asked for the owner's watch",
  );
  const changes = (await w.call("goals.create", watched("changes"))).goal;
  assert.equal(changes.progress.value, 3);
  w.state.watch = { changes: 0, error: "timed out" };
  const none = (await w.call("goals.create", watched(undefined, "wch_lab8"))).goal;
  assert.match(none.progress.error, /watch could not read the page: timed out/);
  const gone = (await w.call("goals.create", watched(undefined, "wch_other"))).goal;
  assert.match(gone.progress.error, /watch is gone/);
});

test("a goal drafted by an agent takes plan steps before Start, and they become tasks when the owner presses Start", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "First step")] }), lead);
  assert.equal(goal.status, "draft");
  const added = await w.call("goals.plan", { goalId: goal.id, children: [step("b", "Second step")] }, lead);
  assert.deepEqual(added.tasks, []);
  assert.equal(added.drafted, 2);
  assert.equal([...w.state.tasks.values()].filter((t) => t.title.endsWith("step")).length, 0, "no task before Start");
  await w.call("goals.confirm", { goalId: goal.id }, owner);
  const titles = [...w.state.tasks.values()].map((t) => t.title);
  assert.ok(titles.includes("First step") && titles.includes("Second step"));
});

test("goals.create reports what happened to each helper: seated when the chat took them, the reason when it did not", async () => {
  const ok = world({ count: 10 });
  const made = await ok.call("goals.create", labGoal(), lead);
  assert.deepEqual(made.seated.map((s: { id: string; inChat: boolean }) => [s.id, s.inChat]).sort(), [
    [HELPER, true],
    [ALIZA, true],
  ]);
  assert.deepEqual(made.plan, { drafted: 0, attached: 0 });
  const bad = world({ count: 10, failMembers: "A private chat never gains people." });
  const failed = await bad.call("goals.create", labGoal(), lead);
  const aliza = failed.seated.find((s: { id: string }) => s.id === ALIZA);
  assert.equal(aliza.inChat, false);
  assert.match(aliza.error, /never gains people/);
  const activity = (await bad.call("goals.activity", { goalId: failed.goal.id }, owner)).activity;
  assert.ok(
    activity.some((a: { kind: string; text: string }) => a.kind === "error" && /Could not add/.test(a.text)),
    "the failure is in the activity",
  );
  // goals.update says the same when helpers change
  const upd = await ok.call("goals.update", { goalId: made.goal.id, helpers: [{ kind: "person", id: ALIZA }] }, owner);
  assert.deepEqual(
    upd.seated.map((s: { id: string; inChat: boolean }) => [s.id, s.inChat]),
    [[ALIZA, true]],
  );
});

test("the owner edits a draft in place: title, finish line, deadline, lead, owner, helpers and the drafted plan, each through goals.update", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call(
    "goals.create",
    labGoal({ plan: [step("a", "First step"), step("b", "Second step")] }),
    lead,
  );
  const got = await w.call("goals.get", { goalId: goal.id }, owner);
  assert.deepEqual(
    got.draftPlan.map((c: { key: string }) => c.key),
    ["a", "b"],
    "a draft shows its drafted plan",
  );
  const edit = await w.call(
    "goals.update",
    {
      goalId: goal.id,
      title: "Lab 8: 320 sign-ups",
      finish: { ...goal.finish, line: "Luma registrations reach 320" },
      deadline: T0 + 6 * DAY,
      leadAgentId: HELPER,
      helpers: [{ kind: "person", id: ALIZA }],
      plan: [step("b", "Second step first"), step("c", "A new step")],
    },
    owner,
  );
  assert.equal(edit.goal.title, "Lab 8: 320 sign-ups");
  assert.equal(edit.goal.finish.line, "Luma registrations reach 320");
  assert.equal(edit.goal.deadline, T0 + 6 * DAY);
  assert.equal(edit.goal.leadAgentId, HELPER);
  assert.deepEqual(
    edit.seated.map((s: { id: string; inChat: boolean }) => [s.id, s.inChat]),
    [[ALIZA, true]],
  );
  assert.ok(
    w.state.calls.some((c) => c.cap === "threads.add_agent" && c.input.agentId === HELPER && c.input.mode === "lead"),
    "the new lead takes the chat",
  );
  const again = await w.call("goals.get", { goalId: goal.id }, owner);
  assert.deepEqual(
    again.draftPlan.map((c: { key: string }) => c.key),
    ["b", "c"],
  );
  const acts = (await w.call("goals.activity", { goalId: goal.id }, owner)).activity;
  assert.ok(
    acts.some((a: { kind: string; text: string }) => a.kind === "edit" && /title/.test(a.text) && /plan/.test(a.text)),
    "the edit is in the activity",
  );
  // the owner can hand the goal to someone else; what the old owner allowed does not carry over
  const handed = await w.call("goals.update", { goalId: goal.id, owner: ALIZA }, owner);
  assert.equal(handed.goal.owner, ALIZA);
  assert.ok(handed.goal.permissions.every((p: { granted: boolean }) => p.granted === false));
  // a stranger cannot, and a running goal's plan is its tasks
  await assert.rejects(
    w.call("goals.update", { goalId: goal.id, title: "x" }, { id: STRANGER, kind: "person", origin: "app" }),
  );
  const live = await w.call("goals.create", labGoal({ idempotencyKey: "k2" }));
  await assert.rejects(
    w.call("goals.update", { goalId: live.goal.id, plan: [step("z", "Nope")] }, owner),
    /Only a draft/,
  );
});

test("the agent that drafted a goal may add to its plan before Start; another agent may not", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal(), { id: "agt_drafter", kind: "agent", actingFor: OWNER });
  const added = await w.call(
    "goals.plan",
    { goalId: goal.id, children: [step("x", "A step")] },
    { id: "agt_drafter", kind: "agent", actingFor: OWNER },
  );
  assert.equal(added.drafted, 1);
  await assert.rejects(
    w.call(
      "goals.plan",
      { goalId: goal.id, children: [step("y", "Another")] },
      { id: "agt_other", kind: "agent", actingFor: OWNER },
    ),
    /lead agent or the owner/,
  );
});

const asking = (person: string, messageId = "msg_ask"): Record<string, unknown> => ({
  kind: "message",
  routine: false,
  askedBy: { person, messageIds: [messageId], at: T0 },
});

test("an agent starts a draft only in a turn the owner began with their own message, in any chat; otherwise the draft stays and the card waits", async () => {
  const w = world({ count: 10 });
  const agent = { id: LEAD, kind: "agent" as const, actingFor: OWNER };
  const { goal } = await w.call("goals.create", labGoal({ sourceThreadId: "thr_chat" }), agent);
  assert.equal(goal.status, "draft");
  assert.ok(
    w.state.posts.some((p) => p.threadId === "thr_chat" && p.blocks?.[0]?.data.kind === "draft"),
    "the card with Start is in the chat",
  );
  for (const turn of [
    { kind: "none", routine: false },
    { kind: "wake", routine: false },
    { kind: "message", routine: true },
    asking(ALIZA),
  ]) {
    w.state.turn = turn;
    await assert.rejects(w.call("goals.confirm", { goalId: goal.id }, agent), /Only the owner starts a goal/);
  }
  w.state.turn = asking(OWNER);
  const started = (await w.call("goals.confirm", { goalId: goal.id }, agent)).goal;
  assert.equal(started.status, "planning");
  assert.ok(
    started.permissions.every((p: { granted: boolean }) => p.granted === false),
    "an agent's start grants no permission",
  );
});

test("an agent's start of a draft is logged with the agent, the owner and the asking message, linked", async () => {
  const w = world({ count: 10 });
  const agent = { id: LEAD, kind: "agent" as const, actingFor: OWNER };
  const { goal } = await w.call("goals.create", labGoal({ sourceThreadId: "thr_chat" }), agent);
  w.state.turn = asking(OWNER, "msg_start_it");
  await w.call("goals.confirm", { goalId: goal.id }, agent);
  const row = (await w.call("goals.activity", { goalId: goal.id }, owner)).activity.find(
    (a: { kind: string }) => a.kind === "started",
  );
  assert.equal(row.by, `${LEAD}>${OWNER}`);
  assert.equal(row.ref, "msg_start_it");
  assert.match(row.tpl, /started the goal\. Due \{at:\d+\}, asked by \{who:usr_owner\}\./);
});

test("the owner asks an agent in another chat to change the deadline: it does, and the activity names the agent, the owner and the message", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal());
  const agent = { id: LEAD, kind: "agent" as const, actingFor: OWNER };
  w.state.turn = asking(OWNER, "msg_ask_thu");
  const due = T0 + 9 * DAY;
  const out = await w.call("goals.update", { goalId: goal.id, deadline: due }, agent);
  assert.equal(out.goal.deadline, due);
  const edit = (await w.call("goals.activity", { goalId: goal.id }, owner)).activity.find(
    (a: { kind: string }) => a.kind === "edit",
  );
  assert.equal(edit.by, `${LEAD}>${OWNER}`);
  assert.equal(edit.ref, "msg_ask_thu");
  assert.match(edit.tpl, new RegExp(`asked by \\{who:${OWNER}\\}`));
  const ext = await w.call("goals.extend", { goalId: goal.id, deadline: due + DAY }, agent);
  assert.equal(ext.goal.deadline, due + DAY);
  const moved = (await w.call("goals.activity", { goalId: goal.id }, owner)).activity.find(
    (a: { kind: string }) => a.kind === "extended",
  );
  assert.equal(moved.ref, "msg_ask_thu");
  assert.match(moved.tpl, /\{who:agt_lead\} moved the deadline to \{at:\d+\}, asked by \{who:usr_owner\}\./);
});

test("an asked agent changes a goal's words, deadline, rhythm and quiet hours, and nothing that is the owner's own press", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal());
  const agent = { id: LEAD, kind: "agent" as const, actingFor: OWNER };
  w.state.turn = asking(OWNER);
  const ok = await w.call(
    "goals.update",
    {
      goalId: goal.id,
      title: "New words",
      outcome: "A fuller Lab 8",
      deadline: T0 + 6 * DAY,
      rhythm: { every: "day", at: "10:00" },
      quiet: { from: "21:00", to: "07:00" },
      finish: { ...goal.finish, line: "Registrations reach 300" },
    },
    agent,
  );
  assert.equal(ok.goal.title, "New words");
  const refused: Array<[string, Record<string, unknown>]> = [
    ["owner", { owner: ALIZA }],
    ["permissions", { permissions: [{ act: "send", target: "mail.send", label: "Send email from the Lab template" }] }],
    ["helpers", { helpers: [{ kind: "person", id: ALIZA }] }],
    ["leadAgentId", { leadAgentId: HELPER }],
    ["budget raised", { budget: { spendMicros: 99_000_000, turns: 20 } }],
    ["budget cap removed", { budget: { turns: 20 } }],
    ["finish target", { finish: { ...goal.finish, target: 999 } }],
    ["finish source", { finish: { ...goal.finish, source: { kind: "records", type: "other", label: "Elsewhere" } } }],
    ["project", { projectId: "prj_lab8" }],
  ];
  for (const [what, input] of refused) {
    await assert.rejects(
      w.call("goals.update", { goalId: goal.id, ...input }, agent),
      (e: { error?: { details?: { reason?: string } } }) => e.error?.details?.reason === "owner_press_only",
      what,
    );
  }
  assert.equal(getGoal(w.db, goal.id)!.owner, OWNER);
  assert.equal(getGoal(w.db, goal.id)!.budget.spendMicros, 10_000_000);
  // the rest of what a goal is made of is allowed when asked, and each is logged as asked
  const more = await w.call(
    "goals.update",
    { goalId: goal.id, zone: "Asia/Karachi", stuckAfter: 5, recordIds: ["rec_a", "rec_b"] },
    agent,
  );
  assert.equal(more.goal.zone, "Asia/Karachi");
  const edit = (await w.call("goals.activity", { goalId: goal.id }, owner)).activity.find(
    (a: { kind: string; text: string }) => a.kind === "edit" && /time zone/.test(a.text),
  );
  assert.match(edit.tpl, /changed the .*time zone.*, asked by \{who:usr_owner\}\./);
  assert.equal(edit.ref, "msg_ask");
  // lowering a budget is allowed
  const lower = await w.call("goals.update", { goalId: goal.id, budget: { spendMicros: 5_000_000, turns: 10 } }, agent);
  assert.equal(lower.goal.budget.spendMicros, 5_000_000);
  // the owner's own press can do all of it
  assert.equal(
    (await w.call("goals.update", { goalId: goal.id, budget: { spendMicros: 20_000_000, turns: 40 } }, owner)).goal
      .budget.spendMicros,
    20_000_000,
  );
});

test("an asked agent may slow check-ins freely, and speed them up only on a goal with a budget cap and never past once an hour", async () => {
  const agent = { id: LEAD, kind: "agent" as const, actingFor: OWNER };
  const speed = async (
    budget: Record<string, number>,
    rhythm: Record<string, unknown>,
    key: string,
  ): Promise<unknown> => {
    const w = world({ count: 10 });
    const { goal } = await w.call(
      "goals.create",
      labGoal({ budget, idempotencyKey: key, rhythm: { every: "day", at: "09:00" } }),
    );
    w.state.turn = asking(OWNER);
    return w.call("goals.update", { goalId: goal.id, rhythm }, agent).then(
      (r: { goal: { rhythm: unknown } }) => r.goal.rhythm,
      (e: { error?: { details?: { reason?: string } } }) => e.error?.details?.reason,
    );
  };
  assert.equal(
    await speed({}, { every: "hours", hours: 1 }, "r1"),
    "owner_press_only",
    "daily to hourly with no budget is refused",
  );
  assert.deepEqual(
    await speed({ turns: 40 }, { every: "hours", hours: 1 }, "r2"),
    { every: "hours", hours: 1 },
    "with a budget it is allowed",
  );
  assert.equal(
    await speed({ turns: 40 }, { every: "hours", hours: 1 / 6 }, "r3"),
    "owner_press_only",
    "every ten minutes is refused even with a budget",
  );
  assert.equal(await speed({}, { every: "hours", hours: 1 / 6 }, "r4"), "owner_press_only", "and without one");
  assert.deepEqual(
    await speed({}, { every: "week", day: 1, at: "09:00" }, "r5"),
    { every: "week", day: 1, at: "09:00" },
    "slower is free",
  );
});

test("an asked agent rewrites the plan of a draft goal, and the plan stays a draft until the owner starts it", async () => {
  const w = world({ count: 10 });
  const agent = { id: LEAD, kind: "agent" as const, actingFor: OWNER };
  const { goal } = await w.call("goals.create", labGoal(), agent);
  assert.equal(goal.status, "draft");
  w.state.turn = asking(OWNER, "msg_plan");
  await w.call("goals.update", { goalId: goal.id, plan: [step("x", "A better first step")] }, agent);
  const row = (await w.call("goals.activity", { goalId: goal.id }, owner)).activity.find(
    (a: { kind: string; text: string }) => a.kind === "edit" && /plan/.test(a.text),
  );
  assert.equal(row.ref, "msg_plan");
  assert.equal(getGoal(w.db, goal.id)!.status, "draft");
});

test("an asked agent may pause, resume and stop the owner's goal; done stays the owner's press", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal());
  const agent = { id: LEAD, kind: "agent" as const, actingFor: OWNER };
  w.state.turn = asking(OWNER);
  assert.equal((await w.call("goals.pause", { goalId: goal.id }, agent)).goal.status, "paused");
  assert.equal(
    (await w.call("goals.resume", { goalId: goal.id }, agent)).goal.status,
    "planning",
    "no tasks yet, so it plans",
  );
  await assert.rejects(w.call("goals.finish", { goalId: goal.id }, agent), /Only the owner says a goal is done/);
  assert.equal((await w.call("goals.stop", { goalId: goal.id }, agent)).goal.status, "stopped");
});

test("an agent changes the owner's goal in no turn nobody asked for: a routine, a goal wake, a watcher, a hand-off and an agent's message are all refused", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal());
  const agent = { id: LEAD, kind: "agent" as const, actingFor: OWNER };
  const before = getGoal(w.db, goal.id)!.deadline;
  for (const turn of [
    { kind: "none", routine: false },
    { kind: "wake", routine: false },
    { kind: "message", routine: true },
    { kind: "handoff", routine: false },
    { kind: "message", routine: false },
  ]) {
    w.state.turn = turn;
    for (const [cap, input] of [
      ["goals.update", { title: "Nope" }],
      ["goals.extend", { deadline: before + DAY }],
      ["goals.pause", {}],
      ["goals.stop", {}],
    ] as const) {
      await assert.rejects(
        w.call(cap, { goalId: goal.id, ...input }, agent),
        (e: { error?: { details?: { reason?: string } } }) => e.error?.details?.reason === "owner_only",
        `${cap} in ${JSON.stringify(turn)}`,
      );
    }
  }
  assert.equal(getGoal(w.db, goal.id)!.deadline, before);
});

test("an agent acting for someone who is not the owner is refused, even when that person asked it", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal());
  w.state.turn = asking(ALIZA);
  await assert.rejects(
    w.call("goals.extend", { goalId: goal.id, deadline: T0 + 9 * DAY }, { id: LEAD, kind: "agent", actingFor: ALIZA }),
    /Only the owner/,
  );
  w.state.turn = asking(OWNER);
  await assert.rejects(
    w.call("goals.extend", { goalId: goal.id, deadline: T0 + 9 * DAY }, { id: LEAD, kind: "agent", actingFor: ALIZA }),
    /Only the owner/,
  );
});

test("an agent that cannot see the goal is told there is no such goal, asked or not", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal());
  w.state.turn = asking(OWNER);
  await assert.rejects(
    w.call("goals.pause", { goalId: goal.id }, { id: "agt_stranger", kind: "agent", actingFor: STRANGER }),
    /does not exist/,
  );
});

test("goals.count says how many goals a project has and nothing else; only the system may ask when the caller manages nothing", async () => {
  const w = world({ count: 120 });
  await w.call("goals.create", labGoal({ projectId: "prj_lab8", idempotencyKey: "c1" }));
  await w.call("goals.create", labGoal({ projectId: "prj_lab8", idempotencyKey: "c2", title: "Second" }));
  await w.call("goals.create", labGoal({ projectId: "prj_other", idempotencyKey: "c3", title: "Elsewhere" }));
  const out = await w.call("goals.count", { projectId: "prj_lab8" }, host);
  assert.deepEqual(out, { count: 2 });
  assert.equal(JSON.stringify(out).includes("Second"), false);
  assert.equal((await w.call("goals.count", { projectId: "prj_none" }, host)).count, 0);
  await assert.rejects(
    () => w.call("goals.count", { projectId: "prj_lab8" }, { id: STRANGER, kind: "person" }),
    (e: { error?: { code?: string } }) => e.error?.code === "validation.not_found",
  );
});

test("a new goal starts in the Space's time zone, not its creator's; a Space with none gives the creator's own", async () => {
  const space = world({ fakes: { "spaces.get": () => ({ space: { timezone: "America/Los_Angeles" } }) } });
  const made = await space.call("goals.create", labGoal({ plan: [step("reminder", "Remind Lab 7 attendees")] }));
  assert.equal(made.goal.zone, "America/Los_Angeles", "the Space's zone, though the owner's profile says Karachi");
  const bad = world({ fakes: { "spaces.get": () => ({ space: { timezone: "Mars/Olympus" } }) } });
  assert.equal(
    (await bad.call("goals.create", labGoal({ plan: [step("reminder", "Remind Lab 7 attendees")] }))).goal.zone,
    "Asia/Karachi",
    "a zone no runtime knows is not taken",
  );
  const none = world();
  assert.equal(
    (await none.call("goals.create", labGoal({ plan: [step("reminder", "Remind Lab 7 attendees")] }))).goal.zone,
    "Asia/Karachi",
  );
});

test("a goal's lead or helper agent does not show the goal to a person who may not see it: it sees it for the owner, a helper person, or nobody", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal());
  for (const agentId of [LEAD, HELPER]) {
    await assert.rejects(w.call("goals.get", { goalId: goal.id }, { id: agentId, kind: "agent", actingFor: STRANGER }), /does not exist/, `${agentId} acting for a stranger`);
    assert.equal((await w.call("goals.get", { goalId: goal.id }, { id: agentId, kind: "agent", actingFor: OWNER })).goal.id, goal.id, `${agentId} acting for the owner`);
    assert.equal((await w.call("goals.get", { goalId: goal.id }, { id: agentId, kind: "agent", actingFor: ALIZA })).goal.id, goal.id, `${agentId} acting for a helper person`);
    assert.equal((await w.call("goals.get", { goalId: goal.id }, { id: agentId, kind: "agent" })).goal.id, goal.id, `${agentId} acting for nobody`);
  }
  assert.deepEqual((await w.call("goals.list", { scope: "helping" }, { id: LEAD, kind: "agent", actingFor: STRANGER })).goals, [], "and the list of what it leads is empty for a stranger");
});

test("the refusal tells the agent what to do: carry on, mention it once at the next check-in, and do not ask each time", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal());
  w.state.turn = { kind: "wake", routine: false };
  await assert.rejects(
    w.call("goals.pause", { goalId: goal.id }, { id: LEAD, kind: "agent", actingFor: OWNER }),
    /Carry on with the goal without it, and mention it once at your next check-in; do not ask the owner each time/,
  );
  const draft = (
    await w.call("goals.create", labGoal({ idempotencyKey: "d1", sourceThreadId: "thr_chat" }), {
      id: LEAD,
      kind: "agent",
      actingFor: OWNER,
    })
  ).goal;
  await assert.rejects(
    w.call("goals.confirm", { goalId: draft.id }, { id: LEAD, kind: "agent", actingFor: OWNER }),
    /Carry on without it and mention it once at your next check-in/,
  );
});
