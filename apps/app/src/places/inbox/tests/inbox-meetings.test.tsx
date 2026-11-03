// Inbox > Meetings (lane l-meetings): the sidebar's Meetings row carries how many meetings are ready to close; the tab lists each meeting as a ui/Row with its time, who was there and its
// state (Ready to close, Closed, Nothing to do); opening one shows the package with Approve all and, on each item, Approve, Edit and Skip; editing happens in place; a handled item links to
// what it made. Pressing things calls the close-out capabilities with exactly what the person chose.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import type { ReactElement } from "react";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { SAMPLE_NOW, createSampleInbox } from "../contactlist/sample.ts";
import { InboxDataProvider, InboxSidebar, InboxStateProvider, INITIAL_STATE, reduce } from "../sidebar/index.ts";
import type { InboxData } from "../sidebar/index.ts";
import { MeetingsTab } from "../meetings/index.ts";
import type { MeetingsNav } from "../meetings/index.ts";
import { handledLine, meetingTime, readyMeta, rowNote } from "../meetings/model.ts";
import type { ListOut, Package } from "../meetings/model.ts";

const HOUR = 3_600_000;
const MAYA = "usr_maya";
const SAM = "usr_sam";
const M1 = "rec_m1";

const LIST: ListOut = {
  ready: 1,
  meetings: [
    { meetingId: M1, title: "Lee Holdings renewal", startsAt: SAMPLE_NOW - 2 * HOUR, endsAt: SAMPLE_NOW - HOUR, attendees: ["Maya", "Sam", "Pat Lee"], state: "ready", proposed: 6, done: 0 },
    { meetingId: "rec_m2", title: "Weekly sync", startsAt: SAMPLE_NOW - 26 * HOUR, attendees: ["Maya", "Sam"], state: "nothing", proposed: 0, done: 0 },
    { meetingId: "rec_m3", title: "Harbor kickoff", startsAt: SAMPLE_NOW - 50 * HOUR, attendees: ["Ana Ruiz"], state: "closed", proposed: 0, done: 5 },
  ],
};

const PKG: Package = {
  meetingId: M1, title: "Lee Holdings renewal", startsAt: SAMPLE_NOW - 2 * HOUR, endsAt: SAMPLE_NOW - HOUR, state: "ready",
  attendees: [{ name: "Maya", email: "maya@firm.example" }, { name: "Sam", email: "sam@firm.example" }, { name: "Pat Lee", email: "pat@client.example", recordId: "rec_pat" }],
  summary: "Pat confirmed the move to the annual plan from January.", decisions: ["Move to the annual plan in January."], questions: ["Does their legal team review the terms?"],
  items: [
    { itemId: "mci_t1", kind: "task", status: "proposed", title: "Send Pat the revised quote", assignee: SAM, ownerName: "Sam", due: SAMPLE_NOW + 72 * HOUR },
    { itemId: "mci_t2", kind: "task", status: "approved", title: "Set up the onboarding call", assignee: MAYA, made: [{ type: "task", id: "tsk_onb", title: "Set up the onboarding call" }] },
    { itemId: "mci_r1", kind: "record", status: "proposed", title: "Pat Lee", recordId: "rec_pat", recordType: "contact", changes: [{ field: "title", title: "Job title", from: "Operations lead", to: "Head of Operations" }], note: "Renewal call: annual plan from January." },
    { itemId: "mci_e1", kind: "email", status: "proposed", title: "Next steps on your renewal", subject: "Next steps on your renewal", text: "Hi Pat,\n\nThanks for today.\n\nMaya", to: [{ address: "pat@client.example", name: "Pat Lee" }], send: "send" },
    { itemId: "mci_h1", kind: "hold", status: "skipped", title: "Renewal: legal review", startsAt: SAMPLE_NOW + 7 * 24 * HOUR, endsAt: SAMPLE_NOW + 7 * 24 * HOUR + 30 * 60_000 },
  ],
  taskId: "tsk_prep", shared: [],
};

function sample(list: ListOut = LIST, pkg: Package = PKG): { data: InboxData; calls: Array<{ cap: string; input: unknown }> } {
  const s = createSampleInbox();
  s.replica.resolve("meetings.closeout.list", () => list);
  s.replica.resolve("meetings.closeout.get", () => pkg);
  const calls: Array<{ cap: string; input: unknown }> = [];
  const data: InboxData = { ...s.data, me: MAYA, async call(cap, input) { calls.push({ cap, input }); return {}; } };
  return { data, calls };
}

