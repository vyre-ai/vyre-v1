// Inbox sidebar > Calendars: every row has a defined click, hover, right-click and keyboard. Click shows or hides the calendar (the dot fills or hollows in its own colour), the row
// is named for the calendar (the account address, never "Google Calendar" when it can say whose), the menu offers Show only this calendar, Colour, Sync now, Open in Google Calendar
// and Calendar settings, a quiet line says Syncing or Couldn't sync with Retry, and Up, Down, Space and Enter work on a focused row.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { act } from "react";
import type { ReactElement } from "react";
import { find, flush, installDom, mount, press } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { createSampleInbox, harbor } from "../contactlist/sample.ts";
import type { SampleSpace } from "../contactlist/sample.ts";
import {
  CALENDAR_COLOURS, InboxDataProvider, InboxSidebar, InboxStateProvider, calendarColourMenu, calendarName, calendarRowKey, calendarRowMenu, calendarStatus, canSyncNow, providerUrl, reduce, INITIAL_STATE,
} from "../sidebar/index.ts";
import type { CalendarRow, InboxData, InboxState } from "../sidebar/index.ts";
import { isItem, isSeparator } from "../../../../../../ui/src/Menu/props.ts";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/props.ts";

const ME = "usr_irfad";
const ACCOUNT = "irfad@harborstudio.example";
const cal = (c: Partial<CalendarRow> & { id: string; title: string }): CalendarRow => ({ color: "#4f6bed", provider: "google", ownerId: ME, personal: false, state: "syncing", ...c });
const SPACE: SampleSpace = {
  ...harbor,
  mailboxes: harbor.mailboxes.map((m) => ({ ...m, ownerId: m.kind === "personal" ? ME : undefined } as typeof m)),
  calendars: [
    cal({ id: "cal_g", title: "Google Calendar", color: "#16a085" }),
    cal({ id: "cal_cons", title: "Consults", color: "#d35400", ownerId: "usr_omar", state: "error" }),
    cal({ id: "cal_ms", title: "Outlook Calendar", provider: "microsoft", color: "#8e44ad" }),
    cal({ id: "cal_pers", title: "Personal", provider: "local", personal: true, color: "#c0392b" }),
  ],
};

