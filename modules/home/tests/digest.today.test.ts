// Today's routines and the first-run checklist (spec 3.1 Layout).
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, hex, NOW, MINUTE, HOUR } from "../fixtures/seed.ts";

const MIDNIGHT = Date.UTC(2025, 9, 9);   // NOW is 08:53:20 UTC on 9 October 2025
const intake = hex("agt", 1);
const scout = hex("agt", 2);
const rtn = (n: number): string => `rtn_${n.toString(16).padStart(32, "0")}`;

function world(h: Harness, over: { tz?: string; runs?: unknown[]; next?: Record<string, number[]> } = {}): void {
  h.callee("settings.get", () => ({ row: { value: over.tz ?? "UTC" } }));
  h.callee("agents.list", () => ({ agents: [{ agentId: intake, ownerId: alice.id }, { agentId: scout, ownerId: alice.id }, { agentId: hex("agt", 3), ownerId: bob.id }] }));
  h.callee("agents.routines.list", (i) => ({
    routines: [
      ...(i.agentId === intake ? [
        { routineId: rtn(1), agentId: intake, title: "Morning inbox", cron: "0 7 * * *", prompt: "Sort the inbox", enabled: true },
        { routineId: rtn(2), agentId: intake, title: "Switched off", cron: "0 8 * * *", prompt: "x", enabled: false },
      ] : []),
      ...(i.agentId === scout ? [{ routineId: rtn(3), agentId: scout, title: "Evening digest", cron: "0 18 * * *", prompt: "Summarise the day", enabled: true }] : []),
    ],
  }));
  h.callee("runs.list", () => ({ runs: over.runs ?? [] }));
  h.callee("scheduler.next_times", (i) => ({ times: (over.next ?? {})[i.cron] ?? [] }));
}
const run = (n: number, over: Record<string, unknown>) => ({ id: hex("run", n), kind: "routine", owner: alice.id, status: "succeeded", startedAt: MIDNIGHT + 7 * HOUR, ...over });

test("routines today: results of the ones that ran, then the times still to come, in time order", async () => {
  const h = harness();
  world(h, {
    runs: [run(1, { name: "Morning inbox", summary: "12 emails sorted", endedAt: MIDNIGHT + 7 * HOUR + MINUTE })],
    next: { "0 18 * * *": [MIDNIGHT + 18 * HOUR, MIDNIGHT + 42 * HOUR] },
  });
  const r = await h.call("home.routines_today", {}, alice);
  assert.deepEqual(r.routines, [
    { agentId: intake, routineId: rtn(1), title: "Morning inbox", at: MIDNIGHT + 7 * HOUR, state: "done", runId: hex("run", 1), resultLine: "12 emails sorted" },
    { agentId: scout, routineId: rtn(3), title: "Evening digest", at: MIDNIGHT + 18 * HOUR, state: "scheduled" },
  ]);
  const asked = h.calls.find((c) => c.cap === "runs.list")!.input;
  assert.deepEqual(asked, { scope: "mine", kinds: ["routine"], since: MIDNIGHT, limit: 500 });
  assert.deepEqual(h.calls.filter((c) => c.cap === "agents.routines.list").map((c) => c.input.agentId), [intake, scout], "only the agents I own, and only their enabled routines are listed");
});

test("running, done and failed come from the Run's status, with its result line", async () => {
  const h = harness();
  world(h, {
    runs: [
      run(1, { name: "Morning inbox", status: "running", startedAt: MIDNIGHT + 6 * HOUR }),
      run(2, { name: "Morning inbox", status: "failed", summary: "Mail was down", startedAt: MIDNIGHT + 7 * HOUR }),
      run(3, { name: "Evening digest", status: "stopped", startedAt: MIDNIGHT + 8 * HOUR }),
      run(4, { name: "Not one of mine", startedAt: MIDNIGHT + 9 * HOUR }),
      run(5, { name: "Morning inbox", status: "waiting", startedAt: MIDNIGHT + HOUR }),
    ],
  });
  const r = await h.call("home.routines_today", {}, alice);
  assert.deepEqual(r.routines.map((x: { title: string; state: string }) => `${x.title}:${x.state}`), ["Morning inbox:running", "Morning inbox:running", "Morning inbox:failed", "Evening digest:failed"]);
  assert.equal(r.routines[2].resultLine, "Mail was down");
});

