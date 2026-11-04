// A task's description takes files: dropped on it, or pasted while it is being written, they are stored in Chat uploads (the composer's path) and linked to the task, and the
// line under it says where they went. Synthetic DataTransfers with File objects.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import type { LiveQuery, ScreenHooks } from "../../../../../../client/src/index.ts";
import { createSample } from "../conversation/sample.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { TaskDetail } from "./TaskDetail.tsx";

type Call = { cap: string; input: Record<string, unknown> };
const NOW = Date.UTC(2026, 10, 3, 9);
const TASK = {
  id: "tsk_1", key: "VY-1", kind: "work", title: "Review the lease", state: "todo", blocked: false, assigned: { kind: "person", id: "usr_irfad" }, createdBy: "usr_irfad",
  blocks: [], actions: [], fileIds: [], dependsOn: [], followers: [], workingNotes: { brief: "Check the renewal terms." }, labels: [], fields: {}, reviewLoops: 0, createdAt: NOW, updatedAt: NOW,
};
const fixed = (snap: unknown): LiveQuery<unknown> => ({ subscribe: () => () => undefined, getSnapshot: () => snap as never });
const TASK_Q = fixed({ status: "ready", data: { task: TASK } });
const EMPTY_Q = fixed({ status: "ready", data: { entries: [] } });
const PEOPLE = { status: "ready", data: [{ id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }] } as const;

function runtime(fail = false): { rt: ShellRuntime; calls: Call[] } {
  const conv = createSample("idle");
  const calls: Call[] = [];
  let made = 0;
  const screens: ScreenHooks = { query: (_id, name) => (name === "task" ? TASK_Q : EMPTY_Q) as never };
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "chat.start") return {};
    if (cap === "tasks.index") return { rev: "1", unchanged: false, rows: [], doneThisWeek: 0, total: 0 };
    if (cap === "files.tree") return { roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 }] };
    if (cap === "files.list") return { files: [], folders: [{ folderId: "fld_uploads", name: "Chat uploads" }], hasMore: false };
    if (cap === "files.create") { if (fail) throw new Error("Brief.pdf could not be saved"); return { file: { fileId: `fil_${++made}`, name: (input as { name: string }).name } }; }
    if (cap === "tasks.links.add") return { task: { ...TASK, fileIds: [(input as { fileId: string }).fileId], updatedAt: NOW + 1 } };
    return {};
  };
  const rt = {
    screens, call, connection: conv.data.connection, principals: { subscribe: () => () => undefined, getSnapshot: () => PEOPLE }, recordTitle: () => undefined,
    me: { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }, clock: conv.data.clock, space: { id: "northwind", kind: "team", name: "Northwind" }, assistant: { id: "agt_assistant", name: "Assistant" },
    aiConnected: true, deferredModules: new Set<string>(), isDeferred: () => false, calendarConnected: false, open: () => undefined, openUrl: () => undefined,
  } as unknown as ShellRuntime;
  return { rt, calls };
}

const ev = (dt: object) => { const e = { dataTransfer: dt, clipboardData: dt, prevented: 0, preventDefault() { e.prevented++; }, stopPropagation() { /* innermost zone */ } }; return e; };
async function fire(n: Node | null, name: string, e: object): Promise<void> {
  if (!n) throw new Error("node not found");
  await act(async () => { (n.props[name] as (x: object) => void)(e); });
  await flush();
}
const wait = async (until: () => boolean): Promise<void> => { for (let i = 0; i < 20 && !until(); i++) await flush(); };
const page = (rt: ShellRuntime) => <TaskDetail rt={rt} taskId="tsk_1" rail={false} conversationFor={() => { throw new Error("no thread in this test"); }} openTask={() => undefined} openAgent={() => undefined} openChat={() => undefined} />;

test("a file dropped on the description is stored and linked to the task", async () => {
  const off = installDom();
  try {
    const { rt, calls } = runtime();
    const root = await mount(createRoot, page(rt));
    const zone = find(root, "task-brief-drop");
    await fire(zone, "onDragEnter", ev({ types: ["Files"], files: [] }));
    assert.match(textOf(find(root, "drop-overlay")), /Drop to attach/);
    await fire(zone, "onDrop", ev({ types: ["Files"], files: [new File([new Uint8Array([1])], "Lease.pdf", { type: "application/pdf" })] }));
    await wait(() => calls.some((c) => c.cap === "tasks.links.add"));
    assert.equal(calls.find((c) => c.cap === "files.create")?.input["folderId"], "fld_uploads");
    assert.deepEqual(calls.find((c) => c.cap === "tasks.links.add")?.input, { taskId: "tsk_1", fileId: "fil_1" });
    await wait(() => /under Outputs/.test(textOf(find(root, "task-brief-files"))));
    assert.match(textOf(find(root, "task-brief-files")), /Attached\. It is under Outputs/);
  } finally { off(); }
});

test("a screenshot pasted while the description is being written is attached; a failure says so", async () => {
  const off = installDom();
  try {
    const { rt, calls } = runtime(true);
    const root = await mount(createRoot, page(rt));
    await press(find(root, "task-brief"));
    assert.ok(find(root, "task-brief-edit"), "writing the description");
    assert.ok(find(find(root, "task-brief-edit")!, "markdown-editor-host"), "the description is written in the shared Markdown editor");
    assert.ok(find(root, "task-brief-done"), "Done closes it; a pause after typing saves");
    assert.ok(find(find(root, "rail-notes") ?? { props: {} }, "markdown-editor-host") || find(root, "rail-notes") === null, "the working notes use the same editor where the rail is drawn");
    await fire(find(root, "task-brief-drop"), "onPaste", ev({ types: ["Files"], files: [new File([new Uint8Array([1])], "Brief.pdf", { type: "application/pdf" })] }));
    await wait(() => /could not be saved/.test(textOf(find(root, "task-brief-files"))));
    assert.match(textOf(find(root, "task-brief-files")), /Brief\.pdf could not be saved/);
    assert.equal(calls.some((c) => c.cap === "tasks.links.add"), false);
  } finally { off(); }
});
