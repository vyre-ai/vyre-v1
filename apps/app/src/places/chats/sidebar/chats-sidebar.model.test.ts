// Chats sidebar: the rules behind the screen, without a renderer. Grouping, filters with counts, the Cmd-digit map, the order of the flat list, next unread, the local row.
import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_PREFIX, MAX_DIGITS, buildEntries, faceDigits, faceForDigit, filterCounts, groupRecent, matchesFilter, needsKind, newLocalRow, rowOf, selectable, splitChannels, startKey, stepKey, whenLabel,
} from "./model.ts";
import type { Agent, Channel, ChatRow, NeedsItem, RecentOut } from "./model.ts";

const name = (id: string): string => ({ a1: "Intake", a2: "Billing", a3: "Docs" } as Record<string, string>)[id] ?? id;
const item = (threadId: string, title: string, o: Partial<RecentOut["today"][number]> = {}): RecentOut["today"][number] =>
  ({ threadId, kind: "chat", title, agents: [], unread: 0, working: false, starred: false, lastAt: 1, ...o });
const recent: RecentOut = {
  starred: [item("s1", "Pricing", { agents: ["a1"], starred: true })],
  today: [item("t1", "Invoices", { agents: ["a2"], unread: 2 }), item("t2", "Maya Chen", { unread: 1 }), item("t3", "Work", { agents: ["a3"], working: true }), item("ch", "#intake", { kind: "channel" })],
  yesterday: [item("y1", "Omar Haddad")],
  earlier: [],
  nextUnread: "t2",
};
const agent = (id: string): Agent => ({ agentId: id, name: name(id) } as Agent);

test("recent groups run Starred, Today, Yesterday, Earlier; empty ones are left out; channels are not chats", () => {
  const g = groupRecent(recent, [], name);
  assert.deepEqual(g.map((x) => x.label), ["Starred", "Today", "Yesterday"]);
  assert.deepEqual(g[1]!.rows.map((r) => r.threadId), ["t1", "t2", "t3"], "the channel thread stays out of Chats");
});

test("a row knows who it is with: an agent or a person", () => {
  const r = rowOf(recent.today[0]!, name), p = rowOf(recent.today[1]!, name);
  assert.deepEqual([r.kind, r.who], ["agent", "Billing"]);
  assert.deepEqual([p.kind, p.who], ["person", "Maya Chen"]);
  assert.equal(rowOf(recent.today[2]!, name).working, true);
});

test("filters All, Unread, Needs you and Running with their counts", () => {
  const rows = [{ ...newLocalRow("A", "agent", 1), unread: 2 }, { ...newLocalRow("B", "agent", 1), working: true }, { ...newLocalRow("C", "agent", 1), waiting: true }];
  assert.deepEqual(filterCounts(rows), { all: 3, unread: 1, needs: 1, running: 1 });
  assert.ok(matchesFilter(rows[0]!, "unread") && matchesFilter(rows[1]!, "running") && matchesFilter(rows[2]!, "needs") && matchesFilter(rows[2]!, "all"));
  assert.ok(!matchesFilter(rows[0]!, "needs"));
});

test("Cmd-1..9 map to the first nine starred faces, in order", () => {
  const faces = Array.from({ length: 11 }, (_, i) => agent(`x${i}`));
  const d = faceDigits(faces);
  assert.equal(d.size, MAX_DIGITS);
  assert.equal(d.get("x0"), 1);
  assert.equal(d.get("x8"), 9);
  assert.equal(d.has("x9"), false);
  assert.equal(faceForDigit(faces, "3")?.agentId, "x2");
  assert.equal(faceForDigit(faces.slice(0, 2), "3"), undefined, "fewer faces than the digit");
  assert.equal(faceForDigit(faces, "0"), undefined);
  assert.equal(faceForDigit(faces, "a"), undefined);
});

test("time labels: the clock today, Yesterday, the weekday, then the date", () => {
  const now = Date.UTC(2025, 9, 24, 10, 0);
  assert.equal(whenLabel(Date.UTC(2025, 9, 24, 9, 5), now, 0), "9:05");
  assert.equal(whenLabel(Date.UTC(2025, 9, 23, 23, 0), now, 0), "Yesterday");
  assert.equal(whenLabel(Date.UTC(2025, 9, 20, 9, 0), now, 0), "Mon");
  assert.equal(whenLabel(Date.UTC(2025, 8, 2, 9, 0), now, 0), "Sep 2");
  assert.equal(whenLabel(Date.UTC(2025, 9, 24, 9, 5), now, 600), "19:05", "the person's day, not UTC");
});

const channel = (id: string, o: Partial<Channel> = {}): Channel => ({ channelId: id, mainThreadId: `th_${id}`, name: id, visibility: "public", archived: false, members: [], agents: [], unread: 0, createdAt: 1, ...o } as Channel);
const need = (id: string, kind: string, blocked = false): NeedsItem => ({ reason: "ready", task: { id, kind, title: id, blocked, actions: [] } } as unknown as NeedsItem);
const base = { needs: [] as NeedsItem[], needsTotal: 0, faces: [agent("a1"), agent("a2")], workingAgents: new Set<string>(), groups: groupRecent(recent, [], name), channels: [] as Channel[], filter: "all" as const, closed: new Set<never>() };

