// A lazy page of the Chats place: it never remounts when its chunk arrives (typed text survives), and a chunk that fails is never cached and never takes more than its own part down.
import test from "node:test";
import assert from "node:assert/strict";
import { act, useEffect, useState } from "react";
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

test("typed text survives the chunk arriving after the page is on screen", async () => {
  const undo = installDom();
  try {
    mounts = 0;
    let release: (c: typeof Page) => void = () => {};
    const page = lazyPage<{ label: string }>(() => new Promise((r) => (release = r)));
    const root = await mount(() => createRoot(), <page.Draw label="x" />);
    assert.equal(find(root, "box"), null, "nothing yet: the chunk is out");
    await act(async () => {
      release(Page);
      await page.preload();
    });
    await flush();
    assert.ok(find(root, "box"));
    await typeInto(find(root, "box"), "hello");
    await act(async () => {
      await page.preload();
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
