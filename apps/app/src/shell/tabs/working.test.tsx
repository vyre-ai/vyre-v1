// A chat's tab shows the working mark while its agent, or the helpers it left running in the background, work (owner, rc.28 report, 16 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { tabSpecs } from "./MainTabs.tsx";
import { setWorkingThreads, subscribeWorking, threadOfTab, watchWorking, workingThreads } from "./working.ts";
import type { TabEntry } from "./store.ts";

const chat = (id: string): TabEntry => ({
  key: `chats:${id}`,
  title: `Chat ${id}`,
  place: "chats",
  hash: `screen=chats.conversation&threadId=${id}`,
});

test("the tab of a chat that works has the mark, others have none, and the mark goes when it stops", () => {
  const tabs: TabEntry[] = [chat("thr_a"), chat("thr_b"), { key: "files", title: "Files", place: "files" }];
  const lead = (w: string[]): Array<boolean> =>
    tabSpecs(tabs, new Set(w)).map((t) => (t as { lead?: unknown }).lead !== undefined);
  assert.deepEqual(lead(["thr_a"]), [true, false, false]);
  assert.deepEqual(lead([]), [false, false, false]);
  assert.equal(threadOfTab(tabs[2]!), undefined);
  assert.equal(threadOfTab({ hash: "screen=chats.conversation&threadId=thr_x" }), "thr_x");
});

test("the store hears each change once, and an equal set is no change", () => {
  let heard = 0;
  const off = subscribeWorking(() => heard++);
  setWorkingThreads(["thr_a"]);
  setWorkingThreads(["thr_a"]);
  assert.equal(heard, 1);
  setWorkingThreads([]);
  assert.equal(heard, 2);
  off();
});

test("the watcher marks the chats engine.now names, again when the Space changes, and clears when it stops", async () => {
  let rows = [{ threadId: "thr_a" }, {}];
  let tick: () => void = () => undefined;
  const stop = watchWorking({
    call: async () => ({ working: rows }),
    onInvalidate: (l) => {
      tick = l;
      return () => undefined;
    },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual([...workingThreads()], ["thr_a"]);
  rows = [];
  assert.equal(typeof tick, "function");
  stop();
  assert.deepEqual([...workingThreads()], []);
});
