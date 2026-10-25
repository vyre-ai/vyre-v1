// Live queries over the local replica (ARCH 9): a write invalidates only the queries that read what it changed, every key carries the spaceId, one feed subscription serves everything,
// and hover/focus prefetch warms a screen before it opens.
import test from "node:test";
import assert from "node:assert/strict";
import { formatHlc } from "../../../lib/hlc.ts";
import { createNodeDriver, openReplica } from "../../../sync/src/replica/index.ts";
import { manualScheduler } from "../connection/scheduler.ts";
import { asQuery, createPrefetcher, createQueryClient, createQueryClients, queryKey } from "./index.ts";
import type { QueryDef } from "./index.ts";
import { createChangeFeed, createSpaceStore, observeReplica } from "../store/index.ts";
import { screensById } from "../../../generated/screens.ts";

const hlc = (ms: number): string => formatHlc({ ms, counter: 1, deviceId: "dev1" });

function realStore(spaceId: string) {
  const driver = createNodeDriver();
  const replica = openReplica({ driver, deviceClass: "desktop", registryHash: "h", clock: () => 1_700_000_000_000 });
  const changes = createChangeFeed();
  const store = createSpaceStore(spaceId, driver, changes);
  const observed = observeReplica(replica, changes);
  let n = 0;
  const put = (entity: string, id: string, fields: Record<string, string>): void => {
    observed.write({ entity, id, fields, hlc: hlc(1_000 + ++n), actor: "usr_ada", origin: "local" });
  };
  return { store, observed, put, changes, driver };
}

const events: QueryDef<{ q?: string }, string[]> = {
  cap: "calendar.events.list", entities: ["calendar_event"],
  run: (db, i) => db.all("SELECT title FROM calendar_event WHERE title LIKE ? ORDER BY id", [`%${i.q ?? ""}%`]).map((r) => String(r["title"])),
};
const lists: QueryDef<Record<string, never>, string[]> = {
  cap: "calendar.lists.list", entities: ["calendar"],
  run: (db) => db.all("SELECT title FROM calendar_list ORDER BY id", []).map((r) => String(r["title"])),
};

test("a write invalidates only the queries that read what changed", () => {
  const { store, put } = realStore("spc_a");
  const client = createQueryClient(store);
  const ev = client.query(events, {});
  const li = client.query(lists, {});
  let evCalls = 0, liCalls = 0;
  ev.subscribe(() => evCalls++);
  li.subscribe(() => liCalls++);
  const evSnap = ev.getSnapshot();
  const liSnap = li.getSnapshot();
  assert.equal(client.stats().runs, 2);

  put("calendar_event", "cev_1", { title: "Standup" });
  assert.equal(evCalls, 1);
  assert.equal(liCalls, 0, "the lists query never heard about an event");
  assert.equal(li.getSnapshot(), liSnap, "an untouched query keeps its snapshot object");
  assert.notEqual(ev.getSnapshot(), evSnap);
  assert.deepEqual(ev.getSnapshot(), { status: "ready", data: ["Standup"] });
  assert.equal(client.stats().runs, 3, "only the affected query ran again");

  assert.equal(ev.getSnapshot(), ev.getSnapshot(), "no write, same object");
  put("calendar", "cld_1", { title: "Work" });
  assert.equal(liCalls, 1);
  assert.equal(evCalls, 1);
  assert.deepEqual(li.getSnapshot(), { status: "ready", data: ["Work"] });
});

test("affects() lets a query skip changes that cannot alter its result", () => {
  const { store, put } = realStore("spc_a");
  const client = createQueryClient(store);
  const one: QueryDef<{ id: string }, number> = { cap: "calendar.event.count", entities: ["calendar_event"], run: (db) => db.all("SELECT count(*) AS n FROM calendar_event", []).length, affects: (c, i) => c.id === i.id };
  const q = client.query(one, { id: "cev_7" });
  let calls = 0;
  q.subscribe(() => calls++);
  q.getSnapshot();
  put("calendar_event", "cev_1", { title: "x" });
  assert.equal(calls, 0);
  put("calendar_event", "cev_7", { title: "y" });
  assert.equal(calls, 1);
});

