// useLoadList (contract P3): cursor paging over a list capability. Page 1 is the watched read; later pages come by cursor, one request each, deduped by id, and a failed page is said at the foot
// with Retry without taking the rows away.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { installDom, mount } from "../../../../ui/src/testing/dom.ts";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../client/src/index.ts";
import { CapCallProvider } from "./call.tsx";
import { ScreensProvider } from "./screens.tsx";
import { useLoadList } from "./useLoadList.ts";
import type { LoadList } from "./useLoadList.ts";

interface Row {
  id: string;
}
const row = (n: number): Row => ({ id: `r${n}` });
const serverOf = (n: number) => {
  const all = Array.from({ length: n }, (_, i) => row(i));
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const page = (input: Record<string, unknown>): { rows: Row[]; next?: string; total: number } => {
    const at = typeof input["cursor"] === "string" ? Number(input["cursor"]) : 0;
    const limit = Number(input["limit"] ?? 50);
    const rows = all.slice(at, at + limit);
    return { rows, ...(at + limit < n ? { next: String(at + limit) } : {}), total: n };
  };
  return { calls, page, all };
};
function watched(first: () => unknown) {
  let snap: QueryState<unknown> = { status: "ready", data: first() };
  const listeners = new Set<() => void>();
  const q: LiveQuery<unknown> = {
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    getSnapshot: () => snap,
  };
  return {
    q,
    set: async (s: QueryState<unknown>) => {
      snap = s;
      await act(async () => listeners.forEach((l) => l()));
    },
  };
}
function setup(n: number, o: { failAt?: () => boolean; input?: Record<string, unknown> } = {}) {
  const srv = serverOf(n);
  const w = watched(() => srv.page({ limit: 50 }));
  const hooks = {
    capQuery: (cap: string, input: Record<string, unknown>) => (srv.calls.push({ cap, input }), w.q),
  } as unknown as ScreenHooks;
  const call = async (cap: string, input?: unknown): Promise<unknown> => {
    srv.calls.push({ cap, input: input as Record<string, unknown> });
    if (o.failAt?.()) throw Object.assign(new Error("The server did not answer."), { code: "internal.error" });
    return srv.page(input as Record<string, unknown>);
  };
  const seen: LoadList<Row>[] = [];
  const Probe = (): null => {
    seen.push(useLoadList<Row>({ cap: "things.list", input: o.input ?? {}, idOf: (r) => r.id }));
    return null;
  };
  const tree = createRoot();
  const render = async (): Promise<void> => {
    await act(async () =>
      tree.render(
        <ScreensProvider screens={hooks}>
          <CapCallProvider call={call}>
            <Probe />
          </CapCallProvider>
        </ScreensProvider>,
      ),
    );
  };
  return { srv, w, seen, render, last: () => seen[seen.length - 1]! };
}
const rowsOf = (l: LoadList<Row>): readonly Row[] => (l.load.state === "ready" ? l.load.data.rows : []);

test("page 1 is the watched read; hasMore follows its cursor", async () => {
  const restore = installDom();
  try {
    const t = setup(120);
    await t.render();
    assert.equal(rowsOf(t.last()).length, 50);
    assert.equal(t.last().hasMore, true);
    assert.equal(t.last().more, "idle");
    assert.deepEqual(t.srv.calls[0]?.input, { limit: 50 });
    const short = setup(30);
    await short.render();
    assert.equal(short.last().hasMore, false);
  } finally {
    restore();
  }
});

test("loadMore fetches the next page by its cursor, appends it once and ends at the last page", async () => {
  const restore = installDom();
  try {
    const t = setup(120);
    await t.render();
    await act(async () => t.last().loadMore());
    assert.equal(rowsOf(t.last()).length, 100);
    assert.deepEqual(t.srv.calls.at(-1)?.input, { cursor: "50", limit: 50 });
    await act(async () => t.last().loadMore());
    assert.equal(rowsOf(t.last()).length, 120);
    assert.equal(t.last().hasMore, false);
    const before = t.srv.calls.length;
    await act(async () => t.last().loadMore());
    assert.equal(t.srv.calls.length, before, "nothing more to ask");
    assert.equal(new Set(rowsOf(t.last()).map((r) => r.id)).size, 120, "no row twice");
  } finally {
    restore();
  }
});

test("a failed page is said at the foot with Retry and the rows stay; Retry asks the same page again", async () => {
  const restore = installDom();
  try {
    let fail = true;
    const t = setup(120, { failAt: () => fail });
    await t.render();
    await act(async () => t.last().loadMore());
    const more = t.last().more;
    assert.ok(typeof more === "object", "failed");
    if (typeof more !== "object") return;
    assert.match(more.failed.message, /did not answer/);
    assert.equal(rowsOf(t.last()).length, 50, "the rows stay");
    fail = false;
    await act(async () => more.retry());
    assert.equal(rowsOf(t.last()).length, 100);
    assert.equal(t.last().more, "idle");
    assert.deepEqual(t.srv.calls.filter((c) => c.input["cursor"] === "50").length, 2, "the same cursor twice");
  } finally {
    restore();
  }
});

test("5,000 rows are walked in at most ceil(5000 / 50) requests and none per row", async () => {
  const restore = installDom();
  try {
    const t = setup(5000);
    await t.render();
    for (let i = 0; i < 200 && t.last().hasMore; i++) await act(async () => t.last().loadMore());
    assert.equal(rowsOf(t.last()).length, 5000);
    assert.ok(t.srv.calls.length <= Math.ceil(5000 / 50), `${t.srv.calls.length} requests`);
  } finally {
    restore();
  }
});

