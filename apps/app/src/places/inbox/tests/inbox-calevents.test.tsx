// Inbox > Calendar > event pane (lane l-calevents, owner report on rc.16: "events can't be clicked"). A click on an event opens it beside the calendar: when, in your time zone and how it
// repeats, the calendar, who organised it, Join, Going?, Edit, Prepare, Ask, More; the description's links; who is coming and how each answered. A past meeting shows its close-out and
// its recording or transcript. Double-click edits in place; a repeating event asks This Event or All Events; a drag says what moved with Undo; one click on an empty slot starts an event.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import type { ReactElement } from "react";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { Calendar, ME, TEAM, createCalendarSample } from "../calendar/index.ts";
import type { CalendarSample } from "../calendar/index.ts";
import { DAY, HOUR, MIN, startOfDay } from "../calendar/model.ts";
import { editDraft, editInput, eventLink, linkParts, repeatsLine, rsvpSummary, undoInput, whenLine } from "../calendar/eventpane/model.ts";
import { SAMPLE_NOW } from "../contactlist/sample.ts";
import { InboxDataProvider, InboxStateProvider } from "../sidebar/index.ts";

const TODAY = startOfDay(SAMPLE_NOW, 0);   // Friday 24 October 2025
const ev = (s: CalendarSample, id: string) => s.events().find((e) => e.id === id)!;

// ---- the pure part

test("model: when, how it repeats, the guests in one line, the description's links, the event link", () => {
  assert.equal(whenLine({ startsAt: TODAY + 11 * HOUR, endsAt: TODAY + 11 * HOUR + 45 * MIN, allDay: false }, 0), "Fri, Oct 24 · 11:00 to 11:45 AM");
  assert.equal(whenLine({ startsAt: TODAY, endsAt: TODAY + DAY, allDay: true }, 0), "Fri, Oct 24 · All day");
  assert.equal(repeatsLine("week", TODAY + 3 * DAY, 0), "Every Monday");
  assert.equal(repeatsLine("two_weeks", TODAY, 0), "Every other Friday");
  assert.equal(repeatsLine("weekday", TODAY, 0), "Every weekday");
  assert.equal(repeatsLine(undefined, TODAY, 0), "");
  assert.equal(rsvpSummary([{ response: "accepted" }, { response: "accepted" }, { response: "tentative" }, {}]), "2 going, 1 maybe, 1 not answered");
  assert.deepEqual(linkParts("Notes: https://docs.example/a, and more."), [{ text: "Notes: " }, { text: "https://docs.example/a", url: "https://docs.example/a" }, { text: ", and more." }]);
  assert.equal(eventLink("cev_1"), "vyre://event/cev_1");
});

test("model: an edit sends only what changed, says when a day or time does not read, and keeps what it changed for Undo", () => {
  const s = createCalendarSample();
  const e = ev(s, "e_planning");
  const d = editDraft(e, 0);
  assert.deepEqual([d.title, d.day, d.time, d.minutes], ["Quarterly planning", "2025-10-24", "14:00", 60]);
  assert.deepEqual(editInput(e, d, 0), { ok: true, patch: {} }, "nothing changed, nothing sent");
  const moved = editInput(e, { ...d, title: "Q1 planning", time: "15:30", minutes: 45 }, 0);
  assert.deepEqual(moved, { ok: true, patch: { title: "Q1 planning", startsAt: TODAY + 15.5 * HOUR, endsAt: TODAY + 15.5 * HOUR + 45 * MIN } });
  assert.deepEqual(undoInput(e, moved.ok ? moved.patch : {}), { title: "Quarterly planning", startsAt: e.startsAt, endsAt: e.endsAt });
  assert.deepEqual(editInput(e, { ...d, day: "next Friday" }, 0), { ok: false, error: "Write the day as 2026-11-07." });
  assert.deepEqual(editInput(e, { ...d, time: "25:00" }, 0), { ok: false, error: "Write the time as 14:30." });
  const more = editInput(e, { ...d, people: [...d.people, "sam@northwind.example"] }, 0);
  assert.ok(more.ok && Array.isArray(more.patch["attendees"]) && (more.patch["attendees"] as unknown[]).length === 3, "a new guest keeps the others as they were");
});

// ---- pressing things

installDom();

