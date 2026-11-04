// The desktop artifact frame (desktop-frame.tsx): where the element is goes to the shell, a move is a bounds call, a covered viewer steps aside, leaving closes the page, and the shell's own words
// reach the viewer when it refuses. In a browser there is no shell command and nothing is called.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom } from "../../../../../../ui/src/testing/dom.ts";
import { DesktopArtifactFrame, available, createPlacer, rectOf, sameRect, shellInvoke } from "./desktop-frame.tsx";

test("a rectangle is whole pixels inside the window and never empty", () => {
  assert.deepEqual(rectOf({ left: 10.4, top: 56.6, width: 799.5, height: 600.2 }), { x: 10, y: 57, width: 800, height: 600 });
  assert.deepEqual(rectOf({ left: -5, top: 0, width: 100, height: 100 }), { x: 0, y: 0, width: 100, height: 100 }, "a scrolled-off edge is clamped");
  for (const bad of [{ left: 0, top: 0, width: 0, height: 10 }, { left: NaN, top: 0, width: 10, height: 10 }, { left: 0, top: 0, width: 10, height: 0.2 }]) assert.equal(rectOf(bad), null);
  assert.ok(sameRect({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 }));
  assert.ok(!sameRect({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 5 }));
});

test("in a browser the shell has no command: not available, and the invoke is undefined", () => {
  assert.equal(shellInvoke({}), undefined);
  assert.equal(available({}), false);
  assert.equal(available({ __TAURI__: { core: { invoke: async () => undefined } } }), true);
});

test("the placer shows the page once, then only moves it; a hide takes it away and the next place shows it again; a refusal reaches the viewer", async () => {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const invoke = async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => { calls.push([cmd, args]); return undefined; };
  const url = "https://harbor-a.vyre.run/x/" + "a".repeat(48);
  const p = createPlacer(invoke, url);
  const r1 = { x: 20, y: 80, width: 480, height: 320 };
  p.place(r1);
  p.place({ ...r1 });                       // the same place again says nothing
  p.place({ ...r1, width: 500 });           // a resize is a bounds call
  p.place(null);                            // an element that is not drawn says nothing
  await new Promise<void>((r) => setImmediate(r));
  assert.deepEqual(calls.map(([c]) => c), ["artifact_view_show", "artifact_view_bounds"]);
  assert.deepEqual(calls[0]![1], { url, ...r1 });
  assert.deepEqual(calls[1]![1], { ...r1, width: 500 }, "bounds carry no address");
  p.hide();
  p.place(r1);
  await new Promise<void>((r) => setImmediate(r));
  assert.deepEqual(calls.map(([c]) => c).slice(2), ["artifact_view_hide", "artifact_view_show"], "after a hide the page is shown again");
  const said: string[] = [];
  const refusing = createPlacer(async () => { throw "That address can't be opened in the viewer."; }, url, (m) => said.push(m));
  refusing.place(r1);
  await new Promise<void>((r) => setImmediate(r));
  assert.deepEqual(said, ["That address can't be opened in the viewer."]);
  refusing.place(r1);
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(said.length, 2, "a refused first show is tried again on the next move");
});

test("the frame element renders in the test renderer, and hides the page when it unmounts or is covered", async () => {
  const restore = installDom();
  const { act } = await import("react");
  const calls: string[] = [];
  const invoke = async (cmd: string): Promise<unknown> => { calls.push(cmd); return undefined; };
  try {
    const root = createRoot();
    const url = "https://harbor-a.vyre.run/x/" + "a".repeat(48);
    await act(async () => { root.render(<DesktopArtifactFrame url={url} title="Numbers" invoke={invoke} />); });
    await act(async () => { root.render(<DesktopArtifactFrame url={url} title="Numbers" invoke={invoke} covered />); });
    assert.equal(calls.at(-1), "artifact_view_hide", "a menu or sheet is open: the page steps aside");
    await act(async () => { root.unmount(); });
    assert.equal(calls.at(-1), "artifact_view_hide", "leaving the viewer closes the page");
  } finally { restore(); }
});
