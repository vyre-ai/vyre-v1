// The routine panel (owner report, rc.16): who set it through the shared credit resolver, the schedule in plain words in the viewer's time zone (the raw cron only in Details), ids in its
// instructions as names, and one Next line under the title.
import test from "node:test";
import assert from "node:assert/strict";
import { CUSTOM_SCHEDULE, cronWords, idName, idParts, nextLine, shortSchedule } from "./model.ts";
import type { Routine } from "./model.ts";
import { creditLine } from "../../../shell/session/private-agents.ts";

const PKT = { offsetMin: 300 };

test("a cron in plain words, in the viewer's time zone", () => {
  assert.equal(cronWords("* * * * *"), "Every minute");
  assert.equal(cronWords("*/1 * * * *"), "Every minute");
  assert.equal(cronWords("*/15 * * * *"), "Every 15 minutes");
  assert.equal(cronWords("30 * * * *"), "Every hour at :30");
  assert.equal(cronWords("0 * * * *", { offsetMin: 330 }), "Every hour at :30", "a half-hour zone moves the minute");
  assert.equal(cronWords("0 4 * * 1-5", PKT), "Weekdays at 09:00", "04:00 UTC is 09:00 in Karachi");
  assert.equal(cronWords("0 22 * * 5", PKT), "Every Saturday at 03:00", "past midnight the day moves too");
  assert.equal(cronWords("0 21 * * 0-4", PKT), "Weekdays at 02:00", "Sunday to Thursday evening in UTC is the working week in Karachi");
  assert.equal(cronWords("0 8 * * 1,3,5"), "Mon, Wed and Fri at 08:00");
  assert.equal(cronWords("0 8 * * 0,6"), "Weekends at 08:00");
  assert.equal(cronWords("0 8 * * 7"), "Every Sunday at 08:00", "7 is Sunday too");
  assert.equal(cronWords("0 3 15 * *", PKT), "On day 15 of each month at 08:00");
  for (const odd of ["0 8 * 1 *", "0 22 15 * *", "5-10 8 * * *", "nonsense"]) assert.equal(cronWords(odd, PKT), CUSTOM_SCHEDULE, `${odd}: never the raw cron`);
  assert.equal(shortSchedule("0 4 * * 1-5", PKT), "weekdays 9:00");
  assert.equal(shortSchedule("* * * * *"), "every minute");
});

test("one Next line under the title: today and tomorrow in lower case, paused and watchers say so", () => {
  const now = Date.UTC(2026, 10, 3, 4, 0);
  const c = { now, offsetMin: 300 };
  const r = (o: Partial<Routine>): Routine => ({ routineId: "rtn_1", agentId: "agt_1", title: "Hi", cron: "* * * * *", prompt: "Post Hi.", enabled: true, ownerId: "usr_me", ...o });
  assert.equal(nextLine(r({ nextRunAt: Date.UTC(2026, 10, 3, 4, 12) }), c), "Next: today 09:12");
  assert.equal(nextLine(r({ nextRunAt: Date.UTC(2026, 10, 4, 3, 0) }), c), "Next: tomorrow 08:00");
  assert.equal(nextLine(r({ enabled: false }), c), "Paused. Turn it on to schedule the next run.");
  assert.equal(nextLine(r({ kind: "watch", cron: undefined }), c), "Runs on every new message in the channel");
  assert.equal(nextLine(r({}), c), "No run is scheduled");
});

test("who set a routine: the one credit resolver for every set by, created by and made by line", () => {
  const names: Record<string, string> = { usr_irfad: "Irfad Imtiaz", usr_maya: "Maya Chen", agt_asst: "Assistant", agt_intake: "Intake" };
  const nameOf = (id: string): string => names[id] ?? "Someone";
  const ownerOf = (id: string): string | undefined => (id === "agt_asst" ? "usr_irfad" : undefined);
  const asst = { kind: "agent", id: "agt_asst" };
  assert.equal(creditLine(asst, { me: "usr_irfad", nameOf, ownerOf, for: "usr_irfad" }), "You, through Assistant", "to its owner");
  assert.equal(creditLine(asst, { me: "usr_maya", nameOf, ownerOf, for: "usr_irfad" }), "Irfad Imtiaz (Agent)", "to anyone else");
  assert.equal(creditLine(asst, { me: "usr_maya", nameOf, ownerOf }), "Irfad Imtiaz (Agent)", "the agent's person from the directory when the line does not say");
  assert.equal(creditLine({ kind: "person", id: "usr_irfad" }, { me: "usr_irfad", nameOf }), "You");
  assert.equal(creditLine({ kind: "person", id: "usr_irfad" }, { me: "usr_maya", nameOf }), "Irfad Imtiaz");
  assert.equal(creditLine({ kind: "agent", id: "agt_intake" }, { me: "usr_maya", nameOf, ownerOf }), "Intake", "a shared agent goes by its name");
});

test("ids in a routine's instructions are names that link", () => {
  const parts = idParts("Post Hi in thr_01a19f69187a46d0 and #intake chn_abc123def every morning");
  assert.deepEqual(parts.map((p) => ("id" in p ? `[${p.kind}:${p.id}]` : p.text)), ["Post Hi in ", "[thread:thr_01a19f69187a46d0]", " and #intake ", "[channel:chn_abc123def]", " every morning"]);
  assert.equal(idName({ id: "thr_01a19f69187a46d0", kind: "thread" }, "thr_01a19f69187a46d0", null), "this chat");
  assert.equal(idName({ id: "thr_x00000", kind: "thread" }, "thr_here", { kind: "chat", title: "Rivera intake" }), "Rivera intake");
  assert.equal(idName({ id: "thr_x00000", kind: "thread" }, "thr_here", { kind: "channel", title: "intake" }), "#intake");
  assert.equal(idName({ id: "chn_abc123def", kind: "channel" }, "thr_here", { name: "intake" }), "#intake");
  assert.equal(idName({ id: "thr_gone00", kind: "thread" }, "thr_here", null), "a chat", "never the id");
});
