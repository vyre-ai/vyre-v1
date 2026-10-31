// The shared resize behaviour: width between the floor and the cap, arrow keys, double-click reset, and the width remembered per pane key.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import { installDom, mount, flush } from "../testing/dom.ts";
import { paneWidths } from "./index.tsx";
import { ResizableColumn, keyWidth, useResizable } from "./resize.tsx";
import type { GrowDirection, Resizable } from "./resize.tsx";

function probe(grow: GrowDirection, key: string, out: { r?: Resizable }) {
  return function Probe() {
    out.r = useResizable({ paneKey: key, defaultWidth: 340, grow, min: 280, maxFraction: 0.6 });
    return <div data-w={out.r.width} />;
  };
}

test("keyWidth: a right-hand pane grows on ArrowLeft, a left sidebar on ArrowRight, Home resets, other keys are ignored", () => {
  assert.equal(keyWidth(340, "ArrowLeft", "left", 1280, 280, 0.6), 364);
  assert.equal(keyWidth(340, "ArrowRight", "left", 1280, 280, 0.6), 316);
  assert.equal(keyWidth(240, "ArrowRight", "right", 1280, 200, 0.5), 264);
  assert.equal(keyWidth(240, "ArrowLeft", "right", 1280, 200, 0.5), 216);
  assert.equal(keyWidth(200, "ArrowLeft", "right", 1280, 200, 0.5), 200, "stops at the floor");
  assert.equal(keyWidth(630, "ArrowRight", "right", 1280, 200, 0.5), 640, "stops at the cap");
  assert.equal(keyWidth(300, "Home", "left", 1280, 280, 0.6), "reset");
  assert.equal(keyWidth(300, "x", "left", 1280, 280, 0.6), null);
});

test("the handle changes the width inside the floor and the cap and remembers it per pane key", async () => {
  const restore = installDom();
  try {
    Dimensions.set({ window: { width: 1000, height: 800, scale: 1, fontScale: 1 } });
    const out: { r?: Resizable } = {};
    const Probe = probe("left", "t-resize-a", out);
    await mount(createRoot, <Probe />);
    assert.equal(out.r!.width, 340);
    out.r!.setWidth(5000);
    await flush();
    assert.equal(out.r!.windowWidth, 1000);
    assert.equal(out.r!.width, 600, "never past 60 percent of the window");
    out.r!.setWidth(10);
    await flush();
    assert.equal(out.r!.width, 280, "never under the floor");
    out.r!.setWidth(412);
    await flush();
    assert.equal(out.r!.width, 412);
    assert.equal(paneWidths.get("t-resize-a"), 412, "remembered");
    assert.equal(paneWidths.get("t-resize-b"), null, "per pane key");
    const again: { r?: Resizable } = {};
    const Probe2 = probe("left", "t-resize-a", again);
    await mount(createRoot, <Probe2 />);
    assert.equal(again.r!.width, 412, "a new mount reads it back");
  } finally { restore(); }
});

test("arrow keys resize, and double-click (reset) goes back to the default and forgets the width", async () => {
  const restore = installDom();
  try {
    const out: { r?: Resizable } = {};
    const Probe = probe("left", "t-resize-keys", out);
    await mount(createRoot, <Probe />);
    out.r!.onKey({ key: "ArrowLeft" });
    await flush();
    assert.equal(out.r!.width, 364);
    out.r!.onKey({ key: "ArrowRight" });
    out.r!.onKey({ key: "ArrowRight" });
    await flush();
    assert.equal(out.r!.width, 316);
    assert.equal(paneWidths.get("t-resize-keys"), 316);
    out.r!.reset();
    await flush();
    assert.equal(out.r!.width, 340);
    assert.equal(paneWidths.get("t-resize-keys"), null);
  } finally { restore(); }
});

test("a ResizableColumn draws a labelled separator handle and never pins a width past its container", () => {
  const html = renderToStaticMarkup(<ResizableColumn paneKey="t-col" defaultWidth={300} grow="left" testID="col"><span>body</span></ResizableColumn>);
  assert.match(html, /role="separator"/);
  assert.match(html, /aria-orientation="vertical"/);
  assert.match(html, /max-width:100%/);
  assert.match(html, /r-cursor-/, "a cursor class is set on the handle");
  assert.match(html, /tabindex="0"/i);
});
