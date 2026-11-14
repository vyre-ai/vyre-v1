// A switch that changes a watched setting through useChange (the first thing a person presses that uses it): after quick presses it ends on what was pressed last, and when the calls fail it ends on
// what the server last confirmed.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, installDom, mount, press } from "../../../../ui/src/testing/dom.ts";
import { Switch } from "../../../../ui/src/Switch/index.tsx";
import { createRemoteScreenHooks } from "../shell/session/remote-hooks.ts";
import { CapCallProvider } from "./call.tsx";
import type { CapCall } from "./call.tsx";
import { ScreensProvider } from "./screens.tsx";
import { useChange } from "./useChange.ts";
import { useLoad } from "./useLoad.ts";

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

async function rig(call: CapCall) {
  const hooks = createRemoteScreenHooks({ screens: new Map(), read: async () => ({ on: false }) });
  let shown: boolean | null = null;
  const Row = (): null => {
    const load = useLoad<{ on: boolean }>({ cap: "things.get", input: { id: "t1" } });
    const change = useChange("things.set", {
      optimistic: (input) => ({
        cap: "things.get",
        input: { id: "t1" },
        apply: () => ({ on: (input as { on: boolean }).on }),
      }),
    });
    shown = load.state === "ready" ? load.data.on : null;
    return <Switch on={shown === true} label="Quiet hours" testID="sw" onChange={(on) => void change.run({ on })} />;
  };
  const root = await mount(
    createRoot,
    <ScreensProvider screens={hooks}>
      <CapCallProvider call={call}>
        <Row />
      </CapCallProvider>
    </ScreensProvider>,
  );
  await act(async () => settle());
  return { root, shown: () => shown };
}

test("pressed on, off, on in a row, the switch ends on what was pressed last and the server is told in that order", async () => {
  const restore = installDom();
  try {
    const told: boolean[] = [];
    const t = await rig(async (_c, input) => (told.push((input as { on: boolean }).on), {}));
    assert.equal(t.shown(), false);
    await press(find(t.root, "sw"));
    await press(find(t.root, "sw"));
    await press(find(t.root, "sw"));
    assert.equal(t.shown(), true, "on screen: the last press");
    await act(async () => settle());
    assert.deepEqual(told, [true, false, true], "no press was dropped");
  } finally {
    restore();
  }
});

test("when every call fails, the switch goes back to what the server last confirmed", async () => {
  const restore = installDom();
  try {
    const t = await rig(async () => {
      throw Object.assign(new Error("The server did not answer"), { code: "internal.error" });
    });
    await press(find(t.root, "sw"));
    await press(find(t.root, "sw"));
    await press(find(t.root, "sw"));
    await act(async () => settle());
    assert.equal(t.shown(), false);
  } finally {
    restore();
  }
});
