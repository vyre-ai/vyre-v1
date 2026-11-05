// The chat cards made from the extension's events: a held send becomes a held card with the page's own fields, a picture becomes the "Using your Chrome" step, and an event with no chat makes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { blockOf } from "../chrome-cards.ts";

const THUMB = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

test("a held event makes a held card keyed by the held id, with To, From, Subject and Message, and a stranger's id makes none", () => {
  const b = blockOf({ event: "held", agent: "agt_scout", name: "Scout", id: "hld_a1b2", kind: "send", summary: "send: Send on mail.test", thread: "thr_1", card: { to: "dana@client.test", from: "me@firm.test", subject: "Deed", message: "Hi", site: "mail.test", password: "hunter2" } });
  assert.deepEqual(b, { type: "chrome_held", v: 1, thread: "thr_1", key: "hld_a1b2", data: { heldId: "hld_a1b2", agent: "Scout", site: "mail.test", kind: "send", summary: "send: Send on mail.test", card: { to: "dana@client.test", from: "me@firm.test", subject: "Deed", message: "Hi" }, state: "waiting" } });
  assert.ok(!JSON.stringify(b).includes("hunter2"), "only the four named fields are carried");
  assert.equal(blockOf({ event: "held", agent: "a", id: "../x", thread: "t" }), null);
});

test("a handle the agent used is carried by name only, and anything that is not a handle makes nothing", () => {
  assert.deepEqual(blockOf({ event: "saw", agent: "agt_scout", name: "Scout", handle: "#Acme_Portal.password", thread: "t" })!.data["saw"], ["#Acme_Portal.password"]);
  assert.equal(blockOf({ event: "saw", agent: "agt_scout", handle: "hunter2", thread: "t" }), null);
});

test("pictures and the end of a drive make one step card per agent, and no chat makes nothing", () => {
  const f = blockOf({ event: "frame", agent: "agt_scout", name: "Scout", site: "app.gohighlevel.com", thumb: THUMB, thread: "thr_1" });
  assert.deepEqual(f, { type: "chrome_step", v: 1, thread: "thr_1", key: "step:agt_scout", data: { agent: "Scout", site: "app.gohighlevel.com", thumb: THUMB, state: "using" } });
  assert.equal(blockOf({ event: "frame", agent: "agt_scout", name: "Scout", site: "x.test", thumb: "https://t.test/p.png", thread: "t" })!.data["thumb"], null, "only the extension's own picture");
  assert.equal(blockOf({ event: "driving", on: false, agent: "agt_scout", name: "Scout", why: "stopped by the person", thread: "t", site: "x.test" })!.data["state"], "stopped");
  assert.equal(blockOf({ event: "driving", on: false, agent: "agt_scout", name: "Scout", why: "idle", thread: "t" })!.data["state"], "done");
  assert.equal(blockOf({ event: "driving", on: true, agent: "agt_scout", thread: "t" }), null);
  assert.equal(blockOf({ event: "paused", agent: "agt_scout", name: "Scout", thread: "t" })!.data["state"], "paused");
  assert.equal(blockOf({ event: "frame", agent: "agt_scout", site: "x.test", thumb: THUMB }), null, "no chat to put it in");
  assert.equal(blockOf({ event: "acted", agent: "a", thread: "t" }), null);
});
