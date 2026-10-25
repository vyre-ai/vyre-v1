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

test("filters All, Unread, People, Agents with their counts", () => {
  const c = filterCounts(recent, [], name);
  assert.deepEqual(c, { all: 5, unread: 2, people: 2, agents: 3 });
  const rows = groupRecent(recent, [], name).flatMap((g) => g.rows);
  assert.deepEqual(rows.filter((r) => matchesFilter(r, "unread")).map((r) => r.threadId), ["t1", "t2"]);
  assert.deepEqual(rows.filter((r) => matchesFilter(r, "people")).map((r) => r.threadId), ["t2", "y1"]);
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

test("the list runs Needs you (only when something waits), Agents with All agents, Chats, then Channels with Projects", () => {
  const e = buildEntries({ ...base, needs: [need("n1", "approve")], needsTotal: 7, channels: [channel("intake"), channel("pruitt", { recordId: "r1" }), channel("old", { archived: true })] });
  const kinds = e.map((x) => `${x.type}:${x.key}`);
  assert.equal(kinds[0], "head:h:needs");
  assert.ok(kinds.indexOf("head:h:faces") < kinds.indexOf("head:h:recent") && kinds.indexOf("head:h:recent") < kinds.indexOf("head:h:channels"));
  const head = e[0]!;
  assert.equal(head.type === "head" ? head.count : -1, 7, "the header counts all that wait, not the three listed");
  assert.ok(kinds.includes("more:f:all"));
  assert.ok(kinds.indexOf("group:g:projects") > kinds.indexOf("channel:ch:intake"), "Projects sit below the plain channels");
  assert.ok(!kinds.includes("channel:ch:old"), "archived channels stay out");
  const none = buildEntries(base);
  assert.ok(!none.some((x) => x.key === "h:needs"), "no Needs you header when nothing waits");
  assert.ok(!none.some((x) => x.key === "h:channels"), "no Channels header when there are none");
});

test("a closed section keeps its header and drops its rows", () => {
  const e = buildEntries({ ...base, closed: new Set(["recent" as const]) });
  assert.ok(e.some((x) => x.key === "h:recent"));
  assert.ok(!e.some((x) => x.type === "chat"));
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
