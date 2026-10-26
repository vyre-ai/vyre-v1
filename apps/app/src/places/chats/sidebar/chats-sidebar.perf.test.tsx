// The speed half of chats-sidebar.test.tsx (split out so only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
// Chats sidebar: the screen. It renders from the Northwind sample Space through the live screen queries, in the order spec 3.2 gives; every write changes what the next
// render shows; a new chat is a row in under 100 ms; the page opens offline and draws a frame of the right size before data.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatsSidebar } from "./ChatsSidebar.tsx";
import { createSidebarApi } from "./actions.ts";
import { NEW_CHAT_MS, groupRecent, rowOf } from "./model.ts";
import type { ChatRow, RecentOut } from "./model.ts";
import { createSampleSidebar, harbor, northwind, personal } from "./sample.ts";
import type { SampleSidebar } from "./sample.ts";

const html = (s: SampleSidebar): string => renderToStaticMarkup(<ChatsSidebar data={s.data} window={{ start: 0, end: 500 }} />).replaceAll("<!-- -->", "");
const at = (s: string, needle: string): number => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `expected ${needle}`);
  return i;
};
const recentNow = (s: SampleSidebar): RecentOut => {
  const snap = s.data.screens.query("chats.sidebar", "recent", { filter: "all" }).getSnapshot();
  assert.equal(snap.status, "ready");
  return (snap as { data: RecentOut }).data;
};
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("a new chat is a row and open in under 100 ms, before chat.start answers; the real thread replaces it", async () => {
  const s = createSampleSidebar();
  const local: ChatRow[] = [];
  const settled: string[] = [];
  const api = createSidebarApi(s.data, (r) => local.push(r), (id) => settled.push(id));
  const t0 = performance.now();
  const row = api.newChat();
  const groups = groupRecent(recentNow(s), local, (id) => id);
  const t1 = performance.now();
  const ms = t1 - t0;
  console.log("METRIC " + JSON.stringify({ name: "chat_open", metric: "chat.new_chat_row_ready", ms: Math.round(ms * 100) / 100, budget_ms: NEW_CHAT_MS, local_row_first_in_today: groups.find((g) => g.key === "today")!.rows[0]!.threadId === row.threadId }));
  assert.ok(ms < NEW_CHAT_MS, `row ready in ${ms} ms`);
  assert.equal(groups.find((g) => g.key === "today")!.rows[0]!.threadId, row.threadId, "first in Today");
  assert.deepEqual(s.opened, [`chat:${row.threadId}`], "opened before the server answers");
  assert.equal(s.calls.length, 1, "chat.start was asked, once");
  assert.deepEqual((s.calls[0]!.input as { agentIds: string[] }).agentIds, ["agt_assistant"], "your assistant by default");
  await wait(s.startDelayMs + 30);
  assert.deepEqual(settled, [row.threadId], "the local row goes when the server answers");
  assert.equal(s.opened.length, 2);
  assert.ok(s.opened[1]!.startsWith("chat:th_chat.start:local_"), "the conversation switches to the real thread");
  assert.ok(recentNow(s).today.some((x) => x.threadId.startsWith("th_chat.start:")), "the real thread is in Today");
});
