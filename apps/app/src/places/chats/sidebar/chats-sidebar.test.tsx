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

test("the sections render from the Northwind sample, in the spec's order", () => {
  const out = html(createSampleSidebar());
  const heads = ["head-needs", "head-faces", "head-recent", "head-channels"].map((id) => at(out, `data-testid="${id}"`));
  assert.deepEqual([...heads].sort((a, b) => a - b), heads, "Needs you, Agents, Chats, Channels");
  for (const text of ["Needs you", "Agents", "Chats", "Channels", "Northwind", "Search", "All agents"]) assert.ok(out.includes(text), text);
  assert.ok(!out.includes(String.fromCharCode(0x2014)), "no em dash in any copy");
  assert.ok(!out.includes("chats-sidebar-loading"));
});

test("Needs you lists the top three with the count of all that wait", () => {
  const out = html(createSampleSidebar());
  assert.ok(at(out, "Send 12 invoices") < at(out, "Rivera engagement letter"));
  assert.ok(out.includes('data-testid="count-needs"') && out.includes(">7<"));
  assert.ok(out.includes("Approve") && out.includes("Blocked"));
});

test("Starred agent faces come first, each a row with its face; the working one is ringed", () => {
  const out = html(createSampleSidebar());
  for (const n of ["Assistant", "Intake", "Docs", "Billing", "Research"]) assert.ok(out.includes(`data-testid="face-${n}"`), n);
  assert.ok(out.includes('data-testid="pulse"'), "Intake is working");
});

test("Chats are grouped Starred, Today, Yesterday, Earlier", () => {
  const out = html(createSampleSidebar());
  const g = ["Starred", "Today", "Yesterday", "Earlier"].map((l) => at(out, `data-testid="group-${l}"`));
  assert.deepEqual([...g].sort((a, b) => a - b), g);
  assert.ok(at(out, "Competitor pricing") > g[0]! && at(out, "Competitor pricing") < g[1]!, "the starred chat sits under Starred");
  assert.ok(at(out, "Rivera intake") > g[1]! && at(out, "Rivera intake") < g[2]!);
  assert.ok(at(out, "Omar Haddad") > g[2]! && at(out, "Omar Haddad") < g[3]!);
  assert.ok(at(out, "Plan the Q4 offsite") > g[3]!);
});

test("unread chats carry a dot and channels a count; Projects sit under Channels", () => {
  const out = html(createSampleSidebar());
  assert.ok(out.includes('data-testid="unread-dot"'));
  assert.ok(out.includes('data-testid="unread-intake"'));
  assert.ok(at(out, "pruitt-matter") > at(out, "data-testid=\"group-Projects\"") && at(out, "data-testid=\"group-Projects\"") > at(out, "rivera-matter"));
  assert.ok(out.includes("other-space-dot"), "another Space needs you");
});

test("Personal: a personal Space has no Needs you and no Channels", () => {
  const out = html(createSampleSidebar(personal));
  assert.ok(!out.includes('data-testid="head-needs"') && !out.includes('data-testid="head-channels"'));
  assert.ok(out.includes("Personal") && out.includes("Flights to Kuala Lumpur"));
  assert.ok(!out.includes("other-space-dot"));
});

test("Harbor Studio is the prototype's: Scheduler and Proofer, two Needs you, studio and galleries, the Moreno chats", () => {
  const out = html(createSampleSidebar(harbor));
  for (const text of ["Harbor Studio", "Scheduler", "Proofer", "Send the Moreno gallery", "Saturday call sheet", "studio", "galleries", "Moreno shoot Saturday", "Moreno gallery", "Theo Lindqvist", "Studio gear list"]) assert.ok(out.includes(text), text);
  assert.ok(out.includes('data-testid="head-needs"') && out.includes('data-testid="head-channels"'));
  assert.ok(!out.includes("Flights to Kuala Lumpur"), "none of the Personal chats");
});

test("before the data arrives the sidebar draws its loading frame; offline it says so and still shows the saved copy", () => {
  assert.ok(renderToStaticMarkup(<ChatsSidebar />).includes("chats-sidebar-loading"));
  const s = createSampleSidebar(northwind, { online: false });
  const out = html(s);
  assert.ok(out.includes("sidebar-offline") && out.includes("Rivera intake"));
});

test("star, mark read and approve change what the next render shows", async () => {
  const s = createSampleSidebar();
  const api = createSidebarApi(s.data, () => undefined, () => undefined);
  await api.star("thread", "c3", true);
  assert.ok(recentNow(s).starred.some((x) => x.threadId === "c3"), "October invoices moved to Starred");
  await api.markRead("c4");
  assert.equal(recentNow(s).today.find((x) => x.threadId === "c4")!.unread, 0);
  assert.equal(recentNow(s).nextUnread, "d1", "next unread moves on (oldest unread first)");
  await api.star("agent", "agt_docs", false);
  const faces = (s.data.screens.query("chats.all-agents", "agents", { section: "starred" }).getSnapshot() as { data: { agents: { name: string }[] } }).data.agents;
  assert.ok(!faces.some((a) => a.name === "Docs"), "Docs is no longer a starred face");
  const need = (s.data.screens.query("home.needs-you-top3", "items", { limit: 3 }).getSnapshot() as { data: { items: Parameters<typeof api.act>[0][] } }).data.items[0]!;
  await api.act(need);
  assert.ok(!html(s).includes("Send 12 invoices"), "an approved request leaves the sidebar");
  assert.deepEqual(s.calls.map((c) => c.cap), ["stars.toggle", "threads.mark_read", "stars.toggle", "tasks.act"]);
});

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

test("a new chat with a starred face asks for that agent; a failed start drops only the local row", async () => {
  const s = createSampleSidebar();
  const settled: string[] = [];
  const api = createSidebarApi(s.data, () => undefined, (id) => settled.push(id));
  s.failNext("chat.start");
  const row = api.newChat({ agentId: "agt_docs", name: "Docs" });
  await wait(10);
  assert.deepEqual((s.calls[0]!.input as { agentIds: string[] }).agentIds, ["agt_docs"]);
  assert.deepEqual(settled, [row.threadId]);
  assert.deepEqual(s.opened, [`chat:${row.threadId}`], "no switch to a real thread");
  assert.equal(rowOf(recentNow(s).today[0]!, (i) => i).local, false);
});