function world(props: Partial<Parameters<typeof Calendar>[0]> = {}) {
  const s = createCalendarSample();
  const opened: string[] = [];
  const tree = (): ReactElement => (
    <InboxDataProvider value={s.data}><InboxStateProvider initial={{ main: "calendar" }}>
      <Calendar me={ME} team={TEAM} onJoin={(u) => void opened.push(`join:${u}`)} onOpenUrl={(u) => void opened.push(`url:${u}`)} onOpenMeeting={(id) => void opened.push(`meeting:${id}`)}
        onOpenFile={(id) => void opened.push(`file:${id}`)} onAsk={(e) => void opened.push(`ask:${e.id}`)} onOpenEvent={(id) => void opened.push(`open:${id}`)} onCloseEvent={() => void opened.push("close")} {...props} />
    </InboxStateProvider></InboxDataProvider>
  );
  return { s, opened, tree };
}
const settle = async (): Promise<void> => { for (let i = 0; i < 4; i++) await flush(); };
const key = async (n: Node | null, k: string): Promise<void> => { assert.ok(n); await act(async () => { (n.props["onKeyDown"] as (e: unknown) => void)({ key: k, preventDefault() {}, target: { tagName: "DIV" } }); }); };

test("a click on an event opens it in the pane: when, how it repeats, calendar, organiser, Join, Going?, attendees with their answers, the description's links", async () => {
  const { opened, tree } = world();
  const root = await mount(createRoot, tree());
  assert.ok(!find(root, "event-pane"), "nothing open yet");
  await press(find(root, "event-body:e_lease_call"));
  await settle();
  assert.ok(find(root, "event-pane"), "the click opened the event (the rc.16 report: it did nothing)");
  assert.equal(opened[0], "open:e_lease_call", "the shell writes it to the address");
  assert.equal(textOf(find(root, "event-title")), "Lease call with Elena");
  assert.match(textOf(find(root, "event-when")), /^Fri, Oct 24 · 11:00 to 11:45 AM/);
  assert.equal(textOf(find(root, "event-calendar")), "Work Google");
  assert.match(textOf(find(root, "event-organiser")), /Organised by\s+Maya Chen/);
  assert.match(textOf(find(root, "event-guests")), /Elena Rivera.*Not answered/s);
  assert.match(textOf(find(root, "event-guests")), /1 going, 1 not answered/);
  await press(find(root, "event-join"));
  assert.equal(opened.at(-1), "join:https://us02web.zoom.us/j/84512345678?pwd=Q2x");
  assert.ok(find(root, "event-rsvp"), "Going? for a guest who did not organise it");
  assert.equal(find(root, "event-rsvp-accepted")?.props["aria-checked"], true, "your answer is lit");
  const link = (find(root, "event-description")?.children ?? []).find((c) => typeof c === "object" && (c as Node).props["role"] === "link") as Node | undefined;
  assert.ok(link, "the link in the description is a link");
});

test("Going?, Prepare, Ask and Copy Link call what they say; Escape closes", async () => {
  const { s, opened, tree } = world();
  const root = await mount(createRoot, tree());
  await press(find(root, "event-body:e_lease_call"));
  await settle();
  await press(find(root, "event-rsvp-tentative"));
  await settle();
  assert.deepEqual(s.calls.filter((c) => c.cap === "calendar.respond").at(-1)?.input, { eventId: "e_lease_call", response: "tentative" });
  assert.equal(find(root, "event-rsvp-tentative")?.props["aria-checked"], true, "the pane reads the answer back");
  assert.match(textOf(find(root, "cal-undo")), /Maybe/, "a changed answer can be undone");
  await press(find(root, "event-prepare"));
  await settle();
  assert.ok(s.calls.some((c) => c.cap === "meetings.prep.start" && (c.input as { eventId: string }).eventId === "e_lease_call"));
  assert.match(textOf(find(root, "event-prep")), /Your Assistant is preparing/);
  await press(find(root, "event-ask"));
  assert.equal(opened.at(-1), "ask:e_lease_call");
  await key(find(root, "calendar"), "Escape");
  assert.ok(!find(root, "event-pane"), "Escape closes it");
  assert.equal(opened.at(-1), "close");
});

test("prep notes the Assistant wrote show on an event still to come", async () => {
  const { tree } = world();
  const root = await mount(createRoot, tree());
  await press(find(root, "event-body:e_planning"));
  await settle();
  assert.match(textOf(find(root, "event-prep")), /Prep notes.*Maya wants the Q1 numbers.*Decide the budget split today/s);
  assert.ok(!find(root, "event-rsvp"), "your own event, nothing to answer");
});

