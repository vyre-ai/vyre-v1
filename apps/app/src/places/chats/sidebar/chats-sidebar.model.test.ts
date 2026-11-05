// Chats sidebar: the rules behind the screen, without a renderer. Grouping, filters with counts, the Cmd-digit map, the order of the flat list, next unread, the local row.
import test from "node:test";
import assert from "node:assert/strict";
import {
  RECENT_SHOWN, capped, chatOrder, foldedKey, openEntry, orderPeople, readFolded, unreadTotal, writeFolded, anyUnread,
  FILTERS, LOCAL_PREFIX, MAX_DIGITS, buildEntries, faceDigits, faceForDigit, filterCounts, groupRecent, matchesFilter, needsKind, newLocalRow, rowOf, selectable, splitChannels, startKey, stepKey, whenLabel,
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
  assert.deepEqual(filterCounts(rows), { all: 3, unread: 1, needs: 1, running: 1, asks: 0 });
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

test("the list runs Tasks, Now, Recent, Channels with Projects, People, Agents; running and waiting rise to Now", () => {
  const row = (threadId: string, o = {}) => ({ ...newLocalRow("Mira", "agent", 1), threadId, title: threadId, ...o });
  const e = buildEntries({ ...base, tasksCount: 9, assistant: { agentId: "me", name: "Assistant" }, groups: [{ key: "today", label: "Today", rows: [row("w", { working: true }), row("n"), row("q"), row("a"), row("b"), row("c")] }], waitingThreads: new Set(["n"]), people: [{ id: "p1", name: "Sara" }], channels: [channel("intake"), channel("pruitt", { recordId: "r1" })] });
  const heads = e.filter((x) => x.type === "head").map((x) => (x as { label: string }).label);
  assert.deepEqual(heads, ["Now", "Recent", "Channels", "People", "Agents"]);
  assert.deepEqual(e.slice(0, 1).map((x) => x.key), ["nav:tasks"], "no Threads row: replies are in the Inbox and on their chats' rows");
  const now = e.slice(e.findIndex((x) => x.key === "h:now") + 1, e.findIndex((x) => x.key === "h:recent")).map((x) => x.key);
  assert.deepEqual(now, ["c:w", "c:n"]);
  assert.equal(e.find((x) => x.key === "m:recent"), undefined, "four chats fit: Recent shows eight before N more (lane l-polish)");
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
  assert.deepEqual(needsKind(need("a", "approve")), { label: "Allow", tone: "accent" });
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


test("new replies to messages you follow ride on the chat's own row: its count, and the Unread filter keeps it; the Asks filter holds only Ask history", () => {
  const item = { threadId: "thr_c", kind: "chat", title: "Client portal launch", agents: ["agt_mira"], unread: 0, repliesUnread: 3, working: false, starred: false, lastAt: 1 } as never;
  const row = rowOf(item, () => "Mira");
  assert.equal(row.repliesUnread, 3);
  assert.ok(matchesFilter(row, "unread"), "a chat that is read but has new replies is Unread");
  assert.ok(!matchesFilter(row, "asks"), "an ordinary chat is not Ask history");
  assert.equal(rowOf({ ...(item as object), repliesUnread: undefined } as never, () => "Mira").repliesUnread, undefined);
  assert.deepEqual(FILTERS.map((f) => f.label), ["All", "Unread", "Needs you", "Running", "Asks"]);
});

test("a people-only group chat is in Recent; only a one-to-one direct message lives under People (lane l-polish L9)", () => {
  const r: RecentOut = {
    starred: [], yesterday: [], earlier: [], nextUnread: null,
    today: [
      item("dm", "", { people: ["usr_maya"] } as never),
      item("grp", "Offsite planning", { people: ["usr_maya", "usr_dev", "usr_tom"], unread: 1 } as never),
      item("ag", "Pricing", { agents: ["a1"] }),
      item("old", "Omar Haddad"),
    ],
  };
  const groups = groupRecent(r, [], name, (id) => id.slice(4));
  const rows = Object.fromEntries(groups.flatMap((g) => g.rows).map((x) => [x.threadId, x]));
  assert.equal(rows["dm"]!.direct, true, "exactly one other person and no agent: a direct message");
  assert.equal(rows["grp"]!.direct, undefined, "three other people: a group chat");
  assert.equal(rows["ag"]!.direct, undefined);
  assert.equal(rows["old"]!.direct, true, "an older server that names nobody keeps its no-agent chats out of Recent, as before");
  const recentKeys = (e: ReturnType<typeof buildEntries>): string[] => e.slice(e.findIndex((x) => x.key === "h:recent") + 1).filter((x) => x.type === "chat").map((x) => x.key);
  const e = buildEntries({ ...base, groups, moreRecent: true });
  assert.deepEqual(recentKeys(e), ["c:grp", "c:ag"], "the group chat shows, the direct messages do not");
  assert.ok(matchesFilter(rows["grp"]!, "unread"), "and the Unread filter keeps it");
});

// ---------------------------------------------------------------- lane l-polish, Lane A: what the sidebar shows

const crow = (threadId: string, o: Partial<ChatRow> = {}): ChatRow => ({ threadId, title: threadId, who: "Mira", kind: "agent", unread: 0, working: false, starred: false, lastAt: 1000, local: false, ...o });
const recentKeys = (e: ReturnType<typeof buildEntries>): string[] => e.slice(e.findIndex((x) => x.key === "h:recent") + 1).filter((x) => x.type === "chat").map((x) => x.key.slice(2));
const many = (n: number, o: (k: number) => Partial<ChatRow> = () => ({})): ChatRow[] => Array.from({ length: n }, (_, k) => crow(`r${k}`, { lastAt: 1000 - k, ...o(k) }));

test("Recent shows eight, and unread, starred and the open chat never sit behind N more", () => {
  assert.equal(RECENT_SHOWN, 8);
  const rows = many(14, (k) => (k === 11 ? { unread: 2 } : k === 12 ? { starred: true } : k === 13 ? { repliesUnread: 1 } : {}));
  const e = buildEntries({ ...base, groups: [{ key: "today", label: "Today", rows }], open: "t:r10" });
  const keys = recentKeys(e);
  assert.deepEqual(keys.slice(0, 1), ["r12"], "the starred chat leads");
  for (const k of ["r10", "r11", "r12", "r13"]) assert.ok(keys.includes(k), `${k} is drawn past the cut`);
  assert.equal(keys.length, 8 + 3, "eight, plus the unread, the open and the replies row past them (the starred one is among the first eight once it leads)");
  assert.equal((e.find((x) => x.key === "m:recent") as { label: string }).label, `${14 - keys.length} more`);
});

test("a stable order: reading a chat never moves it, and two loads of the same rows draw the same list", () => {
  const rows = [crow("a", { lastAt: 5 }), crow("b", { lastAt: 9, unread: 3 }), crow("c", { lastAt: 9 }), crow("d", { lastAt: 1, starred: true })];
  const before = recentKeys(buildEntries({ ...base, groups: [{ key: "today", label: "Today", rows }] }));
  const after = recentKeys(buildEntries({ ...base, groups: [{ key: "today", label: "Today", rows: rows.map((r) => ({ ...r, unread: 0 })).reverse() }] }));
  assert.deepEqual(before, ["d", "b", "c", "a"], "starred first, then the newest, ties by title");
  assert.deepEqual(after, before, "read, and handed over in another order, it draws the same");
  assert.ok(chatOrder(crow("x", { lastAt: 1 }), crow("y", { lastAt: 1 })) < 0);
});

test("a goal's own chat is its Goal row: never again in Now or Recent", () => {
  const rows = [crow("g1"), crow("g2", { working: true }), crow("plain")];
  const e = buildEntries({ ...base, groups: [{ key: "today", label: "Today", rows }], goalThreads: new Set(["g1", "g2"]) });
  assert.deepEqual(recentKeys(e), ["plain"]);
  assert.ok(!e.some((x) => x.key === "c:g2"), "a running goal chat does not rise to Now either");
  assert.ok(!e.some((x) => x.key === "h:now"));
  // and before the goals have loaded, the server's row says it is a goal's chat
  const fromServer = groupRecent({ starred: [], today: [item("g3", "Launch page live", { agents: ["a1"], goalId: "gol_1" } as never), item("x", "X", { agents: ["a1"] })], yesterday: [], earlier: [], nextUnread: null }, [], name);
  assert.deepEqual(recentKeys(buildEntries({ ...base, groups: fromServer })), ["x"]);
});

test("a filter narrows every group: Unread keeps unread channels, people and agents; Needs you keeps the goals waiting on you; projects leave", () => {
  const ch = (id: string, unread: number): Channel => ({ channelId: id, mainThreadId: `th_${id}`, name: id, visibility: "public", archived: false, members: [], agents: [], unread, createdAt: 1 } as Channel);
  const goal = (id: string, status: string) => ({ id, title: id, status, owner: "me", leadAgentId: "a1", deadline: 1, progress: {}, updatedAt: 1 } as never);
  const input = { ...base, goals: [goal("w", "waiting"), goal("act", "active")], projects: [{ id: "p1", title: "P", starred: false, archived: false }], channels: [ch("loud", 2), ch("quiet", 0)],
    people: [{ id: "u1", name: "Ann", unread: 1 }, { id: "u2", name: "Bo", unread: 0 }], groups: [{ key: "today" as const, label: "Today", rows: [crow("s", { solo: true, whoId: "a2", unread: 1 })] }] };
  const unread = buildEntries({ ...input, filter: "unread" });
  const keys = unread.map((x) => x.key);
  assert.ok(keys.includes("ch:loud") && !keys.includes("ch:quiet"), keys.join(" "));
  assert.ok(keys.includes("p:u1") && !keys.includes("p:u2"));
  assert.ok(!keys.includes("h:projects") && !keys.includes("h:goals"), "projects and goals carry no unread");
  assert.ok(!keys.some((k) => k.startsWith("m:")), "a filter shows everything it keeps");
  const needs = buildEntries({ ...input, filter: "needs", waitingAgents: new Set(["a1"]) });
  assert.deepEqual(needs.filter((x) => x.type === "goal").map((x) => x.key), ["g:w"]);
  assert.ok(needs.some((x) => x.key === "f:a1") && !needs.some((x) => x.key === "f:a2"));
  assert.ok(!needs.some((x) => x.key === "h:channels"), "no channel waits on you: no empty Channels head");
  const all = buildEntries(input);
  assert.ok(all.some((x) => x.key === "ch:quiet") && all.some((x) => x.key === "h:projects") && all.some((x) => x.key === "g:act"));
});

test("a muted chat or channel is quiet: no unread on the row, at the end of its group, never lifted past N more, and nothing toward the totals", () => {
  const rows = [...many(9), crow("m", { unread: 4, lastAt: 5000 })];
  const muted = (kind: string, id: string): boolean => (kind === "thread" && id === "m") || (kind === "channel" && id === "c1");
  const e = buildEntries({ ...base, groups: [{ key: "today", label: "Today", rows }], muted });
  assert.ok(!recentKeys(e).includes("m"), "muted and past the cut: it waits behind N more though it is newest and unread");
  const shown = buildEntries({ ...base, groups: [{ key: "today", label: "Today", rows }], muted, moreRecent: true });
  const keys = recentKeys(shown);
  assert.equal(keys.at(-1), "m", "at the end of Recent");
  const row = shown.find((x) => x.key === "c:m") as { row: ChatRow };
  assert.equal(row.row.unread, 0); assert.equal(row.row.muted, true);
  const ch = (id: string, unread: number): Channel => ({ channelId: id, mainThreadId: `th_${id}`, name: id, visibility: "public", archived: false, members: [], agents: [], unread, createdAt: 1 } as Channel);
  const chans = buildEntries({ ...base, channels: [ch("c1", 3), ch("c2", 1)], muted }).filter((x) => x.type === "channel") as { channel: Channel }[];
  assert.deepEqual(chans.map((x) => [x.channel.channelId, x.channel.unread]), [["c2", 1], ["c1", 0]]);
  const r: RecentOut = { starred: [], today: [item("m", "M", { agents: ["a1"], unread: 4 }), item("n", "N", { agents: ["a1"], unread: 1 })], yesterday: [], earlier: [], nextUnread: null };
  assert.equal(unreadTotal(r, [ch("c1", 3), ch("c2", 1)], muted), 2, "one unread total: what is not muted, chats and channels together");
  assert.equal(unreadTotal(r, [ch("c1", 3), ch("c2", 1)]), 9);
  assert.equal(anyUnread({ ...r, today: [item("m", "M", { agents: ["a1"], unread: 4 })] }, [ch("c1", 3)], muted), false, "the rail dot stays off for muted things");
});

test("one unread, shown once: an agent's row shows its chat's unread only while that chat is not drawn", () => {
  const solo = crow("s", { solo: true, whoId: "a1", unread: 2 });
  const face = (e: ReturnType<typeof buildEntries>) => e.find((x) => x.key === "f:a1") as { unread?: number };
  assert.equal(face(buildEntries({ ...base, groups: [{ key: "today", label: "Today", rows: [solo] }] })).unread, undefined, "the chat row carries it");
  const folded = buildEntries({ ...base, groups: [{ key: "today", label: "Today", rows: [solo] }], closed: new Set(["recent"]) as never });
  assert.equal(face(folded).unread, 2, "with Recent folded, the agent row says it");
});

test("the open row is selected for a project too, and an agent, person or goal past the cut is drawn", () => {
  const projects = Array.from({ length: 6 }, (_, k) => ({ id: `p${k}`, title: `P${k}`, starred: false, archived: false }));
  const e = buildEntries({ ...base, projects, open: "p:p5" });
  assert.ok(e.some((x) => x.key === "pj:p5"), "the open project is drawn past N more");
  assert.equal(openEntry(e, "p:p5"), "pj:p5", "and selected");
  const faces = Array.from({ length: 6 }, (_, k) => agent(`x${k}`));
  assert.ok(buildEntries({ ...base, faces, open: "a:x5" }).some((x) => x.key === "f:x5"));
  assert.ok(buildEntries({ ...base, faces, starred: (k, id) => k === "agent" && id === "x4" }).some((x) => x.key === "f:x4"), "a starred agent is never hidden");
});

test("People keep one order: who I talked with last, then by name; reading never moves anyone", () => {
  const r: RecentOut = { starred: [], today: [item("d1", "", { people: ["u3"], lastAt: 50 } as never), item("d2", "", { people: ["u1"], lastAt: 90 } as never)], yesterday: [], earlier: [], nextUnread: null };
  const ppl = [{ id: "u1", name: "Cy" }, { id: "u2", name: "Al" }, { id: "u3", name: "Bea" }, { id: "u4", name: "Ab" }];
  const a = orderPeople(ppl, new Map([["u3", 2]]), r).map((p) => p.id);
  const b = orderPeople(ppl, new Map(), r).map((p) => p.id);
  assert.deepEqual(a, ["u1", "u3", "u4", "u2"]);
  assert.deepEqual(b, a, "the same with nothing unread");
  const e = buildEntries({ ...base, people: orderPeople([...ppl, { id: "u5", name: "Zed" }], new Map([["u5", 1]]), r) });
  assert.ok(e.some((x) => x.key === "p:u5"), "an unread person past the cut is drawn");
});

test("folded groups are remembered: read back what was written, Team now folded the first time, junk dropped", () => {
  assert.equal(foldedKey("Fresh Co:usr_1"), "vyre.sidebar.folded.Fresh Co:usr_1");
  assert.deepEqual([...readFolded(null)], ["team"]);
  assert.deepEqual([...readFolded(writeFolded(new Set(["recent", "channels"] as const)))].sort(), ["channels", "recent"]);
  assert.deepEqual([...readFolded('["recent","nope",3]')], ["recent"]);
  assert.deepEqual([...readFolded("{bad")], ["team"]);
  assert.deepEqual([...readFolded("[]")], [], "everything open is kept as everything open");
});

test("the filter menu counts what each filter shows: Unread counts unread channels too, Needs you says the Tasks number", () => {
  const ch = { channelId: "c", mainThreadId: "th_c", unread: 2 };
  const c = filterCounts([crow("a", { unread: 1 }), crow("b")], { channels: [ch], needs: 4 });
  assert.equal(c.unread, 2); assert.equal(c.needs, 4);
  assert.equal(filterCounts([crow("a", { unread: 1 })], { muted: (k, id) => k === "thread" && id === "a" }).unread, 0);
  assert.deepEqual(capped([1, 2, 3, 4], 2, (x) => x === 4), { shown: [1, 2, 4], hidden: 1 });
});
