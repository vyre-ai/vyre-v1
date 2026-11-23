// Cursor writes of the hook runner are coalesced (r38): past-event cursors are stored at most once a second while the server runs and when it stops, a delivered event is still stored at once, and a crash with a
// stale cursor re-reads events but never skips one.
import test from "node:test";
import assert from "node:assert/strict";
import { createHookRunner } from "../src/daemon/consumers.ts";
import type { ModuleHooks } from "../src/daemon/consumers.ts";
import type { Invoke } from "../src/invoke.ts";

const ev = (seq: number, type: string) => ({
  id: `e${seq}`,
  seq,
  type,
  entity: null,
  entity_id: null,
  enc: 0,
  payload: new TextEncoder().encode("{}"),
  actor: "a",
  trace_id: "t".repeat(32),
  at: 1,
  depth: 0,
  run_id: null,
  device: null,
});

function make(db: Map<string, number>, events: ReturnType<typeof ev>[], got: number[], names: string[]) {
  const sqls: string[] = [];
  const hooks: ModuleHooks[] = [
    {
      module: "m",
      periodic: [],
      consumers: names.map((name) => ({
        name,
        module: "m",
        on: name === "m.x" ? ["x"] : ["never"],
        run: async (_c: unknown, e: { seq: number }) => {
          if (name === "m.x") got.push(e.seq);
        },
      })) as never,
    },
  ];
  const holder: { r?: ReturnType<typeof createHookRunner> } = {};
  const invoke = (async (cap: string, input: unknown) => ({
    status: "ok",
    output: await holder.r!.handlers[cap]!({} as never, input as never),
    traceId: "t",
  })) as unknown as Invoke;
  let head = 0;
  holder.r = createHookRunner({
    space: "spc_t",
    now: () => 1,
    invoke,
    emitsOf: () => [],
    capOf: () => undefined,
    warn: () => undefined,
    hooks,
    db: {
      all: (_sql: string, name?: unknown) => (db.has(String(name)) ? [{ seq: db.get(String(name)) }] : []),
      run: (sql: string, ...a: unknown[]) => {
        sqls.push(sql.split(" ")[0]!);
        if (sql.startsWith("INSERT")) db.set(String(a[0]), Number(a[1]));
        return { changes: 1 };
      },
    },
    log: {
      read: async ({ after = 0, limit = 200, types }: { after?: number; limit?: number; types?: string[] }) =>
        events.filter((e) => e.seq > after && (!types || types.includes(e.type))).slice(0, limit) as never,
      currentHead: async () => ({ seq: head }),
    },
  } as never);
  return { r: holder.r, sqls, setHead: (n: number) => (head = n) };
}

test("a hundred consumers moving past a busy head are stored once, in one commit, not after every pass", async () => {
  const names = ["m.x", ...Array.from({ length: 99 }, (_, i) => `m.n${i}`)];
  const db = new Map(names.map((n) => [n, 0] as const));
  const events = [ev(1, "other")];
  const { r, sqls, setHead } = make(db, events, [], names);
  for (let head = 1; head <= 40; head++) {
    events.push(ev(head + 1, "other"));
    setHead(head + 1);
    await r.pump();
  }
  const inserts = sqls.filter((s) => s === "INSERT").length;
  assert.ok(inserts <= 100, `forty passes wrote ${inserts} cursors (one commit of a hundred, not forty of them)`);
  assert.ok(sqls.filter((s) => s === "SAVEPOINT").length <= 1, "one commit for the first store");
  assert.ok(
    [...db.values()].every((v) => v >= 2),
    "the first pass stored every consumer's position",
  );
});

test("a delivered event is stored at once, and a crash with a stale past-event cursor re-reads and skips nothing", async () => {
  const events = [ev(1, "other"), ev(2, "x"), ev(3, "other"), ev(4, "x"), ev(5, "other")];
  const db = new Map([
    ["m.x", 0],
    ["m.none", 0],
  ]);
  const got: number[] = [];
  const a = make(db, events, got, ["m.x", "m.none"]);
  a.setHead(5);
  await a.r.pump();
  assert.deepEqual(got, [2, 4]);
  assert.equal(db.get("m.x"), 5);
  // the process dies with a stale cursor for m.x (stored at its last delivered event, 4): a new process starts from it, hands nothing twice that it stored and misses no later event
  db.set("m.x", 4);
  events.push(ev(6, "x"), ev(7, "other"), ev(8, "x"));
  const got2: number[] = [];
  const b = make(db, events, got2, ["m.x", "m.none"]);
  b.setHead(8);
  await b.r.pump();
  assert.deepEqual(got2, [6, 8], "every event after the stored position is handed over");
});