test("a past meeting shows its close-out with Open close-out, and its recording and transcript; no Join, no Prepare", async () => {
  const { opened, tree } = world({ initial: { day: TODAY - 3 * DAY } });
  const root = await mount(createRoot, tree());
  await press(find(root, "event-body:e_intake"));
  await settle();
  assert.ok(!find(root, "event-join"));
  assert.ok(!find(root, "event-prepare"));
  assert.match(textOf(find(root, "event-closeout")), /1 to approve.*Elena wants the lease reviewed.*Review draft 3 of the lease.*Task created.*Send Elena the fee quote.*Waiting for approval/s);
  await press(find(root, "event-open-closeout"));
  assert.equal(opened.at(-1), "meeting:rec_m_intake");
  await press(find(root, "event-open-recording"));
  assert.equal(opened.at(-1), "file:fil_intake_rec");
  await press(find(root, "event-transcript"));
  await settle();
  assert.match(textOf(find(root, "event-transcript-text")), /Maya: Thanks for booking, Elena\..*Elena: The lease is the urgent part\./s);
});

test("double-click edits in place; Save on a repeating event asks This Event or All Events, and All moves every instance still ahead", async () => {
  const { s, tree } = world();
  const root = await mount(createRoot, tree());
  await press(find(root, "event-body:standup_0"));
  await press(find(root, "event-body:standup_0"));
  await settle();
  assert.ok(find(root, "event-edit"), "a double-click opens it in edit");
  assert.equal(find(root, "event-edit-title")?.props["value"], "Team standup", "the fields start from the event");
  await typeInto(find(root, "event-edit-title"), "Team standup (short)");
  await typeInto(find(root, "event-edit-time"), "09:45");
  await press(find(root, "event-edit-save"));
  await settle();
  assert.ok(find(root, "menu-item-This Event") && find(root, "menu-item-All Events"), "a repeating event asks which");
  await press(find(root, "menu-item-All Events"));
  await settle();
  const sent = s.calls.filter((c) => c.cap === "calendar.update_event").at(-1)?.input as Record<string, unknown>;
  assert.deepEqual([sent["title"], sent["startsAt"], sent["endsAt"], sent["scope"]], ["Team standup (short)", TODAY + 9.75 * HOUR, TODAY + 10.25 * HOUR, "all"]);
  assert.equal(ev(s, "standup_3").title, "Team standup (short)", "the instances ahead follow");
  assert.equal(ev(s, "standup_-1").title, "Team standup", "the ended ones stay");
  assert.match(textOf(find(root, "cal-undo")), /Saved \d+ events/);
  await press(find(root, "cal-undo-btn"));
  await settle();
  assert.equal(ev(s, "standup_0").title, "Team standup", "Undo puts it back");
});

test("a drag moves an event with Undo; one click on an empty slot starts a new event there", async () => {
  const { s, tree } = world();
  const root = await mount(createRoot, tree());
  const g = globalThis as unknown as { addEventListener(t: string, f: (e: unknown) => void): void; __h?: Record<string, (e: unknown) => void> };
  const handlers: Record<string, (e: unknown) => void> = {};
  const add = g.addEventListener;
  g.addEventListener = (t: string, f: (e: unknown) => void) => { handlers[t] = f; };
  try {
    const body = find(root, "event-body:e_planning")!;
    await act(async () => { (body.props["onPointerDown"] as (e: unknown) => void)({ clientX: 100, clientY: 200, button: 0, stopPropagation() {} }); });
    await act(async () => { handlers["pointermove"]?.({ clientX: 100, clientY: 252 }); });
    await act(async () => { handlers["pointerup"]?.({ clientX: 100, clientY: 252 }); });
    await settle();
    assert.equal(ev(s, "e_planning").startsAt, TODAY + 15 * HOUR, "one hour later");
    assert.match(textOf(find(root, "cal-undo")), /Moved “Quarterly planning”/);
    await press(find(root, "cal-undo-btn"));
    await settle();
    assert.equal(ev(s, "e_planning").startsAt, TODAY + 14 * HOUR, "Undo puts it back");

    const col = find(root, `col:${TODAY}`)!;
    await act(async () => { (col.props["onPointerDown"] as (e: unknown) => void)({ clientX: 50, clientY: 8 * 52 + 300, button: 0, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 300, width: 100, height: 1248 }) } }); });
    await act(async () => { handlers["pointerup"]?.({ clientX: 50, clientY: 8 * 52 + 300 }); });
    await settle();
    assert.ok(find(root, "cal-card"), "the new event card");
    assert.match(textOf(find(root, "cal-card-when")), /8:00 to 8:30 AM/);
  } finally { g.addEventListener = add; }
});