test("the day is the person's own: in Karachi, the next times of the evening routine fall in today only up to local midnight", async () => {
  const h = harness();
  // NOW is 13:53 on 9 October in Karachi (UTC+5): local midnight is 19:00 UTC the day before and 19:00 UTC today
  const localMidnightNext = Date.UTC(2025, 9, 9, 19, 0);
  world(h, { tz: "Asia/Karachi", next: { "0 18 * * *": [Date.UTC(2025, 9, 9, 13, 0), localMidnightNext + HOUR] } });
  const r = await h.call("home.routines_today", {}, alice);
  assert.deepEqual(r.routines.map((x: { at: number }) => x.at), [Date.UTC(2025, 9, 9, 13, 0)], "a time after local midnight is tomorrow");
  assert.equal(h.calls.find((c) => c.cap === "runs.list")!.input.since, Date.UTC(2025, 9, 8, 19, 0));
  assert.equal(h.calls.find((c) => c.cap === "scheduler.next_times")!.input.tz, "Asia/Karachi");
});

test("an unreadable time zone setting does not stop Home: UTC is used", async () => {
  const h = harness();
  world(h);
  h.callee("settings.get", () => { throw new Error("settings down"); });
  assert.deepEqual((await h.call("home.routines_today", {}, alice)).routines, []);
  assert.equal(h.calls.find((c) => c.cap === "runs.list")!.input.since, MIDNIGHT);
});

// ---- checklist ----

const steps = (done: string[], dismissed = false) => ({
  dismissed,
  steps: [["import", "Import your data"], ["photo_title", "Add a photo and title"], ["connect_mailbox", "Connect your mailbox and calendar"], ["meet_assistant", "Meet your assistant"], ["first_project", "Open your first project"]]
    .map(([key, title]) => ({ key, title, done: done.includes(key!) })),
});

test("checklist: the five steps in the spec's order, visible until all are done or it is dismissed", async () => {
  const h = harness();
  h.callee("spaces.onboarding.get", () => steps(["photo_title", "meet_assistant"]));
  const r = await h.call("home.checklist", {}, alice);
  assert.equal(r.visible, true);
  assert.deepEqual(r.items.map((i: { key: string; done: boolean }) => `${i.key}:${i.done}`), [
    "photo_and_title:true", "connect_mailbox_and_calendar:false", "meet_assistant:true", "open_first_project:false", "import:false",
  ]);
  h.callee("spaces.onboarding.get", () => steps(["photo_title", "connect_mailbox", "meet_assistant", "first_project", "import"]));
  assert.equal((await h.call("home.checklist", {}, alice)).visible, false, "all done: hidden");
  h.callee("spaces.onboarding.get", () => steps([], true));
  assert.equal((await h.call("home.checklist", {}, alice)).visible, false, "dismissed: hidden");
});

test("dismiss: hides it once and says why; dismissing a hidden checklist says nothing", async () => {
  const h = harness();
  const dismissed: unknown[] = [];
  h.callee("spaces.onboarding.dismiss", (i) => { dismissed.push(i); return { ok: true }; });
  h.callee("spaces.onboarding.get", () => steps(["import"]));
  assert.deepEqual(await h.call("home.dismiss_checklist", {}, alice), { ok: true });
  assert.equal(dismissed.length, 1);
  assert.deepEqual(h.allEvents.at(-1)!.payload, { person: alice.id, reason: "dismissed" });
  assert.equal(h.allEvents.at(-1)!.name, "checklist.dismissed");

  h.callee("spaces.onboarding.get", () => steps(["photo_title", "connect_mailbox", "meet_assistant", "first_project", "import"]));
  await h.call("home.dismiss_checklist", {}, alice);
  assert.equal(h.allEvents.at(-1)!.payload.reason, "done", "finishing all five is a different reason from dismissing");

  const n = h.allEvents.length;
  h.callee("spaces.onboarding.get", () => steps([], true));
  assert.deepEqual(await h.call("home.dismiss_checklist", {}, alice), { ok: true });
  assert.equal(h.allEvents.length, n);
  assert.equal(dismissed.length, 2);
});

test("NOW sits where the tests say it does", () => {
  assert.ok(NOW > MIDNIGHT + 8 * HOUR && NOW < MIDNIGHT + 9 * HOUR);
});