test("an idle server stores the cursors it held back: they reach the head within about two seconds, with no pass to do it", async () => {
  const names = ["m.x", "m.none"];
  const db = new Map<string, number>(names.map((n) => [n, 0]));
  const events = [ev(1, "other")];
  const { r, setHead } = make(db, events, [], names);
  setHead(1);
  await r.pump(); // the first pass stores the cursors
  assert.equal(db.get("m.none"), 1);
  // events the consumers do not take, a pass a moment later: its write is coalesced (under a second since the last)
  events.push(ev(2, "other"), ev(3, "other"));
  setHead(3);
  await r.pump();
  assert.equal(db.get("m.none"), 1, "the stored cursor is still behind the head: coalesced");
  // nothing more happens; no pass comes
  const end = Date.now() + 2_000;
  while (Date.now() < end && db.get("m.none") !== 3) await new Promise((x) => setTimeout(x, 50));
  assert.equal(db.get("m.none"), 3, "the idle flush stored the cursor at the head");
  assert.equal(db.get("m.x"), 3);
  await r.close();
});

test("the idle flush does not write while a pass is running: the pass stores what it moved, and only then", async () => {
  const events = [ev(1, "other")];
  const db = new Map([
    ["m.x", 0],
    ["m.none", 0],
  ]);
  const inserts: number[] = [];
  const names = ["m.x", "m.none"];
  let release: () => void = () => undefined;
  const slow = new Promise<void>((r) => (release = r));
  let writesAtDelivery = -1;
  const sqls: string[] = [];
  const holder: { r?: ReturnType<typeof createHookRunner> } = {};
  let head = 0;
  const hooks: ModuleHooks[] = [
    {
      module: "m",
      periodic: [],
      consumers: names.map((name) => ({
        name,
        module: "m",
        on: name === "m.x" ? ["x"] : ["never"],
        run: async () => {
          if (name !== "m.x") return;
          await slow; // the pass is busy past the second the idle timer waits
          writesAtDelivery = inserts.length;
        },
      })) as never,
    },
  ];
  const invoke = (async (cap: string, input: unknown) => ({
    status: "ok",
    output: await holder.r!.handlers[cap]!({} as never, input as never),
    traceId: "t",
  })) as unknown as Invoke;
  holder.r = createHookRunner({
    space: "spc_t",
    now: () => 1,
    invoke,
    emitsOf: () => [],
    capOf: () => undefined,
    warn: () => undefined,
    hooks,
    db: {
      all: (_s: string, name?: unknown) => (db.has(String(name)) ? [{ seq: db.get(String(name)) }] : []),
      run: (sql: string, ...a: unknown[]) => {
        sqls.push(sql.split(" ")[0]!);
        if (sql.startsWith("INSERT")) {
          db.set(String(a[0]), Number(a[1]));
          inserts.push(Number(a[1]));
        }
        return { changes: 1 };
      },
    },
    log: {
      read: async ({ after = 0, limit = 200, types }: { after?: number; limit?: number; types?: string[] }) =>
        events.filter((e) => e.seq > after && (!types || types.includes(e.type))).slice(0, limit) as never,
      currentHead: async () => ({ seq: head }),
    },
  } as never);
  const r = holder.r!;
  head = 1;
  await r.pump(); // stores both at 1
  events.push(ev(2, "other"));
  head = 2;
  await r.pump(); // coalesced: the idle timer is armed for a second from now
  assert.equal(db.get("m.none"), 1);
  events.push(ev(3, "x"));
  head = 3;
  const before = inserts.length;
  const pass = r.pump(); // delivers event 3 and waits for `slow`
  await new Promise((x) => setTimeout(x, 1_300)); // the idle timer's second passes while the pass is still on
  assert.equal(inserts.length, before, "nothing was written while the pass was running");
  release();
  await pass;
  assert.equal(writesAtDelivery, before, "the idle timer wrote nothing in the middle of the pass");
  assert.equal(db.get("m.x"), 3, "the pass stored what it delivered");
  await r.close();
});

test("a stop right after a pass stores the held-back cursors, and nothing is written after it", async () => {
  const names = ["m.x", "m.none"];
  const db = new Map<string, number>(names.map((n) => [n, 0]));
  const events = [ev(1, "other")];
  const sqls: string[] = [];
  const { r, setHead } = make(db, events, [], names);
  setHead(1);
  await r.pump();
  events.push(ev(2, "other"), ev(3, "other"));
  setHead(3);
  await r.pump(); // coalesced
  assert.equal(db.get("m.none"), 1, "held back");
  await r.close();
  assert.equal(db.get("m.none"), 3, "the stop stored them");
  assert.equal(db.get("m.x"), 3);
  const snapshot = JSON.stringify([...db]);
  await new Promise((x) => setTimeout(x, 1_300));
  assert.equal(JSON.stringify([...db]), snapshot, "the idle timer was cancelled: nothing is written after the stop");
  void sqls;
});
