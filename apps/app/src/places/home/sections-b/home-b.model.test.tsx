// Home sections B: the rules. Today's day window and marks, Starred's terminal lines, the Personal Space split, the checklist rows and progress, the Ask text.
import test from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_NOW } from "../sections-a/sample.ts";
import {
  ASK_LOCKED, STARRED_LIMIT, askText, checklistProgress, checklistRows, dayWindow, needsTeamSpace, splitForSpace, starRows, teamOnlyWhat, terminalLine, terminalIds, todayCount, todayRows,
} from "./model.ts";
import type { CalEvent, Star, TerminalRow } from "./model.ts";
import { northwindEvents, northwindStars, northwindTerminals } from "./sample.ts";

const clock = { now: SAMPLE_NOW, offsetMin: 0 };
const ev = (id: string, startH: number, mins: number, o: Partial<CalEvent> = {}): CalEvent => ({
  id, calendarId: "c", title: id, startsAt: Date.UTC(2025, 9, 24, startH, 0), endsAt: Date.UTC(2025, 9, 24, startH, mins), allDay: false, joinProvider: "none", attendees: [], recordIds: [], status: "confirmed", ...o,
});

test("the day window is the person's day, not UTC's", () => {
  const utc = dayWindow(clock);
  assert.equal(utc.from, Date.UTC(2025, 9, 24, 0, 0));
  assert.equal(utc.to - utc.from, 86_400_000);
  // 10:00 UTC in Karachi (+5h) is 15:00 on the 24th: the day starts at 19:00 UTC on the 23rd
  const pk = dayWindow({ now: SAMPLE_NOW, offsetMin: 300 });
  assert.equal(pk.from, Date.UTC(2025, 9, 23, 19, 0));
  // 22:00 UTC is already the 25th in Karachi
  const late = dayWindow({ now: Date.UTC(2025, 9, 24, 22, 0), offsetMin: 300 });
  assert.equal(late.from, Date.UTC(2025, 9, 24, 19, 0));
});

test("Today lists the day in order and marks the running event Now and the first still to come Next", () => {
  const rows = todayRows(northwindEvents, clock);
  assert.deepEqual(rows.map((r) => r.id), ["evt_stand", "evt_pruitt", "evt_rivera", "evt_bill", "evt_plan"]);
  assert.deepEqual(rows.map((r) => r.state), ["past", "now", "next", "later", "later"]);
  assert.equal(rows[1]?.note, "9:45 am to 10:30 am · Room 2");
  assert.equal(rows[2]?.note, "11:30 am to 12:00 pm · Zoom");
  assert.equal(rows[2]?.when, "11:30 am");
  assert.equal(todayCount(rows), "4 left");
});

test("Today drops events outside the day, puts all-day events first and handles an empty day", () => {
  const tomorrow = ev("tomorrow", 9, 30, { startsAt: Date.UTC(2025, 9, 25, 9, 0), endsAt: Date.UTC(2025, 9, 25, 9, 30) });
  const allDay = ev("holiday", 0, 0, { allDay: true, startsAt: Date.UTC(2025, 9, 24, 0, 0), endsAt: Date.UTC(2025, 9, 25, 0, 0) });
  const rows = todayRows([tomorrow, ev("late", 15, 30), allDay, ev("early", 8, 30)], clock);
  assert.deepEqual(rows.map((r) => r.id), ["holiday", "early", "late"]);
  assert.equal(rows[0]?.when, "All day");
  assert.equal(rows[0]?.note, "All day");
  assert.equal(todayRows([], clock).length, 0);
  assert.equal(todayCount([]), "");
  assert.equal(todayCount(todayRows([ev("over", 8, 30)], clock)), "Done for the day");
});

test("a terminal's line says running or exited, the exit code and the last line", () => {
  assert.deepEqual(terminalLine({ terminalId: "t", state: "running", lastLine: "ready", exitCode: null }), { text: "Running · ready", tone: "live" });
  assert.deepEqual(terminalLine({ terminalId: "t", state: "exited", lastLine: "boom", exitCode: 1 }), { text: "Exited 1 · boom", tone: "warn" });
  assert.deepEqual(terminalLine({ terminalId: "t", state: "exited", exitCode: 0 }), { text: "Exited 0", tone: "plain" });
  assert.deepEqual(terminalLine({ terminalId: "t", state: "idle", exitCode: null }), { text: "Idle", tone: "plain" });
  assert.deepEqual(terminalLine(undefined), { text: "Terminal", tone: "plain" });
});