test("on a phone the event opens as a sheet", async () => {
  const { tree } = world();
  const rn = await import("react-native");
  const dims = rn.Dimensions as unknown as { get(k: string): { width: number; height: number } };
  const was = dims.get;
  dims.get = () => ({ width: 390, height: 844, scale: 1, fontScale: 1 } as never);
  try {
    const root = await mount(createRoot, tree());
    await press(find(root, "event-body:e_lease_call"));
    await settle();
    assert.ok(!find(root, "calendar-event-col"), "no side column on a phone");
    assert.ok(find(root, "event-pane"), "the pane is in the sheet");
  } finally { dims.get = was; }
});

// ---- how the meeting happens (owner 3 Nov): detection, the pane's Join, Call and Maps, Add a video call, the new event's Video call

import { mapsUrl, providerOf, telUrl, videoDefault, videoOptions, waysOf } from "../calendar/eventpane/join.ts";

test("detection: Meet, Zoom and Teams from the conference or the link; a phone call; a place; several at once, the video call first; none", () => {
  const meet = waysOf({ conference: { provider: "meet", url: "https://meet.google.com/abc-defg-hij", meetingId: "abc-defg-hij", dialIns: [{ number: "+1 415-555-0161", pin: "264326521#" }] } });
  assert.deepEqual(meet, [{ kind: "video", provider: "meet", url: "https://meet.google.com/abc-defg-hij", dialIns: [{ number: "+1 415-555-0161", pin: "264326521#" }], meetingId: "abc-defg-hij" }]);
  assert.deepEqual(waysOf({ joinUrl: "https://us02web.zoom.us/j/845?pwd=x" })[0], { kind: "video", provider: "zoom", url: "https://us02web.zoom.us/j/845?pwd=x", dialIns: [] }, "a bare join link");
  assert.equal((waysOf({ description: "Join: https://teams.microsoft.com/l/meetup-join/19abc and bring the deck https://docs.example/deck" })[0] as { provider?: string }).provider, "teams", "a meeting link in the description, not the document");
  for (const [url, p] of [["https://acme.webex.com/meet/pat", "webex"], ["https://whereby.com/northwind", "whereby"], ["https://around.co/r/x", "around"], ["https://docs.example/x", null]] as const) assert.equal(providerOf(url), p);
  assert.deepEqual(waysOf({ location: "+1 415 555 0132", description: "Dial in and enter PIN 4471 when asked." }), [{ kind: "phone", number: "+1 415 555 0132", pin: "4471" }]);
  assert.deepEqual(waysOf({ description: "Call us at tel:+14155550132" }), [{ kind: "phone", number: "+14155550132" }]);
  assert.deepEqual(waysOf({ location: "Tartine Manufactory, 595 Alabama St, San Francisco" }), [{ kind: "place", address: "Tartine Manufactory, 595 Alabama St, San Francisco" }]);
  const many = waysOf({ joinUrl: "https://meet.google.com/abc", location: "Room 4, 410 Valencia St", description: "Or call tel:+1 415 555 0177, PIN 2210" });
  assert.deepEqual(many.map((w) => w.kind), ["video", "phone", "place"], "the video call leads, then the phone, then the place");
  assert.deepEqual(waysOf({ location: "https://meet.google.com/abc" }).map((w) => w.kind), ["video"], "a link as the location is the call, not a place");
  assert.deepEqual(waysOf({ title: "x" } as never), [], "none");
  assert.equal(mapsUrl("595 Alabama St"), "https://www.google.com/maps/search/?api=1&query=595%20Alabama%20St");
  assert.equal(telUrl("+1 415 555 0132", "4471#"), "tel:+14155550132,,4471#");
  assert.deepEqual([videoOptions("google", true), videoOptions("microsoft", false), videoOptions("local", true), videoOptions("local", false)], [["meet", "zoom"], ["teams"], ["zoom"], []]);
  assert.deepEqual([videoDefault(["meet", "zoom"], null), videoDefault(["meet", "zoom"], "zoom"), videoDefault(["teams"], "zoom"), videoDefault(["meet"], "none"), videoDefault([], null)], ["meet", "zoom", "teams", "none", "none"]);
});

