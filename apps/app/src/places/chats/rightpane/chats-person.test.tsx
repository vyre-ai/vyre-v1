// A person's profile pane: the words (hours, time, presence line), the header's actions and what each does, the tabs, and that About states only what the person set. Reads run in the live shell; here the pane is
// rendered with no answers yet, which is the state a quiet Space starts in, and every rule is driven through the pure functions.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PERSON_TABS, PersonProfile, personActions } from "./PersonProfile.tsx";
import { cityOf, hoursWords, lastActive, localTime, personLine, presenceWord } from "./person-model.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const has = (s: string, n: string): boolean => s.includes(n);
const props = { id: "usr_sara", name: "Sara Malik", title: "Account lead", call: () => new Promise<unknown>(() => undefined), now: () => Date.UTC(2026, 10, 4, 21, 41), onMessage: () => undefined, onMention: () => undefined };

test("working hours read as a range of days and the person's own clock", () => {
  assert.equal(hoursWords({ days: [1, 2, 3, 4, 5], from: "09:00", to: "17:30" }), "Mon to Fri, 9:00 to 17:30");
  assert.equal(hoursWords({ days: [0, 1, 2, 3, 4, 5, 6], from: "08:00", to: "16:00" }), "Every day, 8:00 to 16:00");
  assert.equal(hoursWords({ days: [1, 3], from: "10:00", to: "14:00" }), "Mon, Wed, 10:00 to 14:00");
  assert.equal(hoursWords({ days: [2], from: "10:00", to: "14:00" }), "Tue, 10:00 to 14:00");
  assert.equal(hoursWords({ days: [], from: "10:00", to: "14:00" }), "");
});

test("the time is the one in their zone, and an unknown zone says nothing", () => {
  assert.equal(localTime(Date.UTC(2026, 10, 4, 21, 41), "Europe/Berlin"), "22:41");
  assert.equal(localTime(Date.UTC(2026, 10, 4, 21, 41), "Asia/Karachi"), "02:41");
  assert.equal(localTime(Date.UTC(2026, 10, 4, 21, 41), "Nowhere/Land"), undefined);
  assert.equal(localTime(Date.UTC(2026, 10, 4, 21, 41), undefined), undefined);
  assert.equal(cityOf("America/New_York"), "New York");
});

test("the role line is the title, how they are and their time, and leaves out what it does not know", () => {
  assert.equal(personLine("Account lead", "away", "22:41", "Sara"), "Account lead · Away, 22:41 for Sara");
  assert.equal(personLine("Account lead", "online", undefined, "Sara"), "Account lead · Online");
  assert.equal(personLine(undefined, undefined, undefined, "Sara"), "Member");
  assert.equal(presenceWord("offline"), "Offline");
  assert.ok(!/\b(he|she|her|his|hers)\b/i.test(personLine("Lead", "online", "10:00", "Sara")), "never a guessed pronoun");
});

test("last active reads in minutes, hours or days", () => {
  const now = 10_000_000;
  assert.equal(lastActive(now, now - 30_000), "Last active a moment ago");
  assert.equal(lastActive(now, now - 5 * 60_000), "Last active 5 min ago");
  assert.equal(lastActive(now, now - 3 * 3_600_000), "Last active 3 hours ago");
  assert.equal(lastActive(now, now - 50 * 3_600_000), "Last active 2 days ago");
  assert.equal(lastActive(now, undefined), undefined);
});

test("the header's actions: Message and Mention each do their one thing, and Call is drawn only when the shell can place it", () => {
  const log: string[] = [];
  const base = { onMessage: () => log.push("message"), onMention: () => log.push("mention") };
  const without = personActions(base, "Sara");
  assert.deepEqual(without.map((a) => a.key), ["message", "mention"], "no Call without a number and a phone");
  without[0]!.onPress(); without[1]!.onPress();
  const withCall = personActions({ ...base, onCall: () => log.push("call") }, "Sara");
  assert.deepEqual(withCall.map((a) => a.key), ["message", "call", "mention"]);
  withCall[1]!.onPress();
  assert.deepEqual(log, ["message", "mention", "call"]);
});

test("the pane draws the header, four tabs with About open, and what the role line says; no menu where nothing can be done", () => {
  assert.deepEqual(PERSON_TABS.map((t) => t.title), ["About", "Chats", "Files", "Tasks"]);
  const out = clean(renderToStaticMarkup(<PersonProfile {...props} />));
  assert.ok(has(out, 'data-testid="person-header"') && has(out, "Sara Malik") && has(out, "Account lead"));
  for (const t of ["about", "chats", "files", "tasks"]) assert.ok(has(out, `data-testid="person-tab-${t}"`), t);
  assert.ok(has(out, 'data-testid="person-about"') && has(out, "Responsible for"));
  assert.ok(!has(out, 'data-testid="profile-call"'), "no Call without a phone");
  assert.ok(!has(out, 'data-testid="pane-more"'), "no \"...\" where nothing is behind it");
  const rich = clean(renderToStaticMarkup(<PersonProfile {...props} onCall={() => undefined} copy={() => undefined} roles={[{ project: "Client portal launch", role: "Lead" }]} />));
  assert.ok(has(rich, 'data-testid="profile-call"') && has(rich, 'data-testid="pane-more"'));
  assert.ok(has(rich, "Lead on Client portal launch"), "responsible for is the title plus the roles they hold");
});

test("each other tab shows its own list heading", () => {
  for (const [tab, heading] of [["chats", "Chats with Sara"], ["files", "Shared with you"], ["tasks", "Waiting on Sara"]] as const) {
    const out = clean(renderToStaticMarkup(<PersonProfile {...props} initialTab={tab} />));
    assert.ok(has(out, `data-testid="person-${tab}"`) && has(out, heading), tab);
  }
});
