// The six public capabilities and the host's own calls, through the real handlers on a real SQLite behind the host's table guard. @reads ../migrations/0001_state.sql
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { MUTE_FOREVER } from "../../../lib/state.ts";
import { handlers, periodic } from "../impl.ts";
import { HELPER, JONAS, MAYA, OMAR, STRANGER, failure, harness, openFx, stateOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";

type H = (ctx: never, input: never) => Promise<unknown>;
const call = (name: string): H => handlers[name] as unknown as H;
const run = <T>(name: string, ctx: unknown, input: unknown): Promise<T> =>
  call(name)(ctx as never, input as never) as Promise<T>;
const HOST = { kind: "service", id: "svc_host" } as const;

function conformance(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  assert.ok(def, `${cap} is in the registry`);
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}
/** Call a capability as its contract says: the input and the answer are checked against the frozen schemas. */
async function through<T>(h: Harness, name: string, ctx: unknown, input: unknown): Promise<T> {
  assert.deepEqual(conformance(name, "in", input), [], `${name} input conforms`);
  const out = await run<T>(name, ctx, input);
  assert.deepEqual(conformance(name, "out", out), [], `${name} answer conforms`);
  return out;
}

function seeded() {
  const h = harness();
  const c = h.fx.make("conversation", "cnv_one", [MAYA, JONAS, HELPER]);
  const d = h.fx.make("conversation", "cnv_two", [MAYA]);
  h.fx.post(c, STRANGER);
  h.fx.post(c, STRANGER);
  h.fx.post(d, STRANGER);
  return { h, c, d };
}

test("state.get answers my state, and leaves out what I cannot see", async () => {
  const { h, c } = seeded();
  const none = { type: "conversation", id: "cnv_nobody" };
  const hidden = h.fx.make("conversation", "cnv_private", [OMAR]);
  const out = await through<{ states: { thing: { id: string }; unread: number; done: number | null }[] }>(
    h,
    "state.get",
    h.person(MAYA),
    { things: [c, hidden, none] },
  );
  assert.deepEqual(
    out.states.map((s) => [s.thing.id, s.unread]),
    [["cnv_one", 2]],
    "the unseen thing is not in the answer, and nothing says it exists",
  );
  const jonas = await through<{ states: { unread: number }[] }>(h, "state.get", h.person(JONAS), { things: [c] });
  assert.equal(jonas.states[0]!.unread, 2, "Jonas has his own");
  assert.equal(
    await failure(() => run("state.get", h.person(MAYA), { things: [{ type: "no_such_kind", id: "x" }] })),
    "validation.not_found",
  );
});

test("state.read marks up to a position; Maya's read does not touch Jonas; the event says who and what", async () => {
  const { h, c } = seeded();
  const out = await through<{ unread: number }>(h, "state.read", h.person(MAYA), { thing: c, upto: 2 });
  assert.deepEqual(out, { unread: 0 });
  assert.equal(stateOf(h.fx).stateOf(JONAS, [c])[0]!.unread, 2);
  const ev = h.emitted.filter((e) => e.name === "state.changed");
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0]!.payload["changed"], ["read"]);
  assert.equal(ev[0]!.payload["person"], MAYA);
  assert.equal(ev[0]!.payload["by"], MAYA);
  assert.equal(ev[0]!.subject, "cnv_one");
  h.emitted.length = 0;
  await run("state.read", h.person(MAYA), { thing: c, upto: 2 });
  assert.equal(h.emitted.length, 0, "marking read again changes nothing and says nothing");
});

test("state.read takes exactly one of upto, unread and fromPos", async () => {
  const { h, c } = seeded();
  for (const input of [{ thing: c }, { thing: c, upto: 1, unread: true }, { thing: c, upto: 1, fromPos: 1 }])
    assert.equal(await failure(() => run("state.read", h.person(MAYA), input)), "validation.bad_input");
  await run("state.read", h.person(MAYA), { thing: c, upto: 2 });
  assert.deepEqual(await through(h, "state.read", h.person(MAYA), { thing: c, unread: true }), { unread: 1 });
  assert.deepEqual(await through(h, "state.read", h.person(MAYA), { thing: c, fromPos: 1 }), { unread: 2 });
});

