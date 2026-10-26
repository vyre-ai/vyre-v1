// Channel management and the channel stream (group b of P-L2_LIVE) against the frozen contract: every capability has a happy path whose input and answer match the schemas and whose
// events are declared and match theirs, and a refusal with a declared error code.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { g24bHandlers } from "../handlers/g24b.ts";
import { post } from "../handlers/post.ts";
import { channelsCreate, start } from "../handlers/thread.ts";
import { DANA, DRAFTER, INTAKE, LEO, MAYA, assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const g = g24bHandlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
const OURS = Object.keys(g24bHandlers);
const mine = registry.capabilities.filter((c) => OURS.includes(c.name));
let n = 0;
const key = () => `g${++n}`;

const make = async (hn: Harness, o: Record<string, unknown> = {}) => {
  hn.advance(1);
  return (await channelsCreate(hn.ctx, { name: "intake", visibility: "public", memberIds: [MAYA], agentIds: [INTAKE], idempotencyKey: key(), ...o } as any)).channel;
};
const fail = async (f: () => unknown): Promise<string> => { try { await f(); } catch (e) { return codeOf(e); } return "none"; };

test("the table holds the fifteen capabilities of group b, all frozen, each example input valid", () => {
  assert.equal(OURS.length, 15);
  assert.equal(mine.length, 15);
  for (const cap of mine) {
    assert.ok(cap.examples.length > 0, cap.name);
    for (const ex of cap.examples) assert.deepEqual(contractErrors(cap.name, "in", ex.input), [], `${cap.name}: example ${ex.name}`);
  }
});

interface Scenario { cap: string; setup?: (hn: Harness) => Promise<any>; input: (c: any, hn: Harness) => Record<string, unknown>; who?: (hn: Harness) => Harness["ctx"]; expect?: string }
const asMaya = (hn: Harness) => hn.person(MAYA);
const scenarios: Scenario[] = [
  { cap: "channels.get", setup: make, input: (c) => ({ channelId: c.channelId }) },
  { cap: "channels.get", input: () => ({ channelId: "chn_none" }), expect: "validation.not_found" },
  { cap: "channels.list", setup: make, input: () => ({ section: "space", limit: 10 }) },
  { cap: "channels.list", input: () => ({ cursor: "abc" }), expect: "validation.bad_input" },
  { cap: "channels.join", setup: make, who: (hn) => hn.person(LEO), input: (c) => ({ channelId: c.channelId }) },
  { cap: "channels.join", setup: (hn) => make(hn, { visibility: "invite" }), who: (hn) => hn.person(LEO), input: (c) => ({ channelId: c.channelId }), expect: "validation.bad_input" },
  { cap: "channels.leave", setup: make, who: asMaya, input: (c) => ({ channelId: c.channelId }) },
  { cap: "channels.leave", input: () => ({ channelId: "chn_none" }), expect: "validation.not_found" },
  { cap: "channels.update", setup: make, input: (c) => ({ channelId: c.channelId, name: "Client intake", topic: "New matters", visibility: "invite" }) },
  { cap: "channels.update", setup: make, input: (c) => ({ channelId: c.channelId }), expect: "validation.bad_input" },
  { cap: "channels.archive", setup: make, input: (c) => ({ channelId: c.channelId }) },
  { cap: "channels.archive", input: () => ({ channelId: "chn_none" }), expect: "validation.not_found" },
  {
    cap: "channels.unarchive", setup: async (hn) => { const c = await make(hn); await g["channels.archive"]!(hn.ctx, { channelId: c.channelId }); return c; },
    input: (c) => ({ channelId: c.channelId }),
  },
  {
    cap: "channels.unarchive", setup: async (hn) => { const c = await make(hn); await g["channels.archive"]!(hn.ctx, { channelId: c.channelId }); await make(hn); return c; },
    input: (c) => ({ channelId: c.channelId }), expect: "validation.bad_input",
  },
  { cap: "channels.members.add", setup: make, input: (c) => ({ channelId: c.channelId, personIds: [LEO], level: "use" }) },
  { cap: "channels.members.add", setup: make, input: (c) => ({ channelId: c.channelId, personIds: [INTAKE] }), expect: "validation.bad_input" },
  { cap: "channels.members.remove", setup: make, input: (c) => ({ channelId: c.channelId, personId: MAYA }) },
  { cap: "channels.members.remove", setup: make, input: (c) => ({ channelId: c.channelId, personId: INTAKE }), expect: "validation.bad_input" },
  { cap: "channels.agents.add", setup: make, input: (c) => ({ channelId: c.channelId, agentId: DRAFTER, mode: "lead" }) },
  { cap: "channels.agents.add", setup: make, input: (c) => ({ channelId: c.channelId, agentId: MAYA }), expect: "validation.bad_input" },
  { cap: "channels.agents.remove", setup: make, input: (c) => ({ channelId: c.channelId, agentId: INTAKE }) },
  { cap: "channels.agents.remove", input: () => ({ channelId: "chn_none", agentId: INTAKE }), expect: "validation.not_found" },
  { cap: "channels.agent_watch.set", setup: make, input: (c) => ({ channelId: c.channelId, agentId: INTAKE, watches: true }) },
  { cap: "channels.agent_watch.set", setup: make, input: (c) => ({ channelId: c.channelId, agentId: DRAFTER, watches: true }), expect: "validation.not_found" },
  { cap: "channels.stream", setup: make, input: (c) => ({ channelId: c.channelId, limit: 20, show: ["runs"] }) },
  { cap: "channels.stream", input: () => ({ channelId: "chn_none" }), expect: "validation.not_found" },
  { cap: "channels.stream_prefs.get", setup: make, input: (c) => ({ channelId: c.channelId }) },
  { cap: "channels.stream_prefs.get", input: () => ({ channelId: "chn_none" }), expect: "validation.not_found" },
  { cap: "channels.stream_prefs.set", setup: make, input: (c) => ({ channelId: c.channelId, hide: ["runs", "people"] }) },
  { cap: "channels.stream_prefs.set", setup: make, input: (c) => ({ channelId: c.channelId, hide: ["pets"] }), expect: "validation.bad_input" },
];

test("every path: input and answer match the schema, errors and events are declared and conform", async () => {
  const covered = new Set<string>();
  for (const s of scenarios) {
    const cap = mine.find((c) => c.name === s.cap)!;
    const hn = harness();
    const state = s.setup ? await s.setup(hn) : undefined;
    hn.clear();
    const input = s.input(state, hn);
    if (s.expect === undefined) assert.deepEqual(contractErrors(s.cap, "in", input), [], `${s.cap}: input`);
    let out: unknown, code: string | null = null;
    try { out = await g[s.cap]!(s.who ? s.who(hn) : hn.ctx, input); } catch (e) { code = codeOf(e); }
    if (s.expect !== undefined) {
      assert.equal(code, s.expect, `${s.cap}: expected ${s.expect}`);
      assert.ok((cap.errors as readonly string[]).includes(s.expect), `${s.cap} does not declare ${s.expect}`);
    } else {
      assert.equal(code, null, `${s.cap} raised ${String(code)}`);
      assert.deepEqual(contractErrors(s.cap, "out", out), [], `${s.cap}: answer`);
      covered.add(s.cap);
    }
    for (const e of hn.emitted) assert.ok((cap.emits as readonly string[]).includes(e.name), `${s.cap} emitted undeclared ${e.name}`);
    assert.deepEqual(assertEventsConform(hn), [], s.cap);
  }
  assert.deepEqual([...covered].sort(), [...OURS].sort());
});

// ---- behaviour ----------------------------------------------------------------------------------------------------------------------------------

test("unread counts what others wrote after my read cursor", async () => {
  const hn = harness();
  const c = await make(hn);
  for (const body of ["one", "two"]) await post(hn.person(MAYA), { threadId: c.mainThreadId, body, idempotencyKey: key() });
  await post(hn.ctx, { threadId: c.mainThreadId, body: "mine", idempotencyKey: key() });
  assert.equal((await g["channels.get"]!(hn.ctx, { channelId: c.channelId })).channel.unread, 2, "my own message is never unread");
  hn.raw.run("INSERT INTO chat_thread_read (thread, principal, seq) VALUES (?, ?, 1)", c.mainThreadId, DANA);
  const list = await g["channels.list"]!(hn.ctx, {});
  assert.equal(list.channels[0].unread, 1);
  assert.equal((await g["channels.get"]!(hn.person(MAYA), { channelId: c.channelId })).channel.unread, 1, "Maya has only Dana's message");
});

test("list: sections, folder, invite channels hidden from non-members, paging", async () => {
  const hn = harness();
  await make(hn, { name: "pub" });
  await make(hn, { name: "team", visibility: "invite", memberIds: [MAYA], folderId: "fld_f1" });
  await make(hn, { name: "solo", visibility: "invite", memberIds: [] });
  const names = async (ctx: Harness["ctx"], i: Record<string, unknown> = {}) => (await g["channels.list"]!(ctx, i)).channels.map((c: any) => c.name);
  assert.deepEqual(await names(hn.ctx), ["pub", "team", "solo"]);
  assert.deepEqual(await names(hn.ctx, { section: "space" }), ["pub"]);
  assert.deepEqual(await names(hn.ctx, { section: "shared" }), ["team"]);
  assert.deepEqual(await names(hn.ctx, { section: "personal" }), ["solo"]);
  assert.deepEqual(await names(hn.ctx, { folderId: "fld_f1" }), ["team"]);
  assert.deepEqual(await names(hn.person(LEO)), ["pub"], "Leo sees the public one only");
  assert.deepEqual(await names(hn.person(MAYA)), ["pub", "team"]);
  const p1 = await g["channels.list"]!(hn.ctx, { limit: 2 });
  assert.equal(p1.total, 3);
  assert.equal(p1.next, "2");
  assert.deepEqual((await g["channels.list"]!(hn.ctx, { limit: 2, cursor: p1.next })).channels.map((c: any) => c.name), ["solo"]);
});

test("join and leave: public only, repeats are quiet, an archived channel takes no joiners", async () => {
  const hn = harness();
  const c = await make(hn);
  const leo = hn.person(LEO);
  hn.clear();
  const j = await g["channels.join"]!(leo, { channelId: c.channelId });
  assert.ok(j.channel.members.some((m: any) => m.id === LEO));
  await g["channels.join"]!(leo, { channelId: c.channelId });
  assert.deepEqual(hn.named("channel.member_added").map((e) => e.payload["personId"]), [LEO]);
  assert.deepEqual(await g["channels.leave"]!(leo, { channelId: c.channelId }), { ok: true });
  assert.deepEqual(await g["channels.leave"]!(leo, { channelId: c.channelId }), { ok: true });
  assert.equal(hn.named("channel.member_removed").length, 1);
  await g["channels.join"]!(leo, { channelId: c.channelId });
  await g["channels.archive"]!(hn.ctx, { channelId: c.channelId });
  assert.equal(await fail(() => g["channels.join"]!(hn.person("usr_zed"), { channelId: c.channelId })), "validation.bad_input");
  assert.equal(await fail(() => g["channels.join"]!(hn.agent(INTAKE, DANA), { channelId: "chn_none" })), "validation.not_found");
});

test("update: renames the main thread, keeps names unique, clears a topic, reports only real changes", async () => {
  const hn = harness();
  const c = await make(hn, { topic: "old" });
  await make(hn, { name: "Other" });
  hn.clear();
  assert.equal(await fail(() => g["channels.update"]!(hn.ctx, { channelId: c.channelId, name: "other" })), "validation.bad_input");
  assert.equal(await fail(() => g["channels.update"]!(hn.ctx, { channelId: c.channelId, name: "  " })), "validation.bad_input");
  assert.equal(await fail(() => g["channels.update"]!(hn.ctx, { channelId: c.channelId, topic: "t".repeat(251) })), "validation.bad_input");
  const out = (await g["channels.update"]!(hn.ctx, { channelId: c.channelId, name: "#Renamed", topic: "" })).channel;
  assert.equal(out.name, "Renamed");
  assert.equal("topic" in out, false);
  assert.equal(hn.rows("SELECT title FROM chat_thread WHERE id = ?", c.mainThreadId)[0]!["title"], "Renamed");
  assert.deepEqual(hn.named("channel.updated")[0]!.payload, { channelId: c.channelId, fields: ["name", "topic"] });
  hn.clear();
  await g["channels.update"]!(hn.ctx, { channelId: c.channelId, name: "Renamed", visibility: "public" });
  assert.deepEqual(hn.emitted, [], "nothing changed, nothing said");
});

test("archive and unarchive: an archived channel takes no changes; its record channel returns only if the record is free", async () => {
  const hn = harness();
  const c = await make(hn, { recordId: "rec_p1" });
  await g["channels.archive"]!(hn.ctx, { channelId: c.channelId });
  await g["channels.archive"]!(hn.ctx, { channelId: c.channelId });
  assert.equal(hn.named("channel.archived").length, 1);
  assert.equal(await fail(() => g["channels.update"]!(hn.ctx, { channelId: c.channelId, topic: "x" })), "validation.bad_input");
  assert.equal(await fail(() => g["channels.members.add"]!(hn.ctx, { channelId: c.channelId, personIds: [LEO] })), "validation.bad_input");
  assert.equal(await fail(() => g["channels.agents.add"]!(hn.ctx, { channelId: c.channelId, agentId: DRAFTER })), "validation.bad_input");
  await make(hn, { name: "second", recordId: "rec_p1" });
  assert.equal(await fail(() => g["channels.unarchive"]!(hn.ctx, { channelId: c.channelId })), "validation.bad_input");
});

test("members and agents: additions are idempotent, removals leave the thread's other rows alone", async () => {
  const hn = harness();
  const c = await make(hn);
  hn.clear();
  const added = (await g["channels.members.add"]!(hn.ctx, { channelId: c.channelId, personIds: [LEO, MAYA, LEO] })).channel;
  assert.deepEqual(added.members.map((m: any) => m.id), [DANA, MAYA, LEO]);
  assert.deepEqual(hn.named("channel.member_added").map((e) => e.payload["personId"]), [LEO], "Maya was already in");
  const removed = (await g["channels.members.remove"]!(hn.ctx, { channelId: c.channelId, personId: MAYA })).channel;
  assert.deepEqual(removed.members.map((m: any) => m.id), [DANA, LEO]);
  await g["channels.members.remove"]!(hn.ctx, { channelId: c.channelId, personId: MAYA });
  assert.equal(hn.named("channel.member_removed").length, 1);

  hn.clear();
  const a = (await g["channels.agents.add"]!(hn.ctx, { channelId: c.channelId, agentId: DRAFTER })).channel;
  assert.deepEqual(a.agents.map((x: any) => [x.agentId, x.mode]), [[INTAKE, "listen"], [DRAFTER, "listen"]], "agents listen by default");
  await g["channels.agents.add"]!(hn.ctx, { channelId: c.channelId, agentId: DRAFTER });
  assert.deepEqual(hn.names(), ["channel.agent_added", "agent.engaged"]);
  assert.deepEqual(hn.named("agent.engaged")[0]!.payload, { threadId: c.mainThreadId, agentId: DRAFTER, mode: "listen", by: DANA });
  const r = (await g["channels.agents.remove"]!(hn.ctx, { channelId: c.channelId, agentId: INTAKE })).channel;
  assert.deepEqual(r.agents.map((x: any) => x.agentId), [DRAFTER]);
  assert.deepEqual(hn.names().slice(2), ["channel.agent_removed", "agent.disengaged"]);
  assert.deepEqual(assertEventsConform(hn), []);
});

test("agent watching: set, shown on the channel, logged once per change", async () => {
  const hn = harness();
  const c = await make(hn);
  hn.clear();
  const on = (await g["channels.agent_watch.set"]!(hn.ctx, { channelId: c.channelId, agentId: INTAKE, watches: true })).channel;
  assert.equal(on.agents[0].watches, true);
  await g["channels.agent_watch.set"]!(hn.ctx, { channelId: c.channelId, agentId: INTAKE, watches: true });
  const off = (await g["channels.agent_watch.set"]!(hn.ctx, { channelId: c.channelId, agentId: INTAKE, watches: false })).channel;
  assert.notEqual(off.agents[0].watches, true);
  assert.deepEqual(hn.named("channel.agent_watch_changed").map((e) => e.payload["watches"]), [true, false]);
  assert.equal(hn.named("channel.agent_watch_changed")[0]!.payload["by"], DANA);
});

test("stream prefs are mine alone, in canonical order; the stream hides what I hid unless asked to show it", async () => {
  const hn = harness();
  const c = await make(hn);
  assert.deepEqual(await g["channels.stream_prefs.get"]!(hn.ctx, { channelId: c.channelId }), { hide: [] });
  assert.deepEqual(await g["channels.stream_prefs.set"]!(hn.ctx, { channelId: c.channelId, hide: ["runs", "people", "runs"] }), { hide: ["people", "runs"] });
  assert.deepEqual(await g["channels.stream_prefs.get"]!(hn.person(MAYA), { channelId: c.channelId }), { hide: [] });
  await post(hn.ctx, { threadId: c.mainThreadId, body: "hello", idempotencyKey: key() });
  const s = await g["channels.stream"]!(hn.ctx, { channelId: c.channelId });
  assert.deepEqual(s.items, []);
  assert.deepEqual(s.hidden, ["people", "runs"]);
  assert.deepEqual(s.counts, { people: 2, agents: 1, runs: 0 });
  const shown = await g["channels.stream"]!(hn.ctx, { channelId: c.channelId, show: ["people"] });
  assert.equal(shown.items.length, 1);
  assert.deepEqual(shown.hidden, ["runs"]);
  assert.deepEqual(await g["channels.stream_prefs.set"]!(hn.ctx, { channelId: c.channelId, hide: [] }), { hide: [] });
});

test("stream: messages in order, repeated runs of one flow collapse, expand opens them, limit and before page", async () => {
  const hn = harness();
  const c = await make(hn, { recordId: "rec_p1" });
  const run = async (id: string, title: string) => { hn.advance(10); await start(hn.ctx, { kind: "chat", agentIds: [INTAKE], scopeType: "run", scopeId: id, recordId: "rec_p1", title }); };
  hn.advance(10); await post(hn.ctx, { threadId: c.mainThreadId, body: "before", idempotencyKey: key() });
  await run("run_a1", "Nightly sync"); await run("run_a2", "Nightly sync"); await run("run_a3", "Nightly sync");
  hn.advance(10); await post(hn.person(MAYA), { threadId: c.mainThreadId, body: "after", idempotencyKey: key() });
  await run("run_b1", "Weekly report");
  hn.raw.run("UPDATE chat_thread SET closedAt = createdAt + 5 WHERE scopeId = 'run_b1'");

  const s = await g["channels.stream"]!(hn.ctx, { channelId: c.channelId });
  assert.deepEqual(contractErrors("channels.stream", "out", s), []);
  assert.deepEqual(s.items.map((i: any) => i.kind), ["message", "run_group", "message", "run"]);
  const grp = s.items[1];
  assert.equal(grp.count, 3);
  assert.deepEqual(grp.runIds, ["run_a1", "run_a2", "run_a3"]);
  assert.equal(grp.name, "Nightly sync");
  assert.equal(s.items[3].runId, "run_b1");
  assert.equal(s.items[3].durationMs, 5);
  assert.deepEqual(s.counts, { people: 2, agents: 1, runs: 4 });
  assert.equal(s.items[2].authorKind, "person");

  const open = await g["channels.stream"]!(hn.ctx, { channelId: c.channelId, expand: [grp.groupKey] });
  assert.deepEqual(open.items.map((i: any) => i.kind), ["message", "run", "run", "run", "message", "run"]);
  const last2 = await g["channels.stream"]!(hn.ctx, { channelId: c.channelId, limit: 2 });
  assert.deepEqual(last2.items.map((i: any) => i.kind), ["message", "run"]);
  assert.equal(last2.hasMore, true);
  const older = await g["channels.stream"]!(hn.ctx, { channelId: c.channelId, before: s.items[2].at });
  assert.deepEqual(older.items.map((i: any) => i.kind), ["message", "run_group"]);
  assert.equal(older.hasMore, false);
});
