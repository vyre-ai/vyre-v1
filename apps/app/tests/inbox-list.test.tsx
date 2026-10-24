// Screen test for the inbox contact list (spec 3.3).
// Three views, header and filter menus with checkmarks, virtual window over 10k rows.
// Counts live in the filter menu. The list does not render pill chips.

import test from "node:test";
import assert from "node:assert/strict";
import { MenuPlaceholder } from "../../../ui/src/Menu/Placeholder.tsx";
import type { MenuEntry } from "../../../ui/src/Menu/props.ts";
import {
  ROW_HEIGHT,
  SCROLL_FRAME_BUDGET_MS,
  SCROLL_WINDOW,
  initialListState,
  manyConversations,
  moveSelection,
  scrollTo,
  setView,
  showAll,
  toggleChannel,
  toggleMailbox,
  toggleNeedsMatch,
  toggleNumber,
  windowOf,
} from "../src/places/inbox/contactlist/model.ts";
import type { FilterCounts, InboxView, ListState } from "../src/places/inbox/contactlist/model.ts";
import { loadList, seedConversations, seedHarbor, seedNorthwind } from "../src/places/inbox/contactlist/replica.ts";
import type { ListLoad } from "../src/places/inbox/contactlist/replica.ts";

function menu(items: readonly MenuEntry[]): string {
  return MenuPlaceholder({ items, source: "other" });
}

function checkedLabels(html: string): string[] {
  return [...html.matchAll(/data-checked="true">([^<]+)/g)].map((match) => match[1] ?? "");
}

function viewMenu(view: InboxView): string {
  const items: MenuEntry[] = [
    { label: "By contact", checked: view === "contact" },
    { label: "By thread", checked: view === "thread" },
    { label: "Calls only", checked: view === "calls" },
  ];
  return menu(items);
}

function filterMenu(state: ListState, counts: FilterCounts): string {
  const items: MenuEntry[] = [
    { label: `Email (${counts.email})`, checked: state.channel === "email" },
    { label: `Text (${counts.sms})`, checked: state.channel === "sms" },
    { label: `Calls (${counts.call})`, checked: state.channel === "call" },
    { separator: true },
  ];
  for (const inbox of counts.inboxes) {
    const on = state.view === "calls" ? state.numberId === inbox.id : state.mailboxId === inbox.id;
    items.push({ label: `${inbox.title} (${inbox.count})`, checked: on });
  }
  items.push({ label: `Needs a match (${counts.needsMatch})`, checked: state.needsMatch });
  return menu(items);
}

function screenHtml(load: ListLoad): string {
  const rows = load.windowRows
    .map((row) => `<div data-row="true" data-id="${row.id}"><span>${row.title}</span><span>${row.note}</span></div>`)
    .join("");
  const header = `<header data-showing="${load.showing}">${viewMenu(load.state.view)}<p>${load.showing}</p><button type="button" data-action="show-all">Show all</button></header>`;
  const filters = filterMenu(load.state, load.counts);
  return `<section data-screen="inbox.contact-list" data-view="${load.state.view}" data-phase="${load.phase}" data-total="${load.total}" data-window="${load.windowRows.length}">${header}${filters}${rows}</section>`;
}

