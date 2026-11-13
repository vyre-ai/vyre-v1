// useChange (contract P3): the hook for a change. One call at a time (a different call waits its turn, the same call again while it runs is ignored, at most 20 wait), one idempotency key per
// logical call, a plain note that keeps a failure while later calls succeed, and for the few safe writes (switches, stars, read marks, order) an optimistic patch of the watched answer that is
// undone when the call fails.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { installDom } from "../../../../ui/src/testing/dom.ts";
import type { ScreenHooks } from "../../../../client/src/index.ts";
import { CapCallProvider } from "./call.tsx";
import type { CapCall } from "./call.tsx";
import { ScreensProvider } from "./screens.tsx";
import { MAX_WAITING_CHANGES, useChange } from "./useChange.ts";
import type { Change, ChangeOptions } from "./useChange.ts";

const gate = <T,>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};

function setup(
  call: CapCall,
  opts: ChangeOptions = {},
  patches: { undone: number; applied: unknown[] } = { undone: 0, applied: [] },
) {
  const hooks = {
    patch: (cap: string, input: unknown, apply: (d: unknown) => unknown) => {
      patches.applied.push([cap, input, apply({ on: false })]);
      return () => void patches.undone++;
    },
  } as unknown as ScreenHooks;
  let last!: Change;
  const Probe = (): null => ((last = useChange("things.set", opts)), null);
  const tree = createRoot();
  const ready = act(async () =>
    tree.render(
      <ScreensProvider screens={hooks}>
        <CapCallProvider call={call}>
          <Probe />
        </CapCallProvider>
      </ScreensProvider>,
    ),
  );
  return { ready, change: () => last, patches, unmount: () => act(async () => tree.render(<></>)) };
}

test("a change runs, says its success and is not busy afterwards", async () => {
  const restore = installDom();
  try {
    const calls: unknown[][] = [];
    const t = setup(async (cap, input, o) => (calls.push([cap, input, o?.idempotencyKey]), { ok: true }));
    await t.ready;
    let out: unknown;
    await act(async () => {
      out = await t.change().run({ id: "a" }, "Saved.");
    });
    assert.deepEqual(out, { ok: true });
    assert.equal(t.change().note, "Saved.");
    assert.equal(t.change().busy, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]![0], "things.set");
    assert.match(String(calls[0]![2]), /\S/, "one idempotency key");
  } finally {
    restore();
  }
});

