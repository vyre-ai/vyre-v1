// Chats sidebar: the screen. It renders from the Northwind sample Space through the live screen queries, in the order spec 3.2 gives; every write changes what the next
// render shows; a new chat is a row in under 100 ms; the page opens offline and draws a frame of the right size before data.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { SidebarContent } from "../../../shell/sidebar/index.ts";
import type { SidebarSlotApi } from "../../../shell/sidebar/index.ts";
import { ChatsSidebar, ChatsSidebarSlot } from "./ChatsSidebar.tsx";
import { createSidebarApi } from "./actions.ts";
import { NEW_CHAT_MS, groupRecent, matchesQuery, rowOf } from "./model.ts";
import type { ChatRow, RecentOut } from "./model.ts";
import { createSampleSidebar, harbor, northwind, personal } from "./sample.ts";
import { SECTION_TYPE } from "./parts.tsx";
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
  const heads = ["head-needs", "head-faces", "head-channels", "head-recent"].map((id) => at(out, `data-testid="${id}"`));
  assert.deepEqual([...heads].sort((a, b) => a - b), heads, "Needs you, Agents, Channels, Chats (ruling 45)");
  for (const text of ["Needs you", "Agents", "Chats", "Channels", "Northwind", "All agents"]) assert.ok(out.includes(text), text);
  // The title, the collapse button and the search field are the shared slot's now (the next tests); the content draws none of them.
  assert.ok(!out.includes("sidebar-toggle") && !out.includes("Hide the sidebar") && !out.includes("Search"), "no frame of its own");
  assert.ok(!out.includes(String.fromCharCode(0x2014)), "no em dash in any copy");
  assert.ok(!out.includes("chats-sidebar-loading"));
});

test("Needs you lists every request that waits, with the count (ruling 45: the prototype lists all seven)", () => {
  const out = html(createSampleSidebar());
  assert.ok(at(out, "Send 12 invoices") < at(out, "Rivera engagement letter"));
  assert.ok(out.includes('data-testid="count-needs"') && out.includes(">7<"));
  assert.ok(out.includes("Approve") && out.includes("Blocked"));
  for (const title of ["Pruitt intake summary", "Send the ATP reminder", "Problem report from Omar", "Month-end export"]) assert.ok(out.includes(title), title);
});

test("Starred agent faces come first, each a row with its face; the working one is ringed", () => {
  const out = html(createSampleSidebar());
  for (const n of ["Intake", "Billing", "Research", "Docs"]) assert.ok(out.includes(`data-testid="face-${n}"`), n);
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

// ---- the shared place sidebar slot (P-L9b_22)

const slotApi = (): SidebarSlotApi => ({
  query: "", collapsed: false, setCollapsed: () => undefined, hasSidebar: true, compact: true, openBody: () => undefined, back: () => undefined, view: "list", title: "Chats",
});
/** What the place hands the shell: the SidebarContent element and the content its render prop draws for a given search text. */
const registered = (s: SampleSidebar, query: string, slot: SidebarSlotApi = slotApi()): { entry: { title: string; searchPlaceholder?: string }; out: string } => {
  const el = ChatsSidebarSlot({ data: s.data, window: { start: 0, end: 500 } }) as ReactElement<{ title: string; searchPlaceholder?: string; children: (q: string, slot: SidebarSlotApi) => ReactElement }>;
  assert.equal(el.type, SidebarContent, "the Chats sidebar goes into the shared SidebarContent, not a frame of its own");
  const content = el.props.children(query, slot);
  return { entry: { title: el.props.title, ...(el.props.searchPlaceholder ? { searchPlaceholder: el.props.searchPlaceholder } : {}) }, out: renderToStaticMarkup(content).replaceAll("<!-- -->", "") };
};

test("the sidebar registers in the shared slot as Chats with the Search chats field, and draws all its rows inside it", () => {
  const { entry, out } = registered(createSampleSidebar(), "");
  assert.deepEqual(entry, { title: "Chats", searchPlaceholder: "Search chats" });
  for (const text of ["Needs you", "Send 12 invoices", "Intake", "Competitor pricing", "Rivera intake", "rivera-matter"]) assert.ok(out.includes(text), text);
  assert.ok(out.includes('data-testid="new-chat"') && out.includes('data-testid="filter-chats"'), "the assistant's new chat and the filter keep their place");
});

test("the slot's search field narrows Needs you, Agents, Channels and Chats; a word nothing holds leaves only the section heads", () => {
  const s = createSampleSidebar();
  const out = registered(s, "rivera").out;
  assert.ok(out.includes("Rivera intake") && out.includes("rivera-matter") && out.includes("Rivera engagement letter"));
  assert.ok(!out.includes("Competitor pricing") && !out.includes("Send 12 invoices") && !out.includes("data-testid=\"face-Billing\""));
  const none = registered(s, "zzzz").out;
  assert.ok(!none.includes("Rivera intake") && !none.includes("rivera-matter") && !none.includes('data-testid="head-needs"'));
  assert.equal(registered(s, "  ").out, registered(s, "").out, "blank text is no search");
  assert.ok(matchesQuery("pric comp", "Competitor pricing") && !matchesQuery("pric zzz", "Competitor pricing") && matchesQuery("", "x"));
});

// ---- polish (P-L9b_29)

test("the Needs you fold chevron sits with the label, where every section head puts its chevron, and the count stays at the right", () => {
  const out = html(createSampleSidebar());
  const row = at(out, 'data-testid="row-needs-parent"');
  const marks = at(out, 'data-testid="row-needs-parent-marks"');
  assert.ok(marks > row && at(out, 'data-testid="toggle-needs"') > marks, "the toggle is in the title marks, after the label");
  assert.ok(at(out, 'data-testid="row-needs-parent-trailing"') > at(out, 'data-testid="toggle-needs"') && at(out, 'data-testid="count-needs"') > at(out, 'data-testid="row-needs-parent-trailing"'), "the count is the trailing slot");
});

test("one type for every section header: Agents and Channels, and the Starred, Today, Yesterday, Earlier and Projects groups", () => {
  assert.deepEqual(SECTION_TYPE, { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" });
  const out = html(createSampleSidebar());
  for (const id of ["group-Starred", "group-Today", "group-Yesterday", "group-Projects", "head-faces", "head-channels"]) assert.ok(out.includes(`data-testid="${id}"`), id);
});

test("the sample channels carry the prototype's neutral names", () => {
  const out = html(createSampleSidebar());
  assert.ok(out.includes("rivera-matter") && out.includes("pruitt-matter"));
});
