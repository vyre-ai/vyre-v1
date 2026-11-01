// The builder's plain-language pieces: the schedule picker (what it stores, what it says, the next runs), the one-line summary of each trigger and step, and the names on the step panel's tabs.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { TriggerForm } from "./TriggerForm.tsx";
import { controlsFor, controlValue, missingFor, triggerMissing, triggerSummary, writeControl, writeTriggerField, fieldsOfTrigger } from "./form-model.ts";
import { addTrigger, check, describeTrigger, layout, subtitleOf } from "./model.ts";
import type { DefTrigger, Definition } from "./model.ts";
import { DEFAULT_DRAFT, configFromDraft, cronFromDraft, cronSummary, draftFromCron, draftProblem, nextRuns, runWords, scheduleOf, scheduleWords } from "./schedule.ts";
import type { ScheduleDraft } from "./schedule.ts";
import { MAX_TABS, dropTrigger, openTab, paneTabs, tabTitle } from "./tabs.ts";

const draft = (p: Partial<ScheduleDraft>): ScheduleDraft => ({ ...DEFAULT_DRAFT, ...p });
// 31 October 2026, 00:00 UTC. A Saturday.
const NOW = Date.UTC(2026, 9, 31, 0, 0);

test("the schedule picker builds the cron for every, minutes, hours, day, weekday, week, month and a custom line", () => {
  assert.equal(cronFromDraft(draft({ every: "minutes", n: 15 })), "*/15 * * * *");
  assert.equal(cronFromDraft(draft({ every: "minutes", n: 1 })), "* * * * *");
  assert.equal(cronFromDraft(draft({ every: "hours", n: 1, time: "00:30" })), "30 * * * *");
  assert.equal(cronFromDraft(draft({ every: "hours", n: 4, time: "00:00" })), "0 */4 * * *");
  assert.equal(cronFromDraft(draft({ every: "day", time: "09:00" })), "0 9 * * *");
  assert.equal(cronFromDraft(draft({ every: "weekdays", time: "08:15" })), "15 8 * * 1-5");
  assert.equal(cronFromDraft(draft({ every: "week", time: "09:00", days: [1] })), "0 9 * * 1");
  assert.equal(cronFromDraft(draft({ every: "week", time: "17:30", days: [5, 1, 3] })), "30 17 * * 1,3,5");
  assert.equal(cronFromDraft(draft({ every: "month", time: "07:05", day: 15 })), "5 7 15 * *");
  assert.equal(cronFromDraft(draft({ every: "cron", cron: "  0 9  * * 1 " })), "0 9 * * 1");
});

test("a choice that is not complete stores nothing and says why", () => {
  for (const [d, why] of [
    [draft({ every: "minutes", n: 0 }), /Minutes/],
    [draft({ every: "minutes", n: 60 }), /Minutes/],
    [draft({ every: "hours", n: 24 }), /Hours/],
    [draft({ every: "day", time: "25:00" }), /hours and minutes/],
    [draft({ every: "day", time: "9" }), /hours and minutes/],
    [draft({ every: "week", days: [] }), /at least one day/],
    [draft({ every: "month", day: 32 }), /day of the month/],
    [draft({ every: "cron", cron: "not cron" }), /not a cron line/],
    [draft({ every: "cron", cron: "" }), /Write a cron line/],
  ] as const) {
    assert.equal(cronFromDraft(d), null);
    assert.match(draftProblem(d) ?? "", why);
    assert.equal(configFromDraft({}, d, "UTC"), null, "nothing half-made is saved");
  }
});

test("the stored config keeps the cron, the zone and the missed rule, and whatever else the trigger held", () => {
  const made = configFromDraft({ label: "Monday digest", missed: "run_once" }, draft({ every: "week", days: [1], time: "09:00" }), "Asia/Karachi");
  assert.deepEqual(made, { label: "Monday digest", missed: "run_once", cron: "0 9 * * 1", timezone: "Asia/Karachi" });
  assert.deepEqual(configFromDraft(undefined, draft({ every: "day", time: "09:00" }), "UTC"), { cron: "0 9 * * *", timezone: "UTC", missed: "skip" });
});

