// The live screen (rc.9): the stream is asked for only while the computer is working or taken over, it is drawn over the stand-in, and the person's clicks reach the desktop only while they are in control.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press } from "../../../../../../ui/src/testing/dom.ts";
import { LiveScreen } from "./LiveScreen.tsx";
import { Text } from "react-native";

function rig(state: string, control: boolean) {
  const calls: Array<{ cap: string; input: unknown }> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input });
    if (cap === "computers.stream") return { transport: "mjpeg", url: "/live/cmt_1", ticket: "tk", expiresAt: 1 };
    return {};
  };
  const el = <LiveScreen computerId="cmt_1" state={state} call={call} spaceUrl="https://x.example" now={() => 1} control={control} onIdlePress={() => void calls.push({ cap: "idle", input: null })} testID="ls" label="Intake's computer" style={{ width: 100, height: 60 }}><Text>stand-in</Text></LiveScreen>;
  return { el, calls };
}

test("a working computer shows the stream over the stand-in; a sleeping one asks for none", async () => {
  const restore = installDom();
  try {
    const live = rig("working", false);
    const root = await mount(createRoot, live.el);
    await flush();
    assert.ok(live.calls.some((c) => c.cap === "computers.stream"));
    const img = find(root, "ls-stream");
    assert.ok(img, "the live image is drawn");
    const asleep = rig("asleep", false);
    const root2 = await mount(createRoot, asleep.el);
    await flush();
    assert.ok(!asleep.calls.some((c) => c.cap === "computers.stream"));
    assert.equal(find(root2, "ls-stream"), null);
  } finally { restore(); }
});

test("a press reaches the desktop only in control; otherwise it is the idle press", async () => {
  const restore = installDom();
  try {
    const idle = rig("working", false);
    const root = await mount(createRoot, idle.el);
    await flush();
    await press(find(root, "ls"));
    assert.ok(idle.calls.some((c) => c.cap === "idle"));
    assert.ok(!idle.calls.some((c) => c.cap.startsWith("computers.screen")));
    const mine = rig("takeover", true);
    const root2 = await mount(createRoot, mine.el);
    await flush();
    await press(find(root2, "ls"));
    assert.ok(mine.calls.some((c) => c.cap.startsWith("computers.screen")), "the click went to the agent's desktop");
    assert.ok(!mine.calls.some((c) => c.cap === "idle"));
  } finally { restore(); }
});