test("a thing I cannot see is not found, for read and set", async () => {
  const { h } = seeded();
  const hidden = h.fx.make("conversation", "cnv_private", [OMAR]);
  assert.equal(
    await failure(() => run("state.read", h.person(MAYA), { thing: hidden, upto: 1 })),
    "validation.not_found",
  );
  assert.equal(
    await failure(() => run("state.set", h.person(MAYA), { thing: hidden, star: true })),
    "validation.not_found",
  );
});

test("state.set: done and archive are one state; star, follow, alert and mute are apart; at least one field", async () => {
  const { h, c } = seeded();
  const out = await through<{
    state: { done: number | null; starred: number | null; follow: string | null; alert: boolean; muted: number | null };
  }>(h, "state.set", h.person(MAYA), {
    thing: c,
    done: true,
    star: true,
    follow: "following",
    alert: true,
    mute: { until: MUTE_FOREVER },
  });
  assert.notEqual(out.state.done, null);
  assert.notEqual(out.state.starred, null);
  assert.equal(out.state.follow, "following");
  assert.equal(out.state.alert, true);
  assert.equal(out.state.muted, MUTE_FOREVER);
  assert.deepEqual(h.emitted.at(-1)!.payload["changed"], ["done", "star", "follow", "mute"]);
  const back = await through<{ state: { done: number | null; follow: string | null; muted: number | null } }>(
    h,
    "state.set",
    h.person(MAYA),
    { thing: c, done: false, follow: null, mute: null },
  );
  assert.equal(back.state.done, null);
  assert.equal(back.state.follow, null);
  assert.equal(back.state.muted, null);
  assert.equal(await failure(() => run("state.set", h.person(MAYA), { thing: c })), "validation.bad_input");
});

test("state.list pages my starred, following, done, unread and muted things, with titles from one batch", async () => {
  const { h, c, d } = seeded();
  await run("state.set", h.person(MAYA), { thing: c, star: true, follow: "following" });
  await run("state.set", h.person(MAYA), { thing: d, done: true, mute: { until: MUTE_FOREVER } });
  const names = (r: unknown) => (r as { rows: { thing: { id: string } }[] }).rows.map((x) => x.thing.id);
  assert.deepEqual(names(await through(h, "state.list", h.person(MAYA), { flag: "starred" })), ["cnv_one"]);
  assert.deepEqual(names(await through(h, "state.list", h.person(MAYA), { flag: "following" })), ["cnv_one"]);
  assert.deepEqual(names(await through(h, "state.list", h.person(MAYA), { flag: "done" })), ["cnv_two"]);
  assert.deepEqual(names(await through(h, "state.list", h.person(MAYA), { flag: "unread" })), ["cnv_one"]);
  assert.deepEqual(names(await through(h, "state.list", h.person(MAYA), { flag: "muted" })), ["cnv_two"]);
  assert.deepEqual(
    names(await through(h, "state.list", h.person(JONAS), { flag: "starred" })),
    [],
    "Jonas has none of Maya's",
  );
  const page = await through<{ rows: { title: string }[]; next?: string }>(h, "state.list", h.person(MAYA), {
    flag: "unread",
    type: "conversation",
    limit: 1,
  });
  assert.equal(page.rows[0]!.title, "cnv_one", "without a describer a row is titled by its id");
  let batches = 0;
  const ctx = {
    ...h.person(MAYA),
    resources: { describeMany: (refs: readonly unknown[]) => (batches++, refs.map(() => ({ title: "A title" }))) },
  };
  const titled = await run<{ rows: { title: string }[] }>("state.list", ctx, { flag: "starred" });
  assert.equal(titled.rows[0]!.title, "A title");
  assert.equal(batches, 1, "one lookup for the whole page");
});

