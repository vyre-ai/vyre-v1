// @tsx
// An optimistic change (contract P3, useChange): `patch` shows a changed answer for a watched read at once and hands back the way to undo it. The next real answer replaces the patch either way.
import test from "node:test";
import assert from "node:assert/strict";
import { createRemoteScreenHooks } from "./remote-hooks.ts";

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

async function watching(answer: () => unknown) {
  const hooks = createRemoteScreenHooks({ screens: new Map(), read: async () => answer() });
  const q = hooks.capQuery<{ on: boolean }>("things.get", { id: "t1" });
  let heard = 0;
  q.subscribe(() => heard++);
  await settle();
  return { hooks, q, heard: () => heard };
}

test("a patch changes the watched answer at once and undo puts the old one back", async () => {
  const { hooks, q, heard } = await watching(() => ({ on: false }));
  assert.deepEqual(q.getSnapshot(), { status: "ready", data: { on: false } });
  const before = heard();
  const undo = hooks.patch("things.get", { id: "t1" }, (d) => ({ ...(d as object), on: true }));
  assert.deepEqual(q.getSnapshot(), { status: "ready", data: { on: true } });
  assert.equal(heard(), before + 1, "whoever watches hears it");
  undo();
  assert.deepEqual(q.getSnapshot(), { status: "ready", data: { on: false } });
  assert.equal(heard(), before + 2);
});

test("the next real answer replaces a patch, even one equal to what the server held before", async () => {
  const { hooks, q } = await watching(() => ({ on: false }));
  hooks.patch("things.get", { id: "t1" }, () => ({ on: true }));
  hooks.invalidate();
  await settle();
  assert.deepEqual(q.getSnapshot(), { status: "ready", data: { on: false } }, "the server said false: the patch goes");
});

test("undo after a real answer has replaced the patch changes nothing, and a read nobody watches is not patched", async () => {
  const { hooks, q } = await watching(() => ({ on: false }));
  const undo = hooks.patch("things.get", { id: "t1" }, () => ({ on: true }));
  hooks.invalidate();
  await settle();
  undo();
  assert.deepEqual(q.getSnapshot(), { status: "ready", data: { on: false } });
  const nothing = hooks.patch("things.other", {}, () => ({ on: true }));
  assert.equal(typeof nothing, "function");
  nothing();
});

test("two quick patches that both fail put the original back, whichever fails first", async () => {
  for (const order of [
    [0, 1],
    [1, 0],
  ] as const) {
    const { hooks, q } = await watching(() => ({ on: false, n: 0 }));
    const undo = [
      hooks.patch("things.get", { id: "t1" }, (d) => ({ ...(d as object), on: true })),
      hooks.patch("things.get", { id: "t1" }, (d) => ({ ...(d as object), n: 1 })),
    ];
    assert.deepEqual(q.getSnapshot(), { status: "ready", data: { on: true, n: 1 } }, "both are shown");
    undo[order[0]]!();
    undo[order[1]]!();
    assert.deepEqual(q.getSnapshot(), { status: "ready", data: { on: false, n: 0 } }, `undone in order ${order}`);
  }
});

test("a patch that fails while another succeeds keeps only the one that stands", async () => {
  const { hooks, q } = await watching(() => ({ on: false, n: 0 }));
  const a = hooks.patch("things.get", { id: "t1" }, (d) => ({ ...(d as object), on: true }));
  hooks.patch("things.get", { id: "t1" }, (d) => ({ ...(d as object), n: 1 }));
  a();
  assert.deepEqual(q.getSnapshot(), { status: "ready", data: { on: false, n: 1 } });
});

test("a read that has not answered, or failed, is not patched and undo does nothing", async () => {
  const hooks = createRemoteScreenHooks({
    screens: new Map(),
    read: async () => {
      throw new Error("no answer");
    },
  });
  const q = hooks.capQuery("things.get", { id: "t1" });
  q.subscribe(() => undefined);
  const early = hooks.patch("things.get", { id: "t1" }, () => ({ on: true }));
  assert.equal(q.getSnapshot().status, "loading", "still loading: not patched");
  await settle();
  assert.equal(q.getSnapshot().status, "loading");
  assert.ok((q.getSnapshot() as { error?: unknown }).error, "failed");
  const late = hooks.patch("things.get", { id: "t1" }, () => ({ on: true }));
  assert.ok((q.getSnapshot() as { error?: unknown }).error, "a failed read is not turned into an answer by a patch");
  early();
  late();
});

