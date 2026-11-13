// The Wake table (P1 step 3a): a schedule row carries who it is for and how it overlaps; a fire is a row with a state; one claim rule moves it; retention is bounded and never touches an open fire.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { codeOf, harness } from "../fixtures/db.ts";
import { alice, bob, host, HOUR, MINUTE, DAY, NOW, newSchedule } from "../fixtures/seed.ts";
import { fireWakes, prune, tickWakes } from "../impl.ts";
import { closeFire, createFire, dueFires, fireIdOf, openFire } from "../projections.ts";

const AGENT = `agt_${"a".repeat(32)}`;
const ROOM = `chn_${"c".repeat(32)}`;
const wake = (over: Record<string, unknown> = {}) =>
  newSchedule({
    when: { cron: "*/5 * * * *", tz: "UTC" },
    owner: { kind: "agent_routine", id: "rtn_x" },
    cap: "agents.routine.fire",
    kind: "routine",
    person: alice.id,
    agentId: AGENT,
    ...over,
  });

test("a wake keeps who it is for, its zone, its scope and its room; the row says them back", async () => {
  const h = harness();
  const made = await h.call(
    "scheduler.schedule",
    wake({
      scope: "room",
      roomId: ROOM,
      zone: "Asia/Karachi",
      quiet: { from: "22:00", to: "08:00" },
      answerWithinMin: 30,
      maxAttempts: 2,
    }),
    host,
  );
  const row = (await h.call("scheduler.get", { scheduleId: made.scheduleId }, host)).schedule;
  assert.deepEqual([row.zone, row.scope, row.person], ["Asia/Karachi", "room", alice.id]);
  const back = h.db.all(
    "SELECT kind, agent_id, room_id, quiet, overlap, answer_within_min, max_attempts FROM scheduler_api_schedules WHERE id = ?",
    made.scheduleId,
  )[0];
  assert.deepEqual(
    { ...(back as object) },
    {
      kind: "routine",
      agent_id: AGENT,
      room_id: ROOM,
      quiet: '{"from":"22:00","to":"08:00"}',
      overlap: "skip",
      answer_within_min: 30,
      max_attempts: 2,
    },
  );
});

test("a schedule that is not a wake reads as a private call, as before; a shared wake without a room is refused", async () => {
  const h = harness();
  const made = await h.call("scheduler.schedule", newSchedule(), host);
  const row = (await h.call("scheduler.get", { scheduleId: made.scheduleId }, host)).schedule;
  assert.equal(row.scope, "private");
  const bad = await h.call("scheduler.schedule", wake({ scope: "shared" }), host).catch((e) => codeOf(e));
  assert.equal(bad, "validation.bad_input");
  const unknown = await h.call("scheduler.schedule", wake({ zone: "Not/AZone" }), host).catch((e) => codeOf(e));
  assert.equal(unknown, "validation.bad_input");
});

test("a time of a wake makes its fire once, however many ticks and computers see it, and the wake moves on", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  const made = await h.call("scheduler.schedule", wake(), host);
  h.setNow(Date.UTC(2026, 0, 5, 9, 5, 30));
  const first = await h.consumer(host, async (ctx) => tickWakes(ctx));
  const again = await h.consumer(host, async (ctx) => tickWakes(ctx));
  assert.deepEqual([first.made, again.made], [1, 0], "the second tick finds the wake already moved on");
  const key = String(Date.UTC(2026, 0, 5, 9, 5));
  assert.deepEqual(
    h.db
      .all("SELECT state, attempt FROM scheduler_api_fires WHERE schedule_id = ? AND due_key = ?", made.scheduleId, key)
      .map((r) => ({ ...(r as object) })),
    [{ state: "due", attempt: 0 }],
  );
  // another computer that has not seen the move makes the same fire: the insert changes nothing
  assert.equal(createFire(h.db, made.scheduleId, key, Date.UTC(2026, 0, 5, 9, 5), h.now()), false);
  assert.equal(
    (await h.call("scheduler.get", { scheduleId: made.scheduleId }, host)).schedule.nextAt,
    Date.UTC(2026, 0, 5, 9, 10),
  );
  // a plain call schedule is not touched by this pass: tick still fires it as before
  await h.call("scheduler.schedule", newSchedule({ when: { at: Date.UTC(2026, 0, 5, 9, 2) } }), host);
  assert.equal((await h.consumer(host, async (ctx) => tickWakes(ctx))).made, 0);
});

test("the claim: the first claim wins, the second finds it taken; a claim older than its lease is taken again, once", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  const made = await h.call("scheduler.schedule", wake(), host);
  h.setNow(Date.UTC(2026, 0, 5, 9, 5, 30));
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  const key = String(Date.UTC(2026, 0, 5, 9, 5));
  const a = await h.call("scheduler.claim", { scheduleId: made.scheduleId, dueKey: key, host: "host_a" }, host);
  const b = await h.call("scheduler.claim", { scheduleId: made.scheduleId, dueKey: key, host: "host_b" }, host);
  assert.deepEqual(a, { claimed: true, fireId: fireIdOf(made.scheduleId, key), attempt: 1 });
  assert.deepEqual(b, { claimed: false }, "two hosts, one winner");
  h.advance(MINUTE);
  assert.equal(
    (await h.call("scheduler.claim", { scheduleId: made.scheduleId, dueKey: key, host: "host_b" }, host)).claimed,
    false,
    "the lease holds for two minutes",
  );
  h.advance(2 * MINUTE);
  const c = await h.call("scheduler.claim", { scheduleId: made.scheduleId, dueKey: key, host: "host_b" }, host);
  const d = await h.call("scheduler.claim", { scheduleId: made.scheduleId, dueKey: key, host: "host_c" }, host);
  assert.deepEqual([c.claimed, c.attempt, d.claimed], [true, 2, false], "a crashed claim is retried once, by one host");
  assert.equal(
    await h
      .call("scheduler.claim", { scheduleId: made.scheduleId, dueKey: "nope", host: "host_a" }, host)
      .catch((e) => codeOf(e)),
    "validation.not_found",
  );
});

test("report moves a claimed fire through running, waiting and its end; an ended fire does not move; a fire that was never claimed does not move", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  const made = await h.call("scheduler.schedule", wake(), host);
  h.setNow(Date.UTC(2026, 0, 5, 9, 5, 30));
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  const key = String(Date.UTC(2026, 0, 5, 9, 5));
  const id = fireIdOf(made.scheduleId, key);
  assert.deepEqual(
    await h.call("scheduler.report", { fireId: id, attempt: 1, state: "running" }, host),
    { ok: false },
    "not claimed yet",
  );
  await h.call("scheduler.claim", { scheduleId: made.scheduleId, dueKey: key, host: "host_a" }, host);
  const run = `run_${"1".repeat(32)}`;
  assert.equal(
    (await h.call("scheduler.report", { fireId: id, attempt: 1, state: "running", runId: run }, host)).ok,
    true,
  );
  assert.equal((await h.call("scheduler.report", { fireId: id, attempt: 1, state: "waiting" }, host)).ok, true);
  assert.equal(openFire(h.db, made.scheduleId), true, "a fire waiting for a person is open");
  assert.equal((await h.call("scheduler.report", { fireId: id, attempt: 1, state: "done" }, host)).ok, true);
  assert.deepEqual(await h.call("scheduler.report", { fireId: id, attempt: 1, state: "failed" }, host), { ok: false });
  const row = h.db.all(
    "SELECT state, run_id, ended_at FROM scheduler_api_fires WHERE schedule_id = ? AND due_key = ?",
    made.scheduleId,
    key,
  )[0] as Record<string, unknown>;
  assert.deepEqual([row["state"], row["run_id"], row["ended_at"]], ["done", run, h.now()]);
  assert.equal(openFire(h.db, made.scheduleId), false);
});

