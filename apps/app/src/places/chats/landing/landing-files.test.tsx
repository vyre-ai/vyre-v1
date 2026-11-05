// New chat takes a dropped or pasted file like the chat itself: the chat starts without a first message, then the words go with the file, stored in Chat uploads. A file
// is never dropped on the floor. Synthetic DataTransfers with File objects.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import type { LiveQuery, ScreenHooks } from "../../../../../../client/src/index.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { createSample } from "../conversation/sample.ts";
import { createSampleSidebar } from "../sidebar/sample.ts";
import type { Principal } from "../../../shell/session/runtime-data.ts";
import { ResumeContext } from "../../../onboarding/resume-context.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { Landing } from "./Landing.tsx";

installComposerForTests(Composer);

const ME: Principal = { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" };
const ready = (data: unknown): LiveQuery<unknown> => { const snap = { status: "ready" as const, data }; return { subscribe: () => () => undefined, getSnapshot: () => snap }; };
type Call = { cap: string; input: Record<string, unknown> };

function runtime(): { rt: ShellRuntime; calls: Call[]; opened: string[] } {
  const side = createSampleSidebar();
  const conv = createSample("idle");
  const calls: Call[] = [];
  const opened: string[] = [];
  let made = 0;
  const fixed: Record<string, LiveQuery<unknown>> = {
    "tasks.my-work.needs": ready({ items: [], total: 0 }),
    "chats.sidebar.recent": ready({ starred: [], today: [], yesterday: [], earlier: [], archived: [], nextUnread: null }),
  };
  const screens: ScreenHooks = { query: (id, name, state) => fixed[`${id}.${name}`] ?? (id === "chats.conversation" ? conv.data.screens : side.data.screens).query(id, name, state) };
  const principals: LiveQuery<Principal[]> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: [ME] }) };
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "chat.start") return { thread: { threadId: "thr_new" } };
    if (cap === "chat.post") return { message: { messageId: "msg_1", threadSeq: 1 } };
    if (cap === "files.tree") return { roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 }] };
    if (cap === "files.list") return { files: [], folders: [{ folderId: "fld_uploads", name: "Chat uploads" }], hasMore: false };
    if (cap === "files.create") return { file: { fileId: `fil_${++made}`, name: (input as { name: string }).name } };
    return conv.data.call(cap, input);
  };
  const rt: ShellRuntime = {
    screens, call: call as ShellRuntime["call"], connection: conv.data.connection, principals, recordTitle: () => undefined, me: ME, clock: conv.data.clock,
    space: { id: "northwind", kind: "personal", name: "Personal" }, assistant: { id: "agt_assistant", name: "Assistant" }, aiConnected: true, deferredModules: new Set<string>(), isDeferred: () => false, calendarConnected: false,
    open: () => undefined, openUrl: () => undefined,
  };
  return { rt, calls, opened };
}

const noop = (): void => undefined;
const ev = (dt: object) => { const e = { dataTransfer: dt, clipboardData: dt, prevented: 0, preventDefault() { e.prevented++; }, stopPropagation() { /* innermost zone */ } }; return e; };
async function fire(n: Node | null, name: string, e: object): Promise<void> {
  if (!n) throw new Error("node not found");
  await act(async () => { (n.props[name] as (x: object) => void)(e); });
  await flush();
}

test("a screenshot dropped on New chat starts the chat, then posts the words with the file stored in Chat uploads", async () => {
  const off = installDom();
  try {
    const { rt, calls } = runtime();
    const opened: string[] = [];
    const said: string[] = [];
    const root = await mount(createRoot, (
      <ResumeContext.Provider value={{ done: 8, total: 8, open: noop, pill: null }}>
        <Landing rt={rt} nameOf={(id) => id} kindOf={() => "agent"} openChat={(id) => void opened.push(id)} openTasks={noop} openNeed={noop} openProfile={noop} fill={noop} newKey={() => "k"} say={(t) => void said.push(t)} />
      </ResumeContext.Provider>
    ));
    const shot = new File([new Uint8Array([1, 2, 3])], "Screenshot 2026-11-03 at 10.14.02.png", { type: "image/png" });
    await fire(find(root, "composer-drop"), "onDrop", ev({ types: ["Files"], files: [shot] }));
    assert.match(textOf(find(root, "composer-file-0")), /Screenshot/);
    await press(find(root, "composer-send"));
    for (let i = 0; i < 20 && opened.length === 0; i++) await flush();
    const start = calls.find((c) => c.cap === "chat.start")!;
    assert.equal(start.input["first"], undefined, "the first message is posted with the file, not started bare");
    assert.equal(start.input["title"], "Screenshot 2026-11-03 at 10.14.02.png", "no words: the chat is named after the file");
    const post = calls.find((c) => c.cap === "chat.post")!;
    assert.equal(post.input["threadId"], "thr_new");
    assert.deepEqual(post.input["attachments"], ["fil_1"]);
    assert.equal(calls.find((c) => c.cap === "files.create")?.input["folderId"], "fld_uploads");
    assert.deepEqual(opened, ["thr_new"]);
    assert.deepEqual(said, []);
  } finally { off(); }
});