test("a failure is one plain sentence, and a later success does not wipe it", async () => {
  const restore = installDom();
  try {
    let n = 0;
    const t = setup(async () => {
      if (n++ === 0) throw Object.assign(new Error("You can't change that"), { code: "permission.denied" });
      return {};
    });
    await t.ready;
    await act(async () => void (await t.change().run({ id: "a" }, "Saved.")));
    assert.equal(t.change().note, "You can't change that.");
    // two changes in one burst: the second succeeds, and the first one's failure is still said
    n = 0;
    await act(async () => {
      const a = t.change().run({ id: "a" }, "Saved.");
      const b = t.change().run({ id: "b" }, "Saved.");
      await Promise.all([a, b]);
    });
    assert.match(t.change().note, /You can't change that\./, "the failure stays beside the later success");
    assert.match(t.change().note, /Saved\./);
  } finally {
    restore();
  }
});

test("one call at a time: a different call waits its turn, the same call while it runs is ignored", async () => {
  const restore = installDom();
  try {
    const first = gate<unknown>();
    const started: string[] = [];
    const t = setup(
      (_cap, input) => (
        started.push(JSON.stringify(input)),
        started.length === 1 ? first.promise : Promise.resolve({})
      ),
    );
    await t.ready;
    let a!: Promise<unknown>, again!: Promise<unknown>, b!: Promise<unknown>;
    await act(async () => {
      a = t.change().run({ id: "a" });
      again = t.change().run({ id: "a" });
      b = t.change().run({ id: "b" });
      await Promise.resolve();
    });
    assert.deepEqual(started, ['{"id":"a"}'], "b waits");
    assert.equal(t.change().busy, true);
    assert.equal(await again, undefined, "the double press is the one already on its way");
    await act(async () => {
      first.resolve({});
      await a;
      await b;
    });
    assert.deepEqual(started, ['{"id":"a"}', '{"id":"b"}']);
    assert.equal(t.change().busy, false);
  } finally {
    restore();
  }
});

test("no more than 20 changes wait behind the running one", async () => {
  const restore = installDom();
  try {
    const hold = gate<unknown>();
    const t = setup(() => hold.promise);
    await t.ready;
    const runs: Promise<unknown>[] = [];
    await act(async () => {
      for (let i = 0; i < MAX_WAITING_CHANGES + 3; i++) runs.push(t.change().run({ id: `x${i}` }));
      await Promise.resolve();
    });
    assert.match(t.change().note, /Too many changes are waiting/);
    await act(async () => {
      hold.resolve({});
      await Promise.all(runs);
    });
  } finally {
    restore();
  }
});

test("an optimistic change shows at once and stays when the call succeeds", async () => {
  const restore = installDom();
  try {
    const hold = gate<unknown>();
    const t = setup(() => hold.promise, {
      optimistic: (input) => ({
        cap: "things.get",
        input: { id: (input as { id: string }).id },
        apply: (d) => ({ ...(d as object), on: true }),
      }),
    });
    await t.ready;
    let run!: Promise<unknown>;
    await act(async () => {
      run = t.change().run({ id: "a" });
      await Promise.resolve();
    });
    assert.deepEqual(t.patches.applied, [["things.get", { id: "a" }, { on: true }]], "shown before the answer");
    await act(async () => {
      hold.resolve({});
      await run;
    });
    assert.equal(t.patches.undone, 0);
  } finally {
    restore();
  }
});

test("an optimistic change is undone when the call fails, and the plain reason is said", async () => {
  const restore = installDom();
  try {
    const hold = gate<unknown>();
    const t = setup(() => hold.promise, { optimistic: () => ({ cap: "things.get", apply: (d) => d }) });
    await t.ready;
    let run!: Promise<unknown>;
    await act(async () => {
      run = t.change().run({ id: "a" });
      await Promise.resolve();
    });
    await act(async () => {
      hold.reject(Object.assign(new Error("The server did not answer"), { code: "internal.error" }));
      await run;
    });
    assert.equal(t.patches.undone, 1);
    assert.equal(t.change().note, "The server did not answer.");
  } finally {
    restore();
  }
});

test("on, off, on pressed quickly runs all three in order: the last press is never dropped", async () => {
  const restore = installDom();
  try {
    const first = gate<unknown>();
    const started: string[] = [];
    const t = setup(
      (_cap, input) => (
        started.push(JSON.stringify(input)),
        started.length === 1 ? first.promise : Promise.resolve({})
      ),
    );
    await t.ready;
    let runs: Promise<unknown>[] = [];
    await act(async () => {
      runs = [t.change().run({ on: true }), t.change().run({ on: false }), t.change().run({ on: true })];
      await Promise.resolve();
    });
    await act(async () => {
      first.resolve({});
      await Promise.all(runs);
    });
    assert.deepEqual(started, ['{"on":true}', '{"on":false}', '{"on":true}']);
  } finally {
    restore();
  }
});

test("every call carries its own idempotency key", async () => {
  const restore = installDom();
  try {
    const keys: (string | undefined)[] = [];
    const t = setup(async (_cap, _input, o) => (keys.push(o?.idempotencyKey), {}));
    await t.ready;
    await act(async () => {
      await t.change().run({ id: "a" });
      await t.change().run({ id: "b" });
    });
    assert.equal(keys.length, 2);
    assert.notEqual(keys[0], keys[1]);
  } finally {
    restore();
  }
});
