// Inbox sidebar and contact list: the screen. Three views (By contact, By thread, Calls only), the header and filter menus with checkmarks and counts, the sidebar groups with
// their unread counts and the calendars with colour dots. Every line is a ui/Row with slots; the list opens offline and draws a frame of the right size before data.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { ContactList, ListLoading, filterMenuEntries, lineMenuEntries, viewMenuEntries } from "../contactlist/index.ts";
import { createSampleInbox, harbor, northwind } from "../contactlist/sample.ts";
import type { SampleInbox, SampleSpace } from "../contactlist/sample.ts";
import { InboxDataProvider, InboxSidebar, InboxStateProvider, INITIAL_STATE, SidebarLoading, contactEntry, listState, listTime, narrow, navGroups, reduce, scopeTitle } from "../sidebar/index.ts";
import type { Entry, InboxState } from "../sidebar/index.ts";
import { isItem } from "../../../../../../ui/src/Menu/props.ts";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/props.ts";

const wrap = (s: SampleInbox, initial: Partial<InboxState>, child: ReactElement): string =>
  renderToStaticMarkup(<InboxDataProvider value={s.data}><InboxStateProvider initial={initial}>{child}</InboxStateProvider></InboxDataProvider>).replaceAll("<!-- -->", "");
const list = (initial: Partial<InboxState> = {}, space: SampleSpace = northwind, o: { online?: boolean } = {}): string => wrap(createSampleInbox(space, o), initial, <ContactList />);
const side = (initial: Partial<InboxState> = {}): string => wrap(createSampleInbox(), initial, <InboxSidebar />);
const has = (s: string, needle: string): boolean => s.includes(needle);
const at = (s: string, needle: string): number => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `expected ${needle}`);
  return i;
};
const lines = (out: string): string[] => [...out.matchAll(/data-testid="row-line:([^"]+)"/g)].map((m) => m[1]!).filter((k) => !k.endsWith("-leading") && !k.endsWith("-trailing"));
const items = (entries: readonly MenuEntry[]): MenuItem[] => entries.filter(isItem);

