// Agent computer lifecycle (spec 2.7): provision, wake, sleep and the idle job, take over and give back, configure, remove, read, health, and the signed-in sessions. Real SQLite behind the
// host's ctx.db guard, the fake machine for the containers, events and outputs checked against the frozen contract.
import test from "node:test";
import assert from "node:assert/strict";
import {
  configure, get, giveBack, health, list, provision, remove, sessionSignOut, sessionsList, sleep, sleepIdle, takeOver, wake,
} from "../handlers/lifecycle.ts";
import { bindHost, redeemTicket } from "../projections.ts";
import { assertEventsConform, asPerson, codeOf, contractErrors, DANA, harness, INTAKE, MIN, NOW, OMAR } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const SITES = [{ site: "app.example.com", signedInAs: "intake@example.com", since: NOW - 86_400_000, lastSeen: NOW - 3600_000 }, { site: "mail.example.com", since: NOW - 5 * 86_400_000, lastSeen: NOW - 7200_000 }];

async function made(h: Harness, agent = INTAKE): Promise<string> {
  const out = await provision(h.ctx, { agentId: agent, idempotencyKey: `k-${agent}` });
  return out.computer.computerId;
}

test("provision gives an agent a sealed container that starts asleep, and says so once", async () => {
  const h = harness();
  const out = await provision(h.ctx, { agentId: INTAKE, idempotencyKey: "k1" });
  assert.equal(out.computer.state, "asleep");
  assert.equal(out.computer.agentId, INTAKE);
  assert.equal(out.computer.tabLimit, 8);
  assert.equal(out.computer.host, "server");
  assert.equal(out.computer.recording, false);
  assert.equal(out.computer.diskBytes, 1024);
  assert.deepEqual(contractErrors("computers.provision", "out", out), []);
  assert.deepEqual(h.fake.named("create")[0]?.args, { computerId: out.computer.computerId, agentId: INTAKE, tabLimit: 8, idleSleepMinutes: 10 });
  assert.equal(h.rows("SELECT idle_sleep_minutes FROM computers_computers")[0]?.["idle_sleep_minutes"], 10);
  assert.deepEqual(h.named("computer.provisioned").map((e) => e.payload), [{ computerId: out.computer.computerId, agentId: INTAKE }]);
  assert.deepEqual(assertEventsConform(h), []);
});

test("provision refuses a second computer, a missing agent, a Personal Space and a host that fails, and leaves nothing behind", async () => {
  const h = harness();
  await made(h);
  await assert.rejects(() => provision(h.ctx, { agentId: INTAKE, idempotencyKey: "k2" }), (e) => codeOf(e) === "validation.duplicate");
  const missing = harness({ respond: { "agents.get": () => { throw new Error("no such agent"); } } });
  await assert.rejects(() => provision(missing.ctx, { agentId: "agt_none", idempotencyKey: "k" }), (e) => codeOf(e) === "validation.bad_input");
  const personal = harness({ personalSpace: true });
  await assert.rejects(() => provision(personal.ctx, { agentId: INTAKE, idempotencyKey: "k" }), (e) => codeOf(e) === "permission.needs_team");
  const broken = harness({ fakeOptions: { failing: new Set(["create"]) } });
  await assert.rejects(() => provision(broken.ctx, { agentId: INTAKE, idempotencyKey: "k" }), (e) => codeOf(e) === "provider.unavailable");
  assert.equal(broken.rows("SELECT computer_id FROM computers_computers").length, 0);
  assert.equal(broken.named("computer.provisioned").length, 0);
  const none = harness();
  bindHost(null);
  await assert.rejects(() => provision(none.ctx, { agentId: INTAKE, idempotencyKey: "k" }), (e) => codeOf(e) === "provider.unavailable");
});