test("state.counts and state.read_scope", async () => {
  const { h } = seeded();
  const all = await through<{ counts: { scope: string; things: number; entries: number }[] }>(
    h,
    "state.counts",
    h.person(MAYA),
    {},
  );
  assert.deepEqual(all.counts, [{ scope: "box:main", things: 2, entries: 3 }]);
  const asked = await through<{ counts: unknown[] }>(h, "state.counts", h.person(MAYA), {
    scopes: ["box:main", "chats"],
  });
  assert.deepEqual(asked.counts, [
    { scope: "box:main", things: 2, entries: 3 },
    { scope: "chats", things: 0, entries: 0 },
  ]);
  assert.deepEqual(await through(h, "state.read_scope", h.person(MAYA), { scope: "box:main" }), { marked: 2 });
  assert.deepEqual((await run<{ counts: unknown[] }>("state.counts", h.person(MAYA), {})).counts, []);
  assert.equal(
    (await run<{ counts: { things: number }[] }>("state.counts", h.person(JONAS), {})).counts[0]!.things,
    1,
    "Jonas's badge is his own",
  );
});

test("an agent acting for Maya reads Maya's state, and only hers", async () => {
  const { h, c } = seeded();
  await run("state.read", h.person(JONAS), { thing: c, upto: 1 });
  const asMaya = h.as({ kind: "agent", id: HELPER }, { actingFor: MAYA });
  const got = await run<{ states: { unread: number }[] }>("state.get", asMaya, { things: [c] });
  assert.equal(got.states[0]!.unread, 2, "Maya's unread, not Jonas's and not its own");
  assert.equal((await run<{ counts: { things: number }[] }>("state.counts", asMaya, {})).counts[0]!.things, 2);
  assert.equal(h.calls.length, 0, "reading never asks for the switch");
});

test("an agent changes a person's state only while that person has turned on state.agents_may_triage", async () => {
  const { h, c } = seeded();
  for (const triage of [false, "unreadable"] as const) {
    const agent = h.as({ kind: "agent", id: HELPER }, { actingFor: MAYA, triage });
    for (const [name, input] of [
      ["state.read", { thing: c, upto: 2 }],
      ["state.read_scope", { scope: "box:main" }],
      ["state.set", { thing: c, done: true }],
    ] as const)
      assert.equal(
        await failure(() => run(name, agent, input)),
        "permission.no_grant",
        `${name} refused while the switch is ${String(triage)}`,
      );
  }
  assert.equal(stateOf(h.fx).stateOf(MAYA, [c])[0]!.unread, 2, "nothing moved");
  assert.equal(h.emitted.length, 0);
  const on = h.as({ kind: "agent", id: HELPER }, { actingFor: MAYA, triage: true });
  await run("state.set", on, { thing: c, done: true });
  const s = stateOf(h.fx).stateOf(MAYA, [c])[0]!;
  assert.notEqual(s.done, null, "it is Maya's state that moved");
  assert.equal(stateOf(h.fx).stateOf(HELPER, [c])[0]!.done, null, "not the agent's own");
  assert.equal(h.emitted.at(-1)!.payload["by"], HELPER, "the event says who did it");
  assert.equal(h.emitted.at(-1)!.payload["person"], MAYA);
  assert.deepEqual(h.calls.at(-1), { cap: "settings.get", input: { key: "state.agents_may_triage" } });
});

test("an agent with no one to act for has its own rows and needs no switch; a person never does", async () => {
  const { h, c } = seeded();
  const alone = h.as({ kind: "agent", id: HELPER });
  await run("state.set", alone, { thing: c, follow: "following" });
  assert.deepEqual(stateOf(h.fx).followersOf(c), [HELPER]);
  assert.equal(h.calls.length, 0);
  await run("state.set", h.person(MAYA), { thing: c, star: true });
  assert.equal(h.calls.length, 0);
});

