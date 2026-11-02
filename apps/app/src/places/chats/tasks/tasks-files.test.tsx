// Tasks takes files the way a chat does. A file dropped or pasted on quick add is held beside the line and becomes the new task's attachment (a file alone names the task); a
// file in the Ask line under the list starts the chat with it. Both are stored in Chat uploads, the composer's path. Synthetic DataTransfers with File objects.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import type { LiveQuery, ScreenHooks } from "../../../../../../client/src/index.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { createSample } from "../conversation/sample.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { TasksPage } from "./TasksPage.tsx";

installComposerForTests(Composer);

type Call = { cap: string; input: Record<string, unknown> };
const LOADING = { status: "loading" } as const;
const loading: LiveQuery<unknown> = { subscribe: () => () => undefined, getSnapshot: () => LOADING as never };
const PEOPLE = { status: "ready", data: [{ id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }] } as const;

function runtime(): { rt: ShellRuntime; calls: Call[]; opened: unknown[] } {
  const conv = createSample("idle");
  const calls: Call[] = [];
  const opened: unknown[] = [];
  let made = 0;
  const screens: ScreenHooks = { query: () => loading as never };
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "tasks.index") return { rev: "1", unchanged: false, rows: [], doneThisWeek: 0, total: 0 };
    if (cap === "views.list") return { views: [] };
    if (cap === "projects.list") return { projects: [] };
    if (cap === "tasks.create") return { task: { id: "tsk_new" } };
    if (cap === "chat.start") return { thread: { threadId: "thr_new" } };
    if (cap === "chat.post") return { message: { messageId: "msg_1", threadSeq: 1 } };
    if (cap === "files.tree") return { roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 }] };
    if (cap === "files.list") return { files: [], folders: [{ folderId: "fld_uploads", name: "Chat uploads" }], hasMore: false };
    if (cap === "files.create") return { file: { fileId: `fil_${++made}`, name: (input as { name: string }).name } };
    throw new Error(`unexpected ${cap}`);
  };
  const principals = { subscribe: () => () => undefined, getSnapshot: () => PEOPLE };
  const rt = {
    screens, call, connection: conv.data.connection, principals, recordTitle: () => undefined, me: { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }, clock: conv.data.clock,
    space: { id: "northwind", kind: "team", name: "Northwind" }, assistant: { id: "agt_assistant", name: "Assistant" }, aiConnected: true, deferredModules: new Set<string>(), isDeferred: () => false, calendarConnected: false,
    open: (t: unknown) => void opened.push(t), openUrl: () => undefined,
  } as unknown as ShellRuntime;
  return { rt, calls, opened };
}

const ev = (dt: object) => { const e = { dataTransfer: dt, clipboardData: dt, prevented: 0, preventDefault() { e.prevented++; }, stopPropagation() { /* innermost zone */ } }; return e; };
async function fire(n: Node | null, name: string, e: object): Promise<void> {
  if (!n) throw new Error("node not found");
  await act(async () => { (n.props[name] as (x: object) => void)(e); });
  await flush();
}
async function enter(n: Node | null): Promise<void> {
  if (!n) throw new Error("node not found");
  let prevented = false;
  const e = { key: "Enter", shiftKey: false, nativeEvent: { key: "Enter", isComposing: false }, target: { blur() {} }, currentTarget: { blur() {} }, preventDefault() { prevented = true; }, stopPropagation() {}, isDefaultPrevented: () => prevented, isPropagationStopped: () => false, persist() {} };
  await act(async () => { (n.props.onKeyDown as (x: unknown) => void)(e); });
  await flush();
}
const wait = async (until: () => boolean): Promise<void> => { for (let i = 0; i < 20 && !until(); i++) await flush(); };

test("a file dropped on quick add is held beside the line and becomes the new task's attachment", async () => {
  const off = installDom();
  try {
    const { rt, calls } = runtime();
    const root = await mount(createRoot, <TasksPage rt={rt} openTask={() => undefined} openAgent={() => undefined} openChat={() => undefined} window={{ start: 0, end: 50 }} />);
    const zone = find(root, "task-quick-drop");
    await fire(zone, "onDragEnter", ev({ types: ["Files"], files: [] }));
    assert.match(textOf(find(root, "drop-overlay")), /Drop to attach/);
    const brief = new File([new Uint8Array([1, 2])], "Lease brief.pdf", { type: "application/pdf" });
    await fire(zone, "onDrop", ev({ types: ["Files"], files: [brief] }));
    assert.match(textOf(find(root, "task-quick-files")), /Lease brief\.pdf/, "held beside the line, with a way to take it off");
    await typeInto(find(root, "task-quick-add"), "Review the lease");
    await enter(find(root, "task-quick-add"));
    await wait(() => calls.some((c) => c.cap === "tasks.create"));
    const create = calls.find((c) => c.cap === "tasks.create")!.input;
    assert.equal(create["title"], "Review the lease");
    assert.deepEqual(create["fileIds"], ["fil_1"]);
    assert.equal(calls.find((c) => c.cap === "files.create")?.input["folderId"], "fld_uploads");
    assert.equal(find(root, "task-quick-files"), null, "the line is clear for the next task");
  } finally { off(); }
});

test("a screenshot pasted on quick add with no words names the task after itself", async () => {
  const off = installDom();
  try {
    const { rt, calls } = runtime();
    const root = await mount(createRoot, <TasksPage rt={rt} openTask={() => undefined} openAgent={() => undefined} openChat={() => undefined} window={{ start: 0, end: 50 }} />);
    await fire(find(root, "task-quick-drop"), "onPaste", ev({ types: ["Files"], files: [new File([new Uint8Array([3])], "Screenshot 2026-11-03 at 10.14.02.png", { type: "image/png" })] }));
    await press(find(root, "task-quick-files-remove-0"));
    assert.equal(find(root, "task-quick-files"), null, "a held file can be taken off");
    await fire(find(root, "task-quick-drop"), "onPaste", ev({ types: ["Files"], files: [new File([new Uint8Array([3])], "Screenshot 2026-11-03 at 10.14.02.png", { type: "image/png" })] }));
    await enter(find(root, "task-quick-add"));
    await wait(() => calls.some((c) => c.cap === "tasks.create"));
    const create = calls.find((c) => c.cap === "tasks.create")!.input;
    assert.equal(create["title"], "Screenshot 2026-11-03 at 10.14.02.png");
    assert.deepEqual(create["fileIds"], ["fil_1"], "only the file still held was stored");
  } finally { off(); }
});

test("a file in the Ask line under the list starts the chat with it and opens the chat", async () => {
  const off = installDom();
  try {
    const { rt, calls, opened } = runtime();
    const words: string[] = [];
    const root = await mount(createRoot, <TasksPage rt={rt} openTask={() => undefined} openAgent={() => undefined} openChat={(t) => void words.push(t)} window={{ start: 0, end: 50 }} />);
    await fire(find(root, "tasks-composer-drop"), "onDrop", ev({ types: ["Files"], files: [new File([new Uint8Array([9])], "Invoice.pdf", { type: "application/pdf" })] }));
    await press(find(root, "composer-send"));
    await wait(() => opened.length > 0);
    assert.deepEqual(words, [], "not the words-only door");
    assert.equal(calls.find((c) => c.cap === "chat.start")?.input["first"], undefined);
    assert.deepEqual(calls.find((c) => c.cap === "chat.post")?.input["attachments"], ["fil_1"]);
    assert.deepEqual(opened, [{ subject: { type: "thread", id: "thr_new" } }]);
  } finally { off(); }
});