const side = (initial: Partial<InboxState> = {}): string => {
  const s = createSampleInbox(SPACE);
  return renderToStaticMarkup(<InboxDataProvider value={s.data}><InboxStateProvider initial={initial}><InboxSidebar /></InboxStateProvider></InboxDataProvider>).replaceAll("<!-- -->", "");
};
const tag = (out: string, id: string): string => (out.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`)) ?? [""])[0];
const items = (e: readonly MenuEntry[]): MenuItem[] => e.filter(isItem);

// ---- the screen

test("screen: each calendar row is named for the calendar, never \"Google Calendar\" when it can say whose, with the provider's mark and its colour dot", () => {
  const out = side();
  assert.ok(out.includes(`>${ACCOUNT}<`), "the Google calendar is named for its account");
  assert.ok(out.includes(">Consults<") && out.includes(">Personal<"), "a calendar with its own name keeps it");
  assert.ok(!out.includes(">Google Calendar<"), "no row says Google Calendar");
  assert.ok(out.includes('data-testid="cal-mark-cal_g"') && out.includes('data-testid="cal-mark-cal_ms"') && !out.includes('data-testid="cal-mark-cal_pers"'), "provider calendars carry the mark; a Vyre calendar does not");
  for (const id of ["cal_g", "cal_cons", "cal_ms", "cal_pers"]) {
    assert.ok(out.includes(`data-testid="row-nav:cal:${id}"`), `${id} is a ui/Row`);
    assert.ok(out.includes(`data-testid="cal-more-${id}"`), `${id} has its "..." for hover and focus`);
    assert.ok(tag(out, `cal-dot-${id}`).includes('aria-label="Shown"'), `${id} is shown by default`);
  }
  assert.ok(!out.includes(String.fromCharCode(0x2014)) && !out.includes(String.fromCharCode(0xa7)), "no em dash, no section sign");
});

test("screen: a hidden calendar's dot is hollow in its own colour, a shown one is filled", () => {
  const out = side({ hiddenCalendars: ["cal_cons"] });
  assert.ok(tag(out, "cal-dot-cal_cons").includes('aria-label="Hidden"'));
  assert.ok(tag(out, "cal-dot-cal_g").includes('aria-label="Shown"'));
  assert.ok(out.includes('aria-pressed="false"') && out.includes('aria-pressed="true"'), "the row says whether it is shown");
  assert.ok(!out.includes("opacity:0.45"), "the row itself is not dimmed: the dot carries it");
});

test("screen: a calendar whose last pull failed says so quietly under the row, with Retry", () => {
  const out = side();
  assert.ok(out.includes('data-testid="cal-status-cal_cons"') && out.includes("Couldn&#x27;t sync") && out.includes('data-testid="cal-retry-cal_cons"') && out.includes(">Retry<"));
  assert.ok(!out.includes('data-testid="cal-status-cal_g"'), "a calendar that synced has no status line");
});

// ---- the pure parts

test("names: the title when it is the calendar's own, the owner's mailbox address when the title is the generic one, the title when there is no single such address", () => {
  const boxes = SPACE.mailboxes;
  assert.equal(calendarName(SPACE.calendars[0]!, boxes), ACCOUNT);
  assert.equal(calendarName(SPACE.calendars[1]!, boxes), "Consults");
  assert.equal(calendarName(SPACE.calendars[2]!, boxes), "Outlook Calendar", "no Outlook mailbox to name it for");
  assert.equal(calendarName(SPACE.calendars[0]!, []), "Google Calendar");
  assert.equal(calendarName(cal({ id: "x", title: "maya@firm.test" }), boxes), "maya@firm.test", "the server names new ones for their account");
});

test("menu: Show only this calendar, Colour, Sync now, Open in Google Calendar and Calendar settings, each doing its one thing", () => {
  const did: string[] = [];
  const a = { only: () => void did.push("only"), colour: () => void did.push("colour"), syncNow: () => void did.push("sync"), openIn: (u: string) => void did.push(`open:${u}`), settings: () => void did.push("settings") };
  const g = calendarRowMenu(SPACE.calendars[0]!, ACCOUNT, ME, a);
  assert.deepEqual(items(g).map((i) => i.label), ["Show only this calendar", "Colour…", "Sync now", "Open in Google Calendar", "Calendar settings"]);
  assert.equal(g.filter(isSeparator).length, 2);
  for (const i of items(g)) i.onSelect?.();
  assert.deepEqual(did, ["only", "colour", "sync", `open:https://calendar.google.com/calendar/r?authuser=${encodeURIComponent(ACCOUNT)}`, "settings"]);
  const theirs = items(calendarRowMenu(SPACE.calendars[1]!, "Consults", ME, a)).find((i) => i.label === "Sync now")!;
  assert.ok(theirs.disabled === true && /Only the person whose calendar it is/.test(theirs.reason ?? ""), "someone else's calendar: Sync now is shown, not choosable, and says why");
  assert.deepEqual(items(calendarRowMenu(SPACE.calendars[2]!, "Outlook Calendar", ME, a)).map((i) => i.label), ["Show only this calendar", "Colour…", "Sync now", "Open in Outlook", "Calendar settings"]);
  assert.deepEqual(items(calendarRowMenu(SPACE.calendars[3]!, "Personal", ME, a)).map((i) => i.label), ["Show only this calendar", "Colour…", "Calendar settings"], "a Vyre calendar has nothing to pull or open elsewhere");
  assert.ok(!items(calendarRowMenu(SPACE.calendars[0]!, ACCOUNT, ME, a, false)).some((i) => i.label.startsWith("Open in")), "no way to open a page: the item is left out");
  assert.deepEqual(canSyncNow(SPACE.calendars[0]!, ME), { ok: true });
  assert.equal(providerUrl(SPACE.calendars[3]!, "Personal"), null);
});