test("Starred keeps the capability's order, shows a terminal's live status and the kind for everything else", () => {
  const rows = starRows(northwindStars, northwindTerminals);
  assert.equal(rows.length, 8);
  assert.equal(rows[0]?.title, "Dev server");
  assert.equal(rows[0]?.note, "Running · ready on http://localhost:3000");
  assert.equal(rows[0]?.tone, "live");
  assert.equal(rows[1]?.note, "Chat");
  assert.equal(rows[2]?.tone, "warn");
  assert.equal(rows[3]?.note, "Project");
  assert.deepEqual(terminalIds(northwindStars), ["trm_dev", "trm_migrate", "trm_backup"]);
  assert.ok(rows.length > STARRED_LIMIT, "the sample is long enough to need Show all");
});

test("a terminal whose status has not arrived yet still shows as a terminal", () => {
  const stars: Star[] = [{ resource: { type: "terminal", id: "t9" }, title: "Build", at: 1 }];
  assert.equal(starRows(stars, [])[0]?.note, "Terminal");
  const status: TerminalRow[] = [{ terminalId: "t9", state: "running", exitCode: null }];
  assert.equal(starRows(stars, status)[0]?.note, "Running");
});

test("a Personal Space turns the team-only stars into one Needs a Team Space line", () => {
  const stars: Star[] = [
    { resource: { type: "computer", id: "c1" }, title: "Intake computer", at: 4 }, { resource: { type: "thread", id: "t1" }, title: "Assistant", at: 3 },
    { resource: { type: "site", id: "s1" }, title: "Firm site", at: 2 }, { resource: { type: "campaign", id: "p1" }, title: "Spring", at: 1 },
  ];
  const rows = starRows(stars, []);
  const team = splitForSpace(rows, false);
  assert.equal(team.rows.length, 4);
  assert.deepEqual(team.blocked, []);
  const personal = splitForSpace(rows, true);
  assert.deepEqual(personal.rows.map((r) => r.id), ["t1"]);
  assert.deepEqual(personal.blocked, ["computer", "site", "campaign"]);
  assert.equal(teamOnlyWhat(personal.blocked), "Agent computers, sites and campaigns");
  assert.equal(teamOnlyWhat(["computer"]), "Agent computers");
  assert.equal(teamOnlyWhat(["form", "site"]), "Sites and forms");
  assert.ok(needsTeamSpace("form") && !needsTeamSpace("terminal") && !needsTeamSpace("thread"));
});

const list = (done: string[]) => ({
  visible: true,
  items: (["photo_and_title", "connect_mailbox_and_calendar", "meet_assistant", "open_first_project", "import"] as const).map((key) => ({ key, title: key, done: done.includes(key) })),
});

test("the checklist adds the AI account row first and locks Meet your assistant until one is connected", () => {
  const rows = checklistRows(list([]), { spaceName: "Northwind", personal: false, aiConnected: false });
  assert.deepEqual(rows.map((r) => r.key), ["ai", "photo_and_title", "connect_mailbox_and_calendar", "meet_assistant", "open_first_project", "import"]);
  assert.equal(rows[1]?.note, "Next to your name in Northwind");
  const meet = rows.find((r) => r.key === "meet_assistant");
  assert.equal(meet?.locked, true);
  assert.equal(meet?.note, "Connect an AI account first");
  assert.deepEqual(checklistProgress(rows), { done: 0, total: 6 });
});

test("with an AI account the assistant row opens and the AI row is done", () => {
  const rows = checklistRows(list(["photo_and_title"]), { spaceName: "Northwind", personal: false, aiConnected: true });
  assert.equal(rows.find((r) => r.key === "meet_assistant")?.locked, false);
  assert.equal(rows[0]?.done, true);
  assert.equal(rows.find((r) => r.key === "photo_and_title")?.note, "Done");
  assert.deepEqual(checklistProgress(rows), { done: 2, total: 6 });
});

test("a Personal Space has four rows: no project row and no import row", () => {
  const rows = checklistRows(list([]), { spaceName: "Personal", personal: true, aiConnected: false });
  assert.ok(!rows.some((r) => r.key === "open_first_project" || r.key === "import"));
  assert.deepEqual(rows.map((r) => r.key), ["ai", "photo_and_title", "connect_mailbox_and_calendar", "meet_assistant"]);
});

test("the Ask box sends trimmed text and nothing for an empty box", () => {
  assert.equal(askText("  what is waiting on me?  "), "what is waiting on me?");
  assert.equal(askText("   \n "), null);
  assert.equal(ASK_LOCKED, "Connect an AI account to ask your assistant");
});

test("no copy in the model uses an em dash", () => {
  const dash = String.fromCharCode(0x2014);
  const rows = checklistRows(list([]), { spaceName: "Northwind", personal: false, aiConnected: false });
  const text = [...rows.map((r) => `${r.title} ${r.note} ${r.action}`), ...todayRows(northwindEvents, clock).map((r) => r.note), ...starRows(northwindStars, northwindTerminals).map((r) => r.note)].join(" ");
  assert.ok(!text.includes(dash));
});
