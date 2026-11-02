import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { CatchUpLine, catchUpLine } from "./catch-up.tsx";
import { ConversationDataProvider } from "./data.tsx";
import { find, flush, installDom } from "../../../../../../ui/src/testing/dom.ts";

const name = (id: string): string => ({ usr_maya: "Maya Chen", usr_noah: "Noah Reed" })[id] ?? id;
const base = { unread: 0, firstMessageId: null, people: [], tasks: [], decisions: [], at: [] };

test("the catch-up line says how many, from whom, what was decided or made a task, and how many name you; a count only when nobody is named; it is empty for one message", () => {
  assert.equal(catchUpLine({ ...base, unread: 1, people: [{ id: "usr_maya", count: 1 }] }, name, 0), "");
  assert.equal(catchUpLine({ ...base, unread: 3, people: [{ id: "usr_maya", count: 3 }] }, name, 0), "Maya wrote.");
  assert.equal(catchUpLine({ ...base, unread: 4 }, name, 0), "4 new messages.");
  assert.equal(catchUpLine({ ...base, unread: 3, people: [{ id: "usr_maya", count: 3 }], decisions: [{ messageId: "m", text: "y" }] }, name, 1), "Maya wrote. 1 decision and you're mentioned.");
  const full = { ...base, unread: 9, people: [{ id: "usr_maya", count: 5 }, { id: "usr_noah", count: 4 }], tasks: [{ messageId: "m1", title: "x" }], decisions: [{ messageId: "m2", text: "y" }, { messageId: "m3", text: "z" }] };
  assert.equal(catchUpLine(full, name, 1), "Maya and 1 other wrote. 2 decisions, 1 task, and you're mentioned.");
});

test("a person is never told they wrote: their own messages are dropped, and an agent replied", () => {
  const c = { ...base, unread: 3, people: [{ id: "usr_me", count: 3 }] };
  assert.equal(catchUpLine(c, name, 0, { meId: "usr_me" }), "", "only my own messages: nothing to say");
  const mixed = { ...base, unread: 5, people: [{ id: "usr_me", count: 3 }, { id: "agt_x", count: 2 }] };
  assert.equal(catchUpLine(mixed, name, 0, { meId: "usr_me", kindOf: (id) => (id.startsWith("agt_") ? "agent" : "person") }), "agt_x replied.");
});

test("an agent keeps its whole name in the line, a person goes by their first name", () => {
  const names = (id: string): string => (id === "agt_a" ? "Assistant" : id === "agt_b" ? "Data Scout" : "Maya Chen");
  const kindOf = (id: string): "person" | "agent" => (id.startsWith("agt_") ? "agent" : "person");
  assert.equal(catchUpLine({ ...base, unread: 2, people: [{ id: "agt_b", count: 2 }] }, names, 0, { kindOf }), "Data Scout replied.");
  assert.equal(catchUpLine({ ...base, unread: 2, people: [{ id: "usr_maya", count: 2 }] }, names, 0, { kindOf }), "Maya wrote.");
});

function chat(calls: string[], answer: unknown) {
  return { threadId: "thr_1", me: { id: "usr_me", name: "Me" }, nameOf: (id: string) => id, kindOf: () => "person" as const, call: async (cap: string) => { calls.push(cap); return cap === "chat.catch_up" ? answer : { unread: 0 }; } };
}
const waiting = { ...base, unread: 3, firstMessageId: "msg_1", people: [{ id: "usr_maya", count: 3 }] };

test("an open chat is read: what you missed is taken first, then the cursor moves, and each new message moves it again", async () => {
  installDom();
  const calls: string[] = [];
  const data = chat(calls, waiting);
  const r = createRoot();
  const line = (newest: string) => <ConversationDataProvider value={data as never}><CatchUpLine onJump={() => undefined} newest={newest} /></ConversationDataProvider>;
  await act(async () => { r.render(line("msg_3")); });
  await flush();
  assert.deepEqual(calls, ["chat.catch_up", "threads.mark_read"], "the summary is read before the cursor moves, or it would have nothing to say");
  assert.ok(find(r.container as never, "catch-up"), "the line still shows what was missed");
  await act(async () => { r.render(line("msg_3")); });
  assert.equal(calls.filter((c) => c === "threads.mark_read").length, 1, "nothing new, nothing written");
  await act(async () => { r.render(line("msg_4")); });
  await flush();
  assert.equal(calls.filter((c) => c === "threads.mark_read").length, 2, "a reply that lands on an open chat is read");
});

test("a chat in a window that is not showing stays unread until the window is back", async () => {
  installDom();
  const page = globalThis as unknown as { document: { visibilityState?: string } };
  const before = page.document.visibilityState;
  page.document.visibilityState = "hidden";
  try {
    const calls: string[] = [];
    const r = createRoot();
    await act(async () => { r.render(<ConversationDataProvider value={chat(calls, base) as never}><CatchUpLine onJump={() => undefined} newest="msg_3" /></ConversationDataProvider>); });
    await flush();
    assert.deepEqual(calls, ["chat.catch_up"]);
  } finally { page.document.visibilityState = before as string; }
});
