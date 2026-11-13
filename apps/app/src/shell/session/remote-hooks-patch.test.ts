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
  assert.deepEqual(q.getSnapshot(), { status: "ready", data: { on: false, n: 1 } }, "only the newer change is on screen");
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
