// The "+" tab that starts a chat becomes the chat (hub.fill): one tab, named at once, and a read that has not caught up with the new chat never calls it "New chat" or marks it blank.
import test from "node:test";
import assert from "node:assert/strict";
import { createShellHub } from "./hub.ts";
import { SEED_DEFS } from "./model.ts";

const hubOf = () => createShellHub({ spaces: SEED_DEFS, openId: SEED_DEFS[0]!.spaceId, personId: "irfad", deviceId: "web", storage: { getItem: () => null, setItem: () => undefined }, skeletonMs: 0 });
const tabs = (hub: ReturnType<typeof hubOf>) => hub.session().tabs.state();

test("fill: the new tab becomes the chat in place, selected, named, the page shows the chat; no second tab", () => {
  const hub = hubOf();
  hub.newTab();
  const before = tabs(hub).tabs.length;
  hub.fill("chats", "subject=thread:t1", "Heyy");
  const s = tabs(hub);
  assert.equal(s.tabs.length, before, "no tab was added");
  const sel = s.tabs.find((t) => t.key === s.active)!;
  assert.equal(sel.title, "Heyy");
  assert.equal(sel.hash, "subject=thread:t1");
  assert.ok(!s.tabs.some((t) => t.isNew === true));
  assert.deepEqual([hub.state().place, hub.state().hash], ["chats", "subject=thread:t1"]);
});

test("a read that says the chat is blank, a moment after the tab was named for it, does not rename it New chat or mark it blank; a later one does", () => {
  const hub = hubOf();
  hub.newTab();
  hub.fill("chats", "subject=thread:t1", "Heyy");
  const key = tabs(hub).active;
  hub.retitle(key, "New chat", true);
  let sel = tabs(hub).tabs.find((t) => t.key === key)!;
  assert.equal(sel.title, "Heyy", "the name he was given stands");
  assert.notEqual(sel.empty, true);
  hub.retitle(key, "Rivera renewal", false);
  assert.equal(tabs(hub).tabs.find((t) => t.key === key)!.title, "Rivera renewal", "a real name always lands");
  const other = hubOf();
  other.go("chats", "subject=thread:t2");
  other.retitle(tabs(other).active, "New chat", true);
  sel = tabs(other).tabs.find((t) => t.key === tabs(other).active)!;
  assert.equal(sel.title, "New chat", "a tab that was not just filled behaves as before");
});
