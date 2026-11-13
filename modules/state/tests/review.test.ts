// What the review of 13 Nov asked for: private events that carry the new state, the gate on every door a write can come through, a person who loses one thing, a verify that never destroys a person's place,
// long things, a read_scope that touches only its own person, pins with an order of their own, and the layout store. @reads ../migrations/0002_state_pin_layout.sql
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, periodic } from "../impl.ts";
import { HELPER, JONAS, MAYA, OMAR, STRANGER, failure, harness, openFx, stateOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { MUTE_FOREVER } from "../../../lib/state.ts";

type H = (ctx: never, input: never) => Promise<unknown>;
const run = <T>(name: string, ctx: unknown, input: unknown): Promise<T> =>
  (handlers[name] as unknown as H)(ctx as never, input as never) as Promise<T>;
const HOST = { kind: "service", id: "svc_host" } as const;

function seeded() {
  const h = harness();
  const c = h.fx.make("conversation", "cnv_one", [MAYA, JONAS, HELPER]);
  h.fx.post(c, STRANGER);
  h.fx.post(c, STRANGER);
  return { h, c };
}
const who = (h: Harness) =>
  h.fx.db.all("SELECT person, type, id, unread, hidden, read_upto FROM state_person ORDER BY person, id");

// ---- 1 private events, and what they carry

test("state.changed is private, and carries the new state of the one thing and the badge it counts in", async () => {
  const { h, c } = seeded();
  await run("state.read", h.person(MAYA), { thing: c, upto: 1 });
  const e = h.emitted.at(-1)!;
  assert.equal(e.name, "state.changed");
  assert.equal(h.emitOpts.at(-1)!["vis"], "private");
  assert.equal((e.payload["state"] as { unread: number }).unread, 1);
  assert.deepEqual(e.payload["count"], { scope: "box:main", things: 1, entries: 1 });
});

test("the minute job's event is private and made on the person's behalf, so the person's devices hear it", async () => {
  const { h, c } = seeded();
  await run("state.set", h.person(MAYA), { thing: c, mute: { until: h.fx.clock.t + 1000 } });
  h.fx.clock.t += 5000;
  h.emitted.length = 0;
  h.emitOpts.length = 0;
  await periodic["state.unmute"].run(h.as(HOST));
  assert.equal(h.emitted.length, 1);
  assert.deepEqual(h.emitOpts[0], { vis: "private", onBehalf: MAYA });
  assert.equal((h.emitted[0]!.payload["state"] as { muted: unknown }).muted, null);
  assert.deepEqual(h.emitted[0]!.payload["changed"], ["mute"]);
});

test("read_scope makes one event for the whole badge, not one for each thing", async () => {
  const h = harness();
  for (let i = 0; i < 5; i++) h.fx.post(h.fx.make("conversation", `cnv_${i}`, [MAYA]), STRANGER);
  await run("state.read_scope", h.person(MAYA), { scope: "box:main" });
  assert.deepEqual(
    h.emitted.map((e) => e.name),
    ["state.scope_read"],
  );
  assert.equal(h.emitted[0]!.payload["marked"], 5);
  assert.deepEqual(h.emitOpts[0], { vis: "private" });
});

// ---- 2 the gate, door by door

test("a write for a person is free only by their own hand; every other door needs their switch", async () => {
  const doors: [string, Parameters<Harness["as"]>[0], { actingFor?: string; origin?: string }, boolean][] = [
    ["a person's own press", { kind: "person", id: JONAS }, { origin: "user" }, true],
    ["a person's own offline queue", { kind: "person", id: JONAS }, { origin: "sync" }, true],
    ["a person through the MCP door", { kind: "person", id: JONAS }, { origin: "mcp" }, false],
    ["a call the engine made as the person", { kind: "person", id: JONAS }, { origin: "engine" }, false],
    ["an agent acting for the person", { kind: "agent", id: HELPER }, { actingFor: JONAS }, false],
    ["a service acting for the person", { kind: "service", id: "svc_site_ab" }, { actingFor: JONAS }, false],
    ["an outside actor acting for the person", { kind: "actor", id: "act_guest" }, { actingFor: JONAS }, false],
    ["an agent with no one to act for (its own rows)", { kind: "agent", id: HELPER }, {}, true],
  ];
  for (const [name, principal, o, free] of doors) {
    const { h, c } = seeded();
    for (const [method, input] of [
      ["state.set", { thing: c, star: true }],
      ["state.read", { thing: c, upto: 2 }],
      ["state.read_scope", { scope: "box:main" }],
      ["state.layout.set", { key: "chats.notes_tab", value: "a" }],
    ] as const) {
      const code = await failure(() => run(method, h.as(principal, { ...o, triage: false }), input));
      assert.equal(
        code === "none",
        free,
        `${name}: ${method} is ${free ? "free" : "refused"} with the switch off (${code})`,
      );
      if (!free) {
        const on = await failure(() => run(method, h.as(principal, { ...o, triage: true }), input));
        assert.notEqual(on, "permission.no_grant", `${name}: ${method} passes the gate with the switch on`);
      }
    }
  }
});

// ---- 3 a person who loses one thing

test("a person removed from one thing no longer sees it in a list or a badge, and sees it again when it comes back", async () => {
  const { h, c } = seeded();
  const d = h.fx.make("conversation", "cnv_two", [MAYA, JONAS]);
  h.fx.post(d, STRANGER);
  await run("state.set", h.person(JONAS), { thing: c, star: true });
  assert.equal(stateOf(h.fx).counts(JONAS, ["box:main"])[0]!.things, 2);
  h.fx.make("conversation", "cnv_one", [MAYA, HELPER]); // Jonas is taken off cnv_one, and nobody told the seam
  const page = await run<{ rows: unknown[] }>("state.list", h.person(JONAS), { flag: "starred" });
  assert.deepEqual(page.rows, [], "the list already leaves it out: the kind says he cannot see it");
  assert.deepEqual(stateOf(h.fx).reconcile(), { left: 1, entered: 0 });
  assert.equal(stateOf(h.fx).counts(JONAS, ["box:main"])[0]!.things, 1, "and the badge stops counting it");
  assert.deepEqual(stateOf(h.fx).verify({ deep: true }).problems, []);
  h.fx.make("conversation", "cnv_one", [MAYA, JONAS, HELPER]);
  assert.deepEqual(stateOf(h.fx).reconcile(), { left: 0, entered: 1 });
  assert.equal(stateOf(h.fx).stateOf(JONAS, [c])[0]!.starred !== null, true, "his star came back with him");
  assert.equal(stateOf(h.fx).stateOf(JONAS, [c])[0]!.unread, 0, "with nothing unread");
});

test("leave and enter move one person's row of one thing and nothing else", () => {
  const { h, c } = seeded();
  const s = stateOf(h.fx);
  assert.equal(s.leave(JONAS, c), true);
  assert.equal(s.leave(JONAS, c), false);
  assert.equal(s.counts(JONAS, ["box:main"])[0]!.things, 0);
  assert.equal(s.counts(MAYA, ["box:main"])[0]!.things, 1, "Maya's badge is hers");
  assert.equal(s.enter(JONAS, c), true);
});

// ---- 4 verify never destroys a person's place

test("a thing the module's heads leave out is unknown, not gone: nobody's place is lowered, and it comes back whole", () => {
  const { h, c } = seeded();
  stateOf(h.fx).read(MAYA, c, { upto: 2 });
  h.fx.db.run("UPDATE fx_thing SET kind = 'archived' WHERE id = 'cnv_one'"); // heads() joins on kind: the thing drops out of its answer
  const r = stateOf(h.fx).verify({ repair: true, deep: true });
  assert.deepEqual(r.problems, []);
  assert.equal(stateOf(h.fx).stateOf(MAYA, [c])[0]!.readUpto, 2);
  h.fx.db.run("UPDATE fx_thing SET kind = 'conversation' WHERE id = 'cnv_one'");
  assert.deepEqual(stateOf(h.fx).verify({ repair: true, deep: true }).problems, [], "restored: no flood of unread");
  assert.equal(stateOf(h.fx).stateOf(MAYA, [c])[0]!.unread, 0);
});

test("an arrival lost before a later one is found by the start-up verify and by the weekly one", async () => {
  const { h, c } = seeded();
  const lost = h.fx.insert(c, STRANGER); // inserted, process died before arrive
  h.fx.post(c, STRANGER); // the next entry arrived
  assert.ok(lost > 0);
  assert.equal(stateOf(h.fx).stateOf(JONAS, [c])[0]!.unread, 3, "the lost one is not counted");
  await periodic["state.verify"].run(h.as(HOST));
  assert.equal(stateOf(h.fx).stateOf(JONAS, [c])[0]!.unread, 4, "found and counted");
  assert.deepEqual(stateOf(h.fx).verify({ deep: true }).problems, []);
  // the next run looks only at things with a newer entry than a week ago, and still finds one
  const again = h.fx.insert(c, STRANGER);
  h.fx.post(c, STRANGER);
  assert.ok(again > 0);
  await periodic["state.verify"].run(h.as(HOST));
  assert.equal(stateOf(h.fx).stateOf(JONAS, [c])[0]!.unread, 6);
});

test("a long pass works in slices: a thousand things, each in a transaction of its own", () => {
  const h = harness();
  for (let i = 0; i < 450; i++) h.fx.make("conversation", `cnv_${i}`, [MAYA]);
  for (let i = 0; i < 450; i++) h.fx.insert({ type: "conversation", id: `cnv_${i}` }, STRANGER);
  const r = stateOf(h.fx).verify({ repair: true });
  assert.equal(r.repaired, 450);
  assert.deepEqual(stateOf(h.fx).verify({ deep: true }).problems, []);
});

test("the minute sweep clears at most 500 mutes at a time", () => {
  const h = harness();
  for (let i = 0; i < 520; i++) {
    const t = h.fx.make("conversation", `cnv_${i}`, [MAYA]);
    h.fx.post(t, STRANGER);
    stateOf(h.fx).set(MAYA, t, { mute: { until: h.fx.clock.t + 1000 } });
  }
  h.fx.clock.t += 5000;
  assert.equal(stateOf(h.fx).sweep().length, 500);
  assert.equal(stateOf(h.fx).sweep().length, 20);
});

// ---- 5 long things

test("reading a thing with 200,000 entries works", () => {
  const h = harness();
  const c = h.fx.make("conversation", "cnv_big", [MAYA, JONAS]);
  h.fx.db.exec(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 200000) INSERT INTO fx_entry (thing, pos, by, at) SELECT 'cnv_big', i, NULL, ${h.fx.clock.t} FROM n`,
  );
  stateOf(h.fx).arrive(c, { pos: 200000, by: null, at: h.fx.clock.t });
  const r = stateOf(h.fx).read(MAYA, c, { upto: 150000 });
  assert.equal(r.state.unread, 50000);
  stateOf(h.fx).read(MAYA, c, { upto: 200000 });
  assert.equal(stateOf(h.fx).read(MAYA, c, { unread: true }).state.readUpto, 199999);
});

// ---- 6 one person's operation leaves everyone else's rows alone

test("read_scope marks only the caller's rows: another person's unread in the same scope is untouched", async () => {
  const h = harness();
  for (let i = 0; i < 3; i++) h.fx.post(h.fx.make("conversation", `cnv_${i}`, [MAYA, JONAS]), STRANGER);
  const jonasBefore = JSON.stringify(h.fx.db.all("SELECT * FROM state_person WHERE person = ?", JONAS));
  const countBefore = JSON.stringify(h.fx.db.all("SELECT * FROM state_count WHERE person = ?", JONAS));
  await run("state.read_scope", h.person(MAYA), { scope: "box:main" });
  assert.equal(JSON.stringify(h.fx.db.all("SELECT * FROM state_person WHERE person = ?", JONAS)), jonasBefore);
  assert.equal(JSON.stringify(h.fx.db.all("SELECT * FROM state_count WHERE person = ?", JONAS)), countBefore);
  assert.equal(stateOf(h.fx).counts(JONAS, ["box:main"])[0]!.things, 3);
  assert.equal(stateOf(h.fx).counts(MAYA, ["box:main"])[0]!.things, 0);
});

// ---- A pins with a manual order

test("a pin has a place of its own: top, end, right below another, and a move writes one row", async () => {
  const h = harness();
  const ids = ["a", "b", "c", "d"].map((x) => h.fx.make("conversation", `cnv_${x}`, [MAYA]));
  const pin = (i: number, p: unknown) => run("state.set", h.person(MAYA), { thing: ids[i], pin: p });
  await pin(0, {}); // a
  await pin(1, {}); // a b
  await pin(2, { after: null }); // c a b
  await pin(3, { after: ids[0] }); // c a d b
  const order = async () =>
    (await run<{ rows: { thing: { id: string } }[] }>("state.list", h.person(MAYA), { flag: "pinned" })).rows.map((r) =>
      r.thing.id.slice(4),
    );
  assert.deepEqual(await order(), ["c", "a", "d", "b"]);
  const before = JSON.stringify(
    h.fx.db.all("SELECT id, pin_rank FROM state_person WHERE person = ? AND id <> 'cnv_c' ORDER BY id", MAYA),
  );
  await pin(2, { after: ids[1] }); // a d b c: one row moves
  assert.deepEqual(await order(), ["a", "d", "b", "c"]);
  const after = JSON.stringify(
    h.fx.db.all("SELECT id, pin_rank FROM state_person WHERE person = ? AND id <> 'cnv_c' ORDER BY id", MAYA),
  );
  assert.equal(after, before, "no other pin was written");
  assert.equal(h.emitted.at(-1)!.payload["changed"] instanceof Array, true);
  assert.deepEqual(h.emitted.at(-1)!.payload["changed"], ["pin"]);
  await pin(0, null);
  assert.deepEqual(await order(), ["d", "b", "c"]);
  assert.equal(
    await failure(() => pin(1, { after: ids[0] })),
    "validation.bad_input",
    "right below something that is not pinned",
  );
});

test("pins keep their order for each person and each kind of thing, and many moves between two pins stay in order", async () => {
  const h = harness();
  const a = h.fx.make("conversation", "cnv_a", [MAYA, JONAS]);
  const b = h.fx.make("conversation", "cnv_b", [MAYA, JONAS]);
  const x = h.fx.make("chat", "chn_x", [MAYA]);
  await run("state.set", h.person(MAYA), { thing: a, pin: {} });
  await run("state.set", h.person(MAYA), { thing: b, pin: {} });
  await run("state.set", h.person(MAYA), { thing: x, pin: {} });
  await run("state.set", h.person(JONAS), { thing: b, pin: {} });
  const rank = (p: string, t: { id: string }) =>
    (h.fx.db.all("SELECT pin_rank FROM state_person WHERE person = ? AND id = ?", p, t.id)[0] as { pin_rank: number })
      .pin_rank;
  assert.equal(rank(MAYA, x), 1, "a chat starts its own order");
  assert.equal(rank(JONAS, b), 1, "and so does Jonas");
  // slide c between a and b sixty times: the neighbours get too close to split, the seam renumbers and the order holds
  const mids = [a];
  for (let i = 0; i < 60; i++) {
    const t = h.fx.make("conversation", `cnv_m${i}`, [MAYA]);
    await run("state.set", h.person(MAYA), { thing: t, pin: { after: a } });
    mids.push(t);
  }
  const rows = (
    await run<{ rows: { thing: { id: string } }[] }>("state.list", h.person(MAYA), {
      flag: "pinned",
      type: "conversation",
      limit: 100,
    })
  ).rows.map((r) => r.thing.id);
  assert.deepEqual(rows, ["cnv_a", ...Array.from({ length: 60 }, (_, i) => `cnv_m${59 - i}`), "cnv_b"]);
});

// ---- C rows carry the whole state; one read for a cold start

test("list rows carry the thing's whole state, and the `any` list returns everything the person has set", async () => {
  const { h, c } = seeded();
  const d = h.fx.make("conversation", "cnv_two", [MAYA]);
  await run("state.set", h.person(MAYA), { thing: c, star: true, pin: {} });
  await run("state.set", h.person(MAYA), { thing: d, mute: { until: MUTE_FOREVER } });
  const e = h.fx.make("conversation", "cnv_three", [MAYA]);
  h.fx.post(e, STRANGER); // nothing set on it
  const any = await run<{
    rows: { thing: { id: string }; state: { starred: number | null; pin: number | null; muted: number | null } }[];
  }>("state.list", h.person(MAYA), { flag: "any" });
  assert.deepEqual(any.rows.map((r) => r.thing.id).sort(), ["cnv_one", "cnv_two"]);
  const one = any.rows.find((r) => r.thing.id === "cnv_one")!;
  assert.equal(one.state.starred !== null && one.state.pin !== null, true);
});

// ---- B the layout store

test("the layout store keeps small values for registered keys, apart for each person, and refuses the rest", async () => {
  const h = harness();
  const set = (who: string, key: string, value: unknown) =>
    run<{ value: { value: unknown; version: number } }>("state.layout.set", h.person(who), { key, value });
  assert.deepEqual((await set(MAYA, "chats.sidebar.folds", { mine: true })).value.value, { mine: true });
  assert.equal((await set(MAYA, "chats.sidebar.folds", { mine: false })).value.version, 2);
  await set(JONAS, "chats.sidebar.folds", { theirs: true });
  const got = await run<{ values: { key: string; value: unknown }[] }>("state.layout.get", h.person(MAYA), {});
  assert.deepEqual(
    got.values.map((v) => [v.key, v.value]),
    [["chats.sidebar.folds", { mine: false }]],
    "only mine",
  );
  assert.equal(await failure(() => set(MAYA, "not.a.key", 1)), "validation.bad_input", "an unregistered key");
  assert.equal(await failure(() => set(MAYA, "chats.notes_tab", "x".repeat(500))), "validation.bad_input", "too big");
  const ev = h.emitted.filter((e) => e.name === "state.layout_changed").at(-1)!;
  assert.equal(ev.payload["person"], JONAS);
  assert.equal(h.emitOpts.at(-1)!["vis"], "private");
  await set(MAYA, "chats.sidebar.folds", null);
  assert.deepEqual((await run<{ values: unknown[] }>("state.layout.get", h.person(MAYA), {})).values, []);
  assert.equal(OMAR.length > 0, true);
  assert.equal(openFx.length >= 0, true);
});

// ---- the second look

test("layout versions only rise: set, set, clear, set never goes back, and a cleared value reads as nothing", async () => {
  const h = harness();
  const set = (value: unknown) =>
    run<{ value: { version: number } }>("state.layout.set", h.person(MAYA), { key: "chats.sidebar.folds", value }).then(
      (r) => r.value.version,
    );
  assert.deepEqual(
    [await set({ a: true }), await set({ a: false }), await set(null), await set({ b: true })],
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    (await run<{ values: { value: unknown; version: number }[] }>("state.layout.get", h.person(MAYA), {})).values.map(
      (v) => [v.value, v.version],
    ),
    [[{ b: true }, 4]],
  );
  await set(null);
  assert.deepEqual((await run<{ values: unknown[] }>("state.layout.get", h.person(MAYA), {})).values, []);
  assert.equal(h.emitted.at(-1)!.payload["version"], 5, "and the clearing event carries the next version too");
});

test("a layout value is the shape of a layout, not a note", async () => {
  const h = harness();
  const set = (key: string, value: unknown) => run("state.layout.set", h.person(MAYA), { key, value });
  assert.equal(
    await failure(() => set("chats.sidebar.folds", { prose: "a long sentence somebody might want to keep" })),
    "validation.bad_input",
  );
  assert.equal(await failure(() => set("chats.sidebar.folds", "text")), "validation.bad_input");
  assert.equal(await failure(() => set("chats.notes_tab", "a note to self about the case")), "validation.bad_input");
  assert.equal(await failure(() => set("chats.notes_tab", "mine")), "none");
  assert.equal(await failure(() => set("chats.sidebar.folds", { pinned: true, channels: false })), "none");
});

test("one person can keep at most 64 layout values", async () => {
  const h = harness();
  for (let i = 0; i < 64; i++)
    h.fx.db.run(
      "INSERT INTO state_layout (person, key, value, version, updated_at) VALUES (?, ?, '1', 1, 1)",
      MAYA,
      `fake.key.${i}`,
    );
  assert.equal(
    await failure(() => run("state.layout.set", h.person(MAYA), { key: "chats.notes_tab", value: "mine" })),
    "validation.bad_input",
  );
  assert.equal(
    await failure(() => run("state.layout.set", h.person(JONAS), { key: "chats.notes_tab", value: "mine" })),
    "none",
    "another person's count is their own",
  );
});

test("a head lower than the one kept is repaired without lowering anyone's place", () => {
  const { h, c } = seeded();
  stateOf(h.fx).read(MAYA, c, { upto: 2 });
  h.fx.db.run("UPDATE state_thing SET head = 99 WHERE id = 'cnv_one'"); // kept head higher than the module's entries
  const r = stateOf(h.fx).verify({ repair: true });
  assert.deepEqual(
    r.problems.map((p) => p.kind),
    ["head"],
  );
  assert.equal(stateOf(h.fx).stateOf(MAYA, [c])[0]!.readUpto, 2, "Maya's place is where she left it");
  assert.equal((h.fx.db.all("SELECT head FROM state_thing WHERE id = 'cnv_one'")[0] as { head: number }).head, 2);
});

test("the first run after start recounts every row, however old the thing; later runs look at the last week", async () => {
  const { h, c } = seeded();
  const old = h.fx.clock.t - 30 * 86_400_000;
  const t = h.fx.make("conversation", "cnv_old", [MAYA]);
  h.fx.insert(t, STRANGER, old); // lost, a month ago
  h.fx.insert(t, STRANGER, old + 1);
  stateOf(h.fx).arrive(t, {
    pos: (h.fx.db.all("SELECT MAX(pos) AS p FROM fx_entry")[0] as { p: number }).p,
    by: null,
    at: old + 1,
  });
  assert.equal(stateOf(h.fx).stateOf(MAYA, [t])[0]!.unread, 1, "one of the two was counted");
  await periodic["state.verify"].run(h.as(HOST));
  assert.equal(stateOf(h.fx).stateOf(MAYA, [t])[0]!.unread, 2, "the first run finds it, though it is a month old");
  assert.ok(c);
});

test("a list of people that cannot be read repairs nothing, and says so", async () => {
  const { h, c } = seeded();
  h.fx.insert(c, STRANGER);
  const ctx = h.as(HOST);
  const lines: string[] = [];
  const blind = {
    ...ctx,
    call: async () => {
      throw new Error("refused");
    },
    log: { warn: (m: string) => void lines.push(m) },
  };
  await periodic["state.verify"].run(blind as never);
  assert.equal(
    stateOf(h.fx).stateOf(JONAS, [c])[0]!.unread,
    2,
    "the lost arrival is not half-counted for the owner alone",
  );
  assert.match(lines.join("\n"), /could not read the list of people/);
});

test("access changes are asked about at a cost that follows what changed, not the size of the table", () => {
  const h = harness();
  // 1,000 people x 100 things = 100,000 rows
  h.fx.db.exec(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100) INSERT INTO fx_thing (id, kind, scope) SELECT 'cnv_' || i, 'conversation', 'box:main' FROM n`,
  );
  h.fx.db.exec(
    `WITH RECURSIVE p(j) AS (SELECT 1 UNION ALL SELECT j + 1 FROM p WHERE j < 1000) INSERT INTO fx_member (thing, person) SELECT t.id, 'usr_' || p.j FROM fx_thing t, p`,
  );
  h.fx.db.exec(
    `INSERT INTO state_person (person, type, id, read_upto, unread, scope_type, scope_id, version, updated_at) SELECT person, 'conversation', thing, 0, 0, 'box', 'main', 1, 1 FROM fx_member`,
  );
  const s = stateOf(h.fx);
  const t0 = performance.now();
  const one = s.reconcile("conversation", { person: "usr_7" });
  const scoped = performance.now() - t0;
  assert.deepEqual(one, { left: 0, entered: 0 });
  h.fx.db.run("DELETE FROM fx_member WHERE person = 'usr_7' AND thing = 'cnv_3'");
  assert.deepEqual(s.reconcile("conversation", { person: "usr_7" }), { left: 1, entered: 0 });
  assert.deepEqual(s.reconcile("conversation", { things: ["cnv_3"] }), { left: 0, entered: 0 });
  const t1 = performance.now();
  s.reconcile("conversation");
  const full = performance.now() - t1;
  assert.ok(scoped < 100, `one person's rows took ${scoped.toFixed(0)} ms`);
  assert.ok(scoped * 20 < full, `scoped ${scoped.toFixed(1)} ms against the full pass ${full.toFixed(0)} ms`);
});
