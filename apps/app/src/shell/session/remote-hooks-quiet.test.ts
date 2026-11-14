// @tsx
// A busy Space changes again and again. The sidebar read (chats.sidebar) is read at most once a second for those changes; the person's own action is read at once; idle costs nothing.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createRemoteScreenHooks } from "./remote-hooks.ts";

const micro = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

async function minute(quiet: Record<string, number> | undefined, changesPerSecond: number): Promise<number> {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let t = 0;
    let reads = 0;
    const hooks = createRemoteScreenHooks({
      screens: new Map(),
      read: async () => ({ n: ++reads }),
      now: () => t,
      ...(quiet ? { quietMs: quiet } : {}),
    });
    const q = hooks.capQuery<{ n: number }>("chats.sidebar", {});
    q.subscribe(() => undefined);
    await micro();
    const step = Math.round(1000 / Math.max(changesPerSecond, 1));
    if (changesPerSecond > 0)
      for (let at = 0; at < 60_000; at += step) {
        t += step;
        mock.timers.tick(step);
        hooks.invalidate(); // a change in the Space (the session coalesces these to one per 120 ms)
        await micro();
      }
    else {
      t += 60_000;
      mock.timers.tick(60_000);
      await micro();
    }
    hooks.close();
    return reads;
  } finally {
    mock.timers.reset();
  }
}

test("reads per minute of chats.sidebar: idle, and busy at the session's fastest (one change every 120 ms), before and after", async (c) => {
  const idleBefore = await minute(undefined, 0);
  const idleAfter = await minute({ "chats.sidebar": 1000 }, 0);
  const busyBefore = await minute(undefined, 8);
  const busyAfter = await minute({ "chats.sidebar": 1000 }, 8);
  c.diagnostic(
    `reads/minute  idle before ${idleBefore}, after ${idleAfter}; busy before ${busyBefore}, after ${busyAfter}`,
  );
  assert.equal(idleBefore, 1, "idle: the first read only");
  assert.equal(idleAfter, 1);
  assert.ok(busyBefore >= 400, `before: about one read per change (${busyBefore})`);
  assert.ok(busyAfter <= 62, `after: at most one read a second (${busyAfter})`);
});

test("a held re-read is read once when the time is up, and the last answer is the one shown", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let t = 0;
    let n = 0;
    const hooks = createRemoteScreenHooks({
      screens: new Map(),
      read: async () => ({ n: ++n }),
      now: () => t,
      quietMs: { "chats.sidebar": 1000 },
    });
    const q = hooks.capQuery<{ n: number }>("chats.sidebar", {});
    q.subscribe(() => undefined);
    await micro();
    t += 100;
    mock.timers.tick(100);
    hooks.invalidate();
    hooks.invalidate();
    hooks.invalidate();
    await micro();
    assert.equal(n, 1, "held: nothing read yet");
    t += 900;
    mock.timers.tick(900);
    await micro();
    assert.equal(n, 2, "one read for the three changes");
    assert.deepEqual(q.getSnapshot(), { status: "ready", data: { n: 2 } });
    hooks.close();
  } finally {
    mock.timers.reset();
  }
});

test("the person's own action is read at once, and drops the held read", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let t = 0;
    let n = 0;
    const hooks = createRemoteScreenHooks({
      screens: new Map(),
      read: async () => ({ n: ++n }),
      now: () => t,
      quietMs: { "chats.sidebar": 1000 },
    });
    hooks.capQuery<{ n: number }>("chats.sidebar", {}).subscribe(() => undefined);
    await micro();
    t += 100;
    mock.timers.tick(100);
    hooks.invalidate();
    hooks.invalidate({ now: true });
    await micro();
    assert.equal(n, 2, "read at once");
    t += 1000;
    mock.timers.tick(1000);
    await micro();
    assert.equal(n, 2, "and the held one is gone");
    hooks.close();
  } finally {
    mock.timers.reset();
  }
});

test("other reads are not held", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let n = 0;
    const hooks = createRemoteScreenHooks({
      screens: new Map(),
      read: async () => ({ n: ++n }),
      now: () => 0,
      quietMs: { "chats.sidebar": 1000 },
    });
    hooks.capQuery<{ n: number }>("things.get", {}).subscribe(() => undefined);
    await micro();
    hooks.invalidate();
    await micro();
    assert.equal(n, 2);
    hooks.close();
  } finally {
    mock.timers.reset();
  }
});
