// The Chats place in the shell: sidebar and conversation drawn from the runtime's screen hooks, the loading frame without a runtime, and a send that reaches chat.post through `call`.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveQuery } from "../../../../../client/src/index.ts";
import type { ScreenHooks } from "../../../../../client/src/index.ts";
import { createSample } from "../../places/chats/conversation/sample.ts";
import { createSampleSidebar } from "../../places/chats/sidebar/sample.ts";
import type { Principal } from "../../places/home/sections-a/data.tsx";
import ChatsPlace, { newestThread } from "./chats.tsx";
import { conversationData } from "./chats-data.ts";
import { ShellRuntimeProvider } from "./runtime.tsx";
import type { ShellRuntime, ShellTarget } from "./runtime.tsx";

const PEOPLE: Principal[] = [
  { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }, { id: "usr_maya", name: "Maya Chen", kind: "person" },
  { id: "agt_intake", name: "Intake", kind: "agent" }, { id: "agt_docs", name: "Docs", kind: "agent" },
];

function runtime(): { rt: ShellRuntime; calls: { cap: string; input: unknown }[]; opened: ShellTarget[] } {
  const side = createSampleSidebar();
  const conv = createSample("idle");
  const calls: { cap: string; input: unknown }[] = [];
  const opened: ShellTarget[] = [];
  const screens: ScreenHooks = { query: (id, name, state) => (id === "chats.conversation" ? conv.data.screens : side.data.screens).query(id, name, state) };
  const principals: LiveQuery<Principal[]> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: PEOPLE }) };
  const rt: ShellRuntime = {
    screens, call: async (cap, input) => { calls.push({ cap, input }); return conv.data.call(cap, input); }, connection: conv.data.connection, principals,
    recordTitle: () => undefined, me: PEOPLE[0]!, clock: conv.data.clock,
    space: { id: "northwind", kind: "team", name: "Northwind" }, assistant: { id: "agt_assistant", name: "Assistant" }, aiConnected: true, calendarConnected: true,
    open: (t) => void opened.push(t), openUrl: () => undefined,
  };
  return { rt, calls, opened };
}

const html = (rt: ShellRuntime | null): string =>
  renderToStaticMarkup(rt ? <ShellRuntimeProvider value={rt}><ChatsPlace /></ShellRuntimeProvider> : <ChatsPlace />).replaceAll("<!-- -->", "");

test("chats: with a runtime the sidebar lists the Space's chats and the conversation shows the open thread", () => {
  const out = html(runtime().rt);
  assert.ok(out.includes('data-testid="chats-place"'));
  assert.ok(out.includes("Competitor pricing") && out.includes("October invoices"), "the sidebar rows");
  assert.ok(out.includes("Tuesday has two openings"), "the conversation's messages");
  assert.ok(!out.includes("-loading"), "no loading frame once the Space is open");
});

test("chats: before the runtime exists the place draws its own loading frame, never a blank page", () => {
  const out = html(null);
  assert.ok(out.includes('data-testid="chats-place-loading"'));
  assert.ok(out.includes("chats-sidebar-loading") && out.includes("conversation-loading"));
});

test("chats: the newest thread is the first of the starred, today, yesterday and earlier groups, and a local row is never picked", () => {
  const item = (threadId: string) => ({ threadId, kind: "chat" as const, title: threadId, unread: 0 }) as never;
  const recent = { starred: [], today: [item("local_1"), item("t1")], yesterday: [item("t2")], earlier: [], nextUnread: null } as never;
  assert.equal(newestThread(recent), "t1");
  assert.equal(newestThread(undefined), null);
});

test("chats: a send goes through the Space's call as chat.post, in the open thread, with a key", async () => {
  const { rt, calls } = runtime();
  const people = PEOPLE;
  const data = conversationData(rt, { openThread: () => undefined, togglePane: () => undefined, openAgentChat: () => undefined, fillComposer: () => undefined }, "c1", people);
  assert.equal(data.threadId, "c1");
  assert.equal(data.nameOf("agt_docs"), "Docs");
  assert.equal(data.kindOf("agt_docs"), "agent");
  assert.ok(data.directory.every((c) => c.id !== "usr_irfad"), "you cannot @ yourself");
  await data.call("chat.post", { threadId: "c1", body: "hello", idempotencyKey: data.newKey() });
  assert.equal(calls[0]!.cap, "chat.post");
  assert.notEqual(data.newKey(), data.newKey());
});

test("chats: clicking an agent's name or a card asks the shell to open it", () => {
  const { rt, opened } = runtime();
  const data = conversationData(rt, { openThread: () => undefined, togglePane: () => undefined, openAgentChat: () => undefined, fillComposer: () => undefined }, "c1", PEOPLE);
  data.nav.openAgent("agt_docs");
  data.nav.openBeside("file", "fil_1");
  assert.deepEqual(opened, [{ screen: "chats.agent-page", args: { agentId: "agt_docs" } }, { subject: { type: "file", id: "fil_1" } }]);
});