test("screen: By contact lists one line per person, newest first, unmatched senders on top", () => {
  const out = list();
  assert.deepEqual(lines(out), ["unk", "marcus", "elena", "priya", "dana", "tomas", "wei", "grace", "ben", "jonas", "hannah", "sofia", "nina"]);
  assert.ok(has(out, "All inboxes") && has(out, "8 unread of 13"), "the header names the scope and counts what is unread");
  assert.ok(has(out, "Elena Rivera") && has(out, "Lease documents for Thursday"), "name on top, the newest message under it");
  assert.ok(has(out, "Match to a record") && has(out, 'data-testid="face-ghost"'), "an unmatched sender has the ghost face and the match link");
  assert.ok(has(out, 'data-testid="unread-elena"') && !has(out, 'data-testid="unread-hannah"'), "the unread dot marks unread lines only");
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("screen: every line is a ui/Row with a leading face and a trailing time and inbox, never an overlay", () => {
  const out = list();
  assert.ok(has(out, 'data-testid="row-line:elena"') && has(out, 'data-testid="row-line:elena-leading"') && has(out, 'data-testid="row-line:elena-trailing"'));
  assert.ok(has(out, 'data-testid="face-Elena Rivera"'));
  assert.ok(has(out, "10:15 AM") && has(out, "Yesterday") && has(out, "Wed") && has(out, "Tue"), "today as a clock time, then Yesterday, then the weekday");
  assert.ok(has(out, "Work Gmail") && has(out, "hello@") && has(out, "+1 415 555 0132"), "the inbox each line came in on");
  assert.ok(!has(out, "row-line:elena-overlay"), "no overlay layer sits on the row");
});

test("screen: By thread lists one line per conversation with the subject under the person", () => {
  const out = list({ view: "thread" });
  assert.deepEqual(lines(out), ["thr_1041", "thr_lease", "thr_spring", "thr_login", "thr_partner", "thr_nda", "thr_intake"]);
  assert.ok(has(out, "Lease documents for Thursday") && has(out, "Elena Rivera") && has(out, "Client intake form"));
  assert.ok(has(out, "Marcus Pruitt"), "a text thread is named for the person");
});

test("screen: Calls only lists calls with who, what and how long", () => {
  const out = list({ view: "calls" });
  assert.deepEqual(lines(out), ["cal_dana", "cal_hannah", "cal_elena", "cal_out"]);
  assert.ok(has(out, "Voicemail · 0:42 · Asks about the renewal quote"));
  assert.ok(has(out, "Missed call"));
  assert.ok(has(out, "Incoming call · 4:12 · Elena sends the lease Thursday"));
  assert.ok(has(out, "Outgoing call · 1:35"));
  assert.ok(has(out, "Calls only"), "the header names the view");
});

test("the View menu has the three views with a checkmark on the current one", () => {
  const picked: string[] = [];
  const e = items(viewMenuEntries({ ...INITIAL_STATE, view: "thread" }, (v) => void picked.push(v)));
  assert.deepEqual(e.map((x) => [x.label, x.checked]), [["By contact", false], ["By thread", true], ["Calls only", false]]);
  e[2]!.onSelect?.();
  assert.deepEqual(picked, ["calls"]);
});

test("the filter menu groups Channel, Inbox and Matching with counts and a checkmark on each active filter", () => {
  const s = createSampleInbox();
  const rows = s.replica.rows("contacts") as unknown as Parameters<typeof filterMenuEntries>[1][number][];
  const boxes = northwind.mailboxes;
  const state: InboxState = { ...INITIAL_STATE, channels: ["email"], inboxes: ["mbx_hello"], needsMatch: true };
  const picked: string[] = [];
  const entries = filterMenuEntries(state, rows, boxes, { channel: (c) => void picked.push(`c:${c}`), inbox: (id) => void picked.push(`i:${id}`), needsMatch: () => void picked.push("m") });
  assert.deepEqual(entries.filter((x) => "head" in x).map((x) => (x as { head: string }).head), ["Channel", "Inbox", "Matching"]);
  const flat = items(entries).map((x) => [x.label, x.count, x.checked === true]);
  assert.deepEqual(flat.slice(0, 3), [["Email", 8, true], ["Text", 4, false], ["Call", 1, false]], "the count sits in the Menu's count column, not in the label");
  assert.ok(flat.some((x) => x[0] === "hello@" && x[1] === 2 && x[2] === true), "checked inbox with its count");
  assert.ok(flat.some((x) => x[0] === "support@" && x[1] === 1 && x[2] === false));
  assert.deepEqual(flat[flat.length - 1], ["Needs a match", 2, true]);
  assert.ok(items(entries).every((x) => !/\(\d+\)/.test(x.label)), "no label carries a number in brackets");
  for (const it of items(entries)) it.onSelect?.();
  assert.equal(picked.filter((p) => p.startsWith("c:")).length, 3);
  assert.ok(picked.includes("m") && picked.includes("i:mbx_hello"));
});

test("a filter narrows the list and the header says what is showing, with Show all", () => {
  const calls = list({ channels: ["call"] });
  assert.deepEqual(lines(calls), ["dana"]);
  assert.ok(has(calls, "Showing") && has(calls, ">Call<") && has(calls, 'data-testid="inbox-showall"'));
  assert.deepEqual(lines(list({ needsMatch: true })), ["unk", "ben"]);
  assert.deepEqual(lines(list({ scope: { kind: "mailbox", id: "mbx_support" } })), ["tomas"]);
  assert.ok(has(list({ scope: { kind: "mailbox", id: "mbx_support" } }), "support@"), "the header is the inbox's name");
  assert.deepEqual(lines(list({ scope: { kind: "follow" } })), ["elena", "hannah", "nina"]);
  assert.deepEqual(lines(list({ scope: { kind: "camp" } })), ["priya", "jonas"]);
  assert.deepEqual(lines(list({ query: "lease" })), ["elena"]);
  assert.deepEqual(lines(list({ channels: ["email", "sms"], inboxes: ["mbx_hello"] })), ["wei", "ben"], "two filters narrow together");
  assert.ok(!has(list(), 'data-testid="inbox-showing"'), "nothing narrowed, nothing to show");
});

test("an empty result says so and offers Show all", () => {
  const out = list({ query: "zzz" }, harbor);
  assert.ok(has(out, "Nothing matches these filters.") && has(out, "Show all"));
  assert.ok(has(list({}, { ...harbor, contacts: [] }), "Nothing here"));
});

test("the sidebar groups inboxes with their unread counts and keeps the lists and calendars", () => {
  const out = side();
  const order = ["By contact", "All inboxes", "Calendar", "Mine", "Shared", "Agents", "Lists", "Calendars"].map((t) => at(out, `>${t}<`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "rows then Mine, Shared, Agents, Lists, Calendars");
  for (const label of ["Work Gmail", "Personal", "+1 415 555 0132", "hello@", "support@", "intake@", "Starred", "Following", "Campaigns", "Work Google", "Microsoft"]) assert.ok(has(out, `>${label}<`), label);
  assert.ok(has(out, 'data-testid="row-nav:view:contact"') && has(out, 'data-testid="row-nav:view:contact-trailing"'), "sidebar rows are ui/Row with slots");
  const dot = (id: string): string => (out.match(/<div[^>]*data-testid="cal-dot-[^"]*"[^>]*>/g) ?? []).find((t) => t.includes(`cal-dot-${id}"`)) ?? "";
  assert.ok(dot("cal_work").includes("background-color") && dot("cal_ms").includes("background-color") && dot("cal_work") !== dot("cal_ms"), "each calendar has its own colour dot");
  assert.ok(has(out, 'data-testid="inbox-dialer"') && has(out, "Dialer"));
  assert.equal(out.split("background-color:var(--sel)").length - 1, 1, "exactly one row is selected: By contact, with the quiet selection token");
});

test("the sidebar counts unread conversations per inbox, once each", () => {
  const s = createSampleInbox();
  const counts = s.data.screens.query("inbox.sidebar", "counts").getSnapshot();
  assert.equal(counts.status, "ready");
  const data = (counts as { status: "ready"; data: { byInbox: { id: string; unread: number }[]; total: number; needsMatch: number } }).data;
  const by = Object.fromEntries(data.byInbox.map((c) => [c.id, c.unread]));
  assert.deepEqual([by["mbx_work"], by["mbx_pers"], by["mbx_hello"], by["mbx_support"], by["mbx_intake"], by["+1 415 555 0132"], by["+1 415 555 0177"]], [1, 0, 2, 1, 1, 2, 1]);
  assert.equal(data.total, 8);
  assert.equal(data.needsMatch, 2);
  const groups = navGroups(northwind.mailboxes, data);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.label)]), [
    ["Mine", ["Work Gmail", "Personal", "+1 415 555 0132", "+1 415 555 0177"]], ["Shared", ["hello@", "support@"]], ["Agents", ["intake@"]],
  ]);
  assert.ok(groups[0]!.items[1]!.lock, "a private mailbox shows its lock");
});

test("a hidden calendar is dimmed in the sidebar and Show Only This keeps one", () => {
  const out = side({ hiddenCalendars: ["cal_ms"] });
  assert.ok(has(out, "opacity:0.45"), "the hidden calendar is quiet");
  const only = reduce(INITIAL_STATE, { type: "calendarOnly", id: "cal_work", all: ["cal_work", "cal_ms", "cal_pers"] });
  assert.deepEqual(only.hiddenCalendars, ["cal_ms", "cal_pers"]);
  assert.deepEqual(reduce(only, { type: "calendarVisible", id: "cal_ms" }).hiddenCalendars, ["cal_pers"]);
});

test("the state: views, scopes, filters, Show all and folded sections are single named actions", () => {
  let s = INITIAL_STATE;
  s = reduce(s, { type: "channel", channel: "sms" });
  s = reduce(s, { type: "inbox", id: "mbx_work" });
  s = reduce(s, { type: "needsMatch" });
  s = reduce(s, { type: "query", query: "lease" });
  assert.deepEqual([s.channels, s.inboxes, s.needsMatch, s.query], [["sms"], ["mbx_work"], true, "lease"]);
  assert.deepEqual(listState(s), { channel: "sms", needsMatch: true, query: "lease" });
  assert.deepEqual(listState(reduce(s, { type: "scope", scope: { kind: "mailbox", id: "mbx_work" } })), { mailboxId: "mbx_work", channel: "sms", needsMatch: true, query: "lease" });
  assert.deepEqual(listState(reduce(INITIAL_STATE, { type: "scope", scope: { kind: "number", id: "+1 415 555 0132" } })), { numberId: "+1 415 555 0132" });
  assert.deepEqual(reduce(s, { type: "channel", channel: "sms" }).channels, [], "a second click unchecks");
  const cleared = reduce(s, { type: "showAll" });
  assert.deepEqual([cleared.channels, cleared.inboxes, cleared.needsMatch, cleared.query], [[], [], false, ""]);
  assert.deepEqual(reduce(reduce(INITIAL_STATE, { type: "section", key: "lists" }), { type: "section", key: "lists" }).closed, []);
  assert.equal(reduce(INITIAL_STATE, { type: "calendar" }).main, "calendar");
  assert.equal(reduce(reduce(INITIAL_STATE, { type: "calendar" }), { type: "view", view: "calls" }).main, "list", "picking a view leaves the Calendar");
  assert.equal(scopeTitle({ kind: "follow" }, northwind.mailboxes), "Following");
});

test("times: a clock time today, Yesterday, the weekday this week, then the date", () => {
  const now = Date.UTC(2025, 9, 24, 10, 40);
  const min = 60_000;
  assert.equal(listTime(now - 25 * min, now, 0), "10:15 AM");
  assert.equal(listTime(now - 10 * 60 * min, now, 0), "12:40 AM");
  assert.equal(listTime(now - 24 * 60 * min, now, 0), "Yesterday");
  assert.equal(listTime(now - 3 * 24 * 60 * min, now, 0), "Tue");
  assert.equal(listTime(now - 9 * 24 * 60 * min, now, 0), "Oct 15");
  assert.equal(listTime(now - 25 * min, now, -480), "2:15 AM", "the person's own day");
});

test("the line's menu opens, marks read or unread, follows, stars and matches", () => {
  const s = createSampleInbox();
  const rows = s.replica.rows("contacts") as unknown as Parameters<typeof contactEntry>[0][];
  const elena = contactEntry(rows.find((r) => r.id === "elena")!, northwind.mailboxes);
  const unk = contactEntry(rows.find((r) => r.id === "unk")!, northwind.mailboxes);
  const did: string[] = [];
  const h = { open: () => void did.push("open"), read: (r: boolean) => void did.push(`read:${r}`), follow: (f: boolean) => void did.push(`follow:${f}`), star: (on: boolean) => void did.push(`star:${on}`), match: () => void did.push("match") };
  const e = items(lineMenuEntries(elena, h));
  assert.deepEqual(e.map((x) => x.label), ["Open", "Mark as Read", "Unfollow", "Star"]);
  for (const it of e) it.onSelect?.();
  assert.deepEqual(did, ["open", "read:true", "follow:false", "star:true"]);
  const marcus = contactEntry(rows.find((r) => r.id === "marcus")!, northwind.mailboxes);
  assert.deepEqual(items(lineMenuEntries(marcus, h)).map((x) => x.label), ["Open", "Mark as Read", "Follow", "Unstar"], "a starred conversation offers Unstar");
  items(lineMenuEntries(marcus, h))[3]!.onSelect?.();
  assert.equal(did[did.length - 1], "star:false");
  assert.deepEqual(items(lineMenuEntries(unk, h)).map((x) => x.label), ["Open", "Mark as Read", "Match to a record…"]);
});

test("writes change what the next render shows: mark read lowers the unread count, follow adds the line to Following", async () => {
  const s = createSampleInbox();
  const html = (): string => wrap(s, {}, <ContactList />);
  assert.ok(html().includes("8 unread of 13"));
  await s.data.call("inbox.mark_read", { conversationId: "elena", read: true });
  assert.ok(html().includes("7 unread of 13") && !html().includes('data-testid="unread-elena"'));
  await s.data.call("inbox.follow_set", { contactId: "ct_sofia", follow: true });
  assert.deepEqual(lines(wrap(s, { scope: { kind: "follow" } }, <ContactList />)), ["elena", "hannah", "sofia", "nina"]);
  assert.deepEqual(s.calls.map((c) => c.cap), ["inbox.mark_read", "inbox.follow_set"]);
});

test("the list opens offline from the kept copy and says so", () => {
  const out = list({}, northwind, { online: false });
  assert.ok(has(out, "Offline, showing your saved copy") && has(out, "Elena Rivera") && has(out, "Lease documents for Thursday"));
  assert.ok(!has(list(), "Offline, showing"));
});

test("before data arrives the sidebar and the list draw a frame of the right size, never a blank page", () => {
  assert.ok(has(renderToStaticMarkup(<ContactList />), "inbox-list-loading"));
  assert.ok(has(renderToStaticMarkup(<InboxSidebar />), "inbox-sidebar-loading"));
  assert.ok(has(renderToStaticMarkup(<ListLoading />), "All inboxes") && has(renderToStaticMarkup(<SidebarLoading />), "Loading"));
});

test("harbor studio draws its own inboxes, contacts and calendar", () => {
  const out = wrap(createSampleInbox(harbor), {}, <ContactList />);
  assert.deepEqual(lines(out), ["kai", "abel", "june"]);
  assert.ok(has(out, "Kai Moreno") && !has(out, "Elena Rivera"));
  const sidebar = wrap(createSampleInbox(harbor), {}, <InboxSidebar />);
  assert.ok(has(sidebar, "Studio Gmail") && has(sidebar, ">Studio<") && !has(sidebar, "Work Gmail"));
});

test("narrowing is a function of the entries and the state alone", () => {
  const mk = (key: string, at: number, o: Partial<Entry> = {}): Entry => ({ key, kind: "contact", name: key, snippet: "", at, unread: 0, channel: "email", via: "", inboxIds: ["a"], needsMatch: false, followed: false, starred: false, campaign: false, missed: false, openId: key, ...o });
  const es = [mk("old", 1), mk("new", 9), mk("ghost", 5, { needsMatch: true }), mk("call", 7, { channel: "call", inboxIds: ["b"] })];
  assert.deepEqual(narrow(es, INITIAL_STATE).map((e) => e.key), ["ghost", "new", "call", "old"], "an unmatched sender first, then newest first");
  assert.deepEqual(narrow(es, { ...INITIAL_STATE, inboxes: ["b"] }).map((e) => e.key), ["call"]);
  assert.deepEqual(narrow(es, { ...INITIAL_STATE, channels: ["call"] }).map((e) => e.key), ["call"]);
  const starred = [mk("old", 1, { starred: true }), mk("new", 9), mk("mid", 5, { starred: true })];
  assert.deepEqual(narrow(starred, { ...INITIAL_STATE, scope: { kind: "starred" } }).map((e) => e.key), ["mid", "old"], "Starred keeps only starred conversations, newest first");
});

// ---------------------------------------------------------------- P-L9c_01b: the Starred list

test("Starred: a list under Lists, before Following, that holds the starred conversations", () => {
  const out = side();
  assert.ok(at(out, ">Lists<") < at(out, ">Starred<") && at(out, ">Starred<") < at(out, ">Following<") && at(out, ">Following<") < at(out, ">Campaigns<"));
  assert.ok(has(out, 'data-testid="row-nav:list:starred"') && has(out, 'data-testid="row-nav:list:starred-leading"'), "a ui/Row with a leading glyph");
  assert.deepEqual(lines(list({ scope: { kind: "starred" } })), ["marcus", "priya"]);
  assert.ok(has(list({ scope: { kind: "starred" } }), ">Starred<"), "the header names the list");
  assert.equal(scopeTitle({ kind: "starred" }, northwind.mailboxes), "Starred");
  const tagOf = (out: string): string => /<[^<>]*data-testid="row-nav:list:starred"[^<>]*>/.exec(out)?.[0] ?? "";
  assert.ok(has(tagOf(side({ scope: { kind: "starred" } })), "background-color:var(--sel)"), "the row is selected when its list is showing");
  assert.ok(!has(tagOf(side()), "background-color:var(--sel)"));
});

test("Starred: starring a conversation shows it under Starred, unstarring takes it out", async () => {
  const s = createSampleInbox();
  const html = (initial: Partial<InboxState>): string => wrap(s, initial, <ContactList />);
  assert.deepEqual(lines(html({ scope: { kind: "starred" } })), ["marcus", "priya"]);
  await s.data.call("stars.toggle", { resource: { type: "record", id: "ct_elena" }, on: true });
  assert.deepEqual(lines(html({ scope: { kind: "starred" } })), ["marcus", "elena", "priya"], "elena joins, newest first (marcus 18 min, elena 25 min, priya 70 min)");
  assert.ok(has(html({}), 'data-testid="star-elena"'), "a starred line carries the star mark");
  await s.data.call("stars.toggle", { resource: { type: "record", id: "ct_marcus" }, on: false });
  assert.deepEqual(lines(html({ scope: { kind: "starred" } })), ["elena", "priya"]);
  assert.ok(!has(html({}), 'data-testid="star-marcus"'));
  assert.deepEqual(s.calls.map((c) => c.cap), ["stars.toggle", "stars.toggle"]);
});
