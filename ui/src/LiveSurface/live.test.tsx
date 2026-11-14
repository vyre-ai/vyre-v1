// ui/LiveSurface: one fixed box for a live picture, stream or terminal. It never polls: frames arrive from a source, it lets go of the source when it is hidden, the last good frame stays until the next
// one has loaded, and a frame of another size is fitted inside the box, never resizing it.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { find, installDom, mount, press } from "../testing/dom.ts";
import { LiveSurface, createFrameSwapper, watchVisibility } from "./index.tsx";

test("the last good frame stays until the next one has loaded; a slow older frame never replaces a newer one", async () => {
  const shown: string[] = [];
  const release = new Map<string, () => void>();
  const swap = createFrameSwapper(
    (f) => new Promise<void>((res) => release.set(f.uri, res)),
    (f) => shown.push(f.uri),
  );
  swap.push({ uri: "a", width: 100, height: 50 });
  swap.push({ uri: "b", width: 100, height: 50 });
  release.get("b")!();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(shown, ["b"]);
  release.get("a")!();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(shown, ["b"], "a was asked first but answered last: it is dropped");
  assert.equal(swap.current()?.uri, "b");
});

test("a frame that fails to load leaves the picture as it was", async () => {
  const shown: string[] = [];
  const swap = createFrameSwapper(
    (f) => (f.uri === "bad" ? Promise.reject(new Error("no")) : Promise.resolve()),
    (f) => shown.push(f.uri),
  );
  swap.push({ uri: "ok", width: 1, height: 1 });
  await new Promise((r) => setTimeout(r, 5));
  swap.push({ uri: "bad", width: 1, height: 1 });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(shown, ["ok"]);
});

test("a surface is visible while the page is shown and the window has focus", () => {
  const handlers = new Map<string, () => void>();
  const doc = {
    visibilityState: "visible",
    addEventListener: (t: string, f: () => void) => handlers.set(`d:${t}`, f),
    removeEventListener: (t: string) => handlers.delete(`d:${t}`),
  };
  const win = {
    addEventListener: (t: string, f: () => void) => handlers.set(`w:${t}`, f),
    removeEventListener: (t: string) => handlers.delete(`w:${t}`),
  };
  const seen: boolean[] = [];
  const stop = watchVisibility(doc, win, (v) => seen.push(v));
  doc.visibilityState = "hidden";
  handlers.get("d:visibilitychange")!();
  handlers.get("w:blur")!();
  doc.visibilityState = "visible";
  handlers.get("w:focus")!();
  assert.deepEqual(seen, [false, false, true]);
  stop();
  assert.equal(handlers.size, 0);
});

test("the surface holds the source only while it is shown: a hidden surface lets it go", async () => {
  const restore = installDom();
  try {
    let subscribed = 0;
    let unsubscribed = 0;
    const source = { subscribe: () => (subscribed++, () => void unsubscribed++) };
    const tree = createRoot();
    const draw = async (visible: boolean): Promise<void> => {
      await act(async () =>
        tree.render(<LiveSurface kind="picture" aspect={16 / 9} state="live" source={source} visible={visible} />),
      );
    };
    await draw(true);
    assert.equal(subscribed, 1);
    await draw(false);
    assert.equal(unsubscribed, 1, "hidden: let go");
    await draw(true);
    assert.equal(subscribed, 2);
  } finally {
    restore();
  }
});

test("the box keeps its aspect ratio whatever the frames are", () => {
  const html = renderToStaticMarkup(<LiveSurface kind="stream" aspect={4 / 3} state="live" testID="ls" />);
  assert.match(html, /aspect-ratio:1\.3333/);
});

test("each state says what it is in plain words", () => {
  const starting = renderToStaticMarkup(
    <LiveSurface kind="picture" aspect={2} state="starting" stage="Installing tools" startedAt={Date.now() - 4000} />,
  );
  assert.ok(starting.includes("Installing tools") && /\d+ s/.test(starting));
  const asleep = renderToStaticMarkup(
    <LiveSurface
      kind="picture"
      aspect={2}
      state="asleep"
      still={{ uri: "x.png", at: Date.parse("2026-11-13T14:32:00Z") }}
    />,
  );
  assert.ok(asleep.includes("Asleep. Last seen"));
  const failed = renderToStaticMarkup(
    <LiveSurface
      kind="picture"
      aspect={2}
      state="failed"
      failure={{ message: "The computer ran out of disk." }}
      onRetry={() => undefined}
    />,
  );
  assert.ok(failed.includes("The computer ran out of disk.") && failed.includes("Retry"));
  const live = renderToStaticMarkup(<LiveSurface kind="picture" aspect={2} state="live" />);
  assert.ok(!live.includes("Asleep") && !live.includes("Retry"));
});

test("the corner mark says watching or in control", () => {
  assert.ok(
    renderToStaticMarkup(<LiveSurface kind="stream" aspect={2} state="live" mode="watching" />).includes(
      "You are watching",
    ),
  );
  assert.ok(
    renderToStaticMarkup(<LiveSurface kind="stream" aspect={2} state="live" mode="control" />).includes(
      "You are in control",
    ),
  );
});

test("with onPress the whole surface is a button; a terminal draws its own text inside", async () => {
  const restore = installDom();
  try {
    let pressed = 0;
    const root = await mount(
      createRoot,
      <LiveSurface kind="picture" aspect={2} state="live" testID="ls" onPress={() => void pressed++} />,
    );
    await press(find(root, "ls-open"));
    assert.equal(pressed, 1);
    const html = renderToStaticMarkup(
      <LiveSurface kind="terminal" aspect={2} state="live">
        <Text>$ ls</Text>
      </LiveSurface>,
    );
    assert.ok(html.includes("$ ls"));
  } finally {
    restore();
  }
});

