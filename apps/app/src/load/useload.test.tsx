// useLoad (contract P3): the one data hook. A query becomes a Load: loading, failed with Retry (the error is always read), or ready. `soft` reads never fail, `keepPrevious` holds the last answer,
// and a disabled read stays loading and asks for nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { installDom, mount } from "../../../../ui/src/testing/dom.ts";
import { RETRY_LOADS_EVENT } from "../../../../ui/src/States/Loads.tsx";
import type { Load } from "../../../../ui/src/States/Loadable.tsx";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../client/src/index.ts";
import { ScreensProvider } from "./screens.tsx";
import { useLoad } from "./useLoad.ts";

/** A live query the test drives: `set` changes its snapshot and tells whoever listens. */
function fakeQuery<T>(first: QueryState<T>): { q: LiveQuery<T>; set(s: QueryState<T>): Promise<void>; asked: number } {
  let snap = first;
  const listeners = new Set<() => void>();
  const out = {
    asked: 0,
    q: {
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      getSnapshot: () => snap,
    } as LiveQuery<T>,
    set: async (s: QueryState<T>) => {
      snap = s;
      await act(async () => {
        for (const l of [...listeners]) l();
      });
    },
  };
  return out;
}
const hooksOf = (
  by: (id: string, name: string, state?: unknown) => LiveQuery<unknown>,
  cap?: (c: string, i?: unknown) => LiveQuery<unknown>,
): ScreenHooks => ({ query: by, ...(cap ? { capQuery: cap } : {}) }) as unknown as ScreenHooks;

function probe<T>(read: () => Load<T>, seen: Load<T>[]): () => null {
  return function Probe() {
    seen.push(read());
    return null;
  };
}
const last = <T,>(seen: Load<T>[]): Load<T> => seen[seen.length - 1]!;

test("a screen query is loading, then ready with its data", async () => {
  const restore = installDom();
  try {
    const f = fakeQuery<{ rows: number[] }>({ status: "loading" });
    const asked: unknown[] = [];
    const seen: Load<{ rows: number[] }>[] = [];
    const Probe = probe(() => useLoad<{ rows: number[] }>({ screen: ["settings.page", "rows", { a: 1 }] }), seen);
    await mount(
      createRoot,
      <ScreensProvider
        screens={hooksOf((id, name, state) => (asked.push([id, name, state]), f.q as LiveQuery<unknown>))}
      >
        <Probe />
      </ScreensProvider>,
    );
    assert.deepEqual(last(seen), { state: "loading" });
    assert.deepEqual(asked[0], ["settings.page", "rows", { a: 1 }]);
    await f.set({ status: "ready", data: { rows: [1] } });
    assert.deepEqual(last(seen), { state: "ready", data: { rows: [1] } });
  } finally {
    restore();
  }
});

test("a read that failed is failed with its reason, never loading for ever; Retry asks the session to read again", async () => {
  const restore = installDom();
  const g = globalThis as { dispatchEvent?: unknown; CustomEvent?: unknown };
  const sent: string[] = [];
  g.dispatchEvent = (e: { type: string }) => (sent.push(e.type), true);
  g.CustomEvent = class {
    type: string;
    constructor(t: string) {
      this.type = t;
    }
  };
  try {
    const f = fakeQuery<{ rows: number[] }>({
      status: "loading",
      error: { message: "no answer", code: "internal.error", traceId: "tr_1" },
    });
    const seen: Load<{ rows: number[] }>[] = [];
    const Probe = probe(() => useLoad<{ rows: number[] }>({ screen: ["a", "b"] }), seen);
    await mount(
      createRoot,
      <ScreensProvider screens={hooksOf(() => f.q as LiveQuery<unknown>)}>
        <Probe />
      </ScreensProvider>,
    );
    const l = last(seen);
    assert.equal(l.state, "failed");
    if (l.state !== "failed") return;
    assert.deepEqual(l.failure, { message: "no answer", code: "internal.error", traceId: "tr_1" });
    l.retry();
    assert.deepEqual(sent, [RETRY_LOADS_EVENT]);
    await f.set({ status: "ready", data: { rows: [2] } });
    assert.deepEqual(last(seen), { state: "ready", data: { rows: [2] } }, "the next answer replaces the failure");
  } finally {
    delete g.dispatchEvent;
    delete g.CustomEvent;
    restore();
  }
});