test("the list runs Tasks, Threads, Now, Recent, Channels with Projects, People, Agents; running and waiting rise to Now", () => {
  const row = (threadId: string, o = {}) => ({ ...newLocalRow("Mira", "agent", 1), threadId, title: threadId, ...o });
  const e = buildEntries({ ...base, tasksCount: 9, assistant: { agentId: "me", name: "Assistant" }, groups: [{ key: "today", label: "Today", rows: [row("w", { working: true }), row("n"), row("q"), row("a"), row("b"), row("c")] }], waitingThreads: new Set(["n"]), people: [{ id: "p1", name: "Sara" }], channels: [channel("intake"), channel("pruitt", { recordId: "r1" })] });
  const heads = e.filter((x) => x.type === "head").map((x) => (x as { label: string }).label);
  assert.deepEqual(heads, ["Now", "Recent", "Channels", "People", "Agents"]);
  assert.deepEqual(e.slice(0, 2).map((x) => x.key), ["nav:tasks", "nav:threads"]);
  const now = e.slice(e.findIndex((x) => x.key === "h:now") + 1, e.findIndex((x) => x.key === "h:recent")).map((x) => x.key);
  assert.deepEqual(now, ["c:w", "c:n"]);
  const more = e.find((x) => x.key === "m:recent") as { label: string };
  assert.equal(more.label, "1 more", "Recent stops at three");
  assert.ok(e.find((x) => x.key === "g:projects"));
  assert.ok(e.findIndex((x) => x.key === "f:me") === e.findIndex((x) => x.key === "h:faces") + 1, "the Assistant leads Agents");
  const none = buildEntries({ ...base, groups: [] });
  assert.ok(!none.some((x) => x.key === "h:now"), "no Now while nothing moves");
  assert.ok(!buildEntries({ ...base, personal: true }).some((x) => x.key === "h:channels" || x.type === "action"), "a Personal Space has no channels");
  assert.ok(!buildEntries({ ...base, searching: true }).some((x) => x.key === "h:channels"), "a search with no channel match does not offer the empty section");
});

test("a closed section keeps its header and drops its rows", () => {
  const e = buildEntries({ ...base, closed: new Set(["recent" as const]) });
  assert.ok(e.some((x) => x.key === "h:recent"));
  const recentOpen = buildEntries(base).filter((x) => x.type === "chat").length;
  assert.ok(e.filter((x) => x.type === "chat").length < recentOpen);
  assert.ok(e.some((x) => x.type === "face"));
});

test("an empty filter says so instead of drawing nothing", () => {
  const e = buildEntries({ ...base, groups: [], filter: "unread" });
  assert.ok(e.some((x) => x.type === "empty" && x.text === "Nothing here"));
  assert.ok(buildEntries({ ...base, groups: [] }).some((x) => x.type === "empty" && x.text === "No chats yet"));
});

test("faces carry their digit and their pulse", () => {
  const e = buildEntries({ ...base, workingAgents: new Set(["a2"]) }).filter((x) => x.type === "face");
  assert.deepEqual(e.map((x) => (x.type === "face" ? [x.digit, x.working] : [])), [[1, false], [2, true]]);
});

test("arrow keys step through rows only, and stop at the ends", () => {
  const order = selectable(buildEntries(base));
  assert.ok(!order.some((k) => k.startsWith("g:") || k.startsWith("e:")), "group labels are not rows");
  assert.equal(stepKey(order, null, 1), order[0]);
  assert.equal(stepKey(order, null, -1), order[order.length - 1]);
  assert.equal(stepKey(order, order[0]!, -1), order[0]);
  assert.equal(stepKey(order, order[0]!, 1), order[1]);
  assert.equal(stepKey([], null, 1), null);
});

test("Needs you kinds: Approve and Review in the accent, Blocked in the warning tone", () => {
  assert.deepEqual(needsKind(need("a", "approve")), { label: "Approve", tone: "accent" });
  assert.deepEqual(needsKind(need("a", "review")), { label: "Review", tone: "accent" });
  assert.deepEqual(needsKind(need("a", "unblock")), { label: "Blocked", tone: "warn" });
  assert.deepEqual(needsKind(need("a", "work", true)), { label: "Blocked", tone: "warn" });
});

test("a local row is first in Today, marked local, with its own idempotency key", () => {
  const a = newLocalRow("Assistant", "agent", 5), b = newLocalRow("Assistant", "agent", 6);
  assert.ok(a.threadId.startsWith(LOCAL_PREFIX) && a.local);
  assert.notEqual(a.threadId, b.threadId);
  assert.notEqual(startKey(a), startKey(b));
  const g = groupRecent(recent, [a as ChatRow], name);
  assert.equal(g.find((x) => x.key === "today")!.rows[0]!.threadId, a.threadId);
  assert.equal(splitChannels([channel("p", { recordId: "r" })]).projects.length, 1);
});

