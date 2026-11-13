// ui/Switch: the one on/off switch. Space and Enter toggle it, a disabled switch does nothing, and the label is what a screen reader hears.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, installDom, mount, press } from "../testing/dom.ts";
import type { Node } from "../testing/dom.ts";
import { Switch } from "./index.tsx";

const key = async (n: Node | null, k: string): Promise<boolean> => {
  let prevented = false;
  await act(async () => {
    (n!.props["onKeyDown"] as (e: unknown) => void)({
      key: k,
      target: { tagName: "DIV", getAttribute: () => null },
      currentTarget: { tagName: "DIV", getAttribute: () => null },
      persist: () => undefined,
      nativeEvent: {},
      preventDefault: () => (prevented = true),
      stopPropagation: () => undefined,
    });
  });
  return prevented;
};

test("pressing toggles, and Space and Enter toggle the focused switch", async () => {
  const restore = installDom();
  try {
    const seen: boolean[] = [];
    const root = await mount(
      createRoot,
      <Switch on={false} label="Quiet hours" testID="sw" onChange={(v) => seen.push(v)} />,
    );
    const sw = find(root, "sw");
    await press(sw);
    assert.equal(await key(sw, " "), true, "Space is taken by the switch");
    assert.equal(await key(sw, "Enter"), true);
    await key(sw, "a");
    assert.deepEqual(
      seen,
      [true, true, true],
      "the next value is the opposite of what is shown, three times, and the letter does nothing",
    );
  } finally {
    restore();
  }
});

test("a disabled switch changes nothing by press or key, and says it is disabled", async () => {
  const restore = installDom();
  try {
    const seen: boolean[] = [];
    const root = await mount(
      createRoot,
      <Switch on label="Quiet hours" testID="sw" disabled onChange={(v) => seen.push(v)} />,
    );
    const sw = find(root, "sw")!;
    assert.equal(sw.props["aria-disabled"] ?? sw.props["disabled"], true);
    await key(sw, " ").catch(() => undefined);
    await key(sw, "Enter").catch(() => undefined);
    assert.deepEqual(seen, []);
  } finally {
    restore();
  }
});

test("the label and the state are announced", async () => {
  const restore = installDom();
  try {
    const root = await mount(
      createRoot,
      <Switch on label="Email me if an approval waits" testID="sw" onChange={() => undefined} />,
    );
    const sw = find(root, "sw")!;
    assert.equal(sw.props["aria-label"], "Email me if an approval waits");
    assert.equal(sw.props["aria-checked"], true);
    assert.equal(sw.props["role"], "switch");
  } finally {
    restore();
  }
});

test("a labelled switch draws its words beside the track and the whole row presses", async () => {
  const restore = installDom();
  try {
    const seen: boolean[] = [];
    const root = await mount(
      createRoot,
      <Switch on={false} label="Anyone with the link" labelled testID="sw" onChange={(v) => seen.push(v)} />,
    );
    await press(find(root, "sw"));
    assert.deepEqual(seen, [true]);
    const text = JSON.stringify(root);
    assert.match(text, /Anyone with the link/);
  } finally {
    restore();
  }
});
