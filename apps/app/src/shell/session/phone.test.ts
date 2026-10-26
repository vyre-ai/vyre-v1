import test from "node:test";
import assert from "node:assert/strict";
import { entryFor, placeOf, tabOf } from "./phone.ts";

test("phone: a tab's place is its first screen, an opened item is <type>:<id> under that tab", () => {
  assert.deepEqual(entryFor("chats", ""), { tab: "chats", screen: "chats" });
  assert.deepEqual(entryFor("chats", "subject=thread%3Athr_1"), { tab: "chats", screen: "thread:thr_1" });
  assert.deepEqual(entryFor("records", "subject=record%3Arec_1"), { tab: "records", screen: "record:rec_1" });
  assert.equal(entryFor("settings", "")?.tab, "you");
  assert.equal(entryFor("automations", ""), null);
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
