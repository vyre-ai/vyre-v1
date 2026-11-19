// A part that loads on request (ui/src/Lazy): a failed chunk leaves everything around it mounted, shows a small Retry in its own place, is asked for again, and a part loaded by something else never remounts.
import test from "node:test";
import assert from "node:assert/strict";
import { Component, Suspense, act, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, typeInto } from "../testing/dom.ts";
import { lazyPart } from "./index.tsx";

let mounts = 0;
function Page({ label }: { label: string }) {
  const [v, setV] = useState("");
  useEffect(() => {
    mounts++;
  }, []);
  return <input data-testid="box" aria-label={label} value={v} onChange={(e) => setV(e.target.value)} />;
}
const valueOf = (root: never): unknown => (find(root, "box")?.props as { value: string }).value;

/** The shell around a part: it must stay mounted whatever the part does. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <input data-testid="shell" aria-label="the shell" />
      <Suspense fallback={null}>{children}</Suspense>
    </>
  );
}

test("a failed chunk leaves the shell mounted and shows Retry in the part's own place; Retry asks again", async () => {
  const undo = installDom();
  const log = console.error;
  console.error = () => undefined;
  try {
    let tries = 0;
    const Part = lazyPart<{ label: string }>(async () => {
      tries += 1;
      if (tries === 1) throw new Error("Failed to fetch dynamically imported module");
      return { default: Page };
    });
    const r = createRoot();
    await act(async () => {
      r.render(
        <Shell>
          <Part label="p" />
        </Shell>,
      );
    });
    await flush();
    const root = r.container as never;
    assert.ok(find(root, "shell"), "the shell is still there");
    assert.ok(find(root, "lazy-part-failed"));
    assert.equal(tries, 1, "one try, no loop");
    await press(find(root, "lazy-part-retry"));
    await flush();
    assert.equal(tries, 2);
    assert.ok(find(root, "box"));
    assert.ok(find(root, "shell"));
  } finally {
    console.error = log;
    undo();
  }
});

test("a failed chunk is not kept for the life of the page: a part drawn again later asks again", async () => {
  const undo = installDom();
  const log = console.error;
  console.error = () => undefined;
  try {
    let tries = 0;
    const Part = lazyPart<{ label: string }>(async () => {
      tries += 1;
      if (tries === 1) throw new Error("offline");
      return { default: Page };
    });
    await assert.rejects(Part.preload());
    const r = createRoot();
    await act(async () => {
      r.render(
        <Shell>
          <Part label="p" />
        </Shell>,
      );
    });
    await flush();
    assert.equal(tries, 2);
    assert.ok(find(r.container as never, "box"));
  } finally {
    console.error = log;
    undo();
  }
});

test("a part another piece of code loaded draws on the first pass and never remounts (the signed-in shell's shape)", async () => {
  const undo = installDom();
  try {
    mounts = 0;
    let other: typeof Page | null = null; // what the page's own warm-up has fetched
    const Part = lazyPart<{ label: string }>(
      () => new Promise(() => undefined),
      () => other,
    );
    const r = createRoot();
    await act(async () => {
      r.render(
        <Shell>
          <Part label="a" />
        </Shell>,
      );
    });
    assert.equal(find(r.container as never, "box"), null, "not loaded yet: suspended");
    other = Page;
    await act(async () => {
      r.render(
        <Shell>
          <Part label="b" />
        </Shell>,
      );
    });
    await flush();
    const root = r.container as never;
    assert.ok(find(root, "box"));
    await typeInto(find(root, "box"), "kept");
    await act(async () => {
      r.render(
        <Shell>
          <Part label="c" />
        </Shell>,
      );
    });
    assert.equal(valueOf(root), "kept");
    assert.equal(mounts, 1);
  } finally {
    undo();
  }
});

test("a crash of the part's own code is not the load boundary's: it goes on to the next boundary", async () => {
  const undo = installDom();
  const log = console.error;
  console.error = () => undefined;
  try {
    function Crashes(): never {
      throw new Error("the page itself broke");
    }
    const Part = lazyPart<{ label: string }>(async () => ({ default: Crashes as never }));
    await Part.preload();
    class Next extends Component<{ children?: ReactNode }, { bad: boolean }> {
      override state = { bad: false };
      static getDerivedStateFromError(): { bad: boolean } {
        return { bad: true };
      }
      override render(): ReactNode {
        return this.state.bad ? <input data-testid="next" /> : this.props.children;
      }
    }
    const r = createRoot();
    await act(async () => {
      r.render(
        <Next>
          <Part label="c" />
        </Next>,
      );
    });
    await flush();
    assert.ok(find(r.container as never, "next"));
    assert.equal(find(r.container as never, "lazy-part-failed"), null);
  } finally {
    console.error = log;
    undo();
  }
});

test("a loader that throws before it returns a promise shows Retry; it is not a crash of the page", async () => {
  const undo = installDom();
  const log = console.error;
  console.error = () => undefined;
  try {
    let tries = 0;
    const Part = lazyPart<typeof Page>(() => {
      tries += 1;
      if (tries === 1) throw new Error("the loader broke before it started");
      return Promise.resolve({ default: Page });
    });
    const r = createRoot();
    await act(async () => {
      r.render(
        <Shell>
          <Part label="s" />
        </Shell>,
      );
    });
    await flush();
    const root = r.container as never;
    assert.ok(find(root, "shell"));
    assert.ok(find(root, "lazy-part-failed"), "Retry, not a crash");
    await press(find(root, "lazy-part-retry"));
    await flush();
    assert.ok(find(root, "box"));
  } finally {
    console.error = log;
    undo();
  }
});

test("the loader is asked in the first render, not a turn later (a screen that waits a few turns for a part sees it, as with React.lazy)", async () => {
  const undo = installDom();
  try {
    let asked = 0;
    let settle: (m: { default: typeof Page }) => void = () => undefined;
    const Part = lazyPart<typeof Page>(() => {
      asked += 1;
      return new Promise((r) => (settle = r));
    });
    const r = createRoot();
    act(() => {
      r.render(
        <Shell>
          <Part label="t" />
        </Shell>,
      );
    });
    assert.equal(asked, 1, "asked in the first render");
    await act(async () => {
      settle({ default: Page });
    });
    await flush();
    assert.ok(find(r.container as never, "box"));
  } finally {
    undo();
  }
});