test("a soft read that failed is ready with nothing: it never draws an error", async () => {
  const restore = installDom();
  try {
    const f = fakeQuery<{ rows: number[] }>({ status: "loading", error: { message: "no answer" } });
    const seen: Load<{ rows: number[] } | null>[] = [];
    const Probe = probe(() => useLoad<{ rows: number[] }>({ screen: ["a", "b"] }, { soft: true }), seen);
    await mount(
      createRoot,
      <ScreensProvider screens={hooksOf(() => f.q as LiveQuery<unknown>)}>
        <Probe />
      </ScreensProvider>,
    );
    assert.deepEqual(last(seen), { state: "ready", data: null });
    const wait = fakeQuery<{ rows: number[] }>({ status: "loading" });
    const seen2: Load<{ rows: number[] } | null>[] = [];
    const Probe2 = probe(() => useLoad<{ rows: number[] }>({ screen: ["a", "b"] }, { soft: true }), seen2);
    await mount(
      createRoot,
      <ScreensProvider screens={hooksOf(() => wait.q as LiveQuery<unknown>)}>
        <Probe2 />
      </ScreensProvider>,
    );
    assert.deepEqual(last(seen2), { state: "loading" }, "still waiting is still loading");
  } finally {
    restore();
  }
});

test("a disabled read asks for nothing and stays loading", async () => {
  const restore = installDom();
  try {
    let asked = 0;
    const seen: Load<number>[] = [];
    const Probe = probe(() => useLoad<number>({ screen: ["a", "b"] }, { enabled: false }), seen);
    await mount(
      createRoot,
      <ScreensProvider
        screens={hooksOf(() => (asked++, fakeQuery<number>({ status: "loading" }).q as LiveQuery<unknown>))}
      >
        <Probe />
      </ScreensProvider>,
    );
    assert.equal(asked, 0);
    assert.deepEqual(last(seen), { state: "loading" });
  } finally {
    restore();
  }
});

test("keepPrevious holds the last answer while the next read of the same screen is on its way", async () => {
  const restore = installDom();
  try {
    const one = fakeQuery<string>({ status: "ready", data: "first" });
    const two = fakeQuery<string>({ status: "loading" });
    const seen: Load<string>[] = [];
    let which = "one";
    const Probe = probe(() => useLoad<string>({ screen: ["a", "b", { q: which }] }, { keepPrevious: true }), seen);
    const screens = hooksOf(
      (_i, _n, state) => ((state as { q: string }).q === "one" ? one.q : two.q) as LiveQuery<unknown>,
    );
    const tree = createRoot();
    await act(async () =>
      tree.render(
        <ScreensProvider screens={screens}>
          <Probe />
        </ScreensProvider>,
      ),
    );
    assert.deepEqual(last(seen), { state: "ready", data: "first" });
    which = "two";
    await act(async () =>
      tree.render(
        <ScreensProvider screens={screens}>
          <Probe />
        </ScreensProvider>,
      ),
    );
    assert.deepEqual(
      last(seen),
      { state: "ready", data: "first" },
      "not loading: the old answer stays until the new one lands",
    );
    await two.set({ status: "ready", data: "second" });
    assert.deepEqual(last(seen), { state: "ready", data: "second" });
  } finally {
    restore();
  }
});