const NAMES: Record<string, string> = { [MAYA]: "Maya Ortiz", [SAM]: "Sam Reyes" };
const nav = (opened: string[]): MeetingsNav => ({
  openSubject: (s) => void opened.push(`${s.type}:${s.id}`), openContact: (id) => void opened.push(`contact:${id}`), openCalendar: () => void opened.push("calendar"),
});
const tab = (data: InboxData, openId: string | null, opened: string[] = [], moved: string[] = []): ReactElement => (
  <InboxDataProvider value={data}>
    <MeetingsTab openId={openId} onOpen={(id) => void moved.push(`open:${id}`)} onBack={() => void moved.push("back")} nav={nav(opened)} nameOf={(id) => NAMES[id] ?? "Someone"} team={[{ id: MAYA, name: "Maya Ortiz" }, { id: SAM, name: "Sam Reyes" }]} />
  </InboxDataProvider>
);
const html = (el: ReactElement): string => renderToStaticMarkup(el).replaceAll("<!-- -->", "");

// ---- the pure part

test("model: a row says when and who; the header counts what is ready; a handled item says what it made", () => {
  assert.equal(meetingTime(SAMPLE_NOW - 2 * HOUR, SAMPLE_NOW, 0).startsWith("Today") || meetingTime(SAMPLE_NOW - 2 * HOUR, SAMPLE_NOW, 0).startsWith("Yesterday"), true);
  assert.match(rowNote(LIST.meetings[0]!, SAMPLE_NOW, 0), / · Maya, Sam, Pat Lee$/);
  assert.equal(readyMeta(0), "");
  assert.equal(readyMeta(2), "2 ready to close");
  assert.equal(handledLine(PKG.items[1]!), "Task created");
  assert.equal(handledLine(PKG.items[4]!), "Skipped");
  assert.equal(handledLine({ ...PKG.items[3]!, status: "approved", made: [{ type: "approval", id: "tsk_h" }] }), "Waiting for approval before it sends");
  assert.equal(handledLine({ ...PKG.items[3]!, status: "approved", send: "draft", made: [{ type: "draft", id: "eml_d" }] }), "Saved as a draft");
  assert.equal(reduce(INITIAL_STATE, { type: "meetings" }).main, "meetings");
});

// ---- the screen

test("screen: the sidebar has a Meetings row under Calendar with how many are ready to close", () => {
  const { data } = sample();
  const out = html(<InboxDataProvider value={data}><InboxStateProvider><InboxSidebar /></InboxStateProvider></InboxDataProvider>);
  assert.ok(out.includes('data-testid="row-nav:meetings"'), "Meetings is a ui/Row of the sidebar");
  assert.ok(out.indexOf('data-testid="row-nav:calendar"') < out.indexOf('data-testid="row-nav:meetings"'), "right under Calendar");
  const row = out.slice(out.indexOf('data-testid="row-nav:meetings"'), out.indexOf('data-testid="row-nav:meetings"') + 3000);
  assert.ok(row.includes(">Meetings<") && row.includes(">1<"), "with its count");
});

test("screen: the tab lists each meeting as a row with its time, who was there and its state, never chips", () => {
  const { data } = sample();
  const out = html(tab(data, null));
  assert.ok(out.includes('data-testid="meetings-list"'));
  assert.ok(out.includes(">Meetings<") && out.includes(">1 ready to close<"));
  for (const m of LIST.meetings) assert.ok(out.includes(`data-testid="row-meeting:${m.meetingId}"`), `${m.title} is a ui/Row`);
  assert.ok(out.includes(">Ready to close<") && out.includes(">Nothing to do<") && out.includes(">Closed<"));
  assert.ok(out.includes("Maya, Sam, Pat Lee"));
  assert.ok(!out.includes(String.fromCharCode(0x2014)) && !out.includes(String.fromCharCode(0xa7)), "no em dash, no section sign");
});

test("screen: no meetings yet says so", () => {
  const { data } = sample({ ready: 0, meetings: [] });
  assert.ok(html(tab(data, null)).includes("No meetings to close yet."));
});

