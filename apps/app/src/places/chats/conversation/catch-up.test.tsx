import test from "node:test";
import assert from "node:assert/strict";
import { catchUpLine } from "./catch-up.tsx";

const name = (id: string): string => ({ usr_maya: "Maya Chen", usr_noah: "Noah Reed" })[id] ?? id;
const base = { unread: 0, firstMessageId: null, people: [], tasks: [], decisions: [], at: [] };

test("the catch-up line says how many, from whom, what was decided or made a task, and how many name you; a count only when nobody is named; it is empty for one message", () => {
  assert.equal(catchUpLine({ ...base, unread: 1, people: [{ id: "usr_maya", count: 1 }] }, name, 0), "");
  assert.equal(catchUpLine({ ...base, unread: 3, people: [{ id: "usr_maya", count: 3 }] }, name, 0), "Maya wrote.");
  assert.equal(catchUpLine({ ...base, unread: 4 }, name, 0), "4 new messages.");
  assert.equal(catchUpLine({ ...base, unread: 3, people: [{ id: "usr_maya", count: 3 }], decisions: [{ messageId: "m", text: "y" }] }, name, 1), "Maya wrote. 1 decision and you're mentioned.");
  const full = { ...base, unread: 9, people: [{ id: "usr_maya", count: 5 }, { id: "usr_noah", count: 4 }], tasks: [{ messageId: "m1", title: "x" }], decisions: [{ messageId: "m2", text: "y" }, { messageId: "m3", text: "z" }] };
  assert.equal(catchUpLine(full, name, 1), "Maya and 1 other wrote. 2 decisions, 1 task, and you're mentioned.");
});

test("a person is never told they wrote: their own messages are dropped, and an agent replied", () => {
  const c = { ...base, unread: 3, people: [{ id: "usr_me", count: 3 }] };
  assert.equal(catchUpLine(c, name, 0, { meId: "usr_me" }), "", "only my own messages: nothing to say");
  const mixed = { ...base, unread: 5, people: [{ id: "usr_me", count: 3 }, { id: "agt_x", count: 2 }] };
  assert.equal(catchUpLine(mixed, name, 0, { meId: "usr_me", kindOf: (id) => (id.startsWith("agt_") ? "agent" : "person") }), "agt_x replied.");
});
