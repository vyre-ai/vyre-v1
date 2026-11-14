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