test("page 1 changing keeps the pages already fetched and does not show a row twice", async () => {
  const restore = installDom();
  try {
    const t = setup(120);
    await t.render();
    await act(async () => t.last().loadMore());
    // the live link announces a change: the first row was deleted, so page 1 now reaches r50, which the second page also holds
    await t.w.set({ status: "ready", data: { rows: t.srv.all.slice(1, 51), next: "50", total: 119 } });
    const ids = rowsOf(t.last()).map((r) => r.id);
    assert.equal(ids.length, 99, "r1 to r99, each once");
    assert.equal(new Set(ids).size, 99);
    assert.deepEqual(ids.slice(48, 52), ["r49", "r50", "r51", "r52"]);
  } finally {
    restore();
  }
});

test("page 1 that failed is a failed load, not an empty list", async () => {
  const restore = installDom();
  try {
    const srv = serverOf(10);
    const w = watched(() => srv.page({ limit: 50 }));
    await w.set({ status: "loading", error: { message: "no answer" } });
    const hooks = { capQuery: () => w.q } as unknown as ScreenHooks;
    const seen: LoadList<Row>[] = [];
    const Probe = (): null => (seen.push(useLoadList<Row>({ cap: "things.list", idOf: (r) => r.id })), null);
    await mount(
      createRoot,
      <ScreensProvider screens={hooks}>
        <CapCallProvider call={async () => ({})}>
          <Probe />
        </CapCallProvider>
      </ScreensProvider>,
    );
    assert.equal(seen[seen.length - 1]!.load.state, "failed");
    assert.equal(seen[seen.length - 1]!.hasMore, false);
  } finally {
    restore();
  }
});

test("two loadMore calls in one tick ask for the page once", async () => {
  const restore = installDom();
  try {
    const t = setup(120);
    await t.render();
    await act(async () => {
      t.last().loadMore();
      t.last().loadMore();
    });
    assert.equal(t.srv.calls.filter((c) => c.input["cursor"] === "50").length, 1);
    assert.equal(rowsOf(t.last()).length, 100);
  } finally {
    restore();
  }
});

/** A list whose pages are held until the test lets them go, and whose input the test can change. */
function held(n: number) {
  const srv = serverOf(n);
  const w = watched(() => srv.page({ limit: 50 }));
  const hooks = { capQuery: () => w.q } as unknown as ScreenHooks;
  const release: (() => void)[] = [];
  const call = (_cap: string, input?: unknown): Promise<unknown> =>
    new Promise((res) => release.push(() => res(srv.page(input as Record<string, unknown>))));
  const seen: LoadList<Row>[] = [];
  let query = "a";
  const Probe = (): null => (
    seen.push(useLoadList<Row>({ cap: "things.list", input: { q: query }, idOf: (r) => r.id })),
    null
  );
  const tree = createRoot();
  const render = async (): Promise<void> => {
    await act(async () =>
      tree.render(
        <ScreensProvider screens={hooks}>
          <CapCallProvider call={call}>
            <Probe />
          </CapCallProvider>
        </ScreensProvider>,
      ),
    );
  };
  return { render, release, last: () => seen[seen.length - 1]!, setQuery: (q: string) => (query = q) };
}

test("a page that comes back after the input changed is dropped, and the new input starts from its own first page", async () => {
  const restore = installDom();
  try {
    const t = held(120);
    await t.render();
    await act(async () => t.last().loadMore());
    assert.equal(t.last().more, "loading");
    t.setQuery("b");
    await t.render();
    assert.equal(t.last().more, "idle", "the wait of the old input is over");
    await act(async () => t.release.forEach((r) => r()));
    assert.equal(rowsOf(t.last()).length, 50, "only the new input's first page: the old page 2 did not land");
    assert.equal(t.last().hasMore, true);
  } finally {
    restore();
  }
});

test("pages fetched for one input are not kept for the next", async () => {
  const restore = installDom();
  try {
    const t = held(120);
    await t.render();
    await act(async () => t.last().loadMore());
    await act(async () => t.release.forEach((r) => r()));
    assert.equal(rowsOf(t.last()).length, 100);
    t.setQuery("b");
    await t.render();
    assert.equal(rowsOf(t.last()).length, 50);
  } finally {
    restore();
  }
});

test("a load that is on its way when the input changes may be asked again for the new input", async () => {
  const restore = installDom();
  try {
    const t = held(120);
    await t.render();
    await act(async () => t.last().loadMore());
    t.setQuery("b");
    await t.render();
    await act(async () => t.last().loadMore());
    assert.equal(t.last().more, "loading", "the guard of the old request does not block the new one");
  } finally {
    restore();
  }
});

test("the answer of the old input's page does not end the wait of the new input's page", async () => {
  const restore = installDom();
  try {
    const t = held(120);
    await t.render();
    await act(async () => t.last().loadMore());
    t.setQuery("b");
    await t.render();
    await act(async () => t.last().loadMore());
    assert.equal(t.release.length, 2);
    await act(async () => t.release[0]!());
    assert.equal(t.last().more, "loading", "the new page is still on its way");
    await act(async () => {
      t.last().loadMore();
    });
    assert.equal(t.release.length, 2, "and it is not asked for twice");
    await act(async () => t.release[1]!());
    assert.equal(t.last().more, "idle");
    assert.equal(rowsOf(t.last()).length, 100);
  } finally {
    restore();
  }
});
