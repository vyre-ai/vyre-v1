// The shell's holder (the still copy that keeps a first visit from ever showing a blank frame) is installed once and stays while the shell draws again. Re-installing it on every draw took the copy that was
// queued after the press down with it (step 5 first run: Files, Records, Settings and Vault showed a blank frame on a first visit; the perf run's blank count is 0 only while this holds).
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { View } from "react-native";
import { createRoot } from "test-renderer";
import { flush, installDom } from "../../../../../ui/src/testing/dom.ts";
import { Sheets } from "./Shell.tsx";
import { SidebarSlotProvider } from "../sidebar/SidebarSlot.tsx";

test("a re-render storm, each with a new keptKey closure, never takes the holder down", async () => {
  const undo = installDom();
  try {
    const log: string[] = [];
    const hub = { setHolder: (fn: unknown) => void log.push(fn === null ? "off" : "on") } as never;
    const r = createRoot();
    const draw = (n: number) => (
      <SidebarSlotProvider deviceId="d1" personId="p1" spaceId="northwind" place="chats" epoch={1} compact={false}>
        <Sheets hub={hub} shown="tab1" scope="1:spc" keptKey={(p) => `${n}:${p}`} tabs={<View />}>
          <View />
        </Sheets>
      </SidebarSlotProvider>
    );
    await act(async () => {
      r.render(draw(0));
    });
    for (let i = 1; i <= 8; i++)
      await act(async () => {
        r.render(draw(i));
      });
    await flush();
    assert.deepEqual(log, ["on"], "installed once, never taken down while the shell draws");
    await act(async () => {
      r.unmount();
    });
    assert.deepEqual(log, ["on", "off"]);
  } finally {
    undo();
  }
});
