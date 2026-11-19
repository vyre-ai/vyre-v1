// A place never remounts when its module arrives (PlaceHost.placeFor): text typed into it survives the parent drawing it again, and a module that fails to load goes to the place's boundary instead of a hot loop.
import test from "node:test";
import assert from "node:assert/strict";
import { Component, Suspense, act, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, typeInto } from "../../../../../ui/src/testing/dom.ts";
import { registerPlace } from "../../startup/places.ts";
import { loadPlace } from "../../startup/places.ts";
import { placeFor } from "./PlaceHost.tsx";

let mounts = 0;
function Page(): ReactNode {
  const [v, setV] = useState("");
  useEffect(() => {
    mounts++;
  }, []);
  return <input data-testid="box" value={v} onChange={(e) => setV(e.target.value)} />;
}

test("typed text in a place survives its module arriving and the parent drawing it again", async () => {
  const undo = installDom();
  try {
    mounts = 0;
    let release: (m: { default: typeof Page }) => void = () => {};
    registerPlace("zz-remount" as never, () => new Promise((r) => (release = r as never)) as never);
    const Place = placeFor("zz-remount");
    const r = createRoot();
    await act(async () => {
      r.render(
        <Suspense fallback={null}>
          <Place place="zz-remount" />
        </Suspense>,
      );
    });
    const root = r.container as never;
    assert.equal(find(root, "box"), null);
    await act(async () => {
      release({ default: Page });
      await loadPlace("zz-remount");
    });
    await flush();
    assert.ok(find(root, "box"));
    await typeInto(find(root, "box"), "typed");
    await act(async () => {
      r.render(
        <Suspense fallback={null}>
          <Place place="zz-remount" />
        </Suspense>,
      );
    });
    assert.equal((find(root, "box")?.props as { value: string }).value, "typed");
    assert.equal(mounts, 1);
  } finally {
    undo();
  }
});

test("a place whose module fails to load goes to its boundary once, not into a loop", async () => {
  const undo = installDom();
  const log = console.error;
  console.error = () => undefined;
  try {
    let tries = 0;
    registerPlace(
      "zz-fail" as never,
      (async () => {
        tries++;
        throw new Error("Failed to fetch dynamically imported module");
      }) as never,
    );
    const Place = placeFor("zz-fail");
    class B extends Component<{ children?: ReactNode }, { bad: boolean }> {
      override state = { bad: false };
      static getDerivedStateFromError(): { bad: boolean } {
        return { bad: true };
      }
      override render(): ReactNode {
        return this.state.bad ? <input data-testid="boundary" /> : this.props.children;
      }
    }
    const r = createRoot();
    await act(async () => {
      r.render(
        <B>
          <Suspense fallback={null}>
            <Place place="zz-fail" />
          </Suspense>
        </B>,
      );
    });
    await flush();
    await flush();
    assert.ok(find(r.container as never, "boundary"));
    assert.equal(tries, 1);
  } finally {
    console.error = log;
    undo();
  }
});