test("every query key carries the spaceId and Spaces never share entries", () => {
  assert.throws(() => queryKey("", "a.b", {}), /spaceId/);
  assert.equal(queryKey("spc_a", "x.y", { b: 1, a: 2 }), queryKey("spc_a", "x.y", { a: 2, b: 1 }), "input order does not matter");
  assert.notEqual(queryKey("spc_a", "x.y", {}), queryKey("spc_b", "x.y", {}));
  assert.ok(queryKey("spc_a", "x.y", {}).startsWith("spc_a"));

  const a = realStore("spc_a");
  const b = realStore("spc_b");
  a.put("calendar_event", "cev_1", { title: "Only in A" });
  const clients = createQueryClients((id) => (id === "spc_a" ? a.store : b.store));
  const qa = clients.forSpace("spc_a").query(events, {});
  const qb = clients.forSpace("spc_b").query(events, {});
  assert.deepEqual(qa.getSnapshot(), { status: "ready", data: ["Only in A"] });
  assert.deepEqual(qb.getSnapshot(), { status: "ready", data: [] }, "same cap and input, other Space: nothing of A");
  assert.equal(clients.forSpace("spc_a").has(events.cap, {}), true);
  assert.equal(clients.forSpace("spc_b").spaceId, "spc_b");

  let heard = 0;
  qa.subscribe(() => heard++);
  clients.drop("spc_a");
  a.put("calendar_event", "cev_2", { title: "after switch" });
  assert.equal(heard, 0, "a dropped Space no longer listens");
  assert.deepEqual(clients.spaceIds(), ["spc_b"]);
});

test("one feed subscription serves every query, whatever their number", () => {
  const { store, put, changes } = realStore("spc_a");
  const client = createQueryClient(store);
  for (let i = 0; i < 100; i++) client.query(events, { q: `t${i}` }).subscribe(() => {});
  assert.equal(changes.listeners(), 1);
  put("calendar_event", "cev_1", { title: "t5 here" });
  assert.equal(client.stats().feedListeners, 1);
  client.close();
  assert.equal(changes.listeners(), 0);
});

test("hide, keep and batched writes reach the feed; a rejected write does not", () => {
  const { store, observed, put, changes } = realStore("spc_a");
  const client = createQueryClient(store);
  const q = client.query(events, {});
  let calls = 0;
  q.subscribe(() => calls++);
  q.getSnapshot();
  changes.batch(() => { put("calendar_event", "cev_1", { title: "a" }); put("calendar_event", "cev_2", { title: "b" }); });
  assert.equal(calls, 1, "a batch is one notification");
  assert.deepEqual(q.getSnapshot(), { status: "ready", data: ["a", "b"] });
  observed.hide("calendar_event", "cev_1", 9);
  assert.equal(calls, 2);
  assert.deepEqual(q.getSnapshot(), { status: "ready", data: ["b"] });
  const rejected = observed.write({ entity: "calendar_event", id: "cev_1", fields: { title: "late" }, hlc: hlc(5_000), actor: "usr_ada", origin: "mirror", seq: 3 });
  assert.deepEqual([rejected.applied, rejected.reason], [false, "hidden"]);
  assert.equal(calls, 2);
});

test("hover prefetches after 50 ms, leave cancels, focus is immediate, open reports the hit", () => {
  const { store, put } = realStore("spc_a");
  put("calendar_event", "cev_1", { title: "Standup" });
  const client = createQueryClient(store);
  const sched = manualScheduler();
  const screenId = [...screensById.values()].find((s) => Object.values(s.queries).some((q) => q.live))?.id ?? "";
  assert.ok(screenId, "the generated index has a screen with a live query");
  const screen = screensById.get(screenId)!;
  const caps = Object.values(screen.queries).filter((q) => q.live).map((q) => q.cap);
  const defs = new Map(caps.map((cap) => [cap, asQuery<unknown, string[]>({ cap, entities: ["calendar_event"], run: (db) => db.all("SELECT title FROM calendar_event", []).map((r) => String(r["title"])) })]));
  const chunks: string[] = [];
  const p = createPrefetcher({ client, screens: screensById, defs, scheduler: sched, chunk: (s) => chunks.push(s), clock: () => sched.now() });

  p.hover(screenId);
  sched.advance(49);
  assert.equal(client.stats().entries, 0, "not before 50 ms");
  sched.advance(1);
  assert.equal(client.stats().entries > 0, true);
  assert.deepEqual(chunks, [screenId], "the screen's component chunk is fetched with its data");
  const first = p.open(screenId);
  assert.equal(first.prefetched, true);
  assert.equal(first.served, caps.length);

  const other = p.open(screenId, { q: "different args" });
  assert.equal(other.prefetched, false, "other args were never warmed");

  p.hover(screenId, { q: "x" });
  sched.advance(20);
  p.leave(screenId, { q: "x" });
  sched.advance(100);
  assert.equal(p.open(screenId, { q: "x" }).prefetched, false, "leaving cancelled the timer");

  p.focus(screenId, { q: "y" });
  assert.equal(p.open(screenId, { q: "y" }).prefetched, true, "focus warms at once");
  assert.deepEqual(p.stats(), { opens: 4, hits: 2, hitRate: 0.5 });
  assert.throws(() => p.open("no.such.screen"), /unknown screen/);
});