test("menu: Colour lists the palette by name with the current colour checked, and a pick says which", () => {
  let picked = "";
  const m = items(calendarColourMenu("#16A085", (hex) => { picked = hex; }));
  assert.deepEqual(m.map((i) => i.label), CALENDAR_COLOURS.map((c) => c.name));
  assert.deepEqual(m.filter((i) => i.checked).map((i) => i.label), ["Green"]);
  m.find((i) => i.label === "Purple")!.onSelect!();
  assert.equal(picked, "#8e44ad");
});

test("status: Syncing while a pull the person started runs, Couldn't sync with Retry after a failure, nothing for a Vyre calendar", () => {
  assert.deepEqual(calendarStatus({ provider: "google", state: "syncing" }, true, false), { kind: "syncing", text: "Syncing…" });
  assert.deepEqual(calendarStatus({ provider: "google", state: "error" }, false, false), { kind: "failed", text: "Couldn't sync", action: "Retry" });
  assert.deepEqual(calendarStatus({ provider: "google", state: "syncing" }, false, true), { kind: "failed", text: "Couldn't sync", action: "Retry" }, "a Sync now that was refused");
  assert.equal(calendarStatus({ provider: "google", state: "syncing" }, false, false), null);
  assert.equal(calendarStatus({ provider: "local", state: "error" }, true, true), null);
});

test("keys: Up and Down move within the rows, Space toggles, Enter shows only this one, anything else is not the row's", () => {
  assert.deepEqual(calendarRowKey("ArrowDown", 0, 3), { type: "move", to: 1 });
  assert.equal(calendarRowKey("ArrowDown", 2, 3), null, "the last row stays");
  assert.deepEqual(calendarRowKey("ArrowUp", 2, 3), { type: "move", to: 1 });
  assert.equal(calendarRowKey("ArrowUp", 0, 3), null);
  assert.deepEqual(calendarRowKey(" ", 1, 3), { type: "toggle" });
  assert.deepEqual(calendarRowKey("Enter", 1, 3), { type: "only" });
  assert.equal(calendarRowKey("a", 1, 3), null);
  const only = reduce(INITIAL_STATE, { type: "calendarOnly", id: "cal_g", all: ["cal_g", "cal_cons", "cal_ms"] });
  assert.deepEqual(only.hiddenCalendars, ["cal_cons", "cal_ms"]);
});

// ---- pressing things

installDom();

function live(): { data: InboxData; calls: { cap: string; input: unknown }[]; opened: string[]; fail: Set<string> } {
  const s = createSampleInbox(SPACE);
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const fail = new Set<string>();
  const data: InboxData = {
    ...s.data,
    me: ME,
    nav: { ...s.data.nav, openExternal: (u) => void opened.push(`url:${u}`), openCalendarSettings: () => void opened.push("settings:mail") },
    async call(cap, input) {
      calls.push({ cap, input });
      if (fail.has(cap)) throw new Error("refused");
      return {};
    },
  };
  return { data, calls, opened, fail };
}
const tree = (data: InboxData): ReactElement => <InboxDataProvider value={data}><InboxStateProvider><InboxSidebar /></InboxStateProvider></InboxDataProvider>;
const label = (root: Node, id: string): unknown => find(root, `cal-dot-${id}`)?.props["aria-label"];
const key = async (n: Node | null, k: string): Promise<void> => {
  assert.ok(n);
  await act(async () => { (n.props["onKeyDown"] as (e: unknown) => void)({ key: k, preventDefault() {} }); });
};
const rightClick = async (root: Node, id: string): Promise<void> => {
  const n = find(root, `cal-row-${id}`);
  assert.ok(n);
  await act(async () => { (n.props["onContextMenu"] as (e: unknown) => void)({ clientX: 40, clientY: 300, preventDefault() {} }); });
};

