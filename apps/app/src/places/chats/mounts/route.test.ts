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

import { workOf } from "./route.ts";

test("a chat tied to a record or a project is a workspace; a DM, a channel and an Ask pane are not", () => {
  assert.deepEqual(workOf({ kind: "chat", recordId: "rec_1" }), { type: "record", id: "rec_1" });
  assert.deepEqual(workOf({ kind: "chat", recordId: "prj_1" }), { type: "project", id: "prj_1" });
  assert.deepEqual(workOf({ kind: "thread", scopeType: "project", scopeId: "prj_2" }), { type: "project", id: "prj_2" });
  assert.deepEqual(workOf({ kind: "chat", scopeType: "record", scopeId: "rec_3" }), { type: "record", id: "rec_3" });
  assert.equal(workOf({ kind: "chat" }), null);
  assert.equal(workOf({ kind: "channel", recordId: "rec_1" }), null);
  assert.equal(workOf({ kind: "ask", scopeType: "record", scopeId: "rec_1" }), null);
});

test("an Ask link can carry the words the composer starts with", () => {
  assert.deepEqual(fromHash("#screen=chats.conversation&with=assistant&about=compose%3Aemail&draft=Draft%20an%20email%20to%20").route, { view: "ask", agentId: "assistant", scopeType: "compose", scopeId: "email", bringFrom: null, draft: "Draft an email to " });
});

test("first is the opening message of a session on the object, and it rides along on the Ask", () => {
  const s = fromHash("#screen=chats.conversation&with=assistant&about=vault_item%3Avit_1&first=Add%20Acme%20to%20Automations");
  assert.deepEqual(s.route, { view: "ask", agentId: "assistant", scopeType: "vault_item", scopeId: "vit_1", bringFrom: null, first: "Add Acme to Automations" });
});

test("first with an agent and no object opens a chat that starts with that message", () => {
  assert.deepEqual(fromHash("#screen=chats.conversation&with=assistant&first=Build%20a%20connector").route, { view: "ask", agentId: "assistant", scopeType: "", scopeId: "", bringFrom: null, first: "Build a connector" });
});

test("Open Terminal from the Space menu or Search opens the terminal list", () => {
  assert.equal(fromHash("screen=chats.terminal-list&at=1").layer?.kind, "terminals");
});
