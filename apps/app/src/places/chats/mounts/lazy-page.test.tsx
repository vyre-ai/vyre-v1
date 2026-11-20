// A lazy page of the Chats place: it never remounts when its chunk arrives (typed text survives), and a chunk that fails is never cached and never takes more than its own part down.
import test from "node:test";
import assert from "node:assert/strict";
import { Component, act, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "test-renderer";
import { find, installDom, mount, flush, press, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { lazyPage } from "./lazy-page.tsx";

let mounts = 0;
function Page({ label }: { label: string }) {
  const [v, setV] = useState("");
  useEffect(() => {
    mounts++;
  }, []);
  return <input data-testid="box" aria-label={label} value={v} onChange={(e) => setV(e.target.value)} />;
}
const valueOf = (root: Parameters<typeof find>[0]): unknown => (find(root, "box")?.props as { value: string }).value;

test("typed text survives the chunk arriving and the parent drawing the page again", async () => {
  const undo = installDom();
  try {
    mounts = 0;
    let release: (c: typeof Page) => void = () => {};
    const page = lazyPage<{ label: string }>(() => new Promise((r) => (release = r)));
    const r = createRoot();
    await act(async () => {
      r.render(<page.Draw label="x" />);
    });
    const root = r.container as never;
    assert.equal(find(root, "box"), null, "nothing yet: the chunk is out");
    await act(async () => {
      release(Page);
      await page.preload();
    });
    await flush();
    assert.ok(find(root, "box"));
    await typeInto(find(root, "box"), "hello");
    await act(async () => {
      r.render(<page.Draw label="x2" />); // the parent draws the page again now that its code is in
    });
    await flush();
    assert.equal(valueOf(root), "hello");
    assert.equal(mounts, 1, "the page mounted once");
  } finally {
    undo();
  }
});

test("a page whose chunk is already loaded draws on the first pass", async () => {
  const undo = installDom();
  try {
    const page = lazyPage<{ label: string }>(async () => Page);
    await page.preload();
    const root = await mount(() => createRoot(), <page.Draw label="y" />);
    assert.ok(find(root, "box"));
  } finally {
    undo();
  }
});

test("a draw that started before the chunk arrived and one after share one element tree", async () => {
  const undo = installDom();
  try {
    mounts = 0;
    let release: (c: typeof Page) => void = () => {};
    const page = lazyPage<{ label: string }>(() => new Promise((r) => (release = r)));
    const r = createRoot();
    await act(async () => {
      r.render(<page.Draw label="a" />);
    });
    await act(async () => {
      release(Page);
      await page.preload();
    });
    await flush();
    await typeInto(find(r.container as never, "box"), "kept");
    await act(async () => {
      r.render(<page.Draw label="b" />); // new props, loaded now
    });
    assert.equal(valueOf(r.container as never), "kept");
    assert.equal(mounts, 1);
  } finally {
    undo();
  }
});

test("a failed chunk shows a small Retry in its own part only, and Retry loads it", async () => {
  const undo = installDom();
  const log = console.error;
  console.error = () => undefined; // React and the boundary say what failed
  try {
    let tries = 0;
    const page = lazyPage<{ label: string }>(async () => {
      tries += 1;
      if (tries === 1) throw new Error("Failed to fetch dynamically imported module");
      return Page;
    });
    function Place() {
      return (
        <>
          <input data-testid="sibling" aria-label="the rest of the place" />
          <page.Draw label="z" />
        </>
      );
    }
    const root = await mount(() => createRoot(), <Place />);
    await flush();
    assert.ok(find(root, "lazy-part-failed"), "the part says it failed");
    assert.ok(find(root, "sibling"), "the rest of the place is still there");
    assert.equal(tries, 1, "one try, not a loop");
    await press(find(root, "lazy-part-retry"));
    await flush();
    assert.equal(tries, 2);
    assert.ok(find(root, "box"), "the page is there after Retry");
    assert.equal(find(root, "lazy-part-failed"), null);
    assert.ok(find(root, "sibling"));
  } finally {
    console.error = log;
    undo();
  }
});

test("a failed chunk is not cached: the next draw asks again", async () => {
  const undo = installDom();
  const log = console.error;
  console.error = () => undefined;
  try {
    let tries = 0;
    const page = lazyPage<{ label: string }>(async () => {
      tries += 1;
      if (tries === 1) throw new Error("offline");
      return Page;
    });
    await assert.rejects(page.preload());
    assert.equal(tries, 1);
    const root = await mount(() => createRoot(), <page.Draw label="n" />);
    await flush();
    assert.equal(tries, 2, "asked again on the next use");
    assert.ok(find(root, "box"));
  } finally {
    console.error = log;
    undo();
  }
});

test("only a failed load is answered by the part's own boundary: a crash of the page goes on to the place", async () => {
  const undo = installDom();
  const log = console.error;
  console.error = () => undefined;
  try {
    function Crashes(): never {
      throw new Error("the page itself broke");
    }
    const page = lazyPage<{ label: string }>(async () => Crashes as never);
    await page.preload();
    let caught: unknown = null;
    class Place extends Component<{ children?: ReactNode }, { bad: boolean }> {
      override state = { bad: false };
      static getDerivedStateFromError(): { bad: boolean } {
        return { bad: true };
      }
      override componentDidCatch(e: unknown): void {
        caught = e;
      }
      override render(): ReactNode {
        return this.state.bad ? <input data-testid="place-error" /> : this.props.children;
      }
    }
    const root = await mount(
      () => createRoot(),
      <Place>
        <page.Draw label="c" />
      </Place>,
    );
    await flush();
    assert.ok(find(root, "place-error"), "the place's own boundary drew its error");
    assert.equal(find(root, "lazy-part-failed"), null, "not the load-failure line");
    assert.equal((caught as Error).message, "the page itself broke");
  } finally {
    console.error = log;
    undo();
  }
});