test("three views: By contact, By thread, and Calls only, with one header checkmark", () => {
  const north = seedNorthwind();
  const contact = loadList(north, initialListState());
  const thread = loadList(north, setView(initialListState(), "thread"));
  const calls = loadList(north, setView(initialListState(), "calls"));

  assert.equal(contact.phase, "ready");
  assert.equal(contact.showing, "All conversations");
  assert.equal(contact.total, 4);
  assert.equal(contact.virtual.rowHeight, ROW_HEIGHT);
  assert.equal(contact.virtual.window?.start, 0);
  assert.equal(contact.virtual.window?.end, 4);
  assert.deepEqual(contact.windowRows.map((row) => row.title), ["Elena Rivera", "Priya Nair", "Marcus Webb", "Marcus Pruitt"]);
  assert.equal(contact.windowRows[0]?.note, "The revised terms · 2 unread");
  assert.equal(contact.windowRows[3]?.note, "Missed call");
  assert.deepEqual(contact.counts, {
    email: 2,
    sms: 1,
    call: 1,
    needsMatch: 1,
    inboxes: [
      { id: "mbx_work", title: "Work", count: 2 },
      { id: "mbx_support", title: "Support", count: 2 },
    ],
  });
  assert.deepEqual(checkedLabels(viewMenu(contact.state.view)), ["By contact"]);

  assert.equal(thread.showing, "By thread");
  assert.equal(thread.state.view, "thread");
  assert.deepEqual(thread.windowRows.map((row) => row.title), ["Revised terms", "Tomorrow", "Invoice 104", "Unknown sender"]);
  assert.equal(thread.windowRows[0]?.note, "Email · 2 unread");
  assert.equal(thread.counts.email, 3);
  assert.equal(thread.counts.sms, 1);
  assert.equal(thread.counts.call, 0);
  assert.equal(thread.counts.needsMatch, 1);
  assert.deepEqual(checkedLabels(viewMenu(thread.state.view)), ["By thread"]);

  assert.equal(calls.showing, "Calls only");
  assert.equal(calls.total, 2);
  assert.deepEqual(calls.windowRows.map((row) => row.title), ["Elena Rivera", "+1 212 555 0148"]);
  assert.equal(calls.windowRows[0]?.note, "Incoming, completed");
  assert.equal(calls.windowRows[1]?.note, "Incoming, missed");
  assert.deepEqual(calls.counts, {
    email: 0,
    sms: 0,
    call: 2,
    needsMatch: 1,
    inboxes: [{ id: "num_main", title: "Main", count: 2 }],
  });
  assert.deepEqual(checkedLabels(viewMenu(calls.state.view)), ["Calls only"]);

  const contactHtml = screenHtml(contact);
  const threadHtml = screenHtml(thread);
  const callsHtml = screenHtml(calls);
  assert.equal(contactHtml.includes('data-view="contact"'), true);
  assert.equal(threadHtml.includes('data-view="thread"'), true);
  assert.equal(callsHtml.includes('data-view="calls"'), true);
  assert.equal(contactHtml.includes('data-action="show-all"'), true);
  assert.equal(contactHtml.includes("data-chip"), false);
  assert.equal(contactHtml.includes("data-pill"), false);
  assert.equal(threadHtml.includes("data-chip"), false);
  assert.equal(callsHtml.includes("data-pill"), false);

  const down = moveSelection(contact.windowRows, undefined, "ArrowDown");
  assert.equal(down.selectedId, "cnv_elena");
  assert.equal(down.open, false);
  const next = moveSelection(contact.windowRows, down.selectedId, "ArrowDown");
  assert.equal(next.selectedId, "cnv_priya");
  const back = moveSelection(contact.windowRows, next.selectedId, "ArrowUp");
  assert.equal(back.selectedId, "cnv_elena");
  const opened = moveSelection(contact.windowRows, back.selectedId, "Enter");
  assert.equal(opened.open, true);
  assert.equal(opened.selectedId, "cnv_elena");
  assert.deepEqual(moveSelection(contact.windowRows, undefined, "Enter"), { open: false });

  const harbor = loadList(seedHarbor(), initialListState());
  assert.equal(harbor.phase, "ready");
  assert.deepEqual(harbor.windowRows.map((row) => row.title), ["Kai Moreno", "Ruth Abel"]);
  const harborCalls = loadList(seedHarbor(), setView(initialListState(), "calls"));
  assert.equal(harborCalls.windowRows[0]?.title, "Kai Moreno");
  assert.equal(harborCalls.windowRows[0]?.note, "Outgoing, completed");
  assert.equal(harborCalls.counts.inboxes[0]?.title, "Studio");
});