test("wake starts a sleeping computer, passes through Waking, and is a no-op on an awake one", async () => {
  const h = harness();
  const id = await made(h);
  let seen = "";
  const startOnHost = h.fake.host.start.bind(h.fake.host);
  h.fake.host.start = async (a) => { seen = String(h.rows("SELECT state FROM computers_computers")[0]?.["state"]); return startOnHost(a); };
  const out = await wake(h.ctx, { computerId: id });
  assert.equal(seen, "waking");
  assert.equal(out.computer.state, "working");
  assert.equal(out.computer.tabs, 1);
  assert.deepEqual(contractErrors("computers.wake", "out", out), []);
  assert.deepEqual(h.named("computer.started").map((e) => e.payload), [{ computerId: id, agentId: INTAKE, by: DANA }]);
  await wake(h.ctx, { computerId: id });
  assert.equal(h.named("computer.started").length, 1);
  assert.equal(h.fake.named("start").length, 1);
  await assert.rejects(() => wake(h.ctx, { computerId: "cmt_none" }), (e) => codeOf(e) === "validation.not_found");
});

test("a computer that fails to start shows an error, and the next wake tries again", async () => {
  const h = harness({ fakeOptions: { failing: new Set(["start"]) } });
  const id = await made(h);
  await assert.rejects(() => wake(h.ctx, { computerId: id }), (e) => codeOf(e) === "internal.unexpected");
  const row = h.rows("SELECT state, error FROM computers_computers")[0]!;
  assert.equal(row["state"], "error");
  assert.ok(String(row["error"]).length > 0);
  h.fake.failing.delete("start");
  assert.equal((await wake(h.ctx, { computerId: id })).computer.state, "working");
  assert.equal(h.rows("SELECT error FROM computers_computers")[0]?.["error"], null);
});

test("sleep puts an idle computer to sleep, keeps its signed-in sessions, and is refused mid-task, with a person at the controls or while recording", async () => {
  const h = harness({ fakeOptions: { sessions: SITES } });
  const id = await made(h);
  await wake(h.ctx, { computerId: id });
  h.fake.setBusy(id, true, "Filling the intake form");
  await assert.rejects(() => sleep(h.ctx, { computerId: id }), (e) => codeOf(e) === "validation.precondition_failed");
  assert.equal((await get(h.ctx, { computerId: id })).computer.caption, "Filling the intake form");
  h.fake.setBusy(id, false);
  const out = await sleep(h.ctx, { computerId: id });
  assert.equal(out.computer.state, "asleep");
  assert.equal(out.computer.tabs, 0);
  assert.equal(out.computer.caption, undefined);
  assert.deepEqual(contractErrors("computers.sleep", "out", out), []);
  assert.deepEqual(h.named("computer.slept").map((e) => e.payload), [{ computerId: id, agentId: INTAKE, reason: "requested" }]);
  assert.equal(h.rows("SELECT site FROM computers_sessions").length, 2);
  assert.equal((await sleep(h.ctx, { computerId: id })).computer.state, "asleep");
  assert.equal(h.named("computer.slept").length, 1);
  // a person at the controls
  await takeOver(h.ctx, { computerId: id });
  await assert.rejects(() => sleep(h.ctx, { computerId: id }), (e) => codeOf(e) === "validation.precondition_failed");
  assert.deepEqual(assertEventsConform(h), []);
});

test("a host that cannot stop the computer leaves an error, not a computer that looks asleep", async () => {
  const h = harness();
  const id = await made(h);
  await wake(h.ctx, { computerId: id });
  h.fake.failing.add("stop");
  await assert.rejects(() => sleep(h.ctx, { computerId: id }), (e) => codeOf(e) === "internal.unexpected");
  assert.equal(h.rows("SELECT state FROM computers_computers")[0]?.["state"], "error");
});

