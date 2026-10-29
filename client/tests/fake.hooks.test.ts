import test from "node:test";
import assert from "node:assert/strict";
import { createFakeReplicaSet, createScreenHooks, liveQuery, resolveInput, type FakeReplica, type Row } from "../src/index.ts";
import { screensById } from "../../generated/screens.ts";

type Group = { id: string; name: string; members: []; managers: []; builtIn: boolean };
const group = (id: string, name: string): Row & Group => ({ id, name, members: [], managers: [], builtIn: false });

/** access.groups.list reads the "groups" table, filtered by the optional `q` text. */
function withGroups(r: FakeReplica) {
  r.resolve("access.groups.list", (tables, input) => {
    const q = (input.q ?? "").toLowerCase();
    const groups = [...(tables.get("groups")?.values() ?? [])].filter((g) => String(g.name).toLowerCase().includes(q)) as unknown as Group[];
    return { groups };
  });
}

test("a generated live query hook returns seeded rows and updates on a write", () => {
  const replica = createFakeReplicaSet().open("space_a");
  withGroups(replica);
  replica.put("groups", [group("g1", "Partners"), group("g2", "Associates")]);
  const hooks = createScreenHooks(replica, screensById);
  const q = hooks.query("access.groups", "groups");
  const first = q.getSnapshot();
  assert.equal(first.status, "ready");
  assert.deepEqual((first as any).data.groups.map((g: Group) => g.name).sort(), ["Associates", "Partners"]);
  let calls = 0;
  const off = q.subscribe(() => calls++);
  replica.put("groups", [group("g3", "Paralegals")]);
  assert.equal(calls, 1);
  const next = q.getSnapshot() as any;
  assert.deepEqual(next.data.groups.map((g: Group) => g.name).sort(), ["Associates", "Paralegals", "Partners"]);
  replica.remove("groups", ["g1"]);
  assert.equal(calls, 2);
  assert.equal((q.getSnapshot() as any).data.groups.length, 2);
  off();
  replica.put("groups", [group("g4", "Interns")]);
  assert.equal(calls, 2);
});

test("the screen query input comes from /state pointers", () => {
  const replica = createFakeReplicaSet().open("space_a");
  withGroups(replica);
  replica.put("groups", [group("g1", "Partners"), group("g2", "Associates")]);
  const hooks = createScreenHooks(replica, screensById);
  const q = hooks.query("access.groups", "groups", { query: "part" });
  assert.deepEqual((q.getSnapshot() as any).data.groups.map((g: Group) => g.id), ["g1"]);
  assert.deepEqual(resolveInput({ q: "/state/query", kind: "/state/kind" }, { query: "x" }), { q: "x" });
  assert.deepEqual(resolveInput({ taskId: "/route/taskId", limit: "/state/limit", missing: "/route/absent" }, { route: { taskId: "tsk_fixture" }, limit: 20 }), { taskId: "tsk_fixture", limit: 20 });
});

test("the snapshot is the same object until a write, so a UI binding does not re-render", () => {
  const replica = createFakeReplicaSet().open("space_a");
  withGroups(replica);
  const q = liveQuery(replica, "access.groups.list", {});
  assert.equal(q.getSnapshot(), q.getSnapshot());
  const before = q.getSnapshot();
  replica.put("groups", [group("g1", "A")]);
  assert.notEqual(q.getSnapshot(), before);
});

test("a query with no resolver is loading, then ready once the replica can answer", () => {
  const replica = createFakeReplicaSet().open("space_a");
  const q = liveQuery(replica, "access.groups.list", {});
  assert.deepEqual(q.getSnapshot(), { status: "loading" });
  withGroups(replica);
  assert.equal(q.getSnapshot().status, "ready");
});

test("replicas are keyed by spaceId and never share rows", () => {
  const set = createFakeReplicaSet();
  const a = set.open("space_a"), b = set.open("space_b");
  assert.equal(set.open("space_a"), a);
  withGroups(a); withGroups(b);
  a.put("groups", [group("g1", "Only in A")]);
  assert.equal((liveQuery(a, "access.groups.list", {}).getSnapshot() as any).data.groups.length, 1);
  assert.equal((liveQuery(b, "access.groups.list", {}).getSnapshot() as any).data.groups.length, 0);
  assert.deepEqual(set.spaceIds(), ["space_a", "space_b"]);
});

test("rows are copied in and out: mutating a result does not change the replica", () => {
  const replica = createFakeReplicaSet().open("space_a");
  withGroups(replica);
  replica.put("groups", [group("g1", "A")]);
  const snap = liveQuery(replica, "access.groups.list", {}).getSnapshot() as any;
  snap.data.groups[0].name = "changed";
  assert.equal(replica.rows("groups")[0]!.name, "A");
});

test("unknown screens, unknown queries and non-live queries throw", () => {
  const replica = createFakeReplicaSet().open("space_a");
  const hooks = createScreenHooks(replica, screensById);
  assert.throws(() => hooks.query("nope.screen", "x"), /unknown screen/);
  assert.throws(() => hooks.query("access.groups", "nope"), /no query nope/);
  const nonLive = new Map([["s", { ...screensById.get("access.groups")!, id: "s", queries: { q: { cap: "access.groups.list", input: {}, live: false } } }]]);
  assert.throws(() => createScreenHooks(replica, nonLive).query("s", "q"), /not live/);
});