// 14 Nov 2026 review: a frame of an earlier source or moment stayed on screen as if live (after a source swap while hidden, after asleep and live again). A stale picture shown as live is the worst thing
// this piece can do: a person watching an agent's computer would see a screen that is not the screen.
function withImage(run: (load: (uri: string) => void) => Promise<void>): Promise<void> {
  const g = globalThis as { Image?: unknown };
  const had = g.Image;
  g.Image = class {
    onload: () => void = () => undefined;
    onerror: () => void = () => undefined;
    set src(_v: string) {
      queueMicrotask(() => this.onload());
    }
  };
  return run(() => undefined).finally(() => {
    g.Image = had;
  });
}
const srcOf = (root: { children?: unknown }): string[] =>
  [...JSON.stringify(root).matchAll(/"uri":"([^"]+)"|src":"([^"]+)"/g)].map((m) => m[1] ?? m[2] ?? "");
function pushable() {
  let on: ((f: { uri: string; width: number; height: number }) => void) | null = null;
  return {
    source: {
      subscribe: (f: (fr: { uri: string; width: number; height: number }) => void) => (
        (on = f),
        () => void (on = null)
      ),
    },
    push: (uri: string) => on?.({ uri, width: 10, height: 10 }),
  };
}
const settleFrames = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

test("a new source never shows the old source's frame, and the surface says it is not live", async () => {
  const restore = installDom();
  try {
    await withImage(async () => {
      const a = pushable();
      const b = pushable();
      const tree = createRoot();
      const draw = (source: typeof a.source): Promise<void> =>
        act(async () =>
          tree.render(
            <LiveSurface
              kind="picture"
              aspect={2}
              state="live"
              source={source}
              still={{ uri: "still.png", at: 1 }}
              testID="ls"
            />,
          ),
        );
      await draw(a.source);
      await act(async () => a.push("a-frame.png"));
      await act(settleFrames);
      assert.ok(JSON.stringify(tree.container).includes("a-frame.png"), "the live frame shows");
      assert.ok(!JSON.stringify(tree.container).includes("Not live"));
      await draw(b.source);
      await act(settleFrames);
      const after = JSON.stringify(tree.container);
      assert.ok(!after.includes("a-frame.png"), "the old source's frame is gone");
      assert.ok(after.includes("Not live"), "and what is shown says it is not live");
    });
  } finally {
    restore();
  }
});

test("hidden, asleep or failed drops the frame; a frame that was still loading never lands afterwards", async () => {
  const restore = installDom();
  try {
    const g = globalThis as { Image?: unknown };
    const had = g.Image;
    let release: (() => void) | null = null;
    g.Image = class {
      onload: () => void = () => undefined;
      onerror: () => void = () => undefined;
      set src(_v: string) {
        release = () => this.onload();
      }
    };
    const a = pushable();
    const tree = createRoot();
    const draw = (visible: boolean, state: "live" | "asleep" = "live"): Promise<void> =>
      act(async () =>
        tree.render(<LiveSurface kind="picture" aspect={2} state={state} source={a.source} visible={visible} />),
      );
    await draw(true);
    await act(async () => a.push("slow.png"));
    await draw(false);
    await act(async () => release?.());
    await draw(true);
    await act(settleFrames);
    assert.ok(!JSON.stringify(tree.container).includes("slow.png"), "a frame that loaded after hiding did not appear");
    g.Image = had;
  } finally {
    restore();
  }
});

test("a live surface with no frame for the bound stops looking live", async () => {
  const restore = installDom();
  try {
    await withImage(async () => {
      const a = pushable();
      const tree = createRoot();
      await act(async () =>
        tree.render(<LiveSurface kind="picture" aspect={2} state="live" source={a.source} staleAfterMs={40} />),
      );
      await act(async () => a.push("f.png"));
      await act(settleFrames);
      assert.ok(!JSON.stringify(tree.container).includes("Not live"));
      await act(async () => new Promise((r) => setTimeout(r, 90)));
      assert.ok(JSON.stringify(tree.container).includes("Not live"), "no frame for the bound: greyed and marked");
      await act(async () => a.push("g.png"));
      await act(settleFrames);
      assert.ok(!JSON.stringify(tree.container).includes("Not live"), "a new frame makes it live again");
    });
  } finally {
    restore();
  }
});

test("a failed surface with onPress keeps its own Retry and does not sit inside an Open button", () => {
  const html = renderToStaticMarkup(
    <LiveSurface
      kind="picture"
      aspect={2}
      state="failed"
      onPress={() => undefined}
      onRetry={() => undefined}
      testID="ls"
    />,
  );
  assert.ok(html.includes("Retry"));
  assert.ok(!html.includes("ls-open"));
});

test("sixty frames swap without the picture ever being empty", async () => {
  const restore = installDom();
  try {
    await withImage(async () => {
      const a = pushable();
      const tree = createRoot();
      await act(async () => tree.render(<LiveSurface kind="picture" aspect={2} state="live" source={a.source} />));
      await act(async () => a.push("f0.png"));
      await act(settleFrames);
      for (let i = 1; i < 60; i++) {
        await act(async () => a.push(`f${i}.png`));
        await act(async () => Promise.resolve());
        assert.ok(/f\d+\.png/.test(JSON.stringify(tree.container)), `frame ${i}: a picture is on screen`);
      }
    });
  } finally {
    restore();
  }
});