test("the idle job sleeps what has been quiet for its idle time and nothing else", async () => {
  const h = harness();
  const quiet = await made(h, "agt_quiet");
  const busy = await made(h, "agt_busy");
  const fresh = await made(h, "agt_fresh");
  const held = await made(h, "agt_held");
  const dead = await made(h, "agt_dead");
  for (const id of [quiet, busy, fresh, held, dead]) await wake(h.ctx, { computerId: id });
  await takeOver(h.ctx, { computerId: held });
  h.advance(9 * MIN);
  assert.equal(await sleepIdle(h.ctx), 0, "nine minutes is not ten");
  h.advance(2 * MIN);
  h.fake.setBusy(busy, true, "Downloading a report");
  h.fake.crash(dead);
  // `fresh` did something a minute ago
  h.db.run("UPDATE computers_computers SET last_active_at = ? WHERE computer_id = ?", h.clock.t - MIN, fresh);
  assert.equal(await sleepIdle(h.ctx), 1);
  const state = Object.fromEntries(h.rows("SELECT agent_id, state FROM computers_computers").map((r) => [r["agent_id"], r["state"]]));
  assert.deepEqual(state, { agt_quiet: "asleep", agt_busy: "working", agt_fresh: "working", agt_held: "takeover", agt_dead: "error" });
  assert.deepEqual(h.named("computer.slept").map((e) => e.payload["reason"]), ["idle"]);
  // the busy one counts as active now, so it is not slept ten minutes after it started but ten minutes after it stopped
  h.fake.setBusy(busy, false);
  h.advance(5 * MIN);
  assert.equal(await sleepIdle(h.ctx), 0);
});

test("take over wakes a sleeping computer, hands the controls to one person, and adds one step", async () => {
  const h = harness();
  const id = await made(h);
  const out = await takeOver(h.ctx, { computerId: id });
  assert.equal(out.computer.state, "takeover");
  assert.equal(out.computer.takeoverBy, DANA);
  assert.match(out.ticket, /^cpt_[0-9a-f]{48}$/);
  assert.deepEqual(contractErrors("computers.take_over", "out", out), []);
  assert.deepEqual(h.fake.named("takeover")[0]?.args, { computerId: id, personId: DANA });
  assert.deepEqual(h.named("computer.started").length, 1);
  assert.deepEqual(h.named("computer.takeover").map((e) => e.payload), [{ computerId: id, agentId: INTAKE, personId: DANA }]);
  const steps = h.rows("SELECT idx, by_who, caption, tool FROM computers_timeline");
  assert.deepEqual(steps, [{ idx: 0, by_who: "person", caption: "You took over", tool: "take_over" }]);
  // the ticket opens one connection
  assert.deepEqual(await redeemTicket(h.db, out.ticket, h.clock.t), { kind: "takeover", computerId: id, personId: DANA });
  assert.equal(await redeemTicket(h.db, out.ticket, h.clock.t), null);
  assert.deepEqual(assertEventsConform(h), []);
});

test("a ticket runs out after a minute", async () => {
  const h = harness();
  const id = await made(h);
  const { ticket } = await takeOver(h.ctx, { computerId: id });
  assert.equal(await redeemTicket(h.db, ticket, h.clock.t + 61_000), null);
  assert.equal(await redeemTicket(h.db, "cpt_nonsense", h.clock.t), null);
});

test("one person at a time: another is told who has it, the same person gets a fresh ticket, an agent cannot take over", async () => {
  const h = harness();
  const id = await made(h);
  const first = await takeOver(h.ctx, { computerId: id });
  const omar = asPerson(h, { kind: "person", id: OMAR });
  await assert.rejects(() => takeOver(omar.ctx, { computerId: id }), (e) => codeOf(e) === "validation.precondition_failed");
  const again = await takeOver(h.ctx, { computerId: id });
  assert.notEqual(again.ticket, first.ticket);
  assert.equal(h.named("computer.takeover").length, 1);
  assert.equal(h.fake.named("takeover").length, 1);
  const agent = asPerson(h, { kind: "agent", id: INTAKE });
  const other = await made(h, "agt_other");
  await assert.rejects(() => takeOver(agent.ctx, { computerId: other }), (e) => codeOf(e) === "permission.no_grant");
  // an agent acting for a person is that person
  const acting = harness({ raw: h.raw, clock: h.clock, fake: h.fake, principal: { kind: "agent", id: INTAKE }, actingFor: OMAR });
  assert.equal((await takeOver(acting.ctx, { computerId: other })).computer.takeoverBy, OMAR);
});

