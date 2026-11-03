// A task made from a meeting close-out says which meeting it came from ("From Lee Holdings renewal"), and the chip opens that close-out in the Inbox's Meetings tab.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { LiveQuery, ScreenHooks } from "../../../../../../client/src/index.ts";
import { createSample } from "../conversation/sample.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { TaskDetail } from "./TaskDetail.tsx";

const NOW = Date.UTC(2026, 10, 3, 9);
const MEETING = "rec_meet0001";
const TASK = {
  id: "tsk_1", key: "VY-1", kind: "work", title: "Send Pat the revised quote", state: "todo", blocked: false, assigned: { kind: "person", id: "usr_irfad" }, createdBy: "usr_irfad",
  blocks: [], actions: [], fileIds: [], dependsOn: [], followers: [], workingNotes: {}, labels: [], fields: {}, reviewLoops: 0, createdAt: NOW, updatedAt: NOW, source: { kind: "meeting", id: MEETING },
};
const fixed = (snap: unknown): LiveQuery<unknown> => ({ subscribe: () => () => undefined, getSnapshot: () => snap as never });
const PEOPLE = { status: "ready", data: [{ id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }] } as const;

test("a task from a meeting says From and the meeting, and opens its close-out", async () => {
  const off = installDom();
  try {
    const conv = createSample("idle");
    const opened: unknown[] = [];
    const screens: ScreenHooks = { query: (_id, name) => (name === "task" ? fixed({ status: "ready", data: { task: TASK } }) : fixed({ status: "ready", data: { entries: [] } })) as never };
    const call = async (cap: string): Promise<unknown> => {
      if (cap === "meetings.closeout.get") return { title: "Lee Holdings renewal" };
      if (cap === "tasks.index") return { rev: "1", unchanged: false, rows: [], doneThisWeek: 0, total: 0 };
      return {};
    };
    const rt = {
      screens, call, connection: conv.data.connection, principals: { subscribe: () => () => undefined, getSnapshot: () => PEOPLE }, recordTitle: () => undefined,
      me: { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }, clock: conv.data.clock, space: { id: "northwind", kind: "team", name: "Northwind" }, assistant: { id: "agt_assistant", name: "Assistant" },
      aiConnected: true, deferredModules: new Set<string>(), isDeferred: () => false, calendarConnected: false, open: (t: unknown) => void opened.push(t), openUrl: () => undefined,
    } as unknown as ShellRuntime;
    const root = await mount(createRoot, <TaskDetail rt={rt} taskId="tsk_1" rail={false} conversationFor={() => { throw new Error("no thread in this test"); }} openTask={() => undefined} openAgent={() => undefined} openChat={() => undefined} />);
    await flush();
    const chip = find(root, "task-chip");
    assert.match(textOf(chip), /From Lee Holdings renewal/);
    await press(chip);
    assert.deepEqual(opened, [{ subject: { type: "meeting", id: MEETING } }]);
  } finally { off(); }
});