test("a capability source reads through the hooks' capQuery", async () => {
  const restore = installDom();
  try {
    const f = fakeQuery<{ n: number }>({ status: "ready", data: { n: 3 } });
    const asked: unknown[] = [];
    const seen: Load<{ n: number }>[] = [];
    const Probe = probe(() => useLoad<{ n: number }>({ cap: "inbox.counts", input: { x: 1 } }), seen);
    await mount(
      createRoot,
      <ScreensProvider
        screens={hooksOf(
          () => {
            throw new Error("not a screen");
          },
          (c, i) => (asked.push([c, i]), f.q as LiveQuery<unknown>),
        )}
      >
        <Probe />
      </ScreensProvider>,
    );
    assert.deepEqual(last(seen), { state: "ready", data: { n: 3 } });
    assert.deepEqual(asked[0], ["inbox.counts", { x: 1 }]);
  } finally {
    restore();
  }
});

test("without a ScreensProvider the hook says what is missing", async () => {
  const restore = installDom();
  try {
    const seen: Load<number>[] = [];
    const Probe = probe(() => useLoad<number>({ screen: ["a", "b"] }), seen);
    await assert.rejects(async () => {
      await mount(createRoot, <Probe />);
    }, /ScreensProvider/);
  } finally {
    restore();
  }
});

test("hooks that cannot answer a capability say so, instead of waiting for ever", async () => {
  const restore = installDom();
  try {
    const seen: Load<number>[] = [];
    const Probe = probe(() => useLoad<number>({ cap: "inbox.counts" }), seen);
    await mount(
      createRoot,
      <ScreensProvider
        screens={hooksOf(() => {
          throw new Error("not a screen");
        })}
      >
        <Probe />
      </ScreensProvider>,
    );
    const l = last(seen);
    assert.equal(l.state, "failed");
    assert.equal(
      l.state === "failed" ? l.failure.code : "",
      "load.cannot_read",
      "marked as one that retrying cannot fix",
    );
  } finally {
    restore();
  }
});

test("an answer whose last re-read failed stays ready, with the failure beside it, and the next good answer clears it", async () => {
  const restore = installDom();
  try {
    const f = fakeQuery<number>({ status: "ready", data: 1 });
    let stale: { message: string } | null = null;
    const listeners = new Set<() => void>();
    (f.q as unknown as { stale: unknown }).stale = {
      subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
      getSnapshot: () => stale,
    };
    const seen: Load<number>[] = [];
    const Probe = probe(() => useLoad<number>({ screen: ["a", "b"] }), seen);
    await mount(
      createRoot,
      <ScreensProvider screens={hooksOf(() => f.q as LiveQuery<unknown>)}>
        <Probe />
      </ScreensProvider>,
    );
    assert.deepEqual(last(seen), { state: "ready", data: 1 });
    stale = { message: "down" };
    await act(async () => listeners.forEach((l) => l()));
    assert.deepEqual(last(seen), { state: "ready", data: 1, stale: { message: "down" } });
    stale = null;
    await act(async () => listeners.forEach((l) => l()));
    assert.deepEqual(last(seen), { state: "ready", data: 1 });
  } finally {
    restore();
  }
});

test("a soft read, or one that says refresh: false, never carries the failed-refresh note", async () => {
  const restore = installDom();
  try {
    for (const opts of [{ soft: true }, { refresh: false }] as const) {
      const f = fakeQuery<number>({ status: "ready", data: 1 });
      (f.q as unknown as { stale: unknown }).stale = {
        subscribe: () => () => undefined,
        getSnapshot: () => ({ message: "down" }),
      };
      const seen: Load<number | null>[] = [];
      const Probe = probe(() => useLoad<number>({ screen: ["a", "b"] }, opts as never), seen);
      await mount(
        createRoot,
        <ScreensProvider screens={hooksOf(() => f.q as LiveQuery<unknown>)}>
          <Probe />
        </ScreensProvider>,
      );
      assert.deepEqual(last(seen), { state: "ready", data: 1 }, JSON.stringify(opts));
    }
  } finally {
    restore();
  }
});
