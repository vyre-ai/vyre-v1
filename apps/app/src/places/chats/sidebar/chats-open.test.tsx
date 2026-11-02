// The sidebar selects the page that is open, from a tab, a link or Cmd-K, and keeps the arrow-key cursor apart.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom, mount, press, find, flush } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { ChatsSidebar } from "./ChatsSidebar.tsx";
import { buildEntries, openEntry } from "./model.ts";
import type { Channel, SidebarInput } from "./model.ts";
import { createSampleSidebar, northwind } from "./sample.ts";
import { importedRows } from "../imported/model.ts";
import { START, fromHash, openKeyOf, step } from "../mounts/route.ts";
import { IMPORTED, rowIds, selectedRows, drawn } from "./chats-open.support.tsx";

test("every page the place can show has its open key, from a tab, a link or Cmd-K alike; a page with no row has none", () => {
  assert.equal(openKeyOf(fromHash("subject=thread:c2").route), "t:c2", "a chat's tab");
  assert.equal(openKeyOf(fromHash("screen=chats.conversation&threadId=c2").route), "t:c2", "a link to a chat");
  assert.equal(openKeyOf(fromHash("subject=channel:th_general").route), "t:th_general", "a channel is its thread");
  assert.equal(openKeyOf(fromHash("screen=tasks.my-work").route), "tasks");
  assert.equal(openKeyOf(fromHash("screen=chats.threads").route), "threads");
  assert.equal(openKeyOf(fromHash("screen=chats.artifacts").route), "artifacts");
  assert.equal(openKeyOf(fromHash("screen=chats.agent-page&agentId=agt_docs").route), "a:agt_docs", "Cmd-K to an agent");
  assert.equal(openKeyOf(fromHash("screen=chats.agent-form&agentId=agt_docs").route), "a:agt_docs");
  assert.equal(openKeyOf(step(START, { t: "imported", conversationId: "isc_a" }).route), "i:isc_a");
  for (const none of [START, fromHash("screen=chats.agent-form"), fromHash("subject=task:tsk_1"), fromHash("screen=tasks.needs-you"), fromHash("screen=chats.helper-chat&threadId=h1"), step(START, { t: "search", q: "x" })]) {
    assert.equal(openKeyOf(none.route), null, JSON.stringify(none.route));
  }
});

test("the open row is the chat, else the channel of its thread, else the imported session continued in it; an agent's page is its face; nothing when it has no row", () => {
  const chan = { channelId: "general", mainThreadId: "th_general", name: "general", visibility: "public", archived: false, members: [], agents: [], unread: 0, createdAt: 1 } as unknown as Channel;
  const row = { threadId: "c1", title: "Rivera intake", who: "Intake", kind: "agent" as const, unread: 0, working: false, starred: false, lastAt: 1, local: false };
  const input: SidebarInput = {
    faces: [{ agentId: "agt_docs", name: "Docs" } as never], workingAgents: new Set(), groups: [{ key: "today", label: "Today", rows: [row] }], channels: [chan], filter: "all", closed: new Set(),
    imported: importedRows([{ conversationId: "isc_a", title: "A", startedAt: 2 }, { conversationId: "isc_b", title: "B", startedAt: 1, continuedThreadId: "thr_gone" }]),
  };
  const entries = buildEntries(input);
  assert.equal(openEntry(entries, "t:c1"), "c:c1");
  assert.equal(openEntry(entries, "t:th_general"), "ch:general");
  assert.equal(openEntry(entries, "t:thr_gone"), "i:isc_b", "a continued chat with no row of its own lights its imported session");
  assert.equal(openEntry(entries, "i:isc_a"), "i:isc_a");
  assert.equal(openEntry(entries, "a:agt_docs"), "f:agt_docs");
  assert.equal(openEntry(entries, "tasks"), "nav:tasks");
  assert.equal(openEntry(entries, "threads"), "nav:threads");
  assert.equal(openEntry(entries, "artifacts"), "artifacts");
  assert.equal(openEntry(entries, "t:c9"), null, "a chat with no row");
  assert.equal(openEntry(entries, "a:agt_none"), null);
  assert.equal(openEntry(entries, "i:isc_none"), null);
  assert.equal(openEntry(entries, null), null);
  assert.equal(openEntry(buildEntries({ ...input, closed: new Set(["imported" as const]) }), "i:isc_a"), null, "a folded group shows no row to select");
});