test("give back returns the controls to the agent, names the length of the step, and may be done by whoever manages computers", async () => {
  const h = harness();
  const id = await made(h);
  await takeOver(h.ctx, { computerId: id });
  h.advance(4 * MIN);
  const omar = asPerson(h, { kind: "person", id: OMAR }, { manager: false });
  await assert.rejects(() => giveBack(omar.ctx, { computerId: id }), (e) => codeOf(e) === "permission.no_grant");
  const out = await giveBack(h.ctx, { computerId: id });
  assert.equal(out.computer.state, "working");
  assert.equal(out.computer.takeoverBy, undefined);
  assert.deepEqual(contractErrors("computers.give_back", "out", out), []);
  assert.deepEqual(h.named("computer.given_back").map((e) => e.payload), [{ computerId: id, agentId: INTAKE, personId: DANA }]);
  assert.equal(h.rows("SELECT caption FROM computers_timeline")[0]?.["caption"], "You took over for 4 minutes");
  assert.equal(h.fake.named("giveBack").length, 1);
  await giveBack(h.ctx, { computerId: id });
  assert.equal(h.named("computer.given_back").length, 1, "giving back what is already back does nothing");
  // a manager takes it back from someone else
  await takeOver(h.ctx, { computerId: id });
  const boss = asPerson(h, { kind: "person", id: "usr_boss" });
  assert.equal((await giveBack(boss.ctx, { computerId: id })).computer.state, "working");
  assert.equal(h.named("computer.given_back").at(-1)?.payload["personId"], DANA);
});

