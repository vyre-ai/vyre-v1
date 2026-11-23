// The keyboard goes to the screen by an event, not a timer: a screen drawn with the keyboard on it focuses itself when it mounts, and when the keyboard arrives later; a watching screen takes no focus.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { flush, installDom } from "../../../../../../ui/src/testing/dom.ts";
import { TmuxScreen } from "./TmuxScreen.tsx";

const call = async (): Promise<unknown> => ({ lines: [], cursor: null });

test("a screen focuses itself when drawn with the keyboard, and when the keyboard arrives; watching takes no focus", async () => {
  const undo = installDom();
  const calls: string[] = [];
  let root: ReturnType<typeof createRoot> | null = null;
  Object.defineProperty(Object.prototype, "focus", {
    value: () => void calls.push("focus"),
    configurable: true,
    enumerable: false,
    writable: true,
  });
  try {
    const r = createRoot();
    root = r;
    await act(async () => {
      r.render(<TmuxScreen call={call as never} terminalId="trm_1" keys={false} />);
    });
    await flush();
    assert.deepEqual(calls, [], "watching: no focus");
    await act(async () => {
      r.render(<TmuxScreen call={call as never} terminalId="trm_1" keys />);
    });
    await flush();
    assert.equal(calls.length, 1, "the keyboard arrived: focused once, by the event");
    await new Promise((x) => setTimeout(x, 1200)); // no timer keeps asking
    assert.equal(calls.length, 1);
  } finally {
    await act(async () => {
      (root as unknown as { unmount?: () => void } | null)?.unmount?.();
    });
    delete (Object.prototype as unknown as Record<string, unknown>)["focus"];
    undo();
  }
});