test("filter menu shows counts and checkmarks, and Show all clears them", () => {
  const north = seedNorthwind();
  const open = loadList(north, initialListState());
  const email = toggleChannel(initialListState(), "email");
  const emailAndWork = toggleMailbox(email, "mbx_work");
  const filtered = loadList(north, emailAndWork);

  assert.equal(filtered.showing, "Email, Work");
  assert.equal(filtered.total, 1);
  assert.equal(filtered.windowRows[0]?.title, "Elena Rivera");
  assert.equal(filtered.counts.email, 2);
  assert.deepEqual(checkedLabels(filterMenu(emailAndWork, filtered.counts)), ["Email (2)", "Work (2)"]);
  assert.equal(filterMenu(emailAndWork, filtered.counts).includes("Text (1)"), true);
  assert.equal(filterMenu(emailAndWork, filtered.counts).includes("Calls (1)"), true);
  assert.equal(filterMenu(emailAndWork, filtered.counts).includes("Needs a match (1)"), true);
  assert.equal(filterMenu(emailAndWork, filtered.counts).includes("Support (2)"), true);
  assert.equal(filterMenu(emailAndWork, filtered.counts).includes("data-chip"), false);
  assert.equal(filterMenu(emailAndWork, filtered.counts).includes("data-pill"), false);

  const textInstead = toggleChannel(emailAndWork, "sms");
  assert.equal(textInstead.channel, "sms");
  assert.equal(textInstead.mailboxId, "mbx_work");
  assert.deepEqual(checkedLabels(filterMenu(textInstead, open.counts)), ["Text (1)", "Work (2)"]);

  const channelOff = toggleChannel(textInstead, "sms");
  assert.equal(channelOff.channel, undefined);
  assert.deepEqual(checkedLabels(filterMenu(channelOff, open.counts)), ["Work (2)"]);

  const needs = toggleNeedsMatch(emailAndWork);
  assert.equal(needs.needsMatch, true);
  const needsLoad = loadList(north, needs);
  assert.equal(needsLoad.phase, "no-match");
  assert.equal(needsLoad.showing, "Needs a match, Email, Work");
  assert.deepEqual(checkedLabels(filterMenu(needs, open.counts)), ["Email (2)", "Work (2)", "Needs a match (1)"]);

  const matchOnly = toggleNeedsMatch(initialListState());
  const matched = loadList(north, matchOnly);
  assert.equal(matched.total, 1);
  assert.equal(matched.windowRows[0]?.title, "Marcus Pruitt");
  assert.equal(matched.showing, "Needs a match");

  const supportThreads = loadList(north, toggleMailbox(setView(initialListState(), "thread"), "mbx_support"));
  assert.equal(supportThreads.showing, "Support");
  assert.deepEqual(supportThreads.windowRows.map((row) => row.title), ["Invoice 104", "Unknown sender"]);
  assert.deepEqual(checkedLabels(filterMenu(supportThreads.state, supportThreads.counts)), ["Support (2)"]);

  const mainCalls = loadList(north, toggleNumber(setView(initialListState(), "calls"), "num_main"));
  assert.equal(mainCalls.showing, "Main");
  assert.equal(mainCalls.total, 2);
  assert.deepEqual(checkedLabels(viewMenu(mainCalls.state.view)), ["Calls only"]);
  assert.deepEqual(checkedLabels(filterMenu(mainCalls.state, mainCalls.counts)), ["Main (2)"]);

  const cleared = showAll(needs);
  assert.equal(cleared.view, "contact");
  assert.equal(cleared.needsMatch, false);
  assert.equal(cleared.channel, undefined);
  assert.equal(cleared.mailboxId, undefined);
  assert.equal(cleared.numberId, undefined);
  const again = loadList(north, cleared);
  assert.equal(again.showing, "All conversations");
  assert.equal(again.total, 4);
  assert.deepEqual(checkedLabels(filterMenu(cleared, again.counts)), []);

  const missed = loadList(north, { ...initialListState(), query: "zzzz-none" });
  assert.equal(missed.phase, "no-match");
  assert.equal(missed.total, 0);
  assert.equal(missed.unfiltered, 4);

  const empty = loadList(seedConversations([]), initialListState());
  assert.equal(empty.phase, "empty");
  assert.equal(empty.total, 0);
  assert.equal(empty.showing, "All conversations");

  assert.equal(loadList(north, initialListState(), "offline").phase, "offline");
  assert.equal(loadList(north, initialListState(), "error").phase, "error");
});

test("virtual list keeps a window over 10k conversations inside the scroll frame budget", () => {
  const replica = seedConversations(manyConversations(10_000));
  const loaded = loadList(replica, initialListState());
  assert.equal(loaded.phase, "ready");
  assert.equal(loaded.total, 10_000);
  assert.equal(loaded.virtual.data.length, 10_000);
  assert.equal(loaded.windowRows.length, SCROLL_WINDOW);
  assert.equal(loaded.virtual.window?.start, 0);
  assert.equal(loaded.virtual.window?.end, SCROLL_WINDOW);
  assert.equal(loaded.windowRows[0]?.id, "cnv_0");
  assert.equal(loaded.windowRows[0]?.title, "Person 0");
  assert.notEqual(loaded.windowRows.length, loaded.total);

  const midState = scrollTo(initialListState(), 5000, loaded.total);
  assert.equal(midState.windowStart, 5000);
  const mid = loadList(replica, midState);
  assert.equal(mid.windowRows.length, SCROLL_WINDOW);
  assert.equal(mid.windowRows[0]?.id, "cnv_5000");
  assert.equal(mid.virtual.window?.start, 5000);
  assert.equal(mid.virtual.window?.end, 5000 + SCROLL_WINDOW);

  const tailState = scrollTo(initialListState(), 1_000_000, loaded.total);
  assert.equal(tailState.windowStart, 10_000 - SCROLL_WINDOW);
  const tail = loadList(replica, tailState);
  assert.equal(tail.windowRows[0]?.id, `cnv_${10_000 - SCROLL_WINDOW}`);
  assert.equal(tail.windowRows.length, SCROLL_WINDOW);
  assert.equal(scrollTo(initialListState(), -20, loaded.total).windowStart, 0);

  const rows = loaded.virtual.data;
  let worst = 0;
  for (let frame = 0; frame < 60; frame++) {
    const start = (frame * 160) % (rows.length - SCROLL_WINDOW);
    const t0 = performance.now();
    const slice = windowOf(rows, start);
    const ms = performance.now() - t0;
    if (ms > worst) worst = ms;
    assert.equal(slice.length, SCROLL_WINDOW);
    assert.equal(slice[0]?.id, rows[start]?.id);
  }
  assert.ok(worst < SCROLL_FRAME_BUDGET_MS, `scroll frame ${worst} ms, budget ${SCROLL_FRAME_BUDGET_MS} ms`);
});
