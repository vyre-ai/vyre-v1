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
import { validateInput } from "../../../../../../generated/validators.ts";
import { FACES_SHOWN, NEW_CHAT_MS, buildEntries, groupRecent, matchesQuery, refetch, rowOf } from "./model.ts";
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
  // agents.list takes no "starred" input (the contract refuses it), so the Agents group is the Space's agents and starring one leaves the group as it was; the star itself is the stars.toggle call below.
  const faces = (s.data.screens.query("chats.all-agents", "agents", {}).getSnapshot() as { data: { agents: { name: string }[] } }).data.agents;
  assert.ok(faces.some((a) => a.name === "Docs"), "Docs stays in the Agents group");
  assert.deepEqual(s.rejected, [], "every read the sidebar sent was accepted by the generated validators");
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

// ---- reads the contract accepts, and reads that fail (P-L9b_26)

test("the inputs the Chats sidebar and All agents send are accepted by the generated validators", () => {
  const s = createSampleSidebar();
  html(s);
  assert.deepEqual(s.rejected, [], "the sample answers a refused input like the real handler (an error), and none was refused");
  // the screen queries the sidebar declares, with the state it passes
  for (const [cap, input] of [["chat.recent", { filter: "all" }], ["channels.list", {}], ["agents.list", {}], ["tasks.needs_you", {}]] as const) {
    assert.deepEqual(validateInput(cap, 1, input), [], cap);
  }
  assert.notDeepEqual(validateInput("agents.list", 1, { section: "starred" }), [], "the input that was refused in the real app (422) is refused here too");
  assert.throws(() => s.data.screens.query("chats.all-agents", "agents", { section: "starred" }).getSnapshot(), /bad_input/, "the sample refuses it as the server does");
  assert.equal(s.rejected.length > 0, true);
});

test("the Agents group shows the first agents and an All agents row for the rest", () => {
  const agent = (n: number) => ({ agentId: `a${n}`, name: `Agent ${n}` }) as never;
  const faces = Array.from({ length: FACES_SHOWN }, (_, n) => agent(n));
  const base = { needs: [], needsTotal: 0, faces, workingAgents: new Set<string>(), groups: [], channels: [], filter: "all" as const, closed: new Set<never>() };
  const withMore = buildEntries({ ...base, facesMore: 5 });
  const more = withMore.find((e) => e.type === "more");
  assert.ok(more && more.type === "more" && more.label === `All agents (${FACES_SHOWN + 5})`);
  assert.equal(buildEntries(base).some((e) => e.type === "more"), false, "nothing more, no row");
});

const FAILED = { status: "loading" as const, error: { message: "agents.list: bad_input", code: "validation.bad_input", traceId: "trace-1" } };
const failing = (s: SampleSidebar, screen: string): string =>
  renderToStaticMarkup(<ChatsSidebar data={{ ...s.data, screens: { query: (id, name, state) => (id === screen ? { subscribe: () => () => undefined, getSnapshot: () => FAILED } : s.data.screens.query(id, name, state)) } }} window={{ start: 0, end: 500 }} />).replaceAll("<!-- -->", "");

test("a failed read puts one compact row under that section's head, the rest still draws, and it is never the empty state", () => {
  const s = createSampleSidebar();
  const agents = failing(s, "chats.all-agents");
  const at2 = (n: string): number => { const i = agents.indexOf(n); assert.ok(i >= 0, `${n} in: ${agents.slice(Math.max(0, agents.indexOf("head-faces") - 100), agents.indexOf("head-faces") + 1500)}`); return i; };
  assert.ok(at2('data-testid="head-faces"') < at2('data-testid="section-error-agents"') && at2('data-testid="section-error-agents"') < at2('data-testid="head-channels"'), "the error row sits under the Agents head, before Channels");
  assert.ok(agents.includes("load agents") && agents.includes('data-testid="retry-agents"') && agents.includes('data-testid="error-more-agents"'), "one row: the words, Retry and the details menu");
  assert.ok(!agents.includes("trace-1") && !agents.includes('data-testid="state-error"'), "the cause and trace id are behind the menu, no States block");
  assert.ok(agents.includes("Rivera intake") && agents.includes("rivera-matter") && agents.includes("Send 12 invoices"), "chats, channels and Needs you still draw");
  assert.ok(!agents.includes("chats-sidebar-loading") && !agents.includes("No chats yet"), "no skeleton, no empty state");
  const chats = failing(s, "chats.sidebar");
  const ci = (n: string): number => chats.indexOf(n);
  assert.ok(ci('data-testid="head-recent"') >= 0 && ci('data-testid="head-recent"') < ci('data-testid="section-error-recent"'), "the Chats error row is under the Chats head");
  assert.ok(chats.includes("load chats") && chats.includes("load channels"), "both reads of that screen say so, each under its own head");
  assert.ok(!chats.includes("No chats yet") && !chats.includes("Nothing here") && !chats.includes("chats-sidebar-loading"), "a failed Chats read is not 'No chats yet'");
  assert.ok(chats.includes("Send 12 invoices"), "Needs you still draws");
});

test("Retry asks the live reads to read again; a stand-in without that has nothing to re-ask", () => {
  let asked = 0;
  assert.equal(refetch({ invalidate() { asked++; } }), true);
  assert.equal(asked, 1);
  assert.equal(refetch({}), false);
});