test("an undo from before a real answer does not take back a change made after it", async () => {
  const { hooks, q } = await watching(() => ({ on: false, n: 0 }));
  const old = hooks.patch("things.get", { id: "t1" }, (d) => ({ ...(d as object), on: true }));
  hooks.invalidate();
  await settle();
  hooks.patch("things.get", { id: "t1" }, (d) => ({ ...(d as object), n: 1 }));
  old();
  assert.deepEqual(
    q.getSnapshot(),
    { status: "ready", data: { on: false, n: 1 } },
    "only the newer change is on screen",
  );
});

test("a real answer clears every change shown before it: a later change starts from the real answer", async () => {
  const { hooks, q } = await watching(() => ({ on: false, n: 0 }));
  hooks.patch("things.get", { id: "t1" }, (d) => ({ ...(d as object), on: true }));
  hooks.invalidate();
  await settle();
  const later = hooks.patch("things.get", { id: "t1" }, (d) => ({ ...(d as object), n: 1 }));
  later();
  assert.deepEqual(q.getSnapshot(), { status: "ready", data: { on: false, n: 0 } }, "the old change did not come back");
});

test("a failed re-read keeps the very same snapshot and says so on the side; the next good answer clears it", async () => {
  let fail = false;
  const hooks = createRemoteScreenHooks({
    screens: new Map(),
    staleMinMs: 0,
    read: async () => {
      if (fail) throw Object.assign(new Error("down"), { code: "internal.error" });
      return { on: false };
    },
  });
  const q = hooks.capQuery<{ on: boolean }>("things.get", { id: "t1" });
  const side = (
    q as unknown as { stale: { subscribe(l: () => void): () => void; getSnapshot(): { message: string } | null } }
  ).stale;
  let heard = 0;
  q.subscribe(() => undefined);
  side.subscribe(() => heard++);
  await settle();
  const good = q.getSnapshot();
  assert.equal(side.getSnapshot(), null);
  fail = true;
  hooks.invalidate();
  await settle();
  assert.equal(q.getSnapshot(), good, "the answer is the same object: nothing that reads it re-renders or re-reads");
  assert.equal(side.getSnapshot()?.message, "down");
  assert.equal(heard, 1);
  hooks.invalidate();
  await settle();
  assert.equal(heard, 1, "the same failure again is not a change");
  fail = false;
  hooks.invalidate();
  await settle();
  assert.equal(side.getSnapshot(), null);
});

// 14 Nov 2026 review (fifth look): on a flaky link the note flapped on, off, on; a failure whose text changes each poll re-notified every time.
function flaky(script: (n: number) => "ok" | { message: string }) {
  let n = 0;
  const hooks = createRemoteScreenHooks({
    screens: new Map(),
    staleMinMs: 60,
    read: async () => {
      const r = script(n++);
      if (r === "ok") return { on: false };
      throw Object.assign(new Error(r.message), { code: "provider.unavailable" });
    },
  });
  const q = hooks.capQuery<{ on: boolean }>("things.get", { id: "t1" });
  const side = (
    q as unknown as { stale: { subscribe(l: () => void): () => void; getSnapshot(): { message: string } | null } }
  ).stale;
  q.subscribe(() => undefined);
  const heard: (string | null)[] = [];
  side.subscribe(() => heard.push(side.getSnapshot()?.message ?? null));
  return { hooks, side, heard };
}

test("alternating failed and good polls keep the note up: it clears only after a good answer has held for the minimum time", async () => {
  const f = flaky((n) => (n === 0 ? "ok" : n % 2 === 1 ? { message: `down ${n}` } : "ok"));
  await settle();
  f.hooks.invalidate();
  await settle();
  assert.ok(f.side.getSnapshot(), "failed once: the note is up");
  f.hooks.invalidate();
  await settle(); // good answer, inside the minimum time
  assert.ok(f.side.getSnapshot(), "a good answer straight after does not clear it");
  f.hooks.invalidate();
  await settle(); // fails again
  f.hooks.invalidate();
  await settle(); // good again
  assert.ok(f.side.getSnapshot(), "still up across the flapping");
  assert.equal(f.heard.filter((m) => m === null).length, 0, "it never went off and on");
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(f.side.getSnapshot(), null, "cleared once a good answer has held the minimum time");
});

test("a failure whose text changes every poll notifies once: it is compared by code", async () => {
  const f = flaky((n) => (n === 0 ? "ok" : { message: `Timed out after ${1000 + n} ms` }));
  await settle();
  for (let i = 0; i < 4; i++) {
    f.hooks.invalidate();
    await settle();
  }
  assert.equal(f.heard.length, 1);
});