test("configure changes the tab limit and the idle sleep, and tells a running computer", async () => {
  const h = harness();
  const id = await made(h);
  const out = await configure(h.ctx, { computerId: id, tabLimit: 12, idleSleepMinutes: 30 });
  assert.equal(out.computer.tabLimit, 12);
  assert.equal(h.rows("SELECT idle_sleep_minutes FROM computers_computers")[0]?.["idle_sleep_minutes"], 30);
  assert.deepEqual(h.named("computer.configured")[0]?.payload, { computerId: id, fields: ["tabLimit", "idleSleepMinutes"] });
  assert.equal(h.fake.named("configure").length, 0, "asleep: nothing to tell");
  await wake(h.ctx, { computerId: id });
  await configure(h.ctx, { computerId: id, tabLimit: 3 });
  assert.deepEqual(h.fake.named("configure")[0]?.args, { computerId: id, tabLimit: 3 });
  await assert.rejects(() => configure(h.ctx, { computerId: id }), (e) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(contractErrors("computers.configure", "out", out), []);
  assert.deepEqual(assertEventsConform(h), []);
});

test("remove takes the container, its profile disk and its rows, but not while a person has the controls", async () => {
  const h = harness();
  const id = await made(h);
  await takeOver(h.ctx, { computerId: id });
  await assert.rejects(() => remove(h.ctx, { computerId: id }), (e) => codeOf(e) === "validation.bad_input");
  await giveBack(h.ctx, { computerId: id });
  assert.deepEqual(await remove(h.ctx, { computerId: id }), { removed: true });
  assert.deepEqual(h.fake.removed, [id]);
  assert.equal(h.fake.named("stop")[0] && (h.fake.named("stop")[0]!.args as { reason: string }).reason, "remove");
  for (const t of ["computers_computers", "computers_timeline", "computers_tickets", "computers_sessions"]) assert.equal(h.rows(`SELECT 1 FROM ${t}`).length, 0, t);
  assert.deepEqual(h.named("computer.removed").map((e) => e.payload), [{ computerId: id, agentId: INTAKE }]);
  await assert.rejects(() => remove(h.ctx, { computerId: id }), (e) => codeOf(e) === "validation.not_found");
});

test("get shows what the running computer reports, and a computer that died is an error, not Working", async () => {
  const h = harness();
  const id = await made(h);
  await wake(h.ctx, { computerId: id });
  h.fake.setBusy(id, true, "Reading the inbox");
  const got = await get(h.ctx, { computerId: id });
  assert.equal(got.computer.caption, "Reading the inbox");
  assert.equal(got.computer.lastFrameAt, 1_760_000_000_000);
  assert.deepEqual(contractErrors("computers.get", "out", got), []);
  h.fake.crash(id);
  const dead = await get(h.ctx, { computerId: id });
  assert.equal(dead.computer.state, "error");
  assert.equal(dead.computer.caption, undefined);
});

test("list filters by state and pages", async () => {
  const h = harness();
  const ids = [await made(h, "agt_a"), await made(h, "agt_b"), await made(h, "agt_c")];
  await wake(h.ctx, { computerId: ids[1]! });
  const all = await list(h.ctx, { limit: 2 });
  assert.equal(all.computers.length, 2);
  assert.equal(all.total, 3);
  assert.ok(all.next);
  assert.equal((await list(h.ctx, { limit: 2, cursor: all.next as string })).computers.length, 1);
  assert.deepEqual((await list(h.ctx, { state: ["working"] })).computers.map((c) => c.agentId), ["agt_b"]);
  assert.deepEqual((await list(h.ctx, { state: ["asleep", "error"] })).computers.map((c) => c.agentId), ["agt_a", "agt_c"]);
  assert.deepEqual(contractErrors("computers.list", "out", all), []);
});

test("health says Down without a host, Healthy with one, Degraded when a computer is in error", async () => {
  const h = harness();
  const id = await made(h);
  await made(h, "agt_two");
  await wake(h.ctx, { computerId: id });
  const ok = await health(h.ctx, {});
  assert.deepEqual([ok.state, ok.awake, ok.asleep], ["healthy", 1, 1]);
  assert.deepEqual(contractErrors("computers.health", "out", ok), []);
  h.fake.crash(id);
  await get(h.ctx, { computerId: id });
  const degraded = await health(h.ctx, {});
  assert.equal(degraded.state, "degraded");
  assert.match(degraded.detail ?? "", /error state/);
  const lost = harness();
  bindHost(null);
  assert.equal((await health(lost.ctx, {})).state, "down");
});

test("sessions: listed from the running computer, from the last list while it sleeps, and signed out by waking it", async () => {
  const h = harness({ fakeOptions: { sessions: SITES } });
  const id = await made(h);
  assert.deepEqual((await sessionsList(h.ctx, { computerId: id })).sessions, [], "never started: nothing signed in that we know of");
  await wake(h.ctx, { computerId: id });
  const awake = await sessionsList(h.ctx, { computerId: id });
  assert.deepEqual(awake.sessions.map((s) => s.site), ["app.example.com", "mail.example.com"]);
  assert.equal(awake.sessions[0]?.signedInAs, "intake@example.com");
  assert.equal(awake.sessions[1]?.signedInAs, undefined);
  assert.deepEqual(contractErrors("computers.sessions.list", "out", awake), []);
  await sleep(h.ctx, { computerId: id });
  assert.equal((await sessionsList(h.ctx, { computerId: id })).sessions.length, 2);
  assert.equal(h.fake.named("sessions").length >= 1, true);
  const out = await sessionSignOut(h.ctx, { computerId: id, site: "app.example.com" });
  assert.deepEqual(out, { ok: true });
  assert.equal(h.rows("SELECT state FROM computers_computers")[0]?.["state"], "working");
  assert.deepEqual((await sessionsList(h.ctx, { computerId: id })).sessions.map((s) => s.site), ["mail.example.com"]);
  assert.deepEqual(h.named("computer.session_signed_out")[0]?.payload, { computerId: id, site: "app.example.com", by: DANA });
  assert.deepEqual(await sessionSignOut(h.ctx, { computerId: id, site: "elsewhere.example.com" }), { ok: false });
  assert.equal(h.named("computer.session_signed_out").length, 1);
  await assert.rejects(() => sessionSignOut(h.ctx, { computerId: id, site: " " }), (e) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(assertEventsConform(h), []);
});

test("everything needs a Team Space", async () => {
  const h = harness({ personalSpace: true });
  await assert.rejects(() => list(h.ctx, {}), (e) => codeOf(e) === "permission.needs_team");
  await assert.rejects(() => wake(h.ctx, { computerId: "cmt_x" }), (e) => codeOf(e) === "permission.needs_team");
  await assert.rejects(() => health(h.ctx, {}), (e) => codeOf(e) === "permission.needs_team");
});
