import test from "node:test";
import assert from "node:assert/strict";
import { entryFor, phoneStart, placeOf, tabOf } from "./mobile-map.ts";

test("phone: a tab's place is its first screen, an opened item is <type>:<id> under that tab", () => {
  assert.deepEqual(entryFor("chats", ""), { tab: "chats", screen: "chats" });
  assert.deepEqual(entryFor("chats", "subject=thread%3Athr_1"), { tab: "chats", screen: "thread:thr_1" });
  assert.deepEqual(entryFor("records", "subject=record%3Arec_1"), { tab: "records", screen: "record:rec_1" });
  assert.equal(entryFor("settings", "")?.tab, "you");
  assert.deepEqual(placeOf(entryFor("automations", "")!), { place: "automations", hash: "" }, "Automations hangs off You on a phone");
  assert.equal(entryFor("console", ""), null);
  assert.equal(entryFor("console", ""), null);
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
  const entry = entryFor("apps", hash)!;
  assert.deepEqual(placeOf(entry), { place: "apps", hash });
  assert.deepEqual(placeOf(entryFor("apps", "screen=apps.campaigns&create=true")!), { place: "apps", hash: "screen=apps.campaigns&create=true" });
  assert.equal(placeOf({ tab: "you", screen: "apps:%ZZ" }), null);
  assert.deepEqual(placeOf(entryFor("vault", "")!), { place: "vault", hash: "" }, "the Vault hangs off You on a phone");
  assert.equal(entryFor("vault", "")!.tab, "you");
});

test("phone task links preserve the canonical task when opened from a copied Home URL", () => { const entry=entryFor("home", "screen=tasks.page&taskId=tsk_fixture")!; assert.deepEqual(entry,{tab:"chats",screen:"task:tsk_fixture"}); assert.deepEqual(placeOf(entry),{place:"chats",hash:"subject=task%3Atsk_fixture"}); });

test("Tasks lives on the Chats tab: its list has a screen, and that screen draws the Tasks page in Chats", () => {
  const list = entryFor("chats", "screen=tasks.my-work")!;
  assert.deepEqual(list, { tab: "chats", screen: "tasks:list", title: "Tasks" });
  assert.deepEqual(placeOf(list), { place: "chats", hash: "screen=tasks.my-work" });
  const task = entryFor("chats", "subject=task:tsk_1")!;
  assert.equal(task.tab, "chats");
  assert.deepEqual(placeOf(task), { place: "chats", hash: "subject=task%3Atsk_1" });
});

test("the phone starts where a link points: a place on its own tab, an item on top of Chats, Chats when there is nowhere else", () => {
  assert.deepEqual(phoneStart("records", ""), { initialTab: "records" });
  assert.deepEqual(phoneStart("chats", ""), { initialTab: "chats" });
  assert.deepEqual(phoneStart("chats", "subject=task:tsk_1"), { initialTab: "chats", initialEntry: { tab: "chats", screen: "task:tsk_1" } });
  assert.deepEqual(phoneStart("records", "subject=record:rec_1"), { initialTab: "chats", initialEntry: { tab: "records", screen: "record:rec_1" } });
  assert.deepEqual(phoneStart("console", ""), { initialTab: "chats" });
});