test("a stored cron reads back as the choice that made it; one the picker cannot express is kept as a custom line", () => {
  for (const d of [
    draft({ every: "minutes", n: 10 }), draft({ every: "hours", n: 3, time: "00:15" }), draft({ every: "day", time: "06:45" }), draft({ every: "weekdays", time: "09:00" }),
    draft({ every: "week", days: [0, 6], time: "10:00" }), draft({ every: "month", day: 28, time: "23:59" }),
  ]) {
    const cron = cronFromDraft(d)!;
    const back = draftFromCron(cron);
    assert.equal(back.every, d.every, cron);
    assert.equal(cronFromDraft(back), cron, `${cron} survives the round trip`);
  }
  const custom = draftFromCron("5 4 * 2 *");
  assert.equal(custom.every, "cron");
  assert.equal(custom.cron, "5 4 * 2 *");
  assert.equal(draftFromCron("0 9 1,15 * *").every, "cron", "two days of the month have no friendly form");
});

test("a schedule with no cron is read as the default choice, not as set", () => {
  const s = scheduleOf({}, "Asia/Karachi");
  assert.equal(s.set, false);
  assert.equal(s.timezone, "Asia/Karachi", "the person's zone fills in");
  assert.equal(s.draft.every, "day");
  assert.equal(scheduleOf({ cron: "0 9 * * 1", timezone: "Europe/London" }, "Asia/Karachi").timezone, "Europe/London", "the stored zone wins");
  assert.equal(scheduleOf({ cron: "0 9 * * 1", timezone: "Not/AZone" }, "Asia/Karachi").timezone, "Asia/Karachi", "a zone that does not exist is replaced");
});

test("the schedule in words, with the zone", () => {
  assert.equal(scheduleWords("0 9 * * 1", "Asia/Karachi"), "Every Monday at 09:00, Asia/Karachi");
  assert.equal(scheduleWords("0 9 * * *", "UTC"), "Every day at 09:00, UTC");
  assert.equal(scheduleWords("30 8 * * 1-5", "UTC"), "Every weekday at 08:30, UTC");
  assert.equal(scheduleWords("0 9 * * 1,3,5", "UTC"), "Monday, Wednesday, and Friday at 09:00, UTC");
  assert.equal(scheduleWords("0 9 15 * *", "UTC"), "Every month on day 15 at 09:00, UTC");
  assert.equal(scheduleWords("*/15 * * * *", "UTC"), "Every 15 minutes, UTC");
  assert.equal(scheduleWords("0 */2 * * *", "UTC"), "Every 2 hours, UTC");
  assert.equal(scheduleWords("5 4 * 2 *", "UTC"), "Cron 5 4 * 2 *, UTC");
  assert.equal(scheduleWords("nonsense", "UTC"), undefined);
  assert.equal(cronSummary("@daily"), "Every day at 00:00");
});

test("the next runs are in the zone of the schedule, and a time a clock change skips is skipped", () => {
  const karachi = nextRuns("0 9 * * 1", "Asia/Karachi", NOW, 3);
  assert.deepEqual(karachi.map((t) => new Date(t).toISOString()), ["2026-11-02T04:00:00.000Z", "2026-11-09T04:00:00.000Z", "2026-11-16T04:00:00.000Z"]);
  assert.deepEqual(karachi.map((t) => runWords(t, "Asia/Karachi")), ["Mon 2 Nov, 09:00", "Mon 9 Nov, 09:00", "Mon 16 Nov, 09:00"]);
  assert.deepEqual(nextRuns("0 9 * * 1", "UTC", NOW, 1).map((t) => runWords(t, "UTC")), ["Mon 2 Nov, 09:00"], "the same moment reads differently in another zone");
  // New York springs forward on 8 March 2026: 02:30 does not exist that day
  const spring = nextRuns("30 2 * * *", "America/New_York", Date.UTC(2026, 2, 7, 12, 0), 2);
  assert.deepEqual(spring.map((t) => new Date(t).toISOString()), ["2026-03-09T06:30:00.000Z", "2026-03-10T06:30:00.000Z"]);
  assert.deepEqual(nextRuns("*/20 * * * *", "UTC", NOW, 3).map((t) => new Date(t).toISOString()), ["2026-10-31T00:20:00.000Z", "2026-10-31T00:40:00.000Z", "2026-10-31T01:00:00.000Z"]);
  assert.deepEqual(nextRuns("0 9 * * *", "Not/AZone", NOW), []);
  assert.deepEqual(nextRuns("0 0 31 2 *", "UTC", NOW), [], "30 February never comes");
});