test("the host's own calls refuse everyone but the server", async () => {
  const { h, c } = seeded();
  const inputs: [string, unknown][] = [
    ["state.arrive", { thing: c, pos: 9, by: null, at: 1 }],
    ["state.retract", { thing: c }],
    ["state.merge", { from: c, to: c }],
    ["state.gain", { person: MAYA, scope: "box:main" }],
    ["state.lose", { person: MAYA, scope: "box:main" }],
    ["state.forget", { thing: c }],
    ["state.verify", {}],
  ];
  const callers = [
    h.person(MAYA),
    h.as({ kind: "agent", id: HELPER }, { actingFor: MAYA }),
    h.as({ kind: "service", id: "svc_site_abc" }),
    h.as({ kind: "actor", id: "act_x" }),
  ];
  for (const [name, input] of inputs)
    for (const who of callers)
      assert.equal(
        await failure(() => run(name, who, input)),
        "permission.no_grant",
        `${name} refuses ${who.principal.kind}`,
      );
  assert.equal(stateOf(h.fx).stateOf(MAYA, [c])[0]!.unread, 2, "nothing moved");
});

test("the server's own calls work and conform", async () => {
  const { h, c } = seeded();
  const host = h.as(HOST);
  const pos = h.fx.insert(c, STRANGER);
  assert.deepEqual(await through(h, "state.arrive", host, { thing: c, pos, by: STRANGER, at: h.fx.clock.t }), {
    applied: true,
    people: 3,
  });
  assert.deepEqual(await through(h, "state.arrive", host, { thing: c, pos, by: STRANGER, at: h.fx.clock.t }), {
    applied: false,
    people: 0,
  });
  assert.deepEqual(await through(h, "state.verify", host, { deep: true }), { problems: [], repaired: 0 });
  assert.deepEqual(await through(h, "state.retract", host, { thing: c }), { ok: true });
  assert.deepEqual(await through(h, "state.lose", host, { person: JONAS, scope: "box:main" }), { rows: 1 });
  // gaining a scope is access to everything in it: the row that was hidden comes back and cnv_two, which Jonas had no row on, gets one
  assert.deepEqual(await through(h, "state.gain", host, { person: JONAS, scope: "box:main" }), { rows: 2 });
  assert.deepEqual(await through(h, "state.forget", host, { thing: c }), { ok: true });
  const a = h.fx.make("conversation", "cnv_a", [MAYA]);
  const b = h.fx.make("conversation", "cnv_b", [MAYA]);
  h.fx.post(a, STRANGER);
  h.fx.db.run("UPDATE fx_entry SET thing = 'cnv_b' WHERE thing = 'cnv_a'");
  assert.deepEqual(await through(h, "state.merge", host, { from: a, to: b }), { ok: true });
});

test("the module start job repairs what a crash left", async () => {
  const h = harness(openFx());
  const c = h.fx.make("conversation", "cnv_one", [MAYA]);
  h.fx.insert(c, STRANGER); // the insert committed, the arrive did not
  const job = periodic["state.verify"];
  assert.equal(job.immediate, true, "it runs when the server starts");
  await job.run(h.as(HOST));
  assert.equal(stateOf(h.fx).stateOf(MAYA, [c])[0]!.unread, 1);
  assert.deepEqual(stateOf(h.fx).counts(MAYA), [{ scope: "box:main", things: 1, entries: 1 }]);
});

test("the minute job clears a mute that has run out and tells the person's devices", async () => {
  const { h, c } = seeded();
  await run("state.set", h.person(MAYA), { thing: c, mute: { until: h.fx.clock.t + 60_000 } });
  assert.deepEqual(
    stateOf(h.fx).counts(MAYA, ["box:main"]),
    [{ scope: "box:main", things: 1, entries: 1 }],
    "only the other thing counts while it is muted",
  );
  h.emitted.length = 0;
  await periodic["state.unmute"].run(h.as(HOST));
  assert.equal(h.emitted.length, 0, "nothing has run out yet");
  h.fx.clock.t += 120_000;
  await periodic["state.unmute"].run(h.as(HOST));
  assert.deepEqual(
    h.emitted.map((e) => [e.name, e.payload["person"], e.payload["changed"]]),
    [["state.changed", MAYA, ["mute"]]],
  );
  assert.deepEqual(stateOf(h.fx).counts(MAYA, ["box:main"]), [{ scope: "box:main", things: 2, entries: 3 }]);
});