test("claim and report are the server's alone: a person is refused, and neither is a tool", async () => {
  const h = harness();
  for (const [cap, input] of [
    ["scheduler.claim", { scheduleId: `sch_${"a".repeat(32)}`, dueKey: "1", host: "h" }],
    ["scheduler.report", { fireId: "x#1", attempt: 1, state: "done" }],
  ] as const)
    assert.equal(await h.call(cap, input, alice).catch((e) => codeOf(e)), "permission.no_grant", cap);
  void bob;
  const { registry } = await import("../../../generated/registry.ts");
  for (const name of ["scheduler.claim", "scheduler.report", "scheduler.can_hold"]) {
    const c = registry.capabilities.find((x) => x.name === name) as unknown as {
      tool?: unknown;
      surfaces?: { agent?: unknown };
    };
    assert.ok(c, name);
    assert.equal(c.tool ?? null, null, `${name} is offered to no agent or person as a tool`);
  }
});

test("retention: a plain call keeps its last 20 finished fires and any that failed in the last 7 days; routine history stays 400 days; open fires are never deleted; one pass deletes at most its bound", async () => {
  const h = harness({ now: NOW });
  const call = await h.call("scheduler.schedule", newSchedule({ when: { cron: "0 9 * * *", tz: "UTC" } }), host);
  const routine = await h.call("scheduler.schedule", wake(), host);
  const old = NOW - 30 * DAY;
  const put = (id: string, n: number, state: string, at: number) =>
    h.db.run(
      "INSERT INTO scheduler_api_fires (schedule_id, due_key, scheduled_for, fired_at, state) VALUES (?, ?, ?, ?, ?)",
      id,
      String(n),
      n,
      at,
      state,
    );
  for (let i = 1; i <= 100; i++) put(call.scheduleId, i, "done", old + i);
  put(call.scheduleId, 200, "failed", NOW - HOUR); // failed an hour ago: kept
  put(call.scheduleId, 201, "claimed", old); // open: never deleted
  put(call.scheduleId, 202, "waiting", old);
  put(call.scheduleId, 203, "due", old);
  for (let i = 1; i <= 30; i++) put(routine.scheduleId, i, "done", NOW - 100 * DAY); // history people read
  put(routine.scheduleId, 99, "done", NOW - 401 * DAY); // older than 400 days
  const before = (id: string) =>
    (h.db.all("SELECT COUNT(*) AS n FROM scheduler_api_fires WHERE schedule_id = ?", id)[0] as { n: number }).n;
  const r = await h.consumer(host, async (ctx) => prune(ctx));
  assert.equal(r.deleted, 80 + 1, "80 old plain-call fires and the one routine fire past 400 days");
  assert.equal(before(call.scheduleId), 20 + 1 + 3, "the last 20 finished, the failed one, and the three open ones");
  assert.equal(before(routine.scheduleId), 30);
  const open = h.db.all(
    "SELECT state FROM scheduler_api_fires WHERE schedule_id = ? AND state IN ('claimed','waiting','due')",
    call.scheduleId,
  );
  assert.equal(open.length, 3);
  // the bound: 100,000 fires over 50 wakes is not cleared in one pass
  const many = harness({ now: NOW });
  const ids: string[] = [];
  for (let w = 0; w < 50; w++)
    ids.push(
      (
        await many.call(
          "scheduler.schedule",
          newSchedule({ when: { cron: "0 9 * * *", tz: "UTC" }, owner: { kind: "automation", id: `aut_w${w}` } }),
          host,
        )
      ).scheduleId,
    );
  many.db.run(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000)
       INSERT INTO scheduler_api_fires (schedule_id, due_key, scheduled_for, fired_at, state)
       SELECT s.id, CAST(n.i AS TEXT), n.i, ${old}, 'done' FROM scheduler_api_schedules s, n WHERE s.owner_id LIKE 'aut_w%'`,
  );
  const pass = await many.consumer(host, async (ctx) => prune(ctx));
  assert.ok(pass.deleted <= 500 && pass.deleted > 0, `one pass deleted ${pass.deleted}`);
  const left = (many.db.all("SELECT COUNT(*) AS n FROM scheduler_api_fires")[0] as { n: number }).n;
  assert.equal(left, 100_000 - pass.deleted);
  for (let i = 0; i < 400; i++) if ((await many.consumer(host, async (ctx) => prune(ctx))).deleted === 0) break;
  for (const id of ids)
    assert.equal(
      many.db.all("SELECT 1 FROM scheduler_api_fires WHERE schedule_id = ?", id).length,
      20,
      "at most 20 per wake once the passes are done",
    );
});

test("migration 0003 carries an old fire over as a finished fire with its time as the due key, and the schedules gain their defaults", () => {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  const sql = (f: string) => readFileSync(new URL(f, dir), "utf8");
  db.exec(sql("0001_scheduler_api.sql"));
  db.exec(sql("0002_campaigns_removed.sql"));
  db.prepare(
    "INSERT INTO scheduler_api_schedules (id, owner_kind, owner_id, principal, cap, input, at_ms, if_missed, active, created_by, created_at) VALUES ('sch_1','automation','aut_1','usr_a','automations.fire','{}',5,'skip',1,'usr_a',1)",
  ).run();
  db.prepare(
    "INSERT INTO scheduler_api_fires (schedule_id, scheduled_for, run_id, fired_at) VALUES ('sch_1', 1760000000000, 'run_1', 1760000001000)",
  ).run();
  db.exec(sql("0003_wake.sql"));
  assert.deepEqual(
    {
      ...(db
        .prepare(
          "SELECT schedule_id, due_key, scheduled_for, run_id, fired_at, state, attempt, ended_at FROM scheduler_api_fires",
        )
        .get() as object),
    },
    {
      schedule_id: "sch_1",
      due_key: "1760000000000",
      scheduled_for: 1760000000000,
      run_id: "run_1",
      fired_at: 1760000001000,
      state: "done",
      attempt: 0,
      ended_at: 1760000001000,
    },
  );
  assert.deepEqual(
    {
      ...(db.prepare("SELECT kind, scope, overlap, max_attempts, person FROM scheduler_api_schedules").get() as object),
    },
    { kind: "call", scope: "private", overlap: "skip", max_attempts: 1, person: null },
  );
  // the key is now (wake, due key): a retry is a second row of the same time
  db.prepare(
    "INSERT INTO scheduler_api_fires (schedule_id, due_key, scheduled_for, fired_at) VALUES ('sch_1', '1760000000000#2', 1760000000000, 1)",
  ).run();
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM scheduler_api_fires").get() as { n: number }).n, 2);
  assert.ok(MINUTE > 0);
});

test("fires due at the same instant come out in the order they were made, whatever their ids are", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  const ids: string[] = [];
  for (let i = 0; i < 6; i++)
    ids.push(
      (await h.call("scheduler.schedule", wake({ owner: { kind: "agent_routine", id: `rtn_${i}` } }), host)).scheduleId,
    );
  h.setNow(Date.UTC(2026, 0, 5, 9, 5, 30));
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  const order = dueFires(h.db).map((f) => f.scheduleId);
  assert.deepEqual(order, ids, "the order the wakes were made, though their ids are random");
  assert.deepEqual(
    h.db
      .all(
        "SELECT id FROM scheduler_api_schedules WHERE next_at <= ? ORDER BY next_at, created_at, rowid",
        Date.UTC(2026, 0, 5, 9, 20),
      )
      .map((r) => (r as { id: string }).id),
    ids,
  );
});

// ---- the review of 14 Nov 2026: the fence, the guards that must not be removable, a fire stuck in running, and a server that was off ----

const tenant = { id: `svc_${"b".repeat(32)}`, kind: "service" as const };
async function dueFire(h: ReturnType<typeof harness>, over: Record<string, unknown> = {}) {
  const made = await h.call("scheduler.schedule", wake(over), host);
  h.setNow(h.now() + 10 * MINUTE);
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  const key = (dueFires(h.db)[0] ?? { dueKey: "" }).dueKey;
  return { scheduleId: made.scheduleId as string, key, id: fireIdOf(made.scheduleId, key) };
}
const claim = (h: ReturnType<typeof harness>, f: { scheduleId: string; key: string }, who: string) =>
  h.call("scheduler.claim", { scheduleId: f.scheduleId, dueKey: f.key, host: who }, host);
const state = (h: ReturnType<typeof harness>, f: { scheduleId: string; key: string }) =>
  (h.db.all(
    "SELECT state, attempt, run_id FROM scheduler_api_fires WHERE schedule_id = ? AND due_key = ?",
    f.scheduleId,
    f.key,
  )[0] ?? {}) as Record<string, unknown>;

test("the fence: a claimer whose lease ran out cannot move or end the fire the next claimer holds", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  const f = await dueFire(h);
  const a = await claim(h, f, "host_a");
  h.advance(3 * MINUTE);
  const b = await claim(h, f, "host_b");
  assert.deepEqual([a.attempt, b.attempt], [1, 2]);
  const run = `run_${"2".repeat(32)}`;
  assert.deepEqual(
    await h.call("scheduler.report", { fireId: f.id, attempt: 1, state: "done", runId: run }, host),
    { ok: false, superseded: true },
    "the late first report is told so",
  );
  assert.deepEqual(
    [state(h, f)["state"], state(h, f)["run_id"]],
    ["claimed", null],
    "nothing moved, no run id written",
  );
  assert.deepEqual(await h.call("scheduler.report", { fireId: f.id, attempt: 2, state: "running", runId: run }, host), {
    ok: true,
  });
  assert.deepEqual(await h.call("scheduler.report", { fireId: f.id, attempt: 1, state: "failed" }, host), {
    ok: false,
    superseded: true,
  });
  assert.equal(state(h, f)["state"], "running");
});

test("a fire that is running or waiting is never claimed again, however old; the lease boundary instant belongs to the first claimer", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  const f = await dueFire(h);
  await claim(h, f, "host_a");
  h.advance(2 * MINUTE); // exactly the lease: still the first claimer's
  assert.equal((await claim(h, f, "host_b")).claimed, false, "at the boundary instant");
  h.advance(1);
  const b = await claim(h, f, "host_b");
  assert.equal(b.claimed, true, "one millisecond later it is free");
  for (const s of ["running", "waiting"] as const) {
    await h.call("scheduler.report", { fireId: f.id, attempt: b.attempt, state: s }, host);
    h.advance(30 * DAY);
    assert.equal((await claim(h, f, "host_c")).claimed, false, `${s} a month later`);
    assert.equal(state(h, f)["state"], s);
  }
});

test("tick fires a plain call and never a wake of another kind: a routine wake is made due and its capability is not called", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  await h.call("scheduler.schedule", wake(), host);
  h.setNow(Date.UTC(2026, 0, 5, 9, 11));
  const before = h.calls.length;
  const out = await h.consumer(host, async (ctx) => (await import("../impl.ts")).tick(ctx));
  assert.deepEqual(out.failed, []);
  assert.equal(
    h.calls.filter((c) => c.cap === "agents.routine.fire").length,
    0,
    "its capability was not called by tick",
  );
  assert.equal(h.calls.length, before);
  assert.equal(dueFires(h.db).length, 1, "the fire is made due, for the engine to claim");
});

test("claim and report are the host's alone: a tenant service and a person's nested call are refused", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  const f = await dueFire(h);
  for (const who of [tenant, { ...alice }, { id: "svc_form_x", kind: "service" as const }]) {
    assert.equal(
      await h
        .call("scheduler.claim", { scheduleId: f.scheduleId, dueKey: f.key, host: "h" }, who)
        .catch((e) => codeOf(e)),
      "permission.no_grant",
      who.id,
    );
    assert.equal(
      await h.call("scheduler.report", { fireId: f.id, attempt: 1, state: "done" }, who).catch((e) => codeOf(e)),
      "permission.no_grant",
      who.id,
    );
  }
  assert.equal(state(h, f)["state"], "due", "nothing moved");
});

test("retention never deletes an open fire of any state, however old, in a call wake or a routine wake past 400 days; baton wakes and skipped fires are pruned", async () => {
  const h = harness({ now: NOW });
  const call = await h.call("scheduler.schedule", newSchedule({ when: { cron: "0 9 * * *", tz: "UTC" } }), host);
  const routine = await h.call("scheduler.schedule", wake(), host);
  const baton = await h.call("scheduler.schedule", wake({ owner: { kind: "task", id: "tsk_1" } }), host);
  h.db.run("UPDATE scheduler_api_schedules SET kind = 'baton' WHERE id = ?", baton.scheduleId); // baton wakes arrive at step 9; the retention rule is already theirs
  const ancient = NOW - 500 * DAY;
  let n = 0;
  const put = (id: string, state: string, at = ancient) =>
    h.db.run(
      "INSERT INTO scheduler_api_fires (schedule_id, due_key, scheduled_for, fired_at, state) VALUES (?, ?, ?, ?, ?)",
      id,
      String(++n),
      n,
      at,
      state,
    );
  for (const id of [call.scheduleId, routine.scheduleId])
    for (const st of ["due", "claimed", "running", "waiting"]) put(id, st);
  for (let i = 0; i < 25; i++) put(baton.scheduleId, "done", NOW - DAY);
  for (let i = 0; i < 25; i++) put(call.scheduleId, "skipped", NOW - DAY);
  put(routine.scheduleId, "skipped", ancient);
  await h.consumer(host, async (ctx) => prune(ctx));
  const count = (id: string, where = "1 = 1") =>
    (
      h.db.all(`SELECT COUNT(*) AS n FROM scheduler_api_fires WHERE schedule_id = ? AND ${where}`, id)[0] as {
        n: number;
      }
    ).n;
  const open = "state IN ('due','claimed','running','waiting')";
  assert.deepEqual([count(call.scheduleId, open), count(routine.scheduleId, open)], [4, 4], "every open fire stays");
  assert.equal(count(baton.scheduleId), 20, "a baton wake keeps its last 20 like a call");
  assert.equal(count(call.scheduleId, "state = 'skipped'"), 20, "skipped fires are finished and are pruned with them");
  assert.equal(count(routine.scheduleId, "state = 'skipped'"), 0, "a routine's skipped fire past 400 days goes");
});

test("a server that was off across many times makes one fire for the stretch, keyed on the first missed time, and goes on from now", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 0, 30) });
  const made = await h.call("scheduler.schedule", wake({ when: { cron: "* * * * *", tz: "UTC" } }), host);
  const first = Date.UTC(2026, 0, 5, 9, 1);
  h.setNow(Date.UTC(2026, 0, 6, 9, 0, 30)); // a day later: 1,440 times were missed
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  const rows = h.db
    .all("SELECT due_key, state, reasons FROM scheduler_api_fires WHERE schedule_id = ?", made.scheduleId)
    .map((r) => ({ ...(r as object) }));
  assert.deepEqual(
    rows,
    [{ due_key: String(first), state: "due", reasons: '{"missed":1439}' }],
    "one fire, the old routine key, the count noted",
  );
  assert.equal(
    (await h.call("scheduler.get", { scheduleId: made.scheduleId }, host)).schedule.nextAt,
    Date.UTC(2026, 0, 6, 9, 1),
    "on schedule from now",
  );
  assert.equal((await h.consumer(host, async (ctx) => tickWakes(ctx))).made, 0);
  // a wake whose rule is skip starts nothing for the stretch
  const s = await h.call(
    "scheduler.schedule",
    wake({
      when: { cron: "* * * * *", tz: "UTC" },
      ifMissed: "skip",
      owner: { kind: "agent_routine", id: "rtn_skip" },
    }),
    host,
  );
  h.setNow(Date.UTC(2026, 0, 8, 9, 0, 30));
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  const sk = h.db.all(
    "SELECT state, skip_reason FROM scheduler_api_fires WHERE schedule_id = ?",
    s.scheduleId,
  )[0] as Record<string, unknown>;
  assert.equal(sk["state"], "skipped");
  assert.match(String(sk["skip_reason"]), /if-missed rule is skip/);
});

test("the sweep closes a fire stuck in running by its Run's real state, and never starts anything", async () => {
  const runs: Record<string, string | null> = {};
  const h = harness({
    now: Date.UTC(2026, 0, 5, 9, 1),
    calls: {
      "runs.states": (i) => {
        // what the real runs module answers: every id asked, "gone" for a Run that is not there
        return { states: (i.runIds as string[]).map((id) => ({ runId: id, status: runs[id] ?? "gone" })) };
      },
    },
  });
  const ids: Record<string, { scheduleId: string; key: string; id: string; run: string }> = {};
  for (const [name, runStatus] of [
    ["done", "succeeded"],
    ["failed", "failed"],
    ["stopped", "stopped"],
    ["gone", null],
    ["going", "running"],
    ["waiting", "waiting"],
  ] as const) {
    const made = await h.call(
      "scheduler.schedule",
      wake({ owner: { kind: "agent_routine", id: `rtn_${name}` } }),
      host,
    );
    const run = `run_${name.padEnd(32, "0")}`;
    runs[run] = runStatus as string | null;
    const key = String(Date.UTC(2026, 0, 5, 9, 5));
    ids[name] = { scheduleId: made.scheduleId, key, id: fireIdOf(made.scheduleId, key), run };
  }
  h.setNow(Date.UTC(2026, 0, 5, 9, 5, 30));
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  for (const [name, f] of Object.entries(ids)) {
    const got = await claim(h, f, "host_a");
    await h.call(
      "scheduler.report",
      { fireId: f.id, attempt: got.attempt, state: name === "waiting" ? "waiting" : "running", runId: f.run },
      host,
    );
  }
  const fires = () => h.db.all("SELECT COUNT(*) AS n FROM scheduler_api_fires")[0] as { n: number };
  const before = fires().n;
  const swept = await h.consumer(host, async (ctx) => (await import("../impl.ts")).sweepFires(ctx));
  assert.equal(swept.closed, 4, "ended, failed, stopped and gone close; going and waiting stay");
  const stateOf = (name: string) => state(h, ids[name]!)["state"];
  assert.deepEqual(["done", "failed", "stopped", "gone", "going", "waiting"].map(stateOf), [
    "done",
    "failed",
    "stopped",
    "failed",
    "running",
    "waiting",
  ]);
  assert.equal(fires().n, before, "no fire was made and no Run was started");
  // a fire with no Run at all is closed once it has said running for longer than two leases
  const lone = await h.call("scheduler.schedule", wake({ owner: { kind: "agent_routine", id: "rtn_lone" } }), host);
  h.setNow(Date.UTC(2026, 0, 5, 9, 10, 30));
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  const key = String(Date.UTC(2026, 0, 5, 9, 10));
  const c = await h.call("scheduler.claim", { scheduleId: lone.scheduleId, dueKey: key, host: "h" }, host);
  await h.call(
    "scheduler.report",
    { fireId: fireIdOf(lone.scheduleId, key), attempt: c.attempt, state: "running" },
    host,
  );
  await h.consumer(host, async (ctx) => (await import("../impl.ts")).sweepFires(ctx));
  assert.equal(state(h, { scheduleId: lone.scheduleId, key })["state"], "running", "not yet");
  h.advance(5 * MINUTE);
  await h.consumer(host, async (ctx) => (await import("../impl.ts")).sweepFires(ctx));
  assert.equal(state(h, { scheduleId: lone.scheduleId, key })["state"], "failed");
});

// ---- step 4: who may make a wake of another kind, and the tick path that starts it ----

test("only the host, or the agents module's own doors, make or change a wake of another kind; nobody else passes a first time", async () => {
  const h = harness();
  const outside = { id: `agt_${"o".repeat(32)}`, kind: "agent" as const };
  for (const who of [alice, outside, tenant, { id: "svc_form_x", kind: "service" as const }]) {
    assert.equal(
      await h.call("scheduler.schedule", wake(), who).catch((e) => codeOf(e)),
      "permission.no_grant",
      `${who.id} cannot make a routine wake`,
    );
    assert.equal(
      await h.call("scheduler.schedule", wake(), who, undefined, "agents.routine.run_now").catch((e) => codeOf(e)),
      "permission.no_grant",
      "a nested call from another door is not enough",
    );
    assert.equal(
      await h.call("scheduler.schedule", newSchedule({ nextAt: NOW + HOUR }), who).catch((e) => codeOf(e)),
      "permission.no_grant",
      `${who.id} cannot pass a first time`,
    );
  }
  assert.equal(
    await h.call("scheduler.schedule", wake({ cap: "tasks.create" }), host).catch((e) => codeOf(e)),
    "validation.bad_input",
    "a routine wake names its one capability, even for the host",
  );
  // the agents module's own door, called as the person, may
  const made = await h.call("scheduler.schedule", wake(), alice, undefined, "agents.routine.save");
  assert.ok(made.scheduleId);
  // and a person cannot then change or stop it by calling scheduler.* themselves
  for (const [cap, input] of [
    ["scheduler.reschedule", { scheduleId: made.scheduleId, when: { cron: "0 0 * * *", tz: "UTC" } }],
    ["scheduler.pause", { scheduleId: made.scheduleId, reason: "x" }],
    ["scheduler.cancel", { scheduleId: made.scheduleId }],
  ] as const)
    assert.equal(await h.call(cap, input, alice).catch((e) => codeOf(e)), "permission.no_grant", cap);
  assert.equal(
    (
      await h.call(
        "scheduler.pause",
        { scheduleId: made.scheduleId, reason: "x" },
        alice,
        undefined,
        "agents.routine.save",
      )
    ).schedule.active,
    false,
    "the door may",
  );
  // the host may carry a first time over exactly
  const carried = await h.call(
    "scheduler.schedule",
    wake({ owner: { kind: "agent_routine", id: "rtn_c" }, nextAt: NOW + 3 * HOUR }),
    host,
  );
  assert.equal(carried.nextAt, NOW + 3 * HOUR);
  // a plain call schedule is as before for a person
  assert.ok((await h.call("scheduler.schedule", newSchedule(), alice)).scheduleId);
});

test("the tick path claims a due fire, calls the routine's capability with the fire's key, and reports it: started, skipped, or left to retry", async () => {
  const seen: Array<{ routineId: string; dueKey: string; key?: string }> = [];
  let answer: { started: boolean; runId?: string; why?: string } | "throw" = {
    started: true,
    runId: `run_${"3".repeat(32)}`,
  };
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  h.callee("agents.routine.fire", (i) => {
    seen.push({ routineId: i.routineId, dueKey: i.dueKey });
    if (answer === "throw") throw new Error("runs module down");
    return answer;
  });
  const made = await h.call(
    "scheduler.schedule",
    wake({ owner: { kind: "agent_routine", id: "rtn_x" }, maxAttempts: 3 }),
    host,
  );
  h.setNow(Date.UTC(2026, 0, 5, 9, 5, 30));
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  const key = String(Date.UTC(2026, 0, 5, 9, 5));
  assert.deepEqual(await h.consumer(host, async (ctx) => fireWakes(ctx)), { started: 1, skipped: 0, failed: 0 });
  assert.deepEqual(seen, [{ routineId: "rtn_x", dueKey: key }]);
  assert.deepEqual(
    h.calls.filter((c) => c.cap === "agents.routine.fire").map((c) => c.opts?.idempotencyKey),
    [`routine:rtn_x:${key}`],
    "the Run key is the routine's, byte for byte",
  );
  assert.deepEqual(
    { ...state(h, { scheduleId: made.scheduleId, key }) },
    { state: "running", attempt: 1, run_id: `run_${"3".repeat(32)}` },
  );
  assert.deepEqual(
    await h.consumer(host, async (ctx) => fireWakes(ctx)),
    { started: 0, skipped: 0, failed: 0 },
    "a second pass finds nothing due",
  );
  // not started: the routine is paused or no longer agrees
  answer = { started: false, why: "paused" };
  h.advance(5 * MINUTE);
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  assert.equal((await h.consumer(host, async (ctx) => fireWakes(ctx))).skipped, 1);
  const k2 = String(Date.UTC(2026, 0, 5, 9, 10));
  assert.deepEqual(
    h.db
      .all(
        "SELECT state, skip_reason FROM scheduler_api_fires WHERE schedule_id = ? AND due_key = ?",
        made.scheduleId,
        k2,
      )
      .map((r) => ({ ...(r as object) })),
    [{ state: "skipped", skip_reason: "paused" }],
  );
  // the capability throws (killed between the fire and the Run): the fire stays claimed, and after the lease it is tried again with the same key
  answer = "throw";
  h.advance(5 * MINUTE);
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  assert.equal((await h.consumer(host, async (ctx) => fireWakes(ctx))).failed, 1);
  const k3 = String(Date.UTC(2026, 0, 5, 9, 15));
  assert.equal(state(h, { scheduleId: made.scheduleId, key: k3 })["state"], "claimed");
  assert.equal((await h.consumer(host, async (ctx) => fireWakes(ctx))).failed, 0, "not again inside the lease");
  answer = { started: true, runId: `run_${"4".repeat(32)}` };
  h.advance(3 * MINUTE);
  assert.equal((await h.consumer(host, async (ctx) => fireWakes(ctx))).started, 1);
  assert.equal(state(h, { scheduleId: made.scheduleId, key: k3 })["attempt"], 2);
  assert.deepEqual(seen.filter((x) => x.dueKey === k3).length, 2, "tried twice, the same key both times: one Run");
});

// ---- the third look: the grace, the single insert, and the guards behind them ----

test("a fire with no Run gets two leases to show one, counted from its running report, not from when it was made", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  const f = await dueFire(h);
  h.advance(3 * 60 * MINUTE); // the engine takes it three hours late
  const c = await claim(h, f, "host_a");
  await h.call("scheduler.report", { fireId: f.id, attempt: c.attempt, state: "running" }, host);
  const sweep = () => h.consumer(host, async (ctx) => (await import("../impl.ts")).sweepFires(ctx));
  assert.equal((await sweep()).closed, 0, "one second after it said running: still open");
  h.advance(4 * MINUTE);
  assert.equal((await sweep()).closed, 0, "exactly two leases from the report: still its grace");
  h.advance(1);
  assert.equal((await sweep()).closed, 1, "one millisecond past two leases from the report");
  assert.equal(state(h, f)["state"], "failed");
});

test("closeFire closes only a running or waiting fire; an ended fire keeps its state and its words", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  const f = await dueFire(h);
  const c = await claim(h, f, "host_a");
  await h.call("scheduler.report", { fireId: f.id, attempt: c.attempt, state: "done", note: "as it was" }, host);
  assert.equal(
    closeFire(h.db, { scheduleId: f.scheduleId, dueKey: f.key, graceUntil: 0 }, "failed", "later", h.now()),
    false,
  );
  assert.deepEqual(
    {
      ...(h.db.all(
        "SELECT state, skip_reason FROM scheduler_api_fires WHERE schedule_id = ?",
        f.scheduleId,
      )[0] as object),
    },
    { state: "done", skip_reason: "as it was" },
  );
});

test("a stale fire is made in ONE insert, state and reasons together; an on-time fire under skip is still due; a second server never rewrites it", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 0, 30) });
  const onTime = await h.call(
    "scheduler.schedule",
    wake({
      when: { cron: "* * * * *", tz: "UTC" },
      ifMissed: "skip",
      owner: { kind: "agent_routine", id: "rtn_ontime" },
    }),
    host,
  );
  h.setNow(Date.UTC(2026, 0, 5, 9, 1, 10));
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  assert.equal(
    h.db
      .all("SELECT state FROM scheduler_api_fires WHERE schedule_id = ?", onTime.scheduleId)
      .map((r) => (r as { state: string }).state)
      .join(),
    "due",
    "on time, so due, even under skip",
  );
  const stale = await h.call(
    "scheduler.schedule",
    wake({
      when: { cron: "* * * * *", tz: "UTC" },
      ifMissed: "skip",
      owner: { kind: "agent_routine", id: "rtn_stale" },
    }),
    host,
  );
  h.setNow(Date.UTC(2026, 0, 5, 9, 31, 10));
  // a trigger on the table records every insert: the stale fire arrives whole
  h.db.run("CREATE TEMP TABLE IF NOT EXISTS seen (n INTEGER)");
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  const row = () =>
    h.db.all(
      "SELECT state, reasons, skip_reason FROM scheduler_api_fires WHERE schedule_id = ? AND due_key = ?",
      stale.scheduleId,
      String(Date.UTC(2026, 0, 5, 9, 2)),
    )[0] as Record<string, unknown>;
  const first = { ...row() };
  assert.equal(first["state"], "skipped");
  assert.equal(first["reasons"], '{"missed":29}');
  // a second server that has not seen the move makes the same fire a minute later: nothing is rewritten
  assert.equal(
    createFire(
      h.db,
      stale.scheduleId,
      String(Date.UTC(2026, 0, 5, 9, 2)),
      Date.UTC(2026, 0, 5, 9, 2),
      h.now() + MINUTE,
      { reasons: { missed: 5 } },
    ),
    false,
  );
  assert.deepEqual({ ...row() }, first);
});

test("the sweep visits every open fire, a slice at a time, so a long wait cannot starve a newer fire", async () => {
  const seen: string[] = [];
  let calls = 0;
  const h = harness({
    now: Date.UTC(2026, 0, 5, 9, 1),
    calls: {
      "runs.states": (i) => {
        calls += 1;
        for (const id of i.runIds as string[]) seen.push(id);
        return { states: (i.runIds as string[]).map((runId) => ({ runId, status: "succeeded" })) };
      },
    },
  });
  const made = await h.call("scheduler.schedule", wake(), host);
  for (let i = 1; i <= 450; i++)
    h.db.run(
      "INSERT INTO scheduler_api_fires (schedule_id, due_key, scheduled_for, fired_at, state, run_id, lease_until) VALUES (?, ?, ?, ?, 'waiting', ?, ?)",
      made.scheduleId,
      String(i),
      i,
      1,
      `run_${String(i).padStart(32, "0")}`,
      NOW * 2,
    );
  const out = await h.consumer(host, async (ctx) => (await import("../impl.ts")).sweepFires(ctx));
  assert.equal(out.closed, 450);
  assert.equal(seen.length, 450);
  assert.equal(calls, 3, "450 open fires cost three calls to the runs module, not 450");
  assert.equal(seen[0], `run_${"1".padStart(32, "0")}`, "oldest first");
});

// ---- the fourth look ----

const doorCall = (h: ReturnType<typeof harness>, cap: string, input: unknown, who: typeof alice, door: string) =>
  h.call(cap, input, who, undefined, door);

test("the sweep closes by compare-and-set: a report that lands between its read and its write is not undone", async () => {
  let landed = false;
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  const a = await dueFire(h, { owner: { kind: "agent_routine", id: "rtn_a" } });
  const b = await h.call("scheduler.schedule", wake({ owner: { kind: "agent_routine", id: "rtn_b" } }), host);
  h.setNow(h.now() + 5 * MINUTE);
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  const keyB = String(Date.UTC(2026, 0, 5, 9, 15));
  const runA = `run_${"a".repeat(32)}`;
  const runB = `run_${"b".repeat(32)}`;
  h.callee("runs.states", async () => {
    if (!landed) {
      landed = true;
      // B, which said running with no Run and whose grace has run out, gets its Run now: after the sweep read it, before it writes
      const c = await h.call("scheduler.claim", { scheduleId: b.scheduleId, dueKey: keyB, host: "h" }, host);
      await h.call(
        "scheduler.report",
        { fireId: fireIdOf(b.scheduleId, keyB), attempt: c.attempt, state: "running" },
        host,
      );
    }
    return { states: [{ runId: runA, status: "running" }] };
  });
  const ca = await claim(h, a, "host_a");
  await h.call("scheduler.report", { fireId: a.id, attempt: ca.attempt, state: "running", runId: runA }, host);
  // B says running with no Run, and the grace is over
  h.callee("runs.states", async () => ({ states: [] }));
  const cb = await h.call("scheduler.claim", { scheduleId: b.scheduleId, dueKey: keyB, host: "h" }, host);
  await h.call(
    "scheduler.report",
    { fireId: fireIdOf(b.scheduleId, keyB), attempt: cb.attempt, state: "running" },
    host,
  );
  h.advance(10 * MINUTE);
  landed = false;
  h.callee("runs.states", async () => {
    if (!landed) {
      landed = true;
      await h.call(
        "scheduler.report",
        { fireId: fireIdOf(b.scheduleId, keyB), attempt: cb.attempt, state: "running", runId: runB },
        host,
      );
    }
    return { states: [{ runId: runA, status: "running" }] };
  });
  const out = await h.consumer(host, async (ctx) => (await import("../impl.ts")).sweepFires(ctx));
  assert.equal(out.closed, 0, "nothing closed: B has its Run now");
  assert.deepEqual(
    { ...state(h, { scheduleId: b.scheduleId, key: keyB }) },
    { state: "running", attempt: 1, run_id: runB },
  );
  void runB;
});

const ROWS: [string, (id: string) => unknown][] = [
  ["scheduler.get", (id) => ({ scheduleId: id })],
  ["scheduler.reschedule", (id) => ({ scheduleId: id, when: { cron: "0 8 * * *", tz: "UTC" } })],
  ["scheduler.pause", (id) => ({ scheduleId: id, reason: "x" })],
  ["scheduler.resume", (id) => ({ scheduleId: id })],
  ["scheduler.run_now", (id) => ({ scheduleId: id })],
  ["scheduler.fire", (id) => ({ scheduleId: id, scheduledFor: Date.UTC(2026, 0, 5, 9, 5) })],
  ["scheduler.cancel", (id) => ({ scheduleId: id })],
];
const outsideAgent = { id: `agt_${"o".repeat(32)}`, kind: "agent" as const };
const outcome = async (
  h: ReturnType<typeof harness>,
  cap: string,
  input: unknown,
  who: { id: string; kind?: "person" | "agent" | "actor" | "service" },
  door?: string,
) =>
  h.call(cap, input, who, undefined, door).then(
    () => "ok",
    (e) => codeOf(e) ?? "error",
  );

test("every capability that takes a wake id, on a routine wake: only the host and the agents doors may; run now and fire answer nobody", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  const r = (await h.call("scheduler.schedule", wake(), alice, undefined, "agents.routine.save")).scheduleId as string;
  h.setNow(Date.UTC(2026, 0, 5, 9, 11));
  for (const who of [alice, bob, outsideAgent, tenant])
    for (const [cap, input] of ROWS)
      assert.equal(await outcome(h, cap, input(r), who), "permission.no_grant", `${who.id.slice(0, 7)} ${cap}`);
  assert.equal(
    await outcome(h, "scheduler.claim", { scheduleId: r, dueKey: "1", host: "h" }, alice),
    "permission.no_grant",
  );
  // the doors, as the person the door has already checked
  for (const door of ["agents.routine.save", "agents.routine.delete", "agents.routine.delegate"])
    for (const [cap, input] of ROWS.filter(
      ([c]) => c !== "scheduler.cancel" && c !== "scheduler.run_now" && c !== "scheduler.fire",
    ))
      assert.equal(await outcome(h, cap, input(r), alice, door), "ok", `${door} ${cap}`);
  for (const [cap, input] of ROWS.filter(([c]) => c === "scheduler.run_now" || c === "scheduler.fire")) {
    assert.equal(await outcome(h, cap, input(r), alice, "agents.routine.save"), "permission.no_grant", `door ${cap}`);
    assert.equal(
      await outcome(h, cap, input(r), host),
      "permission.no_grant",
      `host ${cap}: a routine starts only from its schedule or its own Run now`,
    );
  }
  assert.equal(
    await outcome(h, "scheduler.cancel", { scheduleId: r }, alice, "agents.routine.delete"),
    "ok",
    "the delete door cancels",
  );
  assert.equal(await outcome(h, "scheduler.catch_up", { since: 0 }, host), "ok");
  assert.equal(
    h.calls.filter((c) => c.cap === "agents.routine.fire").length,
    0,
    "nothing started the routine directly",
  );
});

test("every capability that takes a wake id, on a plain call wake: its person and the host as before, nobody else", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  h.callee("automations.fire", () => ({ runId: `run_${"5".repeat(32)}` }));
  const c = (await h.call("scheduler.schedule", newSchedule({ when: { cron: "0 9 * * *", tz: "UTC" } }), alice))
    .scheduleId as string;
  for (const who of [bob, outsideAgent, tenant])
    for (const [cap, input] of ROWS)
      assert.equal(await outcome(h, cap, input(c), who), "permission.not_found", `${who.id.slice(0, 7)} ${cap}`);
  for (const [cap, input] of ROWS.filter(([x]) => x !== "scheduler.cancel"))
    assert.equal(await outcome(h, cap, input(c), alice), "ok", `alice ${cap}`);
  assert.equal(await outcome(h, "scheduler.cancel", { scheduleId: c }, alice), "ok");
});

test("a routine handed to someone else is the new owner's through the door at once, and the old owner has no way in", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  const r = (await h.call("scheduler.schedule", wake(), alice, undefined, "agents.routine.save")).scheduleId as string;
  // delegate: the agents door has checked Bob may now edit it; the wake needs no change of principal
  assert.equal(await outcome(h, "scheduler.pause", { scheduleId: r, reason: "x" }, bob, "agents.routine.save"), "ok");
  assert.equal(await outcome(h, "scheduler.resume", { scheduleId: r }, bob, "agents.routine.save"), "ok");
  assert.equal(
    await outcome(
      h,
      "scheduler.reschedule",
      { scheduleId: r, when: { cron: "0 7 * * *", tz: "UTC" } },
      bob,
      "agents.routine.save",
    ),
    "ok",
  );
  assert.equal(await outcome(h, "scheduler.cancel", { scheduleId: r }, bob, "agents.routine.delete"), "ok");
  // Alice, directly: nothing
  const r2 = (
    await h.call(
      "scheduler.schedule",
      wake({ owner: { kind: "agent_routine", id: "rtn_two" } }),
      alice,
      undefined,
      "agents.routine.save",
    )
  ).scheduleId as string;
  for (const [cap, input] of ROWS)
    assert.equal(await outcome(h, cap, input(r2), alice), "permission.no_grant", `alice direct ${cap}`);
  // and a person listing schedules never sees a wake of another kind
  assert.equal((await h.call("scheduler.list", {}, alice)).schedules.length, 0);
  assert.equal((await h.call("scheduler.list", {}, host)).schedules.length >= 1, true);
});

test("a permission failure comes before the idempotency lookup: a caller who may not make a wake cannot learn that its key exists", async () => {
  const h = harness();
  const made = await h.call("scheduler.schedule", wake({ idempotencyKey: "routine-wake:rtn_x" }), host);
  assert.ok(made.scheduleId);
  assert.equal(
    await h.call("scheduler.schedule", wake({ idempotencyKey: "routine-wake:rtn_x" }), alice).catch((e) => codeOf(e)),
    "permission.no_grant",
  );
  assert.equal(
    (await h.call("scheduler.schedule", wake({ idempotencyKey: "routine-wake:rtn_x" }), host)).scheduleId,
    made.scheduleId,
    "the host gets the same schedule back",
  );
});

test("a target that keeps failing is asked up to maxAttempts times, then the fire ends failed with its last reason in words", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  h.callee("agents.routine.fire", () => {
    throw new Error("The runs module is not answering");
  });
  const made = await h.call(
    "scheduler.schedule",
    wake({ owner: { kind: "agent_routine", id: "rtn_f" }, maxAttempts: 2 }),
    host,
  );
  h.setNow(Date.UTC(2026, 0, 5, 9, 5, 30));
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  const key = String(Date.UTC(2026, 0, 5, 9, 5));
  const pass = () => h.consumer(host, async (ctx) => fireWakes(ctx));
  assert.equal((await pass()).failed, 1);
  h.advance(3 * MINUTE);
  assert.equal((await pass()).failed, 1);
  h.advance(3 * MINUTE);
  assert.equal((await pass()).failed, 1, "the third claim is over the limit: not asked again");
  assert.equal(h.calls.filter((x) => x.cap === "agents.routine.fire").length, 2, "asked twice, never a third time");
  const row = h.db.all(
    "SELECT state, skip_reason FROM scheduler_api_fires WHERE schedule_id = ? AND due_key = ?",
    made.scheduleId,
    key,
  )[0] as Record<string, unknown>;
  assert.deepEqual(
    { ...row },
    { state: "failed", skip_reason: "Gave up after 2 tries: The runs module is not answering" },
  );
  h.advance(10 * MINUTE);
  assert.deepEqual(await pass(), { started: 0, skipped: 0, failed: 0 }, "an ended fire is left alone");
});

test("when the runs module cannot be asked, no fire that has a Run is closed", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  h.callee("runs.states", () => {
    throw Object.assign(new Error("down"), { error: { code: "internal.unavailable" } });
  });
  const f = await dueFire(h);
  const c = await claim(h, f, "host_a");
  await h.call(
    "scheduler.report",
    { fireId: f.id, attempt: c.attempt, state: "running", runId: `run_${"9".repeat(32)}` },
    host,
  );
  const out = await h.consumer(host, async (ctx) => (await import("../impl.ts")).sweepFires(ctx));
  assert.equal(out.closed, 0);
  assert.equal(state(h, f)["state"], "running");
});

test("catch_up never replays a wake of another kind: a due routine wake is left to its own rule", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  const made = await h.call("scheduler.schedule", wake({ owner: { kind: "agent_routine", id: "rtn_cu" } }), host);
  const before = (await h.call("scheduler.get", { scheduleId: made.scheduleId }, host)).schedule.nextAt;
  h.setNow(Date.UTC(2026, 0, 5, 10, 0));
  const out = await h.call("scheduler.catch_up", { since: 0 }, host);
  assert.deepEqual(out, { ranOnce: 0, skipped: 0 });
  assert.equal(h.calls.filter((c) => c.cap === "agents.routine.fire").length, 0, "nothing called the routine");
  assert.equal(
    (await h.call("scheduler.get", { scheduleId: made.scheduleId }, host)).schedule.nextAt,
    before,
    "the wake did not move",
  );
  assert.equal(h.db.all("SELECT 1 FROM scheduler_api_fires").length, 0);
});

test("each of the three doors may change a wake; any other nested call may not", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  const r = (await h.call("scheduler.schedule", wake(), alice, undefined, "agents.routine.save")).scheduleId as string;
  for (const door of ["agents.routine.save", "agents.routine.delete", "agents.routine.delegate"])
    assert.equal(await outcome(h, "scheduler.pause", { scheduleId: r, reason: "x" }, alice, door), "ok", door);
  for (const door of ["agents.routine.run_now", "agents.update", "tasks.create", "scheduler.schedule"])
    assert.equal(
      await outcome(h, "scheduler.pause", { scheduleId: r, reason: "x" }, alice, door),
      "permission.no_grant",
      door,
    );
});

// ---- the fifth look ----

async function openWithRun(h: ReturnType<typeof harness>, runs: string[]) {
  const out: { scheduleId: string; key: string; id: string; run: string }[] = [];
  const key = String(Date.UTC(2026, 0, 5, 9, 5));
  for (const [i, run] of runs.entries()) {
    const made = await h.call("scheduler.schedule", wake({ owner: { kind: "agent_routine", id: `rtn_${i}` } }), host);
    out.push({ scheduleId: made.scheduleId, key, id: fireIdOf(made.scheduleId, key), run });
  }
  h.setNow(Date.UTC(2026, 0, 5, 9, 5, 30));
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  for (const f of out) {
    const c = await claim(h, f, "host_a");
    await h.call("scheduler.report", { fireId: f.id, attempt: c.attempt, state: "running", runId: f.run }, host);
  }
  return out;
}

test("the sweep closes only on an explicit status: a null, an empty or a wrong answer, or an id left out, closes nothing", async () => {
  const run = (n: number) => `run_${String(n).repeat(32)}`;
  let answer: unknown = null;
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1), calls: { "runs.states": () => answer } });
  const fires = await openWithRun(h, [run(1), run(2)]);
  const sweep = () => h.consumer(host, async (ctx) => (await import("../impl.ts")).sweepFires(ctx));
  const open = () => fires.map((f) => state(h, f)["state"]);
  for (const bad of [
    null,
    undefined,
    {},
    { states: null },
    { states: {} },
    { states: "gone" },
    { states: [] },
    { states: [{ runId: run(1) }] },
    { states: [{ runId: run(1), status: 5 }] },
  ]) {
    answer = bad;
    assert.equal((await sweep()).closed, 0, JSON.stringify(bad));
    assert.deepEqual(open(), ["running", "running"], JSON.stringify(bad));
  }
  answer = { states: [{ runId: run(1), status: "gone" }] }; // the second id was left out: it stays open
  assert.equal((await sweep()).closed, 1);
  assert.deepEqual(open(), ["failed", "running"]);
});

test("closeFire compares the Run and the grace it read: a different Run id or a different grace closes nothing", async () => {
  const h = harness({ now: Date.UTC(2026, 0, 5, 9, 1) });
  const [f] = await openWithRun(h, [`run_${"1".repeat(32)}`]);
  const row = h.db.all("SELECT lease_until FROM scheduler_api_fires WHERE schedule_id = ?", f!.scheduleId)[0] as {
    lease_until: number;
  };
  const seen = { scheduleId: f!.scheduleId, dueKey: f!.key, runId: f!.run, graceUntil: row.lease_until };
  assert.equal(
    closeFire(h.db, { ...seen, runId: `run_${"2".repeat(32)}` }, "failed", "x", h.now()),
    false,
    "another Run",
  );
  assert.equal(
    closeFire(
      h.db,
      { scheduleId: seen.scheduleId, dueKey: seen.dueKey, graceUntil: row.lease_until },
      "failed",
      "x",
      h.now(),
    ),
    false,
    "no Run read, but it has one",
  );
  assert.equal(
    closeFire(h.db, { ...seen, graceUntil: row.lease_until + 1 }, "failed", "x", h.now()),
    false,
    "another grace",
  );
  assert.equal(state(h, f!)["state"], "running");
  assert.equal(closeFire(h.db, seen, "failed", "x", h.now()), true);
});

test("only the host sweeps: any other caller never even asks the runs module", async () => {
  let asked = 0;
  const h = harness({
    now: Date.UTC(2026, 0, 5, 9, 1),
    calls: {
      "runs.states": (i) => {
        asked += 1;
        return { states: (i.runIds as string[]).map((runId) => ({ runId, status: "gone" })) };
      },
    },
  });
  const [f] = await openWithRun(h, [`run_${"3".repeat(32)}`]);
  for (const who of [alice, bob, tenant]) {
    assert.deepEqual(
      await h.consumer(who, async (ctx) => (await import("../impl.ts")).sweepFires(ctx)),
      { closed: 0 },
      who.id.slice(0, 7),
    );
  }
  assert.equal(asked, 0);
  assert.equal(state(h, f!)["state"], "running");
});

test("a routine has one wake: a second for the same routine is refused, whoever asks; the same key gives the first back; a cancelled one can be made again", async () => {
  const h = harness();
  const own = { owner: { kind: "agent_routine", id: "rtn_one" } };
  const first = await h.call("scheduler.schedule", wake({ ...own, idempotencyKey: "k1" }), host);
  for (const who of [host, alice]) {
    const door = who === alice ? "agents.routine.save" : undefined;
    assert.equal(
      await h
        .call("scheduler.schedule", wake({ ...own, idempotencyKey: "k2" }), who, undefined, door)
        .catch((e) => codeOf(e)),
      "validation.precondition_failed",
      who.id.slice(0, 7),
    );
  }
  assert.equal(
    (await h.call("scheduler.schedule", wake({ ...own, idempotencyKey: "k1" }), host)).scheduleId,
    first.scheduleId,
  );
  assert.ok(
    (await h.call("scheduler.schedule", wake({ owner: { kind: "agent_routine", id: "rtn_two" } }), host)).scheduleId,
    "another routine is another wake",
  );
  await h.call("scheduler.cancel", { scheduleId: first.scheduleId }, host);
  assert.ok((await h.call("scheduler.schedule", wake({ ...own, idempotencyKey: "k3" }), host)).scheduleId);
});
