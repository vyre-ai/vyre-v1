// A lazy page never remounts when its chunk arrives: text typed into it survives (rc.39 shipped Lazy-then-Loaded, a different element type, so a page already on screen remounted and dropped what was typed).
import test from "node:test";
import assert from "node:assert/strict";
import { act, useEffect, useState } from "react";
import { createRoot } from "test-renderer";
import { find, installDom, mount, flush, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { lazyPage } from "./lazy-page.tsx";

let mounts = 0;
function Page({ label }: { label: string }) {
  const [v, setV] = useState("");
  useEffect(() => {
    mounts++;
  }, []);
  return <input data-testid="box" aria-label={label} value={v} onChange={(e) => setV(e.target.value)} />;
}

test("typed text survives a re-render that happens as the chunk finishes arriving", async () => {
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
    assert.equal((find(root, "box")?.props as { value: string }).value, "hello");
    // the preload of every page finishing later must not touch the page on screen
    await act(async () => {
      await page.preload();
    });
    await flush();
    assert.equal((find(root, "box")?.props as { value: string }).value, "hello");
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
    assert.equal((find(r.container as never, "box")?.props as { value: string }).value, "kept");
    assert.equal(mounts, 1);
  } finally {
    undo();
  }
});