test("click toggles the calendar shown and hidden; Space does too; Enter shows only it", async () => {
  const { data } = live();
  const root = await mount(createRoot, tree(data));
  assert.equal(label(root, "cal_g"), "Shown");
  await press(find(root, "row-nav:cal:cal_g"));
  assert.equal(label(root, "cal_g"), "Hidden", "a click hides it");
  await press(find(root, "row-nav:cal:cal_g"));
  assert.equal(label(root, "cal_g"), "Shown", "and a second click shows it again");
  await key(find(root, "row-nav:cal:cal_ms"), " ");
  assert.equal(label(root, "cal_ms"), "Hidden", "Space toggles");
  await key(find(root, "row-nav:cal:cal_cons"), "Enter");
  assert.deepEqual(["cal_g", "cal_cons", "cal_ms", "cal_pers"].map((id) => label(root, id)), ["Hidden", "Shown", "Hidden", "Hidden"], "Enter shows only that calendar");
});

test("right-click opens the menu; its items show only, sync, open the provider and Calendar settings", async () => {
  const { data, calls, opened } = live();
  const root = await mount(createRoot, tree(data));
  await rightClick(root, "cal_g");
  assert.ok(find(root, "menu-item-Show only this calendar") && find(root, "menu-item-Calendar settings"));
  await press(find(root, "menu-item-Sync now"));
  await flush();
  assert.deepEqual(calls.at(-1), { cap: "calendar.sync_now", input: { calendarId: "cal_g" } });
  await rightClick(root, "cal_g");
  await press(find(root, "menu-item-Open in Google Calendar"));
  assert.equal(opened.at(-1), `url:https://calendar.google.com/calendar/r?authuser=${encodeURIComponent(ACCOUNT)}`);
  await rightClick(root, "cal_g");
  await press(find(root, "menu-item-Calendar settings"));
  assert.equal(opened.at(-1), "settings:mail");
  await rightClick(root, "cal_ms");
  await press(find(root, "menu-item-Show only this calendar"));
  assert.deepEqual(["cal_g", "cal_ms"].map((id) => label(root, id)), ["Hidden", "Shown"]);
});

test("the \"...\" opens the same menu; Colour opens the palette and a pick writes the calendar's colour", async () => {
  const { data, calls } = live();
  const root = await mount(createRoot, tree(data));
  await press(find(root, "cal-more-cal_g"));
  assert.equal(label(root, "cal_g"), "Shown", "the \"...\" does not toggle the row under it");
  await press(find(root, "menu-item-Colour…"));
  assert.ok(find(root, "menu-item-Green") && find(root, "menu-item-Slate"), "the palette");
  await press(find(root, "menu-item-Purple"));
  await flush();
  assert.deepEqual(calls.at(-1), { cap: "calendar.update_calendar", input: { calendarId: "cal_g", color: "#8e44ad" } });
});

test("a refused Sync now says Couldn't sync under the row, and Retry asks again", async () => {
  const { data, calls, fail } = live();
  fail.add("calendar.sync_now");
  const root = await mount(createRoot, tree(data));
  assert.equal(find(root, "cal-status-cal_g"), null);
  await rightClick(root, "cal_g");
  await press(find(root, "menu-item-Sync now"));
  await flush();
  assert.ok(find(root, "cal-status-cal_g") && find(root, "cal-retry-cal_g"), "the failure is said under the row");
  fail.delete("calendar.sync_now");
  await press(find(root, "cal-retry-cal_g"));
  await flush();
  assert.equal(calls.filter((c) => c.cap === "calendar.sync_now").length, 2, "Retry pulls again");
  assert.equal(find(root, "cal-status-cal_g"), null, "and the line goes once the pull works");
});