test("screen: an open meeting shows the summary, decisions, open questions and each section, with Approve all and Approve, Edit and Skip on each waiting item", () => {
  const { data } = sample();
  const out = html(tab(data, M1));
  assert.ok(out.includes('data-testid="meeting-package"'));
  for (const s of ["Summary", "Decisions", "Open questions", "Tasks", "Record updates", "Follow-up email", "Next meeting"]) assert.ok(out.includes(`>${s}<`), `the ${s} section`);
  assert.ok(out.includes(">Approve all 3<"), "three items wait");
  for (const id of ["mci_t1", "mci_r1", "mci_e1"]) for (const a of ["approve", "edit", "skip"]) assert.ok(out.includes(`data-testid="${a}-${id}"`), `${a} on ${id}`);
  assert.ok(out.includes(">Sam Reyes · Due "), "the task says who and when");
  assert.ok(out.includes(">Operations lead<") && out.includes(">Head of Operations<"), "the field change, from and to");
  assert.ok(out.includes(">To Pat Lee<") && out.includes(">Send it<"));
  assert.ok(out.includes('data-testid="done-mci_t2"') && out.includes(">Task created<") && out.includes(">Open task<"), "a handled item links to what it made");
  assert.ok(out.includes(">Skipped<") && out.includes('data-testid="unskip-mci_h1"'));
});

// ---- pressing things

installDom();

test("a row opens its meeting; Back returns to the list", async () => {
  const { data } = sample();
  const moved: string[] = [];
  const root = await mount(createRoot, tab(data, null, [], moved));
  await press(find(root, `row-meeting:${M1}`));
  assert.deepEqual(moved, [`open:${M1}`]);
  const pkg = await mount(createRoot, tab(data, M1, [], moved));
  await press(find(pkg, "meetings-back"));
  assert.deepEqual(moved.at(-1), "back");
});

test("opening the tab starts any close-out that waited (one sync call)", async () => {
  const { data, calls } = sample();
  await mount(createRoot, tab(data, null));
  assert.deepEqual(calls.filter((c) => c.cap === "meetings.closeout.sync"), [{ cap: "meetings.closeout.sync", input: {} }]);
});

test("Approve all approves every waiting item in one call; Approve and Skip act on one", async () => {
  const { data, calls } = sample();
  const root = await mount(createRoot, tab(data, M1));
  await press(find(root, "approve-all"));
  await flush();
  assert.deepEqual(calls.at(-1), { cap: "meetings.closeout.approve", input: { meetingId: M1 } });
  await press(find(root, "approve-mci_t1"));
  await flush();
  assert.deepEqual(calls.at(-1), { cap: "meetings.closeout.approve", input: { meetingId: M1, itemIds: ["mci_t1"] } });
  await press(find(root, "skip-mci_r1"));
  await flush();
  assert.deepEqual(calls.at(-1), { cap: "meetings.closeout.skip", input: { meetingId: M1, itemId: "mci_r1" } });
  await press(find(root, "unskip-mci_h1"));
  await flush();
  assert.deepEqual(calls.at(-1), { cap: "meetings.closeout.skip", input: { meetingId: M1, itemId: "mci_h1", undo: true } });
});

test("Edit opens the item's fields in place; Save sends only what changed", async () => {
  const { data, calls } = sample();
  const root = await mount(createRoot, tab(data, M1));
  await press(find(root, "edit-mci_e1"));
  assert.ok(find(root, "edit-subject-mci_e1") && find(root, "edit-text-mci_e1"), "the subject and the words are fields now");
  await typeInto(find(root, "edit-text-mci_e1"), "Hi Pat,\n\nShorter.\n\nMaya");
  await press(find(root, "save-mci_e1"));
  await flush();
  assert.deepEqual(calls.at(-1), { cap: "meetings.closeout.edit", input: { meetingId: M1, itemId: "mci_e1", text: "Hi Pat,\n\nShorter.\n\nMaya" } });
  assert.equal(find(root, "edit-text-mci_e1"), null, "back to reading once saved");

  await press(find(root, "edit-mci_t1"));
  await typeInto(find(root, "edit-due-mci_t1"), "next week");
  await press(find(root, "save-mci_t1"));
  await flush();
  assert.ok(textOf(root).includes("Write the date as 2026-11-07."), "a date it cannot read is said, not sent");
  assert.notEqual((calls.at(-1)?.input as { itemId?: string }).itemId, "mci_t1");
});

test("a handled item's link opens what it made", async () => {
  const { data } = sample();
  const opened: string[] = [];
  const root = await mount(createRoot, tab(data, M1, opened));
  await press(find(root, "made-mci_t2-task"));
  assert.deepEqual(opened, ["task:tsk_onb"]);
});