const html = (trigger: DefTrigger, zone = "Asia/Karachi"): string =>
  renderToStaticMarkup(<TriggerForm trigger={trigger} onChange={() => undefined} openMenu={() => undefined} zone={zone} now={NOW} />).replaceAll("<!-- -->", "");
const idsIn = (out: string): Set<string> => new Set([...out.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]!));
const text = (out: string, id: string): string => (out.match(new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`)) ?? [])[1] ?? "";

test("the picker shows the schedule in words, the next 3 runs and the zone with a way to change it", () => {
  const out = html({ key: "schedule", config: { cron: "0 9 * * 1", timezone: "Asia/Karachi", missed: "skip" } });
  assert.equal(text(out, "schedule-preview"), "Every Monday at 09:00, Asia/Karachi");
  assert.ok(out.includes("Next 3 runs"));
  assert.deepEqual([0, 1, 2].map((n) => text(out, `schedule-next-${n}`)), ["Mon 2 Nov, 09:00", "Mon 9 Nov, 09:00", "Mon 16 Nov, 09:00"]);
  assert.equal(text(out, "schedule-zone"), "Asia/Karachi");
  assert.match(out, /aria-label="Change the time zone, now Asia\/Karachi"/);
  const ids = idsIn(out);
  for (const id of ["schedule-every", "schedule-time", "schedule-day-1", "schedule-day-0", "schedule-advanced", "trigger-label"]) assert.ok(ids.has(id), id);
  assert.equal(ids.has("schedule-cron"), false, "the cron line is under Advanced");
  assert.match(out, /aria-label="Mon"[^>]*aria-checked="true"|aria-checked="true"[^>]*aria-label="Mon"/, "Monday is on");
  assert.match(out, /aria-label="Tue"[^>]*aria-checked="false"|aria-checked="false"[^>]*aria-label="Tue"/, "Tuesday is not");
});

test("each choice shows the fields it needs and no others", () => {
  const at = (cron: string): Set<string> => idsIn(html({ key: "schedule", config: { cron, timezone: "UTC", missed: "skip" } }));
  const minutes = at("*/10 * * * *");
  assert.ok(minutes.has("schedule-n") && !minutes.has("schedule-time") && !minutes.has("schedule-day-1"));
  const hours = at("15 */2 * * *");
  assert.ok(hours.has("schedule-n") && hours.has("schedule-minute") && !hours.has("schedule-time"));
  const day = at("0 9 * * *");
  assert.ok(day.has("schedule-time") && !day.has("schedule-day-1") && !day.has("schedule-day-of-month"));
  const week = at("0 9 * * 1,3");
  assert.ok(week.has("schedule-time") && week.has("schedule-day-1") && week.has("schedule-day-6") && !week.has("schedule-day-of-month"));
  const month = at("0 9 15 * *");
  assert.ok(month.has("schedule-time") && month.has("schedule-day-of-month") && !month.has("schedule-day-1"));
  const custom = html({ key: "schedule", config: { cron: "5 4 * 2 *", timezone: "UTC", missed: "skip" } });
  assert.ok(idsIn(custom).has("schedule-cron") && idsIn(custom).has("schedule-missed"), "a line the picker cannot express opens Advanced");
  assert.equal(text(custom, "schedule-preview"), "Cron 5 4 * 2 *, UTC");
});

test("a new schedule starts as every day at 09:00 in the person's zone; a schedule with no time is an error on the card", () => {
  const def = addTrigger({ triggers: [], nodes: [] }, "schedule", "Asia/Karachi");
  assert.deepEqual(def.triggers[0], { key: "schedule", config: { cron: "0 9 * * *", timezone: "Asia/Karachi", missed: "skip" } });
  assert.deepEqual(addTrigger({ triggers: [], nodes: [] }, "manual").triggers[0], { key: "manual" });
  const bare: Definition = { triggers: [{ key: "schedule" }], nodes: [] };
  assert.ok(check(bare, "space").some((i) => i.nodeId === "trigger" && i.severity === "error" && /needs when it runs/.test(i.message)));
  assert.equal(check(def, "space").some((i) => i.nodeId === "trigger"), false);
});

// ---------------------------------------------------------------- summaries

test("a trigger's second line is what it really does, and Not set up when it cannot work", () => {
  const sub = (t: DefTrigger): string => describeTrigger(t, { type: (k) => k[0]!.toUpperCase() + k.slice(1), form: (id) => (id === "frm_1" ? "Client intake" : id) }, "Asia/Karachi");
  assert.equal(sub({ key: "schedule", config: { cron: "0 9 * * 1", timezone: "Asia/Karachi", missed: "skip" } }), "Every Monday at 09:00, Asia/Karachi");
  assert.equal(sub({ key: "schedule", config: { cron: "0 9 * * *" } }), "Every day at 09:00, Asia/Karachi", "no stored zone reads in the person's");
  assert.equal(sub({ key: "schedule" }), "Not set up");
  assert.equal(sub({ key: "schedule", config: { cron: "nope" } }), "Not set up");
  assert.equal(sub({ key: "record_change", filter: { type: "lead", op: "created" } }), "A Lead is created");
  assert.equal(sub({ key: "record_change", filter: { type: "lead", op: "updated", fields: ["status"] } }), "A Lead is updated, when status changes");
  assert.equal(sub({ key: "record_change", filter: { type: "lead" } }), "A Lead changes");
  assert.equal(sub({ key: "record_change" }), "Not set up");
  assert.equal(sub({ key: "form_submit", filter: { formId: "frm_1" } }), "Form: Client intake");
  assert.equal(sub({ key: "form_submit" }), "Any form is submitted");
  assert.equal(sub({ key: "manual" }), "Starts when you press Run now");
  assert.equal(sub({ key: "spreadsheet_row", filter: { fileId: "fil_1", op: "added" } }), "A row is added");
  assert.equal(sub({ key: "spreadsheet_row" }), "Not set up");
  assert.equal(sub({ key: "ci_check", filter: { repo: "acme/web", conclusion: "failure" } }), "A check fails for acme/web");
  assert.equal(sub({ key: "journey_stage_entered", filter: { stage: "Signed" } }), "A record enters Signed");
  for (const t of [{ key: "schedule" }, { key: "manual" }, { key: "record_change" }]) assert.notEqual(sub(t), "Every time", "the old line is gone");
});

test("a step's second line names its recipient, the first words of its prompt, or says Not set up", () => {
  assert.equal(subtitleOf({ id: "m", key: "send_email", input: { to: ["ada@example.com"], subject: "Weekly digest" } }), "Email ada@example.com: Weekly digest");
  assert.equal(subtitleOf({ id: "t", key: "send_sms", input: { to: "+15550100", body: "Hi" } }), "Text +15550100, 1 segment");
  const long = "Summarise the open matters for the week in three short bullet points and flag anything overdue for the partner to read first";
  const ai = subtitleOf({ id: "a", key: "ai", input: { prompt: long } });
  assert.ok(ai.startsWith("Summarise the open matters for the week"), ai);
  assert.ok(ai.includes("..."), "long prompts are cut");
  const def: Definition = {
    triggers: [{ key: "manual" }], start: ["a"],
    nodes: [
      { id: "a", key: "ai", input: {}, next: ["b"] },
      { id: "b", key: "records.update", input: { type: "lead" }, next: ["c"] },
      { id: "c", key: "post_message", input: { text: "Hello" }, next: ["d"] },
      { id: "d", key: "send_email", input: { to: ["a@b.co"], subject: "Hi", mailboxId: "mbx_1" } },
    ],
  };
  const required = { ai: ["prompt"], "records.update": ["type", "recordId", "patch"], post_message: ["text"], send_email: ["to", "subject", "body"] };
  const subs = Object.fromEntries(layout(def, { required }).cards.filter((c) => c.type === "step").map((c) => [c.id, c.sub]));
  assert.equal(subs["a"], "Not set up", "an AI step with no prompt");
  assert.equal(subs["b"], "Not set up", "an update with no record or fields");
  assert.equal(subs["c"], "text Hello", "a step with all it needs reads as its fields");
  assert.equal(subs["d"], "Not set up", "an email with no body");
  const without = Object.fromEntries(layout(def).cards.filter((c) => c.type === "step").map((c) => [c.id, c.sub]));
  assert.equal(without["a"], "Write what the AI should do", "with no catalog the old lines stand");
});

test("what a step lacks: its required fields, the extra ones the server asks for, and lanes that live on the step", () => {
  assert.deepEqual(missingFor("records.update", { type: "lead" }, ["type", "recordId", "patch"], 0), ["recordId", "patch"]);
  assert.deepEqual(missingFor("send_email", { to: ["a@b.co"], subject: "x", body: "y" }, ["to", "subject", "body"], 0), ["mailboxId"]);
  assert.deepEqual(missingFor("paths", {}, ["paths"], 0), ["paths"]);
  assert.deepEqual(missingFor("paths", {}, ["paths"], 2), []);
  assert.deepEqual(missingFor("stop", {}, [], 0), []);
  assert.deepEqual(missingFor("loop", { items: "{{ trigger.rows }}" }, ["items"], 0), [], "a template counts as filled in");
  assert.deepEqual(missingFor("loop", { items: "  " }, ["items"], 0), ["items"]);
});

// ---------------------------------------------------------------- controls

test("each kind of field writes the right value: text, number, yes or no, a list, JSON, a choice", () => {
  const schema = {
    type: "object", required: ["title"],
    properties: {
      title: { type: "string" }, count: { type: "integer" }, all: { type: "boolean" }, tags: { type: "array", items: { type: "string" } }, ids: { type: "array", items: { type: "integer" } },
      mode: { type: "string", enum: ["a", "b"] }, extra: { type: "object" }, anything: { description: "Any JSON value" }, body: { type: "string" },
    },
  };
  const by = Object.fromEntries(controlsFor(schema).map((c) => [c.name, c]));
  assert.deepEqual(controlsFor(schema).map((c) => c.name)[0], "title", "required first");
  assert.deepEqual(Object.fromEntries(Object.entries(by).map(([k, c]) => [k, c.kind])), { title: "text", count: "number", all: "toggle", tags: "list", ids: "list", mode: "choice", extra: "json", anything: "json", body: "multiline" });
  assert.deepEqual(controlValue(by["count"]!, "42"), { value: 42 });
  assert.deepEqual(controlValue(by["count"]!, "{{ trigger.n }}"), { value: "{{ trigger.n }}" });
  assert.deepEqual(controlValue(by["count"]!, "many"), { problem: "Count must be a number." });
  assert.deepEqual(controlValue(by["all"]!, "true"), { value: true });
  assert.deepEqual(controlValue(by["all"]!, "false"), { value: false });
  assert.deepEqual(controlValue(by["tags"]!, "a, b\nc"), { value: ["a", "b", "c"] });
  assert.deepEqual(controlValue(by["ids"]!, "1, 2"), { value: [1, 2] });
  assert.deepEqual(controlValue(by["ids"]!, "1, x"), { problem: "Ids must be numbers." });
  assert.deepEqual(controlValue(by["extra"]!, '{"a":1}'), { value: { a: 1 } });
  assert.deepEqual(controlValue(by["extra"]!, "{oops"), { problem: "That is not valid JSON." });
  assert.deepEqual(writeControl({ count: 1, keep: true }, by["count"]!, ""), { input: { keep: true } }, "empty removes the key");
  assert.deepEqual(writeControl({ keep: true }, by["mode"]!, "b"), { input: { keep: true, mode: "b" } });
});

test("a trigger field writes into its filter or config, and an empty filter is removed", () => {
  const type = fieldsOfTrigger("record_change").find((f) => f.name === "type")!;
  const fields = fieldsOfTrigger("record_change").find((f) => f.name === "fields")!;
  const name = fieldsOfTrigger("record_change")[0]!;
  assert.equal(name.name, "label");
  let t: DefTrigger = { key: "record_change" };
  t = writeTriggerField(t, type, "lead") as DefTrigger;
  assert.deepEqual(t, { key: "record_change", filter: { type: "lead" } });
  t = writeTriggerField(t, fields, "status\nowner") as DefTrigger;
  assert.deepEqual(t.filter, { type: "lead", fields: ["status", "owner"] });
  t = writeTriggerField(t, name, "New leads") as DefTrigger;
  assert.deepEqual(t.config, { label: "New leads" });
  assert.deepEqual(triggerMissing(t), []);
  t = writeTriggerField(t, type, "") as DefTrigger;
  assert.deepEqual(triggerMissing(t), ["type"]);
  t = writeTriggerField(t, fields, "") as DefTrigger;
  assert.equal("filter" in t, false, "no filter is left behind");
  const where = fieldsOfTrigger("record_change").find((f) => f.name === "where")!;
  assert.deepEqual(writeTriggerField(t, where, "[1]"), { problem: 'Write it as an object, such as {"status":"new"}.' });
  assert.deepEqual(writeTriggerField(t, where, "{"), { problem: "That is not valid JSON." });
  assert.deepEqual(triggerSummary(writeTriggerField({ key: "record_change", filter: { type: "lead" } }, where, '{"status":"new"}') as DefTrigger).text, "A lead changes, only when status is new");
});

// ---------------------------------------------------------------- tabs

test("each tab is named for its own card and carries its icon; three triggers are three different tabs", () => {
  const def: Definition = {
    triggers: [{ key: "manual" }, { key: "form_submit" }, { key: "schedule", config: { cron: "0 9 * * *", timezone: "UTC", missed: "skip" } }],
    start: ["send"],
    nodes: [{ id: "send", key: "send_email", title: "Send the digest", input: {} }, { id: "plain", key: "records.find", input: {} }],
  };
  const tabs = paneTabs(def, ["trigger:0", "trigger:1", "trigger:2", "send", "plain"]);
  assert.deepEqual(tabs.map((t) => t.title), ["Run by hand", "Form submitted", "On a schedule", "Send the digest", "Find records"]);
  assert.equal(new Set(tabs.map((t) => t.title)).size, tabs.length, "no two tabs read alike");
  for (const t of tabs) assert.ok(t.icon?.startsWith("<svg"), `${t.title} has an icon`);
  assert.notEqual(tabs[0]!.icon, tabs[2]!.icon, "the icon follows the trigger");
  assert.equal(paneTabs(def, ["gone"]).length, 0, "a step that was deleted has no tab");
});

test("triggers of one kind are numbered; a name given to a trigger is its tab", () => {
  const def: Definition = { triggers: [{ key: "schedule", config: { cron: "0 9 * * *" } }, { key: "schedule", config: { cron: "0 17 * * *" } }, { key: "schedule", config: { label: "Month end", cron: "0 9 28 * *" } }], nodes: [] };
  assert.deepEqual([0, 1, 2].map((n) => tabTitle(def, `trigger:${n}`)), ["On a schedule 1", "On a schedule 2", "Month end"]);
  assert.equal(tabTitle(def, "trigger"), "On a schedule 1", "a bare trigger key is the first trigger");
});

test("at most four tabs stay open; the oldest closes first; removing a trigger moves the later tabs up", () => {
  let keys: string[] = [];
  for (const k of ["a", "b", "c", "d", "e"]) keys = openTab(keys, k);
  assert.deepEqual(keys, ["b", "c", "d", "e"]);
  assert.equal(MAX_TABS, 4);
  assert.deepEqual(openTab(keys, "c"), keys, "opening an open tab changes nothing");
  assert.deepEqual(openTab(["trigger:0"], "trigger"), ["trigger:0"]);
  assert.deepEqual(dropTrigger(["trigger:0", "trigger:1", "trigger:2", "send"], 1), ["trigger:0", "trigger:1", "send"]);
  assert.deepEqual(dropTrigger(["trigger:0", "send"], 0), ["send"]);
});

// ---------------------------------------------------------------- the canvas

import { AutomationCanvas } from "./AutomationCanvas.tsx";
import { AutomationsDataProvider } from "./data.tsx";
import { Inspector } from "./Inspector.tsx";
import { createSampleAutomations, northwind } from "../sidebar/sample.ts";

const canvas = (props: Partial<Parameters<typeof AutomationCanvas>[0]> = {}): string =>
  renderToStaticMarkup(<AutomationsDataProvider value={createSampleAutomations(northwind).data}><AutomationCanvas automationId="aut_lead" {...props} /></AutomationsDataProvider>).replaceAll("<!-- -->", "");

test("the trigger rows read as what they do, not as Every time", () => {
  const out = canvas();
  assert.ok(out.includes("A lead is created"), "a record trigger names its type and event");
  assert.ok(out.includes("Any form is submitted"));
  assert.equal(out.includes("Every time"), false);
});

test("the bar under the tabs has something on it: what to do next, Undo and Data; Events is under More", () => {
  const out = canvas();
  assert.ok(out.includes('data-testid="build-hint"'));
  assert.match(out, /data-testid="undo-edit"[^>]*disabled|disabled[^>]*data-testid="undo-edit"|aria-disabled="true"[^>]*data-testid="undo-edit"|data-testid="undo-edit"[^>]*aria-disabled="true"/, "nothing to undo yet");
  assert.ok(out.includes('data-testid="open-data-shelf"'));
  assert.equal(out.includes('data-testid="events"'), false, "the Events button is gone from the header");
});

test("a trigger opened in the panel is a tab with its own name and icon", () => {
  const out = canvas({ initialPanel: true, initialSelected: "trigger" });
  assert.ok(out.includes("A new lead is created settings") || out.includes('data-testid="inspector"'), "the panel is open on the first trigger");
  assert.match(out, /aria-label="A new lead is created" role="tab"/, "the tab carries the trigger's name");
  assert.match(out, /data-testid="tab-trigger:0-selected"[^>]*><div[^>]*><span[^>]*><svg/, "and the trigger's icon");
  assert.equal(/aria-label="Trigger" role="tab"/.test(out), false, "no tab is just called Trigger");
});

const noop = (): void => undefined;
const panelOf = (trigger: DefTrigger, section: "configure" | "data" | "test" = "configure", extra: Partial<Parameters<typeof Inspector>[0]> = {}): string => {
  const def: Definition = { triggers: [trigger], nodes: [] };
  return renderToStaticMarkup(
    <AutomationsDataProvider value={createSampleAutomations(northwind).data}>
      <Inspector def={def} node={null} trigger={trigger} triggerIndex={0} issues={[]} keys={[]} section={section} onChange={noop} onClose={noop} onDelete={noop} {...extra} />
    </AutomationsDataProvider>,
  ).replaceAll("<!-- -->", "");
};

test("the trigger panel can remove its trigger, and its Test and Data tabs say what they are", () => {
  assert.ok(panelOf({ key: "manual" }, "configure", { onRemoveTrigger: noop }).includes('data-testid="remove-trigger"'));
  assert.equal(panelOf({ key: "manual" }).includes('data-testid="remove-trigger"'), false, "no handler, no button");
  const test_ = panelOf({ key: "manual" }, "test");
  assert.ok(test_.includes("Press Test at the top"), "the Test tab of a trigger explains itself");
  assert.ok(panelOf({ key: "manual" }, "data").includes("data-shelf-empty"), "the Data tab says why it is empty");
});

test("Advanced adds the trigger as JSON, so the switch shows something on a trigger too", () => {
  const out = panelOf({ key: "record_change", filter: { type: "lead" } }, "configure", { mode: "advanced", onMode: noop });
  assert.ok(out.includes('data-testid="field-trigger-json"'));
  assert.equal(panelOf({ key: "record_change", filter: { type: "lead" } }, "configure", { mode: "basic", onMode: noop }).includes('data-testid="field-trigger-json"'), false);
});

test("no panel, picker or summary uses an em dash or a section sign", () => {
  const all = [html({ key: "schedule", config: { cron: "0 9 * * 1", timezone: "UTC" } }), html({ key: "record_change" }), canvas(), panelOf({ key: "webhook" })].join("");
  assert.equal(all.includes(String.fromCharCode(0x2014)) || all.includes(String.fromCharCode(0xa7)), false);
});
