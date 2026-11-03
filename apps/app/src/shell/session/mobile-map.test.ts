import test from "node:test";
import assert from "node:assert/strict";
import { chatAboutOf, desktopLine, desktopOnly, entryFor, headerBack, isAskEntry, phoneStart, placeOf, subjectEntry, tabOf } from "./mobile-map.ts";
import { formatHash, parseHash } from "../hash/hash.ts";
import { openAsk } from "../providers/ask.ts";

test("phone: a tab's place is its first screen, an opened item is <type>:<id> under that tab", () => {
  assert.deepEqual(entryFor("chats", ""), { tab: "chats", screen: "chats" });
  assert.deepEqual(entryFor("chats", "subject=thread%3Athr_1"), { tab: "chats", screen: "thread:thr_1" });
  assert.deepEqual(entryFor("records", "subject=record%3Arec_1"), { tab: "records", screen: "record:rec_1" });
  assert.equal(entryFor("settings", "")?.tab, "you");
});

test("phone: Automations and the Console are not places on the phone; a deep link to either is the Chat-about-it screen (owner ruling, 3 Nov)", () => {
  for (const [place, hash] of [["automations", ""], ["automations", "subject=automation%3Aaut_1"], ["automations", "screen=automations.journeys"], ["console", ""], ["console", "members"]] as const) {
    const e = entryFor(place, hash);
    assert.equal(placeOf(e), null, `${place}#${hash} draws no place`);
    assert.deepEqual(desktopOnly(e), { place, hash }, `${place}#${hash} keeps what it named`);
    assert.equal(e.tab, "chats");
  }
  // an automation, a run or a Journey opened from another place is the same screen
  assert.deepEqual(desktopOnly(subjectEntry("records", { type: "automation", id: "aut_1" })), { place: "automations", hash: "subject=automation%3Aaut_1" });
  assert.deepEqual(desktopOnly(entryFor("home", "subject=run%3Arun_1")), { place: "automations", hash: "subject=run%3Arun_1" });
  assert.deepEqual(subjectEntry("records", { type: "record", id: "rec_1" }), { tab: "records", screen: "record:rec_1" });
  // the item goes with the chat: the subject when the link named one, else the place and its screen
  assert.deepEqual(chatAboutOf("automations", "subject=automation%3Aaut_1"), { kind: "automation", id: "aut_1" });
  assert.deepEqual(chatAboutOf("automations", ""), { kind: "automations", id: "automations" });
  assert.deepEqual(chatAboutOf("console", "screen=console.members"), { kind: "console", id: "console.members" });
  assert.match(desktopLine("console"), /^The Console opens on a computer\./);
  assert.match(desktopLine("automations"), /^Automations open on a computer\./);
  assert.deepEqual(phoneStart("console", ""), { initialTab: "chats", initialEntry: entryFor("console", "") });
});

test("phone: an Ask link keeps its whole route, and its thread takes its place", () => {
  const hash = formatHash({ screen: "chats.conversation", args: { with: "agt_assistant", about: "automation:aut_1" } });
  const e = entryFor("chats", hash);
  assert.equal(isAskEntry(e), true);
  assert.deepEqual(placeOf(e), { place: "chats", hash });
  assert.equal(headerBack(e), true, "the conversation draws its own Back");
  assert.deepEqual(entryFor("chats", ""), { tab: "chats", screen: "chats" }, "the Chats tab itself is unchanged");
});

test("phone: a screen maps back to the place and hash that draw it", () => {
  assert.deepEqual(placeOf({ tab: "chats", screen: "chats" }), { place: "chats", hash: "" });
  assert.deepEqual(placeOf({ tab: "chats", screen: "thread:thr_1" }), { place: "chats", hash: "subject=thread%3Athr_1" });
  assert.deepEqual(placeOf({ tab: "files", screen: "file:fil_1" }), { place: "files", hash: "subject=file%3Afil_1" });
  assert.deepEqual(placeOf({ tab: "you", screen: "you:settings" }), { place: "settings", hash: "" });
  assert.equal(placeOf({ tab: "you", screen: "you" }), null);
  assert.equal(placeOf({ tab: "chats", screen: "spaceship:1" }), null);
  assert.equal(tabOf("vault"), "you");
});

test("phone Apps preserve detail/create hashes and return to the same editor", () => {
  const hash = "screen=apps.form-settings&selected=frm_fixture";
  const entry = entryFor("apps", hash);
  assert.deepEqual(placeOf(entry), { place: "apps", hash });
  assert.deepEqual(placeOf(entryFor("apps", "screen=apps.forms&create=true")), { place: "apps", hash: "screen=apps.forms&create=true" });
  assert.equal(placeOf({ tab: "you", screen: "apps:%ZZ" }), null);
  assert.deepEqual(placeOf(entryFor("vault", "")), { place: "vault", hash: "" }, "the Vault hangs off You on a phone");
  assert.equal(entryFor("vault", "").tab, "you");
});

test("phone task links preserve the canonical task when opened from an old Home URL", () => { const entry=entryFor("home", "screen=tasks.page&taskId=tsk_fixture"); assert.deepEqual(entry,{tab:"chats",screen:"task:tsk_fixture"}); assert.deepEqual(placeOf(entry),{place:"chats",hash:"subject=task%3Atsk_fixture"}); });

test("Tasks lives on the Chats tab: its list has a screen, and that screen draws the Tasks page in Chats", () => {
  const list = entryFor("chats", "screen=tasks.my-work");
  assert.deepEqual(list, { tab: "chats", screen: "tasks:list", title: "Tasks" });
  assert.deepEqual(placeOf(list), { place: "chats", hash: "screen=tasks.my-work" });
  const task = entryFor("chats", "subject=task:tsk_1");
  assert.equal(task.tab, "chats");
  assert.deepEqual(placeOf(task), { place: "chats", hash: "subject=task%3Atsk_1" });
});

test("the phone starts where a link points: a place on its own tab, an item on top of Chats, Chats when there is nowhere else", () => {
  assert.deepEqual(phoneStart("records", ""), { initialTab: "records" });
  assert.deepEqual(phoneStart("chats", ""), { initialTab: "chats" });
  assert.deepEqual(phoneStart("chats", "subject=task:tsk_1"), { initialTab: "chats", initialEntry: { tab: "chats", screen: "task:tsk_1" } });
  assert.deepEqual(phoneStart("records", "subject=record:rec_1"), { initialTab: "chats", initialEntry: { tab: "records", screen: "record:rec_1" } });
});

test("Chat about it opens an Ask with the assistant carrying the item, and the phone shows that Ask", () => {
  const opened: Array<{ screen?: string; args?: Record<string, unknown> }> = [];
  const rt = { assistant: { id: "agt_assistant" }, open: (t: { screen?: string; args?: Record<string, unknown> }) => { opened.push(t); } } as unknown as Parameters<typeof openAsk>[0];
  const away = desktopOnly(entryFor("automations", "subject=automation%3Aaut_1"))!;
  openAsk(rt, "assistant", chatAboutOf(away.place, away.hash));
  assert.deepEqual(opened, [{ screen: "chats.conversation", args: { with: "agt_assistant", about: "automation:aut_1" } }]);
  const shown = entryFor("chats", formatHash(opened[0]!));
  assert.equal(isAskEntry(shown), true);
  assert.equal(parseHash(placeOf(shown)!.hash).args["about"], "automation:aut_1");
});