/* ---------- the drawn list follows the page ---------- */

test("selection follows the open page across a tab switch, a link and Cmd-K for every row type, and nothing is selected when the page has no row", async () => {
  const { root, show } = await drawn(createRoot, { imported: IMPORTED, open: "t:c1", artifacts: true });
  assert.deepEqual(selectedRows(root), ["c:c1"], "the open chat");
  const channel = rowIds(root, "row-ch:")[0]!.slice("row-ch:".length);
  await show(`t:th_${channel}`);
  assert.deepEqual(selectedRows(root), [`ch:${channel}`], "a tab switch to a channel moves it; the chat it left is not selected");
  const face = rowIds(root, "row-f:").find((i) => i !== "row-f:agt_assistant")!.slice("row-".length);
  await show(`a:${face.slice(2)}`);
  assert.deepEqual(selectedRows(root), [face], "a link to an agent's page selects its face");
  await show("tasks");
  assert.deepEqual(selectedRows(root), ["nav:tasks"]);
  await show("threads");
  assert.deepEqual(selectedRows(root), ["nav:threads"]);
  await show("artifacts");
  assert.deepEqual(selectedRows(root), ["artifacts"]);
  await show("i:isc_a");
  assert.deepEqual(selectedRows(root), ["i:isc_a"], "an imported transcript");
  await show("t:c3");
  assert.deepEqual(selectedRows(root), ["c:c3"], "Cmd-K to another chat: the imported row is no longer lit while you are not in it");
  await show(null);
  assert.deepEqual(selectedRows(root), [], "a new chat has no row: nothing is selected");
  await show("t:thr_nowhere");
  assert.deepEqual(selectedRows(root), [], "a chat with no row in the list: nothing");
});

test("a press opens the page but the selection waits for it: a row stays unselected until the place shows it", async () => {
  const { s, root, show } = await drawn(createRoot, { imported: IMPORTED, open: "t:c1" });
  await press(find(root, "row-i:isc_a"));
  await flush();
  assert.deepEqual(s.opened.slice(-1), ["imported:isc_a"], "the press asks the place to open the transcript");
  assert.deepEqual(selectedRows(root), ["c:c1"], "the open page has not changed yet");
  await show("i:isc_a");
  assert.deepEqual(selectedRows(root), ["i:isc_a"]);
});

test("the arrow keys move a cursor of their own; it goes back to the open row when the page changes", async () => {
  const { root, show } = await drawn(createRoot, { imported: IMPORTED, open: "t:c1" });
  const list = (): Node => find(root, "chats-sidebar")!;
  assert.equal(list().props["aria-activedescendant"], "row-c:c1", "the cursor starts on the open row");
  await act(async () => { (list().props.onKeyDown as (e: { key: string; preventDefault(): void }) => void)({ key: "ArrowDown", preventDefault() {} }); });
  await flush();
  const moved = String(list().props["aria-activedescendant"]);
  assert.notEqual(moved, "row-c:c1", "the arrow moved the cursor");
  assert.deepEqual(selectedRows(root), ["c:c1"], "the selection stays on the open page");
  assert.ok(find(root, moved), `the cursor is on a drawn row (${moved})`);
  assert.notEqual(find(root, moved)?.props["aria-selected"], true, "the cursor row is not drawn selected");
  await show("t:c3");
  assert.equal(list().props["aria-activedescendant"], "row-c:c3", "a new page puts the cursor on its row");
});

/* ---------- the Imported rows ---------- */

test("a sidebar drawn alone, with no page beside it, keeps the row last pressed selected", async () => {
  installDom();
  const s = createSampleSidebar(northwind);
  const root = await mount(createRoot, <ChatsSidebar data={s.data} window={{ start: 0, end: 500 }} />);
  assert.deepEqual(selectedRows(root), []);
  await press(find(root, "row-c:c3"));
  await flush();
  assert.deepEqual(selectedRows(root), ["c:c3"]);
});

