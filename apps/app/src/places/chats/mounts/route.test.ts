// The links that open Chats: a link with `with` and `about` is an Ask about an object, `with` alone is a chat with that agent, and a thread id is that thread.
import test from "node:test";
import assert from "node:assert/strict";
import { askAbout, fromHash } from "./route.ts";

test("with and about make an Ask about the object, and bring names the chat whose summary comes along", () => {
  const s = fromHash("#screen=chats.conversation&with=agt_billing&about=record%3Arec_a1&bring=thr_old");
  assert.deepEqual(s.route, { view: "ask", agentId: "agt_billing", scopeType: "record", scopeId: "rec_a1", bringFrom: "thr_old" });
  assert.deepEqual(fromHash("#screen=chats.ask&with=assistant&about=automation%3Aaut_1").route, { view: "ask", agentId: "assistant", scopeType: "automation", scopeId: "aut_1", bringFrom: null });
});

test("with alone is a chat with that agent, a thread id wins, and neither is the start", () => {
  assert.deepEqual(fromHash("#screen=chats.conversation&with=assistant").route, { view: "ask", agentId: "assistant", scopeType: "", scopeId: "", bringFrom: null });
  assert.deepEqual(fromHash("#screen=chats.conversation&threadId=thr_1&with=agt_x&about=record%3Arec_1").route, { view: "chat", threadId: "thr_1" });
  assert.deepEqual(fromHash("#screen=chats.conversation").route, { view: "chat", threadId: null });
});

test("an object is type:id, and anything else is not an object", () => {
  assert.deepEqual(askAbout("file:fil_a1"), { type: "file", id: "fil_a1" });
  assert.equal(askAbout("fil_a1"), null);
  assert.equal(askAbout("Bad Type:x"), null);
});