test("the pane: Join Zoom with its dial-in, PIN and passcode to copy; a phone call; a place with Open in Maps; several ways with Other ways to join", async () => {
  const { opened, tree } = world();
  const root = await mount(createRoot, tree());
  await press(find(root, "event-body:e_lease_call"));
  await settle();
  assert.match(textOf(find(root, "event-join")), /Join Zoom/);
  assert.ok(find(root, "event-join")?.children?.some((c) => typeof c === "object"), "with its mark");
  assert.match(textOf(find(root, "event-dial")), /Or dial\s+\+1 669 444 9171\s+and 1 more.*PIN\s+84512345678#.*Passcode\s+551203/s);
  await press(find(root, "event-join"));
  assert.equal(opened.at(-1), "join:https://us02web.zoom.us/j/84512345678?pwd=Q2x");
  assert.ok(!find(root, "event-add-video"), "a meeting with a video call offers no other");

  await press(find(root, "event-body:e_vendor"));
  await settle();
  assert.match(textOf(find(root, "event-call")), /Call \+1 415 555 0132/);
  await press(find(root, "event-call"));
  assert.equal(opened.at(-1), "url:tel:+14155550132,,4471", "no Vyre number here: the phone's own dialer, with the PIN");

  await press(find(root, "event-body:e_planning"));
  await settle();
  assert.match(textOf(find(root, "event-join")), /Join Google Meet/);
  assert.match(textOf(find(root, "event-other-ways")), /Other ways to join.*Room 4, Northwind office/s);

  await press(find(root, "event-body:e_dinner"));
  await settle();
  assert.match(textOf(find(root, "event-way-place")), /Tartine Manufactory, 595 Alabama St/);
  await press(find(root, "event-maps"));
  assert.equal(opened.at(-1), `url:${mapsUrl("Tartine Manufactory, 595 Alabama St, San Francisco")}`);
  assert.ok(find(root, "event-add-video"), "a place, no call: Add a video call (Zoom is connected)");
});

test("Add a video call asks for one of the connected services; the new-event card's Video call starts on the calendar's own and is sent with the event", async () => {
  const { s, tree } = world();
  const root = await mount(createRoot, tree());
  await press(find(root, "event-body:e_dinner"));
  await settle();
  await press(find(root, "event-add-video"));
  await settle();
  assert.ok(find(root, "menu-item-Google Meet") && find(root, "menu-item-Zoom") && !find(root, "menu-item-Teams"), "a Google calendar offers Meet, and Zoom is connected; no Teams");
  await press(find(root, "menu-item-Zoom"));
  await settle();
  assert.deepEqual(s.calls.filter((c) => c.cap === "calendar.update_event").at(-1)?.input, { eventId: "e_dinner", video: "zoom" });

  const g = globalThis as unknown as { addEventListener(t: string, f: (e: unknown) => void): void };
  const handlers: Record<string, (e: unknown) => void> = {};
  const add = g.addEventListener;
  g.addEventListener = (t: string, f: (e: unknown) => void) => { handlers[t] = f; };
  try {
    const col = find(root, `col:${TODAY + DAY}`)!;
    await act(async () => { (col.props["onPointerDown"] as (e: unknown) => void)({ clientX: 50, clientY: 12 * 52 + 300, button: 0, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 300, width: 100, height: 1248 }) } }); });
    await act(async () => { handlers["pointerup"]?.({ clientX: 50, clientY: 12 * 52 + 300 }); });
    await settle();
  } finally { g.addEventListener = add; }
  assert.match(textOf(find(root, "cal-card-video")), /Google Meet/, "a Google calendar starts on Meet");
  await press(find(root, "cal-card-video"));
  assert.ok(find(root, "menu-item-Zoom") && find(root, "menu-item-None"));
  await press(find(root, "menu-item-Zoom"));
  await press(find(root, "cal-card-add"));
  await settle();
  assert.equal((s.calls.filter((c) => c.cap === "calendar.create_event").at(-1)?.input as { video?: string }).video, "zoom");
});
